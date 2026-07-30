// 一次性脚本：分析并去重 worksheet_answers 中的重复题号
// 用法: node scripts/dedupe_worksheet_answers.mjs [--apply]
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const { query } = await import('../config/neon.js')

const WORKSHEET_ID = '037eaa3a-d667-46d4-812a-a9dd2997edce'
const APPLY = process.argv.includes('--apply')

const { rows } = await query(
  `SELECT id, question_no, answer, answer_type, created_at FROM worksheet_answers
   WHERE worksheet_id = $1 ORDER BY question_no, created_at`,
  [WORKSHEET_ID]
)

const byNo = new Map()
for (const r of rows) {
  if (!byNo.has(r.question_no)) byNo.set(r.question_no, [])
  byNo.get(r.question_no).push(r)
}

let conflicts = 0
const toDelete = []
for (const [no, list] of byNo) {
  const uniq = [...new Set(list.map(r => r.answer))]
  if (uniq.length > 1) {
    conflicts++
    console.log(`Q${no} 冲突: ` + list.map(r => `${r.answer} (${new Date(r.created_at).toISOString().substring(0, 16)})`).join(' | '))
  }
  // 保留最新一条（created_at 最大），其余删除
  const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  for (const r of sorted.slice(1)) toDelete.push(r.id)
}

console.log('---')
console.log(`总行数: ${rows.length} | 唯一题号: ${byNo.size} | 冲突题号: ${conflicts} | 待删除: ${toDelete.length}`)

const batches = {}
for (const r of rows) {
  const k = new Date(r.created_at).toISOString().substring(0, 16)
  batches[k] = (batches[k] || 0) + 1
}
console.log('上传批次:', JSON.stringify(batches))

if (APPLY && toDelete.length > 0) {
  await query(`DELETE FROM worksheet_answers WHERE id = ANY($1::uuid[])`, [toDelete])
  await query(
    `UPDATE worksheets SET answer_count = (SELECT COUNT(*) FROM worksheet_answers WHERE worksheet_id = $1) WHERE id = $1`,
    [WORKSHEET_ID]
  )
  console.log(`✅ 已删除 ${toDelete.length} 条重复答案，并更新 answer_count`)
} else if (!APPLY) {
  console.log('（预览模式，加 --apply 执行删除）')
}
process.exit(0)
