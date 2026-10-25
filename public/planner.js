
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

// 搭配引擎：按「人数 / 预算 / 每个人的忌口」生成多套方案，并估算热量

const PREF_LABEL = {
  diet: '减脂', nobeef: '不吃牛肉', nospicy: '不吃辣',
  nofried: '不吃炸物', veggie: '素食', nosaucce: '不要酱', noice: '去冰',
};

// 牛肉/辣/炸物是「全桌硬约束」，减脂/素食是「个人诉求」
const AVOID_RULES = {
  nobeef: /牛|安格斯|巨无霸|吉士汉堡|培根/,
  nospicy: /辣|龙焰|韩式辣椒|椒盐|咖喱/,
  nofried: /炸|脆|鸡块|鸡翅|鸡排|薯|V翅|鸡柳|芝士条/,
};
const MEAT_RE = /鸡|翅|肉|鱼|虾|排|牛|猪|蟹|堡|鳕/;
const ZERO_SUGAR_RE = /无糖|纯悦|美式|鲜萃|锡兰|黑咖|浓缩/;
const CAT_500 = '500大卡套餐';
const HAS_DRINK_RE = /件套|套餐|随心配|分享餐|双人餐|多人餐/;

function blocked(item, set) {
  const text = `${item.name} ${item.cat || ''} ${(item.tags || []).join(' ')}`;
  for (const k of Object.keys(AVOID_RULES)) {
    if (set.has(k) && AVOID_RULES[k].test(text)) return k;
  }
  return null;
}

const unionOf = (prefs) => new Set(prefs.flat().filter((p) => AVOID_RULES[p]));

function kcalOf(item, table) {
  if (item && item.kcal != null) return item.kcal;   // 快照里预拆好的组合餐热量
  const n = matchNutrition(item.name, table);
  return n ? n.kcal : null;
}
// 排序用：热量未知的按一顿普通快餐估算，不能当成"很低"也不能当成"极高"
const kcalRank = (item, table) => {
  const k = kcalOf(item, table);
  return k == null ? 550 : k;
};
const LIGHT_CAP = 620;   // 单份主食的热量上限（轻卡模式）

