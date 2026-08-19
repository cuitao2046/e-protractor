/**
 * utils/compass.js
 * iOS 指南针核心引擎（互补滤波版）
 *
 * 职责：
 * - 罗盘方向：wx.onCompassChange 获取 direction（0=北, 90=东, 180=南, 270=西，顺时针）
 * - 倾斜角度：wx.startDeviceMotionListening 获取 beta/gamma，供水平仪使用
 * - 互补滤波：陀螺仪(alpha 差分)提供短时高响应、低滞后；磁力计提供长时绝对校准、防漂移
 * - rawHeading：最近一次罗盘原始值（测量用，绕开滤波滞后）
 * - 静止判定：连续多帧角速度低于阈值判定为静止（测量精度关键）
 * - 真北/磁北切换：实测表明 iOS 上 wx.onCompassChange 返回的 direction 已是「真北」
 *   （raw 与苹果真北一致：小程序 raw 330 == 苹果真北 330；苹果磁北 338 = raw + 8）。
 *   因此：真北 = 原值（直通）；磁北 = 原值 − declination。
 *   declination 取 WMM2025 模型按经纬度实时计算（东偏为正；北京约 −7.5°，
 *   即磁北在真北西侧，故磁北 = 真北 + 7.5°）。开启 useGeoDeclination 时用
 *   wx.getLocation 获取当前位置动态算；否则回退北京固定值。
 * - 每 30° 触觉反馈（北向更强）
 *
 * 说明：alpha（陀螺仪）与罗盘方向在部分机型上相反，本实现用罗盘变化方向
 *       自适应校准 alpha 方向（_alphaSign），无需手动配置。
 */

const Geomag = require('./geomag.js');

function normalizeAngle(delta) {
  let x = ((delta % 360) + 360) % 360;
  if (x >= 180) x -= 360;
  return x;
}

const CARDINALS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

// 陀螺仪(alpha差分)跟随系数：0.9 短时接近原始角速度，1.0 完全跟随
const GYRO_WEIGHT = 0.9;
// 磁力计校正系数：约 5Hz 采样下 0.12 在数百毫秒量级内把漂移拉回，同时抑制磁力计噪声
const MAG_WEIGHT = 0.12;
// 自适应方向校准的最小变化阈值（°）：低于该值视为噪声，不更新符号，避免误翻转
const CALIB_MIN_DELTA = 3;
// 静止判定：角速度低于该值视为静止（°/s）
const STILL_RATE = 0.8;
// 连续多少帧（game 约 60Hz）静止才算稳定
const STILL_FRAMES = 10;
// 静止时用于平均的罗盘样本数（约 5Hz 采样下 5 个 ≈ 1 秒），噪声按 ~1/√N 下降
const STILL_SAMPLE_N = 5;

class CompassEngine {
  constructor(opts = {}) {
    this.onUpdate = opts.onUpdate || function () {};
    // 真北/磁北开关（默认关，显示磁北）。微信在 iOS 上返回真北：开启 useTrueNorth 时直通、
    // 关闭时按 declination 换算磁北（磁北 = 真北 − declination，declination 东偏为正）。
    this.useTrueNorth = !!opts.useTrueNorth;
    // 是否按当前位置动态计算磁偏角（wx.getLocation）；关闭时回退北京固定值
    this.useGeoDeclination = !!opts.useGeoDeclination;
    this._hasGeoDeclination = false;
    // declination：WMM 磁偏角（东偏为正，单位°）。默认用北京 WMM2025 值，开启定位后覆盖。
    // 注意：index.js 不应再硬编码 declination（旧 +8 是"加值"，与新东正约定相反）。
    this.declination = (typeof opts.declination === 'number')
      ? opts.declination
      : Geomag.declination(39.9042, 116.4074, this._decimalYear());

    this.heading = 0;        // 平滑显示值（即微信方向的真北值；UI 输出层按开关做真/磁切换）
    this.fused = 0;          // 互补滤波融合值（heading 的数据源）
    this.rawHeading = 0;     // 最近罗盘原始值（测量用）
    this.beta = 0;
    this.gamma = 0;
    this.isStill = false;    // 是否静止（连续 STILL_FRAMES 帧低角速度）
    this.lastTickBucket = -1;
    this.inited = false;
    this.compassReady = false;
    this._hasCompass = false;
    this.lastAlpha = null;
    this.lastAlphaTime = 0;
    this.stillFrames = 0;
    // 自适应陀螺仪方向：真机上 alpha 与罗盘方向可能相反，用罗盘变化方向自动校准
    this._alphaSign = 1;
    this._alphaAtPrevCompass = null;
    // 静止样本缓冲：静止时持续采集罗盘原始值，供圆形平均输出高精度读数
    this.stillBuffer = [];
  }

