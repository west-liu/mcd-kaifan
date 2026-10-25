// 本地验证 worker/bundle.js：用 Node 模拟 Worker 的 fetch handler 真调一次 MCP
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const token = (fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^MCD_TOKEN\s*=\s*(.*)$/m) || [])[1]?.trim();

(async () => {
  const tmp = path.join(os.tmpdir(), 'kaifan-worker-test.mjs');
  fs.writeFileSync(tmp, fs.readFileSync(path.join(root, 'worker', 'bundle.js'), 'utf8'));
  const mod = await import('file:///' + tmp.replace(/\\/g, '/'));
  const worker = mod.default;

  const env = {
    MCD_TOKEN: token, DEFAULT_CITY: '广州', DEFAULT_STORE: '1400359',
    DEFAULT_STORE_NAME: '麦当劳广州天源路餐厅', ENABLE_ORDER: '0', ALLOW_ORIGIN: '*',
  };
  const call = async (pathname, init = {}) => {
    const req = new Request('https://proxy.test' + pathname, init);
    const res = await worker.fetch(req, env);
    const body = await res.text();
    return { status: res.status, acao: res.headers.get('access-control-allow-origin'), body };
  };

  const show = (name, r) => {
    let j = r.body;
    try { j = JSON.stringify(JSON.parse(r.body), null, 0).slice(0, 500); } catch { /* keep raw */ }
    console.log(`\n### ${name}  [${r.status}] ACAO=${r.acao}`);
    console.log(j);
  };

  show('GET /api/health', await call('/api/health'));
  show('GET /api/store?city=广州', await call('/api/store?city=' + encodeURIComponent('广州')));

  const planRes = await call('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headcount: 3, budget: 90, prefs: [[], ['nobeef'], []], way: 'pickup', city: '广州' }),
  });
  const pj = JSON.parse(planRes.body);
  console.log('\n### POST /api/plan  [' + planRes.status + ']');
  if (pj.ok) {
    const p = pj.plan;
    console.log('门店:', p.storeName, '| 方式:', p.wayLabel, '| 营养表:', p.nutritionSize, '条');
    for (const x of p.plans) {
      console.log(`  ${x.modeName} ¥${x.total} (人均¥${x.perPerson}) pricedBy=${x.pricedBy} 热量=${x.totalKcal}`);
    }
    console.log('  摘要:', p.summary);
  } else {
    console.log('失败:', pj.error);
  }
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
