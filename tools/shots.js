#!/usr/bin/env node
'use strict';

/**
 * 版式验收截图：入口画面 → 窗口 → 预测 → 个人记录 → 排行榜 → 其他功能
 * 前置：node server.js 已在 3999 端口运行
 * 用法：node tools/shots.js [--url http://localhost:3999/] [--out <目录>]
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
const OUT_DIR = getArg('--out', path.join(os.tmpdir(), 'nongcanguan-shots'));
const WIDTH = Number(getArg('--width', '1440')) || 1440;
const HEIGHT = Number(getArg('--height', '1250')) || 1250;
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 400);
const PROFILE = path.join(os.tmpdir(), 'nongcanguan-shots-' + Date.now());

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
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE, '--window-size=' + WIDTH + ',' + HEIGHT, URL,
  ], { stdio: 'ignore' });

  let ws;
  try {
    const target = await waitForPort();
    ws = new WebSocket(target.webSocketDebuggerUrl);
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
        const d = msg.params.exceptionDetails;
        errors.push(d.text + ' ' + ((d.exception && d.exception.description) || ''));
      }
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
      await wait(450);
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUT_DIR, name + '.png');
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
      console.log('shot ' + file);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url: URL });
    await wait(1600);

    await shot('01-entry');

    await evaluate("document.querySelector('#entryEnter').click(), true");
    await wait(900);
    await shot('02-windows');

    await evaluate("document.querySelector('[data-nav=\"predict\"]').click(), true");
    await wait(700);
    await shot('03-predict');

    await evaluate("document.querySelector('[data-nav=\"records\"]').click(), true");
    await wait(500);
    await shot('04-records');

    await evaluate("document.querySelector('[data-nav=\"rank\"]').click(), true");
    await wait(700);
    await shot('05-rank');

    await evaluate("document.querySelector('[data-nav=\"more\"]').click(), true");
    await wait(500);
    await shot('06-more');

    await evaluate("document.querySelector('[data-nav=\"windows\"]').click(), true");
    await wait(500);
    await evaluate("(function(){ const c=document.querySelector('.dish-card'); if(c) c.click(); return true; })()");
    await wait(900);
    await shot('07-dish-detail');

    console.log(errors.length ? '页面异常：' + errors.join(' | ') : '页面无 JS 异常');
  } finally {
    try { ws && ws.close(); } catch (_) {}
    edge.kill();
  }
})().catch((error) => {
  console.error('失败：' + error.message);
  process.exit(1);
});
