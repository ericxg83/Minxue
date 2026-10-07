/**
 * P0：AI 辅助的同义词 / 节点扩充
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 为什么需要：
 *   AI 给题目打的标签里约 29%（2184 个）**逐字对不上树**，涉及 1081 个不同概念。
 *   对不上就只能靠子串兜底，落到「实数」「代数」「三角形」这种最粗的节点上
 *   ⇒ 泛化考点占 16% 的边；同时一批主干考点（圆的概念/切线/反比例函数…）永远挂不上。
 *
 * 做法：分批把「对不上树的标签」+「完整考点清单」交给模型，逐个判定
 *   map  → 语义等同某个现有考点（给逐字名称）→ 写进该考点的 synonyms
 *   new  → 清单里确实没有（不是写法差异）→ 按频次决定是否新增节点
 *   drop → 无意义泛称（「代数式」「运算」）→ 不处理
 *
 * ⛔ 默认 dry-run。--apply 才写库。结果逐批落盘，可中断续跑。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const MIN_FREQ_NEW = Number(argOf('--min-freq') || 3)
const BATCH = 100

const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { callTextCompletion } = await import('../config/ai.js')

const norm = s => String(s || '').replace(/[\s　]+/g, '').replace(/[的之]/g, '').toLowerCase()

/**
 * 从模型输出里取出判定结果。
 * ⛔ 实测模型**不按提示词返回 `{"results":[...]}`，而是直接返回裸数组 `[{...},{...}]`**。
 *    （第一次跑就是这么全批返回 0 条的。）
 *    所以两种形态都要吃；同时不能用贪婪 `/\{[\s\S]*\}/`——
 *    数组形态下它会从数组里第一个 `{` 截到最后一个 `}`，解析成一个孤立对象。
 */
function extractResults(text) {
  const raw = String(text || '')
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : raw
  const arrStart = body.indexOf('[')
  const objStart = body.indexOf('{')
  // 数组形态优先（模型的默认行为）
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const s = extractBalanced(body, arrStart, '[', ']')
    if (s) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a } catch { /* 落回对象形态 */ } }
  }
  if (objStart !== -1) {
    const s = extractBalanced(body, objStart, '{', '}')
    if (s) { try { const o = JSON.parse(s); if (Array.isArray(o.results)) return o.results } catch { /* ignore */ } }
  }
  return []
}

/** 从 start 处取出平衡的括号片段 */
function extractBalanced(raw, start, open, close) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return raw.slice(start, i + 1) }
  }
  return null
}

// ── 树 ──
const { rows: nodes } = await pool.query(`
  SELECT kp.id, kp.name, kp.level, kp.synonyms,
         (SELECT p.name FROM knowledge_points p WHERE p.id = kp.parent_id) AS parent
    FROM knowledge_points kp WHERE kp.subject='数学' AND kp.archived=false`)
const valid = new Set()
for (const n of nodes) {
  valid.add(norm(n.name))
  const syn = Array.isArray(n.synonyms) ? n.synonyms : JSON.parse(n.synonyms || '[]')
  syn.forEach(s => valid.add(norm(s)))
}
const cand = nodes.filter(n => n.level > 0)
const treeText = [...cand.reduce((m, n) => { const p = n.parent || '其他'; if (!m.has(p)) m.set(p, []); m.get(p).push(n.name); return m }, new Map())]
  .map(([p, ns]) => `${p}：${ns.join('、')}`).join('\n')

// ── 收集对不上树的标签 ──
const { rows: qs } = await pool.query(`SELECT ai_tags FROM questions WHERE subject='数学' AND COALESCE(ai_tags,'') NOT IN ('','[]','null')`)
const miss = new Map()
for (const q of qs) {
  let arr = []
  try { arr = JSON.parse(String(q.ai_tags)) } catch { continue }
  if (!Array.isArray(arr)) continue
  for (const t of arr) { const s = String(t).trim(); if (s && !valid.has(norm(s))) miss.set(s, (miss.get(s) || 0) + 1) }
}
const targets = [...miss.entries()].sort((a, b) => b[1] - a[1])
console.log(`对不上树的标签：${targets.length} 个不同概念，共 ${targets.reduce((a, [, c]) => a + c, 0)} 次`)
console.log(`分批：每批 ${BATCH} 个 → ${Math.ceil(targets.length / BATCH)} 次调用`)

const CACHE = path.join(ROOT, '_tmp_synonym_expand.json')
let results = {}
if (fs.existsSync(CACHE)) { try { results = JSON.parse(fs.readFileSync(CACHE, 'utf8')) } catch { results = {} } }
console.log(`已有缓存：${Object.keys(results).length} 个概念\n`)

const promptFor = (batch) => `你是初中数学教研员。下面是「AI 给题目打的知识点标签」和「敏学知识树里已有的考点清单」。

【考点清单】（只能从这里取名字）
${treeText}

【待判定的标签】（后面括号里是出现次数）
${batch.map(([t, c]) => `${t}(${c})`).join('、')}

请为**每一个**标签判定 action：
- "map"：语义上就是清单里的某个考点（只是写法不同）→ 给出清单里那个考点的**逐字名称**，放在 to 字段
- "new"：清单里确实没有这个概念（真缺，不是写法差异）→ 给 parent 字段填它该属于哪个板块（从清单的板块名里选）
- "drop"：无意义泛称（如「代数式」「运算」「计算」）或重复冗余 → 不处理

只返回 JSON，不要解释：
{"results":[{"tag":"标签","action":"map","to":"考点名"},{"tag":"new","action":"new","parent":"板块名"},{"tag":"x","action":"drop"}]}

铁律：
1. to / parent 必须逐字取自清单，不得自造。
2. 优先 map——只有在清单里**确实找不到对应概念**时才用 new。
3. 每个标签都必须出现在 results 里，一个都不能漏。`

