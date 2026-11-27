const api = require('../../utils/api');
const fmt = require('../../utils/format');
const points = require('../../utils/points');
const log = require('../../utils/meal-log');
const favorites = require('../../utils/favorites');

Page({
  data: {
    points: 0,
    apiBase: '',
    trayCount: 0,
    trayKcal: 0,
    todayKcal: 0,
    todayMeals: 0,
    logRows: [],
    hint: { empty: true, text: '' },
    favorites: [],
    logging: false,
  },

  onShow() {
    this.setData({ points: points.get(), apiBase: api.base() });
    this.loadMenu();
    this.refresh();
  },

  async loadMenu() {
    if (this.menu) return;
    try {
      const menu = await api.getMenu();
      this.menu = menu;
      this.allDishes = [];
      (menu.windows || []).forEach((w) => {
        (w.dishes || []).forEach((d) => this.allDishes.push(Object.assign({}, d, { window: w })));
      });
    } catch (err) {
      this.menuError = err.message || '菜单加载失败';
    }
  },

  refresh() {
    const rows = log.list();
    const today = log.dayKey(new Date());
    const todayRows = rows.filter((row) => row.date === today);

    const tray = wx.getStorageSync('tray') || [];
    const all = this.allDishes || [];
    let trayKcal = 0;
    let trayCount = 0;
    tray.forEach((item) => {
      const dish = all.find((d) => d.id === item.id);
      if (!dish) return;
      const nut = fmt.nutrition(dish, item.factor || 1);
      trayKcal += nut.kcal * (item.qty || 1);
      trayCount += item.qty || 1;
    });

    this.setData({
      logRows: log.table(rows, 7),
      hint: log.hint(rows),
      todayKcal: Math.round(todayRows.reduce((sum, row) => sum + row.kcal, 0)),
      todayMeals: todayRows.length,
      trayCount,
      trayKcal: Math.round(trayKcal),
      favorites: favorites.list(),
    });
  },

  async onLogMeal() {
    if (this.data.logging) return;
    const tray = wx.getStorageSync('tray') || [];
    if (!tray.length) {
      wx.showToast({ title: '餐盘还是空的，先去加两道菜', icon: 'none' });
      return;
    }
    await this.loadMenu();
    if (this.menuError) {
      wx.showToast({ title: this.menuError, icon: 'none' });
      return;
    }

    this.setData({ logging: true });
    const all = this.allDishes || [];
    const items = [];
    let kcal = 0;
    let protein = 0;
    let vegCount = 0;

    tray.forEach((item) => {
      const dish = all.find((d) => d.id === item.id);
      if (!dish) return;
      const qty = item.qty || 1;
      const nut = fmt.nutrition(dish, item.factor || 1);
      kcal += nut.kcal * qty;
      protein += parseFloat(nut.protein) * qty;
      const labels = dish.labels || [];
      if (labels.indexOf('素食') > -1 || dish.icon === 'leaf') vegCount += 1;
      items.push(dish.name + (qty > 1 ? ' ×' + qty : ''));
    });

    if (!items.length) {
      this.setData({ logging: false });
      wx.showToast({ title: '菜品还没加载完，稍后再试', icon: 'none' });
      return;
    }

    const slot = log.slotNow();
    log.add({
      date: log.dayKey(new Date()),
      slot,
      kcal: Math.round(kcal),
      protein,
      vegCount,
      items,
    });
    points.add(1);
    this.setData({ logging: false, points: points.get() });
    this.refresh();
    wx.showToast({ title: log.slotLabel(slot) + '已记下 +1 积分', icon: 'success' });
  },

  onClearLog() {
    wx.showModal({
      title: '清空饮食记录',
      content: '只会清空这台手机上的记录，不影响其他人和服务器。',
      success: (res) => {
        if (!res.confirm) return;
        log.clear();
        this.refresh();
        wx.showToast({ title: '记录已清空', icon: 'none' });
      },
    });
  },

  onClearFav() {
    if (!this.data.favorites.length) return;
    wx.showModal({
      title: '清空收藏',
      content: '确定取消全部收藏吗？',
      success: (res) => {
        if (!res.confirm) return;
        favorites.clear();
        this.refresh();
        wx.showToast({ title: '收藏已清空', icon: 'none' });
      },
    });
  },

  onRemoveFav(e) {
    favorites.remove(e.currentTarget.dataset.id);
    this.refresh();
    wx.showToast({ title: '已取消收藏', icon: 'none' });
  },

  openDish(e) {
    wx.navigateTo({ url: '/pages/dish/dish?id=' + e.currentTarget.dataset.id });
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  onConfig() {
    const that = this;
    wx.showModal({
      title: '服务器地址',
      editable: true,
      placeholderText: 'http://192.168.1.10:3000',
      content: api.base(),
      success(res) {
        if (!res.confirm) return;
        const value = String(res.content || '').trim();
        if (!value) return;
        getApp().setApiBase(value);
        that.menu = null;
        that.allDishes = null;
        that.setData({ apiBase: api.base() });
        that.loadMenu().then(() => that.refresh());
      },
    });
  },

  onShareAppMessage() {
    return { title: '农餐馆 · 今天吃什么', path: '/pages/index/index' };
  },
});
