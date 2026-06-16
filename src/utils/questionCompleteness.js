/**
 * 题目完整性检查工具（前端版）
 * 用于判断一道题是否"完整"——即是否可以进入错题本供学生重练
 * 纯函数，无平台依赖
 */

const FIGURE_KEYWORDS = /如图|图1|图示|附图|见图/
const VALID_TYPES = ['choice', 'fill', 'answer']

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
  if (question.question_type === 'choice') {
    let opts = question.options
    if (typeof opts === 'string') {
      try { opts = JSON.parse(opts) } catch (e) { opts = null }
    }
    if (!opts || !Array.isArray(opts) || opts.length === 0) {
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
