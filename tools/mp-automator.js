#!/usr/bin/env node
'use strict';

/**
 * 小程序页面自动截图 + 冒烟断言（需要微信开发者工具已登录）
 *
 * 前置：
 *   1. node server.js 在 3000 端口运行
 *   2. 在开发者工具目录执行：
 *        cli auto --project <仓库路径> --auto-port 9420
 *   3. npm i miniprogram-automator（可装在临时目录，用 NODE_PATH 指向）
 *
 * 用法：
 *   NODE_PATH=/path/to/node_modules node tools/mp-automator.js --out <截图目录>
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

const OUT = getArg('--out', path.join(os.tmpdir(), 'mp-shots'));
const WS = getArg('--ws', 'ws://localhost:9420');
const automator = require('miniprogram-automator');

fs.mkdirSync(OUT, { recursive: true });
let failed = 0;

function check(name, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: WS });
  await miniProgram.reLaunch('/pages/index/index');
  await new Promise((r) => setTimeout(r, 2500));

  const pages = [
    ['index', '/pages/index/index', '.win-card'],
    ['menu', '/pages/menu/menu', '.dish'],
    ['queue', '/pages/queue/queue', '.qcard, .queue-card, .qitem'],
    ['mine', '/pages/mine/mine', '.log-table'],
  ];

  for (const [name, route, selector] of pages) {
    if (name !== 'index') {
      await miniProgram.reLaunch(route);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const page = await miniProgram.currentPage();
    const elements = await page.$$(selector);
    check('页面 ' + route, elements.length > 0, selector + ' × ' + elements.length);
    await miniProgram.screenshot({ path: path.join(OUT, 'mp-' + name + '.png') });
  }

  // 食堂切换：公三应有 12 个窗口
  await miniProgram.reLaunch('/pages/index/index');
  await new Promise((r) => setTimeout(r, 2000));
  const home = await miniProgram.currentPage();
  const canteenEls = await home.$$('.canteen');
  check('食堂列表', canteenEls.length >= 6, '共 ' + canteenEls.length + ' 个食堂');
  if (canteenEls[2]) {
    await canteenEls[2].tap();
    await new Promise((r) => setTimeout(r, 1800));
    const wins = await home.$$('.win-card');
    check('公三窗口条', wins.length >= 10, '公三 ' + wins.length + ' 个窗口');
    await miniProgram.screenshot({ path: path.join(OUT, 'mp-gong3.png') });
  }

  // 我的页：先往餐盘放一道菜，再点「记下这一餐」，表格里应出现 kcal
  await miniProgram.callWxMethod('setStorageSync', 'tray', [{ id: 'w12-1', factor: 1, qty: 1 }]);
  await miniProgram.callWxMethod('removeStorageSync', 'nongcanguan-meal-log');
  await miniProgram.reLaunch('/pages/mine/mine');
  await new Promise((r) => setTimeout(r, 2000));
  const mine = await miniProgram.currentPage();
  const logBtn = await mine.$('.log-btn');
  check('记录按钮存在', Boolean(logBtn));
  if (logBtn) {
    await logBtn.tap();
    await new Promise((r) => setTimeout(r, 1500));
  }
  const kcalCells = await mine.$$('.log-kcal');
  check('个人记录写入', kcalCells.length > 0, '表格里 ' + kcalCells.length + ' 格有记录');
  await miniProgram.screenshot({ path: path.join(OUT, 'mp-mine-logged.png') });

  await miniProgram.disconnect();
  console.log(failed ? '\n有 ' + failed + ' 项未通过' : '\n小程序页面检查通过');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('失败：' + error.message);
  process.exit(1);
});
