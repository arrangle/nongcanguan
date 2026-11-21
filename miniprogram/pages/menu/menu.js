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
    windows: [],
    activeId: '',
    activeName: '',
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
    if (this.all) this.loadSummary();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [menu, summary] = await Promise.all([api.getMenu(), api.getSummary()]);
      this.summary = summary;
      this.all = [];
      (menu.windows || []).forEach((w) => {
        (w.dishes || []).forEach((d) => this.all.push(Object.assign({}, d, { window: w })));
      });
      const first = (menu.windows || [])[0];
      this.menu = menu;
      this.setData({
        windows: menu.windows || [],
        activeId: this.data.activeId || (first ? first.id : ''),
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

  onWindow(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ activeId: id }, () => this.render());
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
    const index = Number(e.detail.value);
    this.setData({ sortIndex: index }, () => this.render());
  },

  render() {
    const all = this.all || [];
    const activeWindow = (this.menu ? this.menu.windows : []).find((w) => w.id === this.data.activeId);
    const ratings = (this.summary && this.summary.ratings) || {};
    const query = (this.data.query || '').trim().toLowerCase();

    let items = query
      ? all.slice()
      : all.filter((d) => d.window.id === this.data.activeId);

    if (query) {
      items = items.filter((d) => {
        const haystack = [d.name, d.description, (d.labels || []).join(''), d.window.name, d.window.number]
          .join('')
          .toLowerCase();
        return haystack.includes(query);
      });
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
        labels: (d.labels || []).slice(0, 3),
        source: d.source,
        windowNumber: d.window.number,
        windowName: d.window.name,
        rating: stat ? Number(stat.rating).toFixed(1) : '',
        reviewCount: stat ? stat.reviewCount : 0,
      };
    });

    const head = query
      ? `在 ${all.length} 道菜中找到 ${dishes.length} 道`
      : `${activeWindow ? activeWindow.number + ' 号窗口' : ''} · ${dishes.length} 道菜 · 营养按每 100g`;
    this.setData({ dishes, resultText: head });
  },

  openDish(e) {
    wx.navigateTo({ url: '/pages/dish/dish?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return { title: '农餐馆 · 农大食堂菜单与营养', path: '/pages/menu/menu' };
  },
});
