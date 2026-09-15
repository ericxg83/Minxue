/**
 * 人工复核判定的唯一真相来源（移动端 React + PC 端 Vue 共用）
 *
 * 判定语义曾在两端各自实现，阈值不同（移动端 0.9 / PC 端 0.5），
 * 导致同一道题在手机上显示「待人工复核」而在 PC 上显示「AI判对」。
 * 状态判定与阈值必须只有一份实现。
 */

export const REVIEW_STATUS = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
  EXCLUDE: 'exclude',
  WRONG_NO_BOOK: 'wrong_no_book'
})

// 低于此置信度的 AI 判定需要人工确认
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5

export const WRONG_BOOK_SKIP_REASONS = Object.freeze([
  { value: 'image_polluted', label: '图片污染或无法辨认' },
  { value: 'recognition_error', label: 'OCR 或题目识别错误' },
  { value: 'duplicate', label: '重复题' },
  { value: 'low_training_value', label: '暂无训练价值' },
  { value: 'other', label: '其他原因' }
])

export const isWrongResult = question =>
  question?.review_status === REVIEW_STATUS.WRONG ||
  question?.review_status === REVIEW_STATUS.WRONG_NO_BOOK ||
  (question?.review_status == null && question?.is_correct === false)

export const needsWrongBookDecision = (question, isInBook) =>
  isWrongResult(question) &&
  question?.review_status !== REVIEW_STATUS.WRONG_NO_BOOK &&
  !isInBook

export const effectiveIsCorrect = question => {
  if (question?.review_status === REVIEW_STATUS.CORRECT) return true
  if (
    question?.review_status === REVIEW_STATUS.WRONG ||
    question?.review_status === REVIEW_STATUS.WRONG_NO_BOOK
  ) return false
  if (question?.review_status === REVIEW_STATUS.EXCLUDE) return null
  return question?.is_correct ?? null
}

// 错题记录的生命周期终态。与 PC 端 lifecycleStore 的同名取值保持一致——
// 人工复核「其实做对了」必须是标记已掌握、保留错误次数与练习次数，
// 而不是把记录删掉：删掉等于这题从没错过，学习轨迹消失且再也不会进重练池。
export const WRONG_BOOK_LIFECYCLE = Object.freeze({
  MASTERED: 'mastered',
  EXCLUDED: 'excluded'
})

/**
 * 题目的复核状态（6 态，两端同源）
 * @returns {'correct'|'wrong'|'pending'|'exception'|'blank'|'processing'}
 */
export const getReviewState = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  if (!question) return 'processing'

  // 人工已复核 → 以人工结论为最高优先级
  if (question.review_status === REVIEW_STATUS.CORRECT) return 'correct'
  if (
    question.review_status === REVIEW_STATUS.WRONG ||
    question.review_status === REVIEW_STATUS.WRONG_NO_BOOK
  ) return 'wrong'

  // blank（终态，2026-09-13）：学生未作答，**不需要老师逐题确认**。
  // 之前归入 exception（AI未判定）桶，老师被强制对每道空白题点一遍"确认"——
  // 但"未作答等同不会"在统计与重练池里早已是既定口径（weeklyReport 的 wrong 计数
  // 直接含 answer_source='blank'），复核页再让老师点一遍是纯冗余。
  // 未作答的题仍显示"未作答"标签（状态图标/导航角标/顶部统计），只是移出待办。
  if (question.answer_source === 'blank') return 'blank'

  // 处理中：AI 尚未出任何判定
  if (question.is_correct == null && question.confidence == null) return 'processing'

  // AI 异常：已经判过（有置信度）但给不出正误结论
  if (question.is_correct == null) return 'exception'

  // AI 错误：判定学生答案错误
  if (question.is_correct === false) return 'wrong'

  // AI 正确 + 已确认（人工复核 或 置信度达标）
  const manual = !!question.review_status
  const confirmed = manual || (question.confidence != null && question.confidence >= threshold)
  if (question.is_correct === true && confirmed) return 'correct'

  // 其余 → 待复核（置信度不足 / AI 不确定）
  return 'pending'
}

export const isExcluded = question => question?.review_status === REVIEW_STATUS.EXCLUDE

// 5 态的展示文案唯一真相来源（移动端 React + PC 端 Vue 共用）。
// exception 只是"AI 没给出正误结论"，不代表 OCR 失败——旧文案「未识别答案」会让老师
// 在学生答案明明已识别出来时误判为识别故障，因此聚合桶统一叫「AI未判定」。
//
// 2026-09-15 措辞收敛：`AI正确` / `AI错误` → `AI判对` / `AI判错`。
// 「AI正确」读起来像"AI 本身是对的"，而不是"AI 判定学生答对"，用户拿着
// 「学生 ±4 / 参考答案 ±2 / 勾选 AI正确」的截图来问"答案都不一样，AI 凭什么判对"，
// 就是被这个词坑的。「判对 / 判错」把主语明确成"一次判定"。
export const REVIEW_STATE_LABELS = Object.freeze({
  correct: 'AI判对',
  wrong: 'AI判错',
  pending: '待复核',
  exception: 'AI未判定',
  blank: '未作答',
  processing: '处理中'
})

/**
 * 单题的展示文案。exception 按 answer_source 细分：
 *   · blank      → 未作答（学生没写，OCR 没有可判内容）
 *   · 其他       → AI未判定（答案已识别，AI 拒绝给结论，需老师定）
 * 2026-09-13 起 blank 有独立终态，label 直接命中；下面的分支保留兼容
 * 仍把未作答映射进 exception 的旧调用方（如移动端未同步版本）。
 */
