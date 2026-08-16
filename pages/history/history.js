// pages/history/history.js
const storage = require('../../utils/storage.js');

Page({
  data: {
    records: [],
    count: 0,
    max: 1000,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const records = storage.getRecords();
    this.setData({ records, count: records.length, max: storage.MAX_RECORDS });
  },

  // 单条删除
  onDelete(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除该记录',
      content: '确定删除这条测量记录吗？',
      success: (res) => {
        if (res.confirm) {
          const count = storage.removeRecord(id);
          this.setData({ count });
          this.refresh();
        }
      },
    });
  },

  // 清空全部
  onClear() {
    if (this.data.count === 0) {
      wx.showToast({ title: '暂无记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清空全部记录',
      content: '将删除全部 ' + this.data.count + ' 条记录，且不可恢复。',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          storage.clearAll();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      },
    });
  },

  // 导出 CSV（写入文件 + 复制到剪贴板）
  onExport() {
    if (this.data.count === 0) {
      wx.showToast({ title: '暂无记录可导出', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '导出中...' });
    storage
      .exportCSV()
      .then(() => {
        wx.hideLoading();
        wx.showModal({
          title: '导出成功',
          content: 'CSV 已生成并复制到剪贴板，可粘贴到 Excel / 微信发送给电脑。',
          showCancel: false,
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '导出失败', icon: 'none' });
      });
  },
});
