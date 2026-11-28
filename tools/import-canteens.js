#!/usr/bin/env node
'use strict';

/**
 * 把现场拍的价目牌转录（tools/data/*.json）导入 data/menu.json。
 *
 * 规则（与需求一致）：
 *  - 有窗口号的，按窗口号建窗口；
 *  - 没有窗口号但有明确档口主题的，按主题建窗口（number 留空，名字用主题）；
 *  - 纸质告示、广告屏等无法归属的，放进该食堂的「未分窗口」；
 *  - 研一自选菜（称重台）单独一个窗口「自选称重」，营养用屏幕上公示的值。
 *
 * 图片：hello/ 下的现场照片统一转成 public/assets/new/*.webp，作为窗口封面与相册。
 *
 * 用法：node tools/import-canteens.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const MENU_FILE = path.join(ROOT, 'data', 'menu.json');
const PHOTO_SRC_ROOT = 'C:\\Users\\arrangle\\Desktop\\hello';
const OUT_ASSETS = path.join(ROOT, 'public', 'assets', 'new');
const FFMPEG = 'C:\\Users\\arrangle\\AppData\\Local\\Temp\\ffmpeg.exe';

const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const yan1Windows = read('yan1-windows.json');
const yan1Zixuan = read('yan1-zixuan.json');
const he = read('he.json');
const yi = read('yi.json');

const { estimate, labelsFor, normalizeUnit } = require('./lib/nutrition');

// ---------------------------------------------------------------- 图片
let photoSeq = 0;
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

function srcPath(dir, filename) {
  return path.join(PHOTO_SRC_ROOT, dir, filename || '');
}

// ---------------------------------------------------------------- 建窗口
const newWindows = [];
const newPhotos = [];
let windowSeq = 0;

const windowSignatures = new Set();

function addWindow({ canteenId, canteenName, number, name, description, photo, items, sourceLabel, sortKey }) {
  const itemKey = canteenId + '|' + (items || []).slice(0, 8).map((i) => i.name).sort().join(',');
  if (!itemKey.endsWith('|') && windowSignatures.has(itemKey)) return; // 同一块牌子的重复照片
  const signature = canteenId + '|' + name + '|' + (items || []).slice(0, 6).map((i) => i.name).join(',');
  if (windowSignatures.has(signature)) return;
  windowSignatures.add(signature);
  if (!itemKey.endsWith('|')) windowSignatures.add(itemKey);
  windowSeq += 1;
  const id = 'w' + canteenId + '-' + windowSeq;
  let cover = null;
  let photoRecord = null;
  if (photo && photo.src) {
    photoRecord = photo;
    cover = photo.src;
    newPhotos.push(photo);
  }
  const dishes = [];
  const seen = new Set();
  items.forEach((item) => {
    const name = String(item.name || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    const est = estimate(name);
    const price = typeof item.price === 'number' ? item.price : null;
    dishes.push({
      id: id + '-' + (dishes.length + 1),
      name,
      price,
      unit: price === null ? '时价' : normalizeUnit(item.unit),
      kcal: est.kcal,
      protein: est.protein,
      fat: est.fat,
      carbs: est.carbs,
      fiber: est.fiber,
      serving: est.serving,
      icon: est.icon,
      labels: labelsFor(name, est, est.tag),
      description: (item.note ? item.note + '。' : '') + (sourceLabel || '窗口价目牌录入') + '；营养为按菜名估算。',
      source: 'AI估算',
    });
  });
  if (!dishes.length) return;
  if (!number) {
    const mergeTarget = newWindows.find((w) => w.canteenId === canteenId && w.number === '' && w.name === name);
    if (mergeTarget) {
      const existingNames = new Set(mergeTarget.dishes.map((d) => d.name));
      dishes.forEach((dish) => {
        if (existingNames.has(dish.name)) return;
        existingNames.add(dish.name);
        mergeTarget.dishes.push(Object.assign({}, dish, { id: mergeTarget.id + '-' + (mergeTarget.dishes.length + 1) }));
      });
      return;
    }
  }
  newWindows.push({
    id,
    canteenId,
    number: number || '',
    name,
    short: description || name,
    description: description || (canteenName + ' ' + name + ' 现场价目牌'),
    cover: cover || 'assets/photos/04.webp',
    position: 'center 40%',
    gallery: photoRecord ? [photoRecord.id] : [],
    dishes,
    __sort: typeof sortKey === 'number' ? sortKey : (number ? Number((String(number).match(/\d+/) || ['500'])[0]) : 600),
  });
}

// ---------------- 研一：12 张窗口价目牌（无窗口号，按主题命名）
const GONG3_THEMES = [
  '扯面', '土豆粉 · 米线', '豆花', '盖饭', '拌饭', '炒饭 · 炒河粉',
  '淮南牛肉汤', '龙虾饭 · 焗饭', '冰淇淋', '咖啡', '五谷豆浆', '饮品小食',
];

yan1Windows.forEach((entry, index) => {
  if (entry.unreadable) return;
  const caption = entry.cardTitle || GONG3_THEMES[index] || '窗口价目牌';
  const photo = photoFor('研一食堂', srcPath('研一照片/窗口', entry.photo), caption);
  addWindow({
    canteenId: 'yan1',
    canteenName: '研一食堂',
    number: '',
    name: GONG3_THEMES[index] || caption,
    description: '研一食堂 · ' + caption + '（价目牌拍摄于 2026.11.26）',
    photo,
    items: entry.items || [],
    sourceLabel: '研一食堂价目牌',
  });
});

// ---------------- 研一：自选称重（屏幕公示营养）
const zixuanItems = [];
let zixuanPhoto = null;
yan1Zixuan.forEach((entry) => {
  if (entry.unreadable || !entry.name) return;
  const photo = photoFor('研一食堂', srcPath('研一照片/自选', entry.photo), entry.name);
  if (!zixuanPhoto && photo) zixuanPhoto = photo;
  const protein = typeof entry.protein === 'number' ? entry.protein : 0;
  const carbs = typeof entry.carbs === 'number' ? entry.carbs : 0;
  const fat = typeof entry.fat === 'number' ? entry.fat : 0;
  zixuanItems.push({
    name: entry.name,
    price: typeof entry.price === 'number' ? entry.price : null,
    unit: '元' + (entry.priceUnit || '/50克'),
    note: '称重台公示' + (entry.cooking ? '（' + entry.cooking + '）' : ''),
    __zixuan: { protein, carbs, fat, kcal: Math.round(protein * 4 + carbs * 4 + fat * 9) },
  });
});

(function addZixuan() {
  if (!zixuanItems.length) return;
  windowSeq += 1;
  const id = 'wyan1-' + windowSeq;
  const dishes = [];
  const seen = new Set();
  zixuanItems.forEach((item) => {
    if (seen.has(item.name)) return;
    seen.add(item.name);
    const est = estimate(item.name);
    const z = item.__zixuan;
    dishes.push({
      id: id + '-' + (dishes.length + 1),
      name: item.name,
      price: item.price,
      unit: '/50g',
      kcal: z.kcal,
      protein: z.protein,
      fat: z.fat,
      carbs: z.carbs,
      fiber: est.fiber,
      serving: 100,
      icon: est.icon,
      labels: labelsFor(item.name, { protein: z.protein, kcal: z.kcal }, ''),
      description: '研一食堂自选称重台，按 50 克计价；营养为称重台屏幕公示值（按每 100 克换算），钠显示为 0 可能是未录入。',
      source: '窗口公示',
    });
  });
  newWindows.push({
    id,
    canteenId: 'yan1',
    number: '',
    name: '自选称重',
    short: '按 50 克称重计价',
    description: '研一食堂自选称重台 · 每道菜屏幕公示营养（2026.11.26）',
    cover: zixuanPhoto ? zixuanPhoto.src : 'assets/photos/04.webp',
    position: 'center 45%',
    gallery: zixuanPhoto ? [zixuanPhoto.id] : [],
    dishes,
  });
  if (zixuanPhoto) newPhotos.push(zixuanPhoto);
})();

// ---------------- 和园：按层 + 窗口号
he.forEach((entry) => {
  const canteenId = entry.floor === '二层' ? 'he2' : 'he1';
  const canteenName = entry.floor === '二层' ? '和园二层' : '和园一层';
  const number = String(entry.windowNumber || '').trim();
  const theme = entry.cardTitle || '';
  const isPaper = (entry.items || []).every((item) => /纸质|广告屏|点餐屏/.test(item.note || '')) && !number;
  const name = number
    ? (theme || '窗口 ' + number)
    : (theme || (isPaper ? '未分窗口' : '风味档口'));
  const photo = photoFor(canteenName, srcPath('西区/' + (entry.floor === '二层' ? '和园二层' : '和园一层'), entry.photo), theme || (number ? number + ' 号窗口' : '价目牌'));
  addWindow({
    canteenId,
    canteenName,
    number,
    name,
    description: (number ? number + ' 号窗口 · ' : '') + (theme || '现场价目牌') + '（拍摄于 2026.11.26）',
    photo,
    items: entry.items || [],
    sourceLabel: canteenName + (number ? ' ' + number + ' 号窗口' : '') + '价目牌',
    sortKey: isPaper ? 9000 : undefined,
  });
});

// ---------------- 颐园一层：按窗口号 / 主题
yi.forEach((entry) => {
  const number = String(entry.windowNumber || '').trim();
  const theme = entry.cardTitle || '';
  const photo = photoFor('颐园一层', srcPath('西区/颐园一层', entry.photo), theme || (number ? number + ' 号窗口' : '价目牌'));
  addWindow({
    canteenId: 'yi1',
    canteenName: '颐园一层',
    number,
    name: theme || (number ? '窗口 ' + number : '未分窗口'),
    description: (number ? number + ' 号窗口 · ' : '') + (theme || '现场价目牌') + '（拍摄于 2026.11.26）',
    photo,
    items: entry.items || [],
    sourceLabel: '颐园一层' + (number ? ' ' + number + ' 号窗口' : '') + '价目牌',
    sortKey: number ? undefined : (/价格表|广告|海报/.test(theme) ? 9000 : undefined),
  });
});

// ---------------------------------------------------------------- 合并
const menu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));

const canteenDefs = [
  { id: 'yan1', name: '研一食堂', alias: '研究生食堂一层', status: 'online' },
  { id: 'he1', name: '和园一层', alias: '和一', status: 'online' },
  { id: 'he2', name: '和园二层', alias: '和二', status: 'online' },
  { id: 'yi1', name: '颐园一层', alias: '颐一', status: 'online' },
  { id: 'yi2', name: '颐园二层', alias: '颐二', status: 'pending' },
  { id: 'yi3', name: '颐园三层', alias: '颐三', status: 'pending' },
];

canteenDefs.forEach((def) => {
  const existing = menu.canteens.find((c) => c.id === def.id);
  if (existing) Object.assign(existing, def);
  else menu.canteens.push(def);
});

// 去掉旧的同名窗口（可重复运行）
const managedCanteens = new Set(['yan1', 'he1', 'he2', 'yi1']);
menu.windows = menu.windows.filter((w) => !managedCanteens.has(w.canteenId));
menu.photos = (menu.photos || []).filter((p) => !/^n\d{3}$/.test(p.id));
const canteenOrder = ['gong1', 'yan1', 'he1', 'he2', 'yi1'];
newWindows.sort((a, b) => {
  const ca = canteenOrder.indexOf(a.canteenId);
  const cb = canteenOrder.indexOf(b.canteenId);
  if (ca !== cb) return ca - cb;
  return a.__sort - b.__sort;
});
newWindows.forEach((w) => { delete w.__sort; });
menu.windows = menu.windows.concat(newWindows);
menu.photos = menu.photos.concat(
  newPhotos.filter((p, index, arr) => arr.findIndex((x) => x.id === p.id) === index)
);

menu.dataDate = '2026-11-26';
menu.nutritionNote =
  '公一 18 号窗口录入自现场公示表；研一自选称重台为屏幕公示值；其余窗口的价目来自现场价目牌，营养为按菜名估算。';

fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2) + '\n');

const dishTotal = menu.windows.reduce((sum, w) => sum + w.dishes.length, 0);
console.log('窗口 ' + menu.windows.length + ' 个，菜品 ' + dishTotal + ' 道，图片 ' + menu.photos.length + ' 张');
console.log('新增食堂：' + canteenDefs.map((c) => c.name).join('、'));
