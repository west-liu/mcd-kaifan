// 把 docs/USAGE.md 渲染成自包含网页 usage.html（GitHub Pages 可直接访问）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(root, 'docs/USAGE.md'), 'utf8');

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function render(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];

    // 代码块
    if (/^```/.test(ln)) {
      const lang = ln.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${buf.map(x => x.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n')}</code></pre>`);
      continue;
    }

    // 表格
    if (/^\|/.test(ln) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const head = ln.split('|').slice(1, -1).map(s => s.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim()));
        i++;
      }
      out.push('<div class="tw"><table><thead><tr>' +
        head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    // 标题
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      const txt = inline(h[2]);
      const id = 's' + out.length;
      out.push(`<h${lv} id="${id}">${txt}</h${lv}>`);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 分隔线
    if (/^---+$/.test(ln)) { i++; continue; }

    // 列表
    if (/^[-*]\s+/.test(ln) || /^\d+\.\s+/.test(ln)) {
      const ordered = /^\d+\./.test(ln);
      const buf = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i]))) {
        buf.push(lines[i].replace(/^([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + buf.map(x => `<li>${inline(x)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // 空行
    if (!ln.trim()) { i++; continue; }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|\d+\.\s|>\s?|\||```|---+$)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const body = render(md);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开饭参谋 · 使用说明</title>
<style>
:root{--bg:#0E0B08;--card:#171310;--line:rgba(255,255,255,.10);--txt:#EDE6D8;--dim:#A99C86;--gold:#FFC72C;--red:#DA291C;--mint:#7FD8AE;}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:15px/1.85 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  background-image:radial-gradient(900px 500px at 8% -6%,rgba(255,199,44,.13),transparent 60%),radial-gradient(800px 500px at 100% 8%,rgba(218,41,28,.14),transparent 60%);
  background-attachment:fixed;padding:0 18px 90px}
.wrap{max-width:760px;margin:0 auto}
header{padding:52px 0 26px;border-bottom:1px solid var(--line);margin-bottom:34px}
.kicker{font:11.5px/1 ui-monospace,monospace;letter-spacing:.22em;color:var(--gold);margin-bottom:14px}
header h1{font-size:34px;letter-spacing:.04em;font-weight:800}
header h1 span{color:var(--gold)}
.acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.acts a{display:inline-block;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:13.5px;font-weight:700;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--txt)}
.acts a.p{background:var(--red);border-color:var(--red);color:#fff}
.acts a.g{background:var(--gold);border-color:var(--gold);color:#231a08}
h1{font-size:27px;margin:42px 0 16px;letter-spacing:.02em}
h2{font-size:22px;margin:40px 0 14px;padding-left:12px;border-left:4px solid var(--gold);letter-spacing:.02em}
h3{font-size:17px;margin:28px 0 10px;color:var(--gold)}
h4{font-size:15px;margin:22px 0 8px;color:var(--dim)}
p{margin:12px 0;color:#E3DACB}
strong{color:#fff}
ul,ol{margin:12px 0 12px 22px;color:#E3DACB}
li{margin:6px 0}
blockquote{margin:18px 0;padding:14px 18px;border-left:3px solid var(--red);background:rgba(255,255,255,.04);border-radius:0 10px 10px 0;color:#D9CFBE;font-size:14.5px}
code{font:13px ui-monospace,Menlo,monospace;background:rgba(255,255,255,.08);padding:2px 6px;border-radius:5px;color:var(--mint)}
pre{background:#0A0806;border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto;margin:16px 0}
pre code{background:none;padding:0;color:#9FE3C2;font-size:12.5px;line-height:1.75}
.tw{overflow-x:auto;margin:18px 0;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}
th{background:rgba(255,199,44,.10);color:var(--gold);text-align:left;padding:11px 13px;font-weight:700;white-space:nowrap}
td{padding:11px 13px;border-top:1px solid var(--line);color:#E3DACB;vertical-align:top}
a{color:var(--mint)}
footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);color:var(--dim);font-size:13px}
@media(max-width:600px){header h1{font-size:26px}h1{font-size:22px}h2{font-size:19px}body{padding:0 14px 60px}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="kicker">WAYTOAGI 1024 · 用餐赛道 · 麦当劳 MCP</div>
  <h1>开饭<span>参谋</span> · 使用说明</h1>
  <div class="acts">
    <a class="p" href="https://west-liu.github.io/mcd-kaifan/" target="_blank">▶ 立即体验作品</a>
    <a class="g" href="https://west-liu.github.io/mcd-kaifan/demo.html" target="_blank">自动演示（14 步）</a>
    <a href="https://github.com/west-liu/mcd-kaifan" target="_blank">源码仓库</a>
  </div>
</header>
<main>
${body}
</main>
<footer>
  开饭参谋 · 麦当劳 MCP × WorkBuddy · 数据来自麦当劳官方接口（query-meals / list-nutrition-foods / calculate-price）
</footer>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(root, 'usage.html'), html);
fs.writeFileSync(path.join(root, 'dist', '使用说明.html'), html);
console.log('usage.html', (html.length / 1024).toFixed(1) + 'KB');
