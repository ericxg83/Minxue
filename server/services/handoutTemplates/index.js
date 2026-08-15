// ============================================================
// 讲义模板系统 — 注册中心（handoutTemplates）
//
// P0 定位重塑后：只保留"备课讲义"用途的模板，去掉所有"练习卷"型模板。
// 模板由 templates/ 提供，详情见模板目录。
// ============================================================

import lecturePrepTemplate from './lecturePrep.js'
import englishLecturePrepTemplate from './englishLecturePrep.js'
import classroomProjectionTemplate from './classroomProjection.js'

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
register(lecturePrepTemplate)
register(englishLecturePrepTemplate)
register(classroomProjectionTemplate)

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
 * 英语 → english_lecture_prep，否则 lecture_prep。
 */
export const pickTemplateBySubject = (subject) => {
  if (subject === '英语') return getTemplate('english_lecture_prep') || getTemplate('lecture_prep')
  return getTemplate('lecture_prep')
}

export { lecturePrepTemplate, englishLecturePrepTemplate, classroomProjectionTemplate }