let calls = 0
for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH)
  const pending = batch.filter(([t]) => !(t in results))
  if (pending.length === 0) continue
  calls++
  try {
    const res = await callTextCompletion({ systemContent: promptFor(pending), userContent: '请判定。', temperature: 0.1, maxTokens: 4000, model: undefined, preferredVendor: 'BigModel' })
    const items = extractResults(res?.content)
    if (!items.length) { console.log(`  批 ${calls} 未解析到判定结果`); continue }
    let n = 0
    for (const r of items) {
      const tag = String(r.tag || '').trim()
      if (!tag) continue
      const act = String(r.action || '').trim()
      results[tag] = { action: act, to: r.to ? String(r.to).trim() : null, parent: r.parent ? String(r.parent).trim() : null, freq: (miss.get(tag) || 0) }
      n++
    }
    console.log(`  批 ${calls}：${pending.length} 个 → 判定 ${n} 个`)
    fs.writeFileSync(CACHE, JSON.stringify(results, null, 0), 'utf8')
  } catch (e) { console.log(`  批 ${calls} 失败：${String(e.message || e).slice(0, 70)}`) }
}

const acts = { map: 0, new: 0, drop: 0, other: 0 }
for (const r of Object.values(results)) { if (acts[r.action] === undefined) acts.other++; else acts[r.action]++ }
console.log(`\n判定汇总：map ${acts.map}｜new ${acts.new}｜drop ${acts.drop}｜其他 ${acts.other}`)

const nameSet = new Set(cand.map(n => n.name))
const maps = Object.entries(results).filter(([, r]) => r.action === 'map' && nameSet.has(r.to))
const news = Object.entries(results).filter(([, r]) => r.action === 'new' && r.freq >= MIN_FREQ_NEW)
const badMaps = Object.entries(results).filter(([, r]) => r.action === 'map' && !nameSet.has(r.to))
console.log(`可用于写 synonyms 的 map：${maps.length}｜可新增节点（频次≥${MIN_FREQ_NEW}）：${news.length}｜to 名不在树里（丢弃）：${badMaps.length}`)

if (!APPLY) {
  console.log('\n── 样例 map（前 20）──')
  for (const [t, r] of maps.slice(0, 20)) console.log(`  ${t}(${r.freq}) → ${r.to}`)
  console.log('\n── 样例 new（前 20）──')
  for (const [t, r] of news.slice(0, 20)) console.log(`  ${t}(${r.freq}) → 板块「${r.parent}」`)
  console.log('\n── dry-run 结束，未写库 ──')
  await pool.end(); process.exit(0)
}

// ── 落库 ──
const client = await pool.connect()
try {
  await client.query('BEGIN')
  // 1. map → 追加 synonyms
  const addByNode = new Map()
  for (const [t, r] of maps) {
    if (!addByNode.has(r.to)) addByNode.set(r.to, new Set())
    addByNode.get(r.to).add(t)
  }
  let synAdded = 0
  for (const [nodeName, set] of addByNode) {
    const k = nodes.find(n => n.name === nodeName)
    if (!k) continue
    const cur = Array.isArray(k.synonyms) ? k.synonyms : JSON.parse(k.synonyms || '[]')
    const merged = [...new Set([...cur, ...set])]
    await client.query(`UPDATE knowledge_points SET synonyms=$1::jsonb, updated_at=NOW() WHERE id=$2`, [JSON.stringify(merged), k.id])
    synAdded += set.size
  }
  console.log(`✅ 写 synonyms：${synAdded} 条，涉及 ${addByNode.size} 个考点`)

  // 2. new → 新增节点
  const byParent = new Map()
  for (const [t, r] of news) { const p = r.parent || '综合与实践'; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(t) }
  let newNodes = 0
  for (const [parentName, names] of byParent) {
    const p = nodes.find(n => n.name === parentName)
    if (!p) { console.log(`  ⚠️ 找不到板块「${parentName}」，跳过 ${names.length} 个`); continue }
    for (const nm of names) {
      await client.query(`INSERT INTO knowledge_points (name, subject, level, sort_order, synonyms, parent_id, stage)
        VALUES ($1,'数学',1,99,'[]'::jsonb,$2,'初中') ON CONFLICT DO NOTHING`, [nm, p.id])
      newNodes++
    }
  }
  console.log(`✅ 新增考点：${newNodes} 个`)
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK'); console.log('❌ 回滚：' + e.message); client.release(); await pool.end(); process.exit(1)
}
client.release()
const { rows: chk } = await pool.query(`SELECT count(*)::int AS n FROM knowledge_points WHERE subject='数学' AND archived=false`)
console.log(`复核：可选考点 ${chk[0].n}`)
await pool.end()
