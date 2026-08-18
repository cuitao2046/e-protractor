// app.js — 指南针应用全局生命周期与隐私授权
App({
  globalData: {
    privacyAuthorized: false,
  },

  onLaunch() {
    this.handlePrivacy();
  },

  handlePrivacy() {
    if (!wx.getPrivacySetting) return;
    wx.getPrivacySetting({
      success: (res) => {
        if (res.needAuthorization) {
          wx.requirePrivacyAuthorize({
            success: () => { this.globalData.privacyAuthorized = true; },
            fail: () => { this.globalData.privacyAuthorized = false; },
          });
        } else {
          this.globalData.privacyAuthorized = true;
        }
      },
    });
  },
});
