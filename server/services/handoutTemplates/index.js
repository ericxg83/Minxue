// ============================================================
// 讲义模板系统 — 注册中心（handoutTemplates）
//
// 设计目标：
//   1. 不同场景（默认 / 考前冲刺 / 错题复习）+ 不同学科（数学 / 英语）
//      用不同的页面布局，避免「把错题复习模板套在英语讲义上」这种串台。
//   2. 模板独立可插拔：新增一种模板只需要在 templates/ 下加一个文件并 register 即可。
//   3. 模板只负责"如何把样本/变式/讲解拼成页面 blocks"，数据获取（错题样本、变式题）
//      仍然由 handoutService 统一调度。
//
// 模板接口（每个 .js 文件必须 export）：
//   {
//     id:        string,        // 唯一 id：'default' | 'exam_review' | 'wrong_review' | 'english_default'
//     label:     string,        // 前端展示名：「默认讲义」「考前冲刺」「错题复习」「英语讲义」
//     description: string,      // 模板简介，UI 鼠标悬停用
//     supportsSubject: string[] | 'all',  // 支持的学科，如 ['数学'] / ['英语'] / 'all'
//     buildSections: async (ctx) => Block[],  // 拼装一个知识点的页面 blocks
//   }
//
// 调用方：handoutService.buildHandout() 接收 { template } 参数，
// 通过 getTemplate(template) 获取模板实例。
// ============================================================

import defaultTemplate from './default.js'
import examReviewTemplate from './examReview.js'
import wrongReviewTemplate from './wrongReview.js'
import englishDefaultTemplate from './englishDefault.js'

const TEMPLATES = new Map()

const register = (template) => {
  if (!template || !template.id) {
    throw new Error('[HandoutTemplate] register: template.id is required')
  }
  if (TEMPLATES.has(template.id)) {
    console.warn(`[HandoutTemplate] duplicate id "${template.id}", overwriting`)
  }
  TEMPLATES.set(template.id, template)
}

// 内置模板注册
register(defaultTemplate)
register(examReviewTemplate)
register(wrongReviewTemplate)
register(englishDefaultTemplate)

/**
 * 通过 id 获取模板
 * @param {string} id
 * @returns {Object|null}
 */
export const getTemplate = (id) => {
  if (!id) return null
  return TEMPLATES.get(id) || null
}

/**
 * 列出所有模板（按 label 排序），给 UI 下拉用
 * @param {string} [subjectFilter] - 仅返回支持该学科的模板；缺省返回全部
 * @returns {Array<{id, label, description, supportsSubject}>}
 */
export const listTemplates = (subjectFilter = null) => {
  const all = Array.from(TEMPLATES.values()).map(t => ({
    id: t.id,
    label: t.label,
    description: t.description,
    supportsSubject: t.supportsSubject,
  }))
  if (!subjectFilter) return all
  return all.filter(t => t.supportsSubject === 'all' || (Array.isArray(t.supportsSubject) && t.supportsSubject.includes(subjectFilter)))
}

/**
 * 注册自定义模板（外部扩展用）
 * @param {Object} template
 */
export const registerTemplate = (template) => register(template)

/**
 * 兜底：若传入未知 template id，自动按学科挑选合适模板。
 * 数学 → default，英语 → english_default，否则 default。
 */
export const pickTemplateBySubject = (subject) => {
  if (subject === '英语') return getTemplate('english_default') || getTemplate('default')
  return getTemplate('default')
}

export { defaultTemplate, examReviewTemplate, wrongReviewTemplate, englishDefaultTemplate }
