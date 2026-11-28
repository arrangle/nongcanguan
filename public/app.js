const dish = (windowId, index, name, price, unit, kcal, protein, fat, carbs, fiber, serving, icon, labels, description, source = "AI估算") => ({
  id: `${windowId}-${index}`, windowId, name, price, unit, kcal, protein, fat, carbs, fiber, serving, icon, labels, description, source
});

let windows = [];

// 现场照片由 /api/menu 的 photos 提供（公一 14 张 + 公三/西区现场价目牌）
let photoArchive = [];

let canteens = [];
const state = { canteenId: "gong1", windowId: "w18", filter: "all", query: "", sort: "default", detailDishId: null, detailFactor: 1, galleryItems: [], galleryIndex: 0 };
const iconStyles = {
  leaf: ["#4e805b", "#e9f1df"], noodles: ["#a87531", "#f8eed6"], meat: ["#a86249", "#f8e9e1"],
  rice: ["#8d713b", "#f4edda"], egg: ["#ac7a35", "#f9efda"], bowl: ["#4d7e73", "#e4efea"]
};
const filters = {
  all: { label: "全部菜品", test: () => true },
  light: { label: "轻盈低脂", test: d => d.kcal <= 120 && d.fat <= 7 },
  protein: { label: "高蛋白", test: d => d.protein >= 9.5 },
  veg: { label: "清爽素食", test: d => d.labels.includes("素食") },
  staple: { label: "主食面点", test: d => d.labels.includes("主食") }
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let allDishes = [];
function rebuildIndexes() { allDishes = windows.flatMap(w => w.dishes.map(d => ({ ...d, window: w }))); }
const getWindow = id => windows.find(w => w.id === id);
const getCanteen = id => canteens.find(c => c.id === id);
const canteenWindows = () => windows.filter(w => w.canteenId === state.canteenId);
const getDish = id => allDishes.find(d => d.id === id);
const getPhoto = id => photoArchive.find(p => p.id === id);
const round = value => Math.round(value);
const one = value => value.toFixed(1);
const escapeHTML = value => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const nutritionFor = (d, factor = 1) => {
  const ratio = d.serving * factor / 100;
  return { kcal: d.kcal * ratio, protein: d.protein * ratio, fat: d.fat * ratio, carbs: d.carbs * ratio, fiber: d.fiber * ratio, grams: Math.round(d.serving * factor) };
};
const priceHTML = (d, large = false) => d.price === null
  ? `<span class="dish-price market">窗口时价</span>`
  : `<span class="dish-price${large ? " large" : ""}"><small>¥</small>${d.price}<small>${d.unit}</small></span>`;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// 菜品配图：只有「菜名和图片明显对得上」才用示意图，其余用绿色底图占位。
// 七张示意图来自公开素材（见 docs/图片来源.md），卡片上都标注「示意图」。
function dishPhoto(d) {
  const name = d.name || "";
  if (/虾|蟹|贝|花甲|花蛤|鱿鱼|八爪|蛏/.test(name)) return { src: "assets/dishes/shrimp-vegetable-stir-fry.jpg", match: true };
  if (/豆腐|豆花|麻婆/.test(name)) return { src: "assets/dishes/mapo-tofu.png", match: true };
  if (/番茄|西红柿/.test(name) && /蛋/.test(name)) return { src: "assets/dishes/tomato-egg.jpg", match: true };
  if (/鸡丁|宫保|鸡块|辣子鸡|鸡米花|鸡柳/.test(name)) return { src: "assets/dishes/kung-pao-chicken.jpg", match: true };
  if (/炒面|炒河粉|炒粉|捞面|拌面|炒饼|炒饭/.test(name)) return { src: "assets/dishes/chow-mein.jpg", match: true };
  if (/西兰花|芥蓝|菠菜|油菜|青菜|小白菜|包菜|菜花|菜心|蒿子秆|空心菜|生菜|莴笋|豆角|荷兰豆/.test(name)) return { src: "assets/dishes/vegetable-stir-fry.jpg", match: true };
  return { src: "", match: false };
}

let tray = [];
function restoreTray() {
  try {
    const saved = JSON.parse(localStorage.getItem("cau-food-tray") || "[]");
    if (Array.isArray(saved)) tray = saved.filter(item => getDish(item.dishId) && [0.5, 1, 1.5].includes(item.factor) && Number.isInteger(item.qty) && item.qty > 0);
  } catch (_) { tray = []; }
}
const saveTray = () => { try { localStorage.setItem("cau-food-tray", JSON.stringify(tray)); } catch (_) {} };

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function renderWindowList() {
  const list = canteenWindows();
  $("#windowList").innerHTML = list.map(w => `
    <div class="window-item ${w.id === state.windowId ? "active" : ""}">
      <button class="window-select" type="button" data-window="${w.id}" aria-current="${w.id === state.windowId ? "true" : "false"}">
        <span class="window-number">${w.number || ""}</span>
        <span class="window-item-copy">
          <strong>${w.name}</strong>
          <small>${w.short}</small>
          <small class="window-queue" data-window-queue="${w.id}">排队数据读取中</small>
        </span>
      </button>
      <button class="window-report" type="button" data-report="${w.id}" title="上报当前排队人数">上报排队</button>
    </div>`).join("");
  const countBadge = $("#windowCount");
  if (countBadge) countBadge.textContent = list.length;
  const empty = $("#windowEmpty");
  if (empty) empty.hidden = list.length !== 0;
  if (typeof window.decorateWindows === "function") window.decorateWindows();
}

function renderWindowHero() {
  const w = getWindow(state.windowId);
  const hero = $("#windowHero");
  if (!w) { if (hero) hero.hidden = true; return; }
  if (hero) hero.hidden = false;
  const image = $("#windowHeroImage");
  image.src = w.cover;
  image.alt = `公一食堂${w.number}号${w.name}窗口实拍`;
  image.style.objectPosition = w.position;
  $("#windowHeroLabel").textContent = `${w.number ? "WINDOW " + w.number : "窗口"} · ${w.dishes.length} DISHES`;
  $("#windowHeroName").textContent = w.number ? `${w.number} 号 · ${w.name}` : w.name;
  $("#windowHeroDescription").textContent = w.description;
}

function getVisibleDishes() {
  const inCanteen = allDishes.filter(d => d.window.canteenId === state.canteenId);
  const active = getWindow(state.windowId);
  let items = state.query ? inCanteen : (active ? active.dishes.map(d => ({ ...d, window: active })) : []);
  if (state.query) {
    const query = state.query.toLowerCase();
    items = items.filter(d => `${d.name}${d.description}${d.labels.join("")}${d.window.name}${d.window.number}`.toLowerCase().includes(query));
  }
  items = items.filter(filters[state.filter].test);
  return [...items].sort((a, b) => {
    if (state.sort === "calories") return a.kcal - b.kcal;
    if (state.sort === "protein") return b.protein - a.protein;
    if (state.sort === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
    return 0;
  });
}

function dishCard(d) {
  const faved = typeof window.isFav === "function" && window.isFav(d.id);
  const tags = (d.labels || []).slice(0, 3);
  return `<article class="dish-card" data-dish="${d.id}" tabindex="0" role="button" aria-label="查看${d.name}营养详情">
    <div class="dish-card-content">
      <div class="dish-card-top">
        <h3>${d.name}</h3>
        ${priceHTML(d)}
        <button class="dish-fav ${faved ? "on" : ""}" type="button" data-fav="${d.id}" aria-pressed="${faved}" aria-label="收藏${d.name}">${icon("heart")}</button>
      </div>
      <div class="dish-meta">${d.source === "AI估算" ? "AI估算" : d.source} · ${round(d.kcal)} kcal/100g · 蛋白 ${one(d.protein)}g${state.query ? ` · ${d.window.number ? d.window.number + " 号窗口 · " : ""}${d.window.name}` : ""}</div>
      <div class="dish-tags">${tags.map((t) => `<span>${t}</span>`).join("")}</div>
      <div class="dish-card-bottom">
        <button class="dish-detail-button" type="button" data-open="${d.id}">营养详情</button>
        <button class="dish-add-button" type="button" data-add="${d.id}" aria-label="将${d.name}加入餐盘">＋ 加入餐盘</button>
      </div>
    </div>
  </article>`;
}

function renderDishes() {
  const items = getVisibleDishes();
  $("#windowHero").classList.toggle("search-active", Boolean(state.query));
  const canteen = getCanteen(state.canteenId);
  const canteenName = canteen ? (canteen.alias || canteen.name) : "";
  const intro = $("#introCanteen");
  if (intro) intro.textContent = canteen ? canteen.name : "食堂";
  $("#dishSectionTitle").textContent = state.query ? `“${state.query}”的搜索结果` : (state.filter === "all" ? "挑选菜品" : filters[state.filter].label);
  const active = getWindow(state.windowId);
  $("#dishResultCount").textContent = state.query
    ? `在${canteenName} ${inCanteenCount()} 道已录入菜品中找到 ${items.length} 道`
    : active
      ? `${active.number ? active.number + " 号窗口 · " : active.name + " · "}${items.length} 道菜品 · 营养按每100g展示`
      : "该食堂暂未录入窗口";
  $("#dishGrid").innerHTML = items.map(dishCard).join("");
  $("#dishGrid").hidden = items.length === 0;
  $("#emptyState").hidden = items.length !== 0;
}

function inCanteenCount() {
  return allDishes.filter(d => d.window.canteenId === state.canteenId).length;
}

function renderFilterTabs() {
  $$("#filterTabs button").forEach(button => button.classList.toggle("active", button.dataset.filter === state.filter));
}

function openDish(id) {
  state.detailDishId = id;
  state.detailFactor = 1;
  renderDishDetail();
  $("#dishDialog").showModal();
}

function renderDishDetail() {
  const d = getDish(state.detailDishId);
  if (!d) return;
  const w = d.window;
  const n = nutritionFor(d, state.detailFactor);
  const portionName = factor => factor === 0.5 ? "半份" : factor === 1.5 ? "1.5 份" : "标准份";
  const sourceText = d.source === "窗口公示"
    ? "数值录入自18号窗口现场营养公示表，按每100克记录；当前按所选参考份量换算。"
    : "根据菜名、常见食材与烹饪方式进行AI估算，并非检测值；实际受配方、用油和份量影响。";
  $("#dishDialogContent").innerHTML = `<div class="dish-detail">
    <div class="dish-detail-photo"><img src="${w.cover}" alt="${w.name}现场照片" style="object-position:${w.position}"><div class="dish-detail-photo-caption"><span>${w.number ? "WINDOW " + w.number : "ON-SITE"} · ON-SITE PHOTO</span><p>${w.name}<br>现场菜单拍摄于 2026.11.21</p></div></div>
    <div class="dish-detail-main">
      <span class="detail-window">${(getCanteen(w.canteenId) || {}).name || "食堂"} / ${w.number ? w.number + " 号窗口 / " : ""}${w.name}</span>
      <div class="detail-title-row"><h2>${d.name}</h2>${priceHTML(d, true)}</div>
      <p class="detail-description">${d.description} 参考份量 ${d.serving} 克，以下为当前所选份量的营养参考。</p>
      <div class="detail-tags">${d.labels.map(label => `<span>${label}</span>`).join("")}</div>
      <div class="portion-section"><div class="portion-label"><span>选择食用份量</span><span id="portionGrams">约 ${n.grams}g</span></div><div class="portion-options">${[0.5, 1, 1.5].map(factor => `<button class="${factor === state.detailFactor ? "active" : ""}" data-factor="${factor}">${portionName(factor)}</button>`).join("")}</div></div>
      <div class="detail-energy"><div><strong>${round(n.kcal)}</strong><span>kcal</span></div><small>当前份量能量</small></div>
      <div class="detail-macros"><div><span>蛋白质</span><strong>${one(n.protein)}<small>g</small></strong></div><div><span>碳水化合物</span><strong>${one(n.carbs)}<small>g</small></strong></div><div><span>脂肪</span><strong>${one(n.fat)}<small>g</small></strong></div><div><span>膳食纤维</span><strong>${one(n.fiber)}<small>g</small></strong></div></div>
      <div class="detail-source">${icon("info")}<span><b>${d.source}</b> · ${sourceText}</span></div>
      <button class="button button-primary detail-add" data-detail-add="${d.id}">${icon("plus")}加入今日餐盘 · ${round(n.kcal)} kcal</button>
    </div>
  </div>`;
}

function addDish(id, factor = 1) {
  const existing = tray.find(item => item.dishId === id && item.factor === factor);
  if (existing) existing.qty += 1;
  else tray.push({ dishId: id, factor, qty: 1 });
  saveTray();
  renderTray();
  const d = getDish(id);
  showToast(`已将“${d.name}”加入今日餐盘`);
}

function renderTray() {
  const validItems = tray.map(item => ({ ...item, dish: getDish(item.dishId) })).filter(item => item.dish);
  const count = validItems.reduce((sum, item) => sum + item.qty, 0);
  const totals = validItems.reduce((sum, item) => {
    const n = nutritionFor(item.dish, item.factor);
    Object.keys(sum).forEach(key => { sum[key] += n[key] * item.qty; });
    return sum;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
  const portionName = factor => factor === 0.5 ? "半份" : factor === 1.5 ? "1.5份" : "标准份";
  $("#trayItems").innerHTML = validItems.map((item, index) => `<div class="tray-item"><div class="tray-item-copy"><strong>${item.dish.name}</strong><span>${item.dish.window.number}号窗口 · ${portionName(item.factor)}${item.qty > 1 ? ` × ${item.qty}` : ""}</span></div><span class="tray-item-energy">${round(nutritionFor(item.dish, item.factor).kcal * item.qty)}<small> kcal</small></span><button class="tray-item-remove" data-remove="${index}" aria-label="移除${item.dish.name}">${icon("close")}</button></div>`).join("");
  $("#trayEmpty").hidden = count > 0;
  $("#trayCount").textContent = `${count} 道`;
  $("#totalCalories").textContent = round(totals.kcal);
  $("#caloriePercent").textContent = `${round(totals.kcal / 650 * 100)}%`;
  $("#calorieBar").style.width = `${Math.min(100, totals.kcal / 650 * 100)}%`;
  $("#totalProtein").innerHTML = `${one(totals.protein)}<small>g</small>`;
  $("#totalCarbs").innerHTML = `${one(totals.carbs)}<small>g</small>`;
  $("#totalFat").innerHTML = `${one(totals.fat)}<small>g</small>`;
  $("#proteinBar").style.width = `${Math.min(100, totals.protein / 30 * 100)}%`;
  $("#carbBar").style.width = `${Math.min(100, totals.carbs / 80 * 100)}%`;
  $("#fatBar").style.width = `${Math.min(100, totals.fat / 20 * 100)}%`;
  $("#clearTray").disabled = count === 0;
  $("#mobileTrayCount").textContent = count;
  $("#mobileTrayCalories").textContent = `${round(totals.kcal)} kcal`;
}

function openGallery(ids = photoArchive.map(p => p.id)) {
  state.galleryItems = ids.map(getPhoto).filter(Boolean);
  state.galleryIndex = 0;
  renderGallery();
  $("#galleryDialog").showModal();
}

function renderGallery() {
  const items = state.galleryItems;
  const current = items[state.galleryIndex];
  if (!current) return;
  const currentWindow = getWindow(state.windowId);
  $("#galleryTitle").textContent = items.length === photoArchive.length
    ? ((getCanteen(state.canteenId) || {}).name || "食堂") + " · 现场菜单"
    : currentWindow
      ? (currentWindow.number ? currentWindow.number + " 号窗口" : currentWindow.name) + " · 现场菜单"
      : "现场菜单";
  $("#galleryMainImage").src = current.src;
  $("#galleryMainImage").alt = current.caption;
  $("#galleryCaption").textContent = current.caption;
  $("#galleryPosition").textContent = `${state.galleryIndex + 1} / ${items.length}`;
  $("#galleryThumbs").innerHTML = items.map((photo, index) => `<button class="gallery-thumb ${index === state.galleryIndex ? "active" : ""}" data-gallery-index="${index}" aria-label="查看${photo.caption}"><img src="${photo.src}" alt="" loading="lazy"><span>${photo.id}</span></button>`).join("");
}

function moveGallery(step) {
  state.galleryIndex = (state.galleryIndex + step + state.galleryItems.length) % state.galleryItems.length;
  renderGallery();
}

function selectWindow(id) {
  state.windowId = id;
  state.query = "";
  state.filter = "all";
  $("#searchInput").value = "";
  renderWindowList();
  renderWindowHero();
  renderFilterTabs();
  renderDishes();
}

$("#windowList").addEventListener("click", event => {
  if (event.target.closest("[data-report], [data-gallery-win]")) return;
  const button = event.target.closest("[data-window]");
  if (button) selectWindow(button.dataset.window);
});
$("#windowList").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const button = event.target.closest("[data-window]");
  if (!button || event.target.closest("button")) return;
  event.preventDefault();
  selectWindow(button.dataset.window);
});

$("#filterTabs").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  renderFilterTabs();
  renderDishes();
});

