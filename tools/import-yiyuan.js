#!/usr/bin/env node
'use strict';

/**
 * 颐园二层 / 三层 价目牌导入（增量，不改动其它食堂的数据）。
 *
 * 数据来源：hello/西区/颐园二层、hello/西区/颐园三层 的现场照片，
 * 转录结果放在 tools/data/yi2.json、tools/data/yi3.json。
 *
 * 用法：node tools/import-yiyuan.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { estimate, labelsFor, normalizeUnit } = require('./lib/nutrition');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const MENU_FILE = path.join(ROOT, 'data', 'menu.json');
const PHOTO_SRC_ROOT = 'C:\\Users\\arrangle\\Desktop\\hello';
const OUT_ASSETS = path.join(ROOT, 'public', 'assets', 'new');
const FFMPEG = 'C:\\Users\\arrangle\\AppData\\Local\\Temp\\ffmpeg.exe';

const FLOORS = [
  { canteenId: 'yi2', name: '颐园二层', alias: '颐二', dir: '西区/颐园二层', file: 'yi2.json', floor: '二层' },
  { canteenId: 'yi3', name: '颐园三层', alias: '颐三', dir: '西区/颐园三层', file: 'yi3.json', floor: '三层' },
];

const menu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));

// 图片编号接着现有的 n### 往后排，避免和之前的照片撞号
let photoSeq = 0;
for (const photo of menu.photos || []) {
  const matched = /^n(\d{3})$/.exec(photo.id || '');
  if (matched) photoSeq = Math.max(photoSeq, Number(matched[1]));
}

const photoCache = new Map();
function photoFor(canteenName, sourcePath, caption) {
  if (photoCache.has(sourcePath)) return photoCache.get(sourcePath);
  if (!fs.existsSync(sourcePath)) return null;
  photoSeq += 1;
  const id = 'n' + String(photoSeq).padStart(3, '0');
  const file = path.join(OUT_ASSETS, id + '.webp');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(OUT_ASSETS, { recursive: true });
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', sourcePath, '-vf', 'scale=900:-1', '-c:v', 'libwebp', '-quality', '72', file]);
  }
  const photo = { id, caption: canteenName + ' · ' + caption, src: 'assets/new/' + id + '.webp' };
  photoCache.set(sourcePath, photo);
  return photo;
}

const newWindows = [];
const newPhotos = [];
const report = [];

for (const floor of FLOORS) {
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(path.join(DATA, floor.file), 'utf8'));
  } catch (err) {
    console.log(`跳过 ${floor.name}：读不到 ${floor.file}（${err.message}）`);
    continue;
  }
  let windowSeq = 0;
  let skipped = 0;
  entries.forEach((entry) => {
    if (!entry || entry.unreadable) { skipped += 1; return; }
    const items = (entry.items || []).filter((item) => item && String(item.name || '').trim());
    if (!items.length) { skipped += 1; return; }

    const number = String(entry.windowNumber || '').trim();
    const theme = String(entry.cardTitle || '').trim();
    const name = theme || (number ? '窗口 ' + number : '未分窗口');
    const caption = theme || (number ? number + ' 号窗口' : '价目牌');
    const photo = photoFor(floor.name, path.join(PHOTO_SRC_ROOT, floor.dir, entry.photo || ''), caption);

    windowSeq += 1;
    const id = 'w' + floor.canteenId + '-' + windowSeq;
    const dishes = [];
    const seen = new Set();
    items.forEach((item) => {
      const dishName = String(item.name).trim();
      if (seen.has(dishName)) return;
      seen.add(dishName);
      const est = estimate(dishName);
      const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
      dishes.push({
        id: id + '-' + (dishes.length + 1),
        name: dishName,
        price,
        unit: price === null ? '时价' : normalizeUnit('元' + (String(item.unit || '').replace(/^元/, '') || '/份')),
        kcal: est.kcal,
        protein: est.protein,
        fat: est.fat,
        carbs: est.carbs,
        fiber: est.fiber,
        serving: est.serving,
        icon: est.icon,
        labels: labelsFor(dishName, est, est.tag),
        description: (item.note ? item.note + '。' : '') +
          floor.name + (number ? ' ' + number + ' 号窗口' : '') + '价目牌（拍摄于 2026.11.28）；营养为按菜名估算。',
        source: 'AI估算',
      });
    });

    if (photo) newPhotos.push(photo);
    newWindows.push({
      id,
      canteenId: floor.canteenId,
      number,
      name,
      short: caption,
      description: (number ? number + ' 号窗口 · ' : '') + caption + '（价目牌拍摄于 2026.11.28）',
      cover: photo ? photo.src : 'assets/photos/04.webp',
      position: 'center 40%',
      gallery: photo ? [photo.id] : [],
      dishes,
    });
  });
  report.push(`${floor.name}：${windowSeq} 个窗口，${newWindows.filter((w) => w.canteenId === floor.canteenId).reduce((s, w) => s + w.dishes.length, 0)} 道菜（跳过 ${skipped} 张非菜单照片）`);
}

// 可重复执行：先清掉这两个食堂的旧窗口
const managed = new Set(['yi2', 'yi3']);
menu.windows = menu.windows.filter((w) => !managed.has(w.canteenId));
menu.photos = (menu.photos || []).filter((p) => !newPhotos.some((n) => n.id === p.id));
menu.windows = menu.windows.concat(newWindows);
menu.photos = menu.photos.concat(newPhotos);

// 食堂状态：有数据的改成已上线
for (const floor of FLOORS) {
  const canteen = (menu.canteens || []).find((c) => c.id === floor.canteenId);
  if (canteen) {
    const count = newWindows.filter((w) => w.canteenId === floor.canteenId).length;
    canteen.status = count ? 'online' : canteen.status;
  }
}

menu.dataDate = '2026-11-28';
fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2) + '\n');

report.forEach((line) => console.log(line));
const total = menu.windows.reduce((sum, w) => sum + w.dishes.length, 0);
console.log(`合计：窗口 ${menu.windows.length} 个，菜品 ${total} 道，图片 ${menu.photos.length} 张`);
