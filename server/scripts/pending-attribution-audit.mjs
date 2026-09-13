/**
 * 复核减负 · 无答案题归因审计（只读，不改任何数据）
 *
 * 目的：观察"练习册作业 pending（无参考答案）"的归因分布，为复核减负提供数据。
 *   - 归因A「锚定失败」：册内明明有该题号的官方答案行，但题目没匹配上
 *     （典型：页眉跑马灯 → 单元锚定失败；2026-09-13 已加"结构指纹兜底"根治，
 *       该桶若持续增长说明有新的锚定盲区，需要具体分析）
 *   - 归因B「册内缺数据」：整本册都没有该题号的官方答案行
 *     （典型：答案 PDF 解析在单元跨页边界丢题，如 27.4(2) 的 Q10；
 *       需要对照答案 PDF 补录）
 *
 * 判定口径（与 worker 匹配逻辑一致）：
 *   - questions.answer_source='recognized' 视为"无参考答案待人工"
 *   - 底表 resource_answers.answer_status='official_verified' 即 worksheet_answers 视图可见行
 *   - 题号匹配：question_no 相等 且 (sub_no='' 整题行 或 sub_no=题目小问)
 *
 * 用法: node server/scripts/pending-attribution-audit.mjs [--days=7] [--limit=200]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'

const days = parseInt((process.argv.find(a => a.startsWith('--days=')) || '').slice(7)) || 7
const limit = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').slice(8)) || 200
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await pool.query(s, p)).rows

console.log(`\n===== 练习册无答案题归因审计（最近 ${days} 天，只读） =====\n`)

// 1) 总览：最近 N 天 workbook 任务的题目状态
const overview = await q(`
  SELECT t.id, t.original_name, t.created_at::date AS day,
         COUNT(q.id)::int AS total,
         COUNT(*) FILTER (WHERE q.answer_source = 'worksheet')::int AS 已判,
         COUNT(*) FILTER (WHERE q.answer_source = 'blank')::int AS 未作答,
         COUNT(*) FILTER (WHERE q.answer_source = 'recognized')::int AS 无答案
  FROM tasks t JOIN questions q ON q.task_id = t.id
  WHERE t.task_type = 'workbook' AND t.worksheet_id IS NOT NULL
    AND t.created_at > now() - ($1 || ' days')::interval
  GROUP BY t.id, t.original_name, t.created_at::date
  ORDER BY t.created_at DESC`, [String(days)])

let anchorFail = 0, dataGap = 0
const gapDetails = []

for (const t of overview.filter(x => x.无答案 > 0).slice(0, limit)) {
  // 该题所属册
  const ws = await q(`SELECT worksheet_id FROM tasks WHERE id = $1`, [t.id])
  const rid = ws[0]?.worksheet_id
  if (!rid) continue
  // 无答案题逐道归因
  const qs = await q(`
    SELECT question_number, sub_no FROM questions
    WHERE task_id = $1 AND answer_source = 'recognized' AND question_number IS NOT NULL`, [t.id])
  for (const x of qs) {
    const hit = await q(`
      SELECT 1 FROM resource_answers
      WHERE answer_status = 'official_verified' AND resource_id = $2
        AND question_no = $1 AND (sub_no = '' OR sub_no = $3) LIMIT 1`,
      [x.question_number, rid, String(x.sub_no || '')])
    if (hit.length) anchorFail++
    else { dataGap++; gapDetails.push({ task: t.id.slice(0, 8), name: t.original_name, q: x.question_number, sub: x.sub_no }) }
  }
}

console.table(overview.map(x => ({
  日期: x.day, 任务: x.id.slice(0, 8), 名称: String(x.original_name).slice(0, 14),
  总题: x.total, 已判: x.已判, 未作答: x.未作答, 无答案: x.无答案
})))

console.log(`\n===== 归因分布（无答案共 ${anchorFail + dataGap} 道） =====`)
console.log(`  归因A 锚定失败（册内有答案但没匹配上）: ${anchorFail} 道`)
console.log(`  归因B 册内缺数据（需对照答案PDF补录）: ${dataGap} 道`)
if (gapDetails.length) {
  console.log('\n归因B 明细:')
  for (const g of gapDetails) console.log(`  任务${g.task}(${String(g.name).slice(0, 12)}) Q${g.q}${g.sub ? '.' + g.sub : ''}`)
}
const needReview = overview.reduce((a, b) => a + b.无答案, 0)
const totalQ = overview.reduce((a, b) => a + b.total, 0)
console.log(`\n汇总: workbook 任务 ${overview.length} 个 / 题目 ${totalQ} 道 / 无答案待人工 ${needReview} 道` +
  (totalQ ? `（占比 ${(needReview / totalQ * 100).toFixed(1)}%）` : ''))

await pool.end()
