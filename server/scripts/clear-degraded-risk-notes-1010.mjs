/**
 * 清理「同档通道」的降级标注（2026-10-10，负责人要求）
 *
 * 背景：`ai_answer_risk_reason` 里那段「参考答案由降级通道 X 生成（主模型不可用），建议核对」
 * 是**环境噪音** —— 主模型当时被限流 ≠ 答案错。它让本来 AI 已判好的题被塞进复核页「待处理」
 * （判据 `src/utils/reviewDecision.js#needsHumanAttention`），老师要逐条点掉。
 *
 * 2026-10-10 负责人明确：`Bailian:qwen3.8-flash` 实测与主模型并列满分（横评 20/20），
 * 不该被当成降级要老师核对 ⇒ 它（以及同档的 glm-5.2 / deepseek-v4-pro）的降级标注一律去掉。
 * 名单与代码**同源**（`config/ai.js` 的 `ANSWER_ENGINE_TRUSTED`），不在这里另写一份。
 *
 * 处理分两类：
 *   ① 整条就是降级段           → 清空（NULL），这题从「待处理」里消失
 *   ② 降级段 + 共识段混在一起   → **只删降级段，保留共识段**。共识段是模型自己都不确定的
 *      真信号（实测有一条三路给出 5/2、17/7、17/14 全不同），抹掉等于把可能错的参考答案
 *      永久藏起来，违背「宁可留空转人工，不要错答案」口径。
 *
 * ⛔ 弱通道（fallback-text-chain / Huihuiyun / BigModel glm-4.7-flash / sensenova-6.8-lite）
 *    的标注**不动** —— 它们实测确实偏弱，提醒是对的。
 * ⛔ 不动 `review_status`、不动 `is_correct`、不动答案本身、不动 `answer_exception_reason`。
 *
 * 用法：
 *   node server/scripts/clear-degraded-risk-notes-1010.mjs            # dry-run（默认，只出清单）
 *   node server/scripts/clear-degraded-risk-notes-1010.mjs --apply    # 真写库
 */
import '../loadEnv.js'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '../config/neon.js'
import { ANSWER_ENGINE_TRUSTED } from '../config/ai.js'

// 备份路径按**脚本自身位置**解析 —— 原先写成相对路径 `server/_backup_*.json`，
// 从 server/ 目录跑就变成 server/server/…，dry-run 直接崩在写文件上（2026-10-10 实测）。
const HERE = dirname(fileURLToPath(import.meta.url))

const APPLY = process.argv.includes('--apply')

// 降级段：总在整条标注的**末尾**（buildAnswerTrustNotes 先 push 共识、后 push 降级；
// flagReferenceAnswerRisk 用 '；' 拼 [风险, 共识, 降级]）。两种形态都存在：
//   「参考答案由降级通道 Bailian:qwen3.8-flash 生成（主模型不可用），建议核对」
//   「参考答案由降级通道 Huihuiyun:deepseek-v4-flash 生成」      ← 无后缀的旧形态
const DEGRADE_RE = /[；;]?\s*参考答案由降级通道\s+(\S+?)\s+生成[^；;]*$/
const ENGINE_RE = /参考答案由降级通道\s+(\S+?)\s+生成/

const { rows } = await query(`
  SELECT id, task_id, ai_answer_risk_reason, is_correct, review_status, question_number
  FROM questions
  WHERE ai_answer_risk_reason LIKE '%降级通道%'
  ORDER BY id`)

const plan = []
const keep = []
for (const r of rows) {
  const text = String(r.ai_answer_risk_reason || '')
  const engine = (text.match(ENGINE_RE) || [])[1] || ''
  if (!ANSWER_ENGINE_TRUSTED.includes(engine)) {
    keep.push({ ...r, engine })
    continue
  }
  const next = text.replace(DEGRADE_RE, '').replace(/[；;]\s*$/, '').trim()
  plan.push({ id: r.id, engine, before: text, after: next })
}

const cleared = plan.filter(p => !p.after)
const trimmed = plan.filter(p => p.after)

console.log('='.repeat(96))
console.log(APPLY ? '⚠️  APPLY 模式（会写库）' : 'DRY-RUN（只出清单，不写库）')
console.log('='.repeat(96))
console.log(`  同档通道名单（与 config/ai.js 同源）：${ANSWER_ENGINE_TRUSTED.join(' , ')}`)
console.log(`  带「降级通道」标注的题合计：        ${rows.length} 条`)
console.log(`    · 其中同档通道 → 本次处理：       ${plan.length} 条`)
console.log(`        - 整条都是降级段 → 清空：     ${cleared.length} 条`)
console.log(`        - 降级段 + 共识段 → 只删降级：${trimmed.length} 条`)
console.log(`    · 弱通道 → 保留不动：             ${keep.length} 条`)

// 断言：只删降级段，绝不能把共识信号一起抹掉
const bad = trimmed.filter(p => !/参考答案存疑/.test(p.after))
if (bad.length) {
  console.log(`\n  ⛔ 有 ${bad.length} 条删完剩下的是非共识文本，请先人工看：`)
  for (const b of bad.slice(0, 5)) console.log(`     - [${b.id}] ${b.after.slice(0, 140)}`)
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = resolve(HERE, '..', `_backup_risk_notes_trusted_${stamp}.json`)
writeFileSync(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  reason: '清理同档通道降级标注前的原值备份（回滚：按 id 把 ai_answer_risk_reason 写回即可）',
  trusted: ANSWER_ENGINE_TRUSTED,
  count: plan.length,
  rows: plan.map(p => ({ id: p.id, before: p.before, after: p.after || null }))
}, null, 2))
console.log(`\n  原值备份 → ${backupPath}`)

console.log('\n【保留不动的弱通道，按通道分组】')
const byKeep = new Map()
for (const k of keep) byKeep.set(k.engine, (byKeep.get(k.engine) || 0) + 1)
for (const [e, n] of [...byKeep.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${e.padEnd(34)} ${n} 条`)
}

if (!APPLY) {
  console.log('\n（dry-run 结束。加 --apply 才真正写库）')
  process.exit(0)
}

const ids = plan.map(p => p.id)
const nexts = plan.map(p => (p.after || null))
const res = await query(`
  UPDATE questions AS q
  SET ai_answer_risk_reason = v.reason, updated_at = NOW()
  FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS reason) AS v
  WHERE q.id = v.id`, [ids, nexts])
console.log(`\n✅ 已处理 ${res.rowCount} 条`)

const after = await query(`
  SELECT count(*)::int n FROM questions WHERE ai_answer_risk_reason LIKE '%降级通道%'`)
console.log(`   清理后仍带「降级通道」标注的：${after.rows[0].n} 条（应等于保留数 ${keep.length}）`)
process.exit(0)
