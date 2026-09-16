import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// 错题本跨卷串行存量修复（2026-09-16，方案A P3）
//
// 串行行判据：question_id 所属题的 task_id ≠ 该行 last_wrong_task_id
//   （即「快照被另一份卷的批改覆盖，但行的 question_id 还指着旧卷的题」）。
//
// 修复策略（与写入侧方案A一致 = 行代表「最近一次做错」）：
//   1) last_wrong_task_id 对应卷里存在同题号的题 → 行改挂那道题（question_id 更新），
//      content/correct_answer/question_type/answer_type 从该题刷新（快照本就来自那次批改）；
//      若同学生已有挂那道题的另一行（唯一索引冲突）→ 跳过并告警，不自动合并。
//   2) 找不到 → 说明该行声称的「最近做错任务」里没有这道题（历史脏行），
//      回退：快照从 question_id 所属题恢复（student_answer/correct_answer/content），
//      last_wrong_task_id 同步改为该题的 task_id。
//
// 用法：node scripts/fix-wrongbook-snapshot-20260916.mjs            （dry-run，只读）
//       node scripts/fix-wrongbook-snapshot-20260916.mjs --apply    （写库，先备份）
// ============================================================

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (s, p) => pool.query(s, p)

const run = async () => {
  const { rows: serial } = await q(`
    SELECT wq.id, wq.student_id, wq.worksheet_id, wq.question_no, wq.page_number,
           wq.question_id, wq.last_wrong_task_id,
           wq.student_answer, wq.correct_answer, wq.content,
           q.task_id AS question_task_id
    FROM wrong_questions wq
    JOIN questions q ON q.id = wq.question_id
    WHERE wq.question_id IS NOT NULL
      AND wq.last_wrong_task_id IS NOT NULL
      AND q.task_id <> wq.last_wrong_task_id
    ORDER BY wq.updated_at DESC`)

  console.log(`串行行（question_id 所属 task ≠ last_wrong_task_id）: ${serial.length} 行`)
  if (serial.length === 0) { await pool.end(); return }

  const plan = []
  for (const r of serial) {
    // 目标题 = 最近做错任务里的同题号题
    const { rows: t2q } = await q(`
      SELECT id, task_id, content, answer, question_type
      FROM questions
      WHERE task_id = $1::uuid AND question_number = $2
      ORDER BY id LIMIT 1`, [r.last_wrong_task_id, r.question_no])
    const target = t2q[0]
    if (target && target.id !== r.question_id) {
      // 冲突检查：同学生是否已有挂目标题的另一行
      const { rows: clash } = await q(`
        SELECT id FROM wrong_questions
        WHERE student_id = $1::uuid AND question_id = $2::uuid AND id <> $3::uuid`,
        [r.student_id, target.id, r.id])
      if (clash.length > 0) {
        // 最近一次做错已有健康行记录 → 本行是陈旧重复：
        //   原题仍判错 → 回退恢复成「更早那次做错」的记录；原题已不再判错 → 纯垃圾行，删。
        const { rows: oq } = await q(`
          SELECT is_correct, student_answer, answer, content FROM questions WHERE id = $1::uuid`, [r.question_id])
        const stillWrong = oq[0]?.is_correct === false
        plan.push({
          ...r, action: stillWrong ? 'restore' : 'delete',
          q1Student: oq[0]?.student_answer ?? null, q1Answer: oq[0]?.answer ?? null, q1Content: oq[0]?.content ?? null,
          note: stillWrong ? '冲突但原题仍判错 → 回退恢复' : '冲突且原题已不再判错 → 删除垃圾行'
        })
      } else {
        plan.push({
          ...r, action: 'reattach', targetQuestionId: target.id,
          t2content: target.content, t2answer: target.answer, t2type: target.question_type
        })
      }
    } else if (target && target.id === r.question_id) {
      plan.push({ ...r, action: 'noop', note: '目标题与当前 question_id 相同（无需修复）' })
    } else {
      const { rows: q1 } = await q(`
        SELECT student_answer, answer, content FROM questions WHERE id = $1::uuid`, [r.question_id])
      plan.push({
        ...r, action: 'restore',
        q1Student: q1[0]?.student_answer ?? null, q1Answer: q1[0]?.answer ?? null, q1Content: q1[0]?.content ?? null,
        note: 'last_wrong_task_id 卷中无此题号 → 回退恢复'
      })
    }
  }

  const counts = plan.reduce((m, p) => { m[p.action] = (m[p.action] || 0) + 1; return m }, {})
  console.log('修复计划:', JSON.stringify(counts))

  for (const p of plan) {
    const label = `行${p.id.slice(0, 8)} 学生${p.student_id.slice(0, 8)} ws${String(p.worksheet_id).slice(0, 8)} 题${p.question_no}`
    if (p.action === 'reattach') {
      console.log(`  [reattach] ${label} → question_id ${p.question_id.slice(0, 8)} → ${p.targetQuestionId.slice(0, 8)}`)
    } else if (p.action === 'restore') {
      console.log(`  [restore ] ${label} ← 从 question_id ${p.question_id.slice(0, 8)} 恢复快照 (${p.note})`)
    } else if (p.action === 'delete') {
      console.log(`  [delete  ] ${label} ${p.note}`)
    } else {
      console.log(`  [noop    ] ${label} ${p.note}`)
    }
  }

  const toApply = plan.filter(p => ['reattach', 'restore', 'delete'].includes(p.action))
  if (!APPLY) {
    console.log(`\nDRY-RUN：将写库 ${toApply.length} 行。确认无误后加 --apply 执行。`)
    await pool.end(); return
  }

  // 备份
  const backupDir = 'D:/Minxue_App_V3/server/backups'
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, `wrongbook-snapshot-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const { rows: backupRows } = await q(`SELECT * FROM wrong_questions WHERE id = ANY($1::uuid[])`, [toApply.map(p => p.id)])
  fs.writeFileSync(backupFile, JSON.stringify(backupRows, null, 2))
  console.log(`已备份 ${backupRows.length} 行 → ${backupFile}`)

  let n = 0
  for (const p of toApply) {
    if (p.action === 'reattach') {
      const r = await q(`
        UPDATE wrong_questions wq SET
          question_id = $2::uuid,
          content = COALESCE($3, wq.content),
          correct_answer = COALESCE($4, wq.correct_answer),
          question_type = COALESCE($5, wq.question_type),
          answer_type = COALESCE($5, wq.answer_type),
          updated_at = NOW()
        WHERE wq.id = $1::uuid`, [p.id, p.targetQuestionId, p.t2content ?? null, p.t2answer ?? null, p.t2type ?? null])
      n += r.rowCount
    } else if (p.action === 'restore') {
      const r = await q(`
        UPDATE wrong_questions wq SET
          student_answer = COALESCE($2, wq.student_answer),
          correct_answer = COALESCE($3, wq.correct_answer),
          content = COALESCE($4, wq.content),
          last_wrong_task_id = $5::uuid,
          updated_at = NOW()
        WHERE wq.id = $1::uuid`, [p.id, p.q1Student, p.q1Answer, p.q1Content, p.question_task_id])
      n += r.rowCount
    } else if (p.action === 'delete') {
      const r = await q(`DELETE FROM wrong_questions WHERE id = $1::uuid`, [p.id])
      n += r.rowCount
    }
  }
  console.log(`\n✅ 已修复 ${n} 行`)

  // 复检
  const { rows: left } = await q(`
    SELECT COUNT(*) AS n FROM wrong_questions wq
    JOIN questions q2 ON q2.id = wq.question_id
    WHERE wq.question_id IS NOT NULL AND wq.last_wrong_task_id IS NOT NULL
      AND q2.task_id <> wq.last_wrong_task_id`)
  console.log(`复检剩余串行行: ${left[0].n}`)
  await pool.end()
}

run().catch(e => { console.error('失败:', e); process.exit(1) })