$("#searchInput").addEventListener("input", event => {
  state.query = event.target.value.trim();
  renderDishes();
});

$("#sortSelect").addEventListener("change", event => {
  state.sort = event.target.value;
  renderDishes();
});

$("#resetFilters").addEventListener("click", () => {
  state.filter = "all";
  state.query = "";
  state.sort = "default";
  $("#searchInput").value = "";
  $("#sortSelect").value = "default";
  renderFilterTabs();
  renderDishes();
});

$("#dishGrid").addEventListener("click", event => {
  const openButton = event.target.closest("[data-open]");
  if (openButton) {
    event.stopPropagation();
    openDish(openButton.dataset.open);
    return;
  }
  const favButton = event.target.closest("[data-fav]");
  if (favButton) {
    event.stopPropagation();
    if (typeof window.toggleFav === "function") window.toggleFav(favButton.dataset.fav);
    return;
  }
  const addButton = event.target.closest("[data-add]");
  if (addButton) {
    event.stopPropagation();
    addDish(addButton.dataset.add);
    return;
  }
  const card = event.target.closest("[data-dish]");
  if (card) openDish(card.dataset.dish);
});

$("#dishGrid").addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-dish]")) {
    event.preventDefault();
    openDish(event.target.dataset.dish);
  }
});

