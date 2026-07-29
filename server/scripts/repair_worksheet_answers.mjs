// 存量答案数据检测与修复（可选）
// 用途：迁移 032 之前入库的答案（unit_id=NULL），或新结构下"同 section 跨单元互相覆盖"的数据。
//
// 典型场景：
//   1) 用户上传了答案 PDF，但入库时 unit_id=NULL → 整本答案在批改时按"无单元"处理，全走 60% 覆盖率兜底，
//      覆盖率不达标时整页被判"待人工"，导致看上去答案没生效。
//   2) 入库后某条 (unit, section, qNo) 被同号不同单元答案覆盖（出现重复或缺失） → 本脚本用 OCR 文本重解析。
//
// 用法：
//   1) node scripts/repair_worksheet_answers.mjs check         # 仅检测问题
//   2) node scripts/repair_worksheet_answers.mjs list          # 列出有问题的 worksheets
//   3) node scripts/repair_worksheet_answers.mjs fix <id>      # 重新解析某 worksheet（基于现存 PDF）
//   4) node scripts/repair_worksheet_answers.mjs fix-all       # 全部重解析
//
// 注意：fix 必须有原 PDF 文件存在（resources.storage_path 或 pdf_url），否则跳过。

import 'dotenv/config'
import { query, TABLES } from '../config/neon.js'
import { clearWorksheetAnswers, clearResourceUnits, getWorksheetAnswers } from '../services/neonService.js'

const args = process.argv.slice(2)
const cmd = args[0] || 'check'

async function checkSummary() {
  // 1) unit_id=NULL 的答案（旧数据）
  const nullUnit = await query(
    `SELECT resource_id, COUNT(*) cnt FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE unit_id IS NULL GROUP BY resource_id ORDER BY cnt DESC LIMIT 50`
  )
  console.log(`\n=== unit_id=NULL 的练习册（共 ${nullUnit.rows.length} 个） ===`)
  for (const r of nullUnit.rows) {
    console.log(`  worksheet=${r.resource_id}  答案数=${r.cnt}`)
  }

  // 2) 同 section 在多单元下并存（迁移 032 后理论上不应再发生，但若解析数据存在此情况，说明 OCR 单元识别串行错位）
  const sameKey = await query(
    `SELECT resource_id, section, question_no, sub_no, COUNT(*) cnt,
            array_agg(DISTINCT unit_id) unit_ids
     FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE unit_id IS NOT NULL
     GROUP BY resource_id, section, question_no, sub_no
     HAVING COUNT(*) > 1
     ORDER BY resource_id, section, question_no
     LIMIT 100`
  )
  console.log(`\n=== 同 (unit, section, qNo, subNo) 重复的记录（共 ${sameKey.rows.length} 组） ===`)
  for (const r of sameKey.rows) {
    console.log(`  worksheet=${r.resource_id}  section=${r.section}  qNo=${r.question_no}  subNo="${r.sub_no}"  cnt=${r.cnt}  units=${r.unit_ids}`)
  }

  // 3) 每个 worksheet 的单元分布概览
  const overview = await query(
    `SELECT r.id, r.title, r.parse_status, r.parse_count,
            COUNT(DISTINCT ru.id) unit_cnt,
            COUNT(ra.id) ans_cnt,
            COUNT(*) FILTER (WHERE ra.unit_id IS NULL) null_unit_cnt
     FROM ${TABLES.RESOURCES} r
     LEFT JOIN ${TABLES.RESOURCE_UNITS} ru ON ru.resource_id = r.id
     LEFT JOIN ${TABLES.WORKSHEET_ANSWERS} ra ON ra.resource_id = r.id
     WHERE r.resource_type = 'workbook'
     GROUP BY r.id
     ORDER BY r.created_at DESC
     LIMIT 30`
  )
  console.log(`\n=== 最近 30 本练习册 ===`)
  console.log(`ID | title | parse_status | parse_count | units | answers | null_unit`)
  for (const r of overview.rows) {
    console.log(`${r.id} | ${r.title || '-'} | ${r.parse_status} | ${r.parse_count} | ${r.unit_cnt} | ${r.ans_cnt} | ${r.null_unit_cnt}`)
  }
}

async function fixWorksheet(worksheetId) {
  // 找到原 PDF
  const r = await query(
    `SELECT id, title, storage_path, pdf_url, parse_status FROM ${TABLES.RESOURCES}
     WHERE id = $1 AND resource_type = 'workbook'`,
    [worksheetId]
  )
  if (r.rows.length === 0) {
    console.error(`worksheet ${worksheetId} 不存在或非 workbook`)
    return
  }
  const w = r.rows[0]
  console.log(`开始重解析 worksheet=${worksheetId} (${w.title || '无标题'})`)

  // 读取 PDF
  const { default: fs } = await import('node:fs/promises')
  let fileBuffer
  if (w.storage_path) {
    try {
      fileBuffer = await fs.readFile(w.storage_path)
    } catch (e) {
      console.error(`无法读取 storage_path: ${w.storage_path} (${e.message})`)
    }
  }
  if (!fileBuffer && w.pdf_url && w.pdf_url.startsWith('http')) {
    // 尝试从 URL 下载
    try {
      const res = await fetch(w.pdf_url)
      fileBuffer = Buffer.from(await res.arrayBuffer())
    } catch (e) {
      console.error(`无法下载 pdf_url: ${w.pdf_url} (${e.message})`)
    }
  }
  if (!fileBuffer) {
    console.error(`找不到原 PDF，无法重解析。请先重新上传。`)
    return
  }

  const { renderPdfToJpegs } = await import('../services/pdfService.js')
  const { ocrExtractFromBuffer } = await import('../services/ocrService.js')
  const { parseAnswerText } = await import('../services/answerParseService.js')
  const { upsertWorksheetAnswers, updateWorksheetParseProgress } = await import('../services/neonService.js')
  const { dedupeAnswers } = await import('../services/neonService.js')

  // 渲染
  const { images, totalPages } = await renderPdfToJpegs(fileBuffer, { scale: 3 })
  await updateWorksheetParseProgress(worksheetId, { totalPages, donePages: 0 })
  await clearWorksheetAnswers(worksheetId)
  await clearResourceUnits(worksheetId)

  // 逐页 OCR
  const lowConfidence = []
  const allAnswers = []
  let state = null
  for (let i = 0; i < images.length; i++) {
    const content = await ocrExtractFromBuffer(images[i], i, [])
    const parsed = parseAnswerText(content, lowConfidence, state)
    allAnswers.push(...parsed.answers)
    state = parsed.lastState
  }
  await upsertWorksheetAnswers(worksheetId, dedupeAnswers(allAnswers))
  await updateWorksheetParseProgress(worksheetId, { totalPages, donePages: totalPages })
  console.log(`完成 worksheet=${worksheetId}  共 ${allAnswers.length} 条答案入库`)
}

if (cmd === 'check') {
  await checkSummary()
} else if (cmd === 'list') {
  await checkSummary()
} else if (cmd === 'fix' && args[1]) {
  await fixWorksheet(args[1])
} else if (cmd === 'fix-all') {
  const all = await query(
    `SELECT id FROM ${TABLES.RESOURCES} WHERE resource_type = 'workbook' ORDER BY created_at DESC`
  )
  console.log(`共 ${all.rows.length} 本练习册将重新解析`)
  for (const r of all.rows) await fixWorksheet(r.id)
} else {
  console.log('用法：node scripts/repair_worksheet_answers.mjs [check|list|fix <id>|fix-all]')
}
process.exit(0)
