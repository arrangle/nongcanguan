/**
 * 营养估算：按菜名归类（饮品/甜品/主食/肉类/素食…），给现场价目牌转录的菜品补上营养值。
 * 这是估算，不是检测值；菜品的 source 字段会标成 AI估算。
 */

// ---------------------------------------------------------------- 营养估算
// 先判定「主料属于哪一类」，肉菜面饭分开算，避免「肉丝面」被当成纯肉
const DRINK = { k: /咖啡|拿铁|美式|卡布奇诺|橙C|豆浆|米浆|豆乳|酸奶|奶茶|果汁|豆乳/, kcal: 55, p: 2.4, f: 1.8, c: 8, serving: 350, icon: 'bowl', tag: '饮品' };
const DESSERT = { k: /冰淇淋|雪糕|糖葫芦|豆花|西米露|汤圆|蛋糕|蛋挞|面包|三明治|麻花|枣糕/, kcal: 220, p: 4, f: 8, c: 34, serving: 120, icon: 'egg', tag: '甜品' };
const CONGEE = { k: /粥|羹/, kcal: 50, p: 1.6, f: 0.7, c: 9.5, serving: 350, icon: 'bowl', tag: '汤' };
const SOUP = { k: /汤(?!饺|圆)/, kcal: 45, p: 3, f: 2, c: 4, serving: 400, icon: 'bowl', tag: '汤' };
const RICE = { k: /炒饭|拌饭|盖饭|捞饭|焗饭|煲仔|焖饭|米饭|杂粮饭|烩饭|饭/, kcal: 165, p: 6, f: 4.5, c: 25, serving: 350, icon: 'rice', tag: '主食' };
const NOODLE = { k: /面|粉|米线|馄饨|饺|馍/, kcal: 130, p: 5.5, f: 2.5, c: 22, serving: 400, icon: 'noodles', tag: '主食' };
const BREAD = { k: /饼|馒头|花卷|包子|窝头|糕|粽子|烧饼/, kcal: 250, p: 6, f: 8, c: 38, serving: 100, icon: 'rice', tag: '主食' };
const SEAFOOD = { k: /虾|鱼|蟹|贝|花甲|鱿鱼|八爪|蚝|蛏/, kcal: 110, p: 17, f: 3.5, c: 2, serving: 150, icon: 'meat' };
const POULTRY = { k: /鸡|鸭/, kcal: 180, p: 17, f: 11, c: 2, serving: 150, icon: 'meat' };
const REDMEAT = { k: /牛|羊|猪|肉|排骨|肘|里脊|肠|培根|腊|肚|腰|肝|血旺/, kcal: 220, p: 16, f: 15, c: 2, serving: 140, icon: 'meat' };
const EGG = { k: /蛋/, kcal: 145, p: 12, f: 9.5, c: 2, serving: 120, icon: 'egg' };
const TOFU = { k: /豆腐|豆干|腐竹|千张|豆皮/, kcal: 90, p: 8, f: 5, c: 3, serving: 150, icon: 'leaf' };
const VEG = { k: /菜|瓜|笋|菇|藕|茄|萝卜|豆角|西兰花|菠菜|芹|青椒|番茄|西红柿|玉米|山药|南瓜|木耳|秋葵|蒿|芥蓝|芦笋|包菜|白菜|豇豆|莴笋|豆芽|冬瓜|芋/, kcal: 45, p: 2, f: 1.5, c: 6, serving: 150, icon: 'leaf' };
const FALLBACK = { kcal: 140, p: 7, f: 5, c: 15, serving: 150, icon: 'bowl' };

const MEAT_WORDS = /肉|鸡|鸭|牛|羊|猪|鱼|虾|蟹|肠|培根|腊|肚|肝/;

function estimate(name) {
  let base = DRINK.k.test(name) ? DRINK
    : DESSERT.k.test(name) ? DESSERT
    : CONGEE.k.test(name) ? CONGEE
    : SOUP.k.test(name) ? SOUP
    : RICE.k.test(name) ? RICE
    : NOODLE.k.test(name) ? NOODLE
    : BREAD.k.test(name) ? BREAD
    : SEAFOOD.k.test(name) ? SEAFOOD
    : POULTRY.k.test(name) ? POULTRY
    : REDMEAT.k.test(name) ? REDMEAT
    : EGG.k.test(name) ? EGG
    : TOFU.k.test(name) ? TOFU
    : VEG.k.test(name) ? VEG
    : FALLBACK;

  let p = base.p;
  let f = base.f;
  let kcal = base.kcal;
  // 面/饭里带肉，按加了肉估
  const staple = base === RICE || base === NOODLE;
  if (staple && MEAT_WORDS.test(name)) {
    p += 5;
    f += 4;
    kcal += 55;
  }
  return {
    kcal: Math.round(kcal),
    protein: Math.round(p * 10) / 10,
    fat: Math.round(f * 10) / 10,
    carbs: Math.round(base.c * 10) / 10,
    fiber: base === VEG ? 1.8 : 0.6,
    serving: base.serving,
    icon: base.icon,
    tag: base.tag || '',
  };
}

// ---------------------------------------------------------------- 单位
function normalizeUnit(unitText) {
  const text = String(unitText || '').trim();
  const match = text.match(/元\s*\/\s*(.+)$/);
  if (!match) return '/份';
  const tail = match[1].trim();
  return tail ? '/' + tail : '/份';
}

function labelsFor(name, est, tag) {
  const labels = [];
  if (tag) labels.push(tag);
  if (/(饭|面|粉|饼|馒头|花卷|包子|粥)/.test(name)) labels.push('主食');
  if (est.protein >= 12) labels.push('高蛋白');
  if (!/(肉|鸡|鸭|牛|羊|猪|鱼|虾|蟹|肠|培根|腊|蛋|奶|里脊|排骨|肚|腰|肝|血|丸|蹄|翅|爪|骨)/.test(name)) labels.push('素食');
  if (est.kcal <= 120) labels.push('低热量');
  return [...new Set(labels)].slice(0, 3);
}

module.exports = { estimate, labelsFor, normalizeUnit };
