/**
 * 题目完整性检查工具（前端版）
 * 用于判断一道题是否"完整"——即是否可以进入错题本供学生重练
 * 纯函数，无平台依赖
 *
 * ⚠️ 本文件是 server/utils/questionCompleteness.js 的前端镜像，两份逻辑必须逐字一致。
 * 前端要即时拦住老师标错（reviewStore.reviewQuestion）并渲染「缺项」清单，
 * 等后端返回再提示会让老师以为点生效了；后端要守住移动端/Worker/脚本等其它入口。
 * 改动此文件时必须同步改服务端那一份，并跑 test/wrongBookRisks.test.mjs。
 */

const FIGURE_KEYWORDS = /如图|图1|图示|附图|见图/
const VALID_TYPES = ['choice', 'fill', 'answer']

/**
 * ── 题型证据判定（2026-09-11） ──
 *
 * 背景：`question_type` 是模型/答案库给出的**猜测字段**，会与题目自身内容矛盾。
 * 实测事故（练习册 27.5 第 6 题）：卷面第 6 题是填空题「则当OP=______米时，该花坛
 * POQ的面积最大.」，但练习册答案库同题号那条记录是 `answer_type='choice'`，
 * 批改管线用 `q.question_type = answerRow.answer_type || ...` 直接覆盖了 OCR 题型
 * → 落库成「选择题 + options=[]」→ 完整性闸报「选择题缺少选项」→ 老师标错时被拦，
 * 切到编辑页又只有「选项」区块（选项区块仅在 choice 时渲染），根本无从补——
 * 因为没有选项可补，这本来就不是选择题。
 *
 * 所以「这题是不是选择题」不能只信 question_type，必须看题干自身有没有选择题证据，
 * 以及有没有更硬的填空题证据。判定极保守：只在**题型声明与题目内容明确打架**时纠偏。
 */

// 填空线：连续下划线（半角/全角）或方框。绝不把「（  ）」算作填空证据——
// 选择题的答题括号在 OCR 文本里长这样，把它当填空题会一次性放过大量真·缺选项选择题。
const FILL_BLANK_RE = /_{3,}|＿{2,}|□/
// 选择题铁证：题干内联了 ≥2 个不同的 A–D 标号（选项没被拆进 options 数组时的形态）
const OPTION_MARKER_RE = /(?:^|[\s，,、；;：:。．.)）(（])([A-DＡ-Ｄ])\s*[.、．)）:：]/
// 题干以空括号收尾 = 选择题答题框的常见形态，出现它就不推翻 declared type
const CHOICE_TAIL_RE = /[（(]\s{0,3}[）)]\s*[。.．·]?$/

/**
 * 选项归一成数组（字符串 JSON / 数组 / 其它形态都兼容）
 * @param {Array|string|null|undefined} options
 * @returns {Array}
 */
const toOptionsArray = (options) => {
  let opts = options
  if (typeof opts === 'string') {
    try { opts = JSON.parse(opts) } catch (e) { opts = null }
  }
  return Array.isArray(opts) ? opts : []
}

/** 题干内联了 ≥2 个不同选项标号 → 这题确定是选择题 */
export function hasExplicitOptionMarkers(content) {
  const text = String(content || '')
  if (!text) return false
  const letters = new Set()
  const re = new RegExp(OPTION_MARKER_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    letters.add(m[1].toUpperCase())
    if (letters.size >= 2) return true
  }
  return false
}

/** 题干含填空线（连续下划线 / 方框） */
export function hasFillBlankEvidence(content) {
  return FILL_BLANK_RE.test(String(content || ''))
}

/**
 * 按证据解析题型 —— 只在 `choice` 与题目内容明确矛盾时纠偏为 `fill`。
 * 与服务端同名函数保持逐字一致，详见 server/utils/questionCompleteness.js。
 *
 * @param {{question_type?: string|null, content?: string|null, options?: any}} question
 * @returns {{ type: string|null, corrected: boolean, reason: string|null }}
 */
export function resolveEffectiveQuestionType(question) {
  const declared = String(question?.question_type || '').trim().toLowerCase()
  const keep = { type: declared || null, corrected: false, reason: null }
  if (declared !== 'choice') return keep
  if (toOptionsArray(question?.options).length > 0) return keep

  const text = String(question?.content || '')
  if (hasExplicitOptionMarkers(text)) return keep
  if (CHOICE_TAIL_RE.test(text)) return keep
  if (!hasFillBlankEvidence(text)) return keep

  return { type: 'fill', corrected: true, reason: 'choice_declared_but_stem_is_fill' }
}

/**
 * 检查题目完整性
 * @param {Object} question - 题目对象
 * @param {string} question.content - 题干
 * @param {string|null} question.geometry_image_url - 配图URL
 * @param {string|null} question.question_type - 题型 (choice/fill/answer)
 * @param {Array|string|null} question.options - 选项数组或JSON字符串
 * @param {string|null} question.answer - 参考答案
 * @returns {{ isComplete: boolean, issues: string[] }}
 */
export function checkQuestionCompleteness(question) {
  const issues = []

  // 规则1: 题干含几何图引用但缺少配图
  if (question.content && FIGURE_KEYWORDS.test(question.content)) {
    if (!question.geometry_image_url) {
      issues.push('题干引用几何图但缺少配图')
    }
  }

  // 规则2: 选择题缺少选项
  // 按「有效题型」判，而不是直接信 question_type：题型与题干明确矛盾时（详见
  // resolveEffectiveQuestionType 注释）说明 question_type 存错了，此时该题不是
  // 选择题，「缺选项」既能拦住老师入册、又给不出任何可执行的补救动作（选项区块
  // 只在 choice 下渲染），必须放行。
  const effectiveType = resolveEffectiveQuestionType(question).type
  if (effectiveType === 'choice') {
    const opts = toOptionsArray(question.options)
    if (opts.length === 0) {
      issues.push('选择题缺少选项')
    }
  }

  // 规则3: 缺少参考答案
  if (!question.answer || (typeof question.answer === 'string' && question.answer.trim() === '')) {
    issues.push('缺少参考答案（无法自动批改）')
  }

  // 规则4: 题型无效
  if (!question.question_type || !VALID_TYPES.includes(question.question_type)) {
    issues.push('题目类型无效')
  }

  return {
    isComplete: issues.length === 0,
    issues
  }
}
