const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    dish: null,
    window: null,
    queue: null,
    factor: 1,
    nut: null,
    per100: null,
    reviews: [],
    stats: { rating: null, reviewCount: 0 },
    stars: 0,
    starList: [1, 2, 3, 4, 5],
    text: '',
    nickname: '',
    submitting: false,
  },

  onLoad(options) {
    this.id = options.id;
    this.setData({ nickname: wx.getStorageSync('nickname') || '' });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.getDish(this.id);
      this.dish = data.dish;
      const lv = fmt.level(data.queue);
      this.setData({
        dish: Object.assign({}, data.dish, { priceText: fmt.priceText(data.dish) }),
        window: data.window,
        queue: data.queue
          ? Object.assign({}, data.queue, { state: lv.text, stateCls: lv.cls, ageText: fmt.relTime(data.queue.updatedAt) })
          : null,
        stats: data.stats,
        reviews: this.mapReviews(data.reviews),
        per100: {
          kcal: Math.round(data.dish.kcal),
          protein: Number(data.dish.protein).toFixed(1),
          fat: Number(data.dish.fat).toFixed(1),
          carbs: Number(data.dish.carbs).toFixed(1),
          fiber: Number(data.dish.fiber).toFixed(1),
        },
        nut: fmt.nutrition(data.dish, this.data.factor),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  mapReviews(list) {
    return (list || []).map((r) =>
      Object.assign({}, r, {
        stars: fmt.stars(r.rating),
        time: fmt.relTime(r.ts),
        author: r.author || '匿名同学',
      })
    );
  },

  setFactor(e) {
    const factor = Number(e.currentTarget.dataset.factor);
    this.setData({ factor, nut: fmt.nutrition(this.dish, factor) });
  },

  onStar(e) {
    this.setData({ stars: Number(e.currentTarget.dataset.n) });
  },

  onText(e) {
    this.setData({ text: e.detail.value });
  },

  onNick(e) {
    this.setData({ nickname: e.detail.value });
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
    if (!this.data.stars) {
      wx.showToast({ title: '先点一下星星打分', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const data = await api.postReview(this.id, {
        rating: this.data.stars,
        text: this.data.text,
        author: this.data.nickname,
        deviceId: this.deviceId(),
      });
      if (this.data.nickname) wx.setStorageSync('nickname', this.data.nickname);
      this.setData({
        stats: data.stats,
        reviews: this.mapReviews(data.reviews),
        stars: 0,
        text: '',
        submitting: false,
      });
      wx.showToast({ title: '点评已发布', icon: 'success' });
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '发布失败', icon: 'none' });
    }
  },

  goQueue() {
    wx.switchTab({ url: '/pages/queue/queue' });
  },

  onShareAppMessage() {
    return {
      title: this.data.dish ? this.data.dish.name + ' · 食刻' : '食刻 · 农大食堂',
      path: '/pages/dish/dish?id=' + this.id,
    };
  },
});
