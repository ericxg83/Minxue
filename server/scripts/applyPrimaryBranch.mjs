/**
 * 小学节点归位
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 结论：**不加空壳节点，只把已有的小学内容归位。**
 *   树里本来就有 38 个上海小学（1~5 年级）内容——分数四则、小数、单位换算、
 *   长方体/正方体体积、点线面体、观察物体…它们现在散落在初中的
 *   「数与式」「几何基础」下面，没有正确的位置。
 *
 * ⛔ 为什么不建空的「小学数学」根 + 空的领域分支：
 *   项目自己的教训（teachingQuestionTypes.js 的 kp-ranking 注释）——
 *   「空节点 = 死选项，让老师翻两屏」。所以只搬有内容的。
 *
 * ⛔ 搬动只改 parent_id，不影响打标（匹配按名字/同义词，与树位置无关）。
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

const ROOT_NAME = '小学数学'

// 上海五四制 1~5 年级内容（= stage 已标为「小学」的那批）
const PRIMARY_NAMES = [
  '单位换算', '时间计算', '水资源节约计算', '归一问题',
  '长方体体积计算', '长方体体积公式', '正方体体积', '长方形面积计算',
  '循环小数', '小数点移动', '小数运算', '小数化分数', '小数与分数的互化', '小数与分数的转换', '小数与整数转换',
  '分数化小数', '分数与小数的互化', '分数与小数的转换',
  '分数加减法', '分数加法', '分数减法', '同分母分数的加减法', '分数的加减运算', '带分数的加减法',
  '带分数与假分数的互化', '带分数与假分数的转换',
  '分数的意义', '分数的基本性质', '最简分数', '约分', '通分', '分数化简', '分数比较',
  '点线面体的关系', '立体图形的展开图', '从不同方向看立体图形',
  '简便运算', '加减混合运算与运算律',
]

const { rows: kps } = await pool.query(
  `SELECT id, name, level, parent_id, (SELECT p.name FROM knowledge_points p WHERE p.id = kp.parent_id) AS parent
     FROM knowledge_points kp WHERE subject='数学' AND archived=false`)
const byName = new Map(kps.map(r => [r.name, r]))
const existingRoot = byName.get(ROOT_NAME)

const moves = []
for (const n of PRIMARY_NAMES) {
  const k = byName.get(n)
  if (!k) continue
  if (k.parent === ROOT_NAME) continue
  moves.push({ id: k.id, name: n, from: k.parent || '(根)' })
}

console.log('目标根「' + ROOT_NAME + '」' + (existingRoot ? '已存在' : '不存在，将新建'))
console.log('待搬入的小学节点：' + moves.length)
for (const m of moves) console.log(`  ${m.name}   ${m.from} → ${ROOT_NAME}`)
console.log('\n其余初中节点不受影响；根节点将从 13 个变为 14 个。')

if (!APPLY) {
  console.log('\n── dry-run 结束，未写库 ──')
  await pool.end(); process.exit(0)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  let rootId = existingRoot?.id
  if (!rootId) {
    const { rows } = await client.query(
      `INSERT INTO knowledge_points (name, subject, level, sort_order, synonyms, stage)
       VALUES ($1, '数学', 0, 99, '[]'::jsonb, '小学') RETURNING id`, [ROOT_NAME])
    rootId = rows[0].id
    console.log('✅ 新建根节点「' + ROOT_NAME + '」')
  }
  let n = 0
  for (const m of moves) {
    const r = await client.query(`UPDATE knowledge_points SET parent_id=$1, stage='小学', updated_at=NOW() WHERE id=$2`, [rootId, m.id])
    n += r.rowCount
  }
  // 该根自身 stage 也标小学
  await client.query(`UPDATE knowledge_points SET stage='小学' WHERE id=$1`, [rootId])
  await client.query('COMMIT')
  console.log(`✅ 已搬入 ${n} 个节点`)
} catch (e) {
  await client.query('ROLLBACK')
  console.log('❌ 已回滚：' + e.message)
  client.release(); await pool.end(); process.exit(1)
}
client.release()

const { rows: chk } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND parent_id IS NULL) AS roots,
         (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND stage='小学') AS primary_n,
         (SELECT count(*)::int FROM knowledge_points WHERE subject='数学') AS total`)
console.log(`复核：根 ${chk[0].roots}（应 14）｜小学节点 ${chk[0].primary_n}｜数学总数 ${chk[0].total}（应仍 465）`)
const { rows: orphan } = await pool.query(
  `SELECT count(*)::int AS n FROM question_knowledge qk LEFT JOIN knowledge_points kp ON kp.id=qk.kp_id WHERE kp.id IS NULL`)
console.log('孤儿边：' + orphan[0].n + '（必须 0）')
await pool.end()
