const api = require('../../utils/api');
const fmt = require('../../utils/format');

const FILTERS = [
  { key: 'all', label: '全部菜品', test: () => true },
  { key: 'light', label: '轻盈低脂', test: (d) => d.kcal <= 120 && d.fat <= 7 },
  { key: 'protein', label: '高蛋白', test: (d) => d.protein >= 9.5 },
  { key: 'veg', label: '清爽素食', test: (d) => (d.labels || []).includes('素食') },
  { key: 'staple', label: '主食面点', test: (d) => (d.labels || []).includes('主食') },
];

const SORTS = [
  { key: 'default', label: '窗口顺序' },
  { key: 'kcal', label: '热量从低到高' },
  { key: 'protein', label: '蛋白质优先' },
  { key: 'price', label: '价格从低到高' },
];

Page({
  data: {
    loading: true,
    error: '',
    canteens: [],
    activeCanteen: '',
    canteenLabel: '',
    windows: [],
    visibleWindows: [],
    activeId: '',
    query: '',
    filter: 'all',
    sortIndex: 0,
    sortLabels: SORTS.map((s) => s.label),
    filters: FILTERS.map((f) => ({ key: f.key, label: f.label })),
    dishes: [],
    resultText: '',
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (this.menu) this.loadSummary();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const menu = await api.getMenu();
      const summary = await api.getSummary();
      this.summary = summary;
      this.menu = menu;
      this.all = [];
      (menu.windows || []).forEach((w) => {
        (w.dishes || []).forEach((d) => this.all.push(Object.assign({}, d, { window: w })));
      });

      const canteens = menu.canteens || [];
      const online = canteens.filter((c) => c.status === 'online');
      const active = online.length ? online[0].id : (canteens[0] ? canteens[0].id : '');
      const canteen = canteens.find((c) => c.id === active);
      const firstWindow = (menu.windows || []).find((w) => w.canteenId === active);

      this.setData({
        canteens,
        activeCanteen: active,
        canteenLabel: canteen ? (canteen.alias || canteen.name) : '',
        windows: menu.windows || [],
        activeId: firstWindow ? firstWindow.id : '',
        loading: false,
      });
      this.render();
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  async loadSummary() {
    try {
      this.summary = await api.getSummary();
      this.render();
    } catch (err) {
      // 评分刷新失败不影响列表
    }
  },

  onCanteen(e) {
    const id = e.currentTarget.dataset.id;
    const canteen = (this.data.canteens || []).find((c) => c.id === id);
    if (!canteen) return;
    if (canteen.status !== 'online') {
      wx.showToast({ title: canteen.name + '菜单待录入', icon: 'none' });
      return;
    }
    const first = (this.data.windows || []).find((w) => w.canteenId === id);
    this.setData({
      activeCanteen: id,
      canteenLabel: canteen.alias || canteen.name,
      activeId: first ? first.id : '',
      query: '',
    }, () => this.render());
  },

  onWindow(e) {
    this.setData({ activeId: e.currentTarget.dataset.id }, () => this.render());
  },

  onSearch(e) {
    this.setData({ query: e.detail.value || '' });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.render(), 260);
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key }, () => this.render());
  },

  onSort(e) {
    this.setData({ sortIndex: Number(e.detail.value) }, () => this.render());
  },

  render() {
    const canteenId = this.data.activeCanteen;
    const visibleWindows = (this.data.windows || []).filter((w) => w.canteenId === canteenId);
    let activeId = this.data.activeId;
    if (!visibleWindows.some((w) => w.id === activeId)) {
      activeId = visibleWindows.length ? visibleWindows[0].id : '';
    }
    const activeWindow = visibleWindows.find((w) => w.id === activeId);
    const ratings = (this.summary && this.summary.ratings) || {};
    const query = (this.data.query || '').trim().toLowerCase();

    let items = (this.all || []).filter((d) => d.window.canteenId === canteenId);
    if (query) {
      items = items.filter((d) => {
        const haystack = [d.name, d.description, (d.labels || []).join(''), d.window.name, d.window.number]
          .join('')
          .toLowerCase();
        return haystack.includes(query);
      });
    } else {
      items = items.filter((d) => d.window.id === activeId);
    }

    const filterDef = FILTERS.find((f) => f.key === this.data.filter) || FILTERS[0];
    items = items.filter(filterDef.test);

    const sortKey = (SORTS[this.data.sortIndex] || SORTS[0]).key;
    if (sortKey === 'kcal') items.sort((a, b) => a.kcal - b.kcal);
    else if (sortKey === 'protein') items.sort((a, b) => b.protein - a.protein);
    else if (sortKey === 'price') {
      items.sort((a, b) => (a.price === null ? Infinity : a.price) - (b.price === null ? Infinity : b.price));
    }

    const dishes = items.slice(0, 120).map((d) => {
      const stat = ratings[d.id];
      return {
        id: d.id,
        name: d.name,
        priceText: fmt.priceText(d),
        kcal: Math.round(d.kcal),
        protein: Number(d.protein).toFixed(1),
        fat: Number(d.fat).toFixed(1),
        carbon: fmt.carbon(d, 1).toFixed(2),
        labels: (d.labels || []).slice(0, 3),
        source: d.source,
        windowNumber: d.window.number,
        windowName: d.window.name,
        rating: stat ? Number(stat.rating).toFixed(1) : '',
        reviewCount: stat ? stat.reviewCount : 0,
      };
    });

    let head;
    if (!visibleWindows.length) head = '该食堂菜单待录入';
    else if (query) head = `在 ${items.length} 道菜中找到 ${dishes.length} 道`;
    else head = `${activeWindow ? activeWindow.number + ' 号窗口' : ''} · ${dishes.length} 道菜 · 每 100g`;

    this.setData({ dishes, resultText: head, activeId, visibleWindows });
  },

  backToGong1() {
    const online = (this.data.canteens || []).find((c) => c.status === 'online');
    if (!online) return;
    const first = (this.data.windows || []).find((w) => w.canteenId === online.id);
    this.setData({
      activeCanteen: online.id,
      canteenLabel: online.alias || online.name,
      activeId: first ? first.id : '',
    }, () => this.render());
  },

  openDish(e) {
    wx.navigateTo({ url: '/pages/dish/dish?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return { title: '农餐馆 · 农大食堂菜单与营养', path: '/pages/menu/menu' };
  },
});
