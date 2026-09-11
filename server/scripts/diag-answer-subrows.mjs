/**
 * diag-answer-subrows.mjs — 答案库小题行存量错位诊断（只读，不改任何数据）
 *
 * 背景（2026-09-11 实测）：resource_answers 27.2(2) 单元里 q=10 sub='' 才是正确的
 * 整题答案，而 sub='1' 存的是另一道题的答案 —— OCR 拆出 sub_no 后精确命中会绕开
 * 正确答案。运行时防线（isSubRowConsistentWithWhole）已上线；本脚本把**存量可疑
 * 小题行**全量扫出来，输出报告供老师审核后再决定治理方式。
 *
 * 判定口径：同一 (unit, question_no) 下存在整题行（sub_no=''）且能按 (1)(2) 拆出
 * 小问分段时，每个小题行（sub_no='1'…）必须与对应段一致（归一化后相等或互相包含）；
 * 不一致 → 可疑。整题行拆不出分段 / 缺整题行的，本脚本不判（运行时防线也不拦）。
 *
 * 用法：node scripts/diag-answer-subrows.mjs
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import fs from 'node:fs'
import pg from 'pg'
import { isSubRowConsistentWithWhole, splitSubAnswers } from '../services/answerParseService.js'

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function main() {
  const { rows } = await pool.query(`
    SELECT ra.id, ru.unit_key, ra.question_no, ra.sub_no, ra.answer_type,
           left(btrim(coalesce(ra.answer,'')), 120) AS answer_head,
           btrim(coalesce(ra.answer,'')) AS answer_full
    FROM resource_answers ra
    JOIN resource_units ru ON ru.id = ra.unit_id
    ORDER BY ru.unit_key, ra.question_no, ra.sub_no
  `)

  // 按 (unit_key, question_no) 分组
  const groups = new Map()
  for (const r of rows) {
    const key = `${r.unit_key}|${r.question_no}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const suspicious = []
  const needsReview = [] // B 类：整题行拆不出分段时的宽松包含校验
  let wholeRows = 0, subRowsTotal = 0, checkedSubRows = 0

  const norm = (s) => String(s || '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase()

  for (const [key, group] of groups) {
    const whole = group.find(g => String(g.sub_no || '').trim() === '')
    if (!whole) continue
    wholeRows++
    const wholeNorm = norm(whole.answer_full)
    const segs = splitSubAnswers(whole.answer_full)
    if (!segs || segs.length < 2) {
      // B 类：整题行拆不出分段，防线无法分段比对。退一步做宽松包含校验：
      // 同一道题的小题行答案（照抄同一份印刷答案）理应能在整题行答案里找到踪迹；
      // 完全找不到且长度足够 → 标记"需人工核查"（实测 27.2(2) q=10 即此形态）。
      const subs = group.filter(g => String(g.sub_no || '').trim() !== '')
      for (const s of subs) {
        subRowsTotal++
        const sNorm = norm(s.answer_full)
        if (!sNorm || sNorm.length < 10) continue
        if (!wholeNorm.includes(sNorm)) {
          needsReview.push({
            unit_key: key.split('|')[0],
            question_no: key.split('|')[1],
            sub_no: s.sub_no,
            answer_type: s.answer_type,
            sub_answer: s.answer_head,
            whole_answer: whole.answer_head,
            id: s.id
          })
        }
      }
      continue
    }
    const subs = group.filter(g => String(g.sub_no || '').trim() !== '')
    for (const s of subs) {
      subRowsTotal++
      if (splitSubAnswers(s.answer_full)) continue // 小题行自身还带分段（嵌套小问），跳过
      checkedSubRows++
      const seg = segs.find(x => String(x.sub_no) === String(s.sub_no).trim())
      if (!seg) continue
      if (!isSubRowConsistentWithWhole(s.sub_no, s.answer_full, whole.answer_full)) {
        suspicious.push({
          unit_key: key.split('|')[0],
          question_no: key.split('|')[1],
          sub_no: s.sub_no,
          answer_type: s.answer_type,
          sub_answer: s.answer_head,
          whole_seg: String(seg.answer || '').slice(0, 120),
          id: s.id
        })
      }
    }
  }

  const report = [
    `# 答案库小题行存量错位诊断报告`,
    ``,
    `- 生成时间：${new Date().toISOString()}`,
    `- 扫描范围：resource_answers 全表（${rows.length} 行）`,
    `- 有整题行的题号：${wholeRows} 个；小题行总数：${subRowsTotal}；参与校验的小题行：${checkedSubRows}`,
    `- **A 类可疑（与整题行对应分段明确不一致）：${suspicious.length} 条**`,
    `- **B 类需人工核查（整题行拆不出分段、小题行答案在整题答案中无踪迹）：${needsReview.length} 条**`,
    ``,
    `> 判定口径：小题行答案与整题行按 (1)(2) 拆出的对应分段，归一化后既不相等也不互相包含。`,
    `> 运行时防线已上线（isSubRowConsistentWithWhole → lookupRow 回退整题行），本清单仅供`,
    `> 老师审核后决定是否人工修订/停用这些小题行；脚本不写任何数据。`,
    ``
  ]
  if (suspicious.length > 0) {
    report.push(`## A 类：与整题行对应分段明确不一致（${suspicious.length} 条）`, ``)
    report.push(`| 单元 | 题号 | 小问 | 行ID | 小题行答案（前120字） | 整题行对应段（前120字） |`, `|---|---|---|---|---|---|`)
    for (const s of suspicious) {
      report.push(`| ${s.unit_key} | ${s.question_no} | ${s.sub_no} | \`${s.id}\` | ${s.sub_answer.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${s.whole_seg.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    }
    report.push(``)
  }
  if (needsReview.length > 0) {
    report.push(`## B 类：整题行拆不出分段，小题行答案在整题行答案中找不到踪迹（${needsReview.length} 条，需人工核查）`, ``)
    report.push(`| 单元 | 题号 | 小问 | 行ID | 小题行答案（前120字） | 整题行答案（前120字） |`, `|---|---|---|---|---|---|`)
    for (const s of needsReview) {
      report.push(`| ${s.unit_key} | ${s.question_no} | ${s.sub_no} | \`${s.id}\` | ${s.sub_answer.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${s.whole_answer.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    }
    report.push(``)
  }

  const outPath = 'D:/Minxue_App_V3/_answer_subrows_audit.md'
  fs.writeFileSync(outPath, report.join('\n'), 'utf8')
  console.log(`扫描完成：${rows.length} 行 → 可疑 ${suspicious.length} 条，报告：${outPath}`)
  await pool.end()
}

main().catch(async (e) => {
  console.error('脚本异常:', e)
  try { await pool.end() } catch {}
  process.exit(1)
})
