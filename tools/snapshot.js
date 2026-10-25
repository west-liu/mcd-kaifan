// 导出真实麦当劳 MCP 数据快照，供静态在线版使用
const fs = require('fs');
const path = require('path');
// 先加载 .env，再 require 依赖（lib/mcd 在加载时就会创建 MCP 客户端）
(function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
})();
const {
  resolveStore, getMenu, getNutrition, priceCheck,
  getAvailableCoupons, getCampaigns, findStores,
} = require('../lib/mcd');

const OUT = path.join(__dirname, '..', 'public', 'snapshot.json');

(async () => {
  const city = process.env.DEFAULT_CITY || '广州';
  const store = await resolveStore(city, process.env.DEFAULT_STORE || '', '');
  console.log('门店:', store.storeName, store.storeCode);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const catalog = await getMenu(store.storeCode); await sleep(600);
  const table = await getNutrition(); await sleep(600);
  const coupons = await getAvailableCoupons().catch(() => []); await sleep(600);
  const campaigns = await getCampaigns().catch(() => []); await sleep(600);
  const stores = await findStores(city, '').catch(() => []); await sleep(600);

  // 营养表 -> 数组
  const nutrition = [];
  for (const [name, v] of table.entries()) nutrition.push({ name, ...v });

  // 真实算价样例：挑几件商品走官方算价，作为"官方核价"证据
  const samples = [];
  const picks = [];
  for (const k of ['主食', '小食', '饮料', '甜品']) {
    if (catalog[k] && catalog[k][0]) picks.push(catalog[k][0]);
  }
  if (picks.length) {
    try {
      const px = await priceCheck(store.storeCode, picks.map((p) => ({ code: p.code, name: p.name, qty: 1 })));
      samples.push({ label: '官方算价样例', items: picks.map((p) => ({ name: p.name, price: p.price })), price: px });
    } catch (e) {
      console.error('算价样例失败:', e.message);
    }
  }

  const snap = {
    generatedAt: new Date().toISOString(),
    source: '麦当劳 MCP (https://mcp.mcd.cn)',
    tools: ['query-nearby-stores', 'query-meals', 'list-nutrition-foods', 'query-meal-detail', 'calculate-price', 'query-coupons', 'query-campaigns'],
    city,
    store: { storeCode: store.storeCode, storeName: store.storeName, address: store.address || '' },
    stores: (stores || []).slice(0, 30).map((s) => ({ storeCode: s.storeCode, storeName: s.storeName, address: s.address || '' })),
    catalog,
    nutrition,
    coupons,
    campaigns,
    samples,
  };

  fs.writeFileSync(OUT, JSON.stringify(snap));
  const size = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log('已写入', OUT, size, 'KB');
  console.log('餐品数:', Object.values(catalog).reduce((a, b) => a + b.length, 0), '| 营养条目:', nutrition.length);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
