#!/usr/bin/env node
'use strict';

/**
 * 农餐馆 · 农大智慧餐厅 —— 后端
 * 菜品目录来自 data/menu.json；排队与点评是共享状态，落在 data/db.json。
 * 零依赖，Node 18+。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const MENU_FILE = process.env.MENU_FILE ? path.resolve(process.env.MENU_FILE) : path.join(DATA_DIR, 'menu.json');
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'db.json');
if (process.env.DB_FILE || process.env.MENU_FILE) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const UPLOAD_DIR = path.join(path.dirname(DB_FILE), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || '';

const MAX_BODY = 256 * 1024;
const MAX_PHOTO_BODY = 4 * 1024 * 1024; // base64 后会膨胀约 4/3，留足余量
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_COOLDOWN_MS = 10 * 1000;
const PHOTO_DAILY_LIMIT = 20;
const QUEUE_WINDOW_MS = 20 * 60 * 1000; // 20 分钟内的上报参与聚合
const REPORT_COOLDOWN_MS = 3 * 60 * 1000; // 同设备同窗口 3 分钟一次
const REVIEW_OVERWRITE_MS = 24 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------- 目录数据
function loadMenu() {
  try {
    const raw = fs.readFileSync(MENU_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.windows)) throw new Error('menu.json 缺少 windows');
    return parsed;
  } catch (err) {
    console.error(`[菜单] 读取失败：${err.message}`);
    return { version: 1, title: '农餐馆', windows: [], canteens: [], photos: [] };
  }
}

let menu = loadMenu();
let windows = menu.windows.slice();
let windowById = new Map();
let dishIndex = new Map();

function reindex() {
  windowById = new Map();
  dishIndex = new Map();
  for (const w of windows) {
    windowById.set(w.id, w);
    for (const d of w.dishes || []) dishIndex.set(d.id, { dish: d, window: w });
  }
}
reindex();

// ---------------------------------------------------------------- 运行库
function emptyDb() {
  return { version: 2, createdAt: Date.now(), reviews: [], queueReports: [], dishPhotos: {}, points: {} };
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.reviews) || !Array.isArray(parsed.queueReports)) {
      throw new Error('结构不合法');
    }
    // 老数据平滑升级：补上图片库与积分表
    if (!parsed.dishPhotos || typeof parsed.dishPhotos !== 'object') parsed.dishPhotos = {};
    if (!parsed.points || typeof parsed.points !== 'object') parsed.points = {};
    parsed.version = 2;
    return parsed;
  } catch (err) {
    if (fs.existsSync(DB_FILE)) console.error(`[数据] db.json 读取失败，将重建：${err.message}`);
    return emptyDb();
  }
}

let db = loadDb();

let writeChain = Promise.resolve();
function saveDb() {
  const payload = JSON.stringify(db, null, 2) + '\n';
  writeChain = writeChain
    .then(() => new Promise((resolve, reject) => {
      const tmp = DB_FILE + '.tmp';
      fs.writeFile(tmp, payload, 'utf8', (err) => {
        if (err) return reject(err);
        fs.rename(tmp, DB_FILE, (renameErr) => (renameErr ? reject(renameErr) : resolve()));
      });
    }))
    .catch((err) => console.error('[数据] 写入失败：', err.message));
  return writeChain;
}

function persist() {
  saveDb().catch(() => {});
}

// ---------------------------------------------------------------- 派生
function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function queueView(windowId, now = Date.now()) {
  const all = db.queueReports.filter((r) => r.windowId === windowId);
  if (!all.length) return null;
  const recent = all.filter((r) => now - r.ts <= QUEUE_WINDOW_MS).sort((a, b) => b.ts - a.ts).slice(0, 5);
  const pool = recent.length ? recent : all.slice().sort((a, b) => b.ts - a.ts).slice(0, 5);
  const latest = pool[0];
  const people = median(pool.map((r) => r.people));
  const ageMin = Math.max(0, Math.floor((now - latest.ts) / 60000));
  return {
    people,
    ageMin,
    stale: ageMin > 20,
    waitMin: Math.max(0, Math.round(people * 0.4)),
    updatedAt: latest.ts,
    reportCount: pool.length,
  };
}

function dishStats(dishId) {
  const list = db.reviews.filter((r) => r.dishId === dishId);
  if (!list.length) return { rating: null, reviewCount: 0 };
  const avg = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
  return { rating: Math.round(avg * 10) / 10, reviewCount: list.length };
}

function publicReview(review) {
  return {
    id: review.id,
    dishId: review.dishId,
    rating: review.rating,
    text: review.text,
    author: review.author,
    ts: review.ts,
    likes: review.likes || 0,
  };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function stats() {
  const since = startOfToday();
  const now = Date.now();
  const ratings = db.reviews.map((r) => r.rating);
  const active = windows.filter((w) => {
    const q = queueView(w.id, now);
    return q && !q.stale;
  }).length;
  return {
    windows: windows.length,
    dishes: dishIndex.size,
    reviews: db.reviews.length,
    reviewsToday: db.reviews.filter((r) => r.ts >= since).length,
    reportsToday: db.queueReports.filter((r) => r.ts >= since).length,
    activeWindows: active,
    avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
  };
}

function summary() {
  const now = Date.now();
  const queues = {};
  for (const w of windows) {
    const q = queueView(w.id, now);
    if (q) queues[w.id] = q;
  }
  const ratings = {};
  for (const id of dishIndex.keys()) {
    const s = dishStats(id);
    if (s.reviewCount) ratings[id] = s;
  }
  return { queues, ratings, stats: stats() };
}

// ---------------------------------------------------------------- 积分
const POINT_RULES = [
  { type: 'photo_first', label: '首次上传菜品实拍图', points: 20, dailyCap: 100, hint: '同一道菜只算一次，每天图片积分最多 100' },
  { type: 'photo_more', label: '补充同一菜品的其它照片', points: 5, dailyCap: 100, hint: '这道菜已经有图时，再传一张算补充' },
  { type: 'review', label: '点评一道菜', points: 5, dailyCap: 30, hint: '24 小时内重复评价同一道菜不重复计分' },
  { type: 'queue', label: '上报一次窗口排队', points: 2, dailyCap: 20, hint: '同一窗口 3 分钟内只算一次' },
];
const RULE_BY_TYPE = new Map(POINT_RULES.map((r) => [r.type, r]));

function dayKey(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pointsRecord(deviceId) {
  if (!db.points[deviceId]) db.points[deviceId] = { total: 0, events: [], days: {}, uploads: {} };
  const rec = db.points[deviceId];
  if (!Array.isArray(rec.events)) rec.events = [];
  if (!rec.days || typeof rec.days !== 'object') rec.days = {};
  if (!rec.uploads || typeof rec.uploads !== 'object') rec.uploads = {};
  if (typeof rec.total !== 'number') rec.total = 0;
  return rec;
}

function awardPoints(deviceId, type, detail) {
  const rule = RULE_BY_TYPE.get(type);
  const rec = pointsRecord(deviceId);
  const day = dayKey();
  const used = (rec.days[day] && rec.days[day][type]) || 0;
  const gained = rule ? Math.max(0, Math.min(rule.points, rule.dailyCap - used)) : 0;
  if (gained > 0) {
    rec.total += gained;
    rec.days[day] = rec.days[day] || {};
    rec.days[day][type] = used + gained;
    rec.events.push({ type, label: rule.label, points: gained, detail: cleanText(detail, 40), ts: Date.now() });
    if (rec.events.length > 200) rec.events = rec.events.slice(-200);
    const keep = Object.keys(rec.days).sort().slice(-30);
    const trimmed = {};
    for (const key of keep) trimmed[key] = rec.days[key];
    rec.days = trimmed;
  }
  return { gained, total: rec.total, label: rule ? rule.label : '', capped: Boolean(rule) && gained === 0 };
}

function captureUploadCount(deviceId) {
  const rec = pointsRecord(deviceId);
  const day = dayKey();
  return rec.uploads[day] || 0;
}

function bumpUploadCount(deviceId) {
  const rec = pointsRecord(deviceId);
  const day = dayKey();
  rec.uploads[day] = (rec.uploads[day] || 0) + 1;
  const keep = Object.keys(rec.uploads).sort().slice(-7);
  const trimmed = {};
  for (const key of keep) trimmed[key] = rec.uploads[key];
  rec.uploads = trimmed;
}

function pointsView(deviceId) {
  const rec = db.points[deviceId];
  const day = dayKey();
  const today = (rec && rec.days && rec.days[day]) || {};
  const todayPoints = Object.values(today).reduce((sum, value) => sum + value, 0);
  let contributors = 0;
  let allPoints = 0;
  for (const key of Object.keys(db.points)) {
    const item = db.points[key];
    if (item && item.total > 0) {
      contributors += 1;
      allPoints += item.total;
    }
  }
  return {
    deviceId,
    total: rec ? rec.total : 0,
    todayPoints,
    today,
    uploadsToday: captureUploadCount(deviceId),
    uploadLimit: PHOTO_DAILY_LIMIT,
    events: rec && Array.isArray(rec.events) ? rec.events.slice(-30).reverse() : [],
    rules: POINT_RULES,
    community: { contributors, allPoints, photos: Object.keys(db.dishPhotos).length },
  };
}

// ---------------------------------------------------------------- 菜品图片
const PHOTO_DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i;
const photoLimits = new Map();

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function photoView() {
  const out = {};
  for (const [dishId, photo] of Object.entries(db.dishPhotos || {})) {
    if (!photo || !photo.file) continue;
    out[dishId] = { src: '/uploads/' + photo.file, at: photo.at, by: photo.by || '热心同学' };
  }
  return out;
}

// ---------------------------------------------------------------- 工具
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  if (res.__gzip && payload.length > 1024) {
    const gz = zlib.gzipSync(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store',
      'Vary': 'Accept-Encoding',
    });
    return res.end(gz);
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function fail(res, status, message, extra) {
  sendJson(res, status, Object.assign({ error: message }, extra || {}));
}

function readBody(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error('请求体过大'), { status: 400 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function isInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

const reportLimits = new Map(); // deviceId|windowId -> ts

// ---------------------------------------------------------------- API
async function handleApi(req, res, pathname, query) {
  const method = req.method || 'GET';

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (pathname === '/api/menu' && method === 'GET') {
    return sendJson(res, 200, menu);
  }

  if (pathname === '/api/summary' && method === 'GET') {
    return sendJson(res, 200, summary());
  }

  if (pathname === '/api/stats' && method === 'GET') {
    return sendJson(res, 200, stats());
  }

  if (pathname === '/api/dish-photos' && method === 'GET') {
    return sendJson(res, 200, { photos: photoView(), updatedAt: Date.now() });
  }

  if (pathname === '/api/points' && method === 'GET') {
    const deviceId = cleanText(query.get('deviceId'), 80);
    if (!deviceId) return fail(res, 400, '缺少设备标识');
    return sendJson(res, 200, pointsView(deviceId));
  }

  if (pathname === '/api/dish-photo' && method === 'POST') {
    const body = await readBody(req, MAX_PHOTO_BODY);
    const dishId = String(body.dishId || '');
    const deviceId = cleanText(body.deviceId, 80);
    if (!dishIndex.has(dishId)) return fail(res, 400, '菜品不存在');
    if (!deviceId) return fail(res, 400, '缺少设备标识');
    const matched = PHOTO_DATA_URL.exec(String(body.dataUrl || ''));
    if (!matched) return fail(res, 400, '只支持 JPG / PNG / WebP 图片');
    const now = Date.now();
    const last = photoLimits.get(deviceId) || 0;
    if (now - last < PHOTO_COOLDOWN_MS) {
      return fail(res, 429, '上传太密集啦，' + Math.ceil((PHOTO_COOLDOWN_MS - (now - last)) / 1000) + ' 秒后再试');
    }
    if (captureUploadCount(deviceId) >= PHOTO_DAILY_LIMIT) {
      return fail(res, 429, `今天的上传次数（${PHOTO_DAILY_LIMIT} 张）用完啦，明天再来`);
    }
    const buf = Buffer.from(matched[2], 'base64');
    if (buf.length < 8 * 1024) return fail(res, 400, '图片有点小，换一张清晰点儿的吧');
    if (buf.length > MAX_PHOTO_BYTES) return fail(res, 400, '图片不能超过 2MB，建议先裁小一点');
    const ext = sniffImage(buf);
    if (!ext) return fail(res, 400, '这个文件看起来不是图片');
    photoLimits.set(deviceId, now);
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    const file = `dish-${hash}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    const existed = Boolean(db.dishPhotos[dishId]);
    db.dishPhotos[dishId] = {
      file,
      at: now,
      deviceId,
      by: cleanText(body.by, 20) || '热心同学',
    };
    bumpUploadCount(deviceId);
    const found = dishIndex.get(dishId);
    const points = awardPoints(deviceId, existed ? 'photo_more' : 'photo_first', found ? found.dish.name : dishId);
    persist();
    return sendJson(res, 201, {
      ok: true,
      photo: { dishId, src: '/uploads/' + file, at: now, by: db.dishPhotos[dishId].by },
      replaced: existed,
      points,
      pointsView: pointsView(deviceId),
    });
  }

  if (pathname === '/api/queues' && method === 'GET') {
    const now = Date.now();
    const items = windows.map((w) => ({
      windowId: w.id,
      number: w.number,
      name: w.name,
      canteenId: w.canteenId,
      queue: queueView(w.id, now),
    })).sort((a, b) => {
      const av = a.queue ? a.queue.waitMin : Infinity;
      const bv = b.queue ? b.queue.waitMin : Infinity;
      return av - bv;
    });
    return sendJson(res, 200, { updatedAt: now, items });
  }

  if (pathname === '/api/queues' && method === 'POST') {
    const body = await readBody(req);
    const windowId = String(body.windowId || '');
    const people = Number(body.people);
    const deviceId = cleanText(body.deviceId, 80);
    if (!windowById.has(windowId)) return fail(res, 400, '窗口不存在');
    if (!isInt(people) || people < 0 || people > 50) return fail(res, 400, '排队人数需为 0–50 的整数');
    if (!deviceId) return fail(res, 400, '缺少设备标识');
    const now = Date.now();
    const key = deviceId + '|' + windowId;
    const last = reportLimits.get(key) || 0;
    if (now - last < REPORT_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((REPORT_COOLDOWN_MS - (now - last)) / 1000);
      return fail(res, 429, `上报太频繁啦，${retryAfterSec} 秒后再来`, { retryAfterSec });
    }
    reportLimits.set(key, now);
    const entry = { id: 'q_' + crypto.randomUUID(), windowId, people, deviceId, ts: now };
    db.queueReports.push(entry);
    // 每个窗口只保留最近 200 条，控制文件体积
    const forWindow = db.queueReports.filter((r) => r.windowId === windowId);
    if (forWindow.length > 200) {
      const keep = new Set(forWindow.slice(-200).map((r) => r.id));
      db.queueReports = db.queueReports.filter((r) => r.windowId !== windowId || keep.has(r.id));
    }
    const points = awardPoints(deviceId, 'queue', (windowById.get(windowId) || {}).name || windowId);
    persist();
    return sendJson(res, 201, { ok: true, entry, queue: queueView(windowId, now), points });
  }

  const dishMatch = pathname.match(/^\/api\/dishes\/([^/]+)$/);
  if (dishMatch && method === 'GET') {
    const id = decodeURIComponent(dishMatch[1]);
    const found = dishIndex.get(id);
    if (!found) return fail(res, 404, '菜品不存在');
    const reviews = db.reviews
      .filter((r) => r.dishId === id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 50)
      .map(publicReview);
    return sendJson(res, 200, {
      dish: found.dish,
      window: { id: found.window.id, number: found.window.number, name: found.window.name },
      stats: dishStats(id),
      queue: queueView(found.window.id),
      reviews,
    });
  }

  const reviewMatch = pathname.match(/^\/api\/dishes\/([^/]+)\/reviews$/);
  if (reviewMatch && method === 'POST') {
    const id = decodeURIComponent(reviewMatch[1]);
    if (!dishIndex.has(id)) return fail(res, 404, '菜品不存在');
    const body = await readBody(req);
    const rating = Number(body.rating);
    const deviceId = cleanText(body.deviceId, 80);
    if (!isInt(rating) || rating < 1 || rating > 5) return fail(res, 400, '评分需为 1–5 的整数');
    if (!deviceId) return fail(res, 400, '缺少设备标识');
    const text = cleanText(body.text, 200);
    const author = cleanText(body.author, 20) || '匿名同学';
    const now = Date.now();
    let review = db.reviews.find(
      (r) => r.dishId === id && r.deviceId === deviceId && now - r.ts < REVIEW_OVERWRITE_MS
    );
    let points = { gained: 0, total: 0, label: '', capped: false };
    if (review) {
      Object.assign(review, { rating, text, author, ts: now });
    } else {
      review = {
        id: 'r_' + crypto.randomUUID(),
        dishId: id,
        rating,
        text,
        author,
        deviceId,
        ts: now,
        likes: 0,
        likedBy: [],
      };
      db.reviews.push(review);
      points = awardPoints(deviceId, 'review', review.dishId);
    }
    persist();
    const reviews = db.reviews
      .filter((r) => r.dishId === id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 50)
      .map(publicReview);
    return sendJson(res, 201, { ok: true, review: publicReview(review), stats: dishStats(id), reviews, points });
  }

  const likeMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/like$/);
  if (likeMatch && method === 'POST') {
    const id = decodeURIComponent(likeMatch[1]);
    const body = await readBody(req);
    const deviceId = cleanText(body.deviceId, 80);
    if (!deviceId) return fail(res, 400, '缺少设备标识');
    const review = db.reviews.find((r) => r.id === id);
    if (!review) return fail(res, 404, '点评不存在');
    review.likes = review.likes || 0;
    review.likedBy = Array.isArray(review.likedBy) ? review.likedBy : [];
    if (!review.likedBy.includes(deviceId)) {
      if (review.likedBy.length > 5000) review.likedBy.shift();
      review.likedBy.push(deviceId);
      review.likes += 1;
      persist();
    }
    return sendJson(res, 200, { ok: true, likes: review.likes, liked: true });
  }

  if (pathname === '/api/peaks' && method === 'GET') {
    // 按小时聚合历史排队上报，给出「什么时段最挤」「现在去是否划算」
    const days = Math.min(90, Math.max(1, Number(query.get('days')) || 60));
    const since = Date.now() - days * 24 * 3600 * 1000;
    const buckets = new Map();
    for (let hour = 6; hour <= 21; hour += 1) buckets.set(hour, { hour, reports: 0, people: 0, waitMin: 0 });
    let sample = 0;
    for (const report of db.queueReports) {
      if (!report || report.ts < since) continue;
      const hour = new Date(report.ts).getHours();
      if (hour < 6 || hour > 21) continue;
      const bucket = buckets.get(hour);
      bucket.reports += 1;
      bucket.people += Number(report.people) || 0;
      bucket.waitMin += Math.round((Number(report.people) || 0) * 0.4);
      sample += 1;
    }
    const hours = [...buckets.values()].map((b) => ({
      hour: b.hour,
      reports: b.reports,
      avgPeople: b.reports ? Math.round((b.people / b.reports) * 10) / 10 : 0,
      avgWait: b.reports ? Math.round(b.waitMin / b.reports) : 0,
    }));
    const ranked = hours.filter((h) => h.reports > 0).sort((a, b) => b.avgWait - a.avgWait);
    return sendJson(res, 200, {
      days,
      sample,
      hours,
      peak: ranked.length ? ranked[0] : null,
      quietest: ranked.length ? ranked[ranked.length - 1] : null,
    });
  }

  if (pathname === '/api/leaderboard' && method === 'GET') {
    const type = query.get('type') || 'rating';
    if (type === 'empty') {
      const now = Date.now();
      const items = windows
        .map((w) => ({ windowId: w.id, number: w.number, name: w.name, canteenId: w.canteenId, queue: queueView(w.id, now) }))
        .filter((x) => x.queue && !x.queue.stale)
        .sort((a, b) => a.queue.waitMin - b.queue.waitMin)
        .slice(0, 5);
      return sendJson(res, 200, { items });
    }
    const items = [];
    for (const [id, found] of dishIndex) {
      const s = dishStats(id);
      if (!s.reviewCount) continue;
      items.push({ ...found.dish, windowNumber: found.window.number, windowName: found.window.name, rating: s.rating, reviewCount: s.reviewCount });
    }
    items.sort((a, b) => (b.rating - a.rating) || (b.reviewCount - a.reviewCount));
    return sendJson(res, 200, { items: items.slice(0, 10) });
  }

  if (pathname === '/api/menu' && method === 'POST') {
    // 预留：录入新菜品（默认不开放；设置 ADMIN_CODE 后需带口令）
    const body = await readBody(req);
    if (ADMIN_CODE && String(body.adminCode || '') !== ADMIN_CODE) return fail(res, 403, '管理员口令不正确');
    const name = cleanText(body.name, 30);
    const windowId = String(body.windowId || '');
    const w = windowById.get(windowId);
    if (!w) return fail(res, 400, '窗口不存在');
    if (!name) return fail(res, 400, '菜名不能为空');
    const dish = {
      id: 'x_' + crypto.randomUUID().slice(0, 8),
      name,
      price: body.price === null || body.price === '' ? null : Number(body.price),
      unit: cleanText(body.unit, 8) || '/份',
      kcal: Number(body.kcal) || 0,
      protein: Number(body.protein) || 0,
      fat: Number(body.fat) || 0,
      carbs: Number(body.carbs) || 0,
      fiber: Number(body.fiber) || 0,
      serving: Number(body.serving) || 250,
      icon: ['leaf', 'noodles', 'meat', 'rice', 'egg', 'bowl'].includes(body.icon) ? body.icon : 'bowl',
      labels: Array.isArray(body.labels) ? body.labels.map((x) => cleanText(x, 12)).slice(0, 6) : [],
      description: cleanText(body.description, 120),
      source: '用户录入',
    };
    w.dishes.push(dish);
    menu.windows = windows;
    fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2) + '\n', 'utf8');
    reindex();
    return sendJson(res, 201, { ok: true, dish });
  }

  return fail(res, 404, '接口不存在');
}

// ---------------------------------------------------------------- 静态文件
function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return fail(res, 400, '路径不合法');
  }
  if (decoded.includes('\0')) return fail(res, 400, '路径不合法');

  let rel = decoded === '/' ? '/index.html' : decoded;
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return fail(res, 403, '禁止访问');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const ext = path.extname(rel);
      if (!ext) {
        // hash 路由回退
        filePath = path.join(PUBLIC_DIR, 'index.html');
        return sendFile(res, filePath);
      }
      return fail(res, 404, '资源不存在');
    }
    return sendFile(res, filePath);
  });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const longCache = ['.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2'].includes(ext);
  fs.readFile(filePath, (err, data) => {
    if (err) return fail(res, 404, '资源不存在');
    const compressible = /text|javascript|json|svg|xml/.test(type) && data.length > 1024;
    if (res.__gzip && compressible) {
      const gz = zlib.gzipSync(data);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Encoding': 'gzip',
        'Content-Length': gz.length,
        'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
        'Vary': 'Accept-Encoding',
      });
      return res.end(gz);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------- 用户上传的菜品图
function serveUpload(req, res, pathname) {
  const name = pathname.slice('/uploads/'.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name) || name.includes('..')) return fail(res, 404, '资源不存在');
  const filePath = path.join(UPLOAD_DIR, name);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return fail(res, 403, '禁止访问');
  return sendFile(res, filePath);
}

// ---------------------------------------------------------------- 服务
const server = http.createServer((req, res) => {
  res.__gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (_) {
    return fail(res, 400, '请求地址不合法');
  }

  const pathname = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname, url.searchParams).catch((err) => {
      const status = err && err.status ? err.status : 500;
      if (status >= 500) console.error('[接口]', err);
      if (!res.headersSent) fail(res, status, err && err.message ? err.message : '服务器开小差了');
    });
    return;
  }

  if (pathname.startsWith('/uploads/')) return serveUpload(req, res, pathname);

  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '方法不允许');
  return serveStatic(req, res, pathname);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  农餐馆 · 农大智慧餐厅');
  console.log(`  已启动  http://localhost:${PORT}`);
  console.log(`  窗口 ${windows.length} 个 · 菜品 ${dishIndex.size} 道 · 照片 ${(menu.photos || []).length} 张`);
  console.log(`  数据文件 ${path.relative(ROOT, DB_FILE)}${fs.existsSync(DB_FILE) ? '' : '（首次启动，将自动创建）'}`);
  console.log('');
});

process.on('unhandledRejection', (err) => console.error('[未处理的 Promise]', err));
process.on('uncaughtException', (err) => console.error('[未捕获异常]', err));
