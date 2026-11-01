// 错题详情弹层（WrongQuestionDetailModal）的字段规整。
//
// 背景（2026-11-01 r376 巡查发现）：移动端错题本走 fetchWrongQuestionsPage，直接消费
// 后端 /wrong-questions/student/:id 的原始响应；该端点内嵌的 question 对象不携带
// full_image_url 与 tags_source（PC 的 getWrongQuestionsByStudent 会补，但移动端不走那条）。
// 于是：①「查看完整原图（含本题）」按钮与图片 onError 兜底恒失效（full_image_url 恒 undefined）；
// ② 手动标签被 ai_tags 静默覆盖（tags_source 恒 undefined → 永远走 ai_tags 分支）。
// 这里集中兜底，避免两处铁律1 错名字段导致的静默丢失。
//
// 纯函数、无 JSX、可被 node --test 直接 import（仓库测试运行器无 JSX transform）。

/**
 * 规整错题详情所需的标签与整页原图字段。
 * @param {object} q 后端/移动端下发的 question 对象（可能缺 full_image_url / tags_source）
 * @returns {{ tags: any[], fullImageUrl: string|null }}
 */
export function resolveWrongQuestionDetailFields(q = {}) {
  const manualTags = Array.isArray(q.manual_tags) ? q.manual_tags : [];
  const aiTags = Array.isArray(q.ai_tags) ? q.ai_tags : [];

  // tags_source 缺失（移动端原始响应）时，优先展示手动标签（老师显式改过则它更权威）；
  // 显式 'manual' → 手动标签，显式 'ai' → ai 标签。与 PC 路径语义一致，不回退到旧版「恒 ai_tags」。
  const tags = (q.tags_source === 'manual' || (q.tags_source !== 'ai' && manualTags.length > 0))
    ? manualTags
    : aiTags;

  // 整页原图：full_image_url 优先，缺失时回落 image_url（本题所在整页扫描）。
  // 后端 questions.image_url 即整页扫描，full_image_url 在旧链路上恒等于 image_url。
  const fullImageUrl = q.full_image_url || q.image_url || null;

  return { tags, fullImageUrl };
}