$("#dishDialogContent").addEventListener("click", event => {
  const portion = event.target.closest("[data-factor]");
  if (portion) {
    state.detailFactor = Number(portion.dataset.factor);
    renderDishDetail();
    return;
  }
  const add = event.target.closest("[data-detail-add]");
  if (add) {
    addDish(add.dataset.detailAdd, state.detailFactor);
    $("#dishDialog").close();
  }
});

$("#trayItems").addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  tray.splice(Number(remove.dataset.remove), 1);
  saveTray();
  renderTray();
});

$("#clearTray").addEventListener("click", () => {
  tray = [];
  saveTray();
  renderTray();
  showToast("今日餐盘已清空");
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-canteen]");
  if (button) selectCanteen(button.dataset.canteen);
});

$("#galleryBtn").addEventListener("click", () => openGallery());
$("#windowPhotoBtn").addEventListener("click", () => openGallery(getWindow(state.windowId).gallery));
$("#dataBtn").addEventListener("click", () => $("#dataDialog").showModal());
$("#galleryPrev").addEventListener("click", () => moveGallery(-1));
$("#galleryNext").addEventListener("click", () => moveGallery(1));
$("#galleryThumbs").addEventListener("click", event => {
  const thumb = event.target.closest("[data-gallery-index]");
  if (!thumb) return;
  state.galleryIndex = Number(thumb.dataset.galleryIndex);
  renderGallery();
});

