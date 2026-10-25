// 本地真下单探针：默认只核价（dry-run），加 --confirm 才会真的 create-order
// 用法：
//   node tools/order.js                      只核价，打印 takeWayCode / 应付
//   node tools/order.js --store 1400447      指定门店
//   node tools/order.js --confirm            真下单（会生成真实麦当劳订单！）
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).reduce((m, l) => { const i = l.indexOf('='); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim(); return m; }, {});
const TOKEN = process.env.MCD_TOKEN || env.MCD_TOKEN;

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] || d) : d; };
const has = (k) => argv.includes(k);
const STORE = get('--store', '1400447');
const CONFIRM = has('--confirm');

// 默认：1× 麦辣鸡腿堡 + 1× 中薯条（换成你要的商品码即可）
const ITEMS = (get('--items', '5106:1')).split(',').map(s => {
  const [code, qty] = s.split(':');
  return { productCode: code.trim(), quantity: Number(qty || 1) };
});

// MCP 把响应包成「字段说明 + API Response」文本，真正的 JSON 在 ```json 代码块里
function extractJson(text) {
  const blk = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = blk ? blk[1] : text;
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

async function call(name, args) {
  const r = await fetch('https://mcp.mcd.cn', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const txt = await r.text();
  const m = txt.match(/\{[\s\S]*\}\s*$/);
  let j;
  try { j = JSON.parse(m ? m[0] : txt); } catch { return { raw: txt.slice(0, 800) }; }
  const c = j.result && j.result.content && j.result.content[0];
  const text = (c && c.text) || '';
  const parsed = extractJson(text);
  if (parsed) return parsed.data || parsed;
  return { text: text.slice(0, 1200), isError: !!(j.result && j.result.isError) };
}

(async () => {
  console.log('门店 storeCode:', STORE, '| 商品:', JSON.stringify(ITEMS));
  console.log('模式:', CONFIRM ? '⚠️ 真实下单' : 'DRY-RUN（只核价）');
  console.log();

  const price = await call('calculate-price', {
    storeCode: STORE, orderType: 1, beType: 1, items: ITEMS,
  });
  const d = price.data || price;
  console.log('--- calculate-price ---');
  console.log('应付(元):', d.payAmount != null ? d.payAmount : JSON.stringify(d).slice(0, 300));
  const ways = d.takeWayList || [];
  console.log('可取餐方式 takeWayList:', JSON.stringify(ways));
  const takeWayCode = ways[0] && (ways[0].code || ways[0].takeWayCode) || 'take-in-store';
  console.log('→ 使用 takeWayCode:', takeWayCode);

  if (!CONFIRM) {
    console.log();
    console.log('未加 --confirm，到此为止（没有下单）。');
    console.log('确认无误后执行：node tools/order.js --confirm');
    return;
  }

  console.log();
  console.log('--- create-order（真实订单）---');
  const order = await call('create-order', {
    storeCode: STORE, orderType: 1, beType: 1,
    items: ITEMS, takeWayCode,
    remark: get('--remark', '开饭参谋测试单'),
  });
  console.log(JSON.stringify(order, null, 1).slice(0, 1500));
})();
