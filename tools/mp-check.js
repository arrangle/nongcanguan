#!/usr/bin/env node
'use strict';

/**
 * 小程序静态自检（无需开发者工具）：
 *  1. JS 语法（node --check）
 *  2. JSON 可解析
 *  3. WXML 标签闭合、wx:for 是否带 wx:key
 *  4. WXML 里 bind/catch 的事件处理函数是否在页面 JS 中定义
 *
 * 用法：node tools/mp-check.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
let failed = 0;

function fail(file, message) {
  failed++;
  console.log('FAIL ' + path.relative(ROOT, file) + ' — ' + message);
}

function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

const files = walk(ROOT);
// WXML 里 input / image 通常写成自闭合；这里只认显式的 "/>"，其余都要求闭合
const VOID = new Set();

// 1 & 2. JS / JSON
files.filter((f) => f.endsWith('.js')).forEach((file) => {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(file, '语法错误 ' + String(err.stderr || err.message).split('\n')[0]);
  }
});

files.filter((f) => f.endsWith('.json')).forEach((file) => {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(file, 'JSON 解析失败 ' + err.message);
  }
});

// 3 & 4. WXML
files.filter((f) => f.endsWith('.wxml')).forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z-]+)([^>]*?)(\/?)>/g;
  let match;
  while ((match = tagRe.exec(source))) {
    const [, closing, tag, attrs, selfClose] = match;
    if (closing) {
      const open = stack.pop();
      if (open !== tag) fail(file, '标签不匹配：期望 </' + open + '>，实际 </' + tag + '>');
    } else if (!selfClose && !VOID.has(tag)) {
      stack.push(tag);
    }
    if (!closing && /\bwx:for=/.test(attrs) && !/\bwx:key=/.test(attrs) && !/\bwx:for-item=/.test(attrs)) {
      fail(file, 'wx:for 缺少 wx:key（<' + tag + '>）');
    }
  }
  if (stack.length) fail(file, '有未闭合标签：' + stack.join(' > '));

  const jsFile = file.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsFile)) return;
  const js = fs.readFileSync(jsFile, 'utf8');
  const handlerRe = /\b(?:bind|catch):?([a-zA-Z]+)="([a-zA-Z_$][\w$]*)"/g;
  let handler;
  const missing = new Set();
  while ((handler = handlerRe.exec(source))) {
    const name = handler[2];
    const defined = new RegExp('(^|\\s)' + name + '\\s*\\(', 'm').test(js);
    if (!defined) missing.add(name);
  }
  if (missing.size) fail(file, '事件处理函数未定义：' + [...missing].join(', '));
});

// 页面注册检查：app.json 里的每个页面都有四件套
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
app.pages.forEach((page) => {
  ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
    const file = path.join(ROOT, page + ext);
    if (!fs.existsSync(file)) fail(file, 'app.json 声明了 ' + page + '，缺少 ' + ext);
  });
});
(app.tabBar && app.tabBar.list ? app.tabBar.list : []).forEach((item) => {
  if (app.pages.indexOf(item.pagePath) === -1) fail(path.join(ROOT, 'app.json'), 'tabBar 指向未注册页面 ' + item.pagePath);
});

console.log(failed ? '\n共 ' + failed + ' 处问题' : '\n小程序静态自检通过：' + files.length + ' 个文件');
process.exit(failed ? 1 : 0);
