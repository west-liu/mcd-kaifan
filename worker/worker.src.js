// 开饭参谋 · 麦当劳 MCP 边缘代理（Cloudflare Worker）
// ------------------------------------------------------------------
// 作用：浏览器直连 mcp.mcd.cn 会被 CORS 拦掉（该域名不返回
// Access-Control-Allow-Origin，OPTIONS 预检直接 403）。这个 Worker 做三件事：
//   1. 服务端持有/转发 Bearer Token，浏览器永远看不到 Token
//   2. 把 MCP 的 Streamable HTTP + JSON-RPC 转成前端熟悉的 /api/* REST
//   3. 补上 CORS 头，让 GitHub Pages 上的静态页能跨域调它
//
// 部署后前端加 ?api=https://xxx.workers.dev 即可切到实时 MCP。
//
// 环境变量 / Secret：
//   MCD_TOKEN      （必需）麦当劳 MCP 的 Bearer Token
//   ENABLE_ORDER   （可选）"1" 才开放 create-order，默认关闭
//   ALLOW_ORIGIN   （可选）CORS 白名单，默认 "*"
//   DEFAULT_CITY   （可选）默认城市，默认 广州
//   DEFAULT_STORE  （可选）默认门店号
// ------------------------------------------------------------------
export default {
  async fetch(request, env) {
    return handle(request, env).catch((e) => json({ ok: false, error: e.message }, 500, env));
  },
};

const ENDPOINT = 'https://mcp.mcd.cn';
const WAYS = {
  pickup: { orderType: 1, beType: 1, label: '到店自取', needBeCode: false },
  delivery: { orderType: 2, beType: 2, label: '麦乐送外送', needBeCode: true },
};
const wayOf = (w) => WAYS[w] || WAYS.pickup;

/* ---------------- 搭配引擎（由 tools/build-worker.js 从 public/planner.js 注入） ---------------- */
const Plan = (function () {
  const window = {};
  /* __PLANNER__ */
  return window.Plan;
})();

/* ---------------- CORS ---------------- */
function cors(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-mcd-token',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}
function json(obj, status = 200, env = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(env) },
  });
}

