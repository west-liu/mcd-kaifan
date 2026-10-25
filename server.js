// 开饭参谋 — 麦当劳 MCP 驱动的团餐搭配助手
// 真实调用：query-nearby-stores / query-meals / list-nutrition-foods /
//           calculate-price / available-coupons / auto-bind-coupons /
//           campaign-calendar / create-order
const http = require('http');
const fs = require('fs');
const path = require('path');

// 零依赖加载 .env（必须在 require 业务模块之前，保证 MCP Token 就位）
(function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
})();

const {
  mcp, findStores, resolveStore, getMenu, getNutrition, nutritionFor,
  priceCheck, getAvailableCoupons, claimAllCoupons, getCampaigns,
} = require('./lib/mcd');
const { planAll, PREF_LABEL } = require('./lib/planner');

const PORT = Number(process.env.PORT || 5173);
const DEFAULT_CITY = process.env.DEFAULT_CITY || '广州';
const DEFAULT_STORE = process.env.DEFAULT_STORE || '';
const MEDIA_DIR = path.join(__dirname, 'public');

// ---------- 工具 ----------
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('bad json')); } });
  });
}

// ---------- AI 点评（可选：配置 TOKLENS_KEY 后启用）----------
async function aiSummary(plan, ctx) {
  const key = process.env.TOKLENS_KEY;
  if (!key) return null;
  const list = plan.items.map((i) => `${i.qty}× ${i.name} ¥${i.price}`).join('；');
  const prefText = ctx.prefs.map((p, i) => `第${i + 1}人：${p.map((x) => PREF_LABEL[x]).filter(Boolean).join('、') || '没讲究'}`).join('；');
  const prompt = `你是麦当劳团餐搭配参谋。${ctx.headcount} 人，预算 ¥${ctx.budget}，偏好：${prefText}。
这一套（${plan.modeName}）：${list}。合计 ¥${plan.total}，人均 ¥${plan.perPerson}${plan.totalKcal ? `，总热量约 ${plan.totalKcal} 大卡` : ''}。
用 2 句话、70 字以内点评：这套为什么合理，再给一句可优化建议。口语化，不要分点，不要引号。`;
  try {
    const r = await fetch(process.env.TOKLENS_URL || 'https://hkg.toklens.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TOKLENS_MODEL || 'grok-4.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 160,
        reasoning_effort: 'low',
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    const t = j.choices?.[0]?.message?.content?.trim();
    return t ? t.replace(/^["「『]|["」』]$/g, '') : null;
  } catch (e) {
    console.error('[aiSummary] 失败:', e.message);
    return null;
  }
}

function localSummary(p) {
  const parts = [`落在 ¥${p.total}，人均 ¥${p.perPerson}`];
  if (p.totalKcal) {
    const tail = p.kcalFull ? '' : `（${p.kcalKnown}/${p.kcalTotal} 项有官方数据）`;
    parts.push(`总热量约 ${p.totalKcal} 大卡，人均 ${p.kcalPerPerson}${tail}`);
  }
  if (p.blockedList.length) parts.push(`全桌避开：${p.blockedList.join('、')}`);
  if (p.leftover >= 8) parts.push(`还剩 ¥${p.leftover}，还能再加一份`);
  return parts.join('；') + '。';
}

// 生成候选 → 交给麦当劳官方算价 → 逐项核对小计；对不上的餐品直接拉黑重搭
// （例如"双人分享餐八件套"这类需要选子项的组合，官方算价会按默认高价计，必须剔除）
async function planWithValidation({ headcount, budget, prefs, catalog, table, storeCode, maxRounds = 3 }) {
  const banned = new Set();
  let last = [];
  for (let round = 0; round < maxRounds; round++) {
    const drafts = planAll({ headcount, budget, prefs, catalog, table, banned });
    if (!drafts.length) break;

    const priced = await Promise.all(drafts.map(async (d) => {
      try {
        return { d, px: await priceCheck(storeCode, d.items), err: null };
      } catch (e) {
        return { d, px: null, err: e.message };
      }
    }));

    const validated = priced.map(({ d, px }) => {
      if (!px) return { plan: d, px: null, bad: [], over: false, pricedBy: 'local' };
      const bad = [];
      for (const line of px.lines) {
        const mine = d.items.find((i) => i.code === line.code);
        if (!mine) continue;
        const expect = Math.round(mine.price * mine.qty * 100) / 100;
        if (Math.abs(line.subtotal - expect) > 0.6) {
          bad.push({ code: line.code, name: line.name, expect, got: line.subtotal });
        }
      }
      const mine = Math.round(d.items.reduce((n, i) => n + i.price * i.qty, 0) * 100) / 100;
      return { plan: d, px, bad, over: px.payable > mine + 0.6, pricedBy: 'mcd-calculate-price' };
    });

    const good = validated.filter((v) => v.px && !v.bad.length && !v.over);
    last = good.length ? good : validated;
    if (good.length === drafts.length) return { plans: good, banned, rounds: round + 1 };

    // 把对不上的餐品拉黑，下一轮换一批
    let added = false;
    for (const v of validated) {
      for (const b of (v.bad || [])) if (!banned.has(b.code)) { banned.add(b.code); added = true; }
      if (v.over) for (const it of v.plan.items) if (!banned.has(it.code)) { banned.add(it.code); added = true; }
    }
    if (!added) break;
  }
  return { plans: last, banned, rounds: maxRounds };
}

// 补齐热量：营养表没有的组合餐，拉官方餐品详情把子项拆开累加
async function enrichKcal(plans, storeCode, table, headcount) {
  await Promise.all(plans.map(async (pl) => {
    await Promise.all(pl.items.map(async (it) => {
      if (it.kcal != null) return;
      const n = await nutritionFor({ name: it.name, code: it.code }, storeCode, table);
      if (n) { it.kcal = n.kcal; it.kcalSource = n.source; }
    }));
    const known = pl.items.filter((i) => i.kcal != null);
    pl.totalKcal = known.length
      ? Math.round(known.reduce((s, i) => s + i.kcal * i.qty, 0)) : null;
    pl.kcalKnown = known.length;
    pl.kcalTotal = pl.items.length;
    pl.kcalFull = known.length === pl.items.length;
    pl.kcalPerPerson = pl.totalKcal ? Math.round(pl.totalKcal / headcount) : null;
  }));
  return plans;
}

// ---------- 方案存储（供前端轮询 AI 点评）----------
const plans = new Map();
const PLAN_TTL = 15 * 60 * 1000;
function savePlan(p) {
  const now = Date.now();
  for (const [id, x] of plans) if (now - x.at > PLAN_TTL) plans.delete(id);
  plans.set(p.id, { at: now, plan: p });
}

// ---------- 路由 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // 门店搜索
    if (p === '/api/stores') {
      const city = url.searchParams.get('city') || DEFAULT_CITY;
      const keyword = url.searchParams.get('keyword') || city;
      const list = await findStores(city, keyword);
      return send(res, 200, { ok: true, city, stores: list.slice(0, 20) });
    }

    // 默认门店
    if (p === '/api/store') {
      const city = url.searchParams.get('city') || DEFAULT_CITY;
      const store = await resolveStore(city, url.searchParams.get('store') || DEFAULT_STORE);
      const menu = await getMenu(store.storeCode);
      return send(res, 200, {
        ok: true, storeCode: store.storeCode, storeName: store.storeName, address: store.address,
        counts: Object.fromEntries(Object.entries(menu).map(([k, v]) => [k, v.length])),
      });
    }

    // 生成搭配（3 套 + 官方核价）
    if (p === '/api/plan' && req.method === 'POST') {
      const b = await readBody(req);
      const headcount = Math.max(1, Math.min(8, Number(b.headcount) || 2));
      const budget = Math.max(20, Math.min(2000, Number(b.budget) || 60));
      const prefs = (Array.isArray(b.prefs) ? b.prefs : []).slice(0, headcount);
      const city = b.city || DEFAULT_CITY;

      const store = await resolveStore(city, b.storeCode || DEFAULT_STORE, b.keyword);
      const [catalog, table] = await Promise.all([getMenu(store.storeCode), getNutrition()]);

      const { plans: validated, banned, rounds } = await planWithValidation({
        headcount, budget, prefs, catalog, table, storeCode: store.storeCode,
      });
      if (!validated.length) throw new Error('这个预算和忌口组合下，没能搭出可行方案');

      // 用官方核价结果覆盖自算价
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

      await enrichKcal(checked, store.storeCode, table, headcount);

      // 主推：默认均衡；若超预算则取最便宜的一套
      const inBudget = checked.filter((c) => c.total <= budget);
      const ranked = [...checked].sort((a, b) => a.total - b.total);
      const hero = inBudget.find((c) => c.mode === 'balanced') || inBudget[0] || ranked[0];

      const payload = {
        id: Math.random().toString(36).slice(2, 8).toUpperCase(),
        storeCode: store.storeCode, storeName: store.storeName,
        headcount, budget, prefs,
        plans: checked, heroMode: hero.mode,
        mcpCalls: ['query-nearby-stores', 'query-meals', 'list-nutrition-foods', 'calculate-price'],
        nutritionSize: table.size,
        priceRounds: rounds,
        excludedByPriceCheck: [...banned].length,
        summary: null,
      };
      payload.summary = localSummary(hero);
      savePlan(payload);
      aiSummary(hero, { headcount, budget, prefs })
        .then((t) => { if (t) { payload.summary = t; payload.summarySource = 'ai'; } })
        .catch(() => {});
      return send(res, 200, { ok: true, plan: payload });
    }

    const mPlan = p.match(/^\/api\/plan\/([A-Z0-9]+)$/);
    if (mPlan) {
      const hit = plans.get(mPlan[1]);
      if (!hit) return send(res, 404, { ok: false, error: '方案已过期，请重新搭配' });
      return send(res, 200, { ok: true, plan: hit.plan });
    }

    // 优惠券
    if (p === '/api/coupons') {
      const list = await getAvailableCoupons();
      return send(res, 200, { ok: true, coupons: list });
    }
    if (p === '/api/coupons/claim' && req.method === 'POST') {
      const r = await claimAllCoupons();
      return send(res, 200, { ok: r.ok, data: r.data, text: r.text });
    }

    // 今日活动
    if (p === '/api/campaigns') {
      const list = await getCampaigns();
      return send(res, 200, { ok: true, campaigns: list });
    }

    // 真实下单（需用户主动确认）
    if (p === '/api/order' && req.method === 'POST') {
      if (process.env.ENABLE_ORDER === '0') {
        return send(res, 403, { ok: false, error: '服务端已关闭真实下单' });
      }
      const b = await readBody(req);
      if (!b.confirm) return send(res, 400, { ok: false, error: '需要二次确认才会下单' });
      const storeCode = b.storeCode;
      const items = (b.items || []).map((i) => ({ productCode: i.code, quantity: i.qty }));
      if (!storeCode || !items.length) return send(res, 400, { ok: false, error: '缺少门店或商品' });
      const r = await mcp.callRaw('create-order', {
        storeCode, orderType: 1, beType: 1, items,
        takeWayCode: b.takeWayCode || 'take-in-store',
        remark: b.remark || '',
      });
      return send(res, 200, { ok: !r.isError, data: r.data?.data, text: r.text.slice(0, 600) });
    }

    // 健康检查 / MCP 连通性自检
    if (p === '/api/health') {
      const tools = await mcp.listTools();
      return send(res, 200, {
        ok: true,
        endpoint: 'https://mcp.mcd.cn',
        tokenConfigured: !!process.env.MCD_TOKEN,
        toolsAvailable: tools.length,
        tools: tools.map((t) => t.name).filter((n) => [
          'query-nearby-stores', 'query-meals', 'calculate-price', 'create-order',
          'list-nutrition-foods', 'available-coupons', 'campaign-calendar',
        ].includes(n)),
      });
    }

    // 静态文件
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(MEDIA_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error('[error]', p, e.message);
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`开饭参谋 running: http://localhost:${PORT}`);
  console.log(`MCD_TOKEN ${process.env.MCD_TOKEN ? '已配置' : '缺失'} | 真实下单 ${process.env.ENABLE_ORDER === '0' ? '已关闭' : '开启'}`);
});
