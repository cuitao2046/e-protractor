// pages/index/index.js — iOS 风格指南针
const { CompassEngine } = require('../../utils/compass.js');

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
    geoSource: 'default',    // 磁偏角来源：live=实时定位 / cached=缓存位置 / default=北京默认
    geoSourceText: '',       // 来源中文提示
    calibrating: true,       // 罗盘未就绪时为 true，读数区显示「校准中」占位
  },

  onLoad() {
    this._destroyed = false;
    this._refAngle = null;   // 基准刻度（盘面坐标角度），来自罗盘组件
    this._prevLevel = false;
    this._lastRawH = null;   // 上一帧喂给组件的原始 heading（变化才 setData，避免每帧跨线程）
    this._lastRawB = null;
    this._lastRawG = null;

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
        this._isStill = !!s.isStill;   // 静止判定（测量用）
        this._onEngineUpdate(s);
      },
    });
    this.setData({ isTrueNorth: savedTN, isGeoDeclination: savedGeo });
  },

  onShow() {
    this._startEngine();
  },

  onHide() {
    this.engine && this.engine.stop();
  },

  onUnload() {
    this._destroyed = true;
    this.engine && this.engine.stop();
  },

  // 引擎高频回调（罗盘~5Hz + 陀螺仪~60Hz）。
  // 关键优化：原始 heading/beta/gamma 仅在「值变化」时 setData 给罗盘组件（组件内部 60fps 渲染层
  // 插值绘制，不再由逻辑层每帧 setData）；派生文本同样仅在值变化时 setData，彻底消除按帧跨线程通信。
  _onEngineUpdate(s) {
    const patch = {};

    // 原始值：变化才传给组件（驱动其渲染层插值），避免每帧跨线程通信
    if (this._lastRawH !== s.heading || this._lastRawB !== s.beta || this._lastRawG !== s.gamma) {
      patch.heading = s.heading;
      patch.beta = s.beta;
      patch.gamma = s.gamma;
      patch.stableHeading = s.stableHeading;
      this._lastRawH = s.heading;
      this._lastRawB = s.beta;
      this._lastRawG = s.gamma;
    }

    // 派生文本：仅在值变化时更新
    const disp = s.displayHeading;
    if (this.data.displayHeading !== disp) patch.displayHeading = disp;
    if (this.data.cardinalName !== s.cardinalName) patch.cardinalName = s.cardinalName;

    const isFlat = Math.abs(s.beta) < 50;
    const tilt = isFlat
      ? Math.sqrt(s.beta * s.beta + s.gamma * s.gamma)
      : Math.abs(s.gamma);
    const tiltStr = tilt < 0.5 ? '0' : tilt.toFixed(1);
    if (this.data.tiltDegrees !== tiltStr) patch.tiltDegrees = tiltStr;

    if (this.data.isLevel !== s.isLevel) patch.isLevel = s.isLevel;

    // 相对读数（0.1° 精度）
    const rel = this._computeRelative(s.heading);
    let relStr = '';
    if (rel !== null) {
      const v = Math.round(rel * 10) / 10;
      relStr = (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
    }
    if (this.data.relativeStr !== relStr) {
      patch.relativeStr = relStr;
      patch.relativeHeading = rel;
    }

    if (this.data.calibrating !== !!s.calibrating) {
      patch.calibrating = !!s.calibrating;
    }
    if (this.data.geoSource !== s.geoSource) {
      const _srcTxt = { live: '实时定位', cached: '缓存位置', default: '默认(北京)' }[s.geoSource] || '';
      patch.geoSource = s.geoSource;
      patch.geoSourceText = _srcTxt;
    }

    if (Object.keys(patch).length) this.setData(patch);

    // 水平仪十字与指针十字线重合（达到水平）时触发一次震动反馈
    if (s.isLevel && !this._prevLevel) {
      wx.vibrateShort({ type: 'medium' });
    }
    this._prevLevel = !!s.isLevel;
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
    // 先更新 UI 与持久化，保证开关一定切换；引擎调用放最后并 try/catch 防御
    this.setData({ isTrueNorth: nv });
    wx.setStorageSync('use_true_north', nv);
    if (this.engine) {
      try { this.engine.setTrueNorth(nv); } catch (e) {}
    }
    wx.showToast({ title: nv ? '已切换到真北' : '已切换到磁北', icon: 'none' });
  },

  // 切换是否按当前位置动态计算磁偏角（开启后请求定位权限并实时算 WMM 磁偏角）
  toggleGeoDeclination() {
    const nv = !this.data.isGeoDeclination;
    // 先更新 UI 与持久化，保证开关状态一定切换；引擎调用放最后并用 try/catch 包裹：
    // 真机上 wx.getLocation 在隐私/位置权限未授权时可能同步抛异常，若放在 setData
    // 之前会阻断 UI 更新，导致药丸卡在「关」。
    this.setData({ isGeoDeclination: nv });
    wx.setStorageSync('use_geo_declination', nv);
    if (this.engine) {
      try { this.engine.setGeoDeclination(nv); } catch (e) { /* 隐私未授权等，不影响开关 UI */ }
    }
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
