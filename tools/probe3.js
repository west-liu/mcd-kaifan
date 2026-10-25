// 打印工具的原始返回文本（不做 JSON 解析），用于摸清非标准格式
const { MCPClient } = require('../mcp');
const fs = require('fs'), path = require('path');
const TOKEN = process.env.MCD_TOKEN || fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('MCD_TOKEN=')).split('=')[1];
const STORE = process.env.STORE || '1400359';
const c = new MCPClient(TOKEN);

async function raw(tool, args, id) {
  await c.connect();
  const headers = {
    'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${TOKEN}`,
  };
  if (c.sid) headers['mcp-session-id'] = c.sid;
  const r = await fetch('https://mcp.mcd.cn', {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const text = await r.text();
  console.log('\n##### ' + tool + ' #####');
  console.log(text.slice(0, 3000));
}

(async () => {
  await raw('list-nutrition-foods', {}, 13);
  await raw('campaign-calendar', {}, 14);
  await raw('available-coupons', {}, 15);
})().catch(e => console.log('FATAL', e.message));
