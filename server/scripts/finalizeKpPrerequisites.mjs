/**
 * 前置关系定稿：
 *   - 人工推导的 88 条 → status='confirmed'（运行时唯一使用的一档）
 *   - AI 按课表顺序生成的 → status='proposed'（存为候选，默认不参与查询）
 *
 * ⛔ 为什么不把 AI 生成的一起置 confirmed：
 *   实测 139 条里约 1/3 讲不通（「分数与整数混合运算 → 分母有理化」「三角形的概念与分类
 *   → 角平分线」）。按「错的答案比空答案糟」，宁可只确认能讲通的那批。
 *
 * 默认 dry-run，--apply 才写库。
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

// 人工推导的那批：basis 为「课标顺序」或「数学依赖」，reason 是完整句子
const { rows: cur } = await pool.query(`
  SELECT r.id, r.basis, r.status, r.reason, f.name AS f, t.name AS t FROM kp_relations r
    JOIN knowledge_points f ON f.id = r.from_kp_id JOIN knowledge_points t ON t.id = r.to_kp_id`)
const human = cur.filter(r => !String(r.reason || '').startsWith('教材顺序：'))
console.log('库中现有：' + cur.length + ' 条｜人工推导 ' + human.length + ' 条｜AI 生成 ' + (cur.length - human.length) + ' 条')

// AI 生成的那批（从文件读，含尚未入库的）
const gen = JSON.parse(fs.readFileSync(path.join(ROOT, '_seed-math-network', 'prerequisites-curriculum.json'), 'utf8'))
const aiOnly = gen.filter(e => e.basis === '课标顺序' && String(e.reason || '').startsWith('教材顺序：'))
console.log('待入库的 AI 候选：' + aiOnly.length + ' 条')

if (!APPLY) {
  console.log('\n计划：')
  console.log(`  1. 把 ${human.length} 条人工推导置为 confirmed`)
  console.log(`  2. 把 ${aiOnly.length} 条 AI 候选插入为 proposed`)
  console.log('\n── dry-run 结束，未写库 ──')
  await pool.end(); process.exit(0)
}

const { rows: nodes } = await pool.query(`SELECT id, name FROM knowledge_points WHERE subject='数学' AND archived=false`)
const idOf = new Map(nodes.map(r => [r.name, r.id]))
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const c1 = await client.query(`UPDATE kp_relations SET status='confirmed', updated_at=now() WHERE id = ANY($1::uuid[])`, [human.map(r => r.id)])
  console.log(`✅ 置 confirmed：${c1.rowCount} 条`)

  let ins = 0, skip = 0
  for (const e of aiOnly) {
    const f = idOf.get(e.from), t = idOf.get(e.to)
    if (!f || !t || f === t) { skip++; continue }
    const r = await client.query(`
      INSERT INTO kp_relations (from_kp_id, to_kp_id, relation, basis, reason, status)
      VALUES ($1,$2,'prerequisite',$3,$4,'proposed')
      ON CONFLICT (from_kp_id, to_kp_id, relation) DO NOTHING RETURNING id`, [f, t, e.basis, e.reason])
    if (r.rows.length) ins++
  }
  console.log(`✅ 插入候选 proposed：${ins} 条（跳过 ${skip}）`)
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK'); console.log('❌ 回滚：' + err.message); client.release(); await pool.end(); process.exit(1)
}
client.release()

const { rows: st } = await pool.query(`SELECT status, count(*)::int AS n FROM kp_relations GROUP BY status ORDER BY status`)
console.log('复核：' + st.map(r => r.status + '=' + r.n).join(' ｜ '))
const { rows: cov } = await pool.query(`
  SELECT count(DISTINCT to_kp_id)::int AS confirmed_targets FROM kp_relations WHERE status='confirmed'`)
console.log('confirmed 覆盖考点：' + cov[0].confirmed_targets)
await pool.end()
