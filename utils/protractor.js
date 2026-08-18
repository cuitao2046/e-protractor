/**
 * utils/protractor.js
 * 电子量角器核心算法引擎（纯逻辑，不依赖具体页面，便于单测与复用）
 *
 * 关键修正点（相对原方案）：
 * 1) 角度归一化使用正确的 [-180,180) 映射，修复 JS 负数取模 bug
 *    —— 原方案 ((delta+180)%360)-180 在 delta=-200 时得到 -200（错误），正确应为 160
 * 2) 采样频率改为 'game'（~20ms / 50Hz），'ui' 仅约 16Hz 不够跟手
 * 3) 增加倾斜（off-axis）投影校正提示与 Auto-Hold 自动锁定
 */

// —— 1. 角度归一化：任意实数角度映射到 [-180, 180) ——
function normalizeAngle(delta) {
  // 先折叠到 [0,360)
  let x = ((delta % 360) + 360) % 360;
  // 再折叠到 [-180,180)
  if (x >= 180) x -= 360;
  return x;
}

// —— 2. 简单节流：防止 Taptic 队列堵塞发糊 ——
function throttle(last, now, intervalMs) {
  return now - last >= intervalMs;
}

class ProtractorEngine {
  /**
   * @param {Object} opts
   * @param {Function} opts.onUpdate  每次计算出新角度后的回调，参数为 { angle, unit, displayValue, isSnap, isTiltWarning, alpha, beta, gamma }
   * @param {Object}   opts.audio     可选，传入预创建的音频对象 { tick, snap }
   */
  constructor(opts = {}) {
    this.onUpdate = opts.onUpdate || function () {};
    this.audio = opts.audio || null;

    this.refAngle = 0;        // 基准线（设为 0° 时的原始 alpha）
    this.rawAngle = 0;        // 最近一次原始姿态角
    this.smoothAngle = 0;     // 滤波后角度（相对基准）
    this.lastRawAngle = 0;    // 上一帧原始角（用于角速度估算）
    this.velocity = 0;        // 角速度（用于自适应滤波）
    this.unit = 'deg';
    this.isSnapped = false;
    this.snapLatched = false; // 磁吸防抖锁存
    this.baselineSet = false; // 是否已锁定基准线（0° 参考）
    this.lastVibrateStep = 0;
    this.lastVibrateTime = 0;
    this.holdTimer = null;
    this.holdLatched = false;
    this.listening = false;

    this.SNAP_THRESHOLD = 0.5;   // 磁吸阈值（度）
    this.STEP_DEG = 1.0;         // 齿轮步长（度）
    this.VIBRATE_INTERVAL = 30;  // 微震最小间隔（ms）
    this.TILT_WARN_DEG = 15;     // 倾斜警告阈值（绕 X/Y 轴）
    this.HOLD_STABLE_DEG = 0.1;  // Auto-Hold 稳定阈值（度）
    this.HOLD_MS = 1000;         // Auto-Hold 持续时长（ms）
  }

