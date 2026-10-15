/**
 * 重练卷结算 · 单题决策（纯函数，2026-10-15）
 *
 * 为什么抽出来：结算里「这道题该入册 / 该推进 / 该跳过」的判定原来埋在
 * `gradingFinalizer.finalizeGeneratedExamResults` 的循环里，只能靠 grep 源码做锁——
 * 那种锁看不见语义变化（把 `isCorrect ? 0 : 1` 改回去依然全绿）。抽成纯函数后，
 * 全部组合可以被真跑覆盖，`test/retrySettlementEnrollGuard.test.mjs` 直接断言不变量。
 *
 * ⛔ 本文件锁定的语义红线（2026-10-15 负责人报障后确立）：
 *   **错题本的定义是「做错过的题」。学生答对一次，不构成错题 —— 无论它之前在不在册。**
 *
 * 历史缺陷（全库 47 条「我没有做错过这道题」）：
 *   结算在「错题行不存在」时无条件 INSERT，且 `errorCount = isCorrect ? 0 : 1`。
 *   于是学生答对的题会被凭空记成一条 `error_count = 0` 的错题。真实事故链：
 *     老师复核重练卷判「对」→ finalizeRejudgeResult 删掉整行（判对＝误判，本就该删）
 *     → 11 秒后本结算按卷面题单逐题跑，发现行没了 → 重新 INSERT，error_count = 0。
 *   两个写操作不原子、幂等键也不同源（`PUT /api/questions/:id` 调用
 *   finalizeRejudgeResult 时根本不传 settlementKey），所以「判对」对结算不可见。
 *   ⇒ 兜底只能落在结算这一侧：**答对 + 不在册 = 无错可记，跳过**。
 *
 * `error_count = 0` 全库只有结算的 INSERT 分支能写出来（其余四条入册路径
 * —— neonService.addWrongQuestions / addSelfContainedWrongQuestion /
 * PUT /wrong-questions/upsert / batch-upsert —— 全部写死 1）。
 * 所以「任何写入的 errorCount 都必须 ≥ 1」这一条不变量，就是这个 bug 的唯一签名。
 */
import { LIFECYCLE_STATUS, WRONG_STATUS } from '../config/neon.js'

/** 结算单题动作。skip = 不入册、不推进、不计入统计（但仍同步 questions.is_correct）。 */
export const RETRY_SETTLE_ACTION = {
  INSERT: 'insert',
  UPDATE: 'update',
  SKIP: 'skip'
}

/**
 * 掌握度状态机（2026-09-13 队列分层定稿）：
 *   NEW → REVIEW_1（累计答对 1 次）→ MASTERED（累计答对 2 次）；MASTERED 保持
 *   答错：NEW 保持原位；REVIEW_1 → NEW（假掌握回池）；MASTERED → REVIEW_1
 *   REVIEW_2 是历史兼容枚举（生产库 0 条），按 REVIEW_1 语义处理。
 *
 * ⛔ 与前端两份展示层实现必须逐字一致，勿单端改：
 *   - 移动端 src/pages/Grading/index.jsx 的 getNextLifecycle（仅预览统计，结算仍走服务端）
 *   - PC 端 src/workbench/stores/lifecycleStore.js 的 processReviewResult
 */
export const getNextLifecycle = (current, isCorrect) => {
  if (isCorrect) {
    switch (current) {
      case LIFECYCLE_STATUS.NEW:
      case LIFECYCLE_STATUS.REVIEW_2:
        return LIFECYCLE_STATUS.REVIEW_1
      case LIFECYCLE_STATUS.REVIEW_1:
        return LIFECYCLE_STATUS.MASTERED
      case LIFECYCLE_STATUS.MASTERED:
        return LIFECYCLE_STATUS.MASTERED
      default:
        return LIFECYCLE_STATUS.REVIEW_1
    }
  }
  if (current === LIFECYCLE_STATUS.MASTERED) return LIFECYCLE_STATUS.REVIEW_1
  if (current === LIFECYCLE_STATUS.REVIEW_1 || current === LIFECYCLE_STATUS.REVIEW_2) {
    return LIFECYCLE_STATUS.NEW
  }
  return current
}

