// 穷举 roundList 写法，找出官方能接受的组合餐子项格式
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = '1400359';
const CODE = process.argv[2] || '9900011056'; // 全明星双人分享餐八件套
const c = new MCPClient(TOKEN);

(async () => {
  const d = (await c.call('query-meal-detail', { storeCode: STORE, orderType: 1, beType: 1, code: CODE })).data;
  console.log('name:', d.name);
  console.log('rounds:', JSON.stringify(d.rounds.map((r) => ({
    id: r.id, name: r.name, q: r.quantity, min: r.minQuantity, max: r.maxQuantity,
    def: (r.choices || []).filter((ch) => ch.isDefault === 1).map((ch) => ch.code + ':' + ch.name),
    n: (r.choices || []).length,
  })), null, 1));

  const pick = (r) => {
    const def = (r.choices || []).find((ch) => ch.isDefault === 1);
    return def || (r.choices || [])[0];
  };

  const variants = {
    'A 单个choice+round.quantity': d.rounds.map((r) => ({ comboItemList: [{ code: pick(r).code, quantity: r.quantity || 1 }] })),
    'B 单个choice+qty1': d.rounds.map((r) => ({ comboItemList: [{ code: pick(r).code, quantity: 1 }] })),
    'C 带roundId': d.rounds.map((r) => ({ roundId: r.id, comboItemList: [{ code: pick(r).code, quantity: r.quantity || 1 }] })),
    'D 带id': d.rounds.map((r) => ({ id: r.id, comboItemList: [{ code: pick(r).code, quantity: r.quantity || 1 }] })),
    'E 重复choice填满quantity': d.rounds.map((r) => ({
      comboItemList: Array.from({ length: Math.max(1, r.quantity || 1) }, () => ({ code: pick(r).code, quantity: 1 })),
    })),
  };

  for (const [label, rl] of Object.entries(variants)) {
    const r = await c.callRaw('calculate-price', {
      storeCode: STORE, orderType: 1, beType: 1,
      items: [{ productCode: CODE, quantity: 1, roundList: rl }],
    });
    const dd = r.data?.data;
    console.log('\n', label, '->', dd ? dd.price / 100 : 'ERR', dd ? `(原价 ${dd.originalPrice / 100}, 优惠 ${dd.discount / 100})` : (r.data?.message || r.text.slice(0, 200)));
  }
})().catch((e) => console.log('FATAL', e.message));
