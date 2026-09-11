/**
 * 修复「题型与题干自相矛盾」的存量题：question_type='choice' 但 options 为空，
 * 且题干有明确填空线、没有任何选择题证据（无内联 A–D 标号、不以空括号收尾）。
 *
 * 这类行的由来见 utils/questionCompleteness.js resolveEffectiveQuestionType 注释：
 * 练习册答案库的 answer_type 被无条件当作本题题型覆盖（worker.js 练习册匹配），
 * 填空题因此落库成「选择题 + options=[]」→ 完整性闸报「选择题缺少选项」→
 * 老师标错入册被拦，编辑页又只有选项区块（只在 choice 下渲染），无路可走。
 *
 * 只改 question_type 一个字段，不碰 content / options / answer（后三者直接影响
 * 判题与错题生命周期，属核心流程，脚本无权改）。
 *
 * 用法（在 server/ 下跑；pg 在 server/node_modules）：
 *   node scripts/fix-mistyped-question-types.mjs            # dry-run（默认）
 *   node scripts/fix-mistyped-question-types.mjs --apply    # 写库（先落快照）
 *   node scripts/fix-mistyped-question-types.mjs --limit=50
 *
 * --apply 会把整行快照写到 scripts/logs/fix-mistyped-types-<ts>.json，可按 before 回滚。
 * 写完调 syncQuestionCompleteness 回写 is_complete 缓存列（错题本/周报/讲义按它过滤）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(here, '..', '.env') })

import pg from 'pg'
import { checkQuestionCompleteness, resolveEffectiveQuestionType } from '../utils/questionCompleteness.js'

const __dirname = here
const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 500

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const { rows } = await pool.query(
    `SELECT q.id, q.task_id, q.student_id, q.page_number, q.question_number,
            q.question_type, q.options, q.answer, q.content, q.geometry_image_url,
            q.is_complete, q.created_at, t.task_type, t.original_name
     FROM questions q
     LEFT JOIN tasks t ON t.id = q.task_id
     WHERE q.deleted_at IS NULL
       AND q.question_type = 'choice'
       AND (q.options IS NULL OR (jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) = 0))
     ORDER BY q.created_at DESC
     LIMIT $1`,
    [LIMIT]
  )

  const fixable = []
  const keep = []
  for (const r of rows) {
    const resolved = resolveEffectiveQuestionType({
      question_type: r.question_type,
      content: r.content,
      options: r.options
    })
    if (resolved.corrected) {
      const after = checkQuestionCompleteness({ ...r, question_type: resolved.type })
      fixable.push({ ...r, _targetType: resolved.type, _completeAfter: after.isComplete, _issuesAfter: after.issues })
    } else {
      keep.push(r)
    }
  }

  console.log(`\n扫描 «choice 且 options 为空» 命中 ${rows.length} 条`)
  console.log(`  · 可纠偏（题干是填空题）: ${fixable.length}`)
  console.log(`  · 保留不动（真·缺选项选择题，仍需老师补选项）: ${keep.length}`)
  console.log(`  · 模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（只读）'}`)

  if (fixable.length > 0) {
    console.log('\n可纠偏明细:')
    console.table(fixable.map(r => ({
      题号: `p${r.page_number}#${r.question_number}`,
      原题型: r.question_type,
      目标题型: r._targetType,
      改后是否完整: r._completeAfter ? 'Y' : `N(${r._issuesAfter.join('|')})`,
      练习册: (r.original_name || '').slice(0, 24),
      题干: String(r.content || '').replace(/\s+/g, ' ').slice(0, 46)
    })))
  }
  if (keep.length > 0) {
    console.log('\n保留不动明细（这些必须靠「重新识别本题」补选项，不能纠偏）:')
    console.table(keep.map(r => ({
      题号: `p${r.page_number}#${r.question_number}`,
      题型: r.question_type,
      答案: String(r.answer ?? '').slice(0, 12),
      题干: String(r.content || '').replace(/\s+/g, ' ').slice(0, 46)
    })))
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未写库。确认明细后加 --apply 执行。')
    await pool.end()
    return
  }
  if (fixable.length === 0) {
    console.log('\n无需修复。')
    await pool.end()
    return
  }

  const logDir = path.join(__dirname, 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = path.join(logDir, `fix-mistyped-types-${ts}.json`)
  fs.writeFileSync(snapshotPath, JSON.stringify({
    created_at: new Date().toISOString(),
    rows: fixable.map(r => ({
      id: r.id, task_id: r.task_id, page_number: r.page_number, question_number: r.question_number,
      before: { question_type: r.question_type, is_complete: r.is_complete },
      after: { question_type: r._targetType },
      content: r.content
    }))
  }, null, 2))
  console.log(`\n快照已写入: ${snapshotPath}`)

  const csvPath = path.join(logDir, `fix-mistyped-types-${ts}.csv`)
  const header = ['id', 'task_type', 'original_name', 'page_number', 'question_number', 'old_type', 'new_type', 'is_complete_after', 'content']
  fs.writeFileSync(csvPath, '\ufeff' + [
    header.join(','),
    ...fixable.map(r => [
      r.id, r.task_type, r.original_name, r.page_number, r.question_number,
      r.question_type, r._targetType, r._completeAfter ? 'TRUE' : 'FALSE',
      String(r.content || '').replace(/\s+/g, ' ')
    ].map(csvCell).join(','))
  ].join('\n'))
  console.log(`报告已写入: ${csvPath}`)

  let updated = 0
  for (const r of fixable) {
    const res = await pool.query(
      `UPDATE questions SET question_type = $1, updated_at = NOW()
       WHERE id = $2 AND question_type = 'choice'
         AND (options IS NULL OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 0))`,
      [r._targetType, r.id]
    )
    updated += res.rowCount || 0
  }
  console.log(`\n已更新 ${updated} 行`)

  const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')
  const sync = await syncQuestionCompleteness(fixable.map(r => r.id))
  console.log(`is_complete 回写: checked=${sync.checked} updated=${sync.updated}`)

  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })
