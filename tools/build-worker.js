// 把 public/planner.js（浏览器版搭配引擎）内联进 Worker 源码，
// 产出一个可以直接粘贴到 Cloudflare Dashboard 的单文件 worker/bundle.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'worker', 'worker.src.js'), 'utf8');
const planner = fs.readFileSync(path.join(root, 'public', 'planner.js'), 'utf8');

if (!src.includes('/* __PLANNER__ */')) throw new Error('worker.src.js 缺少 /* __PLANNER__ */ 占位符');

const out = src.replace('/* __PLANNER__ */', planner.trim());
fs.writeFileSync(path.join(root, 'worker', 'bundle.js'), out, 'utf8');
console.log('worker/bundle.js 已生成:', Math.round(out.length / 1024) + 'KB');
