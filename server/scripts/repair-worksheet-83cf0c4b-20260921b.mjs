/**
 * 修复（2026-09-21 第二轮）：答案册 83cf0c4b《八上精练与拓展》重解析后残留的两类问题
 *
 * 背景：修完「标题漏识别」与「行内误拆」后重解析，管理端仍有 2 处告警。
 *   排查发现是**两次独立问题叠加**：
 *
 * ① 伪单元「试卷 / 试卷(十四)期末测试卷」（34 条）——**OCR 幻觉**
 *    本轮重解析时魔搭视觉模型配额耗尽（日志：Qwen3.5-122B-A10B / Qwen3.8-27B /
 *    Intern-S2-Preview 三模型均“当日配额已用尽”），降级链仍返回了内容，而其中一页
 *    被**编造**成一整套“道德与法治”答案（“友谊是一种亲密的关系”“老师的表扬和批评”…
 *    含 一、单项选择题 / 二、简答题 / 三、分析说明题 / 四、探究实践题 四个大题组）。
 *    已渲染 PDF p43/p44 取证：该册**全篇数学**（“初中数学精练与拓展 八年级上册”），
 *    无任何政治内容 → 34 条全部是伪造，必须删除。
 *    判据（可复现）：库内键不在「首轮干净 OCR + 修复后解析器」的离线结果键集里。
 *
 * ② 6 条 OCR 读错的答案值 —— 本轮与首轮 OCR **各有个别读错**，逐条渲染 PDF 原页裁定：
 *    期中练习  q9      x > 2.025      → x > 2025         （PDF p39「x > 2 025」）
 *    期末练习  q12     x ⩾ 2.025      → x ⩾ 2025         （PDF p41「x ⩾ 2 025」）
 *    期末练习  q16     3x(x-1)=6·210   → 3x(x-1)=6210     （PDF p41「3x(x−1)=6 210」；
 *                                                          3x(x−1)=6210 ⇒ x=46 整数解）
 *    22.1(1)   q11     2x+2x+x=180    → 2x+2x+x=90       （PDF p27；且 5x=90 ⇒ x=18 自洽）
 *    22.3(3)   q11(1)  20 m.          → 120 m.           （PDF p35「(1) 120 m.」）
 *    21.4(1)   q8      -2√2           → -2√2; 1.         （PDF p17「8. −2√2 ; 1.」）
 *    根因见脚本内 THIN_SPACE 注释：本书用**细空格**做千分位（同页「2 025」），
 *    OCR 时而被读成空格、时而被读成小数点。
 *
 * 用法：
 *   预演（默认，不改库）：node server/scripts/repair-worksheet-83cf0c4b-20260921b.mjs
 *   执行：                node server/scripts/repair-worksheet-83cf0c4b-20260921b.mjs --apply
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })
const WS = '83cf0c4b-ca07-46dd-b9ca-fc5ffdb6be45'
const APPLY = process.argv.includes('--apply')
const REF = resolve(__dirname, '..', '..', '_basj_offline_fixed5.json')

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// ── 逐条裁定表（old 用于幂等前置校验：值对不上就跳过并告警，避免误改） ──
const FIXES = [
  { unit: '期中练习', q: 9, sub: '', old: '$x > 2.025$', next: '$x > 2025$', ev: 'PDF p39 「9. x > 2 025.」' },
  { unit: '期末练习', q: 12, sub: '', old: '$x \\geqslant 2.025$', next: '$x \\geqslant 2025$', ev: 'PDF p41 「12. x ⩾ 2 025.」' },
  { unit: '期末练习', q: 16, sub: '', old: '$3x(x-1)=6 \\cdot 210$', next: '$3x(x-1)=6210$', ev: 'PDF p41 「16. 3x(x−1)=6 210.」' },
  { unit: '22.1(1)', q: 11, sub: '', from: /2x\+2x\+x=180/, next: '∠ADC=72°. 提示：设∠1=x°，则∠2=2x°. 由题意，得∠B=∠2=2x°. 故2x+2x+x=90，解得x=18.', ev: 'PDF p27 「故 2x+2x+x=90，解得 x=18」' },
  { unit: '22.3(3)', q: 11, sub: '1', old: '20 m.', next: '120 m.', ev: 'PDF p35 「11. (1) 120 m.」' },
  { unit: '21.4(1)', q: 8, sub: '', old: '-2$\\sqrt{2}$', next: '$-2\\sqrt{2}$; 1.', ev: 'PDF p17 「8. −2√2 ; 1.」' },
]

// ── ① 幻觉行过滤：库内键不在离线参考键集里 ⇒ 删除 ──
const ref = JSON.parse(fs.readFileSync(REF, 'utf8'))
const refKeys = new Set(ref.answers.map(a => `${a.unit_key || ''}|${a.question_no}|${a.sub_no || ''}|${a.section || ''}`))

const units = (await pool.query(`SELECT id, unit_key, unit_title FROM resource_units WHERE resource_id=$1::uuid`, [WS])).rows
const all = (await pool.query(
  `SELECT id, unit_id, question_no, sub_no, section, answer FROM resource_answers WHERE resource_id=$1::uuid`, [WS])).rows
const unitOf = new Map(units.map(u => [u.id, u.unit_key]))

const fabricated = all.filter(a => !refKeys.has(`${unitOf.get(a.unit_id) || ''}|${a.question_no}|${a.sub_no || ''}|${a.section || ''}`))
const fabUnits = [...new Set(fabricated.map(a => unitOf.get(a.unit_id)))]

console.log('══════ 答案册 83cf0c4b 修复（第二轮） ══════')
console.log(`模式：${APPLY ? '★ 执行（改库）' : '预演（不改库）'}`)
console.log()
console.log(`【① 幻觉行过滤】库内 ${all.length} 条 / 参考键集 ${refKeys.size} 条`)
console.log(`  命中 ${fabricated.length} 条，涉及单元：${fabUnits.map(u => `${u}(${fabricated.filter(a => unitOf.get(a.unit_id) === u).length}条)`).join(', ') || '无'}`)
for (const u of fabUnits) {
  const r = units.find(x => x.unit_key === u)
  console.log(`    unit_key=${JSON.stringify(u)}  unit_title=${JSON.stringify(r?.unit_title)}`)
}
if (fabricated.length) {
  console.log('  样例（前 3 条）：')
  for (const a of fabricated.slice(0, 3)) console.log(`    q${a.question_no} ${String(a.answer).replace(/\n/g, ' ').slice(0, 60)}`)
}
console.log()

// ── ② 逐条答案值修正 ──
console.log('【② 逐条答案修正】')
const plan = []
for (const f of FIXES) {
  const rows = all.filter(a => unitOf.get(a.unit_id) === f.unit && Number(a.question_no) === f.q && (a.sub_no || '') === f.sub)
  if (rows.length !== 1) { console.log(`  ⚠ ${f.unit} q${f.q}${f.sub ? '(' + f.sub + ')' : ''} 匹配 ${rows.length} 行，跳过`); continue }
  const cur = String(rows[0].answer)
  const matches = f.from ? f.from.test(cur) : cur === f.old
  if (!matches) { console.log(`  ⚠ ${f.unit} q${f.q}${f.sub ? '(' + f.sub + ')' : ''} 现值与预期不符，跳过（现值：${JSON.stringify(cur.slice(0, 50))}）`); continue }
  plan.push({ id: rows[0].id, ...f, cur })
  console.log(`  ✓ ${f.unit} q${f.q}${f.sub ? '(' + f.sub + ')' : ''}`)
  console.log(`      ${JSON.stringify(cur.slice(0, 70))}`)
  console.log(`   →  ${JSON.stringify(f.next.slice(0, 70))}`)
  console.log(`      依据：${f.ev}`)
}
console.log()

if (!APPLY) { console.log('预演结束，未改库。加 --apply 执行。'); await pool.end(); process.exit(0) }

// ── 备份 ──
const dir = resolve(__dirname, '..', 'backups')
fs.mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
const bf = resolve(dir, `worksheet-83cf0c4b-before-repair2-${stamp}.json`)
fs.writeFileSync(bf, JSON.stringify({ units, answers: all }, null, 1), 'utf8')
console.log(`备份 → ${bf}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  // ① 删幻觉答案 + 空出来的单元
  if (fabricated.length) {
    await client.query(`DELETE FROM resource_answers WHERE id = ANY($1::uuid[])`, [fabricated.map(a => a.id)])
    console.log(`① 已删除 ${fabricated.length} 条幻觉答案`)
  }
  for (const u of fabUnits) {
    const left = await client.query(`SELECT count(*) n FROM resource_answers WHERE unit_id = $1::uuid`, [units.find(x => x.unit_key === u).id])
    if (Number(left.rows[0].n) === 0) {
      await client.query(`DELETE FROM resource_units WHERE id = $1::uuid`, [units.find(x => x.unit_key === u).id])
      console.log(`   已删除空单元 ${u}`)
    } else {
      console.log(`   ⚠ 单元 ${u} 仍有 ${left.rows[0].n} 条答案，保留`)
    }
  }
  // ② 答案值修正
  for (const p of plan) {
    await client.query(`UPDATE resource_answers SET answer = $2 WHERE id = $1::uuid`, [p.id, p.next])
  }
  console.log(`② 已修正 ${plan.length} 条答案`)
  // ③ 重算 answer_count（禁裸 CASE，仅计数）
  const cnt = await client.query(
    `UPDATE worksheets w SET answer_count = (SELECT count(*) FROM resource_answers WHERE resource_id = w.id),
            parse_status = 'done', parse_warning = NULL, parse_error = NULL
     WHERE w.id = $1::uuid RETURNING answer_count, parse_status, parse_warning`, [WS])
  console.log(`③ 已同步 worksheet：${JSON.stringify(cnt.rows[0])}`)
  await client.query('COMMIT')
  console.log('\n✅ 修复完成')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 失败已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
