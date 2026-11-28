#!/usr/bin/env node
'use strict';

/**
 * 按「具体菜名」从 Wikimedia Commons 抓图，一个菜一张，只收标题能对上的。
 *
 * 每条规则是「菜名关键词 → 检索词」，只有菜单里出现该关键词时才用这张图；
 * 因此不会出现「白灼大虾配一张炒面图」这种货不对版的情况——对不上就不配图。
 *
 * 用法：node tools/fetch-dish-photos.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'dishes');
const META_FILE = path.join(__dirname, 'data', 'dish-photos.json');

// 关键词用于匹配菜单菜名；query 是去 Commons 检索用的词；expect 是标题里必须出现的词
const DISHES = [
  { key: 'gongbao', keywords: ['宫保鸡丁', '宫爆鸡丁'], query: 'kung pao chicken', expect: /kung pao/i },
  { key: 'mapo-tofu', keywords: ['麻婆豆腐'], query: 'mapo tofu', expect: /mapo/i },
  { key: 'tomato-egg', keywords: ['番茄炒蛋', '西红柿炒蛋', '番茄鸡蛋', '西红柿鸡蛋'], query: 'tomato scrambled eggs', expect: /tomato/i },
  { key: 'hongshaorou', keywords: ['红烧肉'], query: 'hong shao rou', expect: /hong shao|braised pork/i },
  { key: 'yuxiang-rousi', keywords: ['鱼香肉丝'], query: 'yuxiang shredded pork', expect: /yuxiang|fish.fragrant/i },
  { key: 'shuizhuyu', keywords: ['水煮鱼'], query: 'boiled fish Sichuan', expect: /boiled fish|shui zhu/i },
  { key: 'jiaozi', keywords: ['饺子', '水饺', '蒸饺'], query: 'jiaozi dumplings', expect: /jiaozi|dumpling/i },
  { key: 'baozi', keywords: ['包子', '肉包', '菜包'], query: 'baozi', expect: /baozi|bao\b/i },
  { key: 'lamian', keywords: ['拉面', '牛肉面', '刀削面'], query: 'Lanzhou beef noodles', expect: /lanzhou|beef noodle/i },
  { key: 'chaofan', keywords: ['炒饭'], query: 'fried rice', expect: /fried rice/i },
  { key: 'chaomian', keywords: ['炒面', '炒河粉', '炒粉'], query: 'chow mein', expect: /chow mein|fried noodle/i },
  { key: 'mifan', keywords: ['米饭', '盖饭', '盖浇饭'], query: 'steamed rice bowl', expect: /rice/i },
  { key: 'zhou', keywords: ['粥', '稀饭'], query: 'congee', expect: /congee|porridge/i },
  { key: 'doujiang', keywords: ['豆浆'], query: 'soy milk', expect: /soy/i },
  { key: 'latte', keywords: ['拿铁', '美式', '卡布奇诺', '咖啡'], query: 'latte art coffee', expect: /latte|cappuccino|coffee/i },
  { key: 'bingqilin', keywords: ['冰淇淋', '冰激凌', '雪糕'], query: 'ice cream cone', expect: /ice cream/i },
  { key: 'douhua', keywords: ['豆花', '豆腐脑'], query: 'douhua tofu pudding', expect: /douhua|tofu pudding|tofu/i },
  { key: 'tanghulu', keywords: ['糖葫芦'], query: 'tanghulu', expect: /tanghulu|candied/i },
  { key: 'kaoya', keywords: ['烤鸭'], query: 'Peking duck', expect: /peking duck|roast duck/i },
  { key: 'malatang', keywords: ['麻辣烫'], query: 'malatang', expect: /malatang|hot pot/i },
  { key: 'huoguo', keywords: ['火锅'], query: 'Chinese hot pot', expect: /hot ?pot/i },
  { key: 'jianbing', keywords: ['煎饼'], query: 'jianbing', expect: /jianbing/i },
  { key: 'roujiamo', keywords: ['肉夹馍'], query: 'roujiamo', expect: /roujiamo|chinese hamburger/i },
  { key: 'youtiao', keywords: ['油条'], query: 'youtiao', expect: /youtiao|fried dough/i },
  { key: 'bao', keywords: ['馒头', '花卷'], query: 'mantou steamed bun', expect: /mantou|steamed bun/i },
  { key: 'bing', keywords: ['饼'], query: 'Chinese pancake bing', expect: /bing|pancake/i },
  { key: 'miantiao', keywords: ['面条', '面'], query: 'Chinese noodle soup', expect: /noodle/i },
  { key: 'qingcai', keywords: ['青菜', '时蔬', '炒菜'], query: 'stir fried greens Chinese', expect: /stir.?fried|greens|vegetable/i },
  { key: 'yu', keywords: ['鱼'], query: 'steamed fish Chinese', expect: /fish/i },
  { key: 'xia', keywords: ['虾'], query: 'steamed shrimp', expect: /shrimp|prawn/i },
];

const OK_LICENSE = /(cc0|public domain|cc[ -]by(-sa)?)/i;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nongcanguan-demo/1.0 (student project)' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nongcanguan-demo/1.0 (student project)' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(dest); });
    }).on('error', reject);
  });
}

const stripHtml = (v) => String(v || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function pick(dish) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + '&gsrsearch=' + encodeURIComponent(dish.query + ' filetype:bitmap')
    + '&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json';
  const data = await getJson(url);
  const pages = Object.values((data.query && data.query.pages) || {});
  for (const page of pages) {
    const info = (page.imageinfo || [])[0];
    if (!info || !info.thumburl) continue;
    const title = page.title.replace(/^File:/, '');
    if (!dish.expect.test(title)) continue;               // 标题对不上就跳过
    const meta = info.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
    if (!OK_LICENSE.test(license)) continue;
    return { key: dish.key, title, thumb: info.thumburl, pageUrl: info.descriptionurl, license, artist: stripHtml(meta.Artist && meta.Artist.value).slice(0, 60) };
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (_) { previous = []; }
  const results = previous.slice();
  for (const dish of DISHES) {
    const done = results.find((r) => r.key === dish.key);
    if (done && fs.existsSync(path.join(__dirname, '..', 'public', done.src))) { continue; }
    try {
      let found = null;
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        try { found = await pick(dish); } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); }
      }
      if (!found) { console.log('SKIP ' + dish.key + '（没有标题对得上的图）'); continue; }
      const ext = /\.png$/i.test(found.thumb) ? '.png' : '.jpg';
      const dest = path.join(OUT_DIR, dish.key + ext);
      await download(found.thumb, dest);
      console.log('OK ' + dish.key + ' ← ' + found.title + ' (' + found.license + ')');
      results.push({ ...found, keywords: dish.keywords, src: 'assets/dishes/' + dish.key + ext });
      await new Promise((r) => setTimeout(r, 1200));
    } catch (error) {
      console.log('FAIL ' + dish.key + ': ' + error.message);
    }
  }
  fs.writeFileSync(META_FILE, JSON.stringify(results, null, 2) + '\n');
  console.log('\n共 ' + results.length + ' 道菜有专属配图');
})();
