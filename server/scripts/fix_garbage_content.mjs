import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
import { Pool } from 'pg'
const p = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 题干垃圾判定：OCR 把印刷体题干识别成"× ×"、"÷ = × ×."这类无意义符号。
// - 无数字、无汉字、无字母 → 纯符号
// - 极短纯符号串（如 "= = ="、"x÷ = × x="）
function isGarbage(s) {
  if (s == null) return false
  const t = String(s).replace(/\s+/g, '')
  if (t.length === 0) return false
  const hasSubstance = /[0-9\u4e00-\u9fa5a-zA-Z]/.test(t)
  if (!hasSubstance) return true
  if (t.length <= 12 && /^[=×÷\-+×:.()，。、"'xX]{1,12}$/.test(t)) return true
  return false
}

// 稀疏题干判定（与 worker.js 保持一致）：OCR 只识别出指令词（"计算："、"解方程："）但丢失算式主体。
// 含汉字但无算式成分，对计算/解答题等同垃圾，也应修复。
function isSparse(s) {
  if (s == null) return false
  const t = String(s).replace(/\s+/g, '').replace(/[：:、]/g, '')
  if (t.length === 0) return false
  if (/^(计算|化简|解方程|求值|口算|算一算|直接写得数|脱式计算|简算|想一想|比一比|估一估|求下列各式的值|求未知数x)$/.test(t)) return true
  return false
}

const mode = process.argv[2] || 'scan' // scan | fix

// 扫描 questions 表（学生批改任务题目）+ resource_answers 表（答案库题干）
const q = await p.query(`
  SELECT q.id, q.task_id, q.page_number, q.question_number, q.question_type, q.content,
         t.original_name, t.task_type
  FROM questions q
  LEFT JOIN tasks t ON t.id = q.task_id
  WHERE q.deleted_at IS NULL AND q.content IS NOT NULL AND q.content <> ''
  ORDER BY q.created_at DESC
`)
const ra = await p.query(`
  SELECT ra.id, ra.resource_id, ra.question_no, ra.answer_type, ra.content, r.name AS resource_name
  FROM resource_answers ra
  LEFT JOIN resources r ON r.id = ra.resource_id
  WHERE ra.content IS NOT NULL AND ra.content <> ''
  ORDER BY ra.created_at DESC
`)

const qRows = q.rows.filter(r => isGarbage(r.content) || isSparse(r.content))
const raRows = ra.rows.filter(r => isGarbage(r.content) || isSparse(r.content))

console.log(`\n═══ 题干垃圾/稀疏内容扫描结果 ═══`)
console.log(`questions 表扫描 ${q.rows.length} 条，命中垃圾/稀疏题干 ${qRows.length} 条`)
console.log(`resource_answers 表扫描 ${ra.rows.length} 条，命中垃圾/稀疏题干 ${raRows.length} 条`)

const byTask = new Map()
for (const r of qRows) {
  const key = `${r.task_type || '?'} | ${r.original_name || '任务' + (r.task_id || '')}`.slice(0, 60)
  if (!byTask.has(key)) byTask.set(key, [])
  byTask.get(key).push(r)
}
console.log(`\n按任务聚合（questions 表垃圾/稀疏题干）:`)
for (const [k, list] of byTask) {
  console.log(`  ${k} (${list.length} 条)`)
  for (const r of list.slice(0, 5)) {
    console.log(`    p${r.page_number || '?'} Q${r.question_number || '?'} [${r.question_type}] "${String(r.content).slice(0, 40)}"`)
  }
  if (list.length > 5) console.log(`    ... 共 ${list.length} 条`)
}

console.log(`\nresource_answers 表垃圾/稀疏题干:`)
for (const r of raRows.slice(0, 30)) {
  console.log(`  resource="${r.resource_name || r.resource_id}" no=${r.question_no} [${r.answer_type}] "${String(r.content).slice(0, 40)}"`)
}
if (raRows.length > 30) console.log(`  ... 共 ${raRows.length} 条`)

if (mode === 'fix') {
  // 修复策略：
  // 1. questions.content 垃圾/稀疏 → 重置为占位符并标记 answer_exception
  // 2. resource_answers.content 垃圾/稀疏 → 置空（题干缺失），前端显示占位
  console.log('\n开始修复...')
  let fixedQ = 0
  for (const r of qRows) {
    if (r.content && (isGarbage(r.content) || isSparse(r.content))) {
      await p.query(
        `UPDATE questions SET content = $1, answer_exception = TRUE, answer_exception_reason = '题干OCR识别异常，需人工修订', updated_at = NOW() WHERE id = $2`,
        [`第 ${r.question_number || ''} 题`, r.id]
      )
      fixedQ++
    }
  }
  let fixedRA = 0
  for (const r of raRows) {
    await p.query(
      `UPDATE resource_answers SET content = NULL, updated_at = NOW() WHERE id = $1`,
      [r.id]
    )
    fixedRA++
  }
  console.log(`✅ questions 修复 ${fixedQ} 条，resource_answers 修复 ${fixedRA} 条`)
} else {
  console.log('\n[提示] 使用 `node fix_garbage_content.mjs fix` 执行修复')
}

await p.end()
