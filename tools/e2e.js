#!/usr/bin/env node
'use strict';

/**
 * 端到端验收：用 Edge 无头浏览器真实加载页面，验证
 * 菜品目录、排队雷达、点评提交、排队上报与截图。
 *
 * 前置：先在 3999 端口启动 node server.js
 * 用法：node tools/e2e.js [--url http://localhost:3999/] [--out <截图目录>]
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
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9400 + Math.floor(Math.random() * 400);
const PROFILE = path.join(os.tmpdir(), 'nongcanguan-edge-' + Date.now());

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = { steps: [], errors: [], console: [] };
let failed = false;

function record(name, ok, detail) {
  results.steps.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

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
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=' + WIDTH + ',1500',
    URL,
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
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
        if (msg.params.type === 'error') results.console.push(text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        results.errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
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
      if (res.exceptionDetails) {
        throw new Error('页面脚本异常：' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
      }
      return res.result.value;
    };

    const waitFor = async (expression, label, timeoutMs = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evaluate(expression)) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('等待超时：' + label);
    };

    const screenshot = async (name) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, name + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return file;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: 1500,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: URL });
    await waitFor('document.readyState === "complete"', '页面加载完成');
    await new Promise((r) => setTimeout(r, 1200));

    // 0. 入口画面 → 主界面
    await waitFor('!!document.querySelector("#entryScreen")', '入口画面渲染');
    const entryTitle = await evaluate('document.querySelector("#entryScreen h1") ? document.querySelector("#entryScreen h1").textContent.replace(/\\s+/g, "") : ""');
    record('入口画面', entryTitle.includes('今天也要好好吃饭'), entryTitle);
    await screenshot('00-entry');
    await evaluate('document.querySelector("#entryEnter").click(), true');
    await waitFor('document.querySelector("#app") && !document.querySelector("#app").hidden', '进入主界面');
    await new Promise((r) => setTimeout(r, 800));

    // 二级入口：选择食堂
    await waitFor('!!document.querySelector("[data-choose]")', '选择食堂卡片');
    const chooseCount = await evaluate('document.querySelectorAll("[data-choose]").length');
    record('选择食堂（二级入口）', chooseCount >= 4, chooseCount + ' 个食堂可选');
    await screenshot('01b-choose');
    await evaluate('document.querySelector("[data-choose=gong1]").click(), true');
    await new Promise((r) => setTimeout(r, 700));

    const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    record('无横向溢出', overflow <= 1, `宽度 ${WIDTH}px，溢出 ${overflow}px`);

    // 0.1 窗口条：先出现，带排队角标
    await waitFor('document.querySelectorAll("#windowList .window-item").length === 6', '窗口条渲染');
    const stripQueue = await evaluate('(function(){ const el = document.querySelector("[data-window-queue]"); return el ? el.textContent.trim() : ""; })()');
    record('窗口条与排队角标', Boolean(stripQueue), stripQueue);

    // 1. 菜品目录
    await waitFor('document.querySelectorAll(".dish-card").length > 0', '菜品卡片渲染');
    const dishCount = await evaluate('document.querySelectorAll(".dish-card").length');
    const total = await evaluate('typeof allDishes !== "undefined" ? allDishes.length : -1');
    record('菜单目录渲染', dishCount > 0 && total >= 43, `当前窗口 ${dishCount} 张卡片，全站 ${total} 道菜`);

    // 2. 排队雷达
    await waitFor('document.querySelectorAll(".queue-card").length === 6', '排队卡片渲染');
    record('排队雷达渲染', true, '6 个窗口卡片');

    // 3. 搜索与筛选真实生效
    await evaluate(`(function(){ const i=document.querySelector('#searchInput'); i.value='肠粉'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await new Promise((r) => setTimeout(r, 400));
    const searchCount = await evaluate('document.querySelectorAll(".dish-card").length');
    const searchFirst = await evaluate('document.querySelector(".dish-card h3") ? document.querySelector(".dish-card h3").textContent : ""');
    record('搜索联动', searchCount > 0 && searchCount < 43, `"肠粉" 命中 ${searchCount} 道`);
    await evaluate(`document.querySelector('#resetFilters').click(), true`);

    await screenshot('01-home');

    // 4. 打开菜品详情 + 点评模块
    await evaluate(`openDish('w12-1'), true`);
    await waitFor('!!document.querySelector("#reviewForm")', '点评表单挂载');
    const reviewTitle = await evaluate('document.querySelector("#dishDialogContent .detail-title-row h2").textContent');
    record('详情弹层与点评挂载', true, reviewTitle);

    // 5. 提交一条真实点评
    const reviewText = '端到端测试：肉给得足，咸淡正好';
    await evaluate(`(function(){
      document.querySelector('#starPicker [data-star="5"]').click();
      const t = document.querySelector('#reviewText');
      t.value = ${JSON.stringify(reviewText)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#reviewForm').requestSubmit();
      return true;
    })()`);
    await waitFor('document.querySelectorAll(".review-item").length >= 1', '点评发布后渲染', 12000);
    const reviewShown = await evaluate(`(function(){ const list = [...document.querySelectorAll('.review-item p')].map(p => p.textContent); return list.find(t => t === ${JSON.stringify('端到端测试：肉给得足，咸淡正好')}) || list.join(' | '); })()`);
    record('发布点评', reviewShown === '端到端测试：肉给得足，咸淡正好', reviewShown.slice(0, 60));

    // 6. 评分徽章同步（先搜索到该菜品，卡片才会进入 DOM）
    await evaluate(`(function(){ const i=document.querySelector('#searchInput'); i.value='宫保鸡丁'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await new Promise((r) => setTimeout(r, 600));
    const badge = await evaluate(`(function(){ const c=document.querySelector('.dish-card[data-dish="w12-1"] .rating-badge'); return c ? c.textContent : ''; })()`);
    record('菜品卡评分徽章', /★/.test(badge), badge);
    await evaluate(`document.querySelector('#resetFilters').click(), true`);

    await screenshot('02-dish-review');
    await evaluate(`document.querySelector('#dishDialog').close(), true`);

    // 7. 排队上报（每次测试使用新的设备号，避免命中 3 分钟限流）
    await evaluate(`localStorage.setItem('cau-device-id', 'e2e-' + Date.now()), true`);
    const targetWindow = await evaluate(`(function(){ const b=document.querySelector('[data-report]'); return b ? b.getAttribute('data-report') : ''; })()`);
    await evaluate(`document.querySelector('[data-report]').click(), true`);
    await waitFor('document.querySelector("#queueDialog").open', '排队弹层打开');
    await evaluate(`document.querySelector('[data-preset="10"]').click(); document.querySelector('#queueSubmit').click(); true`);
    await waitFor('!document.querySelector("#queueDialog").open', '上报成功关闭弹层', 12000);
    await new Promise((r) => setTimeout(r, 600));
    const queueText = await evaluate(`(function(){ const c=document.querySelector('.queue-card'); return c ? c.textContent.replace(/\\s+/g,' ').trim() : ''; })()`);
    record('排队上报', /10/.test(queueText), `窗口 ${targetWindow}：${queueText.slice(0, 60)}`);

    await screenshot('03-queue');

    // 8. 今日推荐配餐
    await waitFor('document.querySelectorAll(".meal-item").length >= 2', '推荐配餐渲染');
    const mealKcal = await evaluate(`(function(){ const t=document.querySelector('.meal-total strong'); return t ? t.textContent : ''; })()`);
    await evaluate(`document.querySelector('#goalTabs [data-goal="protein"]').click(), true`);
    await new Promise((r) => setTimeout(r, 300));
    const proteinActive = await evaluate(`document.querySelector('#goalTabs [data-goal="protein"]').classList.contains('active')`);
    const mealCount = await evaluate('document.querySelectorAll(".meal-item").length');
    record('今日推荐配餐', proteinActive && mealCount >= 2, `高蛋白方案 ${mealCount} 道，热量 ${mealKcal}`);
    await evaluate(`document.querySelector('#plannerAdd').click(), true`);
    await new Promise((r) => setTimeout(r, 400));
    const trayCount = await evaluate(`document.querySelector('#mobileTrayCount').textContent`);
    record('整餐加入餐盘', Number(trayCount) >= mealCount, '餐盘共 ' + trayCount + ' 道');
    await screenshot('04-planner');

    // 9. 今日盲盒
    await evaluate(`document.querySelector('#boxDraw').click(), true`);
    await waitFor('!!document.querySelector("#boxStage .box-result")', '盲盒抽取', 8000);
    const boxName = await evaluate(`document.querySelector('#boxStage h3') ? document.querySelector('#boxStage h3').textContent : ''`);
    const boxKcal = await evaluate(`document.querySelector('.box-meta') ? document.querySelector('.box-meta').textContent : ''`);
    record('今日盲盒抽取', Boolean(boxName) && /kcal/.test(boxKcal), boxName + ' / ' + boxKcal);
    await evaluate(`document.querySelector('.blindbox-panel').scrollIntoView({ block: 'center' }), true`);
    await new Promise((r) => setTimeout(r, 2600));
    await screenshot('05-blindbox');

    // 9.1 收藏与个人记录
    await evaluate(`(function(){ const nav=document.querySelector('[data-nav="windows"]'); if(nav) nav.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 500));
    await evaluate(`(function(){ const b=document.querySelector('.dish-fav'); if(b) b.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 300));
    const favOn = await evaluate(`!!document.querySelector('.dish-fav.on')`);
    record('菜品收藏', favOn, favOn ? '已点亮' : '未点亮');

    await evaluate(`document.querySelector('#logMealBtn').click(), true`);
    await new Promise((r) => setTimeout(r, 400));
    await evaluate(`(function(){ const nav=document.querySelector('[data-nav="records"]'); if(nav) nav.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 500));
    const recordCell = await evaluate(`(function(){ const c=document.querySelector('#recordsTable .meal-cell'); return c ? c.textContent.replace(/\\s+/g,' ').trim() : ''; })()`);
    record('个人饮食记录', /kcal/.test(recordCell), recordCell.slice(0, 50));
    await screenshot('06-records');

    // 10. 接口与数据一致性
    const summary = await evaluate(`fetch('/api/summary').then(r=>r.json()).then(d=>({queues:Object.keys(d.queues).length, ratings:Object.keys(d.ratings).length, reviews:d.stats.reviews}))`);
    record('后端状态汇总', summary.ratings >= 1 && summary.reviews >= 1, JSON.stringify(summary));

    record('页面无 JS 异常', results.errors.length === 0, results.errors.join(' | ') || '无');

    await screenshot('04-final');
  } catch (err) {
    record('执行', false, err.message);
  } finally {
    try { if (ws) ws.close(); } catch (_) {}
    try { edge.kill(); } catch (_) {}
    results.ok = !failed;
    console.log('\n===== 结果 =====');
    console.log(JSON.stringify(results, null, 2));
    console.log('截图目录：' + OUT_DIR);
    process.exit(failed ? 1 : 0);
  }
})().catch((err) => {
  console.error('致命错误：', err);
  process.exit(1);
});
