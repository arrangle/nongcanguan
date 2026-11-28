#!/usr/bin/env node
'use strict';

/**
 * 从 Wikimedia Commons 抓取可自由使用的菜品示意图（CC0 / 公有领域 / CC BY / CC BY-SA）。
 * 每类只取一张，下载 800px 缩略图到 public/assets/dishes/，并记录来源与许可到
 * tools/data/dish-photos.json（用于生成 docs/图片来源.md 的署名）。
 *
 * 用法：node tools/fetch-dish-photos.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'dishes');
const META_FILE = path.join(__dirname, 'data', 'dish-photos.json');

const CATEGORIES = [
  { key: 'noodle-soup', query: 'Chinese noodle soup bowl' },
  { key: 'fried-noodles', query: 'chow mein noodles' },
  { key: 'rice-bowl', query: 'rice bowl Chinese food' },
  { key: 'fried-rice', query: 'fried rice' },
  { key: 'dumplings', query: 'jiaozi dumplings plate' },
  { key: 'baozi', query: 'baozi steamed bun' },
  { key: 'mapo-tofu', query: 'mapo tofu' },
  { key: 'tomato-egg', query: 'tomato scrambled eggs Chinese' },
  { key: 'kung-pao', query: 'kung pao chicken' },
  { key: 'braised-pork', query: 'hong shao rou braised pork belly' },
  { key: 'greens', query: 'stir fried vegetables Chinese' },
  { key: 'soup', query: 'Chinese soup bowl' },
  { key: 'congee', query: 'congee rice porridge' },
  { key: 'seafood', query: 'steamed fish Chinese' },
  { key: 'shrimp', query: 'stir fried shrimp Chinese' },
  { key: 'dessert', query: 'tanghulu candied hawthorn' },
  { key: 'soy-milk', query: 'soy milk glass' },
  { key: 'coffee', query: 'latte coffee cup' },
  { key: 'roast-duck', query: 'Peking duck' },
  { key: 'pancake', query: 'Chinese pancake bing' },
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

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function pick(category) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + '&gsrsearch=' + encodeURIComponent(category.query + ' filetype:bitmap')
    + '&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json';
  const data = await getJson(url);
  const pages = Object.values((data.query && data.query.pages) || {});
  for (const page of pages) {
    const info = (page.imageinfo || [])[0];
    if (!info || !info.thumburl) continue;
    const meta = info.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
    if (!OK_LICENSE.test(license)) continue;
    return {
      key: category.key,
      title: page.title.replace(/^File:/, ''),
      thumb: info.thumburl,
      pageUrl: info.descriptionurl,
      license,
      artist: stripHtml(meta.Artist && meta.Artist.value).slice(0, 60),
    };
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const category of CATEGORIES) {
    try {
      let found = null;
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        try { found = await pick(category); } catch (e) {
          if (attempt === 2) throw e;
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        }
      }
      if (!found) { console.log('SKIP ' + category.key + '（没有合规图片）'); continue; }
      const ext = /\.png$/i.test(found.thumb) ? '.png' : '.jpg';
      const dest = path.join(OUT_DIR, category.key + ext);
      await download(found.thumb, dest);
      const size = Math.round(fs.statSync(dest).size / 1024);
      console.log('OK ' + category.key + ' ← ' + found.title + ' (' + found.license + ', ' + size + 'KB)');
      results.push({ ...found, src: 'assets/dishes/' + category.key + ext });
      await new Promise((r) => setTimeout(r, 1500));
    } catch (error) {
      console.log('FAIL ' + category.key + ': ' + error.message);
    }
  }
  fs.writeFileSync(META_FILE, JSON.stringify(results, null, 2) + '\n');
  console.log('\n共 ' + results.length + ' 张，元数据 -> ' + path.relative(path.join(__dirname, '..'), META_FILE));
})();
