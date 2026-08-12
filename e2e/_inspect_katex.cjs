const fs = require('fs');
const path = require('path');
const h = fs.readFileSync('e2e/_ab_out/katex-body.html', 'utf-8');
console.log('total len:', h.length);

const katexRe = /<span class="katex">([\s\S]*?)<\/span><\/span><\/span>/g;
let m, cnt = 0;
const samples = [];
while ((m = katexRe.exec(h)) !== null) {
  if (m[1].includes('sqrt') && cnt < 3) {
    samples.push(m[0]);
    cnt++;
  }
}
samples.forEach((s, i) => {
  console.log('--- sqrt sample', i + 1, '---');
  console.log(s.slice(0, 2000));
  console.log();
});

const sqrtCount = (h.match(/class="mord sqrt"/g) || []).length;
const fracCount = (h.match(/class="mord frac"/g) || []).length;
const vlistCount = (h.match(/class="vlist/g) || []).length;
const katexCount = (h.match(/class="katex"/g) || []).length;
const strutCount = (h.match(/class="strut"/g) || []).length;
console.log('katex nodes:', katexCount, '| .mord sqrt:', sqrtCount, '| .mord frac:', fracCount, '| .vlist*:', vlistCount, '| .strut:', strutCount);
