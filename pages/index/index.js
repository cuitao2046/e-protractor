// pages/index/index.js
const { ProtractorEngine } = require('../../utils/protractor.js');
const storage = require('../../utils/storage.js');
const app = getApp();

Page({
  data: {
    displayValue: '+0.0°',
    smoothAngle: 0,
    isSnap: false,
    holdLatched: false,
    isTiltWarning: false,
    unit: 'deg',
    recordCount: 0,
    started: false,
  },

  onLoad() {
    // 音频预加载（短促机械音，关掉静音开关以保证声触同步）
    this.tickAudio = wx.createInnerAudioContext();
    this.tickAudio.src = '/assets/audio/tick.wav';
    this.tickAudio.obeyMuteSwitch = false;

    this.snapAudio = wx.createInnerAudioContext();
    this.snapAudio.src = '/assets/audio/snap.wav';
    this.snapAudio.obeyMuteSwitch = false;

    this.engine = new ProtractorEngine({
      audio: { tick: this.tickAudio, snap: this.snapAudio },
      onUpdate: (s) => {
        if (this._destroyed) return;
        this.setData({
          displayValue: s.displayValue,
          smoothAngle: s.angle,
          isSnap: s.isSnapped,
          holdLatched: s.holdLatched,
          isTiltWarning: s.isTiltWarning,
        });
      },
    });

    const unit = app.globalData.unit || 'deg';
    this.engine.setUnit(unit);
    this.setData({ unit });
  },

  onShow() {
    this.setData({ recordCount: storage.getCount() });
  },

  onHide() {
    this.engine && this.engine.stop();
    this.setData({ started: false });
  },

  onUnload() {
    this._destroyed = true;
    this.engine && this.engine.stop();
    this.tickAudio && this.tickAudio.destroy();
    this.snapAudio && this.snapAudio.destroy();
  },

  // 开始 / 暂停测量
  async toggleStart() {
    if (this.data.started) {
      this.engine.stop();
      this.setData({ started: false });
      return;
    }
    try {
      await this.engine.start();
      this.setData({ started: true });
      wx.showToast({ title: '转动手机开始测量', icon: 'none' });
    } catch (e) {
      wx.showModal({
        title: '无法启动传感器',
        content: '请在 iPhone 的"设置 → 微信 → 运动与健身"中开启权限后重试。',
        showCancel: false,
      });
    }
  },

  // 点击 HUD 切换 度数 / 弧度
  toggleUnit() {
    const unit = this.engine.toggleUnit();
    app.globalData.unit = unit;
    wx.setStorageSync('unit_preference', unit);
    // 重新推送一次显示值
    this.engine._emit(this.data.smoothAngle, this.data.isTiltWarning);
    this.setData({ unit });
  },

  // 设为基准线（一键归零）
  setReference() {
    if (!this.data.started) {
      wx.showToast({ title: '请先开始测量', icon: 'none' });
      return;
    }
    this.engine.setReference();
    this.engine.releaseHold();
    this.setData({ holdLatched: false });
  },

  // 释放 Auto-Hold 锁定
  releaseHold() {
    this.engine.releaseHold();
    this.setData({ holdLatched: false });
  },

  // 记录当前测量值
  recordCurrent() {
    if (!this.data.started) {
      wx.showToast({ title: '请先开始测量', icon: 'none' });
      return;
    }
    const angleDeg = this.data.smoothAngle;
    const count = storage.addRecord({
      angleDeg,
      unit: this.data.unit,
      note: this.data.holdLatched ? '自动锁定' : '',
    });
    this.setData({
      recordCount: count,
      holdLatched: false,
    });
    this.engine.releaseHold();
    wx.showToast({ title: '已记录', icon: 'success' });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
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