$$('[data-close]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
$$('dialog').forEach(dialog => dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));

function closeTrayDrawer() { document.body.classList.remove("drawer-open"); }
$("#mobileTrayBtn").addEventListener("click", () => document.body.classList.add("drawer-open"));
$("#trayClose").addEventListener("click", closeTrayDrawer);
$("#drawerBackdrop").addEventListener("click", closeTrayDrawer);

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#searchInput").focus();
  }
  if (event.key === "Escape") closeTrayDrawer();
  if ($("#galleryDialog").open && event.key === "ArrowLeft") moveGallery(-1);
  if ($("#galleryDialog").open && event.key === "ArrowRight") moveGallery(1);
});

async function loadMenu() {
  const response = await fetch("/api/menu", { cache: "no-store" });
  if (!response.ok) throw new Error("菜单接口返回 " + response.status);
  const data = await response.json();
  windows = (data.windows || []).map(w => ({ ...w, dishes: w.dishes || [] }));
  canteens = data.canteens || [];
  photoArchive = (data.photos || []).map(p => ({
    ...p,
    src: p.src.indexOf("assets/") === 0 ? p.src : "assets/photos/" + p.src,
  }));
  state.galleryItems = photoArchive;

  const online = canteens.filter(c => c.status === "online");
  if (!canteens.some(c => c.id === state.canteenId && c.status === "online")) {
    state.canteenId = online.length ? online[0].id : (canteens[0] ? canteens[0].id : "gong1");
  }
  if (!windows.find(w => w.id === state.windowId && w.canteenId === state.canteenId)) {
    const first = windows.find(w => w.canteenId === state.canteenId);
    state.windowId = first ? first.id : null;
  }
  rebuildIndexes();
}

