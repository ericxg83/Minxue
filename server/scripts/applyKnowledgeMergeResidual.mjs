/**
 * 知识树残留近义节点合并（批次 2）
 * ═══════════════════════════════════════════════════════════════
 * 背景（2026-10-07 取证，见交接文档 §9.6 遗留②）：上一轮去重只去了**同名**节点，
 * 还剩「不同名但同技能」的：
 *   · 合并同类项(50 题 / 12 掌握度行) ← 同类项合并(17 题 / 5 行)     重叠 2 题
 *   · 分数加减法(49 题 / 5 行) ← 分数的加减运算(4 题 / 3 行)         重叠 1 题
 *   · 小数与分数的互化(16 题 / 7 行) ← 分数与小数的互化(13 题 / 7 行) 重叠 0 题
 *
 * ⛔ 幂的运算 / 指数运算 / 指数法则 / 指数与根式的运算 **本轮不合并**：
 *    取证看到它们挂的题是混的（「幂的运算」下面挂二次根式加减、「指数运算」下面挂整式除法），
 *    问题是打标噪声而不是节点重复；合并只会造出一个更大的筐，把噪声藏得更深。
 *
 * ⛔ 默认 dry-run。`--apply` 前自动备份，失败整体回滚。
 * ⛔ 动到的表（比批次 1 多 3 张，批次 1 时代还没有 kp_relations / 考法表）：
 *    question_knowledge / knowledge_mastery / kp_relations（from+to）
 *    / teaching_question_type_kps / teaching_question_types / variant_questions
 *    / knowledge_points(parent_id + synonyms)
 * ⛔ 被合并节点的名字会写进保留节点的 synonyms，保证以后打标仍能命中。
 *
 * 用法：
 *   node server/scripts/applyKnowledgeMergeResidual.mjs           # 演练
 *   node server/scripts/applyKnowledgeMergeResidual.mjs --apply    # 落库
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1) })

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const { default: pg } = await import('pg')
if (!process.env.NEON_DATABASE_URL) { console.error('数据库未配置：缺少 NEON_DATABASE_URL'); process.exit(1) }
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

/** 合并计划：drop 全部并入 keep（keep 选取口径 = 挂载题多的那个） */
const PLAN = [
  { keep: '合并同类项', drops: ['同类项合并'] },
  { keep: '分数加减法', drops: ['分数的加减运算'] },
  { keep: '小数与分数的互化', drops: ['分数与小数的互化'] },
]

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }
const dump = () => fs.writeFileSync(path.join(ROOT, '_tmp_kp_merge_residual_report.txt'), out.join('\n'), 'utf8')

// ═══ 0. 解析节点 ═══
const { rows: kps } = await pool.query(
  `SELECT id, name, parent_id, level, subject, archived, synonyms FROM knowledge_points WHERE subject='数学' AND archived=false`)
const byName = new Map(kps.map(r => [r.name, r]))
const pairs = []
for (const p of PLAN) {
  const keep = byName.get(p.keep)
  if (!keep) { console.error(`解析失败：keep「${p.keep}」不存在`); process.exit(1) }
  for (const d of p.drops) {
    const drop = byName.get(d)
    if (!drop) { console.error(`解析失败：drop「${d}」不存在`); process.exit(1) }
    pairs.push({ keep, drop })
  }
}
const dropIds = pairs.map(p => p.drop.id)
const keepIds = [...new Set(pairs.map(p => p.keep.id))]
say(`合并对 ${pairs.length} 组：` + pairs.map(p => `${p.drop.name} → ${p.keep.name}`).join('；'))

// ═══ 1. 前置安全体检 ═══
say('')
say('=== 1. 安全体检 ===')
const { rows: kids } = await pool.query(
  `SELECT c.name AS child, p.name AS parent FROM knowledge_points c JOIN knowledge_points p ON p.id=c.parent_id
    WHERE p.id = ANY($1::uuid[])`, [dropIds])
say(`  被合并节点的子节点：${kids.length} 个${kids.length ? '（' + kids.map(k => k.child).join('/') + '，会改挂到保留节点）' : ' ✅'}`)

for (const t of ['question_knowledge', 'knowledge_mastery', 'teaching_question_type_kps', 'teaching_question_types', 'variant_questions']) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE kp_id = ANY($1::uuid[])`, [dropIds])
  say(`  ${t} 待处理 ${rows[0].n} 行`)
}
const { rows: relN } = await pool.query(
  `SELECT count(*)::int AS n FROM kp_relations WHERE from_kp_id = ANY($1::uuid[]) OR to_kp_id = ANY($1::uuid[])`, [dropIds])
say(`  kp_relations 待处理 ${relN[0].n} 行`)
// 成对互指（合并后会变自环，必须删）
const { rows: selfPair } = await pool.query(`
  SELECT count(*)::int AS n FROM kp_relations r
   WHERE (r.from_kp_id = ANY($1::uuid[]) AND r.to_kp_id = ANY($2::uuid[]))
      OR (r.from_kp_id = ANY($2::uuid[]) AND r.to_kp_id = ANY($1::uuid[]))`, [dropIds, keepIds])
say(`  两节点之间的互指边（合并后会变自环）：${selfPair[0].n} 条 —— 直接删`)

// 冲突预演
const { rows: qkCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM question_knowledge d
   WHERE d.kp_id = ANY($1::uuid[])
     AND EXISTS (SELECT 1 FROM question_knowledge k WHERE k.question_id = d.question_id AND k.kp_id = ANY($2::uuid[]))`,
  [dropIds, keepIds])
