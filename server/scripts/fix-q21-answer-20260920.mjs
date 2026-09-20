/**
 * 定点修复：题21（等式规律探究）的 (2) 通式答案错误 / 缺 sub_no / 缺答案
 * ============================================================================
 * 背景（2026-09-20）
 *   同源卷「第19章实数复习1」两个学生副本的题21 存在三处缺陷（均为 `ai_answer_gen`
 *   生成、任务已 done，改答案不触发重判，仅影响展示与后续重练判分）：
 *
 *   1. `5636fc30` bd31776e（e1954c37，合并式）：
 *      (2) 通式答案 `√((n-1)(n+1))/n²` 数学错误 —— n=2 得 √3/4≈0.433，真值 2/3≈0.667。
 *      题面第 1~4 个等式：√(1-3/4)=1/2、√(1-5/9)=2/3、√(1-7/16)=3/4、√(1-9/25)=4/5
 *      → 通式 √(1-(2n+1)/(n+1)²) = n/(n+1)（因 1-(2n+1)/(n+1)² = n²/(n+1)²）。
 *      订正为 `n/(n+1)`。
 *   2. `007113e4` 9d8b442b（d936f241，拆行式）：
 *      (2) 缺 sub_no（应为 2）且答案空。这是「混合残题」—— 组内 (1)(3)(4) 有
 *      sub_no，之前 SUSPECT_GROUPS 只查「整组全无 sub_no」，漏掉了此类。
 *   3. `007113e4` 9d8b442b（b1bb735c）：(4) 答案空。验算：4049=2×2024+1 → n=2024
 *      → x = n/(n+1) = 2024/2025（与 5636fc30 副本一致）。
 *
 * 影响面：两个任务均已 done；e1954c37 已进错题本（39e76ba8，09-19）、adee8305 已进
 * 错题本（696fdcb5，09-18）。改 answer/sub_no 不影响已产生判分记录，但修正参考答案
 * 会避免后续重练时用错误标答误判。
 *
 * 用法：node scripts/fix-q21-answer-20260920.mjs [--apply]
 * 惯例：默认 dry-run，--apply 落库；Redis 须指向不存在的端口（本脚本不 import worker，保险起见仍照做）。
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

// 每项：id 前缀 / 目标字段变更 / 理由
const FIXES = [
  {
    id: 'e1954c37', label: '5636fc30(合并式) (2)通式答案',
    // 答案是一整串 "9/10, √((n-1)(n+1))/n², 1/15, 2024/2025"，只替换 (2) 段
    transformAnswer: (a) => String(a).replace('√((n-1)(n+1))/n²', 'n/(n+1)'),
  },
  {
    id: 'd936f241', label: '007113e4 (2)缺sub_no+答案空',
    old: `sub=null answer=""`, setSubNo: '2', setAnswer: 'n/(n+1)',
  },
  {
    id: 'b1bb735c', label: '007113e4 (4)答案空',
    old: `answer=""`, setAnswer: '2024/2025',
  },
]

const { rows } = await query(
  `SELECT id, sub_no, answer FROM questions
   WHERE id::text LIKE ANY($1::text[]) AND deleted_at IS NULL
   ORDER BY id`,
  [FIXES.map(f => f.id + '%')])

const byId = new Map(rows.map(r => [r.id.slice(0, 8), r]))
const plan = []

for (const f of FIXES) {
  const r = byId.get(f.id)
  if (!r) { console.log(`⚠️ 未找到 ${f.id}`); continue }
  const before = {
    subNo: String(r.sub_no || '').trim() || null,
    answer: String(r.answer || ''),
  }
  const after = {
    subNo: f.setSubNo ?? before.subNo,
    answer: f.transformAnswer
      ? f.transformAnswer(before.answer)
      : (f.setAnswer ?? before.answer),
  }
  if (before.subNo === after.subNo && before.answer === after.answer) {
    console.log(`- ${f.id} ${f.label}: 已符合，跳过`)
    continue
  }
  plan.push({ id: r.id, label: f.label, before, after })
  console.log(`- ${f.id} ${f.label}:`)
  console.log(`  前: sub=${JSON.stringify(before.subNo)} answer=${JSON.stringify(before.answer)}`)
  console.log(`  后: sub=${JSON.stringify(after.subNo)} answer=${JSON.stringify(after.answer)}`)
}

const ts = Date.now()
const logdir = resolve(__dirname, 'logs')
fs.mkdirSync(logdir, { recursive: true })
const dump = resolve(logdir, `q21-answer-plan-${ts}.json`)
fs.writeFileSync(dump, JSON.stringify({ ts, apply: APPLY, count: plan.length, plan }, null, 2))
console.log(`\n📋 审计转储: ${dump}`)

if (!plan.length) { console.log('✅ 无需修改'); process.exit(0) }
if (!APPLY) { console.log('🔎 DRY-RUN（加 --apply 落库）'); process.exit(0) }

const snap = resolve(logdir, `q21-answer-fix-${ts}.json`)
fs.writeFileSync(snap, JSON.stringify({ ts, plan }, null, 2))

for (const p of plan) {
  if (p.after.subNo !== p.before.subNo) {
    await query(`UPDATE questions SET sub_no = $2 WHERE id = $1`, [p.id, p.after.subNo])
  }
  if (p.after.answer !== p.before.answer) {
    // answer_exception 的存根状态随答案就绪清零；risk 本为 null 不动
    await query(
      `UPDATE questions SET answer = $2, answer_exception = false, updated_at = NOW() WHERE id = $1`,
      [p.id, p.after.answer])
  }
}
await syncQuestionCompleteness(plan.map(p => p.id))
console.log(`\n💾 已写 ${plan.length} 条 · 回滚快照: ${snap}`)
process.exit(0)