const api = require('../../utils/api');
const fmt = require('../../utils/format');
const points = require('../../utils/points');
const favorites = require('../../utils/favorites');

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
    fav: false,
    starList: [1, 2, 3, 4, 5],
    text: '',
    nickname: '',
    submitting: false,
  },

  onLoad(options) {
    this.id = options.id;
    this.setData({ nickname: wx.getStorageSync('nickname') || '', fav: favorites.has(options.id) });
    this.load();
  },

  toggleFav() {
    if (!this.data.dish) return;
    const on = favorites.toggle(this.data.dish);
    this.setData({ fav: on });
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  addToTray() {
    if (!this.data.dish) return;
    const tray = wx.getStorageSync('tray') || [];
    const factor = this.data.factor;
    const exist = tray.find((item) => item.id === this.id && item.factor === factor);
    if (exist) exist.qty = (exist.qty || 1) + 1;
    else tray.push({ id: this.id, factor, qty: 1 });
    wx.setStorageSync('tray', tray);
    points.add(1);
    wx.showToast({ title: '已加入餐盘 +1 积分', icon: 'success' });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.getDish(this.id);
      this.dish = data.dish;
      const lv = fmt.level(data.queue);
      const nut = fmt.nutrition(data.dish, this.data.factor);
      nut.carbon = fmt.carbon(data.dish, this.data.factor).toFixed(2);
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
        nut,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  mapReviews(list) {
    const liked = wx.getStorageSync('nongcanguan-liked-reviews') || [];
    return (list || []).map((r) =>
      Object.assign({}, r, {
        stars: fmt.stars(r.rating),
        time: fmt.relTime(r.ts),
        author: r.author || '匿名同学',
        likes: r.likes || 0,
        liked: liked.includes(r.id),
      })
    );
  },

  setFactor(e) {
    const factor = Number(e.currentTarget.dataset.factor);
    const nut = fmt.nutrition(this.dish, factor);
    nut.carbon = fmt.carbon(this.dish, factor).toFixed(2);
    this.setData({ factor, nut });
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

  async like(e) {
    const id = e.currentTarget.dataset.id;
    const review = this.data.reviews.find((r) => r.id === id);
    if (!review || review.liked) return;
    try {
      const res = await api.likeReview(id, this.deviceId());
      const liked = wx.getStorageSync('nongcanguan-liked-reviews') || [];
      if (!liked.includes(id)) {
        liked.push(id);
        wx.setStorageSync('nongcanguan-liked-reviews', liked.slice(-200));
      }
      const reviews = this.data.reviews.map((r) =>
        r.id === id ? Object.assign({}, r, { liked: true, likes: res.likes }) : r
      );
      this.setData({ reviews });
    } catch (err) {
      wx.showToast({ title: err.message || '点赞失败', icon: 'none' });
    }
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
      points.add(2);
      this.setData({
        stats: data.stats,
        reviews: this.mapReviews(data.reviews),
        stars: 0,
        text: '',
        submitting: false,
      });
      wx.showToast({ title: '点评已发布 +2 积分', icon: 'success' });
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
      title: this.data.dish ? this.data.dish.name + ' · 农餐馆' : '农餐馆 · 农大食堂',
      path: '/pages/dish/dish?id=' + this.id,
    };
  },
});
