/**
 * 定点纠正：同题组内 `sub_no` 重复的行
 * ============================================================================
 * 背景（2026-09-20）
 *   `scripts/fix-subno-parent-stem-20260920.mjs` 首轮还没有「行首 (N) 优先」与
 *   「组级 sub_no 去重」两道闸，OCR 内容匹配在正文相似的题组里会**整体错位**：
 *   实测 `b99925b1` p2 题1 出现
 *     `(1) 计算下列各式…` → sub_no=1
 *     `(2) 观察第(1)题…`  → sub_no=1   ← 撞号
 *     `(3) 应用第(2)题…`  → sub_no=null ← 漏填
 *   前端会渲染出两个「(1)」小问，且 (3) 永远出不来。
 *
 * 只处理「可以无歧义修正」的组，判据全部满足才动手：
 *   1. 组内存在重复 `sub_no`；
 *   2. 该组每一行的**行首 `(N)`** 都能解出标号，且这些标号**互不重复**；
 *   3. 把每行改成自己的行首标号后，组内 `sub_no` 仍然互不重复。
 * 任一条不满足 → 整组跳过（宁可留着，也不制造新的错位）。
 *
 * 明确**不处理**的两类（已确认不属于本脚本职责）：
 *   · `①如果MN=4…` 这类行首圈号：它常常是某个 `(N)` **内部的子部件**（实测
 *     `4cd6cde0` 题12 的 (1)(2) 下再分 ①②），当顶层小问号会撞号 —— 现值反而可渲染。
 *   · 正文逐字相同的**重复入库行**（实测 `100c18eb` p1 题4）：属入库去重问题，
 *     与标号无关，改标号只会掩盖问题。
 *
 * 用法：
 *   node scripts/fix-subno-conflict-20260920.mjs            # dry-run（默认）
 *   node scripts/fix-subno-conflict-20260920.mjs --apply
 * 环境：跑之前必须把 Redis 指到不存在的端口，避免抢生产队列
 *   REDIS_URL=redis://127.0.0.1:6399 REDIS_POOL_URLS=redis://127.0.0.1:6399
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })
const { query } = await import('../config/neon.js')
const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')

const APPLY = process.argv.includes('--apply')

const LEADING_PAREN = /^[\s\u3000]*[（(]\s*(\d{1,2})\s*[)）]/
/** 顶层 `(N)` 标号（排除「第(N)题」这种正文引用） */
const TOP_PAREN_G = /(?<!第)[（(]\s*\d{1,2}\s*[)）]/g
const leadingParenNo = (content) => {
  const s = String(content || '')
  const m = s.match(LEADING_PAREN)
  if (!m) return null
  // 整行只有一个顶层 (N) 才认（多个 = 该行把若干小问合并在一起，标号无意义）
  if ([...s.matchAll(TOP_PAREN_G)].length !== 1) return null
  return m[1]
}

// ⚠️ 必须把组内**空 sub_no 的行也拉进来**：实测 `b99925b1` 题1 的 `(3) 应用第(2)题…`
//    本身 sub_no 为空，若按 `sub_no IS NOT NULL` 过滤就会漏掉它，组内只看到两条 sub_no=1。
const { rows } = await query(`
  WITH dup AS (
    SELECT task_id, page_number, question_number
    FROM questions
    WHERE deleted_at IS NULL AND task_id IS NOT NULL
      AND sub_no IS NOT NULL AND btrim(sub_no) <> ''
    GROUP BY task_id, page_number, question_number, sub_no
    HAVING COUNT(*) > 1
  ), g AS (
    SELECT DISTINCT task_id, page_number, question_number FROM dup
  )
  SELECT q.id, q.task_id, q.page_number, q.question_number, q.sub_no, q.content, t.original_name
  FROM questions q
  JOIN g ON g.task_id = q.task_id AND g.page_number IS NOT DISTINCT FROM q.page_number
        AND g.question_number = q.question_number
  JOIN tasks t ON t.id = q.task_id
  WHERE q.deleted_at IS NULL
  ORDER BY q.task_id, q.page_number, q.question_number, q.sub_no NULLS LAST, q.id`)

// 按组聚合
const groups = new Map()
for (const r of rows) {
  const k = `${r.task_id}|${r.page_number}|${r.question_number}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(r)
}

const plan = []
let skippedNoLead = 0, skippedAmbiguous = 0

for (const [k, list] of groups) {
  // 组已由 SQL 保证「存在重复 sub_no」，这里只需校验标号可解
  // 条件 2：每行行首 (N) 可解且互不重复（空 sub_no 的行同样要有标号，否则整组跳过）
  const leads = list.map(r => leadingParenNo(r.content))
  if (leads.some(x => !x)) { skippedNoLead++; continue }
  if (new Set(leads).size !== leads.length) { skippedAmbiguous++; continue }

  for (let i = 0; i < list.length; i++) {
    const r = list[i], to = leads[i]
    if (String(r.sub_no || '').trim() === to) continue
    plan.push({
      id: r.id, taskId: r.task_id, taskName: r.original_name,
      page: r.page_number, qno: r.question_number,
      oldSubNo: String(r.sub_no || '').trim() || null, newSubNo: to,
      content: String(r.content).slice(0, 100),
    })
  }
}

console.log('='.repeat(78))
console.log(`📊 组内 sub_no 重复的组: ${groups.size}`)
console.log(`   跳过（组内有行解不出行首 (N)）: ${skippedNoLead} 组`)
console.log(`   跳过（行首 (N) 有歧义/重复）: ${skippedAmbiguous} 组`)
console.log(`   可无歧义纠正: ${plan.length} 条`)
console.log('='.repeat(78))
for (const p of plan) {
  console.log(`[${p.taskId.slice(0, 8)}] ${p.taskName} | p${p.page} 题${p.qno}`)
  console.log(`   ${p.id.slice(0, 8)}  sub_no ${JSON.stringify(p.oldSubNo)} → ${JSON.stringify(p.newSubNo)}`)
  console.log(`      ${JSON.stringify(p.content)}`)
}

const ts = Date.now()
const dump = resolve(__dirname, `logs/subno-conflict-plan-${ts}.json`)
fs.writeFileSync(dump, JSON.stringify({ ts, apply: APPLY, count: plan.length, plan }, null, 2))
console.log(`\n📋 审计转储: ${dump}`)

if (!plan.length) { console.log('\n✅ 无需纠正'); process.exit(0) }
if (!APPLY) { console.log('\n🔎 DRY-RUN（加 --apply 落库）'); process.exit(0) }

// 回滚快照（落库前）
const snap = resolve(__dirname, `logs/subno-conflict-fix-${ts}.json`)
fs.writeFileSync(snap, JSON.stringify({ ts, plan }, null, 2))

for (const p of plan) {
  await query(`UPDATE questions SET sub_no = $2, updated_at = NOW() WHERE id = $1`, [p.id, p.newSubNo])
}
await syncQuestionCompleteness([...new Set(plan.map(p => p.id))])
console.log(`\n💾 已写入 ${plan.length} 条`)
console.log(`💾 回滚快照: ${snap}`)
process.exit(0)
