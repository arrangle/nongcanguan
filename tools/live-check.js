#!/usr/bin/env node
'use strict';

/**
 * 线上页面自检：打开一个地址，打印页面里真实的数据量、窗口卡片数、控制台异常。
 * 用法：node tools/live-check.js --url https://xxx/ [--canteen gong3]
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

const URL = getArg('--url', 'http://localhost:3000/');
const CANTEEN = getArg('--canteen', '');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const PROFILE = path.join(os.tmpdir(), 'live-check-' + Date.now());

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,1200', URL,
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const targets = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (_) { /* 等端口 */ }
    if (!page) await new Promise((r) => setTimeout(r, 300));
  }
  if (!page) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text + ' ' + ((msg.params.exceptionDetails.exception || {}).description || ''));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) return 'ERR: ' + res.exceptionDetails.text;
    return res.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 12000));

  if (CANTEEN) {
    await evaluate("document.querySelector('[data-canteen=\"" + CANTEEN + "\"]').click(), true");
    await new Promise((r) => setTimeout(r, 1200));
  }

  const info = await evaluate(`(function(){
    return {
      apiWindows: typeof windows !== 'undefined' ? windows.length : null,
      apiCanteens: typeof canteens !== 'undefined' ? canteens.length : null,
      activeCanteen: typeof state !== 'undefined' ? state.canteenId : null,
      cards: document.querySelectorAll('.window-item').length,
      dishes: document.querySelectorAll('.dish-card').length,
      statWindows: (document.querySelector('#statWindows') || {}).textContent,
      statDishes: (document.querySelector('#statDishes') || {}).textContent,
      emptyHint: !!(document.querySelector('#windowEmpty') && !document.querySelector('#windowEmpty').hidden),
      gridText: (document.querySelector('#dishGrid') || {}).innerText ? document.querySelector('#dishGrid').innerText.slice(0, 160) : ''
    };
  })()`);

  console.log(JSON.stringify(info, null, 1));
  console.log(errors.length ? '异常：' + errors.join(' | ') : '无 JS 异常');

  try { ws.close(); } catch (_) {}
  edge.kill();
})().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