function build({ headcount, budget, prefs, catalog, table, mode, banned }) {
  const per = budget / headcount;
  const avoid = unionOf(prefs);
  const skip = banned || new Set();
  const picked = [];
  const notes = [];
  let remaining = budget;

  const add = (kind, item, qty, why) => {
    const kcal = kcalOf(item, table);
    picked.push({
      kind, code: item.code, name: item.name, price: item.price,
      qty, why, cat: item.cat, kcal,
    });
    remaining = Math.round((remaining - item.price * qty) * 10) / 10;
  };

  const poolOf = (kind) => (catalog[kind] || [])
    .filter((x) => !blocked(x, avoid) && !skip.has(x.code));

  // —— 1) 主食位：2 人以上优先分享餐，人均更低（省钱模式最激进）——
  const covered = new Set();
  const eligible = [];
  for (let i = 0; i < headcount; i++) {
    const my = new Set(prefs[i] || []);
    if (!my.has('diet') && !my.has('veggie')) eligible.push(i);
  }

  const wantShare = mode === 'cheap' ? headcount >= 2 : (mode === 'balanced' ? headcount >= 2 : headcount >= 3);
  if (wantShare && eligible.length >= 2) {
    const pool = poolOf('share')
      .filter((x) => x.price / 2 <= per * (mode === 'cheap' ? 1.0 : 0.95))
      .sort((a, b) => (mode === 'cheap' ? a.price / 2 - b.price / 2 : b.price - a.price));
    while (eligible.length >= 2 && pool.length) {
      const s = pool.shift();
      const rest = headcount - covered.size - 2;
      if (s.price > remaining - rest * 12) continue;
      const save = s.originalPrice > s.price ? `，原价 ¥${s.originalPrice}` : '';
      add('share', s, 1, `2 人份组合${save}，人均 ¥${(s.price / 2).toFixed(1)}，比两份单点更省`);
      covered.add(eligible.shift());
      covered.add(eligible.shift());
      if (mode !== 'cheap') break; // 均衡/轻卡只放一份，保留个人选择空间
    }
  }

  // —— 2) 其余人各配主食 ——
  for (let i = 0; i < headcount; i++) {
    if (covered.has(i)) continue;
    const myPrefs = new Set(prefs[i] || []);
    const diet = myPrefs.has('diet') || mode === 'light';
    const veg = myPrefs.has('veggie');

    let pool = poolOf('main').filter((x) => !blocked(x, myPrefs));
    if (veg || !pool.length) {
      const alt = poolOf('side').filter((x) => !MEAT_RE.test(x.name));
      const pick = alt.filter((x) => x.price <= per * 0.6).pop() || alt[0];
      if (pick) { add('main', pick, 1, '素食：主食位换成非肉类小食'); continue; }
      notes.push('有人吃素，这家店可选素食有限');
      continue;
    }

    let cand;
    // 主食预算：给共享小食和饮品留出空间，套餐自带配餐的可以放宽
    const capOf = (x) => Math.min(per * (HAS_DRINK_RE.test(x.name) ? 0.9 : 0.7), remaining);

    if (diet || mode === 'light') {
      // 减脂：只认「有热量数据且够低」的主食；500 大卡专区优先
      const zone = pool.filter((x) => x.cat === CAT_500)
        .filter((x) => kcalRank(x, table) <= LIGHT_CAP);
      const low = pool
        .filter((x) => kcalOf(x, table) != null && kcalOf(x, table) <= LIGHT_CAP)
        .sort((a, b) => kcalOf(a, table) - kcalOf(b, table));
      // 合并去重（专区优先）
      const seen = new Set();
      const src = [];
      for (const x of [...zone, ...low]) {
        if (!seen.has(x.code)) { seen.add(x.code); src.push(x); }
      }
      if (!src.length) {
        if (mode === 'light') {
          // 轻卡模式：一个可靠的低卡主食都没有，这套方案不成立
          notes.push('这家店没有可核实的低卡主食，轻卡方案不成立');
          return finish(picked, headcount, budget, prefs, avoid, notes, mode, { lightOk: false });
        }
        // 均衡/省钱模式里有人要减脂：尽力挑热量最低的，但如实标注热量无法保证
        const fallback = pool.slice().sort((a, b) => kcalRank(a, table) - kcalRank(b, table));
        cand = fallback.filter((x) => x.price <= per)[0] || fallback[0];
        if (cand) notes.push('这家店没有可核实的低卡主食，减脂那位按热量相对最低的搭配');
      } else {
        const afford = src.filter((x) => x.price <= Math.min(remaining, per * 1.0));
        cand = afford[0] || src[0];
      }
    } else if (mode === 'cheap') {
      cand = pool.filter((x) => x.price <= per * 1.05).sort((a, b) => {
        // 套餐自带小食饮品，实际单价更划算，优先
        const sa = HAS_DRINK_RE.test(a.name) ? -3 : 0;
        const sb = HAS_DRINK_RE.test(b.name) ? -3 : 0;
        return (a.price + sa) - (b.price + sb);
      })[0];
    } else {
      // 均衡：预算内按价格降序轮转，让几个人拿到不同价位，不重复
      const inCap = pool.filter((x) => x.price <= capOf(x));
      const src = inCap.length ? inCap.slice().sort((a, b) => b.price - a.price) : [pool[0]];
      cand = src[Math.min(i, src.length - 1)];
    }
    if (!cand) cand = pool[0];
    if (!cand) { notes.push('菜单里没有符合忌口的主食'); continue; }
    if (cand.price > remaining) notes.push('预算偏紧，主食按最低价保留');

    const k = kcalOf(cand, table);
    const why = diet
      ? (k ? `约 ${k} 大卡，热量可控` : '来自低热量专区')
      : (HAS_DRINK_RE.test(cand.name) ? '主食+小食+饮品一套齐，单人最省事' : '单品主食，把预算留给共享小食');
    add('main', cand, 1, why);
  }

  // —— 3) 共享小食 ——
  const sideWanted = mode === 'cheap' ? (headcount >= 4 ? 1 : 1) : (budget >= 80 && headcount >= 3 ? 2 : 1);
  const sidePool = poolOf('side').filter((x) => mode !== 'light' || !/薯|炸|脆/.test(x.name));
  for (let i = 0; i < sideWanted; i++) {
    const cap = Math.min(remaining * 0.6, per * (mode === 'cheap' ? 0.8 : 1.1));
    const cand = sidePool.filter((x) => x.price <= cap).pop() || (mode === 'cheap' ? null : sidePool[0]);
    if (!cand || cand.price > remaining) break;
    add('side', cand, 1, `全桌共享 ¥${cand.price}，${mode === 'cheap' ? '控制在人均预算内' : '分摊下来很划算'}`);
    sidePool.splice(sidePool.indexOf(cand), 1);
  }

  // —— 4) 饮品：套餐已含的不重复点 ——
  const drinkCovered = picked.reduce(
    (n, p) => n + (HAS_DRINK_RE.test(p.name) ? p.qty * (p.kind === 'share' ? 2 : 1) : 0), 0,
  );
  let needDrink = Math.max(0, headcount - drinkCovered);
  if (needDrink > 0) {
    let drinkPool = poolOf('drink');
    if (mode === 'light' || prefs.some((p) => p.includes('diet'))) {
      const zero = drinkPool.filter((x) => ZERO_SUGAR_RE.test(x.name));
      if (zero.length) drinkPool = zero;
    }
    for (let i = 0; i < needDrink; i++) {
      const cand = drinkPool.filter((x) => x.price <= remaining).shift();
      if (!cand) { notes.push('饮品预算不够，可以自带或加 ¥10 补一杯'); break; }
      const k = kcalOf(cand, table);
      add('drink', cand, 1, k === 0 ? '0 卡饮品，不增加热量负担' : (k ? `约 ${k} 大卡，补齐每人一杯` : '补齐每人一杯'));
      drinkPool.splice(drinkPool.indexOf(cand), 1);
    }
  }

  // —— 5) 甜品：轻卡模式跳过 ——
  if (mode !== 'light' && headcount >= 2 && remaining >= 9) {
    const dPool = poolOf('dessert').filter((x) => x.price <= remaining - 4);
    const d = dPool.pop();
    if (d) add('dessert', d, 1, `还剩 ¥${remaining.toFixed(1)} 余量，加一份甜品收尾`);
  }

  return finish(picked, headcount, budget, prefs, avoid, notes, mode, { lightOk: true });
}