const { rows: kmCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM knowledge_mastery d
   WHERE d.kp_id = ANY($1::uuid[])
     AND EXISTS (SELECT 1 FROM knowledge_mastery k WHERE k.student_id = d.student_id AND k.kp_id = ANY($2::uuid[]))`,
  [dropIds, keepIds])
const { rows: relCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM kp_relations d
   WHERE (d.from_kp_id = ANY($1::uuid[]) OR d.to_kp_id = ANY($1::uuid[]))
     AND EXISTS (SELECT 1 FROM kp_relations k WHERE k.from_kp_id = ANY($2::uuid[]) AND k.to_kp_id = ANY($2::uuid[])
                  AND k.relation = d.relation AND k.from_kp_id <> d.from_kp_id)`, [dropIds, keepIds])
const { rows: tqtCollide } = await pool.query(`
  SELECT count(*)::int AS n FROM teaching_question_type_kps d
   WHERE d.kp_id = ANY($1::uuid[])
     AND EXISTS (SELECT 1 FROM teaching_question_type_kps k WHERE k.type_id = d.type_id AND k.kp_id = ANY($2::uuid[]))`,
  [dropIds, keepIds])
say(`  撞唯一键需去重的：question_knowledge ${qkCollide[0].n} ｜ knowledge_mastery ${kmCollide[0].n} ｜ kp_relations ${relCollide[0].n} ｜ 考法关联 ${tqtCollide[0].n}`)

