#!/usr/bin/env node
'use strict';

/**
 * 一次性工具：从队友的静态站点 app.js 中提取 windows / dishes 数据。
 * 安全解析：只做文本扫描，绝不 eval / require 被解析文件。
 *
 * 用法：node tools/extract-teammate.js <app.js 路径> [--out <json 路径>]
 */

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/extract-teammate.js <app.js> [--out <json>]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? path.resolve(process.argv[outIdx + 1]) : null;

const src = fs.readFileSync(file, 'utf8');

// ---------- 通用扫描器 ----------
function skipString(text, i) {
  const q = text[i];
  i++;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === q) return i + 1;
    i++;
  }
  throw new Error('未闭合的字符串');
}

function balancedEnd(text, start, open, close) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  throw new Error('括号未闭合');
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseLiteral(raw) {
  const s = raw.trim();
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) {
    const body = s.slice(1, -1);
    return body.replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n');
  }
  if (s.startsWith('[')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map(parseLiteral);
  }
  return s; // 兜底：原样保留，便于人工检查
}

function field(objText, name) {
  const re = new RegExp('(?:^|[,\\s{])' + name + '\\s*:\\s*([^,\\n]+)');
  const m = objText.match(re);
  if (!m) return undefined;
  // 值的边界：遇到顶层逗号结束
  const start = objText.indexOf(m[1], m.index + name.length);
  const valueText = captureValue(objText, start);
  return parseLiteral(valueText);
}

function captureValue(text, start) {
  const c = text[start];
  if (c === '"' || c === "'" || c === '`') {
    const end = skipString(text, start);
    return text.slice(start, end);
  }
  if (c === '[') {
    const end = balancedEnd(text, start, '[', ']');
    return text.slice(start, end);
  }
  if (c === '{') {
    const end = balancedEnd(text, start, '{', '}');
    return text.slice(start, end);
  }
  let i = start;
  while (i < text.length && text[i] !== ',' && text[i] !== '\n') i++;
  return text.slice(start, i).trim();
}

// ---------- 定位 windows 数组 ----------
const marker = src.indexOf('const windows');
if (marker < 0) throw new Error('找不到 const windows');
const arrStart = src.indexOf('[', marker);
const arrEnd = balancedEnd(src, arrStart, '[', ']');
const arrText = src.slice(arrStart + 1, arrEnd - 1);

// ---------- 遍历窗口对象 ----------
const windows = [];
let i = 0;
while (i < arrText.length) {
  if (arrText[i] === '{') {
    const end = balancedEnd(arrText, i, '{', '}');
    const objText = arrText.slice(i + 1, end - 1);
    windows.push(parseWindow(objText));
    i = end;
  } else {
    i++;
  }
}

function parseWindow(objText) {
  const w = {
    id: field(objText, 'id'),
    number: field(objText, 'number'),
    name: field(objText, 'name'),
    short: field(objText, 'short'),
    cover: field(objText, 'cover'),
    gallery: field(objText, 'gallery') || [],
    position: field(objText, 'position') || 'center',
    description: field(objText, 'description'),
    dishes: [],
  };

  const dIdx = objText.indexOf('dishes');
  if (dIdx >= 0) {
    const bracket = objText.indexOf('[', dIdx);
    if (bracket >= 0) {
      const dEnd = balancedEnd(objText, bracket, '[', ']');
      const dText = objText.slice(bracket + 1, dEnd - 1);
      let k = 0;
      while (k < dText.length) {
        const call = dText.indexOf('dish(', k);
        if (call < 0) break;
        const pStart = call + 4;
        const pEnd = balancedEnd(dText, pStart, '(', ')');
        const argsText = dText.slice(pStart + 1, pEnd - 1);
        const args = splitTopLevel(argsText).map(parseLiteral);
        const [windowId, index, name, price, unit, kcal, protein, fat, carbs, fiber, serving, icon, labels, description, source] = args;
        w.dishes.push({
          id: `${windowId}-${index}`,
          windowId,
          index,
          name,
          price,
          unit,
          kcalPer100g: kcal,
          proteinPer100g: protein,
          fatPer100g: fat,
          carbsPer100g: carbs,
          fiberPer100g: fiber,
          servingGrams: serving,
          icon,
          labels,
          description,
          source: source || 'AI估算',
        });
        k = pEnd;
      }
    }
  }
  return w;
}

const result = {
  extractedAt: new Date().toISOString(),
  source: path.basename(file),
  windowCount: windows.length,
  dishCount: windows.reduce((n, w) => n + w.dishes.length, 0),
  windows,
};

const json = JSON.stringify(result, null, 2);
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, json, 'utf8');
  console.log(`已写入 ${outFile}`);
} else {
  console.log(json);
}
console.log(`窗口 ${result.windowCount} 个，菜品 ${result.dishCount} 道`);
for (const w of windows) {
  console.log(`  ${w.number || '-'} 号 ${w.name}：${w.dishes.length} 道${w.cover ? '，封面 ' + w.cover : ''}`);
}
