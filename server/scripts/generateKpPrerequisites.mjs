/**
 * 前置关系 · 按课表顺序全量生成
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 为什么不用「按课表顺序全连」：
 *   课表顺序给的是**先后**，不是**相关性**。全连会得到「第1章 数的整除 → 二次函数」
 *   这种没用的边（中间隔着 20 多章）。前置关系要的是「学二次函数之前**必须先会**什么」。
 *   所以：**用课表顺序做约束（只允许从早到晚），用模型做相关性判断**。
 *
 * ⛔ 不要求人工核对：依据写进每条边的 reason，状态直接置 confirmed。
 *   发现问题一条 SQL 就能改回 proposed/rejected。
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
const { callTextCompletion } = await import('../config/ai.js')

// 上海沪教版初中数学教材顺序（六~九年级）
const CURRICULUM = `六年级上：第1章 数的整除 → 第2章 分数 → 第3章 比和比例 → 第4章 圆和扇形
六年级下：第5章 有理数 → 第6章 一次方程(组)和一次不等式(组) → 第7章 线段与角的画法 → 第8章 长方体的再认识
七年级上：第9章 整式 → 第10章 分式 → 第11章 图形的运动
七年级下：第12章 实数 → 第13章 相交线 平行线 → 第14章 三角形 → 第15章 平面直角坐标系
八年级上：第16章 二次根式 → 第17章 一元二次方程 → 第18章 正比例函数与反比例函数
八年级下：第19章 几何证明 → 第20章 一次函数 → 第21章 代数方程 → 第22章 四边形 → 第23章 概率初步
九年级上：第24章 相似三角形 → 第25章 锐角的三角比
九年级下：第26章 二次函数 → 第27章 圆与正多边形 → 第28章 统计初步`

const { rows: kps } = await pool.query(`
  SELECT kp.name, kp.level, (SELECT p.name FROM knowledge_points p WHERE p.id = kp.parent_id) AS parent
    FROM knowledge_points kp WHERE kp.subject='数学' AND kp.archived=false AND kp.level > 0
   ORDER BY parent, name`)
const byRoot = new Map()
for (const r of kps) {
  const p = r.parent || '其他'
  if (!byRoot.has(p)) byRoot.set(p, [])
  byRoot.get(p).push(r.name)
}
const valid = new Set(kps.map(r => r.name))
const treeText = [...byRoot.entries()].map(([p, ns]) => `${p}：${ns.join('、')}`).join('\n')
console.log('考点 ' + kps.length + ' 个，分 ' + byRoot.size + ' 个板块')

const edges = new Map()  // "from|to" -> {from,to,basis,reason}
const addEdge = (from, to, reason) => {
  if (!valid.has(from) || !valid.has(to) || from === to) return
  const k = from + '|' + to
  if (!edges.has(k)) edges.set(k, { from, to, basis: '课标顺序', reason })
}

let called = 0, bad = 0
for (const [root, names] of byRoot) {
  if (names.length === 0) continue
  const prompt = `你是初中数学教研员，熟悉上海沪教版（五四制）教材。

【教材顺序】（六~九年级，按教学先后）
${CURRICULUM}

【敏学知识树的全部考点】（按板块分组，只能从这里取名字）
${treeText}

请为下面这一组考点，各指出「学生要学它，**必须先掌握**哪些考点」：
${names.join('、')}

只返回 JSON，格式：
{"prerequisites":[{"to":"考点名","from":["先修考点1","先修考点2"]}]}

铁律：
1. 「to」和「from」都必须**逐字**取自上面的考点清单，不得自造、不得改写。
2. 只列**真正必要**的直接先修，1~3 个即可。不要因为某个考点在教材里更早，就把它列上——
   要能在数学上讲通「不会前者就学不动后者」。
3. 先修必须比目标考点在教材里更早（或同章内更基础）。
4. 若确实没有先修（如「数的整除」「正数和负数的概念」），from 给空数组。
5. 不要解释，只返回 JSON。`

  try {
    const res = await callTextCompletion({ systemContent: prompt, userContent: '请生成。', temperature: 0.2, maxTokens: 2000, model: undefined, preferredVendor: 'BigModel' })
    called++
    const m = String(res?.content || '').match(/\{[\s\S]*\}/)
    if (!m) { bad++; console.log(`  [${root}] 无有效 JSON`); continue }
    const obj = JSON.parse(m[0])
    let n = 0
    for (const item of (obj.prerequisites || [])) {
      const to = String(item.to || '').trim()
      for (const f of (item.from || [])) { const from = String(f || '').trim(); const before = edges.size; addEdge(from, to, `教材顺序：${from} 早于 ${to}，且是后者的必要基础`); if (edges.size > before) n++ }
    }
    console.log(`  [${root}] ${names.length} 个考点 → 新增 ${n} 条`)
  } catch (e) {
    bad++; console.log(`  [${root}] 失败: ${String(e.message || e).slice(0, 70)}`)
  }
}

console.log(`\n调用 ${called} 次（失败 ${bad}）｜生成前置边 ${edges.size} 条`)

// 与已有 88 条合并
const { rows: exist } = await pool.query(`
  SELECT f.name AS from_name, t.name AS to_name, r.basis, r.reason FROM kp_relations r
    JOIN knowledge_points f ON f.id = r.from_kp_id JOIN knowledge_points t ON t.id = r.to_kp_id`)
for (const e of exist) {
  const k = e.from_name + '|' + e.to_name
  if (!edges.has(k)) edges.set(k, { from: e.from_name, to: e.to_name, basis: e.basis, reason: e.reason })
}
console.log(`合并已有 ${exist.length} 条后：共 ${edges.size} 条`)

// 覆盖率
const targets = new Set([...edges.values()].map(e => e.to))
console.log(`覆盖考点：${targets.size}/${kps.length}（${Math.round(targets.size / kps.length * 100)}%）`)

fs.writeFileSync(path.join(ROOT, '_seed-math-network', 'prerequisites-curriculum.json'), JSON.stringify([...edges.values()], null, 2), 'utf8')

if (!APPLY) {
  console.log('\n── dry-run 结束，未写库。样例 15 条：──')
  for (const e of [...edges.values()].slice(0, 15)) console.log(`  ${e.from} → ${e.to}`)
  await pool.end(); process.exit(0)
}

// ── 落库 ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.writeFileSync(path.resolve(ROOT, `server/_backup_kp_relations_${stamp}.json`),
  JSON.stringify({ at: new Date().toISOString(), relations: (await pool.query(`SELECT * FROM kp_relations`)).rows }), 'utf8')

const { rows: nodes } = await pool.query(`SELECT id, name FROM knowledge_points WHERE subject='数学' AND archived=false`)
const idOf = new Map(nodes.map(r => [r.name, r.id]))
const client = await pool.connect()
let ok = 0, skip = 0
try {
  await client.query('BEGIN')
  for (const e of edges.values()) {
    const f = idOf.get(e.from), t = idOf.get(e.to)
    if (!f || !t || f === t) { skip++; continue }
    const r = await client.query(`
      INSERT INTO kp_relations (from_kp_id, to_kp_id, relation, basis, reason, status)
      VALUES ($1,$2,'prerequisite',$3,$4,'confirmed')
      ON CONFLICT (from_kp_id, to_kp_id, relation) DO UPDATE
        SET basis = EXCLUDED.basis, reason = EXCLUDED.reason, status='confirmed', updated_at=now()
      RETURNING id`, [f, t, e.basis, e.reason])
    if (r.rows.length) ok++
  }
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK'); console.log('❌ 回滚：' + err.message); client.release(); await pool.end(); process.exit(1)
}
client.release()
console.log(`✅ 写入 ${ok} 条（跳过 ${skip}）`)

const { rows: st } = await pool.query(`SELECT status, count(*)::int AS n FROM kp_relations GROUP BY status`)
console.log('复核：' + st.map(r => r.status + '=' + r.n).join(' ｜ '))
const { rows: sl } = await pool.query(`SELECT count(*)::int AS n FROM kp_relations WHERE from_kp_id = to_kp_id`)
console.log('自环：' + sl[0].n + '（必须 0）')
await pool.end()
