/**
 * 缺配图预判闸回归测试（2026-09-24）
 *
 * 锁定「题干引图但无配图 → 跳过答案引擎」的判据，防止后续改动放宽或误拦。
 * 判据与 checkQuestionCompleteness 规则1 同源（hasFigureReference），
 * 本测试同时锁定「只查 content 漏掉 parent_stem」这个历史坑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldSkipForMissingFigure,
  isFigurePreflightSkipEnabled,
  MISSING_FIGURE_SKIP_REASON,
} from '../server/utils/figureRequirementGuard.js'

const q = (over = {}) => ({ id: 'x', parent_stem: '', content: '', ...over })

test('引图 + 无配图 → 跳过（用户要求：别浪费 token）', () => {
  const r = shouldSkipForMissingFigure(q({ content: '如图，求阴影部分面积。' }), null)
  assert.equal(r.skip, true)
  assert.equal(r.reason, MISSING_FIGURE_SKIP_REASON)
})

test('引图 + 有配图 → 正常解析（绝不拦）', () => {
  const r = shouldSkipForMissingFigure(q({ content: '如图，求阴影部分面积。' }), 'https://oss/x.png')
  assert.equal(r.skip, false)
})

test('不引图 + 无配图 → 正常解析（纯文字题可能解得出）', () => {
  const r = shouldSkipForMissingFigure(q({ content: '计算 1+1=?' }), null)
  assert.equal(r.skip, false)
})

test('引图词只在 parent_stem（拆小问后常见）→ 仍要拦', () => {
  const r = shouldSkipForMissingFigure(
    q({ parent_stem: '如图，在△ABC中，D为BC上一点。', content: '(1) 求证：△ABD∽△CBA' }),
    null
  )
  assert.equal(r.skip, true, '只读 content 会漏判 —— 这是 2026-09-17 周末班课件的已知坑')
})

test('引图词形态覆盖：图8 / 图示 / 附图 / 见图', () => {
  for (const t of ['图8 是某班成绩分布', '图示为一个梯形', '见附图', '见图2']) {
    assert.equal(shouldSkipForMissingFigure(q({ content: t }), null).skip, true, t)
  }
})

test('「图书」「图形」等非引图词不误伤', () => {
  for (const t of ['图形变换的概念', '图书馆有书若干']) {
    assert.equal(shouldSkipForMissingFigure(q({ content: t }), null).skip, false, t)
  }
})

test('空值/空串配图视为无图', () => {
  assert.equal(shouldSkipForMissingFigure(q({ content: '如图' }), '').skip, true)
  assert.equal(shouldSkipForMissingFigure(q({ content: '如图' }), '   ').skip, true)
})

test('开关 ANSWER_FIGURE_PREFLIGHT_SKIP=0 → 整体关闭', () => {
  const prev = process.env.ANSWER_FIGURE_PREFLIGHT_SKIP
  process.env.ANSWER_FIGURE_PREFLIGHT_SKIP = '0'
  try {
    assert.equal(isFigurePreflightSkipEnabled(), false)
    assert.equal(shouldSkipForMissingFigure(q({ content: '如图' }), null).skip, false)
  } finally {
    if (prev === undefined) delete process.env.ANSWER_FIGURE_PREFLIGHT_SKIP
    else process.env.ANSWER_FIGURE_PREFLIGHT_SKIP = prev
  }
})

test('默认开启（未设 env 时）', () => {
  const prev = process.env.ANSWER_FIGURE_PREFLIGHT_SKIP
  delete process.env.ANSWER_FIGURE_PREFLIGHT_SKIP
  try {
    assert.equal(isFigurePreflightSkipEnabled(), true)
  } finally {
    if (prev !== undefined) process.env.ANSWER_FIGURE_PREFLIGHT_SKIP = prev
  }
})

test('空题目对象不崩、不拦', () => {
  assert.equal(shouldSkipForMissingFigure(null, null).skip, false)
  assert.equal(shouldSkipForMissingFigure(undefined, null).skip, false)
})
