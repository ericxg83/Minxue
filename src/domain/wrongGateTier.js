/**
 * 错题入册门禁（闸1）的风险分层 —— 唯一口径
 * 移动端 React 与 PC Vue 共用；与后端 server/utils/wrongBookRisks.js 的
 * 四个 code 一一对应，不新增 code，只决定「谁能自动放行」。
 *
 * ── 为什么分层（2026-09-23 P2）──
 * 现状：闸1 的谓词只问「判错了吗 + 进错题本了吗」。只要列表非空，
 * **整份卷子**就被拦下弹窗，老师必须逐题点「加入 / 本次不加入」。
 * 实测（14 天）：中位每卷只有 1 题需要拍板，但有 51 份卷需要点 ——
 * 真正的成本在「弹窗次数」，不在「每题难度」。
 *
 * ── 分层的判据（负责人原则，务必守住）──
 * **只自动放行「系统没补上」，绝不放行「低置信度需人拍板」。**
 *
 *   · missing_figure / missing_options / invalid_type / missing_answer
 *       = 题目元素残缺，是**系统侧的失败**（没裁到图 / OCR 漏选项 / 答案没补上 / 题型没定）。
 *         这类题补元素后本该能自动入册，但**:补元素不归老师做**。
 *         若因它把整卷拦下，老师能做只有「本次不加入」——等于用一次点击
 *         记录一次系统故障，纯冗余。
 *         ⇒ P2 自动记为 wrong_no_book（保留"确实判错了"的事实），不拦卷。
 *
 *         missing_answer 是 2026-09-23 补入的：它原本是「未知 code → fail-closed 拦卷」，
 *         与本节原则直接矛盾（缺答案 = 答案引擎没补上，是系统侧失败），
 *         实测近 14 天有 45 道这类题把卷子拦下、老师只能点「本次不加入」。
 *         注意后端 computeWrongBookRisks 在「参考答案为空」时直接返回空数组，
 *         这类题压根不会进闸1 列表；能走到这里的 missing_answer 只可能是
 *         **前端与后端的完整性判据不一致**（前端 checkQuestionCompleteness 现算 vs
 *         后端判据），此时按系统侧失败处理同样成立，不会替老师下"算不算错"的结论
 *         （is_correct=false 已是 AI 的明确判定）。
 *
 *   · low_confidence
 *       = AI 判错但置信度不够，**必须老师拍板「到底算不算错」**。
 *         自动放行等于替老师下结论；万一判错了，学生白练一道、错题本被污染。
 *         ⇒ **永不自动放行，一律拦卷。**
 *
 *         ⚠️ 例外：**未作答（answer_source='blank'）的题不参与这条闸**（2026-09-23）。
 *         批改管线对空题写 `confidence: 0`（worker.js blank 分支），
 *         于是 blank 题天生 `conf < 0.8` → 被判 low_confidence → 整卷被拦。
 *         但 blank 在 getReviewState 里是**终态**、「未作答等同不会」已是统计口径，
 *         老师本来就不需要为它拍板任何事 ⇒ 用一次点击记录一次"系统给空题打 0 分"纯冗余。
 *         callers 需在传参前把 blank 题的 low_confidence 摘掉（见 classifyWrongGateItem）。
 *

/** 系统侧失败（可自动放行，记 wrong_no_book 留痕） */
export const WRONG_GATE_AUTO_RESOLVABLE = Object.freeze([
  'missing_figure',
  'missing_options',
  'missing_answer',
  'invalid_type'
])

/** 必须人工拍板（永不自动放行） */
export const WRONG_GATE_MANUAL_ONLY = Object.freeze([
  'low_confidence'
])

/**
 * 未作答（answer_source='blank'）在批改管线里被写成 `confidence: 0`
 * （见 server/worker.js blank 分支），天生低于任何置信度阈值。
 * 但 blank 是终态、老师无需为它拍板 ⇒ 判分层时要先把这类 low_confidence 摘掉。
 *
 * 判据只看 answer_source，不看 confidence——避免"给空题补个高 confidence"
 * 这种绕过方式把语义搞乱。
 */
