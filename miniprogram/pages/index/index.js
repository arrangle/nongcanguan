const api = require('../../utils/api');
const fmt = require('../../utils/format');
const points = require('../../utils/points');

const GOALS = [
  { key: 'balanced', label: '均衡搭配', plan: ['protein', 'staple', 'veg'] },
  { key: 'protein', label: '健身高蛋白', plan: ['protein', 'protein', 'veg'] },
  { key: 'light', label: '减脂轻盈', plan: ['veg', 'protein', 'veg'] },
  { key: 'veg', label: '清爽素食', plan: ['veg', 'veg', 'staple'] },
];

function categoryOf(dish) {
  const labels = dish.labels || [];
  if (labels.includes('汤')) return 'soup';
  if (labels.includes('主食') || dish.icon === 'rice' || dish.icon === 'noodles') return 'staple';
  if (labels.includes('素食') || dish.icon === 'leaf') return 'veg';
  if (labels.includes('高蛋白') || dish.icon === 'meat' || dish.icon === 'egg') return 'protein';
  return 'other';
}

Page({
  data: {
    loading: true,
    error: '',
    apiBase: '',
    menu: { windows: [], canteens: [] },
    canteens: [],
    activeCanteen: '',
    canteenLabel: '',
    dishTotal: 0,
    queues: [],
    goals: GOALS.map((g) => ({ key: g.key, label: g.label })),
    goal: 'balanced',
    meal: [],
    mealTotals: { kcal: 0, protein: '0', carbon: '0' },
    trayCount: 0,
    trayKcal: 0,
    points: 0,
    leaderboard: [],
    recentHint: '',
  },

  onShow() {
    this.setData({ apiBase: api.base(), points: points.get() });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const menu = await api.getMenu();
      const summary = await api.getSummary();
      const board = await api.getLeaderboard('rating').catch(() => ({ items: [] }));

      this.menu = menu;
      this.summary = summary;

      const canteens = menu.canteens || [];
      const online = canteens.filter((c) => c.status === 'online');
      let active = this.data.activeCanteen;
      if (!canteens.some((c) => c.id === active && c.status === 'online')) {
        active = online.length ? online[0].id : (canteens[0] ? canteens[0].id : '');
      }
      const activeCanteen = canteens.find((c) => c.id === active);

      this.allDishes = [];
      (menu.windows || []).forEach((w) => {
        (w.dishes || []).forEach((d) => this.allDishes.push(Object.assign({}, d, { window: w })));
      });

      this.setData({
        menu,
        canteens,
        activeCanteen: active,
        canteenLabel: activeCanteen ? (activeCanteen.alias || activeCanteen.name) : '',
        dishTotal: this.allDishes.filter((d) => d.window.canteenId === active).length,
        loading: false,
        leaderboard: (board.items || []).slice(0, 5).map((d) => ({
          id: d.id,
          name: d.name,
          rating: Number(d.rating).toFixed(1),
          reviewCount: d.reviewCount,
          windowNumber: d.windowNumber,
        })),
      });

      this.mealRaw = null;
      this.renderQueues();
      this.renderMeal();
      this.refreshTray(false);
      this.setData({ points: points.get() });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  activeCanteenDishes() {
    return (this.allDishes || []).filter((d) => d.window.canteenId === this.data.activeCanteen);
  },

  renderQueues() {
    const queues = (this.summary && this.summary.queues) || {};
    const items = (this.menu.windows || [])
      .filter((w) => w.canteenId === this.data.activeCanteen)
      .map((w) => {
        const q = queues[w.id];
        const lv = fmt.level(q);
        return {
          id: w.id,
          number: w.number,
          name: w.name,
          state: lv.text,
          stateCls: lv.cls,
          people: q ? q.people : '–',
          wait: q ? '约 ' + q.waitMin + ' 分钟' : '暂无上报',
          age: q ? fmt.relTime(q.updatedAt) + '更新' : '还没有人上报',
          waitMin: q ? q.waitMin : 9999,
        };
      })
      .sort((a, b) => a.waitMin - b.waitMin)
      .slice(0, 3);
    this.setData({ queues: items });
  },

  onCanteen(e) {
    const id = e.currentTarget.dataset.id;
    const canteen = (this.data.canteens || []).find((c) => c.id === id);
    if (!canteen) return;
    if (canteen.status !== 'online') {
      wx.showToast({ title: canteen.name + '菜单待录入', icon: 'none' });
      return;
    }
    this.setData({ activeCanteen: id, canteenLabel: canteen.alias || canteen.name }, () => {
      this.mealRaw = null;
      this.renderQueues();
      this.renderMeal();
    });
  },

  scoreFor(dish, goal, recentIds) {
    let score = 0;
    if (goal === 'protein') score += (dish.protein || 0) * 3;
    if (goal === 'light') score += Math.max(0, 200 - dish.kcal) * 0.03 + Math.max(0, 8 - dish.fat) * 2;
    if (goal === 'veg') score += (dish.labels || []).includes('素食') ? 8 : 0;
    if (goal === 'balanced') score += (dish.protein || 0) * 1.2 + (dish.fiber || 0) * 2;
    const queues = (this.summary && this.summary.queues) || {};
    const q = queues[dish.window.id];
    if (q && !q.stale) score -= q.waitMin * 1.5;
    if (recentIds.includes(dish.id)) score -= 25;
    return score;
  },

  pickMeal() {
    const all = this.activeCanteenDishes();
    if (!all.length) return [];
    const goal = this.data.goal;
    const def = GOALS.find((g) => g.key === goal) || GOALS[0];
    const recentIds = points.recentMeals().map((x) => x.id);
    const chosen = {};
    const meal = [];
    def.plan.forEach((category) => {
      let pool = all.filter((d) => !chosen[d.id] && categoryOf(d) === category);
      if (!pool.length) pool = all.filter((d) => !chosen[d.id]);
      if (!pool.length) return;
      const ranked = pool
        .map((d) => ({ d, score: this.scoreFor(d, goal, recentIds) + Math.random() * 3 }))
        .sort((a, b) => b.score - a.score);
      const pick = ranked[Math.floor(Math.random() * Math.min(4, ranked.length))].d;
      chosen[pick.id] = true;
      meal.push(pick);
    });
    return meal;
  },

  renderMeal() {
    if (!this.mealRaw) this.mealRaw = this.pickMeal();
    let kcal = 0;
    let protein = 0;
    let carbon = 0;
    const items = this.mealRaw.map((d) => {
      const n = fmt.nutrition(d, 1);
      kcal += n.kcal;
      protein += parseFloat(n.protein);
      carbon += fmt.carbon(d, 1);
      return {
        id: d.id,
        name: d.name,
        windowNumber: d.window.number,
        windowName: d.window.name,
        kcal: n.kcal,
        proteinText: n.protein,
      };
    });
    const recentIds = points.recentMeals().map((x) => x.id);
    this.setData({
      meal: items,
      mealTotals: {
        kcal: Math.round(kcal),
        protein: protein.toFixed(0),
        carbon: carbon.toFixed(1),
      },
      recentHint: recentIds.length ? '已优先避开最近吃过的 ' + recentIds.length + ' 道菜' : '',
    });
  },

  reroll() {
    this.mealRaw = null;
    this.renderMeal();
  },

  onGoal(e) {
    this.setData({ goal: e.currentTarget.dataset.key }, () => {
      this.mealRaw = null;
      this.renderMeal();
    });
  },

  openDish(e) {
    wx.navigateTo({ url: '/pages/dish/dish?id=' + e.currentTarget.dataset.id });
  },

  goQueue() {
    wx.switchTab({ url: '/pages/queue/queue' });
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  addMeal() {
    if (!this.mealRaw || !this.mealRaw.length) return;
    const tray = wx.getStorageSync('tray') || [];
    this.mealRaw.forEach((d) => {
      const exist = tray.find((x) => x.id === d.id);
      if (exist) exist.qty = (exist.qty || 1) + 1;
      else tray.push({ id: d.id, factor: 1, qty: 1 });
    });
    wx.setStorageSync('tray', tray);
    points.rememberMeal(this.mealRaw);
    points.add(1);
    this.setData({ points: points.get() });
    this.refreshTray(true);
    this.renderMeal();
  },

  refreshTray(notify) {
    const tray = wx.getStorageSync('tray') || [];
    const all = this.allDishes || [];
    let kcal = 0;
    let count = 0;
    tray.forEach((item) => {
      const dish = all.find((d) => d.id === item.id);
      if (!dish) return;
      const n = fmt.nutrition(dish, item.factor || 1);
      kcal += n.kcal * (item.qty || 1);
      count += item.qty || 1;
    });
    this.setData({ trayCount: count, trayKcal: Math.round(kcal) });
    if (notify) wx.showToast({ title: '已加入今日餐盘 +1 积分', icon: 'success' });
  },

  clearTray() {
    wx.removeStorageSync('tray');
    this.setData({ trayCount: 0, trayKcal: 0 });
    wx.showToast({ title: '餐盘已清空', icon: 'none' });
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
        that.setData({ apiBase: api.base() });
        that.load();
      },
    });
  },

  onShareAppMessage() {
    return { title: '农餐馆 · 今天吃什么', path: '/pages/index/index' };
  },
});