const MODE_NAME = { balanced: '吃得均衡', cheap: '最省钱', light: '轻卡减脂' };

// 汇总一套方案
function finish(picked, headcount, budget, prefs, avoid, notes, mode, extra) {
  const total = Math.round(picked.reduce((n, p) => n + p.price * p.qty, 0) * 10) / 10;
  const kcalList = picked.map((p) => (p.kcal == null ? null : p.kcal * p.qty));
  const kcalKnown = kcalList.filter((x) => x != null);
  const totalKcal = kcalKnown.length ? Math.round(kcalList.reduce((a, b) => (a || 0) + (b || 0), 0)) : null;
  const kcalFull = kcalKnown.length === kcalList.length;

  const noteParts = [];
  if (prefs.some((p) => p.includes('nosaucce'))) noteParts.push('汉堡/炸鸡去酱');
  if (prefs.some((p) => p.includes('noice'))) noteParts.push('饮品去冰');
  if (prefs.some((p) => p.includes('nospicy'))) noteParts.push('不要辣味酱');

  const blockedList = [];
  if (avoid.has('nobeef')) blockedList.push('牛肉');
  if (avoid.has('nospicy')) blockedList.push('辣味');
  if (avoid.has('nofried')) blockedList.push('炸物');
  if (prefs.some((p) => p.includes('veggie'))) blockedList.push('素食者本人不吃肉');

  return {
    mode, modeName: MODE_NAME[mode],
    items: picked,
    total,
    originalTotal: Math.round(picked.reduce((n, p) => n + (p.originalPrice || p.price) * p.qty, 0) * 10) / 10,
    perPerson: Math.round((total / headcount) * 10) / 10,
    leftover: Math.round((budget - total) * 10) / 10,
    usage: Math.round((total / budget) * 100),
    totalKcal, kcalFull,
    kcalPerPerson: totalKcal ? Math.round(totalKcal / headcount) : null,
    orderNote: noteParts.length ? noteParts.join('；') : '无特殊备注',
    blockedList, notes,
    lightOk: extra?.lightOk !== false,
  };
}

// 生成候选方案：超预算、假轻卡的直接淘汰
function planAll({ headcount, budget, prefs, catalog, table, banned }) {
  const modes = ['balanced', 'cheap', 'light'];
  const out = [];
  for (const mode of modes) {
    try {
      const p = build({ headcount, budget, prefs, catalog, table, mode, banned });
      if (!p.items.length) continue;
      // 硬约束 1：不能明显超预算
      if (p.total > budget * 1.03) continue;
      // 硬约束 2：轻卡方案人均热量必须真的低，且热量数据要可信
      if (mode === 'light') {
        if (!p.lightOk) continue;
        const kpp = p.totalKcal ? p.totalKcal / headcount : null;
        if (kpp != null && kpp > 800) continue;
        if (!p.items.some((i) => i.kcal != null)) continue;
      }
      out.push(p);
    } catch (e) {
      console.error('[planner] mode', mode, '失败:', e.message);
    }
  }
  // 全被淘汰时，至少给一套最便宜的，别让用户空手
  if (!out.length) {
    for (const mode of ['cheap', 'balanced']) {
      try {
        const p = build({ headcount, budget, prefs, catalog, table, mode, banned });
        if (p.items.length) { out.push(p); break; }
      } catch { /* ignore */ }
    }
  }
  return out;
}

global.Plan = { planAll, build, PREF_LABEL, matchNutrition };
})(window);
