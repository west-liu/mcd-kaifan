// 探测 calculate-price / create-order 的真实入参与返回
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = process.env.STORE || '1400359';
const c = new MCPClient(TOKEN);

(async () => {
  // 用两个真实存在的餐品试算价：巨无霸 1100 + 中薯条
  const menu = await c.call('query-meals', { storeCode: STORE, orderType: 1, beType: 1 }, 11);
  const meals = menu.data.meals || {};
  const want = Object.keys(meals).filter(k => /巨无霸|中薯条/.test(meals[k].name)).slice(0, 3);
  console.log('try items:', want.map(k => k + ' ' + meals[k].name + ' ¥' + meals[k].currentPrice).join(' | '));

  const res = await c.callRaw('calculate-price', {
    storeCode: STORE, orderType: 1, beType: 1,
    items: want.map(k => ({ productCode: k, quantity: 1 })),
  });
  console.log('\n===== calculate-price structured =====');
  console.log(JSON.stringify(res.data, null, 1).slice(0, 2500));
  console.log('\n===== text (first 1200) =====');
  console.log(res.text.slice(0, 1200));
})().catch(e => console.log('FATAL', e.message));
