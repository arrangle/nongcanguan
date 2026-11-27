const { BASE_URL } = require('./config');
const DEFAULT_BASE = BASE_URL;

App({
  globalData: {
    apiBase: DEFAULT_BASE,
  },

  onLaunch() {
    const saved = wx.getStorageSync('nongcanguan-api-base');
    if (saved) this.globalData.apiBase = saved;
  },

  setApiBase(base) {
    const value = String(base || '').trim().replace(/\/+$/, '');
    if (!value) return;
    this.globalData.apiBase = value;
    wx.setStorageSync('nongcanguan-api-base', value);
  },
});
