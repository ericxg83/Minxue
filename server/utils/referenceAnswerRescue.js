/**
 * 参考答案「救援」：把模型自述残句还原成可用答案。
 *
 * 背景（2026-09-14 错题再测-0911 事故）
 *   答案引擎偶尔把"自言自语"写进 answer 字段：
 *     `应包含10`、`125，所以 125 的立方根是 5`、`写作0.31818...（或标准循环小数记法…）`
 *   这些字符串进 questions.answer 后判等层永远对不上（学生写对也判错），
 *   并随 question_cache 题干指纹复用传染给所有同题干学生。
 *
 * 口径
 *   只在**答案已经是叙述型**时才动手（不碰正常答案）。三级策略，前一级拿不到干净值才走下一级：
 *     ① 解析里的答案标记（extractFinalAnswerFromAnalysis，已按"取文末 + 剥脚手架 + 忌口吻"收敛）
 *     ② 残句末尾的「…是 X」/「…为 X」——`125，所以 125 的立方根是 5` → `5`
 *     ③ 残句头部截断——`写作0.31818...（或…）` → `0.31818...`、`y = 100 - 20x（因为…` → `y = 100 - 20x`
 *   三级都拿不到干净值 → 返回 null，由调用方决定「清空 + 转人工」。
 *
 * 纯函数、零依赖，可单测。worker 的评分闸与回填脚本共用同一口径。
 */
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer, cleanAnswerScaffold, stripTrailingSeparators } from './aiParseSelfCheck.js'

// 策略②：末尾「是/为 <值>」。值只允许答案字符集，且 ≤20 字符，
// 避免把 `……因此 y₂ 是负数`、`答案应为待人工补充` 这类叙述尾巴当答案。
const TRAILING_VALUE_RE = /[是为]\s*([0-9A-Za-z√π±²³+\-*/^().,\s、]{1,20})\s*[。.；;]?\s*$/
// 策略③：在第一个叙述连接词/全角括号处截断，只保留前半段（答案通常在前半段）。
const HEAD_CUT_RE = /，\s*(?:但|可能|则|说明|因此|所以|选项|答案|可见|这|可)|（/
// 模型自己都不确定 / 说题目有问题 → 一律转人工，不许猜（项目口径：不拿猜测值顶上）。
// 只对 answer 文本生效；解析里出现这些词是常态（"没有唯一答案"除外，见 ANALYSIS_UNCERTAIN_RE）。
const UNCERTAIN_RE = /选项|没有|无法|待人工|不确定|抄写|偏差|存疑|矛盾/
const ANALYSIS_UNCERTAIN_RE = /题目抄写错误|题目有误|答案不唯一|无法唯一确定/

const trimTail = (s) => stripTrailingSeparators(String(s || '').trim())

/** 值是否是「像答案」的短值：非空、长度可控、不含叙述口吻词。 */
const isUsableValue = (v, maxLength = 40) => {
  const s = trimTail(v)
  return Boolean(s) && s.length <= maxLength && !isNarrativeAnswer(s)
}

/**
 * @param {string} answer 当前落库的参考答案
 * @param {string} analysis 该题的 AI 解析
 * @returns {string|null} 救回后的答案；救不回来返回 null（调用方应清空并转人工）
 */
export function rescueReferenceAnswer(answer, analysis) {
  if (!isNarrativeAnswer(answer)) return String(answer ?? '').trim() || null

  const raw = String(answer ?? '').trim()
  // 答案文本自己就在说「不确定 / 选项里没有 / 待人工」→ 转人工
  if (UNCERTAIN_RE.test(raw) || ANALYSIS_UNCERTAIN_RE.test(String(analysis || '').slice(-300))) return null

  // ① 解析里的答案标记
  const fromAnalysis = extractFinalAnswerFromAnalysis(analysis)
  if (fromAnalysis && isUsableValue(fromAnalysis)) return trimTail(fromAnalysis)

  // ② 末尾「是/为 X」
  const tail = raw.match(TRAILING_VALUE_RE)
  if (tail) {
    const v = trimTail(cleanAnswerScaffold(tail[1]))
    if (isUsableValue(v, 20)) return v
  }

  // ③ 头部截断
  const cut = raw.split(HEAD_CUT_RE)[0]
  if (cut && cut !== raw) {
    const v = trimTail(cleanAnswerScaffold(cut))
    if (isUsableValue(v)) return v
  }

  return null
}
