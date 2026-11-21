const DEFAULT_BASE = 'http://localhost:3000';

App({
  globalData: {
    apiBase: DEFAULT_BASE,
  },

  onLaunch() {
    const saved = wx.getStorageSync('apiBase');
    if (saved) this.globalData.apiBase = saved;
  },

  setApiBase(base) {
    const value = String(base || '').trim().replace(/\/+$/, '');
    if (!value) return;
    this.globalData.apiBase = value;
    wx.setStorageSync('apiBase', value);
  },
});
