// 回归锁：错题详情弹层字段规整（r376）
// 背景：移动端错题本 fetchWrongQuestionsPage 直接消费后端 /wrong-questions/student/:id 原始响应，
// 内嵌 question 缺 full_image_url / tags_source，导致「查看完整原图」按钮静默失效 + 手动标签被 ai_tags 覆盖。
// 反向自检内联合成坏样本（不调 git，规避 Windows EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWrongQuestionDetailFields } from '../src/utils/wrongQuestionDetailFields.js';

test('移动端原始响应（缺 tags_source）且手动标签存在 → 展示手动标签', () => {
  const { tags } = resolveWrongQuestionDetailFields({
    manual_tags: ['一次方程', '应用题'],
    ai_tags: ['代数']
    // 故意不提供 tags_source，模拟移动端原始响应
  });
  assert.deepEqual(tags, ['一次方程', '应用题']);
});

test('显式 tags_source=manual → 手动标签', () => {
  const { tags } = resolveWrongQuestionDetailFields({ tags_source: 'manual', manual_tags: ['m'], ai_tags: ['a'] });
  assert.deepEqual(tags, ['m']);
});

test('显式 tags_source=ai → ai 标签', () => {
  const { tags } = resolveWrongQuestionDetailFields({ tags_source: 'ai', manual_tags: ['m'], ai_tags: ['a'] });
  assert.deepEqual(tags, ['a']);
});

test('缺 tags_source 且手动标签为空 → 回落 ai 标签', () => {
  const { tags } = resolveWrongQuestionDetailFields({ ai_tags: ['a'], manual_tags: [] });
  assert.deepEqual(tags, ['a']);
});

test('fullImageUrl 优先 full_image_url，缺失回落 image_url', () => {
  assert.equal(resolveWrongQuestionDetailFields({ image_url: 'page.png' }).fullImageUrl, 'page.png');
  assert.equal(
    resolveWrongQuestionDetailFields({ full_image_url: 'full.png', image_url: 'page.png' }).fullImageUrl,
    'full.png'
  );
  assert.equal(resolveWrongQuestionDetailFields({}).fullImageUrl, null);
});

test('反向自检：旧逻辑（恒走 ai_tags）会把移动端手动标签覆盖 → 锁必须判红', () => {
  // 复刻修复前内联逻辑：const tags = q.tags_source === 'manual' ? q.manual_tags : q.ai_tags
  const oldLogic = (q) => (q.tags_source === 'manual' ? (q.manual_tags || []) : (q.ai_tags || []));
  const q = { manual_tags: ['m1'], ai_tags: ['a1'] }; // 移动端原始响应：tags_source 缺失
  assert.notDeepEqual(oldLogic(q), ['m1']); // 旧逻辑产出 ai_tags，与期望的手动标签不符
  assert.deepEqual(resolveWrongQuestionDetailFields(q).tags, ['m1']);
});

test('反向自检：旧逻辑（只认 q.full_image_url）会让移动端整页原图静默消失 → 锁必须判红', () => {
  const oldLogic = (q) => q.full_image_url || null; // 修复前：only full_image_url
  const q = { image_url: 'page.png' }; // 移动端原始响应无 full_image_url
  assert.equal(oldLogic(q), null); // 旧逻辑静默丢失整页原图
  assert.equal(resolveWrongQuestionDetailFields(q).fullImageUrl, 'page.png'); // 新逻辑补回
});
