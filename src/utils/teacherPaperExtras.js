/**
 * teacherPaperExtras.js — 教师版「参考答案 + 解析」块的渲染决策（2026-10-13）
 *
 * 为什么单独成文件（与 handoutGrouping.js 同一个理由）：
 *   pdfGenerator.js 依赖 html2canvas / katex 等**浏览器专属**依赖，且用无扩展名
 *   import，在 Node 测试里根本 import 不进来。而「教师版要不要印答案/解析、来源怎么标」
 *   是纯决策、必须能被回归锁直接跑，所以剥离出来。
 *   pdfGenerator.js 从这里 import，回归锁也跑这同一个函数 —— 锁盯的就是线上那段逻辑。
 *
 * ── 三条口径（勿改）─────────────────────────────────────────────
 *   1. **默认关闭**：`showAnalysis` 未显式传 true 时一切返回 false，渲染产物与改动前
 *      逐字相同。重练卷与学生版走的就是这条默认路径 —— 卷面分块与编号被判题侧
 *      （server/worker.js processSlimGrading）依赖，多印一个 div 都可能让
 *      「卷面第 N 题」与「判题第 N 题」对不上。
 *   2. **来源标注复用唯一判定**：答案来源（答案库 / AI 解答）只认
 *      reviewDecision.js#getReferenceAnswerOrigin，本模块只做字段名映射与
 *      「缺答案」分支，**不自行判断来源**（历史上同一判据写两处已出过事故）。
 *   3. **缺答案不兜底**：答案为空时只标「本卷未录入」，**绝不填 AI 值**。
 *      口径是「宁可留空转人工，也不要写没验算过的值」。
 */
import { getReferenceAnswerOrigin } from './reviewDecision.js'

/** 教师版上「没有参考答案」的显式文案（与试卷题库讲义 handoutPdf.js 同口径） */
export const ANSWER_MISSING_TEXT = '本卷未录入'

/**
 * 教师版答案块的渲染决策（纯函数，无 DOM / 无浏览器依赖）。
 *
 * @param {object}  o
 * @param {string}  [o.answer]       参考答案正文
 * @param {string}  [o.analysis]     解析正文
 * @param {string}  [o.answerSource] questions.answer_source 原始值（语义混用列，只透传）
 * @param {boolean} [o.showAnalysis] 是否教师版（**只有 === true 才生效**）
 * @returns {{
 *   enabled: boolean,        // 教师版附加块是否开启
 *   hasAnswer: boolean,      // 要印参考答案
 *   answerMissing: boolean,  // 要印「本卷未录入」
 *   originLabel: string,     // 来源签文案（答案库 / AI 解答），无则 ''
 *   originIsAi: boolean,     // 来源是 AI 自动求解（要加「仅供参考」）
 *   hasAnalysis: boolean     // 要印解析
 * }}
 */
export function resolveTeacherAnswerBlock({ answer, analysis, answerSource, showAnalysis } = {}) {
  const enabled = showAnalysis === true
  const answerText = typeof answer === 'string' ? answer.trim() : ''
  const analysisText = typeof analysis === 'string' ? analysis.trim() : ''
  const hasAnswer = answerText.length > 0
  // 来源判定只在「真要印答案」时才调用：answer 为空时 getReferenceAnswerOrigin 本就返回 null，
  // 显式短路可避免调用方误以为「没来源 = 来源未知」。
  const origin = enabled && hasAnswer
    ? getReferenceAnswerOrigin({ answer: answerText, answer_source: answerSource })
    : null
  return {
    enabled,
    hasAnswer: enabled && hasAnswer,
    answerMissing: enabled && !hasAnswer,
    originLabel: origin ? origin.label : '',
    originIsAi: origin ? origin.key === 'ai_generated' : false,
    hasAnalysis: enabled && analysisText.length > 0,
  }
}

/**
 * 来源签文案（PDF 与页面共用，保证两处一字不差）。
 * AI 求解的答案必须带「仅供参考」—— 老师最怕 AI 猜的答案被当成标准答案。
 * @param {ReturnType<typeof resolveTeacherAnswerBlock>} block
 * @returns {string} 无来源时为 ''
 */
export function teacherOriginNote(block) {
  if (!block?.enabled || !block.originLabel) return ''
  return block.originIsAi
    ? `（参考答案来源：${block.originLabel}，仅供参考，请以您的判断为准）`
    : `（参考答案来源：${block.originLabel}）`
}
