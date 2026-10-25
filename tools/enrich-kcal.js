// 给快照里每一件餐品补上热量：先查营养表，套餐就拉官方详情把子项拆开累加
// 输出的 catalog 里每件餐品都带 kcal 字段，前端静态版就不用再猜了
const fs = require('fs');
const path = require('path');

(function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
})();

const { matchNutrition, getMealDetail } = require('../lib/mcd');

const SNAP = path.join(__dirname, '..', 'public', 'snapshot.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const table = new Map(snap.nutrition.map((n) => [n.name, n]));
  const storeCode = snap.store.storeCode;

  const items = [];
  for (const k of Object.keys(snap.catalog)) for (const it of snap.catalog[k]) items.push(it);

  console.log('待处理餐品:', items.length);
  let fromTable = 0, fromCombo = 0, unknown = 0, n = 0;

  for (const it of items) {
    n++;
    const direct = matchNutrition(it.name, table);
    if (direct) { it.kcal = direct.kcal; it.kcalSource = 'table'; fromTable++; continue; }
    try {
      const d = await getMealDetail(storeCode, it.code);
      if (d?.rounds?.length) {
        let sum = 0, known = 0;
        const parts = [];
        for (const r of d.rounds) {
          const def = (r.choices || []).find((c) => c.isDefault === 1) || (r.choices || [])[0];
          if (!def) continue;
          const m = matchNutrition(def.name, table);
          if (m) { sum += m.kcal * (r.quantity || 1); known++; parts.push(`${def.name} ${m.kcal}`); }
        }
        if (known) {
          it.kcal = Math.round(sum); it.kcalSource = 'combo'; it.kcalParts = parts;
          fromCombo++;
        } else { it.kcal = null; unknown++; }
      } else { it.kcal = null; unknown++; }
    } catch { it.kcal = null; unknown++; }
    if (n % 20 === 0) console.log(`  进度 ${n}/${items.length}`);
    await sleep(150);
  }

  fs.writeFileSync(SNAP, JSON.stringify(snap));
  console.log(`\n完成：营养表命中 ${fromTable} | 套餐拆解 ${fromCombo} | 未知 ${unknown}`);
  const covered = items.filter((i) => i.kcal != null).length;
  console.log(`热量覆盖 ${covered}/${items.length} (${Math.round(covered / items.length * 100)}%)`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
