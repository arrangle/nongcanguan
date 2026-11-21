#!/usr/bin/env node
'use strict';

/**
 * 把队友站点提取出的数据转换成项目统一菜单源 data/menu.json。
 * 用法：node tools/build-menu.js <teammate-data.json> [--out data/menu.json]
 */

const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) {
  console.error('用法：node tools/build-menu.js <teammate-data.json> [--out data/menu.json]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? path.resolve(process.argv[outIdx + 1]) : path.join(__dirname, '..', 'data', 'menu.json');

const data = JSON.parse(fs.readFileSync(src, 'utf8'));

const PHOTOS = [
  { id: '01', caption: '窗口 23–24 · 麻辣烫与石锅拌饭' },
  { id: '02', caption: '窗口 19–22 · 基本伙与特色风味' },
  { id: '03', caption: '窗口 16–18 · 轻食选餐区' },
  { id: '04', caption: '窗口 18 · 低脂菜品每100克营养公示表' },
  { id: '05', caption: '窗口 15–16 · 基本菜品与一锅炖菜' },
  { id: '06', caption: '窗口 13 · 基本伙价格公示' },
  { id: '07', caption: '窗口 11–12 · 基本菜品菜单' },
  { id: '08', caption: '窗口 11 · 基本伙价格公示' },
  { id: '09', caption: '窗口 08–10 · 粉面、粥与饼' },
  { id: '10', caption: '窗口 07–09 · 饺子与粉面' },
  { id: '11', caption: '窗口 06 · 炒意面、通心粉与河粉' },
  { id: '12', caption: '窗口 03–06 · 面点、炒饭与炒面' },
  { id: '13', caption: '窗口 02–03 · 卤味与面点' },
  { id: '14', caption: '窗口 01–02 · 基本伙与风味卤味' },
].map(p => ({ ...p, src: `assets/photos/${p.id}.webp` }));

const canteens = [
  { id: 'gong1', name: '公一食堂', alias: '公寓一食堂', status: 'online' },
  { id: 'gong2', name: '公二食堂', alias: '公寓二食堂', status: 'pending' },
  { id: 'gong3', name: '公三食堂', alias: '公寓三食堂', status: 'pending' },
];

const windows = data.windows.map(w => ({
  id: w.id,
  canteenId: 'gong1',
  number: w.number,
  name: w.name,
  short: w.short,
  cover: w.cover,
  gallery: w.gallery,
  position: w.position,
  description: w.description,
  dishes: w.dishes.map(d => ({
    id: d.id,
    name: d.name,
    price: d.price,
    unit: d.unit,
    // 以下四项均为「每 100g」口径，与队友站点的营养公示一致
    kcal: d.kcalPer100g,
    protein: d.proteinPer100g,
    fat: d.fatPer100g,
    carbs: d.carbsPer100g,
    fiber: d.fiberPer100g,
    serving: d.servingGrams,
    icon: d.icon,
    labels: d.labels,
    description: d.description,
    source: d.source,
  })),
}));

const menu = {
  version: 1,
  title: '食刻 · 农大智慧餐厅',
  subtitle: 'CAU FOOD GUIDE',
  canteenLabel: '中国农业大学 · 东区',
  dataDate: '2026-11-21',
  nutritionNote: '这不是实验检测报告。18 号窗口数值录入自现场公示表；其他窗口为 AI 估算。实际数值随配方、用油和份量变化。',
  canteens,
  windows,
  photos: PHOTOS,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(menu, null, 2) + '\n', 'utf8');

const dishCount = windows.reduce((n, w) => n + w.dishes.length, 0);
console.log(`已写入 ${outFile}`);
console.log(`食堂 ${canteens.length} 个（${canteens.filter(c => c.status === 'online').length} 个已上线）`);
console.log(`窗口 ${windows.length} 个，菜品 ${dishCount} 道，照片 ${PHOTOS.length} 张`);
console.log('窗口与菜品：');
for (const w of windows) console.log(`  ${w.number} 号 ${w.name} — ${w.dishes.length} 道`);
