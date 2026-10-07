/**
 * 清理「过泛同义词」（2026-10-07 第三轮自查）
 * ═══════════════════════════════════════════════════════════════
 * 匹配规则是「**标签包含同义词**」就命中（`tag.includes(n)`，n 长度 ≥2 就给 60+len 分），
 * 所以**越短、越像后缀的词越危险** —— 它会把别的考点的标签吸过来。实测两条：
 *
 *  ① `幂与根式 ← "指数"`：任何含「指数」的标签都被吸过去。
 *     实测 5 条挂载里 4 条是「增长率/指数函数」的函数题（`指数增长`/`指数函数`），
 *     跟「幂与根式」没关系。
 *  ② `勾股定理 ← "定理"`：「定理」是后缀不是术语，把
 *     `二项式定理`（高中）、`射影定理`、`比例线段定理`、`面积比定理` 全吸过来了。
 *     注意：`勾股定理的应用` 是**合法**标签，所以删「定理」的同时要把它补成同义词。
 *
 * ⛔ 只删这两条 + 补一条，不动其它同义词（「分数」「根式」「负数」等实测是正常命中）。
 * ⛔ 默认 dry-run。改完必须跑 `recomputeQuestionKnowledge.mjs` 让存量边跟上（真实链路重算）。
 *
 * 用法：
 *   node server/scripts/cleanGenericSynonyms.mjs            # dry-run
 *   node server/scripts/cleanGenericSynonyms.mjs --apply
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import { default as pg } from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const APPLY = process.argv.includes('--apply')

/** remove：从该节点同义词里删掉；add：补进去 */
const PLAN = [
  { name: '幂与根式', remove: ['指数'], add: [], why: '「指数」是泛词：把指数增长/指数函数（函数题）全吸过来，实测 5 条挂载里 4 条误伤' },
  { name: '勾股定理', remove: ['定理'], add: ['勾股定理的应用'], why: '「定理」是后缀：二项式定理/射影定理/比例线段定理/面积比定理都被吸过来；补「勾股定理的应用」保住合法标签' },
]

const parse = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []))
for (const p of PLAN) {
  const { rows } = await pool.query(`SELECT id, synonyms FROM knowledge_points WHERE subject='数学' AND name=$1`, [p.name])
  if (!rows.length) { console.log(`MISS ${p.name}`); continue }
  const cur = parse(rows[0].synonyms)
  const next = [...new Set([...cur.filter(s => !p.remove.includes(s)), ...p.add])]
  console.log('')
  console.log(`【${p.name}】${p.why}`)
  console.log('  改前(' + cur.length + ')：' + JSON.stringify(cur))
  console.log('  改后(' + next.length + ')：' + JSON.stringify(next))
  if (APPLY) {
    await pool.query(`UPDATE knowledge_points SET synonyms=$1::jsonb, updated_at=now() WHERE id=$2`, [JSON.stringify(next), rows[0].id])
    console.log('  ✅ 已更新')
  }
}
if (!APPLY) console.log('\n── dry-run 结束，未写库 ──')
else console.log('\n⛔ 下一步必须跑：node server/scripts/recomputeQuestionKnowledge.mjs --apply')
await pool.end()
