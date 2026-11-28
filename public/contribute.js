/* 农餐馆 · 众包贡献
 * 1) 菜品实拍图上传（拍照 / 相册，前端压缩后上传）
 * 2) 积分系统：上传、点评、上报排队都能加分
 * 依赖 app.js 暴露的 window.setDishPhotos / window.getDishById
 */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));
  const toast = (message) => { if (typeof showToast === 'function') showToast(message); };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function deviceId() {
    let id = null;
    try { id = localStorage.getItem('cau-device-id'); } catch (_) {}
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem('cau-device-id', id); } catch (_) {}
    }
    return id;
  }

  async function api(path, options) {
    const response = await fetch(path, Object.assign({ cache: 'no-store' }, options || {}));
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      const error = new Error((data && data.error) || ('请求失败（' + response.status + '）'));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ------------------------------------------------------------------ 图片库
  let photos = {};

  async function loadPhotos() {
    try {
      const data = await api('/api/dish-photos');
      photos = (data && data.photos) || {};
      if (typeof window.setDishPhotos === 'function') window.setDishPhotos(photos);
    } catch (_) { /* 后端不可用时静默 */ }
  }

  // ------------------------------------------------------------------ 积分
  let pointsData = null;

  function paintPoints(data) {
    pointsData = data || pointsData;
    if (!pointsData) return;
    const total = pointsData.total || 0;
    const chip = $('#pointsChipValue');
    if (chip) chip.textContent = total;
    const card = $('#pointsCardValue');
    if (card) card.textContent = total;
    const nav = $('#pointsNavValue');
    if (nav) {
      nav.textContent = total;
      nav.hidden = total <= 0;
    }
  }

  async function loadPoints() {
    try {
      const data = await api('/api/points?deviceId=' + encodeURIComponent(deviceId()));
      paintPoints(data);
      renderPointsBody();
      return data;
    } catch (_) {
      return null;
    }
  }

  function ruleRow(rule) {
    const used = (pointsData && pointsData.today && pointsData.today[rule.type]) || 0;
    const percent = Math.min(100, Math.round((used / rule.dailyCap) * 100));
    return '<div class="points-rule">' +
      '<div class="pr-head"><strong>' + esc(rule.label) + '</strong><span class="pr-value">+' + rule.points + '</span></div>' +
      '<p class="pr-hint">' + esc(rule.hint) + '</p>' +
      '<div class="pr-track"><span style="width:' + percent + '%"></span></div>' +
      '<p class="pr-cap">今日 ' + used + ' / ' + rule.dailyCap + '</p>' +
    '</div>';
  }

  function renderPointsBody() {
    const hero = $('#pointsHero');
    if (!hero || !pointsData) return;
    const total = pointsData.total || 0;
    const today = pointsData.todayPoints || 0;
    const community = pointsData.community || {};
    hero.innerHTML =
      '<div class="ph-main"><span>我的积分</span><strong>' + total + '</strong>' +
        '<small>今天 ' + today + ' 分 · 今日已传 ' + (pointsData.uploadsToday || 0) + ' / ' + pointsData.uploadLimit + ' 张图</small></div>' +
      '<div class="ph-side">' +
        '<div><b>' + (community.photos || 0) + '</b><span>道菜已有实拍</span></div>' +
        '<div><b>' + (community.contributors || 0) + '</b><span>位同学参与</span></div>' +
        '<div><b>' + (community.allPoints || 0) + '</b><span>累计贡献分</span></div>' +
      '</div>' +
      '<button class="button button-primary ph-cta" type="button" data-nav="windows">去上传菜品图</button>';

    const rules = $('#pointsRules');
    if (rules) rules.innerHTML = (pointsData.rules || []).map(ruleRow).join('');

    const history = $('#pointsHistory');
    if (history) {
      const events = pointsData.events || [];
      history.innerHTML = events.length
        ? events.map((item) => '<div class="points-event">' +
            '<span class="pe-dot"></span>' +
            '<div class="pe-copy"><strong>' + esc(item.label) + '</strong>' +
              '<small>' + esc(item.detail || '') + ' · ' + formatTime(item.ts) + '</small></div>' +
            '<b>+' + item.points + '</b>' +
          '</div>').join('')
        : '<p class="points-empty">还没有积分记录。点开任意一道菜，上传一张实拍图就能拿 20 分。</p>';
    }
  }

  function formatTime(ts) {
    const date = new Date(ts || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  window.renderPointsPage = function () {
    if (pointsData) renderPointsBody();
    loadPoints();
  };

  // ------------------------------------------------------------------ 上传菜品图
  const dialog = $('#photoDialog');
  const input = $('#photoInput');
  const preview = $('#photoPreview');
  const submit = $('#photoSubmit');
  const status = $('#photoStatus');
  const tip = $('#photoTip');
  let currentDishId = null;
  let pendingDataUrl = '';
  let busy = false;

  function setStatus(text, kind) {
    if (!status) return;
    if (!text) { status.hidden = true; status.textContent = ''; return; }
    status.hidden = false;
    status.textContent = text;
    status.className = 'photo-status ' + (kind || '');
  }

  window.openPhotoUpload = function (dishId) {
    const dish = typeof window.getDishById === 'function' ? window.getDishById(dishId) : null;
    if (!dish || !dialog) return;
    currentDishId = dishId;
    pendingDataUrl = '';
    busy = false;
    const title = $('#photoDishName');
    if (title) title.textContent = dish.name;
    if (preview) {
      preview.innerHTML = '<svg class="icon"><use href="#i-image"/></svg><strong>拍照 / 从相册选择</strong><small>拍到菜品和窗口价牌，画面清楚就好</small>';
    }
    if (input) input.value = '';
    if (submit) { submit.disabled = true; submit.textContent = '上传并领积分'; }
    const existing = photos[dishId];
    if (tip) {
      tip.textContent = existing
        ? '这道菜已经有实拍图了，补充一张算 +5 积分。'
        : '首次上传这道菜 +20 积分；每天最多 20 张。';
    }
    setStatus('');
    if (typeof dialog.showModal === 'function') dialog.showModal();
  };

  // 压缩：长边 1280，JPEG 0.82；iPhone 的 HEIC 由浏览器自动转码，失败则退回原图
  function compress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const raw = reader.result;
        const image = new Image();
        image.onerror = () => {
          if (/^data:image\/(jpeg|png|webp)/i.test(raw)) resolve(raw);
          else reject(new Error('这张图片格式浏览器打不开，换一张试试'));
        };
        image.onload = () => {
          const max = 1280;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        image.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }

  if (input) {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setStatus('正在处理图片…');
      if (submit) submit.disabled = true;
      try {
        pendingDataUrl = await compress(file);
        if (preview) {
          preview.innerHTML = '<img src="' + pendingDataUrl + '" alt="预览"><small>' + esc(file.name || '已选择图片') + ' · 点击可重选</small>';
        }
        const sizeKb = Math.round(pendingDataUrl.length * 0.75 / 1024);
        setStatus('已选择图片 · 约 ' + sizeKb + ' KB', 'ok');
        if (submit) submit.disabled = false;
      } catch (error) {
        pendingDataUrl = '';
        setStatus(error.message || '图片处理失败', 'bad');
      }
    });
  }

  if (submit) {
    submit.addEventListener('click', async () => {
      if (!currentDishId || !pendingDataUrl || busy) return;
      busy = true;
      submit.disabled = true;
      submit.textContent = '上传中…';
      try {
        const body = await api('/api/dish-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dishId: currentDishId, dataUrl: pendingDataUrl, deviceId: deviceId() }),
        });
        photos[currentDishId] = body.photo;
        if (typeof window.setDishPhotos === 'function') window.setDishPhotos(photos);
        if (typeof renderDishDetail === 'function' && $('#dishDialog') && $('#dishDialog').open) renderDishDetail();
        paintPoints(body.pointsView);
        renderPointsBody();
        const gained = body.points && body.points.gained;
        toast(gained > 0 ? '上传成功，+' + gained + ' 积分' : '上传成功，今天的图片积分到上限啦');
        dialog.close();
      } catch (error) {
        setStatus(error.message || '上传失败，稍后再试', 'bad');
      } finally {
        busy = false;
        if (submit) { submit.disabled = false; submit.textContent = '上传并领积分'; }
      }
    });
  }

  // ------------------------------------------------------------------ 初始化
  document.addEventListener('DOMContentLoaded', () => {
    loadPhotos();
    loadPoints();
    const refresh = $('#pointsRefresh');
    if (refresh) refresh.addEventListener('click', () => { loadPoints(); loadPhotos(); });
    // 页面重新可见时刷新一下积分（例如上传后切回来）
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadPoints();
    });
  });

  window.Contribute = { loadPoints, loadPhotos, deviceId };
})();
