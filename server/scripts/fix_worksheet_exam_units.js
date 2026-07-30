/**
 * 修复 worksheet 的「试卷①/②/③」错挂问题
 *
 * 根因：parseUnitHeader 之前漏识别「试卷① 19.1 平方根与立方根 基础性测试」，
 *       答案 PDF 中该行被吞，下面所有答案错挂到上一个父章节（如「第十九章实数」）。
 * 修复：commit 3dc63df 已扩展 EXAM_HEADER_RE 正确识别试卷①②③为独立单元。
 *       本脚本重跑 OCR 走新解析器，把错挂答案重写到正确 unit_key 下。
 *
 * 用法（Render 控制台 / 本地均可）：
 *   # 单个 worksheet：诊断 + 备份 + 重跑 OCR
 *   node server/scripts/fix_worksheet_exam_units.js <worksheetId> [--dry-run]
 *
 *   # 批量模式：自动扫描所有"试卷单元=0 且父章节错挂>=10"的 worksheet 并逐个修复
 *   node server/scripts/fix_worksheet_exam_units.js --all [--dry-run] [--limit 50]
 *
 *   --dry-run 只诊断不修改；不带此参数才会清空旧答案并重跑 OCR
 *   --limit  限制批量扫描数量（默认 200）
 *
 * 流程：
 *   1) 诊断：列出 unit 分布、找出父章节错挂嫌疑、统计答案数
 *   2) 备份：将错挂答案的 unit_id 写入 worksheet_answers.metadata.backup_unit_id
 *   3) 重跑 OCR：复用 routes/worksheets.js 的 doParseOcrBatched（与线上 parse-pdf 接口完全一致）
 *   4) 验证：对比新/旧 unit 分布
 */
import 'dotenv/config'
import { query } from '../config/neon.js'
import { doParseOcrBatched } from '../routes/worksheets.js'
import {
  clearWorksheetAnswers,
  clearResourceUnits,
  updateWorksheetParseStatus,
  updateWorksheetParseProgress,
} from '../services/neonService.js'
import { getPdfPageCount } from '../services/pdfService.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const allMode = args.includes('--all')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 200
const singleId = allMode ? null : args.find(a => !a.startsWith('--'))

const RESOURCE_UNITS = 'resource_units'

if (!singleId && !allMode) {
  console.error('用法:')
  console.error('  node server/scripts/fix_worksheet_exam_units.js <worksheetId> [--dry-run]')
  console.error('  node server/scripts/fix_worksheet_exam_units.js --all [--dry-run] [--limit 50]')
  process.exit(1)
}

/**
 * 诊断单个 worksheet：返回 { w, units, suspects, examUnitCount }
 * suspects  = 父章节错挂嫌疑（非试卷/非章/非练习单元，但挂了 >=10 条答案）
 */
async function diagnose(worksheetId) {
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
    const isParent = u.unit_key
      && !u.unit_key.startsWith('试卷')
      && !/^第[一二三四五六七八九十\d]+[章节]/.test(u.unit_key)
      && !/^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)/.test(u.unit_key)
    const isExam = u.unit_key?.startsWith('试卷')
    if (isExam) examUnitCount++
    if (isParent && parseInt(u.ans_count, 10) >= 10) suspects.push(u)
  }
  return { w, units, suspects, examUnitCount }
}

function printDiagnose({ w, units, suspects, examUnitCount }) {
  console.log(`\n📚 ${w.name}  (${w.id})`)
  console.log(`   状态: parse_status=${w.parse_status} parse_count=${w.parse_count}`)
  console.log(`   PDF: ${w.pdf_url.substring(0, 80)}...`)
  console.log(`   单元数: ${units.length}  试卷单元: ${examUnitCount}  父章节错挂嫌疑: ${suspects.length}`)
  if (suspects.length > 0) {
    for (const s of suspects) {
      console.log(`     ⚠️ ${s.unit_key} | ${s.unit_title} | lesson=${s.lesson_code || '-'} | ans=${s.ans_count}`)
    }
  }
}

/**
 * 备份 + 重跑 OCR + 验证
 */