const isBlankQuestion = item => item?.answerSource === 'blank'

/**
 * 把一条 unresolved 记录判成「能否自动放行」。
 *
 * @param {{issues?: string[], reason?: string, source?: string, answerSource?: string}} item
 *        来自 unresolvedWrongQuestions 的元素（含 issues / reason / source / answerSource）
 * @returns {{ autoResolvable: boolean, manualIssues: string[], autoIssues: string[], why: string }}
 */
export const classifyWrongGateItem = (item) => {
  const rawIssues = Array.isArray(item?.issues) ? item.issues.filter(Boolean) : []
  // 未作答是终态：批改管线给它写 confidence=0 ⇒ 天生命中 low_confidence。
  // 老师不需要为空题拍板"算不算错"（未作答等同不会已是既定口径），
  // 这里把它的 low_confidence 摘掉，让它走"系统侧缺项/系统性漏入"的自动放行分支。
  const blank = isBlankQuestion(item)
  const issues = blank ? rawIssues.filter(i => i !== 'low_confidence') : rawIssues

  const autoIssues = issues.filter(i => WRONG_GATE_AUTO_RESOLVABLE.includes(i))
  const manualIssues = issues.filter(i => WRONG_GATE_MANUAL_ONLY.includes(i))
  // 未知 code 一律按「需人工」处理（fail-closed：宁可多拦一次，不可误放行）
  const unknownIssues = issues.filter(
    i => !WRONG_GATE_AUTO_RESOLVABLE.includes(i) && !WRONG_GATE_MANUAL_ONLY.includes(i)
  )

  // ① 有 low_confidence 或未知 code → 必须人工
  if (manualIssues.length > 0 || unknownIssues.length > 0) {
    return {
      autoResolvable: false,
      manualIssues: [...manualIssues, ...unknownIssues],
      autoIssues,
      why: manualIssues.length > 0 ? 'low_confidence 需人工拍板' : `未知风险项(${unknownIssues.join(',')})，按需人工处理`
    }
  }

  // ② 老师已手工标错（source='manual'）且原因完整 → 后端 PUT 时已尝试强入，
  //    出现在这里只可能是入册失败（DB 抖动等），属系统性失败 → 自动放行
  // ③ AI 判错 + 只有系统侧缺项 → 自动放行（不替老师下"算不算错"的结论，
  //    因为 is_correct=false 已是 AI 的明确判定，缺的只是题目元素）
  if (autoIssues.length > 0) {
    return {
      autoResolvable: true,
      manualIssues: [],
      autoIssues,
      why: `仅系统侧缺项(${autoIssues.join(',')})，补元素不归老师，不拦卷`
    }
  }

  // ④ 没有 issues 信息（reason='complete'）→ 这题本该能直接入册，是系统性漏入
  //    未作答（blank）被摘掉 low_confidence 后也落在这里：空题终态，不拦卷
  if (issues.length === 0) {
    return {
      autoResolvable: true,
      manualIssues: [],
      autoIssues: [],
      why: blank ? '未作答为终态，无需老师拍板，不拦卷' : '元素完整，属系统性漏入，不拦卷'
    }
  }

  return { autoResolvable: false, manualIssues: issues, autoIssues, why: '按需人工' }
}

/**
 * 对整份卷的 unresolved 列表做分层汇总。
 *
 * @returns {{ blocking: object[], autoResolvable: object[], needsManual: boolean }}
 *          blocking 非空 ⇒ 仍需弹窗；autoResolvable 非空且 blocking 空 ⇒ 闸1 放行
 */
export const splitWrongGateList = (list) => {
  const arr = Array.isArray(list) ? list : []
  const blocking = []
  const autoResolvable = []
  for (const item of arr) {
    const c = classifyWrongGateItem(item)
    if (c.autoResolvable) autoResolvable.push({ ...item, gateClass: c })
    else blocking.push({ ...item, gateClass: c })
  }
  return { blocking, autoResolvable, needsManual: blocking.length > 0 }
}

/** 自动放行题的「本次不加入」原因码（复用既有枚举，不新增） */
export const WRONG_GATE_AUTO_SKIP_REASON = 'recognition_error'
