/**
 * questionStem.js — 多小问（题组）共享题干的展示口径
 *
 * ⚠️ 本文件有两份镜像：server/utils/questionStem.js 与 src/utils/questionStem.js，
 *    两份实现必须**逐字一致**（同一道题在 PC 端、移动端、PDF 三处渲染出的题干完全相同）。
 *    修改任一份都必须同步另一份。
 *
 * 背景（2026-09-11 产品评审定稿）：
 *   一道大题含 (1)(2) 时会被拆成两条 questions 行，拆行时公共题干容易丢失
 *   （练习册提示词曾要求「content 只写该小问的题干」）。迁移 057 新增
 *   questions.parent_stem 单独承载「第一个小问标号之前的公共题干原文」。
 *
 * 三条口径：
 *   1. parent_stem 只是**展示字段**，绝不参与判题、答案引擎、完整性闸、题干指纹。
 *   2. content 才是题目的权威文本，保持原语义不动。
 *   3. 渲染时若 content 自身已经包含 parent_stem（历史数据：代码拆题时 stem 被
 *      拼进 content），**不要重复渲染**，否则会出现两遍条件。
 */

/**
 * 归一化用于「content 是否已包含 parent_stem」的比较。
 * NFKC 统一全半角 → 去所有空白 → 去标点 → 小写。
 * 只用于包含判断，不用于展示，也不用于落库。
 */
export const normalizeStemForCompare = (text) => {
  if (text == null) return ''
  return String(text)
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、,.;:!！?？"'“”‘’()（）【】\[\]{}<>《》·—\-_~`|/\\]/g, '')
    .toLowerCase()
}

/**
 * content 是否已经自带 parent_stem 的内容。
 * 空 parent_stem 视为「无需渲染」，返回 true。
 */
export const isStemContainedInContent = (parentStem, content) => {
  const stem = normalizeStemForCompare(parentStem)
  if (!stem) return true
  const body = normalizeStemForCompare(content)
  if (!body) return false
  return body.includes(stem)
}

/**
 * 解析一道题在展示层应该怎么渲染题干。
 *
 * @returns {{ parentStem: string, content: string }}
 *   - parentStem 非空：先渲染它（弱化样式），再渲染 content；
 *   - parentStem 为空：只渲染 content（历史行为，零变化）。
 *
 * 调用方（错题本卡片 / 重练卷 PDF / 批改页题干区）都走这个函数，
 * 保证三处口径一致。
 */
export const resolveQuestionDisplayStem = (q) => {
  const parentStem = q && typeof q.parent_stem === 'string' ? q.parent_stem.trim() : ''
  const content = q && q.content != null ? String(q.content) : ''
  if (!parentStem) return { parentStem: '', content }
  // 历史数据：代码拆题时 stem 已被拼进 content，渲染时跳过 parent_stem 避免重复
  if (isStemContainedInContent(parentStem, content)) return { parentStem: '', content }
  return { parentStem, content }
}

/**
 * 题组标识：同一 (task_id, question_number) 的多条行属于同一道大题。
 * 跨页相同题号（第1页第5题 / 第2页第5题）不是同一大题，故 page_number 必须参与。
 * 缺 task_id 时退化为 `p{page}|n{no}`；两者都缺则返回 ''（不归组）。
 */
export const getQuestionGroupKey = (q) => {
  if (!q || q.question_number == null || q.question_number === '') return ''
  const page = q.page_number == null ? '' : String(q.page_number)
  const task = q.task_id == null ? '' : String(q.task_id)
  const no = String(q.question_number)
  return task ? `${task}|p${page}|n${no}` : `p${page}|n${no}`
}

/**
 * 题目标注文案：`第10题(2)` / `第10题` / `第3题`（fallbackIndex 为展示序号）。
 * 用于让老师在小问连排时看清「这是第几题的第几问」。
 */
export const formatQuestionLabel = (questionNumber, subNo, fallbackIndex) => {
  const n = questionNumber == null || questionNumber === '' ? '' : String(questionNumber).trim()
  const s = subNo == null || String(subNo).trim() === '' ? '' : String(subNo).trim()
  if (n && s) return `第${n}题(${s})`
  if (n) return `第${n}题`
  if (fallbackIndex != null) return `第${fallbackIndex}题`
  return '题目'
}
