// 探针脚本：列出麦当劳 MCP 全部工具、参数与输入 schema 摘要
// 用法: MCD_TOKEN=xxx node tools/probe.js [toolName]
const { MCPClient } = require('../mcp');
const TOKEN = process.env.MCD_TOKEN || require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('MCD_TOKEN=')).split('=')[1];

const c = new MCPClient(TOKEN);
const ENDPOINT = 'https://mcp.mcd.cn';

function pick(text) {
  try { return JSON.parse(text); } catch {}
  const msgs = text.split(/\r?\n/).filter(l => l.startsWith('data:'))
    .map(l => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);
  return msgs.find(m => m.result) || msgs[msgs.length - 1] || null;
}

(async () => {
  await c.connect();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${TOKEN}`,
  };
  if (c.sid) headers['mcp-session-id'] = c.sid;
  const r = await fetch(ENDPOINT, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
  });
  const j = pick(await r.text());
  const tools = j?.result?.tools || [];
  const only = process.argv[2];
  console.log('TOTAL TOOLS:', tools.length, '\n');
  for (const t of tools) {
    if (only && t.name !== only) continue;
    console.log('■ ' + t.name);
    console.log('  ' + (t.description || '').split('\n')[0].trim().slice(0, 100));
    const props = t.inputSchema?.properties || {};
    console.log('  args: ' + (Object.keys(props).join(', ') || '(none)')
      + (Object.keys(t.inputSchema?.required || {}).length ? ' | required: ' + (t.inputSchema.required || []).join(',') : ''));
    if (only) console.log(JSON.stringify(t.inputSchema, null, 2).slice(0, 3000));
    console.log('');
  }
})();
