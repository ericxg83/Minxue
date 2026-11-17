/**
 * curatedExport.js — 好题甄选 → 试卷题库试题篮的形状归一化（2026-11-17）
 *
 * 纯函数、零依赖，供页面与回归测试共用。
 *
 * 背景：甄选题来自 questions / resource_questions 两个表，甄选后端已按原表取回
 * 题目内容并归一化成驼峰字段（见 curatedQuestionService.normalizeRow）。
 * 试卷题库试题篮（paperBasket.createBasketItem）期望蛇形字段。
 * 本函数只做「驼峰 → 蛇形」字段搬运，⛔ 不碰题干/选项/答案本身 —— 内容以原表为准。
 */

/**
 * 把一条甄选题（甄选页导出形状）转成 paperBasket.createBasketItem 的输入。
 * @param {object} it 甄选题：{id, sourceType, questionType, content, parentStem, options, answer, analysis, imageUrl, resourceName, difficulty, tags}
 */
export function curatedItemToBasketInput(it) {
  const src = it || {}
  return {
    id: src.id,                       // curated 记录 id，和题库原生题 id 不冲突
    question_type: src.questionType,
    question_no: null,                // 甄选题没有原卷题号；同组判据靠 parent_stem
    sub_no: '',
    parent_stem: src.parentStem || null,
    content: src.content || '',
    options: Array.isArray(src.options) ? src.options : [],
    answer: src.answer || null,
    analysis: src.analysis || null,
    image_url: src.imageUrl || null,  // 配图走原表 URL，不复制图片
    vec_url: null,
    resource_id: null,
    resource_name: src.resourceName || (src.sourceType === 'question' ? '错题甄选' : ''),
    difficulty: src.difficulty == null ? null : Number(src.difficulty),
    tags: Array.isArray(src.tags) ? src.tags : [],
  }
}