async function fixOne(worksheetId) {
  const diag = await diagnose(worksheetId)
  printDiagnose(diag)
  const { w, suspects } = diag

  if (suspects.length === 0) {
    console.log(`   ✅ 无错挂嫌疑，跳过。`)
    return { skipped: true, before: diag, after: null }
  }

  // === 备份：把错挂答案的 unit_id 写入 metadata ===
  console.log(`\n💾 [备份] 将错挂答案的 unit_id 写入 worksheet_answers.metadata.backup_unit_id`)
  for (const s of suspects) {
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
    console.log(`   ${s.unit_key} → 已备份 ${rowCount} 条答案`)
  }

  // === 重跑 OCR ===
  console.log(`\n🔄 [重跑 OCR] 下载 PDF → 调用 doParseOcrBatched（commit 3dc63df 后的新 parseUnitHeader）`)
  let fileBuffer
  try {
    const res = await fetch(w.pdf_url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    fileBuffer = Buffer.from(await res.arrayBuffer())
    console.log(`   PDF 下载: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`)
  } catch (e) {
    console.error(`❌ PDF 下载失败: ${e.message}`)
    console.error(`   备份已写入 metadata，但答案未重跑。`)
    return { skipped: false, before: diag, error: `PDF 下载失败: ${e.message}` }
  }

  const totalPages = await getPdfPageCount(fileBuffer)
  console.log(`   共 ${totalPages} 页`)

  await updateWorksheetParseStatus(worksheetId, { status: 'parsing' })
  try {
    await updateWorksheetParseProgress(worksheetId, { totalPages, donePages: 0 })
  } catch (progressErr) {
    console.warn('⚠️ 清零解析进度列失败（可能列不存在，不影响）:', progressErr.message)
  }
  await clearWorksheetAnswers(worksheetId)
  await clearResourceUnits(worksheetId)

  try {
    await doParseOcrBatched(worksheetId, fileBuffer, totalPages, null)
    console.log(`   ✅ doParseOcrBatched 完成`)
  } catch (e) {
    console.error(`❌ OCR 重跑失败: ${e.message}`)
    await updateWorksheetParseStatus(worksheetId, { status: 'failed', error: e.message }).catch(() => {})
    return { skipped: false, before: diag, error: `OCR 重跑失败: ${e.message}` }
  }

  // === 验证：新 unit 分布 ===
  const after = await diagnose(worksheetId)
  console.log(`\n=== 修复后 unit 分布 ===`)
  let newExamCount = 0
  let newSuspectCount = 0
  for (const u of after.units) {
    const isExam = u.unit_key?.startsWith('试卷')
    const isParent = u.unit_key
      && !isExam
      && !/^第[一二三四五六七八九十\d]+[章节]/.test(u.unit_key)
      && !/^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)/.test(u.unit_key)
    if (isExam) newExamCount++
    let tag = '   '
    if (isExam) tag = '✅ 试卷'
    else if (isParent && parseInt(u.ans_count, 10) >= 10) { tag = '⚠️  父章节挂答案'; newSuspectCount++ }
    else if (parseInt(u.ans_count, 10) > 0) tag = '📂'
    console.log(`  ${tag} ${u.unit_key} | ${u.unit_title} | lesson=${u.lesson_code || '-'} | ans=${u.ans_count}`)
  }
  console.log(`📊 试卷单元: ${diag.examUnitCount} → ${newExamCount}  | 父章节错挂: ${diag.suspects.length} → ${newSuspectCount}`)
  return { skipped: false, before: diag, after }
}

// ============ 主流程 ============

if (singleId) {
  // 单个 worksheet 模式
  console.log(`\n🔍 [诊断] worksheetId=${singleId}  dryRun=${dryRun}\n`)
  try {
    const diag = await diagnose(singleId)
    printDiagnose(diag)
    if (dryRun) {
      console.log(`\n✅ [诊断完成] dry-run 模式未做修改。`)
      console.log(`   如确认要重跑 OCR 重写答案，请去掉 --dry-run 重跑：`)
      console.log(`   node server/scripts/fix_worksheet_exam_units.js ${singleId}\n`)
      process.exit(0)
    }
    if (diag.suspects.length === 0) {
      console.log(`\n✅ 此 worksheet 无父章节错挂嫌疑，无需修复！`)
      process.exit(0)
    }
    const r = await fixOne(singleId)
    if (r.error) {
      console.error(`\n❌ 修复失败: ${r.error}`)
      process.exit(1)
    }
    console.log(`\n💡 备份信息保留在 worksheet_answers.metadata.backup_unit_id，如需回滚可查。`)
    console.log(`\n🎉 修复完成！请到 worksheets/${singleId}/review 页面验证。\n`)
  } catch (e) {
    console.error(`❌ 错误: ${e.message}`)
    process.exit(1)
  }
  process.exit(0)
}

// --all 批量模式
console.log(`\n🔍 [批量扫描] 找出『试卷单元=0 且父章节错挂>=10』的 worksheet  dryRun=${dryRun}\n`)

const { rows: suspects } = await query(
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
   GROUP BY w.id
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

if (suspects.length === 0) {
  console.log(`✅ 未发现需要修复的 worksheet。\n`)
  process.exit(0)
}

console.log(`📋 发现 ${suspects.length} 个真嫌疑 worksheet：\n`)
for (const s of suspects) {
  console.log(`   - ${s.id}  ${s.name}  (orphan_ans=${s.orphan_ans_count})`)
}

if (dryRun) {
  console.log(`\n✅ [诊断完成] dry-run 模式未做修改。`)
  console.log(`   如确认要批量修复，请去掉 --dry-run 重跑：`)
  console.log(`   node server/scripts/fix_worksheet_exam_units.js --all\n`)
  process.exit(0)
}

console.log(`\n🚀 开始批量修复...\n`)
const results = []
for (let i = 0; i < suspects.length; i++) {
  const s = suspects[i]
  console.log(`\n${'='.repeat(70)}`)
  console.log(`[${i + 1}/${suspects.length}] ${s.id}  ${s.name}`)
  console.log('='.repeat(70))
  try {
    const r = await fixOne(s.id)
    results.push({ id: s.id, name: s.name, ok: !r.error, error: r.error || null, after: r.after })
  } catch (e) {
    console.error(`❌ 异常: ${e.message}`)
    results.push({ id: s.id, name: s.name, ok: false, error: e.message, after: null })
  }
}

console.log(`\n${'='.repeat(70)}`)
console.log(`📊 批量修复总结`)
console.log('='.repeat(70))
const ok = results.filter(r => r.ok).length
const failed = results.filter(r => !r.ok).length
console.log(`   成功: ${ok}  失败: ${failed}  总计: ${results.length}`)
if (failed > 0) {
  console.log(`\n   失败明细：`)
  for (const r of results.filter(r => !r.ok)) {
    console.log(`   ❌ ${r.id}  ${r.name}  → ${r.error}`)
  }
}
console.log(`\n💡 备份信息保留在 worksheet_answers.metadata.backup_unit_id，如需回滚可查。\n`)
process.exit(failed > 0 ? 1 : 0)
