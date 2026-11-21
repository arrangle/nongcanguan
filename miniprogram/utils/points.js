const KEY = 'nongcanguan-points';

function get() {
  const value = wx.getStorageSync(KEY);
  return typeof value === 'number' ? value : 0;
}

function add(count) {
  const next = get() + (count || 1);
  wx.setStorageSync(KEY, next);
  return next;
}

function recentMeals() {
  const list = wx.getStorageSync('nongcanguan-recent-meals') || [];
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return list.filter((item) => item && item.id && item.ts >= cutoff);
}

function rememberMeal(dishes) {
  const ids = dishes.map((d) => d.id);
  const merged = recentMeals().filter((item) => !ids.includes(item.id));
  ids.forEach((id) => merged.push({ id, ts: Date.now() }));
  wx.setStorageSync('nongcanguan-recent-meals', merged.slice(-60));
}

module.exports = { get, add, recentMeals, rememberMeal };
