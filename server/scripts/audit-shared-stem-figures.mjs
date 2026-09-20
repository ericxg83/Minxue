/**
 * audit-shared-stem-figures.mjs — 只读审计「公共题干引图、子题正文不引图、且无几何裁图」的题
 *
 * 背景（2026-09-17 周末班课件第12题）：
 *   多小问大题被拆行后，「如图」只留在 parent_stem，子题 content 只有「(1)…(2)…」。
 *   旧完整性口径只读 content → 这类题被判完整、进入错题本与课件，但实际没有配图。
 *
 * 本脚本只读，不写库、不下载、不上传。输出：
 *   1. 按 image_type 分组的状态分布（决定补裁脚本能否覆盖）
 *   2. 逐条明细（含 task_id / 学生 / 是否有可用页图 / is_complete 缓存值 / 动态口径复算值）
 *   3. 动态口径复算与缓存列的差异计数
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/audit-shared-stem-figures.mjs
 *   node scripts/audit-shared-stem-figures.mjs --limit 50
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'node:fs'
import pg from 'pg'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

const argOf = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 0)

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const rows = (await pool.query(`
  SELECT q.id, q.task_id, q.student_id, q.question_number, q.sub_no, q.page_number,
         q.content, COALESCE(q.parent_stem, '') AS parent_stem,
         q.geometry_image_url, q.clean_geometry_image_url, q.image_type, q.image_bbox,
         q.question_type, q.options, q.answer, q.is_complete, q.answer_source, q.created_at,
         s.name, s.grade, t.images AS task_images,
         (SELECT COUNT(*) FROM wrong_questions wq WHERE wq.question_id = q.id) AS wrong_book_rows
  FROM questions q
  JOIN students s ON s.id = q.student_id
  LEFT JOIN tasks t ON t.id = q.task_id
  WHERE q.deleted_at IS NULL
    AND q.geometry_image_url IS NULL
    AND q.content !~ '如图|图1|图示|附图|见图'
    AND COALESCE(q.parent_stem, '') ~ '如图|图1|图示|附图|见图'
  ORDER BY q.created_at DESC
  ${LIMIT ? `LIMIT ${LIMIT}` : ''}`)).rows

// ── 1. 状态分布 ──
const byImageType = new Map()
const byCache = { cacheTrueDynamicFalse: 0, cacheFalseDynamicFalse: 0, cacheTrueDynamicTrue: 0, cacheFalseDynamicTrue: 0 }
const withPageImage = []
const detail = []

for (const r of rows) {
  const itype = r.image_type === null ? '(NULL)' : String(r.image_type)
  byImageType.set(itype, (byImageType.get(itype) || 0) + 1)

  const dyn = checkQuestionCompleteness(r).isComplete
  if (r.is_complete === true && dyn === false) byCache.cacheTrueDynamicFalse++
  else if (r.is_complete === false && dyn === false) byCache.cacheFalseDynamicFalse++
  else if (r.is_complete === true && dyn === true) byCache.cacheTrueDynamicTrue++
  else byCache.cacheFalseDynamicTrue++

  let imgs = r.task_images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const pgNo = r.page_number || 1
  const pageUrl = (imgs || []).find(x => Number(x?.page_number) === pgNo)?.image_url || (imgs || [])[0]?.image_url || null
  if (pageUrl) withPageImage.push(r.id)

  detail.push({
    id: r.id,
    task: String(r.task_id).slice(0, 8),
    student: r.name,
    grade: r.grade,
    qno: r.question_number,
    sub_no: r.sub_no,
    page: r.page_number,
    image_type: itype,
    image_bbox: r.image_bbox,
    wrong_book_rows: Number(r.wrong_book_rows),
    is_complete_cache: r.is_complete,
    is_complete_dynamic: dyn,
    has_page_image: !!pageUrl,
    answer_source: r.answer_source,
    content: String(r.content || '').slice(0, 50),
    parent_stem: String(r.parent_stem || '').slice(0, 60),
  })
}

const out = []
out.push(`共 ${rows.length} 条：公共题干引图 + 子题正文不引图 + 无 geometry_image_url\n`)
out.push('── image_type 分布 ──')
for (const [k, v] of [...byImageType.entries()].sort((a, b) => b[1] - a[1])) out.push(`  ${k}: ${v}`)
out.push('\n── 缓存列 vs 动态口径 ──')
out.push(`  cache=TRUE  动态=FALSE（需要纠正）: ${byCache.cacheTrueDynamicFalse}`)
out.push(`  cache=FALSE 动态=FALSE           : ${byCache.cacheFalseDynamicFalse}`)
out.push(`  cache=TRUE  动态=TRUE            : ${byCache.cacheTrueDynamicTrue}`)
out.push(`  cache=FALSE 动态=TRUE            : ${byCache.cacheFalseDynamicTrue}`)
out.push(`\n有可用原页图（可补裁）: ${withPageImage.length}/${rows.length}`)
out.push(`其中已入错题本的行数合计: ${detail.reduce((s, d) => s + d.wrong_book_rows, 0)}`)
out.push('\n── 明细 ──')
out.push(JSON.stringify(detail, null, 1))

const outPath = 'D:/Minxue_App_V3/_audit_shared_stem_figures.txt'
fs.writeFileSync(outPath, out.join('\n'), 'utf8')
console.log(out.slice(0, out.indexOf('\n── 明细 ──')).join('\n'))
console.log(`\n明细已写入 ${outPath}`)

await pool.end()
