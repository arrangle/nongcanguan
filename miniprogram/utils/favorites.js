const KEY = 'nongcanguan-favorites';

function list() {
  const value = wx.getStorageSync(KEY);
  return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
}

function has(id) {
  return list().some((item) => item.id === id);
}

function toggle(dish) {
  if (!dish || !dish.id) return false;
  const items = list();
  const index = items.findIndex((item) => item.id === dish.id);
  if (index > -1) {
    items.splice(index, 1);
    wx.setStorageSync(KEY, items);
    return false;
  }
  const win = dish.window || {};
  items.unshift({
    id: dish.id,
    name: dish.name,
    windowNumber: dish.windowNumber || win.number || '',
    windowName: dish.windowName || win.name || '',
    kcal: Math.round(dish.kcal || 0),
    protein: Number(dish.protein || 0).toFixed(1),
    ts: Date.now(),
  });
  wx.setStorageSync(KEY, items.slice(0, 80));
  return true;
}

function remove(id) {
  wx.setStorageSync(KEY, list().filter((item) => item.id !== id));
}

function clear() {
  wx.removeStorageSync(KEY);
}

module.exports = { list, has, toggle, remove, clear };