/* ---------------- MCP 客户端（Streamable HTTP + JSON-RPC） ---------------- */
function parseSSE(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (d) { try { out.push(JSON.parse(d)); } catch { /* ignore */ } }
    }
  }
  return out;
}
function extractJSON(text) {
  const start = text.indexOf('{"success"');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

class MCP {
  constructor(token) {
    if (!token) throw new Error('缺少 MCD_TOKEN（Worker Secret 或请求头 x-mcd-token）');
    this.token = token; this.sid = null; this.seq = 1;
  }
  async rpc(body) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${this.token}`,
    };
    if (this.sid) headers['mcp-session-id'] = this.sid;
    const r = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.sid = sid;
    const ct = r.headers.get('content-type') || '';
    let j = null;
    if (ct.includes('text/event-stream')) {
      const msgs = parseSSE(text);
      j = msgs.find((m) => m.id === body.id) || msgs[msgs.length - 1] || null;
    } else {
      try { j = JSON.parse(text); } catch { /* ignore */ }
    }
    return { status: r.status, json: j, raw: text };
  }
  async connect() {
    if (this.sid) return;
    const init = await this.rpc({
      jsonrpc: '2.0', id: this.seq++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kaifan-worker', version: '1.0.0' } },
    });
    if (init.status !== 200) throw new Error('MCP 握手失败: ' + init.status);
    await this.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
  }
  async callRaw(tool, args = {}) {
    await this.connect();
    const res = await this.rpc({ jsonrpc: '2.0', id: this.seq++, method: 'tools/call', params: { name: tool, arguments: args } });
    if (!res.json) throw new Error(`${tool} 无响应: ${res.status}`);
    if (res.json.error) throw new Error(`${tool} RPC错误: ${JSON.stringify(res.json.error)}`);
    const result = res.json.result || {};
    const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { data: result.structuredContent || extractJSON(text) || null, text, isError: !!result.isError };
  }
  async call(tool, args = {}) {
    const { data } = await this.callRaw(tool, args);
    if (!data) throw new Error(`${tool} 无法解析返回`);
    if (data.success === false) throw new Error(`${tool} 业务失败: ${data.message || ''}`);
    return data;
  }
  async listTools() {
    await this.connect();
    const res = await this.rpc({ jsonrpc: '2.0', id: this.seq++, method: 'tools/list', params: {} });
    return res.json?.result?.tools || [];
  }
}

/* ---------------- 门店 / 菜单 ---------------- */
async function findStores(mcp, city, keyword) {
  const d = await mcp.call('query-nearby-stores', { beType: 1, searchType: 2, city, keyword: keyword || city });
  return (d.data || []).map((s) => ({
    storeCode: s.storeCode, storeName: s.storeName,
    address: s.address || '', distance: s.distance || '', beCode: s.beCode || '',
  }));
}
async function resolveStore(mcp, env, city, storeCode) {
  const list = await findStores(mcp, city, city);
  if (storeCode) {
    const hit = list.find((s) => s.storeCode === storeCode);
    if (hit) return hit;
    return { storeCode, storeName: env.DEFAULT_STORE_NAME || `麦当劳门店 ${storeCode}`, address: '', beCode: '' };
  }
  const def = env.DEFAULT_STORE && list.find((s) => s.storeCode === env.DEFAULT_STORE);
  if (def) return def;
  if (!list.length) throw new Error(`在「${city}」没查到可点餐门店`);
  return list[0];
}

const EXCLUDE_RE = /丝巾|徽章|毛绒|水手帽|棒球帽|按摩|捶|痒痒挠|百宝袋|联名|周边|开心乐园|亲子|乐园|包装|袋$/;
const CONDIMENT_RE = /风味酱|酱$|^蘸酱$/;
const SHARE_RE = /双人餐|分享餐|多人餐|双人份|全家桶|亲子双人|欢聚/;
const DESSERT_RE = /麦旋风|圆筒|雪冰|阿芙佳朵|冰淇淋|圣代|新地|派$|蛋筒|华夫/;
const SIDE_RE = /薯条|薯饼|薯格|鸡块|麦乐鸡|鸡翅|鸡排|炸鸡|脆汁鸡|芝士条|扭扭薯|拼盘|鸡柳|玉米杯|苹果片|油条|沙拉/;
const DRINK_RE = /咖啡|茶|可乐|牛奶|果汁|纯悦|美汁源|雪碧|芬达|柠柠|橙橙|炫酷|美式|阿萨姆|朱古力|可可|豆浆/;
const MAIN_RE = /堡$|汉堡|卷$|三件套|四件套|二件套|套餐|随心配|单人餐|麦满分|早餐/;
function classify(name, catName) {
  if (!name) return null;
  if (EXCLUDE_RE.test(name) || CONDIMENT_RE.test(name)) return null;
  if (SHARE_RE.test(name)) return 'share';
  if (DESSERT_RE.test(name)) return 'dessert';
  if (/饮品|麦咖啡|饮料/.test(catName || '') || DRINK_RE.test(name)) return 'drink';
  if (SIDE_RE.test(name)) return 'side';
  if (MAIN_RE.test(name)) return 'main';
  return null;
}
async function getMenu(mcp, storeCode, opts = {}) {
  const cfg = wayOf(opts.way);
  const args = { storeCode, orderType: cfg.orderType, beType: cfg.beType };
  if (cfg.needBeCode && opts.beCode) args.beCode = opts.beCode;
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
        code: it.code, name: m.name, price,
        originalPrice: parseFloat(m.originalPrice) || price,
        image: m.image || '', cat: catName, tags: it.tags || [],
      });
    }
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.price - b.price);
  return groups;
}

/* ---------------- 营养 ---------------- */
function parseNutrition(text) {
  const map = new Map();
  const body = text.slice(text.indexOf('}:') + 2);
  for (const line of body.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split(',');
    if (parts.length < 9) continue;
    const name = parts[0].trim();
    const nums = parts.slice(parts.length - 8).map(Number);
    const [kj, kcal, protein, fat, carb, sodium, calcium] = nums;
    if (!isFinite(kcal) || !name) continue;
    if (!map.has(name)) map.set(name, { name, energyKj: kj, kcal, protein, fat, carb, sodium, calcium });
  }
  for (const v of map.values()) {
    if (v.kcal != null && v.kcal > 1200) { v.energyKj = v.kcal; v.kcal = Math.round(v.kcal / 4.184); }
  }
  return map;
}
async function getNutrition(mcp) {
  const r = await mcp.callRaw('list-nutrition-foods', {});
  const text = (r.data && typeof r.data.data === 'string') ? r.data.data : r.text;
  return parseNutrition(text);
}

/* ---------------- 官方核价 ---------------- */
async function priceCheck(mcp, storeCode, items, opts = {}) {
  const cfg = wayOf(opts.way);
  const args = {
    storeCode, orderType: cfg.orderType, beType: cfg.beType,
    items: items.map((i) => ({ productCode: i.code, quantity: i.qty })),
  };
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
      code: p.productCode, name: p.productName, qty: p.quantity,
      original: (p.originalSubtotal || 0) / 100, subtotal: (p.subtotal || 0) / 100,
    })),
  };
}

/* ---------------- 券 / 活动 ---------------- */
async function getCoupons(mcp) {
  try {
    const r = await mcp.callRaw('available-coupons', {});
    return (r.data?.data || []).map((c) => ({ name: c.couponName, image: c.couponImage, status: c.couponStatus, label: c.label || '' }));
  } catch { return []; }
}
async function getCampaigns(mcp) {
  try {
    const r = await mcp.callRaw('campaign-calendar', {});
    const titles = [];
    for (const line of (r.text || '').split(/\r?\n/)) {
      const m = line.match(/\*\*活动标题\*\*[：:]\s*(.+)/);
      if (m) titles.push(m[1].trim());
    }
    return titles.slice(0, 8);
  } catch { return []; }
}

/* ---------------- 生成方案（本地搭 → 官方核价 → 校验） ---------------- */
async function planWithValidation(mcp, { headcount, budget, prefs, catalog, table, storeCode, opts, maxRounds = 2 }) {
  const banned = new Set();
  let last = [];
  for (let round = 0; round < maxRounds; round++) {
    const drafts = Plan.planAll({ headcount, budget, prefs, catalog, table, banned });
    if (!drafts.length) break;
    const priced = await Promise.all(drafts.map(async (d) => {
      try { return { d, px: await priceCheck(mcp, storeCode, d.items, opts) }; }
      catch { return { d, px: null }; }
    }));
    const validated = priced.map(({ d, px }) => {
      if (!px) return { plan: d, px: null, bad: [], over: false, pricedBy: 'local-estimate' };
      const bad = [];
      for (const line of px.lines) {
        const mine = d.items.find((i) => i.code === line.code);
        if (!mine) continue;
        const expect = Math.round(mine.price * mine.qty * 100) / 100;
        if (Math.abs(line.subtotal - expect) > 0.6) bad.push({ code: line.code, name: line.name });
      }
      const mine = Math.round(d.items.reduce((n, i) => n + i.price * i.qty, 0) * 100) / 100;
      return { plan: d, px, bad, over: px.payable > mine + 0.6, pricedBy: 'mcd-calculate-price' };
    });
    const good = validated.filter((v) => v.px && !v.bad.length && !v.over);
    last = good.length ? good : validated;
    if (good.length === drafts.length) return { plans: good, banned, rounds: round + 1 };
    let added = false;
    for (const v of validated) {
      for (const b of (v.bad || [])) if (!banned.has(b.code)) { banned.add(b.code); added = true; }
      if (v.over) for (const it of v.plan.items) if (!banned.has(it.code)) { banned.add(it.code); added = true; }
    }
    if (!added) break;
  }
  return { plans: last, banned, rounds: maxRounds };
}

function localSummary(p, headcount) {
  const parts = [`落在 ¥${p.total}，人均 ¥${p.perPerson}`];
  if (p.totalKcal) parts.push(`总热量约 ${p.totalKcal} 大卡，人均 ${p.kcalPerPerson}`);
  if (p.blockedList && p.blockedList.length) parts.push(`全桌避开：${p.blockedList.join('、')}`);
  if (p.leftover >= 8) parts.push(`还剩 ¥${p.leftover}，还能再加一份`);
  return parts.join('；') + '。';
}

/* ---------------- 下单幂等（防连点重复建单，同一 isolate 内有效） ---------------- */
const recentOrders = new Map();

/* ---------------- 路由 ---------------- */
async function handle(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

  const token = request.headers.get('x-mcd-token') || env.MCD_TOKEN || '';
  const mcp = new MCP(token);

  if (p === '/api/health') {
    if (!token) return json({ ok: false, error: '未配置 MCD_TOKEN' }, 200, env);
    try {
      const tools = await mcp.listTools();
      return json({
        ok: true, endpoint: ENDPOINT, via: 'cloudflare-worker',
        tokenConfigured: true, toolsAvailable: tools.length,
        tools: tools.map((t) => t.name),
        orderEnabled: env.ENABLE_ORDER === '1',
      }, 200, env);
    } catch (e) {
      return json({ ok: false, error: 'MCP 握手失败: ' + e.message }, 200, env);
    }
  }

  if (p === '/api/stores') {
    const city = url.searchParams.get('city') || env.DEFAULT_CITY || '广州';
    const list = await findStores(mcp, city, url.searchParams.get('keyword') || city);
    return json({ ok: true, city, stores: list.slice(0, 20) }, 200, env);
  }

  if (p === '/api/store') {
    const city = url.searchParams.get('city') || env.DEFAULT_CITY || '广州';
    const store = await resolveStore(mcp, env, city, url.searchParams.get('store') || env.DEFAULT_STORE || '');
    return json({ ok: true, storeCode: store.storeCode, storeName: store.storeName, address: store.address }, 200, env);
  }

  if (p === '/api/campaigns') return json({ ok: true, campaigns: await getCampaigns(mcp) }, 200, env);
  if (p === '/api/coupons') return json({ ok: true, coupons: await getCoupons(mcp) }, 200, env);
  if (p === '/api/coupons/claim' && request.method === 'POST') {
    const r = await mcp.callRaw('auto-bind-coupons', {});
    return json({ ok: !r.isError, data: r.data?.data, text: r.text.slice(0, 400) }, 200, env);
  }

  if (p === '/api/addresses') {
    try {
      const r = await mcp.callRaw('delivery-query-addresses', {});
      return json({ ok: true, addresses: (r.data?.data?.addresses || []).map((a) => ({
        addressId: a.addressId, contactName: a.contactName, fullAddress: a.fullAddress, phone: a.phone,
      })) }, 200, env);
    } catch (e) { return json({ ok: true, addresses: [], note: e.message }, 200, env); }
  }

  if (p === '/api/plan' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const headcount = Math.max(1, Math.min(8, Number(b.headcount) || 2));
    const budget = Math.max(20, Math.min(2000, Number(b.budget) || 60));
    const prefs = (Array.isArray(b.prefs) ? b.prefs : []).slice(0, headcount);
    const city = b.city || env.DEFAULT_CITY || '广州';
    const way = b.way === 'delivery' ? 'delivery' : 'pickup';
    const cfg = wayOf(way);

    let store;
    if (way === 'delivery') {
      const ar = await mcp.callRaw('delivery-query-addresses', {});
      const addrs = ar.data?.data?.addresses || [];
      if (!addrs.length) throw new Error('账户里还没有配送地址，先在麦当劳 App 里加一个');
      const addressId = b.addressId || addrs[0].addressId;
      const sr = await mcp.callRaw('delivery-query-stores', { beType: 2, addressId });
      const arr = sr.data?.data || [];
      if (!arr.length) throw new Error('这个地址附近没有可配送的门店');
      const hit = b.storeCode && arr.find((s) => s.storeCode === b.storeCode);
      const s = hit || arr[0];
      store = { storeCode: s.storeCode, storeName: s.storeName, address: s.address || '', beCode: s.beCode || '' };
      store.addressId = addressId;
      store.addressLabel = addrs.find((a) => a.addressId === addressId)?.fullAddress || '';
    } else {
      store = await resolveStore(mcp, env, city, b.storeCode || env.DEFAULT_STORE || '');
    }

    const opts = { way, beCode: store.beCode || '', needTableware: b.needTableware !== false };
    const [catalog, table] = await Promise.all([getMenu(mcp, store.storeCode, opts), getNutrition(mcp)]);

    const { plans: validated, banned, rounds } = await planWithValidation(mcp, {
      headcount, budget, prefs, catalog, table, storeCode: store.storeCode, opts,
    });
    if (!validated.length) throw new Error('这个预算和忌口组合下，没能搭出可行方案');

    const checked = validated.map((v) => {
      const d = v.plan;
      const price = v.px || {
        original: d.originalTotal, payable: d.total, discount: 0,
        lines: d.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, subtotal: i.price * i.qty })),
      };
      const total = price.payable;
      return {
        ...d, price, pricedBy: v.pricedBy,
        saved: Math.max(0, Math.round((price.original - price.payable) * 100) / 100),
        total,
        perPerson: Math.round((total / headcount) * 10) / 10,
        leftover: Math.round((budget - total) * 10) / 10,
        usage: Math.round((total / budget) * 100),
      };
    });
    for (const pl of checked) {
      const known = pl.items.filter((i) => i.kcal != null);
      pl.totalKcal = known.length ? Math.round(known.reduce((s, i) => s + i.kcal * i.qty, 0)) : null;
      pl.kcalKnown = known.length; pl.kcalTotal = pl.items.length;
      pl.kcalFull = known.length === pl.items.length;
      pl.kcalPerPerson = pl.totalKcal ? Math.round(pl.totalKcal / headcount) : null;
    }

    const inBudget = checked.filter((c) => c.total <= budget);
    const ranked = [...checked].sort((a, b) => a.total - b.total);
    const hero = inBudget.find((c) => c.mode === 'balanced') || inBudget[0] || ranked[0];

    return json({
      ok: true,
      plan: {
        id: Math.random().toString(36).slice(2, 8).toUpperCase(),
        storeCode: store.storeCode, storeName: store.storeName, address: store.address || '',
        way, wayLabel: cfg.label, beCode: store.beCode || '',
        deliverTo: way === 'delivery' ? { addressId: store.addressId, label: store.addressLabel } : null,
        headcount, budget, prefs,
        plans: checked, heroMode: hero.mode,
        mcpCalls: way === 'delivery'
          ? ['delivery-query-addresses', 'delivery-query-stores', 'query-meals', 'list-nutrition-foods', 'calculate-price']
          : ['query-nearby-stores', 'query-meals', 'list-nutrition-foods', 'calculate-price'],
        nutritionSize: table.size, priceRounds: rounds,
        excludedByPriceCheck: [...banned].length,
        summary: localSummary(hero, headcount), summarySource: 'local',
      },
    }, 200, env);
  }

  // 订单状态 / 取餐码（付款成功后 pickupCode 才有值）
  const mOrder = p.match(/^\/api\/order\/([A-Za-z0-9]+)$/);
  if (mOrder) {
    const r = await mcp.callRaw('query-order', { orderId: mOrder[1] });
    const d = r.data?.data || {};
    return json({
      ok: !r.isError,
      order: {
        orderId: d.orderId || mOrder[1],
        status: d.status, statusName: d.statusName || d.orderStatusName || '',
        pickupCode: d.pickupCode || '', payAmount: d.payAmount || '',
      },
    }, 200, env);
  }

  if (p === '/api/order' && request.method === 'POST') {
    if (env.ENABLE_ORDER !== '1') return json({ ok: false, error: '该 Worker 已关闭真实下单（ENABLE_ORDER=1 才开放）' }, 403, env);
    const b = await request.json().catch(() => ({}));
    if (!b.confirm) return json({ ok: false, error: '需要二次确认才会下单' }, 400, env);
    const items = (b.items || []).map((i) => ({ productCode: i.code, quantity: i.qty }));
    if (!b.storeCode || !items.length) return json({ ok: false, error: '缺少门店或商品' }, 400, env);
    const way = b.way === 'delivery' ? 'delivery' : 'pickup';
    const cfg = wayOf(way);
    const args = { storeCode: b.storeCode, orderType: cfg.orderType, beType: cfg.beType, items, remark: b.remark || '' };
    if (way === 'delivery') {
      if (!b.addressId) return json({ ok: false, error: '外送需要 addressId' }, 400, env);
      args.addressId = b.addressId;
      if (b.beCode) args.beCode = b.beCode;
      args.needTableware = b.needTableware !== false;
    } else {
      args.takeWayCode = b.takeWayCode || 'take-in-store';
    }

    // 幂等：60 秒内「同门店 + 同商品 + 同方式」只建一单（同一 isolate 内有效）
    const sig = way + '|' + b.storeCode + '|' + items.map((i) => `${i.productCode}x${i.quantity}`).sort().join(',');
    const now = Date.now();
    for (const [k, v] of recentOrders) if (now - v.at > 60000) recentOrders.delete(k);
    const hit = recentOrders.get(sig);
    if (hit) return json({ ok: true, duplicated: true, data: hit.data, note: '60 秒内已下过同一单，未重复创建' }, 200, env);

    const r = await mcp.callRaw('create-order', args);
    const d = r.data?.data || {};
    recentOrders.set(sig, { at: now, data: d });
    return json({
      ok: !r.isError, data: d,
      // 支付链接只在下单这一次返回，query-order 查不回来，必须立刻给到前端
      orderId: d.orderId || '', payH5Url: d.payH5Url || '',
      expirePayTime: d.expirePayTime || '', payAmount: d.payAmount || d.price || '',
      text: r.text.slice(0, 600),
    }, 200, env);
  }

  // 兜底：暴露一个通用 MCP 转发，方便调试任意工具
  if (p === '/api/mcp' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!b.tool) return json({ ok: false, error: '缺少 tool' }, 400, env);
    const r = await mcp.callRaw(b.tool, b.args || {});
    return json({ ok: !r.isError, data: r.data, text: r.text.slice(0, 4000) }, 200, env);
  }

  return json({
    ok: true, service: 'kaifan-mcp-proxy',
    endpoints: ['/api/health', '/api/plan', '/api/store', '/api/stores', '/api/campaigns', '/api/coupons', '/api/addresses', '/api/mcp'],
  }, 200, env);
}
