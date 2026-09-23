/**
 * 闸1（L0 卷级自动完成）判据 —— 唯一口径
 *
 * ── 这个文件解决什么问题（2026-09-23）──
 * 老师的目的：「AI 已经判定是正确是错误，那就应该自动复核」。实测近 14 天
 * 106 份卷里有 43 份停在 `status='done'`（结果已出、老师没点完成复核），
 * 其中**真正需要老师拍板的只有 9 题（5%）**，其余 183 题全是：
 *   · 未作答 83 题 —— 终态，老师本就无事可拍板
 *   · 缺少参考答案 / 答案与题不匹配 85 题 —— AI 已判错，缺的是系统侧元素
 *   · 无原因 6 题 —— 元素完整，纯漏入
 * 这些把整卷拦下，老师只能点一次「本次不加入」记录一次系统故障 ⇒ 纯冗余。
 *
 * ── 分层原则（负责人 2026-09-23 确认，不可越过）──
 *   L0 已判出（is_correct 非空）→ 自动复核
 *   L1 系统侧缺口（缺图/缺选项/缺答案）→ **先补再判**，不拦老师
 *   L2 真判不出（低置信需拍板 / AI 未判定 / 处理中）→ 留人工
 *
 * ⚠️ 本文件只判「卷能不能自动完成」，**不判「题进不进错题本」**。
 * 两者的分层判据不同（入册看 wrongGateTier.js），不可互相代替：
 * 一道 low_confidence 的 AI 判错题可以拦住「入册弹窗」，但它已经判出正误，
 * 不该拦住「整卷完成复核」——老师完成复核与这题算不算错是两件事。
 *
 * 纯函数、无平台依赖：移动端 React 与 PC Vue 共用（当前仅 PC 消费）。
 */

/**
 * 有效正误结论。与 src/utils/reviewDecision.js 的 effectiveIsCorrect 同源语义，
 * 这里本地实现以保持本文件零依赖（供 worker/脚本侧复用）。
 * 人工结论优先于 AI 结论；review_status='exclude' ⇒ 老师已排除，视同已处理。
 *
 * @returns {true|false|null} null = 还没有任何结论（L2）
 */
export const resolveJudgeOutcome = (question) => {
  if (!question) return null
  const rs = question.review_status ?? null
  if (rs === 'correct') return true
  if (rs === 'wrong' || rs === 'wrong_no_book') return false
  if (rs === 'exclude') return null
  if (question.is_correct === true) return true
  if (question.is_correct === false) return false
  return null
}

/**
 * 单题是否「已判出」—— L0 的唯一判据。
 *
 * 三种情况都算已判出，不需要老师再看一眼：
 *   1. `is_correct` 非空（AI 给了明确正误；置信度高低不影响"已判出"这一事实）
 *   2. `answer_source === 'blank'`（未作答是终态；「未作答等同不会」已是统计口径）
 *   3. `review_status` 已被老师处理过（correct/wrong/wrong_no_book/exclude）
 *
 * 反面（⇒ 留人工）：`is_correct == null` 且不是 blank —— 即 AI 未判定 / 处理中。
 */
export const isJudgedForPaperAutoComplete = (question) => {
  if (!question) return false
  // 未作答：终态。批改管线给空白题写 answer_source='blank'，不写 is_correct。
  if (question.answer_source === 'blank') return true
  // 老师已下过结论（含"排除"）——人工结论本身就是"已处理"
  if (question.review_status != null && question.review_status !== '') return true
  return question.is_correct === true || question.is_correct === false
}

/**
 * 整卷闸1 判定。
 *
 * @param {Array} questions 当前卷的全部题目（已按卷面顺序）
 * @param {Array} unresolvedWrong 未入册错题清单（应为**分层后**的
 *        unresolvedWrongQuestions，即已滤掉系统侧缺项的那份）
 * @returns {{
 *   canAutoComplete: boolean,
 *   judgedCount: number,
 *   unjudged: Array<{ questionId: string, index: number, state: string }>,
 *   reasons: string[]
 * }}
 */
export const resolvePaperAutoComplete = (questions, unresolvedWrong) => {
  const list = Array.isArray(questions) ? questions : []
  const reasons = []

  // 条件①：题目列表非空（空卷不自动完成，避免误关）
  if (list.length === 0) reasons.push('题目列表为空')

  // 条件②：整卷无「未判出」题（L2 留人工）
  const unjudged = []
  list.forEach((q, index) => {
    if (isJudgedForPaperAutoComplete(q)) return
    unjudged.push({
      questionId: q?.id ?? null,
      index,
      // state 只为排查用：exception（AI 拒绝给结论）与 processing（还没跑完）
      // 都归 L2，需要老师看；区分它们是给排查人看的，不参与判定。
      state: q?.confidence == null ? 'processing' : 'exception'
    })
  })
  if (unjudged.length > 0) reasons.push(`${unjudged.length} 题未判出（AI未判定/处理中），留人工`)

  // 条件③：无需要老师拍板的未入册错题
  // ⚠️ 传进来的清单必须是**分层后**的（unresolvedWrongQuestions）。
  // 直接传 rawUnresolvedWrongQuestions 会把系统侧缺项也算成人工项，
  // 那正是本次要消除的冗余。
  const blocking = Array.isArray(unresolvedWrong) ? unresolvedWrong : []
  if (blocking.length > 0) reasons.push(`${blocking.length} 题待老师拍板是否入册`)

  return {
    canAutoComplete: reasons.length === 0,
    judgedCount: list.length - unjudged.length,
    unjudged,
    reasons
  }
}
