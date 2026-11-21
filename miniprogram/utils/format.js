function nutrition(dish, factor) {
  const ratio = ((dish.serving || 250) * factor) / 100;
  return {
    kcal: Math.round(dish.kcal * ratio),
    protein: (dish.protein * ratio).toFixed(1),
    fat: (dish.fat * ratio).toFixed(1),
    carbs: (dish.carbs * ratio).toFixed(1),
    fiber: (dish.fiber * ratio).toFixed(1),
    grams: Math.round((dish.serving || 250) * factor),
  };
}

function relTime(ts) {
  if (!ts) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  return Math.floor(hours / 24) + ' 天前';
}

function level(queue) {
  if (!queue) return { cls: 'none', text: '暂无数据' };
  if (queue.stale) return { cls: 'stale', text: '待更新' };
  if (queue.waitMin <= 3) return { cls: 'low', text: '人少' };
  if (queue.waitMin <= 8) return { cls: 'mid', text: '适中' };
  return { cls: 'high', text: '排队中' };
}

function priceText(dish) {
  if (dish.price === null || dish.price === undefined) return '窗口时价';
  return '¥' + dish.price + (dish.unit || '');
}

function stars(rating) {
  const filled = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
}

// 粗估碳排（kg CO₂e / 100g），按食材类型给保守系数，仅用于展示参考
const CARBON_PER_100G = { meat: 0.55, egg: 0.25, rice: 0.12, noodles: 0.1, leaf: 0.05, bowl: 0.12 };

function carbon(dish, factor) {
  const per100 = CARBON_PER_100G[dish.icon] || 0.12;
  const grams = (dish.serving || 250) * (factor || 1);
  return Math.round((grams / 100) * per100 * 100) / 100;
}

module.exports = { nutrition, relTime, level, priceText, stars, carbon };
