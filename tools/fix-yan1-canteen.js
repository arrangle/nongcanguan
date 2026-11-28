#!/usr/bin/env node
'use strict';

/**
 * 归属修正：此前把「研一照片」里的价目牌误记成了公三食堂。
 * 这个脚本把 wgong3-* 的窗口与菜品整体迁回研一（yan1），
 * 顺手把窗口 / 菜品 id、描述里的食堂名一起改掉，公三改回「待录入」。
 *
 * 用法：node tools/fix-yan1-canteen.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'menu.json');
const DRY = process.argv.includes('--dry');
const FIRST = 1; // 研一窗口重新编号的起点

const menu = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const originalWindows = menu.windows.length;
const originalDishes = menu.windows.reduce((sum, w) => sum + (w.dishes || []).length, 0);

const serial = (id) => {
  const matched = /wgong3-(\d+)/.exec(String(id));
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
};

// 1. 找出所有「实际属于研一」的窗口：canteenId 是 gong3 的，或 id 还带着 wgong3 前缀的
const moving = menu.windows
  .filter((w) => w.canteenId === 'gong3' || /^wgong3-/.test(String(w.id)))
  .sort((a, b) => serial(a.id) - serial(b.id));

if (!moving.length) {
  console.log('没有需要迁移的窗口，可能已经修过了。');
  process.exit(0);
}

const remap = {};
moving.forEach((win, index) => {
  const newWindowId = `wyan1-${index + FIRST}`;
  remap[win.id] = newWindowId;
  win.id = newWindowId;
  win.canteenId = 'yan1';
  win.windowId = newWindowId;
  win.description = String(win.description || '')
    .replace(/公三食堂/g, '研一食堂')
    .replace(/公三/g, '研一');
  win.short = String(win.short || '').replace(/公三/g, '研一');
  win.dishes = (win.dishes || []).map((dish, dishIndex) => {
    const newDishId = `${newWindowId}-${dishIndex + 1}`;
    return {
      ...dish,
      id: newDishId,
      windowId: newWindowId,
      description: String(dish.description || '')
        .replace(/公三食堂/g, '研一食堂')
        .replace(/公三/g, '研一'),
    };
  });
});

// 2. 把迁移过来的窗口按新编号顺序排到数组末尾，窗口条里顺序稳定
const others = menu.windows.filter((w) => !moving.includes(w));
menu.windows = others.concat(moving);

// 3. 公三没有真实数据了，改回「待录入」
const gong3 = (menu.canteens || []).find((c) => c.id === 'gong3');
if (gong3) gong3.status = 'pending';
menu.version = (menu.version || 1) + 1;

const newWindows = menu.windows.length;
const newDishes = menu.windows.reduce((sum, w) => sum + (w.dishes || []).length, 0);
const yan1 = menu.windows.filter((w) => w.canteenId === 'yan1');
const gong3Left = menu.windows.filter((w) => w.canteenId === 'gong3');

console.log(`迁移窗口 ${moving.length} 个 → 研一（窗口总数 ${originalWindows} → ${newWindows}）`);
console.log(`菜品 ${originalDishes} → ${newDishes}（不改数量，只改归属）`);
console.log(`研一现有窗口 ${yan1.length} 个：${yan1.map((w) => w.name).join('、')}`);
console.log(`公三剩余窗口 ${gong3Left.length} 个，状态 ${gong3 ? gong3.status : '—'}`);
console.log('id 映射：');
for (const [from, to] of Object.entries(remap)) console.log(`  ${from} → ${to}`);

if (DRY) {
  console.log('\n--dry：未写入文件');
  process.exit(0);
}

fs.writeFileSync(FILE, JSON.stringify(menu, null, 2) + '\n', 'utf8');
console.log('\n已写入 data/menu.json');
