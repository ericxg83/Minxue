/**
 * 批次 3+4：加 archived / stage 两个字段
 *   - archived：标记超范围（高中）知识点，供打标链路过滤
 *   - stage：学段（小学 / 初中），为后续小学内容预留
 * ⛔ 只加列 + 回填，不改结构、不删数据。默认 dry-run。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const { default: pg } = await import('pg')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// 高中 / 超范围 → archived
// ⛔ 2026-10-07 收窄：原列 8 个，实测「数列」「数列求和」在承担初中「规律探究」的角色
//   （有 8 道找规律题**只**挂了「数列」，归档后它们会变成无考点）。
//   故只归档语义上确定是高中、且仅作次要标签的 6 个。
const HIGH_SCHOOL = ['二项式定理', '等差数列', '等比数列求和', '数学归纳法', '极限概念', '立方和']

// 上海五四制小学（1~5 年级）内容，可确定的部分
const PRIMARY = [
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

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }

// 0. 列是否存在
const { rows: cols } = await pool.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='knowledge_points'`)
const have = new Set(cols.map(c => c.column_name))
say(`现有列：${[...have].join(', ')}`)
say(`待新增列：${['archived', 'stage'].filter(c => !have.has(c)).join(', ') || '（都已存在）'}`)

// 1. 目标节点
const { rows: kps } = await pool.query(`SELECT id, name, subject FROM knowledge_points`)
const byName = new Map(kps.map(r => [r.name, r]))
const hs = HIGH_SCHOOL.filter(n => byName.has(n))
const pri = PRIMARY.filter(n => byName.has(n))
say('')
say(`归档（高中/超范围）命中 ${hs.length}/${HIGH_SCHOOL.length}：${hs.join(' / ')}`)
say(`小学（上海1~5年级）命中 ${pri.length}/${PRIMARY.length}`)
say(`其余 ${kps.length - hs.length - pri.length} 个 → stage='初中'`)

if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库 ──')
  fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_stage_report.txt'), out.join('\n'), 'utf8')
  await pool.end(); process.exit(0)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  say('')
  say('=== 加列 ===')
  if (!have.has('archived')) {
    await client.query(`ALTER TABLE knowledge_points ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false`)
    say('  ✅ archived BOOLEAN NOT NULL DEFAULT false')
  }
  if (!have.has('stage')) {
    await client.query(`ALTER TABLE knowledge_points ADD COLUMN stage TEXT NOT NULL DEFAULT '初中'`)
    say("  ✅ stage TEXT NOT NULL DEFAULT '初中'")
  }
  say('=== 回填 ===')
  // 幂等：先全量置 false，再把高中名单置 true（脚本重复跑结果一致）
  await client.query(`UPDATE knowledge_points SET archived = false WHERE archived = true`)
  const a1 = await client.query(`UPDATE knowledge_points SET archived = true WHERE name = ANY($1::text[])`, [hs])
  say(`  archived=true：${a1.rowCount} 个`)
  const a2 = await client.query(`UPDATE knowledge_points SET stage = '小学' WHERE name = ANY($1::text[])`, [pri])
  say(`  stage='小学'：${a2.rowCount} 个`)
  const a3 = await client.query(`UPDATE knowledge_points SET stage = '初中' WHERE name <> ALL($1::text[])`, [pri])
  say(`  stage='初中'：${a3.rowCount} 个`)
  await client.query('COMMIT')
  say('  ✅ 已提交')
} catch (e) {
  await client.query('ROLLBACK')
  say(`  ❌ 已回滚：${e.message}`)
  client.release(); await pool.end(); process.exit(1)
}
client.release()

const { rows: chk } = await pool.query(`
  SELECT stage, archived, count(*)::int AS n FROM knowledge_points GROUP BY stage, archived ORDER BY stage, archived`)
say('')
say('=== 复核 ===')
for (const r of chk) say(`  stage=${r.stage} archived=${r.archived} → ${r.n} 个`)
fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_stage_report.txt'), out.join('\n'), 'utf8')
await pool.end()
