/**
 * wrongQuestionRelink.js — 重跑后把错题记录接回新题库档案（唯一口径）
 *
 * 背景（2026-10-10，负责人裁决「断根+清存量，都走情况A」）：
 *   重跑链路 deleteQuestionsByTaskId 删旧题库行重建，wrong_questions.question_id
 *   外键 ON DELETE SET NULL（迁移 005「删卷不删错题」）⇒ 错题记录保住但题库指向
 *   断开，成为「孤儿」：无法去原题编辑、无法进重练卷，且与重跑后重新入册的
 *   同题记录并存（错题本重复）。
 *
 * 两个消费场景共用本模块：
 *   ① 断根：worker 重跑管线在删档前 snapshotWrongQuestionsForTask()、
 *      重建后 relinkWithSnapshot() —— snapshot 带旧档案的 (question_number, sub_no)，
 *      与新行按二元组**精确匹配**（同一张卷重跑，题号/小问结构即身份）。
 *   ② 清存量：scripts/relink-orphan-wrongquestions-*.mjs 用 planRelinks() 对
 *      历史孤儿做接回/合并规划 —— 孤儿没有 sub_no，同题号多行时以内容归一化
 *      逐字相同辅助定位（⛔ 无任何相似度阈值，逐字相等才算，不满足宁可不接）。
 *
 * ⛔ 铁律：
 *   · 禁止相似度合并（AGENTS.md 禁止事项 6 / questionIdentity 同一题口径）。
 *     本模块所有匹配都是**精确匹配**：题号/小问号相等、或内容去空白小写后逐字相等。
 *   · 匹配不上就保持 NULL（keep），宁可少接不硬接——接错档案比不接更糟。
 *   · 合并（删孤儿）只允许在「同学生同task同题号的档案已被占用」时：
 *     占用者必然是重跑后从**同一份答卷**重新入册的记录，与孤儿信息重复，无损失。
 */

/** 内容归一化：去全部空白 + 小写。仅用于辅助定位小问行，非相似度。 */
export const normContent = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

/**
 * 【断根①】重跑删档前调用：记下挂在旧档案上的错题记录及其身份。
 * @param {Function} query  db 查询函数（注入，便于测试）
 * @param {string} taskId
 * @returns {Promise<Array<{wqId, questionNumber, subNo, content}>>}
 */
export const snapshotWrongQuestionsForTask = async (query, taskId) => {
  const { rows } = await query(
    `SELECT wq.id AS wq_id, q.question_number, q.sub_no, wq.content
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
      WHERE q.task_id = $1`,
    [taskId]
  )
  return rows.map(r => ({
    wqId: r.wq_id,
    questionNumber: r.question_number,
    subNo: r.sub_no,
    content: r.content || '',
  }))
}

/**
 * 纯函数：为一个孤儿规划处置动作。
 * @param {Object} orphan  { wqId, questionNumber?, subNo?, content }
 * @param {Array}  archiveRows 同学生(同task)的档案行 [{id, question_number, sub_no, content, occupied}]
 * @returns {{action: 'relink'|'merge'|'keep', targetId?: string, reason: string}}
 */
export const planForOrphan = (orphan, archiveRows) => {
  const sameNo = archiveRows.filter(
    q => String(q.question_number ?? '') === String(orphan.questionNumber ?? '')
  )
  if (sameNo.length === 0) {
    return { action: 'keep', reason: '同task下无同题号档案行' }
  }
  let target = null
  // 多行（小问拆分）时：优先按 sub_no 精确匹配（断根场景 snapshot 带小问号，最可靠）；
  // 小问号不可用（清存量场景孤儿已丢失）再以内容归一化逐字相同辅助定位。
  if (orphan.subNo != null) {
    const bySub = sameNo.filter(q => String(q.sub_no ?? '') === String(orphan.subNo ?? ''))
    if (bySub.length === 1) target = bySub[0]
    else if (sameNo.length === 1 && bySub.length === 0) {
      // 重跑后小问结构变化（如2问变3问）：小问号对不上，宁可不接
      return { action: 'keep', reason: `第${orphan.questionNumber}题小问结构在重跑后变化(${sameNo.length}行)，不硬接` }
    }
  }
  if (!target) {
    const byContent = sameNo.filter(q => normContent(q.content) === normContent(orphan.content))
    if (byContent.length !== 1) {
      return { action: 'keep', reason: `第${orphan.questionNumber}题拆${sameNo.length}行且内容无法唯一定位，不硬接` }
    }
    target = byContent[0]
  }
  if (target.occupied) {
    return { action: 'merge', targetId: target.id, reason: '档案已被重跑后重新入册的同题记录占用' }
  }
  return { action: 'relink', targetId: target.id, reason: '同task同题号档案行空闲' }
}

/**
 * 纯函数：批量规划（清存量用）。
 * @param {Array} orphans     孤儿行（含 student_id/last_wrong_task_id/question_no/content）
 * @param {Map}   archiveByStTask  Map<"student|task", archiveRows[]>
 * @returns {Array<{wqId, action, targetId?, reason}>}
 */
export const planRelinks = (orphans, archiveByStTask) =>
  orphans.map(o => {
    const rows = archiveByStTask.get(`${o.student_id}|${o.last_wrong_task_id}`) || []
    const plan = planForOrphan(
      {
        wqId: o.id,
        questionNumber: o.question_no,
        subNo: null, // 孤儿丢失了小问号，只能靠内容辅助
        content: o.content,
      },
      rows
    )
    return { wqId: o.id, ...plan }
  })

/**
 * 【断根②】重跑重建题库行后调用：把 snapshot 里的错题接回新档案行。
 *
 * @param {Function} query      db 查询函数
 * @param {string}   taskId     重跑的 task
 * @param {Array}    snapshot   snapshotWrongQuestionsForTask 的返回
 * @param {Array}    newRows    重建后的新档案行 [{id, question_number, sub_no, content}]
 * @returns {Promise<{relinked: number, kept: number, reasons: string[]}>}
 */
export const relinkWithSnapshot = async (query, taskId, snapshot, newRows) => {
  if (!snapshot?.length || !newRows?.length) {
    return { relinked: 0, kept: snapshot?.length || 0, reasons: [] }
  }
  const archiveRows = newRows.map(q => ({
    id: q.id,
    question_number: q.question_number,
    sub_no: q.sub_no,
    content: q.content || '',
    occupied: false, // 刚重建的行不可能被占用
  }))
  const reasons = []
  let relinked = 0
  let kept = 0
  for (const snap of snapshot) {
    const plan = planForOrphan(snap, archiveRows)
    if (plan.action !== 'relink') {
      kept++
      reasons.push(`wq=${String(snap.wqId).slice(0, 8)} keep: ${plan.reason}`)
      continue
    }
    // ⛔ 守卫条件 question_id IS NULL：执行瞬间若该错题已被其他链路接走/处理，绝不覆盖
    const { rowCount } = await query(
      `UPDATE wrong_questions
          SET question_id = $1, updated_at = NOW()
        WHERE id = $2 AND question_id IS NULL`,
      [plan.targetId, snap.wqId]
    )
    if (rowCount > 0) relinked++
    else kept++
  }
  return { relinked, kept, reasons }
}
