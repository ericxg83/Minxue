/**
 * P2：给「高频但缺前置」的考点补前置关系
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 与上一轮的区别：**强制要求给出理由**（「为什么不会前者就学不动后者」）。
 *   上一轮没要理由，模型给出的边约 1/3 讲不通（「分数与整数混合运算 → 分母有理化」）。
 *   有理由之后可以按「理由是否讲得通」筛，而不是照单全收。
 *
 * ⛔ 只补**高频**考点（被 ≥10 道题挂载）：低频考点补了也没人用。
 * ⛔ 默认 dry-run。结果落盘 `_tmp_prereq_fill.json`，人工过一遍再 --apply。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   node server/scripts/fillPrerequisites.mjs                 # dry-run：调 AI 生成候选，落盘后退出
 *   node server/scripts/fillPrerequisites.mjs --apply         # ⚠️ 会**重新调 AI**并覆盖文件后落库（不读人工筛过的文件）
 *   node server/scripts/fillPrerequisites.mjs --from-file --apply
 *        # 读**人工筛过的** `_tmp_prereq_fill.json` 直接落库，不再调 AI、不覆盖文件（推荐用于「审完再落」流程）
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const FROM_FILE = process.argv.includes('--from-file')
const FILL_FILE = path.join(ROOT, '_tmp_prereq_fill.json')
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

let edges = []

if (FROM_FILE) {
  // ── 人工审完直接落库：读文件，不调 AI，不覆盖文件 ──
  if (!fs.existsSync(FILL_FILE)) {
    console.log(`❌ 找不到 ${path.basename(FILL_FILE)}，无法 --from-file`)
    await pool.end(); process.exit(1)
  }
  const parsed = JSON.parse(fs.readFileSync(FILL_FILE, 'utf8'))
  if (!Array.isArray(parsed)) { console.log('❌ 候选文件不是数组'); await pool.end(); process.exit(1) }
  const seen = new Set()
  edges = parsed.filter(e => {
    const k = `${e.from}|${e.to}`
    if (!e.from || !e.to || e.from === e.to || seen.has(k)) return false
    seen.add(k); return true
  })
  console.log(`--from-file：读入人工筛过的候选 ${edges.length} 条，跳过 AI 生成`)
  if (!APPLY) {
    console.log('\n── --from-file 未加 --apply，仅预览，未写库 ──')
    for (const e of edges.slice(0, 10)) console.log(`  ${e.from} → ${e.to}`)
    await pool.end(); process.exit(0)
  }
} else {
  // ── 正常流程：调 AI 生成候选 ──
  const { callTextCompletion } = await import('../config/ai.js')

  const CURRICULUM = `六年级上：数的整除 → 分数 → 比和比例 → 圆和扇形
六年级下：有理数 → 一次方程(组)和一次不等式(组) → 线段与角的画法 → 长方体的再认识
七年级上：整式 → 分式 → 图形的运动
七年级下：实数 → 相交线 平行线 → 三角形 → 平面直角坐标系
八年级上：二次根式 → 一元二次方程 → 正比例函数与反比例函数
八年级下：几何证明 → 一次函数 → 代数方程 → 四边形 → 概率初步
九年级上：相似三角形 → 锐角的三角比
九年级下：二次函数 → 圆与正多边形 → 统计初步`

  const { rows: kps } = await pool.query(`
    SELECT kp.name, kp.level, p.name AS parent FROM knowledge_points kp
      LEFT JOIN knowledge_points p ON p.id = kp.parent_id
     WHERE kp.subject='数学' AND kp.archived=false ORDER BY p.name, kp.name`)
  const cand = kps.filter(k => k.level > 0)
  const valid = new Set(cand.map(k => k.name))
  const treeText = [...cand.reduce((m, k) => { const p = k.parent || '其他'; if (!m.has(p)) m.set(p, []); m.get(p).push(k.name); return m }, new Map())]
    .map(([p, ns]) => `${p}：${ns.join('、')}`).join('\n')

  const { rows: lack } = await pool.query(`
    SELECT kp.name, count(DISTINCT qk.question_id)::int AS mounts
      FROM knowledge_points kp JOIN question_knowledge qk ON qk.kp_id = kp.id
     WHERE kp.subject='数学' AND kp.archived=false
     GROUP BY kp.id, kp.name
    HAVING count(DISTINCT qk.question_id) >= 10
       AND NOT EXISTS (SELECT 1 FROM kp_relations r WHERE r.to_kp_id = kp.id AND r.status='confirmed')
     ORDER BY mounts DESC`)
  console.log(`缺前置的高频考点：${lack.length} 个`)

  const BATCH = 18
  const all = []
  let calls = 0
  for (let i = 0; i < lack.length; i += BATCH) {
    const batch = lack.slice(i, i + BATCH)
    calls++
    const prompt = `你是初中数学教研员，熟悉上海沪教版（五四制）教材。

【教材顺序】
${CURRICULUM}

【敏学知识树的考点清单】（只能从这里取名字）
${treeText}

请为下面这些考点，各指出「学生要学它，**必须先掌握**哪些考点」：
${batch.map(b => b.name).join('、')}

只返回 JSON 数组，不要解释：
[{"to":"目标考点","from":[{"name":"先修考点","why":"为什么不会前者就学不动后者（一句话，要具体）"}]}]

⛔ 铁律：
1. to 和 from[].name 都必须**逐字**取自上面的清单，不得自造、不得改写。
2. 每个 from 都必须给出 why，且 why 要能讲通——不能只是「它更早」，要说清**数学上的依赖关系**。
   反例（讲不通，不要写）：「分数与整数混合运算 → 分母有理化」，这两者没有依赖。
   正例（讲得通）：「一元二次方程 → 二次函数」，因为判别式决定抛物线与 x 轴交点个数。
3. 只列**直接**先修，1~3 个。宁可少，不要凑。
4. 确实没有先修的（如「有理数」「正数和负数的概念」），from 给空数组。
5. 每个考点都要出现在结果里。`

    try {
      const res = await callTextCompletion({ systemContent: prompt, userContent: '请生成。', temperature: 0.2, maxTokens: 4000, model: undefined, preferredVendor: 'BigModel' })
      const raw = String(res?.content || '')
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
      const body = fence ? fence[1] : raw
      const s = body.indexOf('[')
      let items = []
      if (s !== -1) {
        let d = 0, inStr = false, esc = false
        for (let j = s; j < body.length; j++) {
          const ch = body[j]
          if (esc) { esc = false; continue }
          if (ch === '\\') { esc = true; continue }
          if (ch === '"') { inStr = !inStr; continue }
          if (inStr) continue
          if (ch === '[') d++
          else if (ch === ']') { d--; if (d === 0) { try { const a = JSON.parse(body.slice(s, j + 1)); if (Array.isArray(a)) items = a } catch {} ; break } }
        }
      }
      let n = 0
      for (const it of items) {
        const to = String(it.to || '').trim()
        if (!valid.has(to)) continue
        for (const f of (it.from || [])) {
          const name = String(f?.name || '').trim()
          const why = String(f?.why || '').trim()
          if (!valid.has(name) || name === to || !why) continue
          all.push({ to, from: name, why, toMounts: lack.find(b => b.name === to)?.mounts || 0 })
          n++
        }
      }
      console.log(`  批 ${calls}：${batch.length} 个考点 → 生成 ${n} 条`)
    } catch (e) { console.log(`  批 ${calls} 失败：${String(e.message || e).slice(0, 70)}`) }
  }

  // 去重
  const seen = new Set()
  edges = all.filter(e => { const k = e.from + '|' + e.to; if (seen.has(k)) return false; seen.add(k); return true })
  console.log(`\n共生成 ${edges.length} 条（去重后）`)
  fs.writeFileSync(FILL_FILE, JSON.stringify(edges, null, 2), 'utf8')
  console.log('-> _tmp_prereq_fill.json')

  if (!APPLY) {
    console.log('\n── 抽样 25 条（看理由质量）──')
    for (const e of edges.slice(0, 25)) console.log(`  ${e.from} → ${e.to}\n      〔理由〕${e.why}`)
    console.log('\n── dry-run 结束，未写库 ──')
    await pool.end(); process.exit(0)
  }
}

// ── 落库（confirmed）──
const { rows: nodes } = await pool.query(`SELECT id, name FROM knowledge_points WHERE subject='数学' AND archived=false`)
const idOf = new Map(nodes.map(r => [r.name, r.id]))
const client = await pool.connect()
let ok = 0, skip = 0
try {
  await client.query('BEGIN')
  for (const e of edges) {
    const f = idOf.get(e.from), t = idOf.get(e.to)
    if (!f || !t || f === t) { skip++; continue }
    const r = await client.query(`
      INSERT INTO kp_relations (from_kp_id, to_kp_id, relation, basis, reason, status)
      VALUES ($1,$2,'prerequisite','数学依赖',$3,'confirmed')
      ON CONFLICT (from_kp_id, to_kp_id, relation) DO UPDATE
        SET basis='数学依赖', reason=EXCLUDED.reason, status='confirmed', updated_at=now()
      RETURNING id`, [f, t, e.why])
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
const { rows: cov } = await pool.query(`SELECT count(DISTINCT to_kp_id)::int AS n FROM kp_relations WHERE status='confirmed'`)
console.log('confirmed 覆盖考点：' + cov[0].n)
await pool.end()
