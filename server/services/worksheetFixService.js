/**
 * 修复 worksheet 的「试卷①/②/③」错挂问题
 *
 * 根因：parseUnitHeader 之前漏识别「试卷① 19.1 平方根与立方根 基础性测试」，
 *       答案 PDF 中该行被吞，下面所有答案错挂到上一个父章节（如「第十九章实数」）。
 * 修复：commit 3dc63df 已扩展 EXAM_HEADER_RE 正确识别试卷①②③为独立单元。
 *       本 service 重跑 OCR 走新解析器，把错挂答案重写到正确 unit_key 下。
 *
 * 入口：
 *   - diagnoseWorksheet(worksheetId)         诊断单个 worksheet
 *   - listSuspectWorksheets(limit)            列出所有真嫌疑
 *   - fixWorksheet(worksheetId, { onLog })    备份 + 重跑 OCR + 验证
 *
 * 复用 server/routes/worksheets.js 的 doParseOcrBatched（与线上 parse-pdf 接口完全一致）。
 */
import { query } from '../config/neon.js'
import { doParseOcrBatched } from '../routes/worksheets.js'
import {
  clearWorksheetAnswers,
  clearResourceUnits,
  updateWorksheetParseStatus,
  updateWorksheetParseProgress,
} from './neonService.js'
import { getPdfPageCount } from './pdfService.js'

const RESOURCE_UNITS = 'resource_units'

const NON_EXAM_PREFIX_RE = /^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)/
const CHAPTER_PREFIX_RE = /^第[一二三四五六七八九十\d]+[章节]/

/**
 * 父章节错挂嫌疑判定（非试卷/非章/非练习单元，但挂了 >=10 条答案）
 */
function classifyUnit(unit) {
  if (!unit.unit_key) return 'unknown'
  if (unit.unit_key.startsWith('试卷')) return 'exam'
  if (CHAPTER_PREFIX_RE.test(unit.unit_key)) return 'chapter'
  if (NON_EXAM_PREFIX_RE.test(unit.unit_key)) return 'practice'
  return 'orphan'
}

/**
 * 诊断单个 worksheet
 * @returns {Promise<{w, units, suspects, examUnitCount}>}
 */
export async function diagnoseWorksheet(worksheetId) {
  const { rows: wRows } = await query(
    `SELECT id, name, pdf_url, parse_status, parse_count
     FROM worksheets WHERE id = $1`,
    [worksheetId]
  )
  if (wRows.length === 0) throw new Error(`找不到 worksheetId=${worksheetId}`)
  const w = wRows[0]
  if (!w.pdf_url) throw new Error('PDF URL 为空，请先在后台管理界面重新上传答案 PDF')

  const { rows: units } = await query(
    `SELECT u.id, u.unit_key, u.unit_title, u.lesson_code, u.ordinal, u.unit_seq,
            u.answer_page_start, u.answer_page_end,
            (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id) AS ans_count
     FROM ${RESOURCE_UNITS} u
     WHERE u.resource_id = $1
     ORDER BY u.unit_seq NULLS LAST, u.created_at ASC`,
    [worksheetId]
  )

  const suspects = []
  let examUnitCount = 0
  for (const u of units) {
    const cls = classifyUnit(u)
    if (cls === 'exam') examUnitCount++
    if (cls === 'orphan' && parseInt(u.ans_count, 10) >= 10) suspects.push(u)
  }
  return { w, units, suspects, examUnitCount }
}

/**
 * 列出所有真嫌疑 worksheet（试卷单元=0 且父章节错挂>=10）
 * @returns {Promise<Array<{id, name, exam_units, orphan_ans_count}>>}
 */
