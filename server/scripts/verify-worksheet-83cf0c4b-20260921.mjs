/**
 * 验收（2026-09-21 第二轮）：答案册 83cf0c4b《八上精练与拓展》是否"零告警 + 零缺号"
 *
 * 判据（每一条都是硬门槛，任一不过即不算修好）：
 *   ① parse_warning 为 null（管理端不再弹任何告警）
 *   ② 每个单元的题号必须是 1..max 连续无缺口
 *   ③ 无伪单元（unit_key 形如 "N.0" / 答案行被读成的课时号）
 *   ④ 关键单元逐条与 PDF 原页吻合（20.2(4) 第1题=B、习题20.2、单元练习二十…）
 *   ⑤ 与**权威基准**（_basj_offline_fixed5.json：首轮干净 OCR + 修复后解析器）键集对照，
 *      确认无缺失、无多余（基准内 OCR 占位行走 KNOWN_GHOST 白名单）
 *
 * 用法：node server/scripts/verify-worksheet-83cf0c4b-20260921.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })
const WS = '83cf0c4b-ca07-46dd-b9ca-fc5ffdb6be45'
const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(`--${n}=`.length) || d
const beforeTag = arg('before', 'mid-930')

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const meta = (await pool.query(
  `SELECT parse_status, parse_count, answer_count, parse_warning, parse_error,
          parse_total_pages, parse_done_pages
   FROM worksheets WHERE id = $1::uuid`, [WS])).rows[0]
const rows = (await pool.query(
  `SELECT ru.unit_key, ru.unit_seq, ra.question_no, ra.sub_no, ra.answer, ra.answer_type
   FROM resource_answers ra JOIN resource_units ru ON ru.id = ra.unit_id
   WHERE ra.resource_id = $1::uuid
   ORDER BY ru.unit_seq NULLS LAST, ra.question_no NULLS LAST, ra.sub_no NULLS LAST`, [WS])).rows
const statusRows = (await pool.query(
  `SELECT answer_status, count(*) n FROM resource_answers WHERE resource_id = $1::uuid GROUP BY 1`, [WS])).rows
await pool.end()

const byUnit = new Map()
for (const r of rows) {
  if (!byUnit.has(r.unit_key)) byUnit.set(r.unit_key, [])
  byUnit.get(r.unit_key).push(r)
}

const out = []
const say = (s = '') => { out.push(s); console.log(s) }
let fail = 0

say('══════ 答案册 83cf0c4b《八上精练与拓展》验收 ══════')
say(`parse_status=${meta.parse_status}  parse_count=${meta.parse_count}  answer_count=${meta.answer_count}`)
say(`页数 ${meta.parse_done_pages}/${meta.parse_total_pages}   parse_error=${meta.parse_error}`)
say(`answer_status 分布: ${statusRows.map(r => `${r.answer_status}=${r.n}`).join('  ')}`)
say()

// ── ① parse_warning 必须为空 ──
say('【① 管理端告警】')
if (meta.parse_warning) {
  fail++
  say(`  ✗ 仍有告警：${meta.parse_warning}`)
} else {
  say('  ✓ parse_warning = null（管理端零告警）')
}
say()

// ── ② 逐单元题号连续性 ──
say(`【② 题号连续性】共 ${byUnit.size} 个单元`)
const bad = []
for (const [k, list] of byUnit) {
  const qs = [...new Set(list.map(x => Number(x.question_no)).filter(Number.isFinite))].sort((a, b) => a - b)
  if (!qs.length) { bad.push({ k, why: '无题号' }); continue }
  const missing = []
  for (let i = 1; i <= qs[qs.length - 1]; i++) if (!qs.includes(i)) missing.push(i)
  if (qs[0] !== 1) missing.unshift(`起点不是1(${qs[0]})`)
  if (missing.length) bad.push({ k, why: `缺 ${missing.join(',')}`, max: qs[qs.length - 1] })
}
if (bad.length) {
  fail++
  say(`  ✗ ${bad.length} 个单元仍有缺口：`)
  for (const b of bad) say(`      ${b.k}  ${b.why}`)
} else {
  say('  ✓ 全部单元题号 1..max 连续无缺口')
}
say()

// ── ③ 伪单元 ──
say('【③ 伪单元检查】')
const fake = [...byUnit.keys()].filter(k => /^\d{1,2}\.\d$/.test(k) && /\.0$/.test(k) || /^(18\.1|22\.0)$/.test(k))
if (fake.length) { fail++; say(`  ✗ 存在伪单元：${fake.join(', ')}`) } else { say('  ✓ 无训练册伪课时号单元（18.1 / 22.0 等）') }
say()

// ── ④ 关键单元与 PDF 原页对照（值来自 PDF 逐字核对）──
say('【④ 关键单元 × PDF 原页】')
const expect = [
  { unit: '20.2(4)', max: 14, q1: /^B\.?$/ },
  { unit: '习题20.2', max: 14, q1: /^B\.?$/ },
  { unit: '单元练习二十', q1: /^D\.?$/ },
  { unit: '21.5(3)', max: 13 },
  { unit: '习题22.2', max: 13 },
  { unit: '22.3(2)', q4: /5\s*[√]?2|√2/ },
  { unit: '期中练习' },
  { unit: '期末练习' },
]
for (const e of expect) {
  const list = byUnit.get(e.unit)
  if (!list) { fail++; say(`  ✗ 单元「${e.unit}」不存在`); continue }
  const qs = [...new Set(list.map(x => Number(x.question_no)))].sort((a, b) => a - b)
  const max = qs[qs.length - 1]
  const notes = []
  if (e.max && max !== e.max) { fail++; notes.push(`最大题号 ${max} ≠ 期望 ${e.max}`) }
  const q1 = list.find(x => Number(x.question_no) === 1)
  if (e.q1 && !e.q1.test(String(q1?.answer || ''))) { fail++; notes.push(`第1题答案 "${q1?.answer}" 不匹配 ${e.q1}`) }
  const q4 = list.find(x => Number(x.question_no) === 4)
  if (e.q4 && !e.q4.test(String(q4?.answer || ''))) { fail++; notes.push(`第4题答案 "${q4?.answer}" 不匹配 ${e.q4}`) }
  say(`  ${notes.length ? '✗' : '✓'} ${e.unit.padEnd(12)} 题号 1..${max}（${list.length}行） 第1题=${JSON.stringify(String(q1?.answer || '').slice(0, 12))}${notes.length ? '  ← ' + notes.join('；') : ''}`)
}
say()

// ── ⑤ 与权威基准（离线 fixed5：首轮干净 OCR + 修复后解析器）的键集对照 ──
// 说明：早期版本用「上一轮中途快照 mid-930」当基准，那是中途态、会误报"答案消失"；
//      判定"有没有真丢答案"必须用确定性基准。基准里的 OCR 占位行（如 p44 整页 OCR 只
//      返回「25. 详见解析」）不算真答案，列入 KNOWN_GHOST 白名单。
const KNOWN_GHOST = new Set(['期末练习|25|'])   // p44 整页 OCR 失败产生的占位行，非真实答案
const refFile = resolve(__dirname, '..', '..', '_basj_offline_fixed5.json')
if (fs.existsSync(refFile)) {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'))
  const refKeys = new Set(ref.answers.map(a => `${a.unit_key}|${a.question_no}|${a.sub_no || ''}`))
  const dbKeys = new Set(rows.map(a => `${a.unit_key}|${a.question_no}|${a.sub_no || ''}`))
  const missing = [...refKeys].filter(k => !dbKeys.has(k) && !KNOWN_GHOST.has(k))
  const extra = [...dbKeys].filter(k => !refKeys.has(k))
  say(`【⑤ 与权威基准对照】基准 ${refFile.split(/[\\/]/).pop()}（${ref.units.length} 单元 / ${ref.answers.length} 答案）`)
  say(`  库内 ${byUnit.size} 单元 / ${rows.length} 答案`)
  say(`  库内缺 ${missing.length} 条，库内多 ${extra.length} 条`)
  if (missing.length) { fail++; say(`  ✗ 有答案缺失：${missing.join(', ')}`) }
  if (extra.length) { fail++; say(`  ✗ 有基准外的答案：${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ' …' : ''}`) }
  if (!missing.length && !extra.length) say('  ✓ 键集与权威基准完全一致（无缺失、无多余）')
  say()
} else {
  say(`【⑤】未找到基准 ${refFile}，跳过`)
  say()
}

say(fail === 0 ? '══════ 全部通过：这本答案册已可用，可以发布 ══════' : `══════ 仍有 ${fail} 项未通过 ══════`)

const outFile = resolve(__dirname, '..', '..', '_验收-答案册83cf0c4b-20260921b.txt')
fs.writeFileSync(outFile, out.join('\n'), 'utf8')
console.log(`\n报告 → ${outFile}`)
process.exit(fail === 0 ? 0 : 1)
