// pages/index/index.js
const { ProtractorEngine, normalizeAngle } = require('../../utils/protractor.js');
const storage = require('../../utils/storage.js');
const app = getApp();

Page({
  data: {
    displayValue: '+0.0°',
    phoneHeading: 0,
    baselineAngle: 0,        // 初始 0 = 正北（与指南针正北向重叠）
    isSnap: false,
    baselineSet: false,
    unit: 'deg',
    recordCount: 0,
    cardinalText: '北',
    statusText: '正在校准基准…',
  },

  onLoad() {
    // 音频预加载（短促机械音，关掉静音开关以保证声触同步）
    this.tickAudio = wx.createInnerAudioContext();
    this.tickAudio.src = '/assets/audio/tick.wav';
    this.tickAudio.obeyMuteSwitch = false;

    this.snapAudio = wx.createInnerAudioContext();
    this.snapAudio.src = '/assets/audio/snap.wav';
    this.snapAudio.obeyMuteSwitch = false;

    this._autoLocked = false;     // 本次生命周期内是否已自动锁定
    this._needAutoLock = true;    // 等待首帧运动数据后自动锁定
    this.lastDialTapTime = 0;
    this.lastReadoutTapTime = 0;

    this.engine = new ProtractorEngine({
      audio: { tick: this.tickAudio, snap: this.snapAudio },
      onUpdate: (s) => {
        if (this._destroyed) return;
        // 首帧拿到真实姿态后，自动标记已就绪（基准线默认在正北，基准=0°）
        if (this._needAutoLock && typeof s.alpha === 'number') {
          this._doAutoLock();
        }
        this.setData({
          displayValue: s.displayValue,
          phoneHeading: s.alpha || 0,
          isSnap: s.isSnapped,
          baselineSet: this.data.baselineSet,
          cardinalText: this._angleToCardinal(s.angle),
          statusText: this._buildStatus(s.isSnapped, this.data.baselineSet),
        });
      },
    });

    const unit = app.globalData.unit || 'deg';
    this.engine.setUnit(unit);
    this.setData({ unit });
  },

  onShow() {
    this.setData({ recordCount: storage.getCount() });
    // 打开即进入测量模式（返回本页也恢复测量，但已锁定的基准保持不变）
    if (!this.engine.listening) {
      this._autoStart();
    }
  },

  onHide() {
    this.engine && this.engine.stop();
    if (this._lockTimer) {
      clearTimeout(this._lockTimer);
      this._lockTimer = null;
    }
  },

  onUnload() {
    this._destroyed = true;
    this.engine && this.engine.stop();
    this.tickAudio && this.tickAudio.destroy();
    this.snapAudio && this.snapAudio.destroy();
    if (this._lockTimer) clearTimeout(this._lockTimer);
  },

  // —— 打开即启动测量；首帧自动就绪（基准默认在正北）——
  _autoStart() {
    this.engine
      .start()
      .then(() => {
        if (this._needAutoLock && !this._autoLocked) {
          // 若 1s 内无运动回调，也强制标记就绪，避免卡在"校准中"
          this._lockTimer = setTimeout(() => {
            if (this._needAutoLock && !this._autoLocked) this._doAutoLock();
          }, 1000);
        }
      })
      .catch((e) => {
        const msg = (e && e.errMsg) || '';
        let title = '无法启动传感器';
        let tip =
          '请到 iPhone「设置 → 隐私与安全性 → 运动与健身 → 微信」开启权限，\n' +
          '然后务必上滑彻底关闭微信（杀进程）再重开，仅关小程序无效。';
        if (msg.indexOf('privacy') >= 0) {
          title = '需先同意隐私协议';
          tip =
            '弹出的隐私协议请点「同意」；若反复弹出，请到 mp.weixin.qq.com 后台\n' +
            '「设置 → 服务类目/用户隐私保护指引」发布隐私指引，再重新进入小程序。';
        } else if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          title = '运动权限被拒绝';
          tip =
            'iOS 已缓存「拒绝」记录。请去「设置 → 隐私与安全性 → 运动与健身 → 微信」开启，\n' +
            '并上滑彻底关闭微信重开（running 进程不会即时读取新授权）。';
        }
        wx.showModal({ title, content: tip + '\n\n(err: ' + msg + ')', showCancel: false });
      });
  },

  _doAutoLock() {
    this._needAutoLock = false;
    this._autoLocked = true;
    if (this._lockTimer) {
      clearTimeout(this._lockTimer);
      this._lockTimer = null;
    }
    // 基准默认就在正北(baselineAngle=0)，自动就绪只标记"已锁定"状态
    this.setData({ baselineSet: true, statusText: '相对角度 · 基准已锁定' });
    wx.showToast({ title: '已锁定基准', icon: 'success' });
  },

  // —— 手势：单击罗盘 → 把基准线切换到当前手机指向；双击罗盘 → 记录历史 ——
  onDialTap() {
    const now = Date.now();
    if (this.lastDialTapTime && now - this.lastDialTapTime < 300) {
      // 双击：记录
      clearTimeout(this.dialTapTimer);
      this.lastDialTapTime = 0;
      this.dialTapTimer = null;
      this.recordCurrent();
      return;
    }
    // 单击：延迟 300ms 看是否有第二击
    this.lastDialTapTime = now;
    this.dialTapTimer = setTimeout(() => {
      this.lastDialTapTime = 0;
      this.dialTapTimer = null;
      this._setBaselineToCurrentHeading();
    }, 300);
  },

  // 把基准线切换到当前手机指向(并把该方向设为 0°)
  _setBaselineToCurrentHeading() {
    const phoneHeading = this.data.phoneHeading;
    this.engine.setReference(phoneHeading);
    this.setData({ baselineAngle: phoneHeading, baselineSet: true });
    wx.showToast({ title: '已设置基准', icon: 'success' });
  },

  // —— 手势：点击读数 切换度/弧度（双击此处也会记录）——
  onReadoutTap() {
    const now = Date.now();
    if (now - this.lastReadoutTapTime < 300) {
      clearTimeout(this.readoutTapTimer);
      this.lastReadoutTapTime = 0;
      this.recordCurrent();
      return;
    }
    this.lastReadoutTapTime = now;
    this.readoutTapTimer = setTimeout(() => {
      this.lastReadoutTapTime = 0;
      this.toggleUnit();
    }, 300);
  },

  // 点击 HUD 切换 度数 / 弧度
  toggleUnit() {
    const unit = this.engine.toggleUnit();
    app.globalData.unit = unit;
    wx.setStorageSync('unit_preference', unit);
    // 用当前测量值重发一次，以刷新 displayValue
    this.engine._emit(this.data.phoneHeading, this.data.isSnap);
    this.setData({ unit });
  },

  // 记录当前测量值
  recordCurrent() {
    // 当前测量角 = 引擎平滑后的 angle（s.angle），不是 phoneHeading
    const angleDeg = this.engine.smoothAngle;
    const count = storage.addRecord({
      angleDeg,
      unit: this.data.unit,
      note: '',
    });
    this.setData({ recordCount: count });
    wx.showToast({ title: '已记录', icon: 'success' });
  },

  // 左上角汉堡 → 查看全部历史
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  _angleToCardinal(angle) {
    let d = angle % 360;
    if (d < 0) d += 360;
    const idx = Math.round(d / 45) % 8;
    const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return labels[idx];
  },

  _buildStatus(isSnap, baselineSet) {
    if (isSnap) return '已归零';
    if (baselineSet) return '相对角度 · 基准已锁定';
    return '正在校准基准…';
  },

  // —— 社交裂变：分享给好友 / 朋友圈，利于冷启动获客 ——
  onShareAppMessage() {
    return {
      title: `我用电子量角器测出 ${this.data.displayValue}，来试试你的手感`,
      path: '/pages/index/index',
    };
  },
  onShareTimeline() {
    return {
      title: '电子量角器 · 机械手感，精准测量',
      query: '',
    };
  },
});
