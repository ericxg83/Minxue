#!/usr/bin/env node
/**
 * 远程自测：在 Render 上跑诊断 + 干运行（dry-run）一个 worksheet 修复流程。
 * 用法: NEON_DATABASE_URL=... node server/scripts/selftest_fix_exam.mjs
 *
 * 这个脚本的设计目的：
 *   1) 验证 listSuspectWorksheets 不会因为 SQL 错误而 500
 *   2) 直接看每个 worksheet 的 unit_key 实际是什么（"第十九章实数" vs "试卷① 19.1 ..."）
 *   3) 拿一个真嫌疑 worksheet 跑一次 dry-run fixWorksheet，确认重跑 OCR 流程通畅
 */
import 'dotenv/config'
import { query } from '../config/neon.js'
import { listSuspectWorksheets, diagnoseWorksheet } from '../services/worksheetFixService.js'

const log = (...a) => console.log('[selftest]', ...a)

async function main() {
  log('==== 1) 跑 listSuspectWorksheets(200) ====')
  const suspects = await listSuspectWorksheets(200)
  log('返回', suspects.length, '个嫌疑 worksheet')
  for (const s of suspects.slice(0, 20)) {
    log(`  ${s.id}  ${s.name}  exam=${s.exam_units}  orphan=${s.orphan_ans_count}  big_chapter=${s.big_chapter_ans}  total=${s.total_ans_count}  reasons=[${(s.reasons || []).join(' | ')}]`)
  }

  log('\n==== 2) raw SQL：所有 worksheet 的 unit 分布 ====')
  const { rows: raw } = await query(
    `SELECT w.id, w.name,
            u.unit_key,
            u.unit_title,
            (SELECT COUNT(*) FROM worksheet_answers wa WHERE wa.unit_id = u.id)::int AS ans_count
     FROM worksheets w
     LEFT JOIN resource_units u ON u.resource_id = w.id
     WHERE w.pdf_url IS NOT NULL
     ORDER BY w.created_at DESC, u.unit_seq NULLS LAST, u.id ASC`
  )
  // 聚合
  const byWs = new Map()
  for (const r of raw) {
    if (!byWs.has(r.id)) byWs.set(r.id, { id: r.id, name: r.name, units: [] })
    byWs.get(r.id).units.push({ key: r.unit_key || '', title: r.unit_title, ans: r.ans_count || 0 })
  }
  const wsList = [...byWs.values()]
  log('共', wsList.length, '个 worksheet 有 PDF')
  for (const w of wsList) {
    let exam = 0, chapterMax = 0, orphanAns = 0
    const bigChapters = []
    const orphanKeys = []
    for (const u of w.units) {
      const k = u.key
      if (k.startsWith('试卷')) exam++
      else if (/^第[一二三四五六七八九十\d]+[章节]/.test(k)) {
        if (u.ans > chapterMax) chapterMax = u.ans
        if (u.ans >= 10) bigChapters.push(`${k}(${u.ans})`)
      } else {
        orphanAns += u.ans
        if (u.ans > 0) orphanKeys.push(`${k}(${u.ans})`)
      }
    }
    const isSuspect = orphanAns >= 1 || chapterMax >= 10 || exam >= 1
    log(`  ${w.id}  ${w.name}  exam=${exam}  chapterMax=${chapterMax}  orphan=${orphanAns}  ${isSuspect ? '🟡 嫌疑' : '⚪ 正常'}`)
    if (bigChapters.length) log(`      大章节: ${bigChapters.join(', ')}`)
    if (orphanKeys.length) log(`      孤儿: ${orphanKeys.join(', ')}`)
  }

  if (suspects.length === 0) {
    log('\n❌ listSuspectWorksheets 返回 0，但 raw SQL 里看到嫌疑 worksheet（见上）→ SQL 判据漏了')
    log('   需要看 bigChapters 的具体值，调整 BIG_CHAPTER_ANS_THRESHOLD 或正则')
    process.exit(0)
  }

  // 3) 拿第一个嫌疑 worksheet 跑 dry-run diagnose
  const target = suspects[0]
  log(`\n==== 3) dry-run 诊断嫌疑 worksheet: ${target.id} ${target.name} ====`)
  const d = await diagnoseWorksheet(target.id)
  log('  单元数:', d.units.length, ' 试卷单元:', d.examUnitCount, ' 父章节嫌疑:', d.suspects.length)
  for (const s of d.suspects) log(`    ⚠️  ${s.unit_key} (${s.unit_title}) ans=${s.ans_count}`)
  for (const u of d.units) {
    const k = u.unit_key || ''
    const tag = k.startsWith('试卷') ? '✅试卷' : /^第[一二三四五六七八九十\d]+[章节]/.test(k) ? '📂章节' : '?'
    log(`    ${tag}  ${k}  ans=${u.ans_count}`)
  }

  process.exit(0)
}

main().catch((e) => { console.error('❌ 自测失败:', e); process.exit(1) })
