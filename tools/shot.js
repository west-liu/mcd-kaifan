// 生成 README 用截图：首页 / 结果页 / 套餐详情弹层 / 外送模式
const fs = require('fs');
const path = require('path');

const base = fs.readFileSync(path.join(__dirname, '../dist/开饭参谋.html'), 'utf8');

const setup = `
function tap(id){var e=document.getElementById(id); if(e) e.click();}
setTimeout(function(){ tap('plus'); },300);
setTimeout(function(){ var c=[].slice.call(document.getElementById('budgetChips').children).filter(function(x){return x.dataset.v==='150';})[0]; if(c) c.click(); },600);
setTimeout(function(){ tap('go'); },1100);
`;

const cases = {
  '_shot1.html': '',
  '_shot2.html': setup + `setTimeout(function(){ document.getElementById('result').scrollTop=60; },3000);`,
  '_shot3.html': setup + `setTimeout(function(){ var el=document.querySelector('#cardBox .item'); if(el) el.click(); },3000);`,
  '_shot4.html': `
setTimeout(function(){ tap('plus'); },300);
setTimeout(function(){ var c=[].slice.call(document.getElementById('budgetChips').children).filter(function(x){return x.dataset.v==='150';})[0]; if(c) c.click(); },600);
setTimeout(function(){ var ws=document.querySelectorAll('.way'); if(ws[1]) ws[1].click(); },900);
setTimeout(function(){ tap('go'); },1300);
setTimeout(function(){ document.getElementById('result').scrollTop=300; },3200);
`,
};

for (const [name, body] of Object.entries(cases)) {
  const inject = body ? `<script>${body}</script>` : '';
  fs.writeFileSync(path.join(__dirname, `../dist/${name}`), base.replace('</body>', inject + '</body>'));
}
console.log('生成:', Object.keys(cases).join(' '));
