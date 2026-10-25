// 麦当劳 MCP 客户端（Streamable HTTP + JSON-RPC，零依赖）
// - 握手 initialize / notifications/initialized
// - 优先读取 structuredContent，其次从文本里抠 JSON
// - callRaw 保留 Markdown 类返回（活动日历、券列表）原文
const ENDPOINT = 'https://mcp.mcd.cn';

function parseSSE(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (d) { try { out.push(JSON.parse(d)); } catch { /* ignore */ } }
    }
  }
  return out;
}

// MCP 返回的 content.text 里常混着"展示说明"和真实 JSON，这里把 JSON 抠出来
function extractJSON(text) {
  const start = text.indexOf('{"success"');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

class MCPClient {
  constructor(token) {
    this.token = token;
    this.sid = null;
    this.seq = 1;
  }

  async rpc(body) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${this.token}`,
    };
    if (this.sid) headers['mcp-session-id'] = this.sid;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let r;
    try {
      r = await fetch(ENDPOINT, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await r.text();
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.sid = sid;
    const ct = r.headers.get('content-type') || '';

    let json = null;
    if (ct.includes('text/event-stream')) {
      const msgs = parseSSE(text);
      json = msgs.find(m => m.id === body.id) || msgs[msgs.length - 1] || null;
    } else {
      try { json = JSON.parse(text); } catch { /* ignore */ }
    }
    return { status: r.status, json, raw: text };
  }

  async connect() {
    if (this.sid) return;
    const init = await this.rpc({
      jsonrpc: '2.0', id: this.seq++, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'kaifan-canmou', version: '2.0.0' },
      },
    });
    if (init.status !== 200) throw new Error('MCP 握手失败: ' + init.status + ' ' + init.raw.slice(0, 200));
    await this.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
  }

  // 底层调用，返回 { data, text, isError }
  async callRaw(tool, args = {}) {
    await this.connect();
    const res = await this.rpc({
      jsonrpc: '2.0', id: this.seq++, method: 'tools/call',
      params: { name: tool, arguments: args },
    });
    if (!res.json) throw new Error(`${tool} 无响应: ${res.status}`);
    if (res.json.error) throw new Error(`${tool} RPC错误: ${JSON.stringify(res.json.error)}`);
    const result = res.json.result || {};
    const text = (result.content || [])
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    // structuredContent 是官方给的结构化结果，优先使用
    const data = result.structuredContent || extractJSON(text) || null;
    return { data, text, isError: !!result.isError };
  }

  // 调用工具，返回解析后的业务数据（result.data）
  async call(tool, args = {}) {
    const { data, text } = await this.callRaw(tool, args);
    if (!data) throw new Error(`${tool} 无法解析返回`);
    if (data.success === false) throw new Error(`${tool} 业务失败: ${data.message || ''}`);
    return data;
  }

  async listTools() {
    await this.connect();
    const res = await this.rpc({
      jsonrpc: '2.0', id: this.seq++, method: 'tools/list', params: {},
    });
    return res.json?.result?.tools || [];
  }
}

module.exports = { MCPClient, extractJSON, ENDPOINT };