  // 当前十进制年份（WMM 按年做线性年变率外推）
  _decimalYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = (now - start) / 86400000;
    const len = (now.getFullYear() % 4 === 0) ? 366 : 365;
    return now.getFullYear() + dayOfYear / len;
  }

  // 按当前位置用 WMM2025 计算磁偏角，覆盖 this.declination
  updateDeclinationFromLocation() {
    if (typeof wx === 'undefined') return;
    const self = this;
    wx.getLocation({
      type: 'wgs84',
      altitude: false,
      success: (res) => {
        const d = Geomag.declination(res.latitude, res.longitude, self._decimalYear());
        if (typeof d === 'number' && !isNaN(d)) {
          self.declination = d;
          self._hasGeoDeclination = true;
          self._emit();
        }
      },
      fail: () => { /* 获取失败：保留默认/上次值，不阻断指南针 */ },
    });
  }

  // 切换是否按位置算磁偏角；开启时立即拉取位置并重算
  setGeoDeclination(v) {
    this.useGeoDeclination = !!v;
    if (this.useGeoDeclination && this.running) {
      this.updateDeclinationFromLocation();
    } else {
      this._emit();
    }
  }

  // 切换真北/磁北，立即刷新一次读数（无需等下一次传感器回调）
  setTrueNorth(v) {
    this.useTrueNorth = !!v;
    this._emit();
  }

  start() {
    if (this.running) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const startCompass = () => {
        wx.startCompass({
          success: () => {
            wx.onCompassChange(this._onCompass.bind(this));
          },
          fail: () => { /* 罗盘不可用，退回 alpha */ },
        });
      };

      wx.startDeviceMotionListening({
        interval: 'game',
        success: () => {
          wx.onDeviceMotionChange(this._onMotion.bind(this));
          startCompass();
          this.running = true;
          if (this.useGeoDeclination) this.updateDeclinationFromLocation();
          resolve(true);
        },
        fail: (err) => { reject(err); },
      });
    });
  }

  stop() {
    if (!this.running) return;
    try { wx.stopCompass(); } catch (e) {}
    try { wx.stopDeviceMotionListening(); } catch (e) {}
    this.running = false;
    // 重置融合/静止/自适应状态：避免切后台再切回时复用陈旧数据
    // （stillBuffer、fused、_hasCompass 等），否则首个罗盘读数会被旧缓冲
    // 拖拽、缓慢漂移，出现 0°→357° 这类跳变。切回 start 时因 _hasCompass
    // 复位为 false，首个罗盘读数会干净地重新初始化 fused。
    this.fused = 0;
    this.heading = 0;
    this.rawHeading = 0;
    this.isStill = false;
    this.stillFrames = 0;
    this.stillBuffer = [];
    this._hasCompass = false;   // 关键：让首个罗盘读数重新初始化 fused
    this.lastAlpha = null;
    this.lastAlphaTime = 0;
    this._alphaAtPrevCompass = null;
    this._alphaSign = 1;
    this.inited = false;
    this.lastTickBucket = -1;
    // 注：compassReady 保留为 true，避免罗盘就绪前误走 alpha 退回分支污染读数
  }

  // —— 磁力计（约5Hz）：绝对方向 + 慢速漂移校正 ——
  _onCompass(res) {
    if (!res || typeof res.direction !== 'number') return;
    this.compassReady = true;

    // 自适应校准 alpha 方向：比较罗盘变化方向与 alpha 变化方向（仅在大幅变化时更新）
    const prevRaw = this.rawHeading;
    const compassDelta = normalizeAngle(res.direction - prevRaw);
    if (this.lastAlpha !== null && this._alphaAtPrevCompass !== null) {
      const alphaDelta = normalizeAngle(this.lastAlpha - this._alphaAtPrevCompass);
      if (Math.abs(compassDelta) > CALIB_MIN_DELTA && Math.abs(alphaDelta) > CALIB_MIN_DELTA) {
        this._alphaSign = compassDelta * alphaDelta < 0 ? -1 : 1;
      }
    }
    this._alphaAtPrevCompass = this.lastAlpha;

    this.rawHeading = res.direction;

    // 静止：采集样本；运动：清空样本
    if (this.isStill) {
      this.stillBuffer.push(res.direction);
      if (this.stillBuffer.length > STILL_SAMPLE_N) this.stillBuffer.shift();
    } else {
      this.stillBuffer.length = 0;
    }

    if (!this._hasCompass) {
      // 首次罗盘读数：初始化融合值
      this._hasCompass = true;
      this.fused = this.rawHeading;
    } else if (this.isStill && this.stillBuffer.length >= 2) {
      // 静止：锁定到磁力计圆形平均，消除陀螺仪漂移（显示精确）
      this.fused = this._circularMean(this.stillBuffer);
    } else {
      // 运动：磁力计快速校正陀螺仪漂移
      const diff = normalizeAngle(this.rawHeading - this.fused);
      this.fused = ((this.fused + diff * MAG_WEIGHT) % 360 + 360) % 360;
    }
    this.heading = this.fused;
    this._tick();
    this._emit();
  }

  // —— 陀螺仪/姿态角（game 约60Hz）：短时积分 + 静止判定 ——
  _onMotion(res) {
    if (!res) return;
    this.beta = typeof res.beta === 'number' ? res.beta : this.beta;
    this.gamma = typeof res.gamma === 'number' ? res.gamma : this.gamma;

    const now = Date.now();
    const alpha = typeof res.alpha === 'number' ? res.alpha : null;

    if (alpha !== null && this.lastAlpha !== null && this._hasCompass) {
      let dA = alpha - this.lastAlpha;
      if (dA > 180) dA -= 360;
      if (dA < -180) dA += 360;
      const dt = (now - this.lastAlphaTime) / 1000;
      if (dt > 0 && dt < 0.25) {
        const rate = Math.abs(dA) / dt;   // 角速度（°/s）
        // 静止判定
        this.stillFrames = rate < STILL_RATE ? this.stillFrames + 1 : 0;
        this.isStill = this.stillFrames >= STILL_FRAMES;
        // 静止时不做陀螺仪积分（fused 由磁力计圆形平均锁定，保证方向精确）
        if (!this.isStill) {
          // 互补滤波：陀螺仪短时积分（快、低滞后），方向由罗盘自适应校准
          this.fused = ((this.fused + dA * this._alphaSign * GYRO_WEIGHT) % 360 + 360) % 360;
          this.heading = this.fused;
        }
      }
    }
    this.lastAlpha = alpha;
    this.lastAlphaTime = now;

    // 罗盘不可用时退回 alpha（仅粗略方向）
    if (!this.compassReady && alpha !== null && this._hasCompass === false) {
      this.fused = ((alpha * this._alphaSign) % 360 + 360) % 360;
      this.heading = this.fused;
    }

    if (!this.inited) {
      this.inited = true;
      this.lastTickBucket = Math.floor((((this.heading % 360) + 360) % 360) / 30);
    }
    this._emit();
  }

  // 圆形平均（正确处理 359°/0° 环绕）
  _circularMean(samples) {
    if (!samples.length) return null;
    let s = 0, c = 0;
    for (const v of samples) {
      const rad = (v * Math.PI) / 180;
      s += Math.sin(rad);
      c += Math.cos(rad);
    }
    return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
  }

  // 高精度稳定读数：静止且有足够样本时返回圆形平均（0.1°），否则返回原始值
  getStableHeading() {
    if (this.isStill && this.stillBuffer.length >= 2) {
      return Math.round(this._circularMean(this.stillBuffer) * 10) / 10;
    }
    return Math.round(this.rawHeading * 10) / 10;
  }

  _tick() {
    if (!this.inited) return;
    // 每 30° 一个触觉反馈，北（0°）反馈更强；按「显示值」判定（真北直通 / 磁北 −declination）
    const raw = this.useTrueNorth
      ? this.heading
      : ((this.heading - this.declination) % 360 + 360) % 360;
    const bucket = Math.floor((((raw % 360) + 360) % 360) / 30);
    if (bucket !== this.lastTickBucket) {
      this.lastTickBucket = bucket;
      wx.vibrateShort({ type: bucket === 0 ? 'medium' : 'light' });
    }
  }

  _emit() {
    // 真北/磁北切换：微信在 iOS 上返回真北，故真北=直通、磁北=原值−declination
    // （declination 为 WMM 磁偏角，东偏为正；北京约 −7.5°，即磁北=真北+7.5°）
    const t = this.useTrueNorth ? 0 : this.declination;
    const correct = (v) => (((v - t) % 360) + 360) % 360;
    const h = correct(this.heading);
    const idx = Math.round(h / 45) % 8;
    const isLevel = Math.abs(this.beta) < 2 && Math.abs(this.gamma) < 2;

    this.onUpdate({
      heading: h,
      displayHeading: Math.round(h),
      rawHeading: correct(this.rawHeading),             // 校正后的原始罗盘值
      stableHeading: correct(this.getStableHeading()),  // 校正后的高精度稳定读数（0.1°）
      beta: this.beta,
      gamma: this.gamma,
      cardinalName: CARDINALS[idx],
      isLevel,
      isStill: this.isStill,
    });
  }
}

module.exports = { CompassEngine, normalizeAngle };
