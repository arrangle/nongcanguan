/* 农餐馆 · 页面外壳
 * 入口画面 / 左侧导航 / 窗口条排队角标 / 菜品收藏 / 个人饮食记录 / 排行榜
 * 不改动 app.js 与 features.js 的既有职责，只做外壳与页面切换。
 */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);
  const toast = (message) => { if (typeof showToast === 'function') showToast(message); };

  const ENTRY_KEY = 'cau-entered';
  const FAV_KEY = 'cau-fav-dishes';
  const LOG_KEY = 'cau-meal-log';
  const SLOTS = [
    { key: 'breakfast', label: '早餐' },
    { key: 'lunch', label: '午餐' },
    { key: 'dinner', label: '晚餐' }
  ];

  // ------------------------------------------------------------------ 入口
  function enterApp(page) {
    const entry = $('#entryScreen');
    const app = $('#app');
    if (entry) entry.hidden = true;
    if (app) app.hidden = false;
    try { sessionStorage.setItem(ENTRY_KEY, '1'); } catch (_) {}
    setPage(page || 'windows');
    window.scrollTo(0, 0);
  }

  function showEntry() {
    const entry = $('#entryScreen');
    const app = $('#app');
    if (entry) entry.hidden = false;
    if (app) app.hidden = true;
    try { sessionStorage.removeItem(ENTRY_KEY); } catch (_) {}
  }

  // ------------------------------------------------------------------ 页面切换
  let currentPage = 'windows';

  function setPage(name) {
    const page = $('.page[data-page="' + name + '"]');
    if (!page) return;
    currentPage = name;
    $$('.page[data-page]').forEach((node) => { node.hidden = node.getAttribute('data-page') !== name; });
    $$('.nav-item[data-nav], .side-link[data-nav]').forEach((button) => {
      const active = button.getAttribute('data-nav') === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (name === 'records') renderRecords();
    if (name === 'rank') loadRank();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleNav(name) {
    if (!name) return;
    if (name === 'limited') { toast('限定菜品本周还没开始录入，先在「窗口」看看今天的菜单'); return; }
    if (name === 'mail') { toast('食贸信箱正在对接后勤收件渠道，暂未开放'); return; }
    if (name === 'about') {
      const dialog = $('#dataDialog');
      if (dialog) dialog.showModal();
      return;
    }
    if (name === 'account') { setPage('records'); return; }
    if (name === 'choose') { setPage('choose'); renderCanteenCards(); return; }
    if (name === 'peaks') { setPage('peaks'); renderPeaks(); return; }
    if (name === 'favorites') { setPage('favorites'); renderFavorites(); return; }
    setPage(name);
  }

  // ------------------------------------------------------------------ 窗口条排队角标
  let summary = null;

  function levelOf(queue) {
    if (!queue) return { cls: 'none', text: '暂无上报' };
    if (queue.stale) return { cls: 'stale', text: '待更新' };
    if (queue.waitMin <= 3) return { cls: 'low', text: '人少 · 约 ' + queue.waitMin + ' 分' };
    if (queue.waitMin <= 8) return { cls: 'mid', text: '适中 · 约 ' + queue.waitMin + ' 分' };
    return { cls: 'high', text: '排队中 · 约 ' + queue.waitMin + ' 分' };
  }

  function decorateWindows() {
    if (!summary) return;
    $$('[data-window-queue]').forEach((slot) => {
      const queue = (summary.queues || {})[slot.getAttribute('data-window-queue')] || null;
      const lv = levelOf(queue);
      slot.className = 'window-queue ' + lv.cls;
      slot.textContent = queue && !queue.stale
        ? lv.text + ' · ' + queue.people + ' 人'
        : lv.text;
    });
    const meta = $('#windowQueueMeta');
    if (meta) {
      const queues = summary.queues || {};
      const current = (typeof state !== 'undefined' && state.windowId) ? queues[state.windowId] : null;
      const list = Object.keys(queues).map((id) => queues[id]).filter((q) => q && !q.stale);
      const best = list.sort((a, b) => a.waitMin - b.waitMin)[0];
      let text;
      if (current && !current.stale) text = '当前窗口 ' + current.people + ' 人 · 约 ' + current.waitMin + ' 分钟';
      else if (best) text = '最空 ' + best.people + ' 人 · 约 ' + best.waitMin + ' 分钟';
      else text = '暂无上报 · 点下方「上报排队」帮大家一把';
      meta.textContent = text;
    }
  }
  window.decorateWindows = decorateWindows;

  async function loadSummary() {
    try {
      const response = await fetch('/api/summary', { cache: 'no-store' });
      if (!response.ok) return;
      summary = await response.json();
      decorateWindows();
    } catch (_) { /* 后端未启动时静默 */ }
  }

  // ------------------------------------------------------------------ 选择食堂（二级入口）
  function renderCanteenCards() {
    const host = $('#canteenCards');
    if (!host) return;
    if (typeof canteens === 'undefined' || !Array.isArray(canteens) || !canteens.length) {
      host.innerHTML = '<p class="canteen-loading">正在读取食堂列表…</p>';
      return;
    }
    const groups = [
      { title: '东校区', ids: ['gong1', 'gong2', 'gong3'] },
      { title: '西校区', ids: ['he1', 'he2', 'yi1', 'yi2', 'yi3'] },
    ];
    const byId = {};
    canteens.forEach((c) => { byId[c.id] = c; });
    host.innerHTML = groups.map((group) => {
      const cards = group.ids.filter((id) => byId[id]).map((id) => {
        const c = byId[id];
        const online = c.status === 'online';
        const count = (typeof windows !== 'undefined' && Array.isArray(windows))
          ? windows.filter((w) => w.canteenId === id).length : 0;
        return '<button class="canteen-card' + (online ? '' : ' pending') + '" type="button" data-choose="' + id + '"' + (online ? '' : ' disabled') + '>' +
          '<span class="cc-name">' + esc(c.name) + '</span>' +
          '<span class="cc-alias">' + esc(c.alias || '') + '</span>' +
          '<span class="cc-meta">' + (online ? count + ' 个窗口' : '待录入') + '</span>' +
          '<span class="cc-go">' + (online ? '进入 ›' : '') + '</span>' +
        '</button>';
      }).join('');
      return '<div class="canteen-group"><p class="canteen-group-title">' + group.title + '</p><div class="canteen-grid">' + cards + '</div></div>';
    }).join('');
  }
  window.renderCanteenCards = renderCanteenCards;

  // ------------------------------------------------------------------ 侧栏食堂
  const EAST = ['gong1', 'gong2', 'gong3'];
  const WEST = ['he1', 'he2', 'yi1', 'yi2', 'yi3'];

  function renderCanteenSidebar() {
    if (typeof canteens === 'undefined' || !Array.isArray(canteens) || !canteens.length) return;
    const byId = {};
    canteens.forEach((c) => { byId[c.id] = c; });
    const paint = (hostId, ids) => {
      const host = document.getElementById(hostId);
      if (!host) return;
      const canteenList = (typeof windows === 'undefined' || !Array.isArray(windows)) ? [] : windows;
      host.innerHTML = ids.filter((id) => byId[id]).map((id) => {
        const c = byId[id];
        const online = c.status === 'online';
        const isActive = (typeof state !== 'undefined' && state.canteenId === id);
        let html = '<button class="side-link side-child' + (isActive ? ' active' : '') + (online ? '' : ' pending') + '" type="button" data-canteen="' + id + '">' +
          esc(c.name) + (online ? '<small>已录入</small>' : '<small>待录入</small>') +
        '</button>';
        if (isActive && online) {
          const items = canteenList.filter((w) => w.canteenId === id);
          html += '<div class="side-windows">' + items.map((w) =>
            '<button class="side-window' + (typeof state !== 'undefined' && state.windowId === w.id ? ' active' : '') + '" type="button" data-window="' + w.id + '">' +
              '<span class="sw-num">' + (w.number || '·') + '</span>' +
              '<span class="sw-name">' + esc(w.name) + '</span>' +
              '<span class="sw-count">' + w.dishes.length + '</span>' +
            '</button>'
          ).join('') + '</div>';
        }
        return html;
      }).join('');
    };
    paint('canteenEast', EAST);
    paint('canteenWest', WEST);
  }
  window.renderCanteenSidebar = renderCanteenSidebar;

  // ------------------------------------------------------------------ 收藏
  let favorites = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    if (Array.isArray(saved)) favorites = new Set(saved.filter((id) => typeof id === 'string'));
  } catch (_) { favorites = new Set(); }

  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); } catch (_) {}
  }

  window.isFav = (id) => favorites.has(id);
  window.toggleFav = function (id) {
    if (!id) return;
    const on = !favorites.has(id);
    if (on) favorites.add(id); else favorites.delete(id);
    saveFavorites();
    $$('[data-fav]').forEach((button) => {
      if (button.getAttribute('data-fav') !== id) return;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const dish = (typeof getDish === 'function') ? getDish(id) : null;
    toast(on ? '已收藏「' + (dish ? dish.name : '这道菜') + '」' : '已取消收藏');
  };

  // ------------------------------------------------------------------ 个人饮食记录
  function readLog() {
    try {
      const value = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      return Array.isArray(value) ? value.filter((row) => row && row.date && row.slot) : [];
    } catch (_) { return []; }
  }

  function writeLog(rows) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(rows.slice(-120))); } catch (_) {}
  }

  function slotForNow() {
    const hour = new Date().getHours();
    if (hour < 10) return 'breakfast';
    if (hour < 15) return 'lunch';
    return 'dinner';
  }

  function dayKey(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function logCurrentMeal() {
    if (typeof tray === 'undefined' || !Array.isArray(tray) || !tray.length) {
      toast('餐盘还是空的，先加两道菜再记录');
      return;
    }
    const slot = slotForNow();
    const items = tray.map((item) => {
      const dish = (typeof getDish === 'function') ? getDish(item.dishId) : null;
      if (!dish) return null;
      const ratio = (dish.serving * item.factor) / 100;
      return {
        name: dish.name,
        qty: item.qty,
        kcal: Math.round(dish.kcal * ratio * item.qty),
        protein: dish.protein * ratio * item.qty,
        veg: (dish.labels || []).includes('素食') || dish.icon === 'leaf'
      };
    }).filter(Boolean);
    if (!items.length) { toast('餐盘里的菜还没加载完，稍后再试'); return; }

    const row = {
      date: dayKey(new Date()),
      slot: slot,
      kcal: items.reduce((sum, item) => sum + item.kcal, 0),
      protein: items.reduce((sum, item) => sum + item.protein, 0),
      vegCount: items.filter((item) => item.veg).length,
      items: items.map((item) => item.name + (item.qty > 1 ? ' ×' + item.qty : ''))
    };

    const rows = readLog();
    const same = rows.find((item) => item.date === row.date && item.slot === row.slot);
    if (same) {
      same.kcal += row.kcal;
      same.protein += row.protein;
      same.vegCount += row.vegCount;
      same.items = same.items.concat(row.items);
    } else {
      rows.push(row);
    }
    writeLog(rows);
    const label = (SLOTS.find((s) => s.key === slot) || {}).label || '这一餐';
    toast(label + '已记下，可以在左侧「个人记录」查看');
    if (currentPage === 'records') renderRecords();
  }

  function recentDays(count) {
    const days = [];
    const today = new Date();
    for (let i = 0; i < count; i++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push(date);
    }
    return days;
  }

  function dateLabel(date) {
    const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 · 周' + week;
  }

  function renderRecords() {
    const host = $('#recordsTable');
    if (!host) return;
    const rows = readLog();
    const days = recentDays(7);
    const body = days.map((date) => {
      const key = dayKey(date);
      const cells = SLOTS.map((slot) => {
        const row = rows.find((item) => item.date === key && item.slot === slot.key);
        if (!row) return '<td><span class="meal-empty">—</span></td>';
        return '<td><div class="meal-cell"><b>' + Math.round(row.kcal) + ' kcal</b><span>' +
          esc(row.items.join(' · ')) + '</span><em>蛋白 ' + row.protein.toFixed(0) + 'g</em></div></td>';
      }).join('');
      return '<tr><th scope="row">' + dateLabel(date) + '</th>' + cells + '</tr>';
    }).join('');

    host.innerHTML = '<table class="records-grid"><thead><tr><th>日期</th><th>早餐</th><th>午餐</th><th>晚餐</th></tr></thead><tbody>' + body + '</tbody></table>';
    renderRecordsHint(rows);
  }

  function renderRecordsHint(rows) {
    const host = $('#recordsAi');
    if (!host) return;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = rows.filter((row) => {
      const date = new Date(row.date + 'T12:00:00');
      return date.getTime() >= weekAgo;
    });

    if (!recent.length) {
      host.innerHTML = '<b>AI 提醒</b><span>还没有饮食记录。把餐盘里的这一餐记下来，这里会按蛋白质和蔬菜给出下一餐的建议。</span>';
      return;
    }

    const meals = recent.length;
    const avgProtein = recent.reduce((sum, row) => sum + row.protein, 0) / meals;
    const vegMeals = recent.filter((row) => row.vegCount > 0).length;
    const tips = [];
    if (avgProtein < 25) tips.push('蛋白质偏低，下一餐可以加一份肉、蛋或豆制品');
    if (vegMeals / meals < 0.6) tips.push('蔬菜偏少，建议每餐至少一份青菜或菌菇');
    if (avgProtein >= 35) tips.push('蛋白质已经很充足，注意主食别过量');
    if (!tips.length) tips.push('蛋白质和蔬菜都还算均衡，保持这个节奏');

    host.innerHTML = '<b>AI 提醒</b><span>最近 7 天记了 ' + meals + ' 餐，平均蛋白质 ' +
      avgProtein.toFixed(0) + 'g，' + vegMeals + ' 餐有蔬菜。' + tips.join('；') + '。（按本地记录规则生成）</span>';
  }

  // ------------------------------------------------------------------ 高峰预测
  const BASELINE = { 7: 2, 8: 4, 11: 6, 12: 9, 13: 5, 17: 5, 18: 8, 19: 4 };

  async function renderPeaks() {
    const host = $('#peakChart');
    const summaryHost = $('#peakSummary');
    const noteHost = $('#peakNote');
    if (!host) return;
    host.innerHTML = '<p class="peak-loading">正在读取排队记录…</p>';
    let data = null;
    try {
      const response = await fetch('/api/peaks?days=60', { cache: 'no-store' });
      data = await response.json();
    } catch (_) { data = null; }
    if (!data || !Array.isArray(data.hours)) {
      host.innerHTML = '<p class="peak-loading">高峰数据加载失败，请确认后端已启动。</p>';
      return;
    }
    const real = data.sample >= 8;
    const hours = data.hours.map((h) => ({
      hour: h.hour,
      value: real ? h.avgWait : (BASELINE[h.hour] || 0),
      reports: h.reports,
      avgPeople: h.avgPeople,
    }));
    const max = Math.max.apply(null, hours.map((h) => h.value).concat([1]));
    const peak = hours.slice().sort((a, b) => b.value - a.value)[0];
    host.innerHTML = hours.map((h) => {
      const height = Math.max(4, Math.round((h.value / max) * 100));
      const isPeak = peak && h.hour === peak.hour && h.value > 0;
      return '<div class="peak-col' + (isPeak ? ' peak' : '') + '">' +
        '<div class="peak-bar-wrap"><div class="peak-bar" style="height:' + height + '%"></div></div>' +
        '<div class="peak-hour">' + h.hour + ':00</div>' +
        '<div class="peak-val">' + (real ? (h.value ? h.value + ' 分钟' : '—') : (h.value ? h.value + ' 分' : '—')) + '</div>' +
      '</div>';
    }).join('');

    if (summaryHost) {
      summaryHost.innerHTML = real
        ? '<div class="peak-kpi"><b>' + peak.hour + ':00–' + (peak.hour + 1) + ':00</b><span>最挤时段</span></div>' +
          '<div class="peak-kpi"><b>' + Math.round(peak.value) + ' 分钟</b><span>平均等待</span></div>' +
          '<div class="peak-kpi"><b>' + data.sample + ' 次</b><span>近 ' + data.days + ' 天上报</span></div>'
        : '<div class="peak-kpi"><b>' + peak.hour + ':00–' + (peak.hour + 1) + ':00</b><span>经验高峰</span></div>' +
          '<div class="peak-kpi"><b>样本不足</b><span>已累计 ' + data.sample + ' 次上报</span></div>';
    }
    if (noteHost) {
      noteHost.textContent = real
        ? '柱高为各小时的平均等待时间（按每 20 分钟窗口内的上报中位数统计）。数据来自同学的真实上报，最近 ' + data.days + ' 天共 ' + data.sample + ' 条。'
        : '目前只有 ' + data.sample + ' 条上报，还不足以统计。图为食堂用餐时段的经验曲线（早 7–8 点、午 11–13 点、晚 17–19 点），多报几次就会换成真实数据。';
    }
  }

  // ------------------------------------------------------------------ 我的收藏
  function renderFavorites() {
    const host = $('#favList');
    if (!host) return;
    const items = [...favorites].map((id) => (typeof getDish === 'function' ? getDish(id) : null)).filter(Boolean);
    if (!items.length) {
      host.innerHTML = '<p class="fav-empty">还没有收藏。在菜品卡右上角点一下心形即可收藏。</p>';
      return;
    }
    host.innerHTML = items.map((d) => '<article class="fav-item" data-fav-open="' + d.id + '">' +
        '<div class="fav-copy"><strong>' + esc(d.name) + '</strong>' +
        '<small>' + (d.window && d.window.number ? esc(d.window.number) + ' 号窗口 · ' : '') + esc(d.window ? d.window.name : '') +
        ' · ' + Math.round(d.kcal) + ' kcal/100g</small></div>' +
        '<button class="fav-remove" type="button" data-fav-remove="' + d.id + '">取消收藏</button>' +
      '</article>').join('');
  }

  // ------------------------------------------------------------------ 排行榜
  let rankLoaded = false;

  async function loadRank() {
    const host = $('#rankList');
    if (!host) return;
    host.innerHTML = '<p class="rank-empty">正在读取评分…</p>';
    try {
      const response = await fetch('/api/leaderboard', { cache: 'no-store' });
      const data = await response.json();
      const items = (data && data.items) || [];
      rankLoaded = true;
      if (!items.length) {
        host.innerHTML = '<p class="rank-empty">还没有评分。去菜品详情写第一条点评，这里就有榜了。</p>';
        return;
      }
      host.innerHTML = items.map((item, index) => (
        '<button class="rank-row" type="button" data-rank-dish="' + esc(item.id) + '">' +
          '<span class="rank-no">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="rank-copy"><strong>' + esc(item.name) + '</strong><small>' +
            esc(item.windowNumber) + ' 号窗口 · ' + esc(item.windowName) + ' · ' + Math.round(item.kcal) + ' kcal/100g</small></span>' +
          '<span class="rank-score">★ ' + Number(item.rating).toFixed(1) + '<small>' + item.reviewCount + ' 条</small></span>' +
        '</button>'
      )).join('');
    } catch (_) {
      host.innerHTML = '<p class="rank-empty">排行榜加载失败，请确认后端已启动。</p>';
    }
  }

  // ------------------------------------------------------------------ 预测页提示
  function renderPredictHint() {
    const host = $('#predictHint');
    if (!host) return;
    const rows = readLog();
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = rows.filter((row) => new Date(row.date + 'T12:00:00').getTime() >= weekAgo);
    if (!recent.length) {
      host.textContent = '还没有饮食记录：先按目标配一餐，吃完在餐盘点「记下这一餐」，下次预测会更贴近你的习惯。';
      return;
    }
    const avgProtein = recent.reduce((sum, row) => sum + row.protein, 0) / recent.length;
    host.textContent = '根据最近 ' + recent.length + ' 餐的记录（平均蛋白质 ' + avgProtein.toFixed(0) +
      'g），配餐会优先补足蛋白质和蔬菜，并避开正在排队的窗口。';
  }

  // ------------------------------------------------------------------ 事件绑定
  // ------------------------------------------------------------------ 折叠 / 展开
  const COLLAPSE_KEY = 'nongcanguan-collapse';

  function readCollapse() {
    try {
      const value = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
      return { options: Boolean(value.options), rail: Boolean(value.rail), header: Boolean(value.header) };
    } catch (_) { return { options: false, rail: false, header: false }; }
  }

  function saveCollapse(state) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  const collapsed = readCollapse();

  function applyCollapse() {
    const compact = collapsed.options;
    const header = $('#pageHeader');
    if (header) header.classList.toggle('compact', compact);
    const headerToggle = $('#toggleHeader');
    if (headerToggle) {
      headerToggle.setAttribute('aria-expanded', String(!compact));
      headerToggle.classList.toggle('is-collapsed', compact);
      const label = headerToggle.querySelector('span');
      if (label) label.textContent = compact ? '展开' : '收起';
    }

    const zone = $('#optionZone');
    if (zone) zone.hidden = collapsed.options;
    const toggle = $('#toggleOptions');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed.options));
      const label = toggle.querySelector('span');
      if (label) label.textContent = collapsed.options ? '恢复标准' : '简洁模式';
      toggle.classList.toggle('button-quiet', collapsed.options);
      toggle.classList.toggle('button-primary', !collapsed.options);
    }

    const layout = $('.dish-layout');
    if (layout) layout.classList.toggle('rail-collapsed', collapsed.rail);
    const topSwitch = $('#topSwitch');
    if (topSwitch) topSwitch.addEventListener('click', () => {
      setPage('choose');
      renderCanteenCards();
    });
    const railToggle = $('#toggleFilterRail');
    if (railToggle) {
      railToggle.setAttribute('aria-expanded', String(!collapsed.rail));
      const label = railToggle.querySelector('span');
      if (label) label.textContent = collapsed.rail ? '筛选' : '收起筛选';
    }
  }

  function bindCollapse() {
    applyCollapse();
    const toggle = $('#toggleOptions');
    if (toggle) toggle.addEventListener('click', () => {
      collapsed.options = !collapsed.options;
      saveCollapse(collapsed);
      applyCollapse();
    });
    const headerToggle = $('#toggleHeader');
    if (headerToggle) headerToggle.addEventListener('click', () => {
      collapsed.options = !collapsed.options;
      saveCollapse(collapsed);
      applyCollapse();
    });
    const railToggle = $('#toggleFilterRail');
    if (railToggle) railToggle.addEventListener('click', () => {
      collapsed.rail = !collapsed.rail;
      saveCollapse(collapsed);
      applyCollapse();
    });
    const railCollapse = $('#collapseFilterRail');
    if (railCollapse) railCollapse.addEventListener('click', () => {
      collapsed.rail = true;
      saveCollapse(collapsed);
      applyCollapse();
    });
  }

  function bind() {
    bindCollapse();
    const entry = $('#entryScreen');
    if (entry) entry.addEventListener('click', (event) => {
      const button = event.target.closest('[data-entry]');
      if (!button) return;
      const action = button.getAttribute('data-entry');
      if (action === 'enter') enterApp('choose');
      if (action === 'import') toast('导入功能暂未开放：菜单由管理员统一维护');
      if (action === 'new') { enterApp('choose'); toast('已为这台设备开始新的本地记录'); }
    });

    $('#entryBox') && $('#entryBox').addEventListener('click', () => {
      enterApp('more');
      const draw = $('#boxDraw');
      if (draw) draw.click();
    });
    $('#entryPredict') && $('#entryPredict').addEventListener('click', () => enterApp('predict'));
    $('#entryEnter') && $('#entryEnter').addEventListener('click', () => enterApp('choose'));
    $('#entryAdmin') && $('#entryAdmin').addEventListener('click', () => {
      const dialog = $('#adminDialog');
      if (dialog) dialog.showModal();
    });
    $('#brandHome') && $('#brandHome').addEventListener('click', (event) => {
      event.preventDefault();
      showEntry();
    });

    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-nav]');
      if (nav) { handleNav(nav.getAttribute('data-nav')); return; }

      const galleryWin = event.target.closest('[data-gallery-win]');
      if (galleryWin && typeof openGallery === 'function' && typeof getWindow === 'function') {
        const w = getWindow(galleryWin.getAttribute('data-gallery-win'));
        if (w) openGallery(w.gallery);
        return;
      }

      const rankDish = event.target.closest('[data-rank-dish]');
      if (rankDish && typeof openDish === 'function') {
        openDish(rankDish.getAttribute('data-rank-dish'));
        return;
      }

      if (event.target.closest('#moreGallery') && typeof openGallery === 'function') {
        openGallery();
        return;
      }

      const favRemove = event.target.closest('[data-fav-remove]');
      if (favRemove) {
        const id = favRemove.getAttribute('data-fav-remove');
        favorites.delete(id);
        saveFavorites();
        renderFavorites();
        if (typeof openDish === 'function') { /* 保持页面 */ }
        toast('已取消收藏');
        return;
      }

      const favOpen = event.target.closest('[data-fav-open]');
      if (favOpen && typeof openDish === 'function') {
        openDish(favOpen.getAttribute('data-fav-open'));
        return;
      }

      if (event.target.closest('#favClear')) {
        favorites.clear();
        saveFavorites();
        renderFavorites();
        toast('收藏已清空');
        return;
      }
    });

    $('#searchInput') && $('#searchInput').addEventListener('input', (event) => {
      if (event.target.value.trim()) setPage('windows');
    });

    $('#logMealBtn') && $('#logMealBtn').addEventListener('click', logCurrentMeal);
    $('#recordsClear') && $('#recordsClear').addEventListener('click', () => {
      writeLog([]);
      renderRecords();
      toast('个人记录已清空');
    });
  }

  function init() {
    bind();
    let entered = false;
    try { entered = sessionStorage.getItem(ENTRY_KEY) === '1'; } catch (_) {}
    if (entered) enterApp('choose');
    else showEntry();
    setTimeout(renderCanteenSidebar, 400);

    renderCanteenSidebar();
    renderCanteenCards();
    document.addEventListener('click', (event) => {
      const item = event.target.closest('#canteenEast [data-canteen], #canteenWest [data-canteen]');
      if (item) {
        setTimeout(renderCanteenSidebar, 60);
        setPage('windows');
      }
      const choose = event.target.closest('[data-choose]');
      if (choose && typeof selectCanteen === 'function') {
        selectCanteen(choose.getAttribute('data-choose'));
        setPage('windows');
        renderCanteenCards();
        setTimeout(renderCanteenSidebar, 80);
        return;
      }

      if (event.target.closest('#switchCanteen')) {
        setPage('choose');
        renderCanteenCards();
        return;
      }

      const win = event.target.closest('#canteenEast [data-window], #canteenWest [data-window]');
      if (win && typeof selectWindow === 'function') {
        setPage('windows');
        selectWindow(win.getAttribute('data-window'));
        setTimeout(renderCanteenSidebar, 80);
      }
    }, true);

    loadSummary();
    setInterval(loadSummary, 60000);
    renderRecords();
    renderPredictHint();
    setInterval(renderPredictHint, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
