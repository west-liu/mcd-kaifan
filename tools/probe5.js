// 探测 query-meal-detail：组合餐（共享餐/套餐）的子项结构，用于构造 roundList
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = process.env.STORE || '1400359';
const CODE = process.argv[2];
const c = new MCPClient(TOKEN);

(async () => {
  const menu = await c.call('query-meals', { storeCode: STORE, orderType: 1, beType: 1 });
  const meals = menu.data.meals || {};
  let code = CODE;
  if (!code) {
    const hit = Object.keys(meals).find((k) => /分享餐|八件套|双人餐/.test(meals[k].name));
    code = hit;
    console.log('auto pick:', code, meals[code]?.name, meals[code]?.currentPrice);
  }
  const d = await c.call('query-meal-detail', { storeCode: STORE, orderType: 1, beType: 1, code });
  console.log('\n===== detail keys =====');
  console.log(Object.keys(d.data || {}));
  console.log(JSON.stringify(d.data, null, 1).slice(0, 4000));
})().catch((e) => console.log('FATAL', e.message));