const { rows: before } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND archived=false) AS kp,
         (SELECT count(*)::int FROM question_knowledge) AS qk,
         (SELECT count(*)::int FROM knowledge_mastery) AS km,
         (SELECT count(*)::int FROM kp_relations) AS rel`)
say(`  当前：知识点 ${before[0].kp} ｜ 关联边 ${before[0].qk} ｜ 掌握度行 ${before[0].km} ｜ 前置关系 ${before[0].rel}`)

if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库。确认无误后加 --apply ──')
  dump()
  await pool.end(); process.exit(0)
}

// ═══ 2. 备份 ═══
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bakPath = path.join(ROOT, 'server', `_backup_kp_merge_residual_${stamp}.json`)
fs.writeFileSync(bakPath, JSON.stringify({
  at: new Date().toISOString(),
  plan: PLAN,
  pairs: pairs.map(p => ({ dropId: p.drop.id, dropName: p.drop.name, keepId: p.keep.id, keepName: p.keep.name })),
  knowledge_points: (await pool.query(`SELECT * FROM knowledge_points`)).rows,
  question_knowledge: (await pool.query(`SELECT * FROM question_knowledge`)).rows,
  knowledge_mastery: (await pool.query(`SELECT * FROM knowledge_mastery`)).rows,
  kp_relations: (await pool.query(`SELECT * FROM kp_relations`)).rows,
  teaching_question_type_kps: (await pool.query(`SELECT * FROM teaching_question_type_kps`)).rows,
  variant_questions: (await pool.query(`SELECT id, kp_id FROM variant_questions`)).rows,
}, null, 2), 'utf8')
say('')
say('备份 -> ' + path.basename(bakPath))

// ═══ 3. 事务落库 ═══
const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const { keep, drop } of pairs) {
    say('')
    say(`── ${drop.name} → ${keep.name} ──`)

    // 3.1 成对互指的前置关系（合并后是自环）
    const selfDel = await client.query(
      `DELETE FROM kp_relations WHERE (from_kp_id=$1 AND to_kp_id=$2) OR (from_kp_id=$2 AND to_kp_id=$1)`,
      [drop.id, keep.id])
    // 3.2 kp_relations：先删会撞唯一键的 drop 行，再重指向
    const relDelFrom = await client.query(`
      DELETE FROM kp_relations d WHERE d.from_kp_id=$1
        AND EXISTS (SELECT 1 FROM kp_relations k WHERE k.from_kp_id=$2 AND k.to_kp_id=d.to_kp_id AND k.relation=d.relation)`,
      [drop.id, keep.id])
    const relDelTo = await client.query(`
      DELETE FROM kp_relations d WHERE d.to_kp_id=$1
        AND EXISTS (SELECT 1 FROM kp_relations k WHERE k.to_kp_id=$2 AND k.from_kp_id=d.from_kp_id AND k.relation=d.relation)`,
      [drop.id, keep.id])
    const relUpFrom = await client.query(`UPDATE kp_relations SET from_kp_id=$1, updated_at=now() WHERE from_kp_id=$2`, [keep.id, drop.id])
    const relUpTo = await client.query(`UPDATE kp_relations SET to_kp_id=$1, updated_at=now() WHERE to_kp_id=$2`, [keep.id, drop.id])
    say(`  前置关系：自环删 ${selfDel.rowCount} ｜ 去重删 ${relDelFrom.rowCount + relDelTo.rowCount} ｜ 重指向 ${relUpFrom.rowCount + relUpTo.rowCount}`)

    // 3.3 question_knowledge
    const qkDel = await client.query(`
      DELETE FROM question_knowledge d WHERE d.kp_id=$1
        AND EXISTS (SELECT 1 FROM question_knowledge k WHERE k.question_id=d.question_id AND k.kp_id=$2)`, [drop.id, keep.id])
    const qkUp = await client.query(`UPDATE question_knowledge SET kp_id=$1 WHERE kp_id=$2`, [keep.id, drop.id])
    say(`  题目关联：去重删 ${qkDel.rowCount} ｜ 重指向 ${qkUp.rowCount}`)

    // 3.4 knowledge_mastery：同 (student,kp) 冲突时按数值合并（沿用批次 1 口径）
    const kmDel = await client.query(`
      DELETE FROM knowledge_mastery d WHERE d.kp_id=$1
        AND EXISTS (SELECT 1 FROM knowledge_mastery k WHERE k.student_id=d.student_id AND k.kp_id=$2)`, [drop.id, keep.id])
    const kmUp = await client.query(`UPDATE knowledge_mastery SET kp_id=$1 WHERE kp_id=$2`, [keep.id, drop.id])
    say(`  掌握度：合并数值删 ${kmDel.rowCount} ｜ 重指向 ${kmUp.rowCount}`)

    // 3.5 考法关联表（批次 1 时代还没有）
    const tqtDel = await client.query(`
      DELETE FROM teaching_question_type_kps d WHERE d.kp_id=$1
        AND EXISTS (SELECT 1 FROM teaching_question_type_kps k WHERE k.type_id=d.type_id AND k.kp_id=$2)`, [drop.id, keep.id])
    const tqtUp = await client.query(`UPDATE teaching_question_type_kps SET kp_id=$1 WHERE kp_id=$2`, [keep.id, drop.id])
    if (tqtDel.rowCount || tqtUp.rowCount) say(`  考法关联：去重删 ${tqtDel.rowCount} ｜ 重指向 ${tqtUp.rowCount}`)

    // 3.6 变式题挂在哪个考点（仅素材，不进重练卷）
    const vqUp = await client.query(`UPDATE variant_questions SET kp_id=$1 WHERE kp_id=$2`, [keep.id, drop.id])
    if (vqUp.rowCount) say(`  变式题：重指向 ${vqUp.rowCount}`)

    // 3.7 子节点改挂
    const kidUp = await client.query(`UPDATE knowledge_points SET parent_id=$1, updated_at=now() WHERE parent_id=$2`, [keep.id, drop.id])
    if (kidUp.rowCount) say(`  子节点改挂：${kidUp.rowCount}`)

    // 3.8 synonyms：被合并的名字要并进去，否则以后打标命中不到
    const parse = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []))
    const merged = [...new Set([...parse(keep.synonyms), ...parse(drop.synonyms), drop.name])]
    await client.query(`UPDATE knowledge_points SET synonyms=$1::jsonb, updated_at=now() WHERE id=$2`, [JSON.stringify(merged), keep.id])
    say(`  synonyms：+「${drop.name}」等，共 ${merged.length} 条`)

    // 3.9 删除被合并节点
    const del = await client.query(`DELETE FROM knowledge_points WHERE id=$1`, [drop.id])
    say(`  删除节点：${del.rowCount}（预期 1）`)
  }
  await client.query('COMMIT')
  say('')
  say('✅ 已提交')
} catch (e) {
  await client.query('ROLLBACK')
  say('❌ 已回滚：' + e.message)
  dump(); client.release(); await pool.end(); process.exit(1)
}
client.release()

// ═══ 4. 落库后复核 ═══
const { rows: after } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND archived=false) AS kp,
         (SELECT count(*)::int FROM question_knowledge) AS qk,
         (SELECT count(*)::int FROM knowledge_mastery) AS km,
         (SELECT count(*)::int FROM kp_relations) AS rel, 
         (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND parent_id IS NULL) AS roots`)
const { rows: orphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id=qk.kp_id WHERE kp.id IS NULL`)
const { rows: selfLoop } = await pool.query(`SELECT count(*)::int AS n FROM kp_relations WHERE from_kp_id = to_kp_id`)
say('')
say('=== 4. 落库后复核 ===')
say(`  知识点(数学,在用) ${before[0].kp} → ${after[0].kp}（预期 -${pairs.length}）`)
say(`  关联边 ${before[0].qk} → ${after[0].qk}（预期 -${qkCollide[0].n}）`)
say(`  掌握度行 ${before[0].km} → ${after[0].km}（预期 -${kmCollide[0].n}）`)
say(`  前置关系 ${before[0].rel} → ${after[0].rel}`)
say(`  孤儿边 ${orphan[0].n}（必须 0）｜ 前置自环 ${selfLoop[0].n}（必须 0）｜ 根节点 ${after[0].roots}（预期 14）`)
dump()
await pool.end()
