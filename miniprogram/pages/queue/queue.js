const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    updatedText: '',
    modalOpen: false,
    target: '',
    targetName: '',
    people: 5,
    presets: [0, 2, 5, 10, 15, 20],
    submitting: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.getQueues();
      const items = (data.items || []).map((it) => {
        const lv = fmt.level(it.queue);
        return {
          id: it.windowId,
          number: it.number,
          name: it.name,
          state: lv.text,
          stateCls: lv.cls,
          people: it.queue ? it.queue.people : '–',
          wait: it.queue ? '约 ' + it.queue.waitMin + ' 分钟' : '暂无上报',
          age: it.queue
            ? fmt.relTime(it.queue.updatedAt) + '更新' + (it.queue.reportCount > 1 ? ' · ' + it.queue.reportCount + ' 人上报' : '')
            : '点下方按钮，帮同学一把',
          queue: it.queue || null,
        };
      });
      this.setData({
        items,
        loading: false,
        updatedText: '更新于 ' + fmt.relTime(data.updatedAt || Date.now()),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  openReport(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find((x) => x.id === id);
    if (!item) return;
    this.setData({
      modalOpen: true,
      target: id,
      targetName: item.number + ' 号 · ' + item.name,
      people: item.queue && !item.queue.stale ? item.queue.people : 5,
    });
  },

  closeReport() {
    this.setData({ modalOpen: false });
  },

  noop() {},

  step(e) {
    const delta = Number(e.currentTarget.dataset.d);
    this.setData({ people: Math.max(0, Math.min(30, this.data.people + delta)) });
  },

  preset(e) {
    this.setData({ people: Number(e.currentTarget.dataset.n) });
  },

  deviceId() {
    let id = wx.getStorageSync('deviceId');
    if (!id) {
      id = 'wx-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      wx.setStorageSync('deviceId', id);
    }
    return id;
  },

  async submit() {
    if (!this.data.target || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await api.postQueue({
        windowId: this.data.target,
        people: this.data.people,
        deviceId: this.deviceId(),
      });
      this.setData({ modalOpen: false, submitting: false });
      wx.showToast({ title: '上报成功，谢谢帮忙', icon: 'success' });
      this.load();
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '上报失败', icon: 'none' });
    }
  },

  refresh() {
    this.load();
    wx.showToast({ title: '已刷新', icon: 'none' });
  },

  onShareAppMessage() {
    return { title: '食刻 · 看看哪个窗口没人排队', path: '/pages/queue/queue' };
  },
});
