#!/usr/bin/env node
'use strict';

/**
 * 手机端版式验收：在 390×844（iPhone 14 尺寸）下走一遍主流程并截图。
 * 前置：node server.js 已在 3999 端口运行
 * 用法：node tools/mobile-shots.js [--url http://localhost:3999/] [--out <目录>] [--width 390] [--height 844]
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

const URL = getArg('--url', 'http://localhost:3999/');
const OUT_DIR = getArg('--out', path.join(os.tmpdir(), 'nongcanguan-mobile'));
const WIDTH = Number(getArg('--width', '390')) || 390;
const HEIGHT = Number(getArg('--height', '844')) || 844;
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9600 + Math.floor(Math.random() * 300);
const PROFILE = path.join(os.tmpdir(), 'nongcanguan-mobile-' + Date.now());

fs.mkdirSync(OUT_DIR, { recursive: true });

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
  }).on('error', reject);
});

async function waitForPort(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      const page = targets.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (_) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Edge 调试端口未就绪');
}

(async () => {
  if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge：' + EDGE);
  spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE, '--window-size=' + WIDTH + ',' + HEIGHT, URL,
  ], { stdio: 'ignore' });

  const target = await waitForPort();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('页面脚本异常：' + res.exceptionDetails.text);
    return res.result.value;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await wait(420);
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT_DIR, name + '.png');
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log('shot ' + file);
  };
  const scrollTo = async (y) => { await evaluate('window.scrollTo(0,' + y + '), true'); await wait(350); };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL });
  await wait(1800);

  await shot('01-entry');
  await evaluate("document.querySelector('#entryEnter').click(), true");
  await wait(1000);
  await shot('02-choose');

  await evaluate("document.querySelector('[data-choose=\"gong1\"]').click(), true");
  await wait(1200);
  await shot('03-windows');

  await scrollTo(520);
  await shot('04-dish-list');

  await scrollTo(1300);
  await shot('05-dish-list-2');

  await evaluate("document.querySelector('[data-photo]').click(), true");
  await wait(700);
  await shot('06-photo-dialog');
  await evaluate("document.querySelector('#photoDialog').close(), true");
  await wait(300);

  await evaluate("document.querySelector('.mn-item[data-nav=\"points\"]').click(), true");
  await wait(900);
  await shot('07-points');

  await evaluate("document.querySelector('.mn-item[data-nav=\"favorites\"]').click(), true");
  await wait(600);
  await shot('08-favorites');

  const metrics = await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.dish-card'));
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    return {
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowX: overflow,
      navVisible: getComputedStyle(document.querySelector('.mobile-nav')).display,
      navHeight: document.querySelector('.mobile-nav').offsetHeight,
      cards: cards.length,
      photoButtons: document.querySelectorAll('.dish-photo-btn').length,
      firstCardWidth: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
      tappedSize: (() => { const b = document.querySelector('.dish-add-button'); return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
    };
  })()`);
  console.log(JSON.stringify(metrics, null, 2));
  console.log(errors.length ? 'JS 异常：' + errors.join('\n') : '页面无 JS 异常');

  ws.close();
  process.exit(0);
})().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
