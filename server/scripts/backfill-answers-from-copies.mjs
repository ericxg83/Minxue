/**
 * 从「同卷副本」回填参考答案（零 AI，2026-09-24）
 *
 * ── 为什么这是最可靠的一条路 ──
 * 本轮实测发现：**同一份练习册被不同学生扫描 ⇒ 库里存在多份同题副本**
 * （`_diag_cross_copy.mjs` 全库扫出 26 条缺答案题存在带答案的副本）。
 * 副本的答案来自**另一次独立的扫描 + 另一次独立的 AI 解答** ⇒ 天然构成交叉验证，
 * 且**零 token、零读图幻觉风险**。远优于再跑一次引擎。
 *
 * ── ⛔ 四道闸（缺一不可，宁可不填也不填错）──
 * ① 同题判定：归一化 content（去空白/标点/全半角/大小写）**完全相等**
 * ② 答案可用：副本 answer 非空，且**不是占位串**
 *    （实测踩到：`需依据具体图形确定，故此处标记为待人工补充`、`无法确定，需人工补充题目内容后再作答`
 *      —— 这些是模型自述「我解不出」，抄过来等于把「缺答案」伪装成「有答案」，比留空更糟）
 * ③ **选择题/判断题必须核对选项**：题干相同但选项顺序可能不同，直接抄字母会抄错
 *    （本轮 `√8的算术平方根是` 在多份扫描里都是 choice，选项未核对前不得采信字母答案）
 * ④ 多副本必须**一致**：所有非占位答案归一化后语义相同才采纳；
 *    出现分歧 → 只报告不落库（分歧通常意味着「题目本身有歧义」或「某份扫描错位」）
 *
 * ── ⛔ 方法学陷阱：循环引用（本轮踩到）──
 * 「多份副本一致」不一定等于「多份独立证据」——
 * 若某副本的答案**是本次回填自己写进去的**，它就不算独立来源。
 * 实测：`95be3595` 的 3 份「一致副本」中有 2 份（`1f09df34`/`3a9c4c8a`）是本轮自己落的库，
 * 真正的独立来源只有 `b82df0a3` 一份。
 * ⇒ 判断「几源一致」时必须剔除本轮自己写入的行；跨轮次反复回填尤其要小心。
 *
 * ── ⛔ 反例：多数票也会错（实测）──
 * 全库「√9的算术平方根是」6 份副本：4 份答 `3`（**错**）、2 份答 `√3`（**对**）。
 * 该题型族引擎系统性把「√X 的算术平方根」算成 √X。⇒ **多数票不能替代数学验算**。
 *
 * 用法:
 *   node server/scripts/backfill-answers-from-copies.mjs            # dry-run（打印可采纳/分歧/占位）
 *   node server/scripts/backfill-answers-from-copies.mjs --apply    # 落库
 *   node server/scripts/backfill-answers-from-copies.mjs --out x.json
 */
import '../loadEnv.js'
import pg from 'pg'
import fs from 'node:fs'
import { isSameAnswerSemantic } from '../utils/mathExprNormalize.js'

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const APPLY = process.argv.includes('--apply')
const OUT = argOf('--out') || null
/**
 * --exclude id1,id2  人工排除名单（前缀匹配）。
 * ⛔ 为什么需要它：副本「多数票」**不等于正确**。实测反例 ——
 *   全库「√9的算术平方根是」共 6 份副本：4 份答 `3`（**错**，那是 √9 本身）、2 份答 `√3`（**对**）。
 *   即该题型族引擎系统性把「√X 的算术平方根」算成「√X」。
 *   凡数学上无法自证、且选项集与该答案对不上的，一律排除，宁可留空转人工。
 */
const EXCLUDE = (argOf('--exclude') || '').split(',').map(s => s.trim()).filter(Boolean)

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const blank = (s) => !t(s)
/**
 * 归一化：去空白 + 去标点 + 去填空下划线 + 统一括号引号 + 小写（判「同题」用）
 * ⚠️ `_`（填空下划线）必须一起去掉：实测 `51c5ec18`「…这个数是」与 `7226c632`「…这个数是______。」
 *    是同一道题，但漏掉 `_` 就判成不同题，白丢一条可回填项。
 */