function renderCanteenNav() {
  $$("[data-canteen]").forEach(button => {
    const c = getCanteen(button.dataset.canteen);
    button.classList.toggle("is-on", button.dataset.canteen === state.canteenId);
    button.classList.toggle("is-pending", Boolean(c && c.status !== "online"));
    button.setAttribute("aria-pressed", String(button.dataset.canteen === state.canteenId));
  });
}

function selectCanteen(id) {
  const canteen = getCanteen(id);
  if (!canteen) return;
  if (canteen.status !== "online") {
    showToast(canteen.name + "菜单待录入，先看看已上线的食堂");
    return;
  }
  state.canteenId = id;
  state.query = "";
  state.filter = "all";
  const first = windows.find(w => w.canteenId === id);
  state.windowId = first ? first.id : null;
  const search = $("#searchInput");
  if (search) search.value = "";
  renderCanteenNav();
  if (typeof window.renderCanteenSidebar === "function") window.renderCanteenSidebar();
  if (typeof window.renderCanteenCards === "function") window.renderCanteenCards();
  renderWindowList();
  renderWindowHero();
  renderFilterTabs();
  renderDishes();
}

function boot() {
  restoreTray();
  const statWindows = $("#statWindows");
  const statDishes = $("#statDishes");
  if (statWindows) statWindows.textContent = windows.length;
  if (statDishes) statDishes.textContent = allDishes.length;
  renderCanteenNav();
  if (typeof window.renderCanteenSidebar === "function") window.renderCanteenSidebar();
  if (typeof window.renderCanteenCards === "function") window.renderCanteenCards();
  renderWindowList();
  renderWindowHero();
  renderFilterTabs();
  renderDishes();
  renderTray();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadMenu();
  } catch (error) {
    console.error(error);
    const grid = $("#dishGrid");
    if (grid) grid.innerHTML = '<div class="menu-error"><h3>菜单加载失败</h3><p>请确认真按 <code>node server.js</code> 启动后，通过 http://localhost:3000 访问。</p></div>';
    return;
  }
  boot();
  if (window.Features && typeof window.Features.init === "function") window.Features.init();
});
