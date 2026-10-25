// 验证：给组合餐补上 roundList 后，calculate-price 是否返回正确价格
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = '1400359';
const c = new MCPClient(TOKEN);

async function detail(code) {
  const d = await c.call('query-meal-detail', { storeCode: STORE, orderType: 1, beType: 1, code });
  return d.data;
}
function buildRoundList(d) {
  if (!d?.rounds?.length) return null;
  return d.rounds.map((r) => ({
    comboItemList: (r.choices || [])
      .filter((ch) => ch.isDefault === 1 || (r.quantity > 0 && ch.quantity > 0))
      .slice(0, Math.max(1, r.quantity || 1))
      .map((ch) => ({ code: ch.code, quantity: r.quantity || 1 })),
  })).filter((r) => r.comboItemList.length);
}

(async () => {
  const menu = await c.call('query-meals', { storeCode: STORE, orderType: 1, beType: 1 });
  const meals = menu.data.meals || {};
  const codes = Object.keys(meals).filter((k) => /分享餐|八件套|三件套|Pro套餐/.test(meals[k].name)).slice(0, 4);

  for (const code of codes) {
    const d = await detail(code);
    const rl = buildRoundList(d);
    const name = meals[code].name;
    const menuPrice = meals[code].currentPrice;

    const bare = await c.callRaw('calculate-price', {
      storeCode: STORE, orderType: 1, beType: 1, items: [{ productCode: code, quantity: 1 }],
    });
    const withRl = await c.callRaw('calculate-price', {
      storeCode: STORE, orderType: 1, beType: 1,
      items: [{ productCode: code, quantity: 1, roundList: rl }],
    });
    console.log('\n■', name, '| 菜单价', menuPrice);
    console.log('  rounds:', (d.rounds || []).map((r) => r.name + '(' + r.quantity + ')').join(' / '));
    console.log('  不传 roundList ->', bare.data?.data?.price / 100);
    console.log('  传 roundList   ->', withRl.data?.data?.price / 100, '| discount', withRl.data?.data?.discount / 100);
    if (withRl.data?.data?.errMsg || withRl.data?.message) console.log('  msg:', withRl.data?.data?.errMsg || withRl.data?.message);
  }
})().catch((e) => console.log('FATAL', e.message));
