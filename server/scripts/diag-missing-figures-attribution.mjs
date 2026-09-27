/**
 * 缺图根因归因诊断（A 阶段 · 纯只读，不写库）
 *
 * 目的：用数据回答「图片不是系统自动裁的吗，为什么会漏」——把每道「引图但最终无配图」
 * 的题按 geometryCrop.js 的真实判据归到具体失败环节，据此决定 B（补召回通道）值不值得做、
 * 该做哪一类。
 *
 * 归因桶（对应 server/utils/geometryCrop.js 的裁剪前置判据链）：
 *   N1 无框        OCR 压根没返回配图框（image_bbox/geometry_image.bbox 皆空，image_type 空/none）
 *                  → 模型漏检，B 的「二次找框」正是治这个
 *   N2 退化框      有框，但 isDegenerateFigureBox 判为「从题目框机械推出的文字条」→ 主动不裁
 *   N3 框错位      有框，但 clampImageBboxToBlock 判为与题目完全对不上（超大框无交集）→ 主动不裁
 *   N4 可裁却空    有框且过两道闸，但 geometry_image_url 仍为空 → 运行时裁/传失败或该管线未接裁图
 *   N5 可继承      自身无框，但同页同公共题组的兄弟题有框（inheritSharedStemFigures 本应救回却没救）
 *
 * 口径：引图判据统一走 hasFigureReference（parent_stem + content），与完整性闸同源。
 * 只读：全程 SELECT，不 UPDATE、不调用任何写服务。
 */
import dotenv from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

const { query, TABLES } = await import('../config/neon.js')
const { hasFigureReference } = await import('../utils/questionCompleteness.js')
const { isDegenerateFigureBox, clampImageBboxToBlock } = await import('../utils/figureBoxTrust.js')

// 只看「影响学生/老师」的题：判错或未作答（会进错题本、会进周末课件）。
// 传 --all 则统计全部引图题（含判对题），用于对照。
const SCOPE_ALL = process.argv.includes('--all')

const parseJson = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

const { rows } = await query(
  `SELECT q.id, q.task_id, q.student_id, q.question_number, q.sub_no, q.page_number,
          q.content, q.parent_stem, q.image_bbox, q.image_type, q.geometry_image_url,
          q.clean_geometry_image_url, q.block_coordinates, q.is_correct, q.answer_source,
          t.task_type, t.original_name AS task_name
     FROM ${TABLES.QUESTIONS} q
     LEFT JOIN ${TABLES.TASKS} t ON t.id = q.task_id
    WHERE q.deleted_at IS NULL
      AND (t.id IS NULL OR t.deleted_at IS NULL)
      ${SCOPE_ALL ? '' : `AND (q.is_correct = FALSE OR q.answer_source = 'blank')`}
    ORDER BY q.task_id, q.page_number, q.created_at`
)

// 建「同页同公共题组」索引，判 N5（可继承却没继承）
const groupDonors = new Map() // key=task|page|parent_stem -> 有框兄弟数
for (const q of rows) {
  const stem = String(q.parent_stem || '').trim()
  if (!stem) continue
  const bbox = parseJson(q.image_bbox) || parseJson(q.geometry_image?.bbox)
  const itype = q.image_type
  const hasBox = bbox && itype && itype !== 'none'
  if (!hasBox) continue
  const key = `${q.task_id}|${q.page_number || 1}|${stem}`
  groupDonors.set(key, (groupDonors.get(key) || 0) + 1)
}

const buckets = { N1_no_box: [], N2_degenerate: [], N3_misplaced: [], N4_croppable_empty: [], N5_inheritable: [], HAS_FIGURE: 0 }
const byTaskType = {}
let figureRefs = 0

for (const q of rows) {
  if (!hasFigureReference(q)) continue // 只统计引图题
  figureRefs++
  const tt = q.task_type || 'unknown'
  byTaskType[tt] = byTaskType[tt] || { refs: 0, missing: 0, N1: 0, N2: 0, N3: 0, N4: 0, N5: 0 }
  byTaskType[tt].refs++

  const url = q.geometry_image_url && String(q.geometry_image_url).trim()
  const clean = q.clean_geometry_image_url && String(q.clean_geometry_image_url).trim()
  if (url || clean) { buckets.HAS_FIGURE++; continue } // 已有配图（含重绘产物），不算缺

  byTaskType[tt].missing++
  const bbox = parseJson(q.image_bbox)
  const legacy = parseJson(q.geometry_image?.bbox)
  const effBox = bbox || legacy
  const itype = q.image_type || (q.geometry_image?.has_image ? 'geometry' : null)
  const block = parseJson(q.block_coordinates)
  const rec = { id: q.id, task: q.task_name, no: q.question_number, sub: q.sub_no, page: q.page_number, type: tt, hasBox: !!effBox, itype }

  // 无有效框：区分「可继承」与「纯漏检」
  if (!effBox || !itype || itype === 'none') {
    const stem = String(q.parent_stem || '').trim()
    const key = `${q.task_id}|${q.page_number || 1}|${stem}`
    if (stem && groupDonors.get(key)) { buckets.N5_inheritable.push(rec); byTaskType[tt].N5++ }
    else { buckets.N1_no_box.push(rec); byTaskType[tt].N1++ }
    continue
  }
  // 有框：复现两道运行时闸
  if (isDegenerateFigureBox(effBox, block)) { buckets.N2_degenerate.push(rec); byTaskType[tt].N2++; continue }
  if (!clampImageBboxToBlock(effBox, block)) { buckets.N3_misplaced.push(rec); byTaskType[tt].N3++; continue }
  buckets.N4_croppable_empty.push(rec); byTaskType[tt].N4++
}

