/**
 * utils/storage.js
 * 海量测量记录：本地离线存储 + 1000 条 FIFO 自动循环清理 + CSV 导出
 */
const STORAGE_KEY = 'measure_records';
const MAX_RECORDS = 1000;

function getRecords() {
  return wx.getStorageSync(STORAGE_KEY) || [];
}

function saveRecords(records) {
  wx.setStorageSync(STORAGE_KEY, records);
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatTime(ts) {
  const d = new Date(ts);
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) +
    ':' + pad(d.getMinutes()) +
    ':' + pad(d.getSeconds())
  );
}

/**
 * 保存一条记录（插入头部，超出 1000 自动剔除尾部最旧）
 * @param {{angleDeg:number, unit:string, note?:string}} rec
 * @returns {number} 保存后的总条数
 */
function addRecord(rec) {
  const ts = Date.now();
  const angleDeg = rec.angleDeg;
  const newRecord = {
    id: 'rec_' + ts + '_' + Math.floor(Math.random() * 1000),
    timestamp: ts,
    formattedTime: formatTime(ts),
    angleDeg: Number(angleDeg.toFixed(1)),
    angleRad: Number((angleDeg * Math.PI / 180).toFixed(3)),
    unit: rec.unit || 'deg',
    note: rec.note || '',
  };

  let records = getRecords();
  records.unshift(newRecord);
  if (records.length > MAX_RECORDS) {
    records = records.slice(0, MAX_RECORDS);
  }
  saveRecords(records);
  return records.length;
}

function removeRecord(id) {
  let records = getRecords();
  records = records.filter((r) => r.id !== id);
  saveRecords(records);
  return records.length;
}

function clearAll() {
  wx.removeStorageSync(STORAGE_KEY);
  return 0;
}

function getCount() {
  return getRecords().length;
}

/**
 * 生成 CSV 文本（带 BOM 头，Excel 打开中文不乱码）
 */
function toCSV(records) {
  const header = '序号,时间,角度(°),角度(rad),单位,备注';
  const lines = records.map((r, i) => {
    const note = (r.note || '').replace(/,/g, '，'); // 逗号转全角，避免破坏列
    return [i + 1, r.formattedTime, r.angleDeg, r.angleRad, r.unit, note].join(',');
  });
  return '﻿' + [header].concat(lines).join('\r\n');
}

/**
 * 导出 CSV：写入临时文件并复制到剪贴板（最稳妥的跨端方案）
 * @returns {Promise<{filePath:string, csv:string}>}
 */
function exportCSV() {
  const records = getRecords();
  const csv = toCSV(records);
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/measure_records_${Date.now()}.csv`;
    fs.writeFile({
      filePath,
      data: csv,
      encoding: 'utf8',
      success: () => {
        // 同时复制到剪贴板，方便直接粘贴到 Excel / 微信
        wx.setClipboardData({
          data: csv,
          success: () => resolve({ filePath, csv }),
          fail: () => resolve({ filePath, csv }),
        });
      },
      fail: (err) => reject(err),
    });
  });
}

module.exports = {
  STORAGE_KEY,
  MAX_RECORDS,
  getRecords,
  addRecord,
  removeRecord,
  clearAll,
  getCount,
  toCSV,
  exportCSV,
  formatTime,
};
