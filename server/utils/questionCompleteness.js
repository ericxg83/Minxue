/**
 * 题目完整性检查工具
 * 用于判断一道题是否"完整"——即是否可以进入错题本供学生重练
 */

const FIGURE_KEYWORDS = /如图|图1|图示|附图|见图/
const VALID_TYPES = ['choice', 'fill', 'answer']

/**
 * 缺项类型代码 —— 与 issues 一一对应的稳定标识
 *
 * issues 是中文文案，会随产品措辞调整；调用方（入册风险标签、回填脚本、监控）
 * 必须按 code 分支，不要按中文串匹配。顺序与 checkQuestionCompleteness 的规则一致。
 */
export const COMPLETENESS_CODES = {
  missing_figure: 'missing_figure',   // 题干引图但无配图
  missing_options: 'missing_options', // 选择题无选项
  missing_answer: 'missing_answer',   // 无参考答案
  invalid_type: 'invalid_type'        // 题型缺失或非法
}

/**
 * 检查题目完整性
 *
 * 这是「题目是否完整」的唯一真值源（动态口径）。
 * questions.is_complete 落库列只是它的反范式缓存，用于 SQL 侧过滤；
 * 任何判「这题能不能进错题本」的地方都应该在落库列之前先信这里。
 *
 * @param {Object} question - 题目对象
 * @param {string} question.content - 题干
 * @param {string|null} question.geometry_image_url - 配图URL
 * @param {string|null} question.question_type - 题型 (choice/fill/answer)
 * @param {Array|string|null} question.options - 选项数组或JSON字符串
 * @param {string|null} question.answer - 参考答案
 * @returns {{ isComplete: boolean, issues: string[], codes: string[] }}
 */
export function checkQuestionCompleteness(question) {
  const issues = []
  const codes = []

  // 规则1: 题干含几何图引用但缺少配图
  if (question.content && FIGURE_KEYWORDS.test(question.content)) {
    if (!question.geometry_image_url) {
      issues.push('题干引用几何图但缺少配图')
      codes.push(COMPLETENESS_CODES.missing_figure)
    }
  }

  // 规则2: 选择题缺少选项
  if (question.question_type === 'choice') {
    let opts = question.options
    if (typeof opts === 'string') {
      try { opts = JSON.parse(opts) } catch (e) { opts = null }
    }
    if (!opts || !Array.isArray(opts) || opts.length === 0) {
      issues.push('选择题缺少选项')
      codes.push(COMPLETENESS_CODES.missing_options)
    }
  }

  // 规则3: 缺少参考答案
  if (!question.answer || (typeof question.answer === 'string' && question.answer.trim() === '')) {
    issues.push('缺少参考答案（无法自动批改）')
    codes.push(COMPLETENESS_CODES.missing_answer)
  }

  // 规则4: 题型无效
  if (!question.question_type || !VALID_TYPES.includes(question.question_type)) {
    issues.push('题目类型无效')
    codes.push(COMPLETENESS_CODES.invalid_type)
  }

  return {
    isComplete: issues.length === 0,
    issues,
    codes
  }
}

/**
 * 只拿 codes 的便捷入口 —— 落库列回写等只需要判据、不需要文案的场景
 * @param {Object} question
 * @returns {string[]} 缺项代码列表，空数组表示完整
 */
export function getQuestionCompletenessCodes(question) {
  return checkQuestionCompleteness(question).codes
}
