// 探测关键工具的真实返回结构
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = process.env.STORE || '1400359';
const c = new MCPClient(TOKEN);

const p = (label, obj, depth = 3) => {
  console.log('\n===== ' + label + ' =====');
  console.log(JSON.stringify(obj, null, 1).slice(0, 2200));
};

(async () => {
  // 1. 菜单（拿到真实 items 结构）
  const menu = await c.call('query-meals', { storeCode: STORE, orderType: 1, beType: 1 }, 11);
  const meals = menu.data?.meals || {};
  const codes = Object.keys(meals).slice(0, 3);
  console.log('menu keys:', Object.keys(menu.data || {}));
  console.log('meals count:', Object.keys(meals).length);
  p('sample meal', Object.fromEntries(codes.map(k => [k, meals[k]])));

  // 2. 门店券
  try {
    const cp = await c.call('query-store-coupons', { storeCode: STORE, orderType: 1, beType: 1 }, 12);
    p('query-store-coupons', cp, 2);
  } catch (e) { console.log('\n!! coupons ERR', e.message); }

  // 3. 营养
  try {
    const nu = await c.call('list-nutrition-foods', {}, 13);
    const d = nu.data;
    const arr = Array.isArray(d) ? d : (d?.foods || d?.list || []);
    console.log('\n===== nutrition =====');
    console.log('type:', Array.isArray(d) ? 'array' : typeof d, 'len:', arr.length);
    console.log(JSON.stringify(arr.slice(0, 2), null, 1).slice(0, 1200));
  } catch (e) { console.log('\n!! nutrition ERR', e.message); }

  // 4. 活动日历
  try {
    const cal = await c.call('campaign-calendar', {}, 14);
    p('campaign-calendar', cal, 2);
  } catch (e) { console.log('\n!! calendar ERR', e.message); }
})().catch(e => console.log('FATAL', e.message));