/**
 * 单题决策。
 *
 * @param {object}  input
 * @param {?{id: string, lifecycle_status: ?string, error_count: ?number}} input.existing
 *        该生这道题在错题本里的现有行；null/undefined = 不在册
 * @param {boolean} input.isCorrect      本次重练该题的判定结果
 * @param {boolean} input.skipWrongBook  调用方声明「这道题不要进错题本」（仅在答错时有意义）
 * @returns {{
 *   action: 'insert'|'update'|'skip',
 *   reason: string,
 *   previousLifecycle: string,
 *   nextLifecycle: string,
 *   status: ?string,       // 要写入的 wrong_questions.status；skip 时为 null
 *   errorCount: ?number,   // 要写入的 error_count；skip 时为 null
 *   countsAs: ?'mastered'|'upgraded'|'reset'  // 结算统计口径
 * }}
 */
export function decideRetrySettlementItem({ existing = null, isCorrect = false, skipWrongBook = false } = {}) {
  const currentLifecycle = existing?.lifecycle_status || LIFECYCLE_STATUS.NEW

  const skip = (reason) => ({
    action: RETRY_SETTLE_ACTION.SKIP,
    reason,
    previousLifecycle: currentLifecycle,
    nextLifecycle: currentLifecycle,
    status: null,
    errorCount: null,
    countsAs: null
  })

  // 调用方显式声明不入册（学生空答/跳过），且本题确实没答对 —— 保持原语义。
  // 注意：`skipWrongBook` 只在答错时生效（答对本来就不该入册，见下一条）。
  if (skipWrongBook && !isCorrect) return skip('skip_wrong_book')

  // ★ 2026-10-15 修复：答对 + 不在错题本 ⇒ 没有错题可记，不得凭空建行。
  //   这条守卫就是「学生说我没做错过」的根治点，⛔ 不要改回无条件 INSERT。
  if (!existing && isCorrect) return skip('correct_without_existing_row')

  const nextLifecycle = getNextLifecycle(currentLifecycle, isCorrect)
  const status = nextLifecycle === LIFECYCLE_STATUS.MASTERED
    ? WRONG_STATUS.MASTERED
    : WRONG_STATUS.PENDING

  if (!existing) {
    // 走到这里必然是「答错且不在册」⇒ 真做错了，起始 error_count = 1。
    return {
      action: RETRY_SETTLE_ACTION.INSERT,
      reason: 'wrong_without_existing_row',
      previousLifecycle: currentLifecycle,
      nextLifecycle,
      status,
      errorCount: 1,
      countsAs: nextLifecycle !== currentLifecycle ? 'reset' : null
    }
  }

  if (isCorrect) {
    const countsAs = nextLifecycle === LIFECYCLE_STATUS.MASTERED && currentLifecycle !== LIFECYCLE_STATUS.MASTERED
      ? 'mastered'
      : (nextLifecycle !== currentLifecycle ? 'upgraded' : null)
    return {
      action: RETRY_SETTLE_ACTION.UPDATE,
      reason: 'correct_existing_row',
      previousLifecycle: currentLifecycle,
      nextLifecycle,
      status,
      // 推进生命周期，但错误次数保持原值（答对不加错）
      errorCount: existing.error_count || 1,
      countsAs
    }
  }

  // 答错且已在册：error_count 一定 +1
  return {
    action: RETRY_SETTLE_ACTION.UPDATE,
    reason: 'wrong_existing_row',
    previousLifecycle: currentLifecycle,
    nextLifecycle,
    status,
    errorCount: (existing.error_count || 1) + 1,
    countsAs: nextLifecycle !== currentLifecycle ? 'reset' : null
  }
}