export async function listSuspectWorksheets(limit = 200) {
  const { rows } = await query(
    `SELECT w.id, w.name,
            COUNT(u.id) FILTER (WHERE u.unit_key LIKE '试卷%')            AS exam_units,
            SUM( (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id) )
              FILTER (
                WHERE u.unit_key NOT LIKE '试卷%'
                  AND u.unit_key !~ '^第[一二三四五六七八九十\\d]+[章节]'
                  AND u.unit_key !~ '^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)'
              ) AS orphan_ans_count
     FROM worksheets w
     LEFT JOIN ${RESOURCE_UNITS} u ON u.resource_id = w.id
     WHERE w.pdf_url IS NOT NULL
     GROUP BY w.id, w.name, w.created_at
     HAVING COUNT(u.id) FILTER (WHERE u.unit_key LIKE '试卷%') = 0
        AND SUM( (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id) )
              FILTER (
                WHERE u.unit_key NOT LIKE '试卷%'
                  AND u.unit_key !~ '^第[一二三四五六七八九十\\d]+[章节]'
                  AND u.unit_key !~ '^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)'
              ) >= 10
     ORDER BY w.created_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

/**
 * 备份 + 重跑 OCR + 验证
 * @param {string} worksheetId
 * @param {Object} opts
 * @param {(line: string) => void} [opts.onLog] 进度日志回调
 * @param {boolean} [opts.skipOcr=false] 仅诊断/备份，不重跑 OCR（用于 dry-run）
 * @returns {Promise<{ok, before, after, error, skipped}>}
 */
export async function fixWorksheet(worksheetId, { onLog = () => {}, skipOcr = false } = {}) {
  const before = await diagnoseWorksheet(worksheetId)
  onLog(`📚 ${before.w.name}  (${before.w.id})`)
  onLog(`   单元数: ${before.units.length}  试卷单元: ${before.examUnitCount}  父章节错挂嫌疑: ${before.suspects.length}`)

  if (before.suspects.length === 0) {
    onLog(`   ✅ 无错挂嫌疑，跳过。`)
    return { ok: true, before, after: null, skipped: true }
  }

  for (const s of before.suspects) {
    onLog(`     ⚠️ ${s.unit_key} | ${s.unit_title} | lesson=${s.lesson_code || '-'} | ans=${s.ans_count}`)
  }

  if (skipOcr) {
    onLog(`   ⏸ dry-run 模式：跳过备份与重跑 OCR`)
    return { ok: true, before, after: null, skipped: false, dryRun: true }
  }

  // === 备份：把错挂答案的 unit_id 写入 metadata ===
  onLog(`💾 [备份] 将错挂答案的 unit_id 写入 worksheet_answers.metadata.backup_unit_id`)
  for (const s of before.suspects) {
    const { rowCount } = await query(
      `UPDATE worksheet_answers
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'backup_unit_id', $2::text,
         'backup_unit_key', $3,
         'backup_at', NOW()::text
       )
       WHERE unit_id = $1`,
      [s.id, s.id, s.unit_key]
    )
    onLog(`   ${s.unit_key} → 已备份 ${rowCount} 条答案`)
  }

  // === 下载 PDF ===
  onLog(`🔄 [重跑 OCR] 下载 PDF → 调用 doParseOcrBatched（commit 3dc63df 后的新 parseUnitHeader）`)
  let fileBuffer
  try {
    const res = await fetch(before.w.pdf_url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    fileBuffer = Buffer.from(await res.arrayBuffer())
    onLog(`   PDF 下载: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`)
  } catch (e) {
    const msg = `PDF 下载失败: ${e.message}`
    onLog(`❌ ${msg}`)
    return { ok: false, before, error: msg }
  }

  const totalPages = await getPdfPageCount(fileBuffer)
  onLog(`   共 ${totalPages} 页`)

  await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
  try {
    await updateWorksheetParseProgress(worksheetId, { totalPages, donePages: 0 })
  } catch (progressErr) {
    onLog(`⚠️ 清零解析进度列失败（可能列不存在，不影响）: ${progressErr.message}`)
  }
  await clearWorksheetAnswers(worksheetId)
  await clearResourceUnits(worksheetId)

  try {
    await doParseOcrBatched(worksheetId, fileBuffer, totalPages, null)
    onLog(`   ✅ doParseOcrBatched 完成`)
  } catch (e) {
    onLog(`❌ OCR 重跑失败: ${e.message}`)
    await updateWorksheetParseStatus(worksheetId, { status: 'failed', error: e.message }).catch(() => {})
    return { ok: false, before, error: `OCR 重跑失败: ${e.message}` }
  }

  // === 验证 ===
  const after = await diagnoseWorksheet(worksheetId)
  onLog(`=== 修复后 unit 分布 ===`)
  let newExamCount = 0
  let newSuspectCount = 0
  for (const u of after.units) {
    const cls = classifyUnit(u)
    if (cls === 'exam') newExamCount++
    let tag = '   '
    if (cls === 'exam') tag = '✅ 试卷'
    else if (cls === 'orphan' && parseInt(u.ans_count, 10) >= 10) { tag = '⚠️  父章节挂答案'; newSuspectCount++ }
    else if (parseInt(u.ans_count, 10) > 0) tag = '📂'
    onLog(`  ${tag} ${u.unit_key} | ${u.unit_title} | lesson=${u.lesson_code || '-'} | ans=${u.ans_count}`)
  }
  onLog(`📊 试卷单元: ${before.examUnitCount} → ${newExamCount}  | 父章节错挂: ${before.suspects.length} → ${newSuspectCount}`)
  return { ok: true, before, after }
}
