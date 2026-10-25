// 把 lib/planner.js 直接打包成浏览器可用的 public/planner.js
// 目的：在线静态版和本地实时版共用同一套搭配算法，逻辑永远一致
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'planner.js'), 'utf8');

const shim = `
// 由 tools/build-web.js 从 lib/planner.js 自动生成，请勿手改
(function (global) {
const COMBO_SUFFIX = /(三件套|四件套|二件套|五件套|套餐|随心配|单人餐|分享餐|双人餐|多人餐|早餐|组合)$/;
function baseName(name) { return (name || '').replace(COMBO_SUFFIX, '').trim(); }
function matchNutrition(name, table) {
  if (!name || !table || !table.size) return null;
  if (table.has(name)) return table.get(name);
  const b = baseName(name);
  if (b && b !== name && table.has(b)) return table.get(b);
  let best = null, bestLen = 0;
  for (const key of table.keys()) {
    if (name.includes(key) || key.includes(name) || (b && (b.includes(key) || key.includes(b)))) {
      if (key.length > bestLen) { best = table.get(key); bestLen = key.length; }
    }
  }
  return best;
}
`;

const body = src
  .replace(/^const \{ matchNutrition \} = require\('\.\/mcd'\);\s*$/m, '')
  .replace(/^module\.exports = \{ planAll, build, PREF_LABEL \};\s*$/m, '')
  .trim();

const out = `${shim}\n${body}\n\nglobal.Plan = { planAll, build, PREF_LABEL, matchNutrition };\n})(window);\n`;

const dest = path.join(__dirname, '..', 'public', 'planner.js');
fs.writeFileSync(dest, out);
console.log('生成 public/planner.js', (out.length / 1024).toFixed(1), 'KB');
