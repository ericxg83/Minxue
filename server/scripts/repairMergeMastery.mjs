/**
 * 修复：批次 2 / 批次 3 合并时「掌握度只删未并」造成的数据丢失
 * ═══════════════════════════════════════════════════════════════
 * 事故（2026-10-07 当晚自查发现）：
 *   写批次 2/3 脚本时，从批次 1 抄了「删掉冲突行 + 重指向」，
 *   却**漏抄了批次 1 的 `UPDATE ... FROM knowledge_mastery d` 数值合并那一步**
 *   ⇒ 同 (student, keep) 冲突的被删行，其 total/correct/wrong/mastery 直接丢了。
 *   受影响：批次 2 删 13 行、批次 3 删 15 行，共 28 行。
 *
 * 修复依据：两次合并的备份里都有**合并前**的 knowledge_mastery 全量行，
 *   且「重指向」（学生只在被合并节点上有行）的那些没丢数据 —— 只有
 *   「学生在保留节点与被合并节点上都有行」的情况才需要补加。
 *
 * ⛔ 默认 dry-run。`--apply` 会先快照当前 knowledge_mastery 再改。
 * 用法：
 *   node server/scripts/repairMergeMastery.mjs
 *   node server/scripts/repairMergeMastery.mjs --apply
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 两次合并的备份（按时间序：先 residual 后 power_cluster）
const files = fs.readdirSync(path.join(ROOT, 'server'))
  .filter(f => /^_backup_kp_merge_(residual|power_cluster)_.*\.json$/.test(f))
  .sort()
if (files.length < 2) { console.error('找不到两份合并备份，中止'); process.exit(1) }
console.log('用到的备份：\n  ' + files.join('\n  '))

// 待补加清单：key = `${studentId}|${keepId}` → 累加值
const add = new Map()
const meta = await pool.query(`SELECT id, name FROM knowledge_points`)
const nameOf = new Map(meta.rows.map(r => [r.id, r.name]))
const stuMeta = await pool.query(`SELECT id, name FROM students`)
const stuName = new Map(stuMeta.rows.map(r => [r.id, r.name]))

for (const f of files) {
  const bak = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', f), 'utf8'))
  const kmBefore = bak.knowledge_mastery || []
  const byKey = new Map(kmBefore.map(r => [`${r.student_id}|${r.kp_id}`, r]))
  for (const p of bak.pairs || []) {
    // 只补「学生在保留节点与被合并节点上都有行」的：只有这种才会被删
    for (const r of kmBefore.filter(x => x.kp_id === p.dropId)) {
      const keepRow = byKey.get(`${r.student_id}|${p.keepId}`)
      if (!keepRow) continue // 属于「重指向」，数据没丢
      const k = `${r.student_id}|${p.keepId}`
      const cur = add.get(k) || { studentId: r.student_id, keepId: p.keepId, total: 0, correct: 0, wrong: 0, weighted: 0 }
      cur.total += r.total_questions || 0
      cur.correct += r.correct_questions || 0
      cur.wrong += r.wrong_questions || 0
      cur.weighted += (r.mastery || 0) * (r.total_questions || 0)
      add.set(k, cur)
    }
  }
}
console.log('')
console.log('需要补加的行：' + add.size + ' 条')
for (const v of add.values()) {
  console.log(`  ${stuName.get(v.studentId) || v.studentId} · ${nameOf.get(v.keepId)}(补 ${v.total} 题：对 ${v.correct} / 错 ${v.wrong})`)
}

// 当前值 → 目标值
const rows = []
for (const v of add.values()) {
  const { rows: r } = await pool.query(
    `SELECT mastery, total_questions, correct_questions, wrong_questions, consecutive_correct, last_practiced_at
       FROM knowledge_mastery WHERE student_id=$1 AND kp_id=$2`, [v.studentId, v.keepId])
  if (!r.length) { console.log(`  ⚠️ 找不到现行使 ${v.studentId}/${nameOf.get(v.keepId)}，跳过`); continue }
  const cur = r[0]
  const total = (cur.total_questions || 0) + v.total
  const mastery = total > 0
    ? ((cur.mastery || 0) * (cur.total_questions || 0) + v.weighted) / total
    : (cur.mastery || 0)
  rows.push({ ...v, cur, next: { total, correct: (cur.correct_questions || 0) + v.correct, wrong: (cur.wrong_questions || 0) + v.wrong, mastery } })
}
console.log('')
console.log('=== 逐行：现在 → 修复后 ===')
for (const x of rows) {
  console.log(`  ${stuName.get(x.studentId)} · ${nameOf.get(x.keepId)}：${x.cur.total_questions} 题 / ${Math.round(x.cur.mastery)}%  →  ${x.next.total} 题 / ${Math.round(x.next.mastery)}%`)
}

if (!APPLY) {
  console.log('')
  console.log('── dry-run 结束，未写库。确认无误后加 --apply ──')
  await pool.end(); process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bakPath = path.join(ROOT, 'server', `_backup_knowledge_mastery_before_repair_${stamp}.json`)
fs.writeFileSync(bakPath, JSON.stringify({ at: new Date().toISOString(), rows: (await pool.query(`SELECT * FROM knowledge_mastery`)).rows }), 'utf8')
console.log('')
console.log('修复前快照 -> ' + path.basename(bakPath))

const client = await pool.connect()
try {
  await client.query('BEGIN')
  let n = 0
  for (const x of rows) {
    const res = await client.query(
      `UPDATE knowledge_mastery
          SET total_questions=$3, correct_questions=$4, wrong_questions=$5, mastery=$6,
              consecutive_correct=GREATEST(COALESCE(consecutive_correct,0), COALESCE($7,0)),
              updated_at=now()
        WHERE student_id=$1 AND kp_id=$2`,
      [x.studentId, x.keepId, x.next.total, x.next.correct, x.next.wrong, x.next.mastery, x.cur.consecutive_correct])
    n += res.rowCount
  }
  await client.query('COMMIT')
  console.log(`✅ 修复 ${n} 行`)
} catch (e) {
  await client.query('ROLLBACK')
  console.log('❌ 已回滚：' + e.message)
  client.release(); await pool.end(); process.exit(1)
}
client.release()

// 复核
const { rows: chk } = await pool.query(`
  SELECT count(*)::int AS rows, count(DISTINCT student_id)::int AS students FROM knowledge_mastery`)
console.log(`复核：掌握度 ${chk[0].rows} 行 / ${chk[0].students} 个学生（行数应不变，仍是合并后的数）`)
const { rows: mcq } = await pool.query(`
  SELECT round(km.mastery::numeric,1) AS m, km.total_questions AS t
    FROM knowledge_mastery km JOIN knowledge_points kp ON kp.id=km.kp_id JOIN students s ON s.id=km.student_id
   WHERE kp.name='幂的运算' AND s.name='毛辰绮'`)
if (mcq.length) console.log(`抽查 毛辰绮·幂的运算：${mcq[0].t} 题 / ${mcq[0].m}%（修复前 21 题 / 59%）`)
await pool.end()
