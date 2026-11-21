/* 农餐馆 · 共享排队雷达 + 点评模块
 * 复用 app.js 的 windows / state / showToast / renderDishDetail，
 * 以最小侵入方式挂接后端 /api/queues 与 /api/dishes/:id/reviews。
 */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);

  let summary = { queues: {}, ratings: {}, stats: {} };
  let detail = null;              // 当前详情：{ dishId, reviews, stats }
  let draft = { rating: 0, text: '' };
  let queueTarget = null;
  let queuePeople = 5;

  // ---------------------------------------------------------------- 基础
  function deviceId() {
    let id = localStorage.getItem('cau-device-id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      localStorage.setItem('cau-device-id', id);
    }
    return id;
  }

  function nickname() {
    return localStorage.getItem('cau-nickname') || '';
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function relTime(ts) {
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

  async function api(path, options) {
    const response = await fetch(path, options);
    let data = null;
    try { data = await response.json(); } catch (_) { /* 空响应 */ }
    if (!response.ok) {
      const error = new Error((data && data.error) || ('请求失败 ' + response.status));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function currentWindows() {
    return (typeof windows !== 'undefined' && Array.isArray(windows)) ? windows : [];
  }

  // ---------------------------------------------------------------- 排队
  async function loadSummary() {
    const data = await api('/api/summary');
    summary = data && typeof data === 'object' ? data : { queues: {}, ratings: {}, stats: {} };
    summary.queues = summary.queues || {};
    summary.ratings = summary.ratings || {};
    summary.stats = summary.stats || {};
    renderQueue();
    decorateCards();
  }

  function renderQueue() {
    const list = $('#queueList');
    if (!list) return;
    const items = currentWindows().map((w) => ({ w, q: summary.queues[w.id] || null }));
    items.sort((a, b) => {
      const av = a.q ? a.q.waitMin : 9999;
      const bv = b.q ? b.q.waitMin : 9999;
      return av - bv;
    });
    list.innerHTML = items.map(({ w, q }) => {
      const lv = level(q);
      const metrics = q
        ? `<strong>${q.people}<small>人</small></strong><span>约 ${q.waitMin} 分钟</span>`
        : '<strong>–</strong><span>暂无上报</span>';
      const age = q
        ? `${relTime(q.updatedAt)}更新${q.reportCount > 1 ? ' · ' + q.reportCount + ' 人上报' : ''}`
        : '点一下，帮同学一把';
      return `<article class="queue-card ${lv.cls}">
        <div class="queue-card-head">
          <span class="queue-window">${esc(w.number)} 号</span>
          <span class="queue-state ${lv.cls}">${lv.text}</span>
        </div>
        <h3 title="${esc(w.name)}">${esc(w.name)}</h3>
        <div class="queue-metrics">${metrics}</div>
        <p class="queue-age">${age}</p>
        <button class="queue-report-btn" type="button" data-report="${esc(w.id)}">报一下排队</button>
      </article>`;
    }).join('');
    const statsLine = $('#queueStats');
    if (statsLine) {
      const s = summary.stats || {};
      statsLine.textContent = `今日 ${s.reportsToday || 0} 次上报 · ${s.reviewsToday || 0} 条点评 · 每 60 秒自动刷新`;
    }
  }

  function openQueue(windowId) {
    if (typeof getWindow !== 'function') return;
    const w = getWindow(windowId);
    if (!w) return;
    queueTarget = windowId;
    const q = summary.queues[windowId];
    queuePeople = q && !q.stale ? Math.min(30, q.people) : 5;
    $('#queueDialogTitle').textContent = `${w.number} 号窗口 · ${w.name}`;
    $('#queueDialogHint').textContent = q
      ? `上次上报 ${relTime(q.updatedAt)}，约 ${q.people} 人排队。`
      : '这个窗口还没有人上报，你的一份数据就是起点。';
    paintStepper();
    $('#queueDialog').showModal();
  }

  function paintStepper() {
    const value = $('#queuePeople');
    if (value) value.textContent = queuePeople;
    const presets = $('#queuePresets');
    if (presets) {
      presets.innerHTML = [0, 2, 5, 10, 15, 20]
        .map((n) => `<button type="button" class="${n === queuePeople ? 'active' : ''}" data-preset="${n}">${n} 人</button>`)
        .join('');
    }
  }

  async function submitQueue() {
    if (!queueTarget) return;
    const button = $('#queueSubmit');
    if (button) button.disabled = true;
    try {
      const data = await api('/api/queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: queueTarget, people: queuePeople, deviceId: deviceId() }),
      });
      summary.queues[queueTarget] = data.queue;
      renderQueue();
      $('#queueDialog').close();
      toast('上报成功，谢谢帮忙');
    } catch (error) {
      toast(error.message || '上报失败，稍后再试');
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ---------------------------------------------------------------- 点评
  async function loadDetail(dishId) {
    try {
      const data = await api('/api/dishes/' + encodeURIComponent(dishId));
      if (typeof state === 'undefined' || state.detailDishId !== dishId) return;
      detail = { dishId: dishId, reviews: data.reviews || [], stats: data.stats || { rating: null, reviewCount: 0 } };
      mountReviews();
    } catch (_) {
      const section = document.getElementById('reviewSection');
      if (section) section.innerHTML = '<p class="review-empty">点评加载失败，稍后重试。</p>';
    }
  }

  function reviewHost() {
    return document.querySelector('#dishDialogContent .dish-detail-main') || document.getElementById('dishDialogContent');
  }

  function mountReviews() {
    const host = reviewHost();
    const dishId = (typeof state !== 'undefined') ? state.detailDishId : null;
    if (!host || !dishId) return;
    let section = document.getElementById('reviewSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'reviewSection';
      section.className = 'review-section';
    }
    host.appendChild(section);
    if (!detail || detail.dishId !== dishId) {
      section.innerHTML = '<p class="review-empty">正在加载点评…</p>';
      return;
    }
    renderReviews(section);
  }

  function renderReviews(section) {
    const stats = detail.stats || { rating: null, reviewCount: 0 };
    const reviews = detail.reviews || [];
    const score = stats.rating == null
      ? '<strong>—</strong><span>暂无评分</span>'
      : `<strong>${Number(stats.rating).toFixed(1)}</strong><span>${stats.reviewCount} 条点评</span>`;
    const list = reviews.length
      ? reviews.map((review) => `<article class="review-item">
          <div class="review-item-head">
            <strong>${esc(review.author)}</strong>
            <span class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span>
            <time>${relTime(review.ts)}</time>
          </div>
          ${review.text ? `<p>${esc(review.text)}</p>` : ''}
        </article>`).join('')
      : '<p class="review-empty">还没有人点评，来做第一个。</p>';

    section.innerHTML = `
      <div class="review-head">
        <div><span class="eyebrow">REVIEWS</span><h3>大家怎么说</h3></div>
        <div class="review-score">${score}</div>
      </div>
      <div class="review-list">${list}</div>
      <form class="review-form" id="reviewForm" autocomplete="off">
        <div class="review-form-title">写点评</div>
        <div class="star-picker" id="starPicker" role="radiogroup" aria-label="给这道菜打分">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${draft.rating >= n ? 'on' : ''}" aria-label="${n} 分">★</button>`).join('')}
        </div>
        <textarea id="reviewText" maxlength="200" rows="3" placeholder="这道菜好吃吗？分量和价格怎么样，说两句。">${esc(draft.text)}</textarea>
        <div class="review-form-foot">
          <input id="reviewAuthor" maxlength="20" placeholder="昵称（选填）" value="${esc(nickname())}">
          <span id="reviewCountText">${draft.text.length}/200</span>
          <button class="button button-primary" type="submit" id="reviewSubmit">发布点评</button>
        </div>
      </form>`;
  }

  async function submitReview(event) {
    event.preventDefault();
    const dishId = (typeof state !== 'undefined') ? state.detailDishId : null;
    if (!dishId) return;
    if (!draft.rating) {
      toast('先点一下星星打个分');
      return;
    }
    const author = ($('#reviewAuthor') || {}).value || '';
    if (author.trim()) localStorage.setItem('cau-nickname', author.trim());
    const button = $('#reviewSubmit');
    if (button) button.disabled = true;
    try {
      const data = await api('/api/dishes/' + encodeURIComponent(dishId) + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: draft.rating, text: draft.text, author: author, deviceId: deviceId() }),
      });
      detail = { dishId: dishId, reviews: data.reviews || [], stats: data.stats };
      draft = { rating: 0, text: '' };
      mountReviews();
      summary.ratings[dishId] = data.stats;
      decorateCards();
      toast('点评已发布');
    } catch (error) {
      toast(error.message || '发布失败，稍后再试');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function decorateCards() {
    $$('.dish-card[data-dish]').forEach((card) => {
      const id = card.getAttribute('data-dish');
      const stat = summary.ratings[id];
      let badge = card.querySelector('.rating-badge');
      if (stat && stat.reviewCount) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'rating-badge';
          const top = card.querySelector('.dish-card-top');
          if (top) top.appendChild(badge);
        }
        badge.textContent = `★ ${Number(stat.rating).toFixed(1)} · ${stat.reviewCount}`;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // ---------------------------------------------------------------- 今日盲盒
  const BOX_EMOJI = { meat: '🍗', noodles: '🍜', leaf: '🥬', rice: '🍚', egg: '🥚', bowl: '🥣' };
  let boxRolling = false;

  function drawBox() {
    if (boxRolling) return;
    const all = (typeof allDishes !== 'undefined' && Array.isArray(allDishes)) ? allDishes : [];
    const stage = $('#boxStage');
    if (!all.length || !stage) return;

    boxRolling = true;
    stage.classList.add('rolling');
    stage.innerHTML = '<div class="box-emoji shake">🎁</div><p class="box-loading">正在摇盲盒…</p>';

    setTimeout(function () {
      let history = [];
      try { history = JSON.parse(localStorage.getItem('cau-box-history') || '[]'); } catch (_) { history = []; }
      let pool = all.filter(function (dish) { return history.indexOf(dish.id) === -1; });
      if (!pool.length) pool = all.slice();

      const dish = pool[Math.floor(Math.random() * pool.length)];
      history.push(dish.id);
      try { localStorage.setItem('cau-box-history', JSON.stringify(history.slice(-8))); } catch (_) {}

      const ratio = (dish.serving || 250) / 100;
      const stat = (summary.ratings || {})[dish.id];
      const w = dish.window;
      stage.classList.remove('rolling');
      stage.innerHTML = '<div class="box-result">' +
        '<div class="box-emoji">' + (BOX_EMOJI[dish.icon] || '🍽️') + '</div>' +
        '<h3>' + esc(dish.name) + '</h3>' +
        '<p class="box-window">' + esc(w.number) + ' 号 · ' + esc(w.name) + '</p>' +
        '<p class="box-meta">' + Math.round(dish.kcal * ratio) + ' kcal · 蛋白 ' + (dish.protein * ratio).toFixed(1) + 'g' +
          (stat ? ' · ★ ' + Number(stat.rating).toFixed(1) : '') + '</p>' +
        '<div class="box-tags">' + (dish.labels || []).slice(0, 3).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="box-actions">' +
          '<button class="button button-quiet" type="button" id="boxDrawAgain">再抽一次</button>' +
          '<button class="button button-primary" type="button" data-box-open="' + esc(dish.id) + '">去看看 ›</button>' +
        '</div>' +
      '</div>';
      boxRolling = false;
    }, 700);
  }

  // ---------------------------------------------------------------- 今日推荐
  const GOALS = {
    balanced: { plan: ['protein', 'staple', 'veg'] },
    protein: { plan: ['protein', 'protein', 'veg'] },
    light: { plan: ['veg', 'protein', 'veg'] },
    veg: { plan: ['veg', 'veg', 'staple'] },
  };
  let plannerGoal = 'balanced';
  let plannerMeal = [];

  function categoryOf(dish) {
    const labels = dish.labels || [];
    if (labels.includes('汤')) return 'soup';
    if (labels.includes('主食') || dish.icon === 'rice' || dish.icon === 'noodles') return 'staple';
    if (labels.includes('素食') || dish.icon === 'leaf') return 'veg';
    if (labels.includes('高蛋白') || dish.icon === 'meat' || dish.icon === 'egg') return 'protein';
    return 'other';
  }

  function queueWait(window) {
    const queue = window && summary.queues ? summary.queues[window.id] : null;
    return queue && !queue.stale ? queue.waitMin : -1;
  }

  function scoreFor(dish, goal) {
    let score = 0;
    if (goal === 'protein') score += (dish.protein || 0) * 3;
    if (goal === 'light') score += Math.max(0, 200 - dish.kcal) * 0.03 + Math.max(0, 8 - dish.fat) * 2;
    if (goal === 'veg') score += (dish.labels || []).includes('素食') ? 8 : 0;
    if (goal === 'balanced') score += (dish.protein || 0) * 1.2 + (dish.fiber || 0) * 2;
    const wait = queueWait(dish.window);
    if (wait >= 0) score -= wait * 1.5;
    return score;
  }

  function pickMeal() {
    const dishes = (typeof allDishes !== 'undefined' && Array.isArray(allDishes)) ? allDishes : [];
    if (!dishes.length) return [];
    const plan = (GOALS[plannerGoal] || GOALS.balanced).plan;
    const chosen = new Set();
    const meal = [];
    for (const category of plan) {
      let pool = dishes.filter((dish) => !chosen.has(dish.id) && categoryOf(dish) === category);
      if (!pool.length) pool = dishes.filter((dish) => !chosen.has(dish.id));
      if (!pool.length) break;
      const ranked = pool
        .map((dish) => ({ dish, score: scoreFor(dish, plannerGoal) + Math.random() * 3 }))
        .sort((a, b) => b.score - a.score);
      const pick = ranked[Math.floor(Math.random() * Math.min(4, ranked.length))].dish;
      chosen.add(pick.id);
      meal.push(pick);
    }
    return meal;
  }

  function mealTotals(meal) {
    return meal.reduce((acc, dish) => {
      const ratio = (dish.serving || 250) / 100;
      acc.kcal += dish.kcal * ratio;
      acc.protein += dish.protein * ratio;
      return acc;
    }, { kcal: 0, protein: 0 });
  }

  function renderPlanner() {
    const host = $('#mealResult');
    if (!host) return;
    if (typeof allDishes === 'undefined' || !Array.isArray(allDishes) || !allDishes.length) return;
    if (!plannerMeal.length) plannerMeal = pickMeal();
    const totals = mealTotals(plannerMeal);
    host.innerHTML = `<div class="meal-items">${plannerMeal.map((dish) => {
      const ratio = (dish.serving || 250) / 100;
      return `<article class="meal-item">
        <span class="meal-item-window">${esc(dish.window.number)} 号 · ${esc(dish.window.name)}</span>
        <h3>${esc(dish.name)}</h3>
        <p>${Math.round(dish.kcal * ratio)} kcal · 蛋白质 ${(dish.protein * ratio).toFixed(1)}g</p>
      </article>`;
    }).join('')}</div>
    <div class="meal-total">
      <div><span>这一餐约</span><strong>${Math.round(totals.kcal)}<small> kcal</small></strong><em>蛋白质 ${totals.protein.toFixed(0)}g</em></div>
      <button class="button button-primary" id="plannerAdd" type="button">整餐加入餐盘</button>
    </div>`;
    $$('#goalTabs [data-goal]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-goal') === plannerGoal);
    });
  }

  function reroll() {
    plannerMeal = pickMeal();
    renderPlanner();
  }

  function addPlannerMeal() {
    if (typeof addDish !== 'function' || !plannerMeal.length) return;
    plannerMeal.forEach((dish) => addDish(dish.id, 1));
    toast('整餐已加入今日餐盘');
  }

  // ---------------------------------------------------------------- 挂接
  function installHooks() {
    if (typeof openDish !== 'function' || typeof renderDishDetail !== 'function') return;

    const originalOpenDish = openDish;
    window.openDish = function (id) {
      detail = null;
      draft = { rating: 0, text: '' };
      originalOpenDish(id);
      loadDetail(id);
    };

    const originalRenderDetail = renderDishDetail;
    window.renderDishDetail = function () {
      originalRenderDetail();
      mountReviews();
    };

    if (typeof renderDishes === 'function') {
      const originalRenderDishes = renderDishes;
      window.renderDishes = function () {
        originalRenderDishes();
        decorateCards();
      };
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || !target.closest) return;

      const star = target.closest('#starPicker [data-star]');
      if (star) {
        draft.rating = Number(star.getAttribute('data-star'));
        $$('#starPicker [data-star]').forEach((button) => {
          button.classList.toggle('on', Number(button.getAttribute('data-star')) <= draft.rating);
        });
        return;
      }

      const report = target.closest('[data-report]');
      if (report) {
        openQueue(report.getAttribute('data-report'));
        return;
      }

      const step = target.closest('[data-step]');
      if (step) {
        queuePeople = Math.max(0, Math.min(30, queuePeople + Number(step.getAttribute('data-step'))));
        paintStepper();
        return;
      }

      const preset = target.closest('[data-preset]');
      if (preset) {
        queuePeople = Number(preset.getAttribute('data-preset'));
        paintStepper();
        return;
      }

      if (target.closest('#queueSubmit')) {
        submitQueue();
        return;
      }

      if (target.closest('#queueRefresh')) {
        loadSummary().then(() => toast('已刷新')).catch(() => toast('刷新失败，稍后再试'));
        return;
      }

      const goalButton = target.closest('#goalTabs [data-goal]');
      if (goalButton) {
        plannerGoal = goalButton.getAttribute('data-goal');
        reroll();
        return;
      }

      if (target.closest('#plannerReroll')) {
        reroll();
        return;
      }

      if (target.closest('#plannerAdd')) {
        addPlannerMeal();
        return;
      }

      if (target.closest('#boxDraw') || target.closest('#boxDrawAgain')) {
        drawBox();
        return;
      }

      const boxOpen = target.closest('[data-box-open]');
      if (boxOpen) {
        openDish(boxOpen.getAttribute('data-box-open'));
        return;
      }
    });

    document.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'reviewText') {
        draft.text = event.target.value.slice(0, 200);
        const counter = document.getElementById('reviewCountText');
        if (counter) counter.textContent = draft.text.length + '/200';
      }
    });

    document.addEventListener('submit', function (event) {
      if (event.target && event.target.id === 'reviewForm') submitReview(event);
    });
  }

  function init() {
    installHooks();
    bindEvents();
    loadSummary()
      .catch(() => {
        const list = $('#queueList');
        if (list) list.innerHTML = '<p class="queue-error">排队数据加载失败，请确认通过 node server.js 启动。</p>';
      })
      .then(() => {
        renderPlanner();
      });
    setInterval(function () {
      loadSummary().catch(function () {});
    }, 60000);
  }

  window.Features = { init: init };
})();
