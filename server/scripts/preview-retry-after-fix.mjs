/**
 * preview-retry-after-fix.mjs — 生成「修复前 / 修复后」重练卷渲染对比（只读，不写库）
 *
 * 用真实错题数据，按 wrongRetryPdfService.buildPaperBody 同一套口径
 * （resolveQuestionDisplayStem + getQuestionGroupKey 连排）渲染成 HTML，
 * 供人工确认「重练卷上的题是否已可作答」。不创建 generated_exams、不产生 PDF。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import pg from 'pg'
import { resolveQuestionDisplayStem, getQuestionGroupKey } from '../utils/questionStem.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 取带小问标号的错题（这批就是用户看到的「半截题」），含已修与未修
const { rows } = await pool.query(`
  SELECT wq.id, wq.student_id, s.name AS student_name,
         q.question_number AS qno, q.sub_no, q.parent_stem, q.task_id, q.page_number,
         q.question_type, q.options,
         btrim(coalesce(q.content, wq.content, '')) AS content
  FROM wrong_questions wq
  JOIN students s ON s.id = wq.student_id
  LEFT JOIN questions q ON q.id = wq.question_id
  WHERE btrim(coalesce(q.content, wq.content, '')) ~ '^[（(]\\s*[0-9１-９一二三四五六七八九]{1,2}\\s*[)）]'
  ORDER BY q.task_id, q.page_number, q.question_number, q.sub_no
`)

const student = rows[0]?.student_name || '（示例）'
const fixed = rows.filter(r => r.parent_stem)
const pending = rows.filter(r => !r.parent_stem)

const renderBlock = (items, { showStem }) => {
  let html = '', num = 0, lastKey = ''
  for (const q of items) {
    const { parentStem, content } = resolveQuestionDisplayStem(q)
    const groupKey = getQuestionGroupKey(q)
    const subNo = q.sub_no == null ? '' : String(q.sub_no).trim()
    const isCont = !!groupKey && groupKey === lastKey && !!subNo
    if (!isCont) num++
    lastKey = groupKey
    const label = subNo ? `${num}(${subNo})` : String(num)
    html += `<div class="q">`
    // showStem=false 模拟修复前：渲染层拿不到 parent_stem（列不存在/为 NULL）
    if (showStem && parentStem && !isCont) html += `<div class="stem">${esc(parentStem)}</div>`
    html += `<div class="head"><span class="no">${label}.</span><span>${esc(content)}</span></div>`
    if (q.question_type === 'answer') html += `<div class="ans"></div>`
    html += `</div>`
  }
  return html
}

const page = (title, body, cls) => `
<div class="page ${cls}"><div class="ptitle">${title}</div>${body}</div>`

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>重练卷渲染对比（修复前 / 修复后）</title>
<style>
body{font-family:'Microsoft YaHei','PingFang SC',sans-serif;background:#f5f6fa;margin:0;padding:24px;color:#1a1a1a}
h1{font-size:18px;margin:0 0 4px}
.sub{font-size:13px;color:#666;margin-bottom:18px}
.wrap{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.page{background:#fff;width:520px;padding:20px 22px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.page.bad{border-top:4px solid #e5484d}
.page.good{border-top:4px solid #30a46c}
.ptitle{font-size:14px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e6eb}
.q{margin-bottom:12px}
.stem{font-size:12.5px;line-height:1.7;color:#333;margin:0 0 2px 30px;padding-left:8px;border-left:3px solid #c9cbd2}
.head{display:flex;gap:6px;font-size:13px;line-height:1.7}
.no{font-weight:700;min-width:26px}
.ans{border-bottom:1px solid #e5e6eb;height:22px;margin:4px 0 0 30px}
.note{font-size:12px;color:#666;margin-top:14px;line-height:1.7}
code{background:#eef0f5;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>重练卷渲染对比 · ${esc(student)}</h1>
<div class="sub">用该学生真实错题按重练卷同一口径渲染：左＝修复前（无公共条件）／右＝修复后（连排题组 + 公共条件）</div>
<div class="wrap">
  ${page('修复前：题干只有「(1)(2)…」一小问，学生无法作答', renderBlock(rows, { showStem: false }), 'bad')}
  ${page('修复后：补回公共条件，同大题小问连排成题组块', renderBlock(rows, { showStem: true }), 'good')}
</div>
<div class="note">
共 ${rows.length} 行小问错题：<b>已补回公共条件 ${fixed.length} 行</b>，待补 ${pending.length} 行。
待补的行在左侧与右侧表现一致（仍缺条件）——这些是自动识别未能可靠取到公共题干的题，
需要人工确认原卷后补录，或后续重跑回填。<br>
渲染口径：<code>parent_stem</code>（弱化样式，左侧竖线）＋ <code>content</code>；
同 <code>(task_id, page_number, question_number)</code> 的连续小问只渲染一次公共题干，编号写成 <code>10(1). / 10(2).</code>。
</div>
</body></html>`

const out = 'D:/Minxue_App_V3/_retry_preview_after_fix.html'
fs.writeFileSync(out, html, 'utf8')
console.log(`已生成对比预览: ${out}`)
console.log(`学生 ${student}：小问错题 ${rows.length} 行，已补条件 ${fixed.length} 行，待补 ${pending.length} 行`)
console.log('\n已补条件的行：')
for (const r of fixed.slice(0, 12)) console.log(`  Q${r.qno}(${r.sub_no || '-'}) ← ${String(r.parent_stem).slice(0, 46)}`)
await pool.end()
