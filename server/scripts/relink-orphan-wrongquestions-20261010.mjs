/**
 * relink-orphan-wrongquestions-20261010.mjs — 孤儿错题存量清理（一次性，负责人已授权）
 *
 * 背景：重跑删档 → ON DELETE SET NULL（迁移005）→ 错题记录断链成孤儿。
 *       负责人裁决「断根+清存量，都走情况A」（断根已在 commit 17f8763 落地）。
 *
 * 处置口径（与断根同一匹配实现，planRelinks/planForOrphan）：
 *   relink — 同学生同task同题号档案行空闲 → 接回（UPDATE question_id）
 *   merge  — 档案已被占用（= 重跑后同一份答卷已重新入册同题）→ 删孤儿（重复影子）
 *   keep   — 配不上（小问结构变化且内容无法唯一定位 / task无档案行）→ 保持 NULL 不动
 *
 * 安全措施：
 *   ① 执行前整表备份：CREATE TABLE _backup_wq_orphans_20261010 + JSON 导出
 *   ② UPDATE/DELETE 都带 question_id IS NULL 守卫——执行瞬间状态已变的行绝不碰
 *   ③ 默认 dry-run 打印全部清单；--apply 才写库
 *   ④ merge 只删孤儿行本身，绝不动占用者（活记录）
 *
 * 用法：node scripts/relink-orphan-wrongquestions-20261010.mjs           # dry-run
 *       node scripts/relink-orphan-wrongquestions-20261010.mjs --apply  # 实际执行
 */
import '../loadEnv.js'
import { query } from '../config/neon.js'
import { planRelinks } from '../utils/wrongQuestionRelink.js'
import { writeFileSync, mkdirSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const BACKUP_TABLE = '_backup_wq_orphans_20261010'

const run = async () => {
  // 1. 拉孤儿与档案行
  const { rows: orphans } = await query(`
    SELECT o.id, o.student_id, o.last_wrong_task_id, o.question_no, o.content,
           o.source_type, o.subject, o.error_count, o.lifecycle_status, o.added_at
    FROM wrong_questions o
    WHERE o.question_id IS NULL
    ORDER BY o.added_at DESC`)
  console.log(`孤儿总数: ${orphans.length}`)

  const { rows: qRows } = await query(`
    SELECT q.id, q.student_id, q.task_id, q.question_number, q.sub_no, q.content,
      EXISTS (SELECT 1 FROM wrong_questions w WHERE w.question_id = q.id) AS occupied
    FROM questions q WHERE q.task_id IS NOT NULL`)

  const archiveByStTask = new Map()
  for (const q of qRows) {
    const k = `${q.student_id}|${q.task_id}`
    if (!archiveByStTask.has(k)) archiveByStTask.set(k, [])
    archiveByStTask.get(k).push(q)
  }

  // 2. 规划
  const plans = planRelinks(orphans, archiveByStTask)
  const byId = new Map(orphans.map(o => [o.id, o]))
  const relinkPlans = plans.filter(p => p.action === 'relink')
  const mergePlans = plans.filter(p => p.action === 'merge')
  const keepPlans = plans.filter(p => p.action === 'keep')
  console.log(`规划结果: 接回(relink)=${relinkPlans.length}  合并(merge,删孤儿)=${mergePlans.length}  保持(keep)=${keepPlans.length}`)

  const brief = (o) => `[${o.source_type || '-'}] ${(o.added_at?.toISOString?.() || '').slice(0, 10)} err=${o.error_count} ${o.lifecycle_status || '-'} | ${(o.content || '').replace(/\s+/g, ' ').slice(0, 26)}`
  for (const p of relinkPlans) console.log(`  RELINK ${brief(byId.get(p.wqId))} → q=${String(p.targetId).slice(0, 8)}`)
  for (const p of mergePlans) console.log(`  MERGE  ${brief(byId.get(p.wqId))} (占用者 q=${String(p.targetId).slice(0, 8)})`)
  for (const p of keepPlans) console.log(`  KEEP   ${brief(byId.get(p.wqId))} — ${p.reason}`)

  if (!APPLY) {
    console.log('\n== DRY-RUN 结束（加 --apply 执行）==')
    return
  }

  // 3. 备份（先于任何写入）
  const { rows: backupRows } = await query(
    `SELECT * FROM wrong_questions WHERE question_id IS NULL`
  )
  await query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`)
  await query(`CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM wrong_questions WHERE question_id IS NULL`)
  mkdirSync('logs', { recursive: true })
  const jsonPath = 'logs/wq-orphans-backup-20261010.json'
  writeFileSync(jsonPath, JSON.stringify({ backedUpAt: new Date().toISOString(), backupTable: BACKUP_TABLE, rows: backupRows }, null, 2))
  console.log(`\n备份完成: 表 ${BACKUP_TABLE} (${backupRows.length} 行) + ${jsonPath}`)

  // 4. 执行 relink（守卫：仅当仍为 NULL）
  // ⛔ 先到先得：多条孤儿可能规划到同一目标档案（同一道题被重跑断链多次留下的多条
  //    影子，静态规划时互相看不见 occupied）。第一条接回后，同目标的后续孤儿降级为
  //    merge（删除）——同学生同档案只能有一条错题（唯一索引），删的是重复影子。
  //    撞 23505 也降级 merge（并发保险）。脚本可重入：重跑会基于新状态重新规划。
  let relinked = 0
  let demoted = 0
  const claimedTargets = new Set()
  for (const p of relinkPlans) {
    if (claimedTargets.has(p.targetId)) {
      const { rowCount } = await query(
        `DELETE FROM wrong_questions WHERE id = $1 AND question_id IS NULL`,
        [p.wqId]
      )
      mergedCount += rowCount || 0
      demoted += rowCount || 0
      continue
    }
    try {
      const { rowCount } = await query(
        `UPDATE wrong_questions SET question_id = $1, updated_at = NOW()
          WHERE id = $2 AND question_id IS NULL`,
        [p.targetId, p.wqId]
      )
      relinked += rowCount || 0
      if (rowCount > 0) claimedTargets.add(p.targetId)
    } catch (e) {
      if (e?.code === '23505') {
        const { rowCount } = await query(
          `DELETE FROM wrong_questions WHERE id = $1 AND question_id IS NULL`,
          [p.wqId]
        )
        mergedCount += rowCount || 0
        demoted += rowCount || 0
      } else throw e
    }
  }
  console.log(`接回完成: ${relinked}/${relinkPlans.length}（同目标降级合并 ${demoted} 条）`)

  // 5. 执行 merge（守卫：仅当仍为 NULL；只删孤儿，不动占用者）
  let mergedCount = 0
  for (const p of mergePlans) {
    const { rowCount } = await query(
      `DELETE FROM wrong_questions WHERE id = $1 AND question_id IS NULL`,
      [p.wqId]
    )
    mergedCount += rowCount || 0
  }
  console.log(`合并完成(删重复孤儿): ${mergedCount} 条`)

  // 6. 校验
  const { rows: after } = await query(
    `SELECT COUNT(*)::int AS orphans FROM wrong_questions WHERE question_id IS NULL`)
  console.log(`\n执行后剩余孤儿(keep): ${after[0].orphans}（应等于规划 keep ${keepPlans.length}）`)
  console.log('== APPLY 完成 ==')
}

run().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1) })
