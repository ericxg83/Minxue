/**
 * 清理「纯降级标注」（2026-10-10，负责人要求）
 *
 * 背景：`ai_answer_risk_reason` 里那段「参考答案由降级通道 X 生成（主模型不可用），建议核对」
 * 是**环境噪音** —— 主模型当时被限流 ≠ 答案错。它让 332 条本来 AI 已判好的题被塞进复核页「待处理」
 * （判据 `src/utils/reviewDecision.js#needsHumanAttention`），老师要逐条点掉。
 *
 * ⛔ 但**只清「整条仅含降级段」的**：
 *   还有 45 条的标注里混着「参考答案存疑：多路求解分歧/多数一致（候选：…）」——
 *   那是**模型自己都不确定**的真信号（实测有一条三路给出 5/2、17/7、17/14 全不同），
 *   抹掉等于把可能错的参考答案永久藏起来，违背「宁可留空转人工，不要错答案」口径 ⇒ 保留。
 *
 * ⛔ 不动 `review_status`（这些题本来就是 NULL）；不动 `is_correct`；不动答案本身。
 *
 * 用法：
 *   node server/scripts/clear-degraded-risk-notes-1010.mjs            # dry-run（默认，只出清单）
 *   node server/scripts/clear-degraded-risk-notes-1010.mjs --apply    # 真写库
 */
import '../loadEnv.js'
import { writeFileSync } from 'node:fs'
import { query } from '../config/neon.js'

const APPLY = process.argv.includes('--apply')

// 整条**恰好等于**降级段模板（全角括号；通道名任意，但不许含分号）
const PURE_DEGRADE = '^参考答案由降级通道 [^；;]+ 生成（主模型不可用），建议核对$'

const BASE = `ai_answer_risk_reason LIKE '%降级通道%'
  AND review_status IS NULL
  AND is_correct IS NOT NULL`

const pure = await query(`
  SELECT id, task_id, ai_answer_risk_reason, answer, answer_source, is_correct, question_number, question_type
  FROM questions WHERE ${BASE} AND ai_answer_risk_reason ~ $1 ORDER BY id`, [PURE_DEGRADE])

const mixed = await query(`
  SELECT id, ai_answer_risk_reason FROM questions
  WHERE ${BASE} AND ai_answer_risk_reason !~ $1 ORDER BY id`, [PURE_DEGRADE])

console.log('='.repeat(96))
console.log(APPLY ? '⚠️  APPLY 模式（会写库）' : 'DRY-RUN（只出清单，不写库）')
console.log('='.repeat(96))
console.log(`  纯降级标注（本次要清）： ${pure.rows.length} 条`)
console.log(`  含共识信号的（保留）：   ${mixed.rows.length} 条`)
console.log(`  合计：                   ${pure.rows.length + mixed.rows.length} 条`)

// 备份原值（回滚依据）
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const backupPath = `server/_backup_risk_notes_${stamp}.json`
writeFileSync(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  reason: '清理纯降级标注前的原值备份（回滚用：按 id 把 ai_answer_risk_reason 写回即可）',
  count: pure.rows.length,
  rows: pure.rows.map(r => ({ id: r.id, ai_answer_risk_reason: r.ai_answer_risk_reason })),
}, null, 2))
console.log(`\n  原值备份 → ${backupPath}`)

console.log('\n【保留的 45 条里，共识候选真正不一致的样例】')
for (const r of mixed.rows.slice(0, 3)) {
  console.log('  - ' + String(r.ai_answer_risk_reason).slice(0, 150))
}

if (!APPLY) {
  console.log('\n（dry-run 结束。加 --apply 才真正写库）')
  process.exit(0)
}

const ids = pure.rows.map(r => r.id)
const res = await query(`
  UPDATE questions SET ai_answer_risk_reason = NULL
  WHERE id = ANY($1::uuid[]) AND ai_answer_risk_reason ~ $2`, [ids, PURE_DEGRADE])
console.log(`\n✅ 已清理 ${res.rowCount} 条`)

const after = await query(`SELECT count(*)::int n FROM questions WHERE ${BASE}`)
console.log(`   清理后仍带「降级通道」标注且未复核的：${after.rows[0].n} 条（应等于保留数 ${mixed.rows.length}）`)
process.exit(0)
