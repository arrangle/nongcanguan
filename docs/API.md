# 接口说明

Base URL：`http://localhost:3000`。所有响应为 JSON，UTF-8。
错误统一为 `{ "error": "人话错误信息" }`，状态码 400 / 403 / 404 / 405 / 429 / 500。

## GET /api/menu

完整菜单（来自 `data/menu.json`）。

```json
{
  "version": 1,
  "title": "农餐馆 · 农大智慧餐厅",
  "canteens": [{ "id": "gong1", "name": "公一食堂", "alias": "公寓一食堂", "status": "online" }],
  "windows": [
    {
      "id": "w18", "canteenId": "gong1", "number": "18", "name": "低脂美食新风尚",
      "short": "轻食 · 营养公示", "cover": "assets/photos/04.webp",
      "gallery": ["04", "03"], "position": "center 46%", "description": "…",
      "dishes": [
        { "id": "w18-1", "name": "白灼大虾", "price": null, "unit": "时价",
          "kcal": 71.25, "protein": 11.01, "fat": 2.06, "carbs": 2.14, "fiber": 0.02,
          "serving": 150, "icon": "meat", "labels": ["白灼", "高蛋白"],
          "description": "…", "source": "窗口公示" }
      ]
    }
  ],
  "photos": [{ "id": "04", "caption": "…", "src": "assets/photos/04.webp" }]
}
```

营养字段均为**每 100 克**；一份的热量 = `kcal × serving ÷ 100`。

## GET /api/summary

一次拉取排队、评分和统计，首页与列表用。

```json
{
  "queues": { "w18": { "people": 10, "ageMin": 0, "stale": false, "waitMin": 4, "updatedAt": 1763712345678, "reportCount": 3 } },
  "ratings": { "w12-1": { "rating": 5, "reviewCount": 2 } },
  "stats": { "windows": 6, "dishes": 43, "reviews": 2, "reviewsToday": 2,
             "reportsToday": 3, "activeWindows": 1, "avgRating": 5 }
}
```

## GET /api/queues

```json
{
  "updatedAt": 1763712345678,
  "items": [
    { "windowId": "w18", "number": "18", "name": "低脂美食新风尚", "canteenId": "gong1",
      "queue": { "people": 10, "ageMin": 0, "stale": false, "waitMin": 4, "updatedAt": 1763712345678, "reportCount": 3 } }
  ]
}
```

按 `waitMin` 升序；无有效数据的窗口 `queue` 为 `null`，排在最后。

## POST /api/queues

```json
{ "windowId": "w18", "people": 10, "deviceId": "dev-xxx" }
```

- `people`：0–50 的整数
- `deviceId`：必填，前端生成的本地设备标识
- 同一设备同一窗口 **3 分钟**内只能上报一次，否则 `429`：

```json
{ "error": "上报太频繁啦，142 秒后再来", "retryAfterSec": 142 }
```

成功 `201`：

```json
{ "ok": true, "entry": { "id": "q_…", "windowId": "w18", "people": 10, "deviceId": "dev-xxx", "ts": 1763712345678 },
  "queue": { "people": 10, "ageMin": 0, "stale": false, "waitMin": 4, "updatedAt": 1763712345678, "reportCount": 1 } }
```

### 排队聚合算法

1. 取该窗口最近 **20 分钟**内的上报，按时间倒序取最多 5 条。
2. 若 20 分钟内没有上报，取历史上最近 5 条，并标记 `stale: true`。
3. `people` = 这组人数的中位数（四舍五入）。
4. `ageMin` = 最近一条上报距今的分钟数（向下取整）。
5. `stale` = `ageMin > 20`。
6. `waitMin` = `max(0, round(people × 0.4))`。

## GET /api/dishes/:id

```json
{
  "dish": { "id": "w12-1", "...": "同 /api/menu" },
  "window": { "id": "w12", "number": "12", "name": "基本菜品" },
  "stats": { "rating": 5, "reviewCount": 2 },
  "queue": { "people": 10, "ageMin": 0, "stale": false, "waitMin": 4, "updatedAt": 1763712345678, "reportCount": 3 },
  "reviews": [
    { "id": "r_…", "dishId": "w12-1", "rating": 5, "text": "…", "author": "匿名同学", "deviceId": "dev-xxx", "ts": 1763712345678 }
  ]
}
```

点评按时间倒序，最多 50 条。菜品不存在返回 404。

## POST /api/dishes/:id/reviews

```json
{ "rating": 5, "text": "肉给得足", "author": "小明", "deviceId": "dev-xxx" }
```

- `rating`：1–5 的整数
- `text`：≤200 字
- `author`：≤20 字，缺省「匿名同学」
- 同一 `deviceId` 对同一菜品 **24 小时内**再次点评会覆盖旧评，不新增

成功 `201`：

```json
{ "ok": true, "review": { "…": "…" }, "stats": { "rating": 5, "reviewCount": 2 },
  "reviews": [ /* 最新 50 条 */ ] }
```

## POST /api/reviews/:id/like

给一条点评点赞。同一设备对同一条点评只计一次。

```json
{ "deviceId": "dev-xxx" }
```

成功 `200`：

```json
{ "ok": true, "likes": 3, "liked": true }
```

点评不存在返回 404。点评对象包含 `likes`（点赞数）；出于隐私，响应不再返回 `deviceId`。

## GET /api/leaderboard

`?type=rating`（默认）：`{ "items": [ 菜品 + windowNumber + windowName + rating + reviewCount ] }`，点评数 ≥1，按评分降序，取前 10。

`?type=empty`：`{ "items": [ { windowId, number, name, canteenId, queue } ] }`，仅含未过期窗口，按等待时长升序，取前 5。

## GET /api/stats

```json
{ "windows": 6, "dishes": 43, "reviews": 2, "reviewsToday": 2,
  "reportsToday": 3, "activeWindows": 1, "avgRating": 5 }
```

`reviewsToday` / `reportsToday` 按服务器本地时区当天 00:00 起算。

## POST /api/menu

追加菜品。设置了环境变量 `ADMIN_CODE` 时，请求体必须带匹配的 `adminCode`，否则 403。

```json
{ "windowId": "w18", "name": "清炒时蔬", "price": 5, "unit": "/份",
  "kcal": 45, "protein": 2.1, "fat": 2.0, "carbs": 4.8, "fiber": 1.6,
  "serving": 200, "icon": "leaf", "labels": ["素食"], "description": "当季蔬菜清炒",
  "adminCode": "" }
```

成功 `201`，并写回 `data/menu.json`。

## GET /api/health

```json
{ "ok": true, "uptime": 123 }
```

## 其他约定

- 请求体上限 256KB；非法 JSON 返回 400。
- 静态资源从 `public/` 提供；非 `/api` 的未知无扩展名路径回退 `index.html`。
- 响应头包含 `X-Content-Type-Options: nosniff`；API 响应 `Cache-Control: no-store`。
