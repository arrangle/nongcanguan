#!/usr/bin/env node
'use strict';

/**
 * 把队友的 app.js 改成由后端下发菜品目录（最小侵入）。
 * 只替换数据块、索引、餐盘恢复与启动段，渲染逻辑保持原样。
 * 用法：node tools/patch-app.js public/app.js
 */

const fs = require('fs');
const file = process.argv[2] || 'public/app.js';
let src = fs.readFileSync(file, 'utf8');
const original = src;
const applied = [];

function replaceOnce(from, to, label) {
  const idx = src.indexOf(from);
  if (idx === -1) throw new Error(`找不到片段：${label}`);
  if (src.indexOf(from, idx + 1) !== -1) throw new Error(`片段不唯一：${label}`);
  src = src.slice(0, idx) + to + src.slice(idx + from.length);
  applied.push(label);
}

// 1) 移除硬编码的 windows 数组
{
  const start = src.indexOf('const windows = [');
  if (start === -1) throw new Error('找不到 windows 数组');
  const endMark = src.indexOf('\n];\n\nconst photoArchive = [', start);
  if (endMark === -1) throw new Error('找不到 windows 数组结尾');
  src = src.slice(0, start) + 'let windows = [];' + src.slice(endMark + 3);
  applied.push('windows 数组改为空数组');
}

// 2) allDishes 改为可重建
replaceOnce(
  'const allDishes = windows.flatMap(w => w.dishes.map(d => ({ ...d, window: w })));',
  'let allDishes = [];\nfunction rebuildIndexes() { allDishes = windows.flatMap(w => w.dishes.map(d => ({ ...d, window: w }))); }',
  'allDishes 改为可重建'
);

// 3) 餐盘恢复移入函数
replaceOnce(
  `let tray = [];
try {
  const saved = JSON.parse(localStorage.getItem("cau-food-tray") || "[]");
  if (Array.isArray(saved)) tray = saved.filter(item => getDish(item.dishId) && [0.5, 1, 1.5].includes(item.factor) && Number.isInteger(item.qty) && item.qty > 0);
} catch (_) { tray = []; }`,
  `let tray = [];
function restoreTray() {
  try {
    const saved = JSON.parse(localStorage.getItem("cau-food-tray") || "[]");
    if (Array.isArray(saved)) tray = saved.filter(item => getDish(item.dishId) && [0.5, 1, 1.5].includes(item.factor) && Number.isInteger(item.qty) && item.qty > 0);
  } catch (_) { tray = []; }
}`,
  '餐盘恢复改为函数'
);

// 4) 启动段改为先拉菜单再渲染
replaceOnce(
  `$("#statWindows").textContent = windows.length;
$("#statDishes").textContent = allDishes.length;
renderWindowList();
renderWindowHero();
renderDishes();
renderTray();`,
  `async function loadMenu() {
  const response = await fetch("/api/menu", { cache: "no-store" });
  if (!response.ok) throw new Error("菜单接口返回 " + response.status);
  const data = await response.json();
  windows = (data.windows || []).map(w => ({ ...w, dishes: w.dishes || [] }));
  if (!windows.find(w => w.id === state.windowId) && windows.length) state.windowId = windows[0].id;
  rebuildIndexes();
}

function boot() {
  restoreTray();
  $("#statWindows").textContent = windows.length;
  $("#statDishes").textContent = allDishes.length;
  renderWindowList();
  renderWindowHero();
  renderFilterTabs();
  renderDishes();
  renderTray();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadMenu();
  } catch (error) {
    console.error(error);
    const grid = $("#dishGrid");
    if (grid) grid.innerHTML = '<div class="menu-error"><h3>菜单加载失败</h3><p>请确认真按 <code>node server.js</code> 启动后，通过 http://localhost:3000 访问。</p></div>';
    return;
  }
  boot();
  if (window.Features && typeof window.Features.init === "function") window.Features.init();
});`,
  '启动段改为异步加载'
);

fs.writeFileSync(file, src, 'utf8');
console.log('已修改 ' + file);
console.log('变更：' + applied.join('、'));
console.log(`体积：${original.length} → ${src.length} 字符`);
