/**
 * humanizeError · 敏学 PC 工作台错误文案翻译工具
 *
 * 把 axios / fetch 抛出的英文/技术 message 翻译成中文人话 + 原因/影响/下一步。
 * 替代 3 个页面（GradeCenter / StudentDetail / StudentsWorkbench）里重复的
 * humanizeError 函数。
 *
 * 用法：
 *   import { humanizeError } from '../utils/humanizeError'
 *
 *   try { ... } catch (error) {
 *     loadError.value = humanizeError(error?.message, { entity: '任务列表' })
 *   }
 *
 * @param {string|undefined|null} message - 原始 error.message
 * @param {object} [opts]
 * @param {string} [opts.entity='数据'] - 主体词，如"任务列表" / "学生档案" / "学生列表"
 * @returns {string} 中文人话
 */
export function humanizeError(message, { entity = '数据' } = {}) {
  if (!message) return `读不到${entity}，可能是网络或服务问题。`
  if (/network|fetch|timeout/i.test(message)) return '网络似乎不太通畅，请稍后重试。'
  if (/401|403|unauthor/i.test(message)) return '登录状态已过期，请重新登录。'
  if (/5\d{2}/.test(message)) return '服务暂时不可用，请稍后重试。'
  if (/不存在|已删除|未找到|not found/i.test(message)) return `该${entity}不存在或已被删除。`
  return `读不到${entity}，请稍后重试。`
}