export const getReviewStateLabel = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  const state = getReviewState(question, threshold)
  if (state === 'blank') return '未作答'
  if (state === 'exception' && question?.answer_source === 'blank') return '未作答'
  // wrong 状态细分：老师已复核 vs AI 自动判错。两种来源共用 'wrong' state 但语义不同，
  // 红 X 仍显示，但文案要让老师分清"这是历史结论（已复核）"还是"AI 当前判错"。
  // 2026-09-02：用户报 #18/#25/#26 填空题学生/参考字面一致却红 X，根因是 review_status='wrong'
  // 历史脏值（fix 判题函数不会重算 review_status），原"AI错误"文案让老师误以为是判题逻辑 bug。
  if (state === 'wrong') {
    const hasManualReview = question?.review_status === REVIEW_STATUS.WRONG ||
                            question?.review_status === REVIEW_STATUS.WRONG_NO_BOOK
    if (hasManualReview) {
      return question?.is_correct === true ? '已复核-AI翻案' : '已复核'
    }
  }
  // correct 状态同样要细分（2026-09-15）——与上面的 wrong 分支对称。
  // 老师复核改判「做对了」时，AI 原本判的可能是「错」(is_correct=false)，
  // 也可能根本没给结论 (is_correct=null)。旧实现让这两种都落回
  // REVIEW_STATE_LABELS.correct =「AI判对」，等于**把人工结论署上 AI 的名**。
  // 用户拿「学生 ±4 / 参考答案 ±2 / 勾选 AI正确」的截图来问「答案不一样为什么说 AI 判断正确」
  // 就是踩在这里：那条题 is_correct=false、review_status='correct'，页面却写「AI判对」。
  // 全库同类 81 条。人工推翻 AI 时，文案必须写明这结论是人下的。
  if (state === 'correct') {
    const hasManualReview = question?.review_status === REVIEW_STATUS.CORRECT
    if (hasManualReview && question?.is_correct !== true) {
      return '已复核-人工判对'
    }
  }
  return REVIEW_STATE_LABELS[state] || REVIEW_STATE_LABELS.pending
}

/**
 * 「AI未判定」的原因说明，供老师知道为什么这题要自己定。
 *
 * 原因由后端判题管线写入 questions.answer_exception_reason（复用既有列），
 * 是纯观测标注：展示层只读它，绝不用它推断正误 —— 正误只看 is_correct。
 * 只在 exception 状态且学生确实作答了的题上显示；未作答本身已经说明了一切。
 */
export const getUnjudgedReasonText = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  if (getReviewState(question, threshold) !== 'exception') return ''
  if (question?.answer_source === 'blank') return ''
  const reason = question?.answer_exception_reason
  return typeof reason === 'string' ? reason.trim() : ''
}

/**
 * 「AI 答案存疑」提示 —— 与 exception 不同：AI 已给出正误，但参考本身
 * 可能不可靠（图题视觉推理不擅长等）。
 *
 * 后端判题管线把 reason 写入 questions.ai_answer_risk_reason（独立列）。
 * 即使在 wrong 状态也展示给老师，避免老师把"AI 错误"信以为真。
 * 纯观测标注，不参与任何判定。
 */
export const getAiAnswerRiskText = (question) => {
  const reason = question?.ai_answer_risk_reason
  return typeof reason === 'string' ? reason.trim() : ''
}

/**
 * 参考答案的**来源** —— 纯展示，不参与任何判定（2026-09-14 P2）。
 *
 * 为什么要让老师看见：批改页上「参考答案」和「学生答案」两栏长得一样，老师看不出
 * 参考答案是**卷面上印的**（出题方给的官方答案）还是**系统自己算的**（原卷没印答案时
 * 由答案引擎补的）。错题再测-0911 事故里老师反复怀疑批改逻辑，实际是 AI 补的参考答案
 * 错了（`29`、`2`）。标出来，老师才会先怀疑答案、而不是先怀疑学生。
 *
 * 判据（只用**确定的**信号，不猜）：
 *   · `answer_source === 'worksheet'` → 答案库（练习册管线显式写入；该列语义混用，
 *     只有 'worksheet' 描述参考答案，'recognized'/'blank'/'teacher_input' 描述学生答案）
 *   · `cache_id` 非空 → AI 生成：cache_id 只在答案引擎补答案（或缓存命中复用）时写入，
 *     卷面印刷答案的题走不到那条链路（答案已存在就不会进 needAnswer 集合）
 *   · 其余 → 卷面印刷
 */
export const REFERENCE_ANSWER_ORIGIN = Object.freeze({
  PRINTED: 'printed',
  ANSWER_BANK: 'answer_bank',
  AI_GENERATED: 'ai_generated'
})

/**
 * @returns {null | {key:string, label:string, hint:string, tone:'info'|'warning'}}
 *          null 表示无参考答案（异常态另有提示，这里不标来源）
 */
export const getReferenceAnswerOrigin = (question) => {
  if (!question) return null
  const answer = typeof question.answer === 'string' ? question.answer.trim() : ''
  if (!answer) return null

  if (question.answer_source === 'worksheet') {
    return {
      key: REFERENCE_ANSWER_ORIGIN.ANSWER_BANK,
      label: '答案库',
      tone: 'info',
      hint: '参考答案取自练习册答案库'
    }
  }
  if (question.cache_id) {
    return {
      key: REFERENCE_ANSWER_ORIGIN.AI_GENERATED,
      label: 'AI 生成',
      tone: 'warning',
      hint: '卷面未印参考答案，此答案是系统自动求解的，仅供参考。若与您的判断不符，请直接改判。'
    }
  }
  return {
    key: REFERENCE_ANSWER_ORIGIN.PRINTED,
    label: '卷面印刷',
    tone: 'info',
    hint: '参考答案取自卷面印刷内容'
  }
}
