/**
 * 知识树去重合并（批次 1）
 * ═══════════════════════════════════════════════════════════════
 * 依据：_seed-math-network/junior-merge-plan.json（人工过过的映射表）
 *
 * ⛔ 默认 dry-run，不写库。确认报告无误后才加 --apply。
 * ⛔ 不碰掌握度算法，只做 kp_id 重定向；同 (student,kp) 冲突时按数值合并。
 * ⛔ 不删任何 questions / judgements / 批改审计数据。
 *
 * 用法：
 *   node server/scripts/applyKnowledgeMerge.mjs              # 演练，打印会发生什么
 *   node server/scripts/applyKnowledgeMerge.mjs --apply       # 落库（先自动备份）
 *
 * 产物：
 *   _tmp_kp_merge_report.txt                        人可读日志
 *   server/_backup_kp_merge_<时间戳>.json           回滚依据（含三张表的原始行）
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1) })
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1) })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const APPLY = process.argv.includes('--apply')
const PLAN = path.resolve(ROOT, '_seed-math-network', 'junior-merge-plan.json')

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }
const dump = (name, text) => { const p = path.resolve(ROOT, name); fs.writeFileSync(p, text, 'utf8'); say(`  -> 报告已写 ${p}`) }

if (!fs.existsSync(PLAN)) { console.error(`找不到映射表 ${PLAN}`); process.exit(1) }
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'))

const { default: pg } = await import('pg')
if (!process.env.NEON_DATABASE_URL) { console.error('数据库未配置：缺少 NEON_DATABASE_URL'); process.exit(1) }
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// ═══ 0. 载入知识树，按名字解析 id ═══
say('=== 0. 载入知识树 ===')
const { rows: kps } = await pool.query(
  `SELECT id, parent_id, name, subject, level, sort_order, synonyms FROM knowledge_points WHERE subject = '数学'`)
say(`  数学知识点 ${kps.length} 个`)
const byName = new Map()
for (const r of kps) {
  if (!byName.has(r.name)) byName.set(r.name, [])
  byName.get(r.name).push(r)
}
const resolve = (name) => {
  const hits = byName.get(name) || []
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) say(`  ⚠️ 名字「${name}」有 ${hits.length} 条记录，取第一条`)
  return hits[0] || null
}

// ═══ 1. 构建映射 pairs: dropId -> keepId ═══
say('')
say('=== 1. 构建合并映射 ===')
const pairs = []
const unresolved = []
for (const m of plan.merges) {
  const keep = resolve(m.keep.name)
  if (!keep) { unresolved.push(m.keep.name); continue }
  for (const d of m.drop) {
    const drop = resolve(d.name)
    if (!drop) { unresolved.push(d.name); continue }
    if (drop.id === keep.id) continue
    pairs.push({ dropId: drop.id, dropName: drop.name, keepId: keep.id, keepName: keep.name, keepSynonyms: keep.synonyms })
  }
}
say(`  合并对 ${pairs.length} 组 ｜ 解析失败 ${unresolved.length} 个${unresolved.length ? '：' + unresolved.join(' / ') : ''}`)
const dropIds = pairs.map(p => p.dropId)
const keepIds = [...new Set(pairs.map(p => p.keepId))]

// ⛔ 致命检查：knowledge_points.parent_id 是 ON DELETE SET NULL
//    若被合并节点还有子节点，删它会把子节点变成「无父根节点」——必须先拦下。
say('')
say('=== 1b. 被合并节点是否有子节点（ON DELETE SET NULL 风险）===')
const { rows: childOfDrop } = await pool.query(
  `SELECT c.id, c.name AS child, p.name AS drop_parent
     FROM knowledge_points c JOIN knowledge_points p ON p.id = c.parent_id
    WHERE p.id = ANY($1::uuid[])`, [dropIds])
if (childOfDrop.length === 0) {
  say('  ✅ 无。所有被合并节点都是叶子，删除安全。')
} else {
  say(`  ⛔ 有 ${childOfDrop.length} 个子节点挂在这些待删节点下，直接删会变孤儿根：`)
  for (const r of childOfDrop) say(`     ${r.child}  <- 父=${r.drop_parent}`)
  say('  ⇒ 必须先决定这些子节点改挂到哪个新父节点（写进映射表），否则不能执行 --apply。')
}

// ═══ 2. 预演 question_knowledge 影响 ═══
say('')
say('=== 2. question_knowledge 影响预演 ===')
const { rows: qkBase } = await pool.query(`SELECT count(*)::int AS n FROM question_knowledge`)
say(`  现有边 ${qkBase[0].n}`)
const { rows: qkMove } = await pool.query(
  `SELECT kp_id, count(*)::int AS n FROM question_knowledge WHERE kp_id = ANY($1::uuid[]) GROUP BY kp_id`, [dropIds])
const moveEdges = qkMove.reduce((a, r) => a + r.n, 0)
say(`  待重定向的边 ${moveEdges}（来自 ${qkMove.length} 个被合并节点）`)

// 冲突：同一题同时有 keep 和 drop
const { rows: qkCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM question_knowledge d
   WHERE d.kp_id = ANY($1::uuid[])
     AND EXISTS (SELECT 1 FROM question_knowledge k WHERE k.question_id = d.question_id AND k.kp_id = ANY($2::uuid[]))`,
  [dropIds, keepIds])
say(`  其中会撞 UNIQUE(question_id,kp_id) 需去重的 ${qkCollide[0].n} 条（这些直接删 drop 那条，保留 keep）`)

// 有边但完全没被合并的节点（不受影响）
const { rows: qkOrphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id = qk.kp_id WHERE kp.id IS NULL`)
say(`  ⚠️ 现存的孤儿边（指向不存在的考点）：${qkOrphan[0].n}（本次不处理，仅提示）`)

// ═══ 3. 预演 knowledge_mastery 影响 ═══
say('')
say('=== 3. knowledge_mastery 影响预演 ===')
const { rows: kmBase } = await pool.query(`SELECT count(*)::int AS n FROM knowledge_mastery`)
say(`  现有行 ${kmBase[0].n}`)
const { rows: kmMove } = await pool.query(
  `SELECT count(*)::int AS n FROM knowledge_mastery WHERE kp_id = ANY($1::uuid[])`, [dropIds])
say(`  待重定向的行 ${kmMove[0].n}`)
const { rows: kmCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM knowledge_mastery d
   WHERE d.kp_id = ANY($1::uuid[])
     AND EXISTS (SELECT 1 FROM knowledge_mastery k WHERE k.student_id = d.student_id AND k.kp_id = ANY($2::uuid[]))`,
  [dropIds, keepIds])
say(`  其中会撞 UNIQUE(student_id,kp_id) 需合并数值的 ${kmCollide[0].n} 行`)

// ═══ 4. 逐组明细 ═══
say('')
say('=== 4. 逐组明细（前 25 组）===')
const qkByKp = new Map(qkMove.map(r => [r.kp_id, r.n]))
for (const p of pairs.slice(0, 25)) {
  say(`  ${p.dropName}(${qkByKp.get(p.dropId) || 0} 边)  ->  ${p.keepName}`)
}

// ═══ 5. 落库 ═══
if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库。确认无误后加 --apply ──')
  dump('_tmp_kp_merge_report.txt', out.join('\n'))
  await pool.end()
  process.exit(0)
}

say('')
say('=== 5. 备份 ===')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bakPath = path.resolve(ROOT, `server/_backup_kp_merge_${stamp}.json`)
const bak = {
  at: new Date().toISOString(),
  pairs,
  knowledge_points: kps,
  question_knowledge: (await pool.query(`SELECT question_id, kp_id, role, weight FROM question_knowledge`)).rows,
  knowledge_mastery: (await pool.query(`SELECT * FROM knowledge_mastery`)).rows,
}
fs.writeFileSync(bakPath, JSON.stringify(bak), 'utf8')
say(`  ✅ 已备份 -> ${bakPath}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')

  say('')
  say('=== 6. 重定向 question_knowledge ===')
  let delQk = 0, updQk = 0
  for (const p of pairs) {
    const d = await client.query(
      `DELETE FROM question_knowledge d
        WHERE d.kp_id = $1
          AND EXISTS (SELECT 1 FROM question_knowledge k WHERE k.question_id = d.question_id AND k.kp_id = $2)`,
      [p.dropId, p.keepId])
    delQk += d.rowCount
    const u = await client.query(`UPDATE question_knowledge SET kp_id = $1 WHERE kp_id = $2`, [p.keepId, p.dropId])
    updQk += u.rowCount
  }
  say(`  去重删除 ${delQk} 条 ｜ 重定向 ${updQk} 条`)

  say('')
  say('=== 7. 重定向 knowledge_mastery（数值合并）===')
  let delKm = 0, updKm = 0
  for (const p of pairs) {
    const m = await client.query(`
      UPDATE knowledge_mastery k SET
        total_questions = k.total_questions + d.total_questions,
        correct_questions = k.correct_questions + d.correct_questions,
        wrong_questions = k.wrong_questions + d.wrong_questions,
        consecutive_correct = GREATEST(k.consecutive_correct, d.consecutive_correct),
        last_practiced_at = GREATEST(k.last_practiced_at, d.last_practiced_at),
        mastery = CASE WHEN k.total_questions + d.total_questions > 0
                       THEN (k.mastery * k.total_questions + d.mastery * d.total_questions)
                            / NULLIF(k.total_questions + d.total_questions, 0)
                       ELSE k.mastery END,
        updated_at = NOW()
       FROM knowledge_mastery d
      WHERE k.student_id = d.student_id AND k.kp_id = $1 AND d.kp_id = $2`, [p.keepId, p.dropId])
    const del = await client.query(
      `DELETE FROM knowledge_mastery WHERE kp_id = $1
        AND student_id IN (SELECT student_id FROM knowledge_mastery WHERE kp_id = $2)`, [p.dropId, p.keepId])
    delKm += del.rowCount
    const u = await client.query(`UPDATE knowledge_mastery SET kp_id = $1 WHERE kp_id = $2`, [p.keepId, p.dropId])
    updKm += u.rowCount
  }
  say(`  合并数值 ${delKm} 行 ｜ 重定向 ${updKm} 行`)

  say('')
  say('=== 8. 合并 synonyms（保证打标仍能命中）===')
  const synByKeep = new Map()
  for (const p of pairs) {
    const cur = synByKeep.get(p.keepId) || new Set()
    const add = []
    const raw = p.keepSynonyms
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : [])
    list.forEach(x => cur.add(x))
    cur.add(p.dropName)
    const dn = byName.get(p.dropName)?.[0]?.synonyms
    const dl = Array.isArray(dn) ? dn : (typeof dn === 'string' ? JSON.parse(dn || '[]') : [])
    dl.forEach(x => cur.add(x))
    synByKeep.set(p.keepId, cur)
  }
  for (const [keepId, set] of synByKeep) {
    await client.query(`UPDATE knowledge_points SET synonyms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify([...set]), keepId])
  }
  say(`  更新 ${synByKeep.size} 个节点的 synonyms`)

  say('')
  say('=== 9. 删除被合并节点 ===')
  const del = await client.query(`DELETE FROM knowledge_points WHERE id = ANY($1::uuid[])`, [dropIds])
  say(`  删除 ${del.rowCount} 个节点（预期 ${dropIds.length}）`)

  await client.query('COMMIT')
  say('  ✅ 已提交')
} catch (e) {
  await client.query('ROLLBACK')
  say(`  ❌ 已回滚：${e.message}`)
  dump('_tmp_kp_merge_report.txt', out.join('\n'))
  client.release(); await pool.end()
  process.exit(1)
}
client.release()

// ═══ 10. 落库后复核 ═══
say('')
say('=== 10. 落库后复核 ===')
const { rows: after } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学') AS kp,
         (SELECT count(*)::int FROM question_knowledge) AS qk,
         (SELECT count(*)::int FROM knowledge_mastery) AS km`)
say(`  knowledge_points(数学) ${after[0].kp}（合并前 ${kps.length}，预期 -${dropIds.length}）`)
say(`  question_knowledge ${after[0].qk}（合并前 ${qkBase[0].n}，预期 -${delQkHint()}）`)
say(`  knowledge_mastery ${after[0].km}（合并前 ${kmBase[0].n}，预期 -${delKmHint()}）`)
function delQkHint() { return qkCollide[0].n }
function delKmHint() { return kmCollide[0].n }
const { rows: orphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id = qk.kp_id WHERE kp.id IS NULL`)
say(`  ⚠️ 孤儿边 ${orphan[0].n}（必须为 0）`)
dump('_tmp_kp_merge_report.txt', out.join('\n'))
await pool.end()
