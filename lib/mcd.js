// 麦当劳 MCP 业务封装：门店 / 菜单 / 营养 / 算价 / 券 / 活动
const { MCPClient } = require('../mcp');

const mcp = new MCPClient(process.env.MCD_TOKEN);

// 取餐方式 → MCP 的 orderType / beType
// 1-到店取餐 / 2-麦乐送到家 / 5-得来速(DT) / 6-企业团餐
// orderType: 1-到店（自取+得来速），2-外送（麦乐送+团餐）
const WAYS = {
  pickup:   { orderType: 1, beType: 1, label: '到店自取', needBeCode: false },
  delivery: { orderType: 2, beType: 2, label: '麦乐送外送', needBeCode: true },
};
const wayOf = (way) => WAYS[way] || WAYS.pickup;

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
  return fn().then((val) => { cache.set(key, { at: Date.now(), val }); return val; });
}

// ---------- 门店 ----------
async function findStores(city, keyword) {
  const d = await mcp.call('query-nearby-stores', {
    beType: 1, searchType: 2, city, keyword: keyword || city,
  });
  return (d.data || []).map((s) => ({
    storeCode: s.storeCode,
    storeName: s.storeName,
    address: s.address || '',
    distance: s.distance || '',
    beCode: s.beCode || '',
  }));
}

async function resolveStore(city, storeCode, keyword) {
  const list = await cached(`stores:${city}:${keyword || ''}`, 30 * 60 * 1000, () => findStores(city, keyword));
  if (storeCode) {
    // 明确指定的门店优先（DEFAULT_STORE 是自己验证过的门店，即使不在本次搜索结果里也信任）
    const hit = list.find((s) => s.storeCode === storeCode);
    if (hit) return hit;
    return { storeCode, storeName: process.env.DEFAULT_STORE_NAME || `麦当劳门店 ${storeCode}`, address: '', beCode: '' };
  }
  if (!list.length) throw new Error(`在「${city}」没查到可点餐门店`);
  return list[0];
}

// ---------- 菜单 ----------
// 周边/玩具/酱包不参与搭配
const EXCLUDE_RE = /丝巾|徽章|毛绒|水手帽|棒球帽|按摩|捶|痒痒挠|百宝袋|联名|周边|开心乐园|亲子|乐园|包装|袋$/;
const CONDIMENT_RE = /风味酱|酱$|^蘸酱$/;
const SHARE_RE = /双人餐|分享餐|多人餐|双人份|全家桶|亲子双人|欢聚/;
const DESSERT_RE = /麦旋风|圆筒|雪冰|阿芙佳朵|冰淇淋|圣代|新地|派$|蛋筒|华夫/;
const SIDE_RE = /薯条|薯饼|薯格|鸡块|麦乐鸡|鸡翅|鸡排|炸鸡|脆汁鸡|芝士条|扭扭薯|拼盘|鸡柳|玉米杯|苹果片|油条|沙拉/;
const DRINK_RE = /咖啡|茶|可乐|牛奶|果汁|纯悦|美汁源|雪碧|芬达|柠柠|橙橙|炫酷|美式|阿萨姆|朱古力|可可|豆浆/;
const MAIN_RE = /堡$|汉堡|卷$|三件套|四件套|二件套|套餐|随心配|单人餐|麦满分|早餐/;
const BREAKFAST_RE = /麦满分|早餐|粥|油条|薯饼|咖啡/;

function classify(name, catName) {
  if (!name) return null;
  if (EXCLUDE_RE.test(name)) return null;
  if (CONDIMENT_RE.test(name)) return null;
  if (SHARE_RE.test(name)) return 'share';
  if (DESSERT_RE.test(name)) return 'dessert';
  if (/饮品|麦咖啡|饮料/.test(catName || '') || DRINK_RE.test(name)) return 'drink';
  if (SIDE_RE.test(name)) return 'side';
  if (MAIN_RE.test(name)) return 'main';
  return null;
}

// ---------- 外送（麦乐送）：需要账户里的配送地址才能查到可送门店与 beCode ----------
async function getAddresses() {
  return cached('addresses', 5 * 60 * 1000, async () => {
    const r = await mcp.callRaw('delivery-query-addresses', {});
    const arr = r.data?.data?.addresses || [];
    return arr.map((a) => ({
      addressId: a.addressId, contactName: a.contactName,
      fullAddress: a.fullAddress, phone: a.phone,
    }));
  });
}

async function getDeliveryStores(addressId) {
  return cached(`dstores:${addressId}`, 30 * 60 * 1000, async () => {
    const r = await mcp.callRaw('delivery-query-stores', { beType: 2, addressId });
    const arr = r.data?.data || [];
    return arr.map((s) => ({
      storeCode: s.storeCode, storeName: s.storeName,
      beCode: s.beCode || '', address: s.address || '',
    }));
  });
}

