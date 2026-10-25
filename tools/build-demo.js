// 生成「自动演示」页面：打开后自动跑完整流程，底部字幕解说。
// 源：dist/开饭参谋.html（单文件成品）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const src = fs.readFileSync(path.join(DIST, '开饭参谋.html'), 'utf8');

const AUTO = `
<style>
#__cap{
  position:fixed; left:0; right:0; bottom:0; z-index:99999;
  background:rgba(18,12,8,.94); color:#fff; padding:14px 22px;
  font:600 17px/1.5 -apple-system,"Microsoft YaHei",sans-serif;
  border-top:3px solid #FFC72C; display:flex; gap:14px; align-items:baseline;
  transform:translateY(110%); transition:transform .35s ease;
}
#__cap.on{ transform:translateY(0); }
#__cap b{ color:#FFC72C; font-size:15px; }
.__hi{ outline:3px solid #FFC72C !important; outline-offset:3px; border-radius:8px;
  box-shadow:0 0 0 6px rgba(255,199,44,.25) !important; }
#__badge{ position:fixed; top:16px; right:16px; z-index:99999;
  background:#DA291C; color:#fff; padding:6px 14px; border-radius:999px;
  font:700 13px/1 -apple-system,"Microsoft YaHei",sans-serif; }
</style>
<div id="__cap"><b id="__step">01</b><span id="__txt"></span></div>
<div id="__badge">自动演示中 · 无需操作</div>
<script>
(function(){
  var cap=document.getElementById('__cap'), step=document.getElementById('__step'),
      txt=document.getElementById('__txt'), hi=null;
  function say(n,s){ step.textContent=('0'+n).slice(-2); txt.textContent=s; cap.classList.add('on'); }
  function mark(el){ if(hi) hi.classList.remove('__hi'); if(el){ hi=el; el.classList.add('__hi'); } }
  function at(ms,fn){ setTimeout(fn,ms); }

  at(400, function(){
    say(1,'四个人吃麦当劳，一个减脂、一个不吃牛肉，预算 150。');
    mark(document.getElementById('hc'));
  });
  at(2400, function(){
    say(2,'先报人数：加到 4 位。');
    var p=document.getElementById('plus'); mark(p); p.click();
  });
  at(4200, function(){
    say(3,'再报预算：选 ¥150。');
    var c=[].slice.call(document.getElementById('budgetChips').children).filter(function(x){return x.dataset.v==='150';})[0];
    if(c){ mark(c); c.click(); } else { setBudget(150); }
  });
  at(6000, function(){
    say(4,'第 1 位在减脂，勾上「减脂」。');
    var t=document.querySelector('.person[data-i="0"] .tag[data-p="diet"]');
    if(t){ mark(t); t.click(); }
  });
  at(7800, function(){
    say(5,'第 2 位不吃牛肉——这会让全桌都避开牛肉。');
    var t=document.querySelector('.person[data-i="1"] .tag[data-p="nobeef"]');
    if(t){ mark(t); t.click(); }
  });
  at(9600, function(){
    say(6,'点「开饭」，读麦当劳真实菜单开始搭配。');
    mark(document.getElementById('go'));
  });
  at(11000, function(){
    mark(null);
    document.getElementById('go').click();
  });
  at(12800, function(){
    say(7,'三套方案：吃得均衡 / 最省钱 / 轻卡减脂。');
    document.getElementById('result').scrollIntoView({block:'start'});
  });
  at(15200, function(){
    say(8,'点一下餐品，能看这套里到底有什么——子项来自官方 query-meal-detail。');
    var el=document.querySelector('#cardBox .item');
    if(el){ mark(el); el.click(); }
  });
  at(18200, function(){
    say(9,'不顺眼就「换一个」，同类备选自适应，价格立刻重算。');
    var b=document.getElementById('dishSwap'); if(b){ mark(b); b.click(); }
  });
  at(20600, function(){
    say(10,'切到「最省钱」：同预算下更便宜的一套。');
    var t=document.querySelector('.tab[data-m="cheap"]'); if(t){ mark(t); t.click(); }
  });
  at(23200, function(){
    say(11,'再切「轻卡减脂」：只挑热量可核实的低卡主食。');
    var t=document.querySelector('.tab[data-m="light"]'); if(t){ mark(t); t.click(); }
  });
  at(25800, function(){
    var t=document.querySelector('.tab[data-m="balanced"]'); if(t){ t.click(); }
    say(12,'备注也能改——点一下，写成店员看得懂的话。');
    var n=document.querySelector('.note'); if(n){ mark(n); n.click(); }
  });
  at(28600, function(){
    document.getElementById('noteInput').value='饮品去冰；汉堡去酱';
    document.getElementById('blockInput').value='牛肉、辣味';
    var b=document.getElementById('saveNote'); if(b){ mark(b); b.click(); }
  });
  at(31200, function(){
    say(13,'改完直接复制清单，到店照着点。');
    mark(null); window.scrollBy({top:460,behavior:'smooth'});
  });
  at(34200, function(){
    say(14,'人数 · 预算 · 忌口 · 改单 · 备注 —— 把饭点安排明白。');
    mark(null);
  });
})();
<\/script>
`;

const out = src.replace('</body>', AUTO + '</body>');
const targets = ['DEMO-自动演示.html', 'demo.html'].map((n) => path.join(DIST, n));
targets.forEach((p) => fs.writeFileSync(p, out));
fs.writeFileSync(path.join(ROOT, 'demo.html'), out);
fs.writeFileSync(path.join(ROOT, 'index.html'), src);
console.log('演示页:', targets.map((p) => path.basename(p)).join(' / '), (out.length / 1024 | 0) + 'KB');
console.log('同步根目录 index.html / demo.html（GitHub Pages 用）');
