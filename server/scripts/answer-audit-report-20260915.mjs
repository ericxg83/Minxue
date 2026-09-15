/**
 * 生成全库参考答案排查报告（2026-09-15）
 * 只读，输出 HTML 到项目根目录，供人工核验剩余存疑条目。
 */
import { config } from 'dotenv'
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
import pg from 'pg'
import { writeFileSync } from 'node:fs'
import { judgeAnswer } from '../services/judgeService.js'
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from '../utils/aiParseSelfCheck.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const q = async (sql, p) => (await pool.query(sql, p)).rows

const reviewed = await q(`
  SELECT id, question_type, is_correct, review_status, student_answer, answer, analysis, cache_id,
         btrim(content) AS content, updated_at
  FROM questions WHERE deleted_at IS NULL AND review_status='correct' AND is_correct=false
  ORDER BY updated_at DESC`)

const FIXED_CACHES = ['2615f321', '7258cfde', 'c2bba5dd', '83365918', '829fa8d9', 'd6478a30', '059523cb', '9dbda07e']
const isFixed = r => r.cache_id && FIXED_CACHES.some(p => String(r.cache_id).startsWith(p))

const A = [], B = [], C = []
for (const r of reviewed) {
  const redo = judgeAnswer(norm(r.student_answer), norm(r.answer), r.question_type || 'answer')
  if (redo.isCorrect === true) A.push(r)
  else if (isFixed(r)) B.push(r)
  else C.push(r)
}

const narrative = await q(`
  SELECT id, question_type, is_correct, review_status, student_answer, answer, cache_id, btrim(content) AS content
  FROM questions WHERE deleted_at IS NULL AND answer IS NOT NULL AND btrim(answer) <> ''`)
const narrativeBad = narrative.filter(r => isNarrativeAnswer(r.answer) && !isFixed(r))

const row = (r, extra = '') => `<tr>
  <td class="mono">${esc(r.id.slice(0, 8))}</td>
  <td>${esc(norm(r.student_answer).slice(0, 24)) || '<span class="mut">（空）</span>'}</td>
  <td class="ref">${esc(norm(r.answer).slice(0, 40))}</td>
  <td class="stem">${esc(norm(r.content).replace(/\s+/g, '').slice(0, 46))}</td>
  <td class="mut">${extra || esc(norm(extractFinalAnswerFromAnalysis(r.analysis)).slice(0, 20))}</td>
</tr>`

const table = (head, rows, note = '') => `
${note ? `<p class="note">${note}</p>` : ''}
<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows.join('')}</tbody></table>`

