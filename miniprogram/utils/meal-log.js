/* 个人饮食记录：只存在本机，不上传 */
const KEY = 'nongcanguan-meal-log';

const SLOTS = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
];

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dayKey(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function dayLabel(date) {
  return date.getMonth() + 1 + '月' + date.getDate() + '日 · 周' + WEEK[date.getDay()];
}

function slotNow() {
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'dinner';
}

function slotLabel(key) {
  const found = SLOTS.find((s) => s.key === key);
  return found ? found.label : '这一餐';
}

function list() {
  const value = wx.getStorageSync(KEY);
  return Array.isArray(value) ? value.filter((row) => row && row.date && row.slot) : [];
}

function save(rows) {
  wx.setStorageSync(KEY, rows.slice(-120));
}

function add(row) {
  const rows = list();
  const same = rows.find((item) => item.date === row.date && item.slot === row.slot);
  if (same) {
    same.kcal += row.kcal;
    same.protein += row.protein;
    same.vegCount += row.vegCount;
    same.items = same.items.concat(row.items);
  } else {
    rows.push(row);
  }
  save(rows);
  return rows;
}

function clear() {
  wx.removeStorageSync(KEY);
}

/** 最近 7 天，按日期倒序 */
function recentDays(count) {
  const days = [];
  const today = new Date();
  for (let i = 0; i < (count || 7); i++) {
    days.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
  }
  return days;
}

/** 生成表格行：每天 早 / 中 / 晚 三格 */
function table(rows, count) {
  const source = rows || list();
  return recentDays(count || 7).map((date) => {
    const key = dayKey(date);
    const cells = SLOTS.map((slot) => {
      const row = source.find((item) => item.date === key && item.slot === slot.key);
      return {
        slot: slot.key,
        label: slot.label,
        kcal: row ? Math.round(row.kcal) : 0,
        protein: row ? row.protein.toFixed(0) : '0',
        items: row ? row.items.join(' · ') : '',
        vegCount: row ? row.vegCount : 0,
      };
    });
    return { key, label: dayLabel(date), cells };
  });
}

/** 规则化提醒：蛋白质、蔬菜比例 */
function hint(rows) {
  const source = rows || list();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = source.filter((row) => new Date(row.date + 'T12:00:00').getTime() >= cutoff);
  if (!recent.length) {
    return {
      empty: true,
      text: '还没有饮食记录。在餐盘点「记下这一餐」，这里会按蛋白质和蔬菜给出下一餐的建议。',
    };
  }
  const meals = recent.length;
  const avgProtein = recent.reduce((sum, row) => sum + row.protein, 0) / meals;
  const vegMeals = recent.filter((row) => row.vegCount > 0).length;
  const tips = [];
  if (avgProtein < 25) tips.push('蛋白质偏低，下一餐加一份肉、蛋或豆制品');
  if (vegMeals / meals < 0.6) tips.push('蔬菜偏少，建议每餐至少一份青菜或菌菇');
  if (avgProtein >= 35) tips.push('蛋白质已经很充足，注意主食别过量');
  if (!tips.length) tips.push('蛋白质和蔬菜都还算均衡，保持这个节奏');
  return {
    empty: false,
    meals,
    avgProtein: avgProtein.toFixed(0),
    vegMeals,
    text: '最近 7 天记了 ' + meals + ' 餐，平均蛋白质 ' + avgProtein.toFixed(0) + 'g，' +
      vegMeals + ' 餐有蔬菜。' + tips.join('；') + '。',
  };
}

module.exports = { SLOTS, dayKey, dayLabel, slotNow, slotLabel, list, add, clear, table, hint };
