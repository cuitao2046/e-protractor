// pages/index/index.js — iOS 风格指南针
const { CompassEngine } = require('../../utils/compass.js');

// 每帧追赶系数：传感器低频(约5Hz) → rAF 插值平滑到 60fps
const EASE = 0.35;
const EPS = 0.02;

Page({
  data: {
    currentPage: 0,
    heading: 0,
    displayHeading: 0,
    stableHeading: 0,        // 高精度稳定读数（静止平均，0.1°）
    beta: 0,
    gamma: 0,
    cardinalName: '北',
    tiltDegrees: '0',
    isLevel: false,
    relativeHeading: null,   // 指针与基准的相对读数（锁定基准时显示）
    relativeStr: '',         // 相对读数显示字符串（如 +12.5°）
    showHistory: false,      // 历史记录面板
    historyList: [],         // 测量历史：[{id, timeStr, base, baseStr, delta, deltaStr}]
    isTrueNorth: false,      // 真北校正开关（默认磁北）
    isGeoDeclination: false, // 是否按当前位置动态计算磁偏角（默认关，回退北京）
  },

  onLoad() {
    this._destroyed = false;
    this._rafOn = false;
    this._raf = 0;
    this._prevLevel = false;
    this._refAngle = null;   // 基准刻度（盘面坐标角度），来自罗盘组件
    this._cur = { heading: 0, beta: 0, gamma: 0 };
    this._target = { heading: 0, beta: 0, gamma: 0, cardinalName: '北', isLevel: false };

    // 恢复历史记录（兼容旧版无 baseStr/deltaStr 的数据）
    const saved = wx.getStorageSync('compass_history');
    if (Array.isArray(saved) && saved.length) {
      const cleaned = saved.map((r) => {
        const baseNum = Math.round((r.base || 0) * 10) / 10;
        const deltaNum = Math.round((r.delta || 0) * 10) / 10;
        return {
          id: r.id,
          timeStr: r.timeStr,
          base: baseNum,
          baseStr: r.baseStr || baseNum.toFixed(1).replace(/\.0$/, ''),
          delta: deltaNum,
          deltaStr: r.deltaStr || (deltaNum >= 0 ? '+' : '') + deltaNum.toFixed(1) + '°',
        };
      });
      this.setData({ historyList: cleaned });
    }

    // 真北校正偏好（本地持久化）
    const savedTN = !!wx.getStorageSync('use_true_north');
    // 按位置算磁偏角偏好（本地持久化；开启后 wx.getLocation 动态算 WMM 磁偏角）
    const savedGeo = !!wx.getStorageSync('use_geo_declination');
    this.engine = new CompassEngine({
      useTrueNorth: savedTN,
      useGeoDeclination: savedGeo,
      onUpdate: (s) => {
        if (this._destroyed) return;
        // 只更新目标值，由 rAF 循环插值渲染
        this._target.heading = s.heading;
        this._target.beta = s.beta;
        this._target.gamma = s.gamma;
        this._target.cardinalName = s.cardinalName;
        this._target.isLevel = s.isLevel;
        this._isStill = !!s.isStill;   // 静止判定（测量用）
        this.setData({ stableHeading: s.stableHeading });
        this._startLoop();
      },
    });
    this.setData({ isTrueNorth: savedTN, isGeoDeclination: savedGeo });
  },

  onShow() {
    this._startEngine();
  },

  onHide() {
    this._stopLoop();
    this.engine && this.engine.stop();
  },

  onUnload() {
    this._destroyed = true;
    this._stopLoop();
    this.engine && this.engine.stop();
  },

  _startEngine() {
    this.engine.start().catch((e) => {
      const msg = (e && e.errMsg) || '';
      let title = '无法启动传感器';
      let tip = '请到 iPhone「设置 → 隐私与安全性 → 运动与健身 → 微信」开启权限，然后上滑彻底关闭微信重开。';
      if (msg.indexOf('privacy') >= 0) {
        title = '需先同意隐私协议';
        tip = '请在弹出的隐私协议中点击「同意」。';
      } else if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
        title = '运动权限被拒绝';
        tip = 'iOS 已缓存拒绝记录。请去「设置 → 隐私与安全性 → 运动与健身 → 微信」开启，并彻底关闭微信重开。';
      }
      wx.showModal({ title, content: tip, showCancel: false });
    });
  },

  // —— rAF 插值循环：低频传感器数据 → 60fps 流畅渲染 ——
  _startLoop() {
    if (this._rafOn || this._destroyed) return;
    this._rafOn = true;
    const step = () => {
      if (this._destroyed || !this._rafOn) { this._rafOn = false; return; }
      const t = this._target, c = this._cur;

      // heading 沿最短路径插值（处理 359°→0° 跳变）
      let dh = t.heading - c.heading;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      c.heading = (c.heading + dh * EASE + 360) % 360;
      c.beta += (t.beta - c.beta) * EASE;
      c.gamma += (t.gamma - c.gamma) * EASE;

      const done =
        Math.abs(dh) < EPS &&
        Math.abs(t.beta - c.beta) < EPS &&
        Math.abs(t.gamma - c.gamma) < EPS;
      if (done) {
        c.heading = t.heading;
        c.beta = t.beta;
        c.gamma = t.gamma;
      }

      const isFlat = Math.abs(c.beta) < 50;
      const tilt = isFlat
        ? Math.sqrt(c.beta * c.beta + c.gamma * c.gamma)
        : Math.abs(c.gamma);
      const tiltStr = tilt < 0.5 ? '0' : tilt.toFixed(1);

      // 水平仪十字与指针十字线重合（达到水平）时触发一次震动反馈
      const isLevelNow = Math.sqrt(c.beta * c.beta + c.gamma * c.gamma) < 0.5;
      if (isLevelNow && !this._prevLevel) {
        wx.vibrateShort({ type: 'medium' });
      }
      this._prevLevel = isLevelNow;

      // 相对读数（0.1° 精度）
      const rel = this._computeRelative(c.heading);
      let relStr = '';
      if (rel !== null) {
        const v = Math.round(rel * 10) / 10;
        relStr = (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
      }

      this.setData({
        heading: c.heading,
        displayHeading: Math.round(c.heading),
        beta: c.beta,
        gamma: c.gamma,
        cardinalName: t.cardinalName,
        isLevel: t.isLevel,
        tiltDegrees: tiltStr,
        relativeHeading: rel,
        relativeStr: relStr,
      });

      if (done) { this._rafOn = false; return; }
      this._raf = this._nextFrame(step);
    };
    this._raf = this._nextFrame(step);
  },

  _nextFrame(cb) {
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(cb);
    }
    return setTimeout(cb, 16);
  },

  _stopLoop() {
    this._rafOn = false;
    if (this._raf) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._raf);
      } else {
        clearTimeout(this._raf);
      }
      this._raf = 0;
    }
  },

  onSwiperChange(e) {
    this.setData({ currentPage: e.detail.current });
  },

  // 罗盘组件上报基准刻度变化
  onRefChange(e) {
    this._refAngle = (e && e.detail && typeof e.detail.refAngle === 'number') ? e.detail.refAngle : null;
  },

  // 双击罗盘：记录一次测量（基准 + 偏移量）
  onMeasure(e) {
    if (!e || !e.detail) return;
    const { refAngle, delta } = e.detail;
    if (typeof refAngle !== 'number' || typeof delta !== 'number') return;

    // 静止判定：手机不稳定时禁止记录，避免动态误差
    if (!this._isStill) {
      wx.showToast({ title: '请保持手机静止后再记录', icon: 'none' });
      return;
    }

    // 倾斜提示：手机倾斜过大时磁力计误差显著增大
    const b = this.data.beta, g = this.data.gamma;
    if (Math.abs(b) > 15 || Math.abs(g) > 15) {
      wx.showToast({ title: '请平放手机后测量', icon: 'none' });
      return;
    }

    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const baseNum = Math.round(refAngle * 10) / 10;
    const deltaNum = Math.round(delta * 10) / 10;
    const record = {
      id: Date.now() + '_' + Math.floor(Math.random() * 1000),
      timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      base: baseNum,
      baseStr: baseNum.toFixed(1).replace(/\.0$/, ''),
      delta: deltaNum,
      deltaStr: (deltaNum >= 0 ? '+' : '') + deltaNum.toFixed(1) + '°',
    };
    const list = [record].concat(this.data.historyList).slice(0, 200);
    this.setData({ historyList: list });
    wx.setStorageSync('compass_history', list);
  },

  // 切换真北/磁北显示（默认磁北；微信 iOS 已返回真北，故真北直通、磁北 = 真北 − 磁偏角(WMM 东正)）
  toggleTrueNorth() {
    const nv = !this.data.isTrueNorth;
    if (this.engine) this.engine.setTrueNorth(nv);
    this.setData({ isTrueNorth: nv });
    wx.setStorageSync('use_true_north', nv);
    wx.showToast({ title: nv ? '已切换到真北' : '已切换到磁北', icon: 'none' });
  },

  // 切换是否按当前位置动态计算磁偏角（开启后请求定位权限并实时算 WMM 磁偏角）
  toggleGeoDeclination() {
    const nv = !this.data.isGeoDeclination;
    if (this.engine) this.engine.setGeoDeclination(nv);
    this.setData({ isGeoDeclination: nv });
    wx.setStorageSync('use_geo_declination', nv);
    wx.showToast({
      title: nv ? '已开启：按位置算磁偏角' : '已关闭：使用默认磁偏角',
      icon: 'none',
    });
  },

  openHistory() {
    this.setData({ showHistory: true });
  },

  closeHistory() {
    this.setData({ showHistory: false });
  },

  clearHistory() {
    wx.showModal({
      title: '清空测量历史',
      content: '确定要清空所有测量记录吗？',
      confirmColor: '#FF453A',
      success: (res) => {
        if (res.confirm) {
          this.setData({ historyList: [] });
          wx.removeStorageSync('compass_history');
        }
      },
    });
  },

  noop() {},

  // 指针与基准的相对读数：从基准顺时针为正，逆时针为负（范围 (-180, 180]），0.1° 精度
  _computeRelative(heading) {
    if (this._refAngle === null || this._refAngle === undefined) return null;
    let rel = ((heading - this._refAngle) % 360 + 360) % 360;
    if (rel > 180) rel -= 360;
    return Math.round(rel * 10) / 10;
  },

  onShareAppMessage() {
    return { title: '指南针', path: '/pages/index/index' };
  },
  onShareTimeline() {
    return { title: '指南针' };
  },
});