const norm = (s) => String(s ?? '')
  .replace(/\s+/g, '')
  .replace(/[_＿]+/g, '')
  .replace(/[，。、；：！？（）【】《》""''·．,.;:!?()\[\]<>"']/g, '')
  .replace(/[−–—]/g, '-')
  .toLowerCase()

/**
 * ⛔ 占位串 = 模型自述「解不出」的话，**不是答案**。
 * 实测原例：`需依据具体图形确定，故此处标记为待人工补充` / `无法确定，需人工补充题目内容后再作答`。
 * 抄进 answer 会让「缺答案」变成「有答案」，直接污染判分与后续统计 —— 比留空更糟。
 */
const PLACEHOLDER = /待人工补充|待补充|需人工|人工补充|无法确定|无法作答|无法唯一确定|缺少条件|题目不完整|信息不足|见解析|见答案|详见|略$|^无$|^无。?$|不能确定/

const { rows: all } = await pool.query(
  `SELECT id, task_id, page_number, question_number, sub_no, question_type, content, options, answer, parent_stem
   FROM questions WHERE deleted_at IS NULL`
)

// 同题索引
const idx = new Map()
for (const r of all) {
  const k = norm(r.content)
  if (!k || k.length < 8) continue          // 过短不作同题判据（如「列式计算。」会跨卷乱撞）
  if (!idx.has(k)) idx.set(k, [])
  idx.get(k).push(r)
}

const targets = all.filter(r => blank(r.answer)).filter(r =>
  !EXCLUDE.some(w => r.id === w || String(r.id).startsWith(w)))
const okList = [], conflictList = [], placeholderList = [], noCopyList = []

for (const r of targets) {
  const k = norm(r.content)
  if (!k || k.length < 8) { noCopyList.push({ r, why: 'content 过短（<8 归一化字符），不作同题判据' }); continue }
  const copies = (idx.get(k) || []).filter(x => x.id !== r.id)
  if (!copies.length) { noCopyList.push({ r, why: '库内无同题副本' }); continue }

  const answered = copies.filter(c => !blank(c.answer))
  if (!answered.length) { noCopyList.push({ r, why: '有副本但副本也无答案' }); continue }

  const real = answered.filter(c => !PLACEHOLDER.test(t(c.answer)))
  const holders = answered.filter(c => PLACEHOLDER.test(t(c.answer)))
  if (!real.length) {
    placeholderList.push({ r, holders: holders.map(c => ({ id: c.id, answer: t(c.answer) })) })
    continue
  }

  // 闸③：选择题/判断题必须核对选项
  if (['choice', 'judge'].includes(String(r.question_type || '').toLowerCase())) {
    const myOpts = norm(JSON.stringify(r.options || []))
    const mismatched = real.filter(c => norm(JSON.stringify(c.options || [])) !== myOpts)
    if (mismatched.length) {
      conflictList.push({
        r, kind: '选项不一致',
        detail: mismatched.map(c => ({ id: c.id, answer: t(c.answer), options: c.options })),
        myOptions: r.options,
      })
      continue
    }
  }

  // 闸④：多副本必须一致
  const base = real[0]
  const disagree = real.filter(c => !isSameAnswerSemantic(t(base.answer), t(c.answer)))
  if (disagree.length) {
    conflictList.push({
      r, kind: '副本答案分歧',
      detail: real.map(c => ({ id: c.id, task: String(c.task_id).slice(0, 8), answer: t(c.answer) })),
    })
    continue
  }

  okList.push({
    r,
    answer: t(base.answer),
    sources: real.map(c => ({ id: c.id, task: String(c.task_id).slice(0, 8), answer: t(c.answer) })),
    holders: holders.map(c => ({ id: c.id, answer: t(c.answer) })),
  })
}

// ── 报告 ──
console.log(`\n==== 同卷副本回填（${APPLY ? 'APPLY' : 'dry-run'}）====`)
console.log(`缺答案题 ${targets.length} 条`)
console.log(`✅ 可采纳（副本一致、非占位、选项已核）: ${okList.length}`)
console.log(`⚠️ 需人工裁决（副本分歧 / 选项不一致）: ${conflictList.length}`)
console.log(`⛔ 只有占位串（模型自述解不出）: ${placeholderList.length}`)
console.log(`·  无可用副本: ${noCopyList.length}\n`)

console.log(`── ✅ 可采纳明细 ──`)
for (const x of okList) {
  console.log(`  ${String(x.r.id).slice(0, 8)} q#${x.r.question_number}${x.r.sub_no ? `(${x.r.sub_no})` : ''} [${x.r.question_type}] => ${JSON.stringify(x.answer)}`)
  console.log(`     ${JSON.stringify(t(x.r.content).slice(0, 80))}`)
  console.log(`     来源副本: ${x.sources.map(s => `${s.id.slice(0, 8)}@${s.task}`).join(', ')}${x.holders.length ? ` ｜ 另有占位副本 ${x.holders.length} 条已忽略` : ''}`)
}

console.log(`\n── ⚠️ 需人工裁决明细 ──`)
for (const x of conflictList) {
  console.log(`  ${String(x.r.id).slice(0, 8)} q#${x.r.question_number} [${x.r.question_type}] <${x.kind}>`)
  console.log(`     ${JSON.stringify(t(x.r.content).slice(0, 90))}`)
  for (const d of x.detail) console.log(`       ${d.id.slice(0, 8)}${d.task ? '@' + d.task : ''} => ${JSON.stringify(d.answer)}${d.options ? ` opts=${JSON.stringify(d.options).slice(0, 60)}` : ''}`)
  if (x.myOptions) console.log(`       本行 opts=${JSON.stringify(x.myOptions).slice(0, 80)}`)
}

console.log(`\n── ⛔ 只有占位串明细 ──`)
for (const x of placeholderList) {
  console.log(`  ${String(x.r.id).slice(0, 8)} q#${x.r.question_number}  ${JSON.stringify(t(x.r.content).slice(0, 70))}`)
  for (const h of x.holders) console.log(`       ${h.id.slice(0, 8)} => ${JSON.stringify(h.answer.slice(0, 60))}`)
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), apply: APPLY,
    ok: okList.map(x => ({ id: x.r.id, q: x.r.question_number, answer: x.answer, sources: x.sources })),
    conflicts: conflictList.map(x => ({ id: x.r.id, kind: x.kind, detail: x.detail })),
    placeholders: placeholderList.map(x => ({ id: x.r.id, holders: x.holders })),
  }, null, 2), 'utf8')
  console.log(`\n明细已落盘: ${OUT}`)
}

// ── 落库 ──
if (APPLY) {
  let applied = 0, skipped = 0
  for (const x of okList) {
    const basis = `同卷副本交叉验证：${x.sources.map(s => `${s.id.slice(0, 8)}(task ${s.task}) 答案 ${JSON.stringify(s.answer)}`).join('；')}`
    const res = await pool.query(
      `UPDATE questions SET answer = $1, answer_exception = FALSE, answer_exception_reason = NULL,
         updated_at = NOW() WHERE id = $2 AND (answer IS NULL OR btrim(answer) = '')`,
      [x.answer, x.r.id])
    if (res.rowCount > 0) {
      applied++
      console.log(`  ✅ ${String(x.r.id).slice(0, 8)} = ${JSON.stringify(x.answer)}`)
      console.log(`     依据: ${basis}`)
    } else { skipped++; console.log(`  ⏭️ ${String(x.r.id).slice(0, 8)} 并发下已被写，跳过`) }
  }
  console.log(`\n==== 落库完成：answer ${applied} 条，跳过 ${skipped} ====`)
}

await pool.end()
process.exit(0)
