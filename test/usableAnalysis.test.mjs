/**
 * 「解析」可用性判据的回归锁（2026-10-14）。
 *
 * 事故背景（老师实测「为什么我没有解析」）：
 *   server/_regrade_workbook_to_ai_0922.mjs 的 callEngine 只 return 引擎结果的
 *   answer 字符串，把引擎同时返回的 analysis 整个丢掉 ⇒ newAnalysis 恒为 null
 *   ⇒ 脚本把 'AI重批生成 <日期>' 当占位写进 question_cache.analysis 与
 *      questions.analysis。同一次脚本产出两种表现：
 *     · 缓存里留下占位串的题 → 解析按钮亮着，点开是一句废话（全库 210 条 / 27 卷）
 *     · 缓存里是 null 的题     → 解析按钮直接消失（老师看不到入口）
 *
 * 为什么这是数据缺陷而非显示 bug：解析入口 AnalysisSource 原本只判
 * `trim().length > 0`，占位串非空 ⇒ 照样点亮。判据必须认得占位串。
 *
 * ⚠️ 本测试同时锁死「不许退回宽松判据」：四处消费方
 * （AnalysisSource / Grading/index.jsx / GradingDetailSheet /
 * WrongBookCenterRedesign）必须走同一实现（AGENTS 铁律：同一件事只准一个实现）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasUsableAnalysis, isAnalysisPlaceholder } from '../src/utils/reviewDecision.js'

test('占位串不算解析（这正是按钮误亮的根因）', () => {
  assert.equal(isAnalysisPlaceholder('AI重批生成 2026-09-22'), true)
  assert.equal(hasUsableAnalysis({ analysis: 'AI重批生成 2026-09-22' }), false,
    '占位串必须让解析入口自隐，否则老师点开只看到一句废话')
})

test('占位串判据：整串匹配，不做包含匹配', () => {
  // 真解析里完全可能出现这几个字，误杀真解析比漏杀占位串更糟
  assert.equal(isAnalysisPlaceholder('本题由 AI重批生成 2026-09-22 流程产出，故解答如下……'), false)
  assert.equal(hasUsableAnalysis({ analysis: '解：原式 = 2x + 1，AI重批生成时已验算。' }), true,
    '真解析里包含这几个字不得被误判成占位串')
})

test('空 / 空白 / 缺失 都视为无解析', () => {
  for (const q of [{}, { analysis: '' }, { analysis: '   ' }, { analysis: null }, { analysis: undefined }]) {
    assert.equal(hasUsableAnalysis(q), false)
  }
  assert.equal(isAnalysisPlaceholder(''), false, '空串不是占位串，是「本来就没有」')
  assert.equal(isAnalysisPlaceholder(null), false)
})

test('真解析正常放行（含解析里带日期的情形）', () => {
  const real = '解：原式分子分母同乘 2，得 √10/99。验算：10 × 99 = 990 = 99 × 10 ✓'
  assert.equal(hasUsableAnalysis({ analysis: real }), true)
  // 带日期但不是占位格式 → 仍算真解析
  assert.equal(hasUsableAnalysis({ analysis: '2026-09-22 重批记录：本题答案 √10/99' }), true)
})

test('null question 不炸（消费方有 currentQuestion 可能为空的场景）', () => {
  assert.equal(hasUsableAnalysis(null), false)
  assert.equal(hasUsableAnalysis(undefined), false)
})

test('答案有、解析没有是合法组合（解析入口自隐，但参考答案照常显示）', () => {
  // 用户实测的 #16/#17/#18 就是这个形态：answer 有值、analysis 空
  const q = { answer: '$\\frac{\\sqrt{10}}{99}$', answer_source: 'recognized', analysis: '' }
  assert.equal(hasUsableAnalysis(q), false)
  assert.ok(q.answer, '判据只管解析，不得影响参考答案是否显示')
})
