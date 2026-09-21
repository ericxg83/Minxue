/**
 * 离线复算练习册答案册：用「当前解析器」跑已抓好的 OCR 原文，输出单元分布 + 全量答案。
 *
 * 用途：改 isSectionHeader 前后各跑一次（同一份 ocr_pages.json），
 *   把「纯正则修复的效果」与「OCR 抖动」隔离开。
 *   配合 server/scripts/backup-worksheet-*.mjs 的库内快照做三方对照。
 *
 * 用法：
 *   node server/scripts/offline-reparse-worksheet.mjs --ocr=<json> --out=<txt> [--json=<json>]
 */
import fs from 'node:fs'
import { parseAnswerText } from '../services/answerParseService.js'

const arg = (n, d = null) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(`--${n}=`.length) || d
const OCR = arg('ocr')
const OUT = arg('out')
const OUTJSON = arg('json')
if (!OCR || !OUT) { console.error('用法：--ocr=<json> --out=<txt> [--json=<json>]'); process.exit(1) }

const ocrPages = JSON.parse(fs.readFileSync(OCR, 'utf8'))
const pages = Object.keys(ocrPages).map(Number).sort((a, b) => a - b)

let carry = null
const all = []
const units = new Map()
const lines = []

for (const page of pages) {
  const parsed = parseAnswerText(ocrPages[page] || '', [], carry, page)
  carry = parsed.lastState
  for (const a of parsed.answers) {
    all.push({ ...a, page })
    const k = a.unit_key || '<null>'
    if (!units.has(k)) units.set(k, { first: page, last: page, rows: [] })
    const u = units.get(k)
    u.last = page
    u.rows.push({ page, q: Number(a.question_no), sub: a.sub_no || '', answer: String(a.answer || ''), type: a.answer_type, section: a.section || '' })
  }
}

lines.push(`OCR 源: ${OCR}   页数 ${pages.length}`)
lines.push(`总答案行: ${all.length}   单元数: ${units.size}`)
lines.push('\n===== 单元汇总 =====')
for (const [k, v] of units) {
  const qs = [...new Set(v.rows.map(r => r.q))].filter(Number.isFinite).sort((a, b) => a - b)
  const max = qs.length ? qs[qs.length - 1] : 0
  const missing = []
  for (let i = 1; i <= max; i++) if (!qs.includes(i)) missing.push(i)
  const lastPage = v.rows[v.rows.length - 1].page
  lines.push(`${k.padEnd(24)} p${v.first}-${v.last}  ${String(v.rows.length).padStart(3)}行  题号 ${qs.length ? qs[0] : '-'}..${max}  ${missing.length ? '⚠缺 ' + missing.join(',') : '✓连续'}  末行在p${lastPage}`)
}

lines.push('\n\n===== 逐单元明细 =====')
for (const [k, v] of units) {
  lines.push(`\n--- ${k} ---`)
  for (const r of v.rows) {
    lines.push(`  p${String(r.page).padStart(2)}  ${String(r.q).padStart(2)}${r.sub ? '(' + r.sub + ')' : '  '}  ${r.answer.replace(/\n/g, ' ').slice(0, 78)}  [${r.type}]${r.section ? ' §' + r.section : ''}`)
  }
}

fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
if (OUTJSON) fs.writeFileSync(OUTJSON, JSON.stringify({ units: [...units].map(([k, v]) => ({ unit_key: k, ...v })), answers: all }, null, 1), 'utf8')
console.log(`DONE. units=${units.size} answers=${all.length} → ${OUT}`)
