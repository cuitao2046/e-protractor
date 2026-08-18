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
    cardinalText: '北',
    statusText: '已暂停 · 单击屏幕开始',
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
          cardinalText: this._angleToCardinal(s.angle),
          statusText: this._buildStatus(s.isTiltWarning, s.holdLatched),
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
    this.setData({ started: false, statusText: '已暂停 · 单击屏幕继续' });
  },

  onUnload() {
    this._destroyed = true;
    this.engine && this.engine.stop();
    this.tickAudio && this.tickAudio.destroy();
    this.snapAudio && this.snapAudio.destroy();
    if (this.tapTimer) clearTimeout(this.tapTimer);
    if (this.readoutTapTimer) clearTimeout(this.readoutTapTimer);
  },

  // —— 手势：单击屏幕 开始/停止 ——
  onPageTap() {
    const now = Date.now();
    if (now - this.lastTapTime < 300) {
      clearTimeout(this.tapTimer);
      this.lastTapTime = 0;
      this.recordCurrent();
      return;
    }
    this.lastTapTime = now;
    this.tapTimer = setTimeout(() => {
      this.lastTapTime = 0;
      this.toggleStart();
    }, 300);
  },

  // —— 手势：长按屏幕 设为基准 ——
  onPageLongPress() {
    if (!this.data.started) {
      wx.showToast({ title: '请先开始测量', icon: 'none' });
      return;
    }
    this.engine.setReference();
    this.engine.releaseHold();
    this.setData({ holdLatched: false });
    wx.showToast({ title: '已设为基准', icon: 'success' });
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

  // 开始 / 暂停测量
  async toggleStart() {
    if (this.data.started) {
      this.engine.stop();
      this.setData({ started: false, statusText: '已暂停 · 单击屏幕继续' });
      return;
    }
    try {
      await this.engine.start();
      this.setData({ started: true, statusText: '相对角度' });
      wx.showToast({ title: '转动手机开始测量', icon: 'none' });
    } catch (e) {
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
      wx.showModal({
        title,
        content: tip + '\n\n(err: ' + msg + ')',
        showCancel: false,
      });
    }
  },

  // 点击 HUD 切换 度数 / 弧度
  toggleUnit() {
    const unit = this.engine.toggleUnit();
    app.globalData.unit = unit;
    wx.setStorageSync('unit_preference', unit);
    this.engine._emit(this.data.smoothAngle, this.data.isTiltWarning);
    this.setData({ unit });
  },

  // 释放 Auto-Hold 锁定
  releaseHold() {
    this.engine.releaseHold();
    this.setData({ holdLatched: false });
  },

  // 记录当前测量值
  recordCurrent() {
    const angleDeg = this.data.smoothAngle;
    const count = storage.addRecord({
      angleDeg,
      unit: this.data.unit,
      note: this.data.holdLatched ? '自动锁定' : (!this.data.started ? '暂停记录' : ''),
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

  _angleToCardinal(angle) {
    let d = angle % 360;
    if (d < 0) d += 360;
    const idx = Math.round(d / 45) % 8;
    const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return labels[idx];
  },

  _buildStatus(isTiltWarning, holdLatched) {
    if (isTiltWarning) return '请尽量贴紧测量面以保证精度';
    if (holdLatched) return '已自动锁定';
    if (this.data.started) return '相对角度';
    return '已暂停 · 单击屏幕继续';
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
