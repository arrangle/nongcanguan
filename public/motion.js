/* 农餐馆 · 动效
 * 1) 菜品卡（框）→ 营养详情弹层（框）：容器变形（FLIP / container transform）
 * 2) 加入餐盘：菜品缩略图从卡片飞进「今日餐盘」（框到框的位移动画）
 * 只用 Web Animations API，不支持或开启「减少动态效果」时自动降级为直接打开/直接加入。
 */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const canAnimate = typeof Element.prototype.animate === 'function';

  function shouldSkip() {
    return (reduceMotion && reduceMotion.matches) || !canAnimate;
  }

  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? box : null;
  }

  // ------------------------------------------------------------------ 一、卡片 → 详情弹层
  function morphDialog(dialog, from) {
    const to = dialog.getBoundingClientRect();
    if (!to.width || !to.height) return;

    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const shiftX = from.left - to.left;
    const shiftY = from.top - to.top;

    dialog.classList.add('is-morphing');

    const grow = dialog.animate([
      {
        transform: `translate(${shiftX}px, ${shiftY}px) scale(${scaleX}, ${scaleY})`,
        borderRadius: '18px',
        opacity: 0.55,
      },
      {
        transform: 'translate(0, 0) scale(1, 1)',
        borderRadius: window.getComputedStyle(dialog).borderRadius || '24px',
        opacity: 1,
      },
    ], {
      duration: 430,
      easing: 'cubic-bezier(.22, .68, .24, 1)',
    });

    const content = dialog.querySelector('#dishDialogContent');
    if (content) {
      content.animate([
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 260, delay: 150, easing: 'ease-out', fill: 'both' });
    }

    const done = () => dialog.classList.remove('is-morphing');
    grow.addEventListener('finish', done);
    grow.addEventListener('cancel', done);
  }

  window.openDishMorph = function (dishId, sourceEl) {
    const dialog = document.querySelector('#dishDialog');
    if (!dialog || shouldSkip()) {
      if (typeof openDish === 'function') openDish(dishId);
      return;
    }
    const from = rectOf(sourceEl);
    if (!from) {
      openDish(dishId);
      return;
    }
    // 先把 CSS 的入场动画关掉，否则起跳那一帧会闪一下全尺寸
    dialog.classList.add('is-morphing');
    openDish(dishId);

    // 卡片被按下的反馈
    try {
      sourceEl.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(.985)' },
        { transform: 'scale(1)' },
      ], { duration: 260, easing: 'ease-out' });
    } catch (_) { /* 忽略 */ }

    requestAnimationFrame(() => requestAnimationFrame(() => morphDialog(dialog, from)));
  };

  // ------------------------------------------------------------------ 二、菜品 → 今日餐盘
  function trayTarget() {
    const mobileButton = document.querySelector('#mobileTrayBtn');
    const panel = document.querySelector('#trayPanel');
    const mobileVisible = mobileButton && mobileButton.getBoundingClientRect().width > 0;
    return rectOf(mobileVisible ? mobileButton : panel) || rectOf(panel);
  }

  window.flyToTray = function (sourceEl) {
    if (shouldSkip()) return;
    const from = rectOf(sourceEl);
    const to = trayTarget();
    if (!from || !to) return;

    const thumb = sourceEl.querySelector('.dish-card-image');
    const image = thumb ? thumb.querySelector('img') : null;

    const fly = document.createElement('div');
    fly.className = 'fly-thumb';
    fly.style.left = from.left + from.width / 2 + 'px';
    fly.style.top = from.top + from.height / 2 + 'px';
    fly.style.width = Math.min(72, from.width * 0.6) + 'px';
    fly.style.height = fly.style.width;
    if (image) {
      fly.style.backgroundImage = 'url("' + image.getAttribute('src') + '")';
      fly.style.backgroundSize = 'cover';
    }
    document.body.appendChild(fly);

    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);

    const flight = fly.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95 },
      { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.35}px)) scale(.72)`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.28)`, opacity: 0.2 },
    ], {
      duration: 620,
      easing: 'cubic-bezier(.35, .05, .35, 1)',
    });

    const settle = () => fly.remove();
    flight.addEventListener('finish', settle);
    flight.addEventListener('cancel', settle);

    // 目标框跟着「弹」一下
    const targetEl = document.querySelector('#mobileTrayBtn') && document.querySelector('#mobileTrayBtn').getBoundingClientRect().width > 0
      ? document.querySelector('#mobileTrayBtn')
      : document.querySelector('#trayPanel');
    if (targetEl) {
      setTimeout(() => {
        try {
          targetEl.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.04)' },
            { transform: 'scale(1)' },
          ], { duration: 320, easing: 'ease-out' });
        } catch (_) { /* 忽略 */ }
      }, 460);
    }
  };
})();
