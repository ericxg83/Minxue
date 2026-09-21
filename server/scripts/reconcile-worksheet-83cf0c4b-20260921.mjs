/**
 * 对账（2026-09-21）：答案册 83cf0c4b《八上精练与拓展》重解析前后 + 离线预期三方对照
 *
 * 数据源：
 *   A. 旧库内快照  server/backups/worksheet-83cf0c4b-before-*.json
 *   B. 离线预期    _basj_offline_fixed.json（同 OCR 文本 + 修复后解析器）
 *   C. 新库内实际  resource_units / resource_answers
 *
 * 关注：① 单元数/答案数 ② 新增与消失的单元 ③ 每个单元的题号范围与缺口
 *      ④ 关键验收单元（20.2(4)/习题20.2/单元练习二十/期中练习/期末练习）的第 1 题答案
 *      ⑤ 有多少条旧答案被改写（逐条列出，确认都是"由错变对"）
 * 用法：node server/scripts/reconcile-worksheet-83cf0c4b-20260921.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })
const WS = '83cf0c4b-ca07-46dd-b9ca-fc5ffdb6be45'

// ── A. 旧快照 ──
const bdir = resolve(__dirname, '..', 'backups')
const beforeFile = fs.readdirSync(bdir).filter(f => f.startsWith('worksheet-83cf0c4b-before-')).sort().pop()
const before = JSON.parse(fs.readFileSync(resolve(bdir, beforeFile), 'utf8'))
const unitKeyOf = new Map(before.units.map(u => [u.id, u.unit_key]))
const beforeRows = before.answers.map(a => ({
  unit: unitKeyOf.get(a.unit_id) || '<no-unit>',
  q: Number(a.question_no), sub: a.sub_no || '', answer: String(a.answer || ''),
}))
const beforeByUnit = group(beforeRows)

// ── B. 离线预期 ──
const offline = JSON.parse(fs.readFileSync('D:/Minxue_App_V3/_basj_offline_fixed.json', 'utf8'))
const offlineRows = offline.answers.map(a => ({
  unit: a.unit_key || '<no-unit>', q: Number(a.question_no), sub: a.sub_no || '', answer: String(a.answer || ''),
}))
const offlineByUnit = group(offlineRows)

// ── C. 新库内 ──
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const units = (await pool.query(
  `SELECT id, unit_key FROM resource_units WHERE resource_id=$1::uuid`, [WS])).rows
const newKeyOf = new Map(units.map(u => [u.id, u.unit_key]))
const rawNew = (await pool.query(
  `SELECT unit_id, question_no, sub_no, answer, answer_status FROM resource_answers WHERE resource_id=$1::uuid`, [WS])).rows
const newRows = rawNew.map(a => ({
  unit: newKeyOf.get(a.unit_id) || '<no-unit>', q: Number(a.question_no), sub: a.sub_no || '', answer: String(a.answer || ''),
}))
const newByUnit = group(newRows)

function group(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.unit)) m.set(r.unit, [])
    m.get(r.unit).push(r)
  }
  return m
}
function qRange(rows) {
  const qs = [...new Set(rows.map(r => r.q))].filter(Number.isFinite).sort((a, b) => a - b)
  if (!qs.length) return { min: '-', max: '-', n: 0, missing: [] }
  const max = qs[qs.length - 1]
  const missing = []
  for (let i = 1; i <= max; i++) if (!qs.includes(i)) missing.push(i)
  return { min: qs[0], max, n: qs.length, missing }
}

const L = []
L.push('='.repeat(78))
L.push('答案册 83cf0c4b《八上精练与拓展》重解析对账   旧快照=' + beforeFile)
L.push('='.repeat(78))
L.push(`                      旧库      离线预期    新库`)
L.push(`单元数              ${String(beforeByUnit.size).padStart(6)}${String(offlineByUnit.size).padStart(12)}${String(newByUnit.size).padStart(10)}`)
L.push(`答案行数            ${String(beforeRows.length).padStart(6)}${String(offlineRows.length).padStart(12)}${String(newRows.length).padStart(10)}`)

// 单元增删
const beforeKeys = new Set(beforeByUnit.keys())
const newKeys = new Set(newByUnit.keys())
L.push('\n───── 新增单元（旧库里被吞掉的标题）─────')
for (const k of [...newKeys].filter(k => !beforeKeys.has(k)).sort()) {
  const r = qRange(newByUnit.get(k))
  L.push(`  + ${k.padEnd(22)} 题号 ${r.min}..${r.max} (${r.n}个)  ${r.missing.length ? '⚠缺 ' + r.missing.join(',') : '✓连续'}`)
}
L.push('\n───── 消失单元（伪单元 / 被纠正的错误结构）─────')
for (const k of [...beforeKeys].filter(k => !newKeys.has(k)).sort()) {
  const r = qRange(beforeByUnit.get(k))
  L.push(`  − ${k.padEnd(22)} 旧题号 ${r.min}..${r.max} (${r.n}个)`)
}

// 逐单元对照
L.push('\n───── 逐单元题号范围（旧 → 新）─────')
for (const k of [...new Set([...beforeKeys, ...newKeys])].sort()) {
  const b = beforeByUnit.has(k) ? qRange(beforeByUnit.get(k)) : null
  const n = newByUnit.has(k) ? qRange(newByUnit.get(k)) : null
  const bs = b ? `${b.min}..${b.max}(${b.n})${b.missing.length ? '⚠' + b.missing.length : ''}` : '—'
  const ns = n ? `${n.min}..${n.max}(${n.n})${n.missing.length ? '⚠' + n.missing.length : ''}` : '—'
  const mark = (!b || !n) ? '  ★' : (bs === ns ? '' : '  ←变')
  L.push(`  ${k.padEnd(22)} ${bs.padEnd(18)} → ${ns.padEnd(18)}${mark}`)
}

// 关键验收单元第 1 题
L.push('\n───── 关键验收单元：第 1 题答案（旧 → 新）─────')
for (const k of ['20.2(4)', '习题20.2', '单元练习二十', '单元练习二十一', '期中练习', '期末练习', '18.1', '22.0']) {
  const f = (m, key) => {
    const rows = m.get(key) || []
    const r = rows.filter(x => x.q === 1 && !x.sub)[0] || rows.filter(x => x.q === 1)[0]
    return r ? JSON.stringify(r.answer).slice(0, 46) : '<无>'
  }
  L.push(`  ${k.padEnd(14)} ${f(beforeByUnit, k).padEnd(48)} → ${f(newByUnit, k)}`)
}

// 旧答案被改写
L.push('\n───── 旧答案被改写（同 单元+题号+子题 答案文本变化）─────')
const newIdx = new Map(newRows.map(r => [`${r.unit}|${r.q}|${r.sub}`, r.answer]))
let changed = 0, same = 0
for (const r of beforeRows) {
  const k = `${r.unit}|${r.q}|${r.sub}`
  const nv = newIdx.get(k)
  if (nv === undefined) continue
  if (nv !== r.answer) {
    changed++
    if (changed <= 25) L.push(`  [${r.unit}] q${r.q}${r.sub ? '(' + r.sub + ')' : ''}\n      旧: ${r.answer.slice(0, 90)}\n      新: ${nv.slice(0, 90)}`)
  } else same++
}
L.push(`  ... 共 ${changed} 条改写，${same} 条未变（旧库 ${beforeRows.length} 条，新库 ${newRows.length} 条）`)

// 新库答案状态
const st = (await pool.query(
  `SELECT answer_status, count(*)::int AS c FROM resource_answers WHERE resource_id=$1::uuid GROUP BY 1 ORDER BY 1`, [WS])).rows
L.push('\n───── 新库 answer_status 分布 ─────')
for (const s of st) L.push(`  ${s.answer_status}: ${s.c}`)

const meta = (await pool.query(
  `SELECT parse_status, parse_count, answer_count, parse_warning, parse_error FROM worksheets WHERE id=$1::uuid`, [WS])).rows[0]
L.push('\n───── 新库 worksheet 状态 ─────')
L.push(`  parse_status=${meta.parse_status} parse_count=${meta.parse_count} answer_count=${meta.answer_count}`)
L.push(`  parse_error=${meta.parse_error || 'null'}`)
L.push(`  parse_warning=${meta.parse_warning || 'null'}`)

const out = 'D:/Minxue_App_V3/_对账-答案册83cf0c4b-20260921.txt'
fs.writeFileSync(out, L.join('\n'), 'utf8')
console.log(L.join('\n'))
console.log('\n→ ' + out)
await pool.end()