const P1 = [
  ['①', '√(a-1)+√(b-5)=0，求 (a-b)² 的平方根', '±2', '±4', '(1-5)²=16 ⇒ ±4；原解析正文即写「16的平方根是±4」'],
  ['②', '√81 的平方根', '9', '±3', '√81=9，9 的平方根=±3；缓存侧本就存 ±3'],
  ['③', '正数 a 的两个平方根是 3x+2y=2 的解', '1', '4', '-y=2 ⇒ y=-2、x=2 ⇒ a=x²=4'],
  ['④', '|x|=√6，y 是 4 的平方根，|y−x|=x−y，求 x+y', '2', '√6+2 或 √6-2', '枚举 x=√6 时 y=±2 均满足'],
  ['⑤', '172010 的平方根约为（保留一位小数）', '1.3115', '±414.7', '√172010≈414.741；原值是上一行 √1.7201'],
  ['⑥', 'm≥0，a-1 和 5-2a 都是 m 的平方根（小海题）', '…m=4', '…正确的 m 值为 1 或 9', '答案与自己的解析「m=1或9」直接矛盾'],
  ['⑦', '圆满组合数（-3、m、-12）', '…或 m = -27/16', '(1) 是；(2) m = -48', '-27/16 非负整数，不可能满足题设'],
  ['⑧', '求各数的算术平方根（5 小问）', '模型思考残句', '7, 13/14, 19/16, √61/5, 3.5', '解析末句已给出完整结论'],
]

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>敏学 · 参考答案与判定标签全库排查报告（2026-09-15）</title>
<style>
  :root{--fg:#2c2c2a;--mut:#5f5e5a;--bd:#d3d1c7;--bg:#fff;--soft:#f7f6f2;
        --red:#a32d2d;--redbg:#fcebeb;--grn:#3b6d11;--grnbg:#eaf3de;--amb:#854f0b;--ambbg:#faeeda;}
  *{box-sizing:border-box}
  body{margin:0;padding:32px 24px 64px;background:var(--bg);color:var(--fg);
       font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:22px;font-weight:600;margin:0 0 6px}
  h2{font-size:17px;font-weight:600;margin:36px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--bd)}
  h3{font-size:15px;font-weight:600;margin:20px 0 8px}
  .sub{color:var(--mut);font-size:13px;margin:0 0 24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
  .card{border:1px solid var(--bd);border-radius:8px;padding:14px 16px;background:var(--soft)}
  .card .n{font-size:26px;font-weight:600;line-height:1.2}
  .card .l{font-size:12.5px;color:var(--mut);margin-top:4px}
  .card.red .n{color:var(--red)} .card.grn .n{color:var(--grn)} .card.amb .n{color:var(--amb)}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}
  th{text-align:left;font-weight:600;background:var(--soft);padding:8px 10px;border:1px solid var(--bd);white-space:nowrap}
  td{padding:7px 10px;border:1px solid var(--bd);vertical-align:top}
  tr:nth-child(even) td{background:#fbfaf8}
  .mono{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--mut)}
  .mut{color:var(--mut);font-size:12.5px}
  .ref{color:var(--red)} .stem{max-width:280px}
  .note{color:var(--mut);font-size:13px;margin:8px 0 4px}
  .tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:12px;margin-right:4px}
  .tag.ok{background:var(--grnbg);color:var(--grn)} .tag.no{background:var(--redbg);color:var(--red)}
  .tag.w{background:var(--ambbg);color:var(--amb)}
  .callout{border-left:3px solid var(--amb);background:var(--ambbg);padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
  code{background:var(--soft);padding:1px 5px;border-radius:4px;font-size:13px;font-family:ui-monospace,Consolas,monospace}
</style></head><body><div class="wrap">

<h1>参考答案与判定标签 · 全库排查报告</h1>
<p class="sub">2026-09-15 · 起点是「学生答 ±4、参考答案 ±2，页面却写 AI正确」的一张截图</p>

<h2>一、结论摘要</h2>
<div class="cards">
  <div class="card red"><div class="n">81</div><div class="l">「老师改判对 / AI 判错」的题<br>页面文案全部署错名</div></div>
  <div class="card grn"><div class="n">8 组</div><div class="l">确认错误的参考答案<br>已修正 18 行 + 7 条缓存</div></div>
  <div class="card amb"><div class="n">${C.length}</div><div class="l">待人工核验的存疑题<br>建议逐条看题干</div></div>
  <div class="card"><div class="n">1092</div><div class="l">全库有参考答案的题<br>本次排查基数</div></div>
</div>

<div class="callout">
<b>原始问题不是 AI 判错，是文案署错了名。</b>那道题 AI 判的是「错」（<code>is_correct=false</code>），
是老师复核时改判为「做对了」（<code>review_status='correct'</code>），
而前端无论来源都写「AI正确」。真正的问题在参考答案本身：它写 <code>±2</code>，正解是 <code>±4</code>。
</div>

<h2>二、已修复</h2>
<h3>A · 展示层文案 <span class="tag ok">已改</span></h3>
<p class="note"><code>src/utils/reviewDecision.js</code> 的 <code>getReviewStateLabel</code> 给 correct 状态补了与 wrong 对称的细分。
移动端与 PC 端共用一份实现，<b>81 条</b>同时生效。</p>
<table><thead><tr><th>is_correct（AI）</th><th>review_status</th><th>旧文案</th><th>新文案</th></tr></thead><tbody>
<tr><td>false</td><td>correct</td><td>AI正确</td><td><b>已复核·人工判对</b></td></tr>
<tr><td>null</td><td>correct</td><td>AI正确</td><td><b>已复核·人工判对</b></td></tr>
<tr><td>true</td><td>correct</td><td>AI正确</td><td>AI正确（不变）</td></tr>
</tbody></table>

<h3>B · 参考答案 <span class="tag ok">已改</span></h3>
<p class="note">脚本 <code>server/scripts/backfill-answer-correction-20260915.mjs</code>，带备份表与 <code>--rollback</code>，幂等已验证。
每条都有数学推导级证据，不是风格化改写。</p>
<table><thead><tr><th>#</th><th>题干</th><th>原答案</th><th>修正为</th><th>证据</th></tr></thead><tbody>
${P1.map(r => `<tr><td>${r[0]}</td><td class="stem">${esc(r[1])}</td><td class="ref">${esc(r[2])}</td>
<td><b>${esc(r[3])}</b></td><td class="mut">${esc(r[4])}</td></tr>`).join('')}
</tbody></table>
<div class="callout">
<b>顺带掐断一个传染源。</b><code>|x|=√6 求 x+y</code> 这道题 9-14 那轮已改过 questions 侧，
但 <code>question_cache.answer</code> 漏改仍是 <code>2</code>（use_count=4），
导致之后新入库的实例又拿到错答案。本轮已补改，修后 23 行 questions 与缓存侧答案 100% 一致。
</div>

<h2>三、全库排查结果</h2>
<p class="note">老师的人工复核结论就是现成的标注集。<b>81 条</b>「老师判学生对、AI 判错」的题，
用当前判等函数重跑后分成三类。<b>分类用的是修正后的答案</b>，所以数字与本轮修复前后会不同
（修正前是 28 / 5 / 48）：改对答案后，原先「错答案恰好和学生对上、看着像判对」的题
会暴露成真正的判错 —— 这本身就是这轮修复要暴露的东西。</p>
<table><thead><tr><th>分类</th><th>数量</th><th>性质</th><th>处理</th></tr></thead><tbody>
<tr><td>甲 · 判等层历史遗留</td><td><b>${A.length}</b></td>
    <td>当前规则已能判对，只是入库的旧判定没回算（<code>-\\frac{1}{3}</code> vs <code>-1/3</code>、<code>1.2.3.4.6.12</code> vs <code>1、2、…</code>、<code>=</code> vs <code>“=”</code>）</td>
    <td><span class="tag ok">不动</span>页面已正确；回填 is_correct 会抹掉"老师改判过"的事实</td></tr>
<tr><td>乙-1 · 已核实并修正</td><td><b>${B.length}</b></td><td>有数学推导证据的参考答案错误</td><td><span class="tag ok">已修</span>见上表</td></tr>
<tr><td>乙-2 · 待人工核验</td><td><b>${C.length}</b></td><td>老师判学生对、AI 判错，但无自动证据</td><td><span class="tag w">待定</span>见第四节</td></tr>
</tbody></table>

<h3>不限已复核题的全库扫描</h3>
<table><thead><tr><th>判据</th><th>命中</th><th>其中 AI 判学生错</th><th>未复核</th></tr></thead><tbody>
<tr><td>参考答案是叙述型元话语（铁定坏）</td><td>10</td><td>5</td><td>1</td></tr>
<tr><td>± 符号与学生答案不匹配</td><td>23</td><td>13</td><td>8</td></tr>
<tr><td>参考答案 ≠ 解析文末（需核验，多数 answer 更准）</td><td>104</td><td>40</td><td>19</td></tr>
<tr><td>参考答案与学生答案雷同（污染残留，多数是学生答对）</td><td>372</td><td>6</td><td>0</td></tr>
</tbody></table>
<div class="callout">
<b>一个方法学提醒：宽口径 ≠ 真错。</b>「题干问平方根但答案不含 ±」这个判据命中 <b>48 条</b>，
逐条核验后<b>只有 5 组是真错</b>，其余是「若 m-4 没有平方根」「若 (1/3)x 有平方根，则 x 的条件」
这类只是<b>提到</b>平方根的题。所以这批数据只做了人工核验过的部分，没有按正则批量改。
</div>
${narrativeBad.length ? `<h3>其余叙述型坏答案（未修，待核验）</h3>
${table(['id', '学生答案', '参考答案', '题干', '解析文末'], narrativeBad.map(r => row(r)))}` : ''}

<h2>四、待人工核验清单</h2>
<p class="note">这 ${C.length} 条是<b>老师已判定学生做对、但 AI 判错</b>的题，且没有自动证据能证明答案错。
可能是参考答案错、可能是学生答案 OCR 丢字、也可能学生确实答错而老师网开一面。需要逐条看题干定夺。
表中最后一列是「解析文末抽出的答案」，与「参考答案」不一致的优先怀疑。</p>
${table(['id', '学生答案', '参考答案', '题干', '解析文末'], C.map(r => row(r)))}

<h2>五、顺带发现（未处理）</h2>
<table><thead><tr><th>发现</th><th>说明</th></tr></thead><tbody>
<tr><td><code>server/index.js:1103</code> 判据可疑</td>
    <td><code>isAnswerModified = teacherAnswer !== aiAnswer</code>。但 <code>worker.js:1196</code> 里
    <code>ai_answer</code> 存的是<b>学生答案的 OCR 原文</b>，拿它和参考答案比恒不相等 ⇒
    「留底为答案库」时永远走"答案被老师改过"分支。需单独确认。</td></tr>
<tr><td>题干疑似 OCR 错位</td>
    <td>「如果 1-2a 与 a-3 是一个正数的两个不相等的平方根，那么 a 的平方根是多少」
    —— 解得 a=-2，而 -2 的平方根无实数解，题干问法存疑（可能原题问"这个正数"）。</td></tr>
<tr><td>判等层对 ± 宽容</td>
    <td>答案是 <code>±414.7</code> 时，学生只写 <code>414.7</code> 会被判对。这是既有的数字集合兜底行为，
    修答案后会让个别未复核行由 false 翻成 true。不是本轮引入，仅供参考。</td></tr>
</tbody></table>

<h2>六、复现与回滚</h2>
<p class="note">所有排查均为只读探针；唯一的写操作是 B 部分的答案修正。</p>
<table><thead><tr><th>用途</th><th>命令 / 文件</th></tr></thead><tbody>
<tr><td>重跑修正（dry-run，应显示计划 0）</td><td><code>node server/scripts/backfill-answer-correction-20260915.mjs</code></td></tr>
<tr><td>回滚</td><td><code>node server/scripts/backfill-answer-correction-20260915.mjs --rollback</code></td></tr>
<tr><td>备份表</td><td><code>questions_bak_20260915_correction</code> / <code>question_cache_bak_20260915_correction</code></td></tr>
<tr><td>只读探针</td><td><code>server/_diag_ans_audit_full.mjs</code>、<code>_diag_ans_scan_all.mjs</code>、
    <code>_diag_sqrt_audit.mjs</code>、<code>_diag_ans_verify.mjs</code>、<code>_diag_pm4_verify_fix.mjs</code></td></tr>
<tr><td>测试 / 构建</td><td><code>npm test</code> → 377 项 376 过（唯一失败为既有 <code>retrySlimAnswerPrefill</code>）；<code>npm run build</code> ✓</td></tr>
</tbody></table>

</div></body></html>`

const out = new URL('../../_answer_audit_20260915.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
writeFileSync(out, html, 'utf8')
console.log('报告已生成：', out)
console.log(`  甲(历史遗留) ${A.length} / 乙-1(已修) ${B.length} / 乙-2(待核验) ${C.length} / 叙述型未修 ${narrativeBad.length}`)
await pool.end()
