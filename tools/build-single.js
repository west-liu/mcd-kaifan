// 打成单个自包含 HTML：planner.js 和 snapshot.json 全部内联，双击就能用、也能直接当网页文件提交
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

let html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const planner = fs.readFileSync(path.join(PUB, 'planner.js'), 'utf8');
const snap = fs.readFileSync(path.join(PUB, 'snapshot.json'), 'utf8');

// 1) 内联搭配算法
html = html.replace(
  '<script src="planner.js"></script>',
  `<script>\n${planner}\n</script>`
);

// 2) 内联数据快照，并让 snapshot() 优先读它
const dataTag = `<script>window.__SNAPSHOT__=${snap};</script>`;
// 3) 构建时可注入后端地址：KF_API=https://api.xxx.com npm run build
const api = (process.env.KF_API || '').replace(/\/+$/, '');
const apiTag = api ? `<script>window.__KF_API__=${JSON.stringify(api)};</script>\n` : '';
html = html.replace('<script>\nconst $ = id =>', `${apiTag}${dataTag}\n<script>\nconst $ = id =>`);

html = html.replace(
  `async function snapshot(){
  if (SNAP) return SNAP;
  const r = await fetch('snapshot.json');
  SNAP = await r.json();`,
  `async function snapshot(){
  if (SNAP) return SNAP;
  SNAP = window.__SNAPSHOT__ || await (await fetch('snapshot.json')).json();`
);

const out = path.join(DIST, '开饭参谋.html');
fs.writeFileSync(out, html);
console.log('单文件版:', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');

// 同时留一份 ASCII 文件名，方便各种服务器/上传场景
const out2 = path.join(DIST, 'index.html');
fs.writeFileSync(out2, html);
console.log('同步:', out2);