const totalMissing = buckets.N1_no_box.length + buckets.N2_degenerate.length + buckets.N3_misplaced.length + buckets.N4_croppable_empty.length + buckets.N5_inheritable.length
const pct = (n) => totalMissing ? `${(n / totalMissing * 100).toFixed(0)}%` : '0%'

const lines = []
lines.push(`# 缺图根因归因诊断（A 阶段）`)
lines.push(``)
lines.push(`口径：${SCOPE_ALL ? '全部引图题' : '仅判错/未作答的引图题（影响错题本与课件）'} · 引图判据 hasFigureReference(parent_stem+content)`)
lines.push(``)
lines.push(`- 引图题总数：${figureRefs}`)
lines.push(`- 已有配图（含重绘产物）：${buckets.HAS_FIGURE}`)
lines.push(`- **最终缺图：${totalMissing}**`)
lines.push(``)
lines.push(`## 归因分布`)
lines.push(`| 桶 | 含义 | 数量 | 占比 | B 可治? |`)
lines.push(`|---|---|---|---|---|`)
lines.push(`| N1 无框 | OCR 没返回配图框（纯漏检） | ${buckets.N1_no_box.length} | ${pct(buckets.N1_no_box.length)} | ✅ 二次找框主战场 |`)
lines.push(`| N2 退化框 | 有框但是机械推的文字条，主动不裁 | ${buckets.N2_degenerate.length} | ${pct(buckets.N2_degenerate.length)} | ⚠️ 需真定位到图，非放宽闸 |`)
lines.push(`| N3 框错位 | 有框但与题完全对不上，主动不裁 | ${buckets.N3_misplaced.length} | ${pct(buckets.N3_misplaced.length)} | ⚠️ 同 N2 |`)
lines.push(`| N4 可裁却空 | 过了闸却仍无图（运行时失败/管线未接） | ${buckets.N4_croppable_empty.length} | ${pct(buckets.N4_croppable_empty.length)} | ✅ 补裁即可，非模型问题 |`)
lines.push(`| N5 可继承 | 兄弟小问有框、本应继承却没继承 | ${buckets.N5_inheritable.length} | ${pct(buckets.N5_inheritable.length)} | ✅ 修继承逻辑，零模型成本 |`)
lines.push(``)
lines.push(`## 按批改管线分布`)
lines.push(`| task_type | 引图题 | 缺图 | N1 | N2 | N3 | N4 | N5 |`)
lines.push(`|---|---|---|---|---|---|---|---|`)
for (const [tt, s] of Object.entries(byTaskType).sort((a, b) => b[1].missing - a[1].missing)) {
  lines.push(`| ${tt} | ${s.refs} | ${s.missing} | ${s.N1} | ${s.N2} | ${s.N3} | ${s.N4} | ${s.N5} |`)
}
lines.push(``)
lines.push(`## 样本（每桶最多 15 条，供肉眼核对归因）`)
const dump = (name, arr) => {
  lines.push(`### ${name}（${arr.length}）`)
  for (const r of arr.slice(0, 15)) {
    lines.push(`- ${r.type} · ${r.task} · 第${r.no}${r.sub ? `(${r.sub})` : ''}题 p${r.page} · box=${r.hasBox ? '有' : '无'} itype=${r.itype || '-'} · ${r.id}`)
  }
  lines.push(``)
}
dump('N1 无框', buckets.N1_no_box)
dump('N2 退化框', buckets.N2_degenerate)
dump('N3 框错位', buckets.N3_misplaced)
dump('N4 可裁却空', buckets.N4_croppable_empty)
dump('N5 可继承', buckets.N5_inheritable)

const report = lines.join('\n')
const outPath = join(__dirname, '..', '..', `_缺图根因归因诊断-${SCOPE_ALL ? '全量' : '错题'}-20260927.md`)
writeFileSync(outPath, report, 'utf8')
console.log(report)
console.log(`\n[报告已写入] ${outPath}`)
process.exit(0)