// 外送门店解析：地址 → 可送门店 → beCode（query-meals / calculate-price 外送场景必传）
async function resolveDelivery(addressId, storeCode) {
  const addrs = await getAddresses();
  if (!addrs.length) throw new Error('账户里还没有配送地址，先在麦当劳 App 里加一个（或用 delivery-create-address 建）');
  const id = addressId || addrs[0].addressId;
  const stores = await getDeliveryStores(id);
  if (!stores.length) throw new Error('这个地址附近没有可配送的门店');
  const hit = storeCode && stores.find((s) => s.storeCode === storeCode);
  const s = hit || stores[0];
  return { ...s, addressId: id, addressLabel: (addrs.find((a) => a.addressId === id) || {}).fullAddress || '' };
}

async function getMenu(storeCode, opts = {}) {
  const way = opts.way || 'pickup';
  const cfg = wayOf(way);
  const beCode = opts.beCode || '';
  return cached(`menu:${storeCode}:${way}:${beCode}`, 10 * 60 * 1000, async () => {
    const args = { storeCode, orderType: cfg.orderType, beType: cfg.beType };
    if (cfg.needBeCode && beCode) args.beCode = beCode;
    const d = await mcp.call('query-meals', args);
    const meals = d.data?.meals || {};
    const groups = { main: [], side: [], drink: [], dessert: [], share: [] };
    const seen = new Set();
    for (const cat of d.data?.categories || []) {
      const catName = (cat.name || '').replace(/\n/g, '');
      for (const it of cat.meals || []) {
        const m = meals[it.code];
        if (!m || seen.has(it.code)) continue;
        const price = parseFloat(m.currentPrice);
        if (!isFinite(price) || price <= 0) continue;
        const kind = classify(m.name, catName);
        if (!kind) continue;
        seen.add(it.code);
        groups[kind].push({
          code: it.code,
          name: m.name,
          price,
          originalPrice: parseFloat(m.originalPrice) || price,
          image: m.image || '',
          cat: catName,
          tags: it.tags || [],
        });
      }
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.price - b.price);
    return groups;
  });
}

// ---------- 营养 ----------
// list-nutrition-foods 返回的是定长文本表：
// [160]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:
//   猪柳麦满分,null,1288,308,16,16,24,781,213
function parseNutrition(text) {
  const map = new Map();
  const body = text.slice(text.indexOf('}:') + 2);
  for (const line of body.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split(',');
    if (parts.length < 9) continue;
    const name = parts[0].trim();
    const nums = parts.slice(parts.length - 8).map((x) => Number(x));
    const [kj, kcal, protein, fat, carb, sodium, calcium] = nums;
    if (!isFinite(kcal) || !name) continue;
    if (!map.has(name)) {
      map.set(name, { name, energyKj: kj, kcal, protein, fat, carb, sodium, calcium });
    }
  }
  return map;
}

let nutritionTable = null;
async function getNutrition() {
  if (nutritionTable) return nutritionTable;
  return cached('nutrition', 6 * 60 * 60 * 1000, async () => {
    const r = await mcp.callRaw('list-nutrition-foods', {});
    const text = (r.data && typeof r.data.data === 'string') ? r.data.data : r.text;
    nutritionTable = parseNutrition(text);
    // 兜底：官方营养表的能量列偶尔按千焦混进来。单件餐品超过 1200 kcal 不合常理，
    // 这种情况按千焦处理（1 kcal = 4.184 kJ），否则热量会被放大四倍
    for (const v of nutritionTable.values()) {
      if (v.kcal != null && v.kcal > 1200) {
        v.energyKj = v.kcal;
        v.kcal = Math.round(v.kcal / 4.184);
      }
    }
    return nutritionTable;
  });
}

// 组合套餐名 -> 可能的基础餐品名（营养表只收录基础餐品）
const COMBO_SUFFIX = /(三件套|四件套|二件套|五件套|套餐|随心配|单人餐|分享餐|双人餐|多人餐|早餐|组合)$/;
function baseName(name) {
  return (name || '').replace(COMBO_SUFFIX, '').trim();
}

// 菜单名 -> 营养表条目：精确 → 去套餐后缀 → 最长包含匹配
function matchNutrition(name, table) {
  if (!name || !table || !table.size) return null;
  if (table.has(name)) return table.get(name);
  const b = baseName(name);
  if (b && b !== name && table.has(b)) return table.get(b);
  let best = null, bestLen = 0;
  for (const key of table.keys()) {
    if (name.includes(key) || key.includes(name) || (b && (b.includes(key) || key.includes(b)))) {
      if (key.length > bestLen) { best = table.get(key); bestLen = key.length; }
    }
  }
  return best;
}

