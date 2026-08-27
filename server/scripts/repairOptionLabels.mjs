/**
 * 一次性数据修复（默认 dry-run，加 --apply 才落库）
 *
 * 修历史脏 options：AI 识别把试卷原印的标号一起转录进了选项正文
 * （如 ["(A) 3/4","(B) 4/3"]），而展示层又按下标补一个 "A."，
 * 渲染成 "A. (A) 3/4"。约定改为 options 只存正文、标号由展示层生成，
 * 这里把已入库的三张表刷成新约定：
 *   1) questions.options
 *   2) question_cache.options —— 同时重算 question_fingerprint。
 *      指纹算法已改为先剥标号再哈希，旧行的指纹是按脏文本算的，
 *      不重算的话这些缓存再也命中不了，会白白重新调一次 AI。
 *   3) variant_questions.options
 *
 * 幂等：normalizeOptions 对已清洗的数据是恒等变换，只在「与目标值不同」时才写。
 * 用法：node server/scripts/repairOptionLabels.mjs [--apply]
 */
import dotenv from 'dotenv'
import pg from 'pg'
import fs from 'node:fs/promises'
import { normalizeOptions } from '../utils/optionText.js'
import { generateTextFingerprint, PARSER_VERSION } from '../utils/questionFingerprint.js'

// 连接串在 server/.env，脚本从仓库根目录跑也要能读到
dotenv.config({ path: new URL('../.env', import.meta.url) })

const APPLY = process.argv.includes('--apply')

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (t, p) => pool.query(t, p).then(r => r.rows)

// generateTextFingerprint 对每个选项都打一行日志，全表扫描会淹掉输出
const quiet = (fn) => {
  const log = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = log }
}

const asArray = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

const diffOf = (rows) => {
  const out = []
  for (const r of rows) {
    const before = asArray(r.options)
    if (!before || before.length === 0) continue
    const after = normalizeOptions(before)
    if (JSON.stringify(after) === JSON.stringify(before)) continue
    out.push({ ...r, before, after })
  }
  return out
}

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 扫描三张表的 options\n`)

// ── 1. questions ──
const qRows = await q(
  `SELECT id, task_id, question_number, question_type, options
   FROM questions WHERE deleted_at IS NULL AND options IS NOT NULL`
)
const qFixes = diffOf(qRows)
console.log(`── questions: ${qFixes.length} / ${qRows.length} 道题的 options 带标号 ──`)
for (const f of qFixes.slice(0, 5)) {
  console.log(`  任务 ${String(f.task_id).slice(0, 8)} 第${f.question_number}题`)
  console.log(`    ${JSON.stringify(f.before)}`)
  console.log(`    → ${JSON.stringify(f.after)}`)
}
if (qFixes.length > 5) console.log(`  …其余 ${qFixes.length - 5} 道同理`)

// ── 2. question_cache（options + 指纹）──
const cRows = await q(
  `SELECT id, question_fingerprint, content, content_type, question_type, options, parser_version, use_count
   FROM question_cache WHERE options IS NOT NULL`
)
const cFixes = []
const cSkipped = []
for (const f of diffOf(cRows)) {
  const newFp = quiet(() => generateTextFingerprint(f.content, f.before, f.question_type))
  if (!newFp) { cSkipped.push({ ...f, why: '指纹计算失败' }); continue }
  if (newFp === f.question_fingerprint) { cFixes.push({ ...f, newFp: null }); continue }
  const clash = await q(
    `SELECT id FROM question_cache WHERE question_fingerprint = $1 AND parser_version = $2 AND id <> $3`,
    [newFp, f.parser_version || PARSER_VERSION, f.id]
  )
  if (clash.length > 0) { cSkipped.push({ ...f, why: `新指纹与 ${String(clash[0].id).slice(0, 8)} 撞车` }); continue }
  cFixes.push({ ...f, newFp })
}
const fpChanges = cFixes.filter(f => f.newFp).length
console.log(`\n── question_cache: ${cFixes.length} / ${cRows.length} 条待清洗，其中 ${fpChanges} 条需重算指纹 ──`)
for (const f of cFixes.slice(0, 5)) {
  console.log(`  缓存 ${String(f.id).slice(0, 8)} 用过${f.use_count}次  ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`)
  if (f.newFp) console.log(`    指纹 ${f.question_fingerprint.slice(0, 16)}… → ${f.newFp.slice(0, 16)}…`)
}
if (cFixes.length > 5) console.log(`  …其余 ${cFixes.length - 5} 条同理`)
if (cSkipped.length) {
  console.log(`  ⚠️ 跳过 ${cSkipped.length} 条：`)
  for (const s of cSkipped.slice(0, 5)) console.log(`     ${String(s.id).slice(0, 8)} — ${s.why}`)
}

// ── 3. variant_questions ──
const vRows = await q(`SELECT id, source_question_id, options FROM variant_questions WHERE options IS NOT NULL`)
const vFixes = diffOf(vRows)
console.log(`\n── variant_questions: ${vFixes.length} / ${vRows.length} 条变式题的 options 带标号 ──`)
for (const f of vFixes.slice(0, 3)) {
  console.log(`  变式 ${String(f.id).slice(0, 8)}  ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`)
}
if (vFixes.length > 3) console.log(`  …其余 ${vFixes.length - 3} 条同理`)

const total = qFixes.length + cFixes.length + vFixes.length
if (!APPLY) {
  console.log(`\n合计 ${total} 处待修复。（dry-run，未写库。确认无误后加 --apply）`)
  await pool.end()
  process.exit(0)
}
if (total === 0) {
  console.log('\n没有需要修复的数据。')
  await pool.end()
  process.exit(0)
}

// ── 落库 ──
const backup = {
  at: new Date().toISOString(),
  questions: qFixes.map(f => ({ id: f.id, options: f.before })),
  question_cache: cFixes.map(f => ({ id: f.id, options: f.before, question_fingerprint: f.question_fingerprint })),
  variant_questions: vFixes.map(f => ({ id: f.id, options: f.before })),
}
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
const backupPath = new URL(`./logs/repair-option-labels-${Date.now()}.json`, import.meta.url)
await fs.writeFile(backupPath, JSON.stringify(backup, null, 1), 'utf8')
console.log(`\n💾 回滚快照: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const f of qFixes) {
    await client.query(`UPDATE questions SET options = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [f.id, JSON.stringify(f.after)])
  }
  for (const f of cFixes) {
    await client.query(
      `UPDATE question_cache SET options = $2::jsonb,
              question_fingerprint = COALESCE($3, question_fingerprint), updated_at = NOW()
       WHERE id = $1`,
      [f.id, JSON.stringify(f.after), f.newFp]
    )
  }
  for (const f of vFixes) {
    await client.query(`UPDATE variant_questions SET options = $2::jsonb WHERE id = $1`,
      [f.id, JSON.stringify(f.after)])
  }
  await client.query('COMMIT')
  console.log(`\n✅ 已提交：questions ${qFixes.length} 处、question_cache ${cFixes.length} 处（含 ${fpChanges} 条指纹）、variant_questions ${vFixes.length} 处`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