  // —— 启动设备运动监听 ——
  start() {
    if (this.listening) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      wx.startDeviceMotionListening({
        // 'game' ≈ 20ms/50Hz，量角器需要最高响应；'ui' ≈ 60ms 太慢
        interval: 'game',
        success: () => {
          this.listening = true;
          wx.onDeviceMotionChange(this._onMotionChange.bind(this));
          resolve(true);
        },
        fail: (err) => {
          // iOS 可能弹"运动与健身"系统授权；用户拒绝时会进这里
          reject(err);
        },
      });
    });
  }

  stop() {
    if (!this.listening) return;
    wx.stopDeviceMotionListening();
    this.listening = false;
    this._clearHold();
  }

  // —— 设为基准线：一键消除当前所有静态偏差 ——
  // 可选参数 angle：指定基准原始角度(0-360)；不传则使用当前 rawAngle
  setReference(angle) {
    this.refAngle = typeof angle === 'number' ? angle : this.rawAngle;
    this.smoothAngle = 0;
    this.isSnapped = false;
    this.snapLatched = false;
    this.baselineSet = true;
    this._emit(this.smoothAngle, false); // 立即同步 baselineSet 到 UI
    // 重震 + 闭锁音，给明确的"已归零"反馈
    wx.vibrateShort({ type: 'heavy' });
    if (this.audio && this.audio.snap) {
      this.audio.snap.seek(0);
      this.audio.snap.play();
    }
  }

  // —— 恢复持久化的基准线（小程序重开后调用）——
  restoreBaseline(refAngle) {
    this.refAngle = refAngle;
    this.baselineSet = true;
  }

  setUnit(unit) {
    this.unit = unit === 'rad' ? 'rad' : 'deg';
  }

  toggleUnit() {
    this.setUnit(this.unit === 'deg' ? 'rad' : 'deg');
    return this.unit;
  }

  // —— 设备运动回调 ——
  _onMotionChange(res) {
    // WeChat DeviceMotion 返回 { alpha, beta, gamma }
    // alpha: 绕 Z 轴方向 [0,360)；beta: 绕 X 轴 [-180,180)；gamma: 绕 Y 轴 [-90,90)
    const alpha = typeof res.alpha === 'number' ? res.alpha : 0;
    const beta = typeof res.beta === 'number' ? res.beta : 0;
    const gamma = typeof res.gamma === 'number' ? res.gamma : 0;

    this.rawAngle = alpha;

    // (1) 相对转角
    let delta = alpha - this.refAngle;
    // (2) 归一化到 [-180,180) —— 正确处理 0/360 跨越与负数
    delta = normalizeAngle(delta);

    // 角速度估算（用于自适应滤波阻尼）
    let diff = normalizeAngle(alpha - this.lastRawAngle);
    this.velocity = Math.abs(diff);
    this.lastRawAngle = alpha;

    // (3) 自适应一阶低通滤波
    //     快速转动 -> 高 α（低阻尼，跟手）；慢速/静止 -> 低 α（高阻尼，防抖）
    const alpha_filter = this.velocity > 5 ? 0.6 : 0.15;
    this.smoothAngle = alpha_filter * delta + (1 - alpha_filter) * this.smoothAngle;

    // (4) 倾斜（off-axis）提示：绕 X/Y 轴过大时影响 Z 轴投影
    const isTiltWarning =
      Math.abs(beta) > this.TILT_WARN_DEG || Math.abs(gamma) > this.TILT_WARN_DEG;

    // (5) 反馈判定（齿轮微震 / 磁吸重震 + 闭锁音）
    this._checkFeedback(this.smoothAngle);

    // (6) Auto-Hold 自动锁定
    this._checkHold(this.smoothAngle);

    // (7) 推送 UI
    this._emit(this.smoothAngle, isTiltWarning);
  }

  _emit(angle, isTiltWarning) {
    const isDeg = this.unit === 'deg';
    const displayValue = isDeg
      ? this._fmt(angle, 1) + '°'
      : this._fmt(angle * Math.PI / 180, 3) + ' rad';
    this.onUpdate({
      angle,
      unit: this.unit,
      displayValue,
      isSnapped: this.isSnapped,
      holdLatched: this.holdLatched,
      baselineSet: this.baselineSet,
      isTiltWarning,
      alpha: this.rawAngle,
    });
  }

  _fmt(n, d) {
    // 保留符号：+0.0 / -0.0 区分，避免 "-0.0°" 这类显示异常
    if (Object.is(n, -0)) n = 0;
    const s = n.toFixed(d);
    return (n > 0 ? '+' : '') + s;
  }

  _checkFeedback(angle) {
    const abs = Math.abs(angle);
    const now = Date.now();

    // 磁吸归零（靠近基准线 ±0.5°）
    if (abs <= this.SNAP_THRESHOLD) {
      if (!this.snapLatched) {
        this.snapLatched = true;
        this.isSnapped = true;
        wx.vibrateShort({ type: 'heavy' });
        if (this.audio && this.audio.snap) {
          this.audio.snap.seek(0);
          this.audio.snap.play();
        }
      }
      return;
    } else {
      this.isSnapped = false;
      this.snapLatched = false;
    }

    // 齿轮微震：每跨越 1° 触发一次
    const step = Math.floor(angle);
    if (Math.abs(step - this.lastVibrateStep) >= this.STEP_DEG) {
      if (throttle(this.lastVibrateTime, now, this.VIBRATE_INTERVAL)) {
        wx.vibrateShort({ type: 'light' });
        if (this.audio && this.audio.tick) {
          this.audio.tick.seek(0);
          this.audio.tick.play();
        }
        this.lastVibrateStep = step;
        this.lastVibrateTime = now;
      }
    }
  }

  _checkHold(angle) {
    if (this.holdLatched) return;
    if (Math.abs(angle - (this._holdLast || angle)) <= this.HOLD_STABLE_DEG) {
      if (!this.holdTimer) {
        this.holdTimer = setTimeout(() => {
          this.holdLatched = true;
          this._emit(angle, false); // 锁定后高亮
          wx.vibrateShort({ type: 'medium' });
        }, this.HOLD_MS);
      }
    } else {
      this._clearHold();
    }
    this._holdLast = angle;
  }

  _clearHold() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.holdLatched = false;
  }

  releaseHold() {
    this._clearHold();
  }
}

module.exports = { ProtractorEngine, normalizeAngle };