// ---------- 餐品详情（组合餐子项，用于补齐营养与生成下单清单）----------
async function getMealDetail(storeCode, code, opts = {}) {
  const way = opts.way || 'pickup';
  const cfg = wayOf(way);
  return cached(`detail:${storeCode}:${way}:${code}`, 60 * 60 * 1000, async () => {
    try {
      const args = { storeCode, orderType: cfg.orderType, beType: cfg.beType, code };
      if (cfg.needBeCode && opts.beCode) args.beCode = opts.beCode;
      const d = await mcp.call('query-meal-detail', args);
      return d.data || null;
    } catch { return null; }
  });
}

// 单项热量：先查营养表；查不到且是组合餐时，用官方详情把子项拆开累加
async function nutritionFor(item, storeCode, table, opts = {}) {
  const direct = matchNutrition(item.name, table);
  if (direct) return { kcal: direct.kcal, source: 'table' };
  const d = await getMealDetail(storeCode, item.code, opts);
  if (!d?.rounds?.length) return null;
  let sum = 0, known = 0;
  for (const r of d.rounds) {
    const def = (r.choices || []).find((c) => c.isDefault === 1) || (r.choices || [])[0];
    if (!def) continue;
    const n = matchNutrition(def.name, table);
    if (n) { sum += n.kcal * (r.quantity || 1); known++; }
  }
  return known ? { kcal: sum, source: 'combo', known, rounds: d.rounds.length } : null;
}

// ---------- 官方算价（核心：把候选单丢回 MCP 核价）----------
async function priceCheck(storeCode, items, opts = {}) {
  const cfg = wayOf(opts.way);
  const payload = items.map((i) => ({ productCode: i.code, quantity: i.qty }));
  const args = { storeCode, orderType: cfg.orderType, beType: cfg.beType, items: payload };
  if (cfg.needBeCode && opts.beCode) args.beCode = opts.beCode;
  if (cfg.orderType === 2 && opts.needTableware != null) args.needTableware = !!opts.needTableware;
  const r = await mcp.callRaw('calculate-price', args);
  const d = r.data?.data;
  if (!d) throw new Error('算价失败：' + (r.data?.message || '无返回'));
  return {
    original: (d.originalPrice || 0) / 100,
    payable: (d.price || 0) / 100,
    discount: (d.discount || 0) / 100,
    lines: (d.productList || []).map((p) => ({
      code: p.productCode,
      name: p.productName,
      qty: p.quantity,
      original: (p.originalSubtotal || 0) / 100,
      subtotal: (p.subtotal || 0) / 100,
    })),
  };
}

// ---------- 优惠券 ----------
async function getAvailableCoupons() {
  return cached('coupons', 5 * 60 * 1000, async () => {
    try {
      const r = await mcp.callRaw('available-coupons', {});
      const arr = r.data?.data || [];
      return arr.map((c) => ({
        name: c.couponName, image: c.couponImage,
        status: c.couponStatus, label: c.label || '',
      }));
    } catch { return []; }
  });
}

// 我的卡包（用户真正拥有的券）：可用 / 未到使用时间 / 到期日，和 App 里一致
async function getMyCoupons() {
  return cached('my-coupons', 2 * 60 * 1000, async () => {
    try {
      const r = await mcp.callRaw('query-my-coupons', {});
      const arr = r.data?.data?.coupons || [];
      return arr.map((c) => ({
        name: c.title,
        image: c.image,
        price: c.reducePriceText || '',
        labels: (c.instructions?.labels || []).map((x) => x.text),
        until: (c.instructions?.availableTime || [])
          .map((x) => x.text)
          .filter((t) => t && !/^到期$/.test(t))
          .slice(0, 2)
          .join(' '),
      }));
    } catch { return []; }
  });
}

async function claimAllCoupons() {
  const r = await mcp.callRaw('auto-bind-coupons', {});
  return { ok: !r.isError, text: r.text.slice(0, 400), data: r.data?.data };
}

// ---------- 活动日历 ----------
async function getCampaigns() {
  return cached('campaigns', 30 * 60 * 1000, async () => {
    try {
      const r = await mcp.callRaw('campaign-calendar', {});
      const text = r.text || '';
      const titles = [];
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/\*\*活动标题\*\*[：:]\s*(.+)/);
        if (m) titles.push(m[1].trim());
      }
      return titles.slice(0, 8);
    } catch { return []; }
  });
}

module.exports = {
  mcp, cached, findStores, resolveStore, getMenu, getNutrition, matchNutrition,
  getMealDetail, nutritionFor,
  priceCheck, getAvailableCoupons, getMyCoupons, claimAllCoupons, getCampaigns,
  WAYS, wayOf, getAddresses, getDeliveryStores, resolveDelivery,
};
