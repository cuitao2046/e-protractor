// app.js — 全局生命周期、全局数据与隐私授权
App({
  globalData: {
    // 是否已完成隐私授权（iOS 调起运动权限前需先过隐私弹窗）
    privacyAuthorized: false,
    // 当前单位偏好，跨页面共享
    unit: 'deg', // 'deg' | 'rad'
  },

  onLaunch() {
    // 读取本地保存的单位偏好
    const savedUnit = wx.getStorageSync('unit_preference');
    if (savedUnit === 'deg' || savedUnit === 'rad') {
      this.globalData.unit = savedUnit;
    }
    // 启动时处理微信隐私协议（2023 年起强制要求）
    this.handlePrivacy();
  },

  // —— 微信隐私合规：首次进入必须让用户同意隐私协议 ——
  handlePrivacy() {
    if (!wx.getPrivacySetting) return; // 基础库过低则忽略
    wx.getPrivacySetting({
      success: (res) => {
        if (res.needAuthorization) {
          // 调起官方隐私授权弹窗，用户点"同意"后 resolve
          wx.requirePrivacyAuthorize({
            success: () => {
              this.globalData.privacyAuthorized = true;
            },
            fail: () => {
              // 用户拒绝：不阻塞，下次相关 API 仍会触发
              this.globalData.privacyAuthorized = false;
            },
          });
        } else {
          this.globalData.privacyAuthorized = true;
        }
      },
    });
  },
});
