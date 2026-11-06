// 回归锁：存量「图形选项题」的两种历史落库写法（2026-11-06 期中基础题复习卷 #19）
//
// 事故现场：11-02 上传的卷子里 6 道「A/B/C/D 本身是四幅图」的选择题，
// OCR 落库成 options=["图A","图B","图C","图D"]（或 "A图：…" 描述）、
// image_type='chart'、geometry_image_url='' / NULL、option_images=[]。
// 11-05/11-06 新做的图形选项链路只覆盖「新上传题的 prompt」与「已补 option_images
// 的四格渲染」，判据正则只认「选项A图 / 图A：」⇒ 这批存量题既没有四幅图，
// 复核页连「存量兼容 / 把选项图框成配图」提示都不显示，只剩「A. 图A」四行文字。
//
// 本锁固定三件事：① 共享判据认得这两种历史写法且不误伤正常文字选项；
// ② 补选项链路拒绝纯「图A」占位，防止新题再次落库成无图题；
// ③ 复核页对「判为图形选项题、却没有任何图」给出可行动诊断与裁图入口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isFigureOptionText,
  hasFigureOptionDescriptions,
  isFigureOptionQuestion,
  isUndifferentiatedFigureOptions,
} from '../src/utils/figureOptions.js'
import { sanitizeBackfillOptions } from '../server/utils/optionsBackfill.js'
import { checkQuestionCompleteness as serverCheck } from '../server/utils/questionCompleteness.js'
import { checkQuestionCompleteness as frontCheck } from '../src/utils/questionCompleteness.js'
import { buildOCRPrompt, buildOptionsBackfillPrompt } from '../server/config/ai.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const PLACEHOLDERS = ['图A', '图B', '图C', '图D']
const A_FIG_DESCRIPTIONS = [
  'A图：抛物线开口向上，对称轴在y轴左侧；双曲线在第一、三象限',
  'B图：抛物线开口向下，对称轴在y轴左侧；双曲线在第一、三象限',
  'C图：抛物线开口向上，对称轴在y轴右侧；双曲线在第一、三象限',
  'D图：抛物线开口向下，对称轴在y轴右侧；双曲线在第二、四象限',
]
const STEM = '在同一平面直角坐标系中，二次函数y=ax²+bx与一次函数y=bx-a的图象可能是（ ）'

// ── ① 共享判据：历史写法全认，正常文字选项不误伤 ──────────────────────

test('图形选项判据: 覆盖「图A」纯占位与「A图：…」描述两种存量写法', () => {
  for (const s of ['图A', '图B', '图A：开口向下', 'A图：抛物线开口向上', 'A图', '选项A图', '[图形选项]']) {
    assert.equal(isFigureOptionText(s), true, `应识别: ${s}`)
  }
  for (const s of ['图中阴影部分的面积', '图形是平行四边形', 'A图形状不规则', '图3中的阴影', '3/4', '']) {
    assert.equal(isFigureOptionText(s), false, `不应误伤: ${s}`)
  }
  assert.equal(hasFigureOptionDescriptions(PLACEHOLDERS), true)
  assert.equal(hasFigureOptionDescriptions(A_FIG_DESCRIPTIONS), true)
  assert.equal(hasFigureOptionDescriptions(['图A', '3/4']), false)
})

test('存量题没有 image_type 标记也能被判为图形选项题', () => {
  // 11-02 卷 q18：chart + 四个纯占位 + 空配图
  assert.equal(isFigureOptionQuestion({
    image_type: 'chart', options: PLACEHOLDERS, geometry_image_url: '',
  }), true)
  // 同卷 q21/q23/q24：chart + 「A图：…」有区分度描述 + 无配图
  assert.equal(isFigureOptionQuestion({
    image_type: 'chart', options: A_FIG_DESCRIPTIONS, geometry_image_url: null,
  }), true)
  assert.equal(isFigureOptionQuestion({ image_type: 'chart', options: ['3/4', '4/3'] }), false)
  assert.equal(isFigureOptionQuestion({ image_type: 'chart', options: ['', '', '', ''] }), false)
})

// ── ② 补选项链路：纯占位一律拒收，有区分度的描述放行 ────────────────────

test('补选项: ["图A","图B","图C","图D"] 必须拒收；"A图：…" 描述放行', () => {
  assert.equal(sanitizeBackfillOptions(PLACEHOLDERS), null)
  assert.equal(sanitizeBackfillOptions(['A图', 'B图', 'C图', 'D图']), null)
  assert.equal(sanitizeBackfillOptions(['选项A图', '选项B图', '选项C图', '选项D图']), null)
  assert.deepEqual(sanitizeBackfillOptions(A_FIG_DESCRIPTIONS), A_FIG_DESCRIPTIONS)
  assert.equal(isUndifferentiatedFigureOptions(PLACEHOLDERS), true)
  assert.equal(isUndifferentiatedFigureOptions(A_FIG_DESCRIPTIONS), false)
})

test('四条 prompt 规则都明确禁「图A / A图」这类无区分度占位', () => {
  const ocr = buildOCRPrompt()
  assert.match(ocr, /绝不允许：options 留空/)
  assert.match(ocr, /图A \/ A图/)
  const backfill = buildOptionsBackfillPrompt([{ questionNumber: 18, stem: STEM }])
  assert.match(backfill, /图A \/ A图/)
})

// ── ③ 前后端完整性镜像仍逐字一致（判据扩展不得只改一边） ────────────────

test('完整性闸: 存量图形选项形态在前后端两份镜像结果一致', () => {
  const cases = [
    { content: STEM, question_type: 'choice', image_type: 'chart', options: PLACEHOLDERS, answer: '', geometry_image_url: '' },
    { content: STEM, question_type: 'choice', image_type: 'chart', options: A_FIG_DESCRIPTIONS, answer: 'A', geometry_image_url: null },
    { content: '下列各式中正确的是（ ）', question_type: 'choice', options: ['3/4', '4/3'], answer: 'A' },
  ]
  for (const q of cases) assert.deepEqual(frontCheck(q), serverCheck(q))
})

// ── ④ 复核页：共享判据接线 + 「无图」可行动诊断必须排在误导文案之前 ──────

test('复核页: 图形选项题无图时给原因 + 原卷裁图入口，不说「见上方四幅图」', () => {
  const vue = read('src/workbench/components/review/QuestionDetailPanel.vue')
  assert.match(vue, /isFigureOptionQuestion\(q0\)/)
  assert.match(vue, /ops-figure-option-tip--missing/)
  assert.match(vue, /isFigureOption && !displayImageUrl/)
  assert.match(vue, /把选项图框成配图/)
  const missing = vue.indexOf('ops-figure-option-tip--missing')
  const normalTip = vue.indexOf('四幅选项图见上方「选项图」')
  assert.ok(missing > 0 && normalTip > missing, '无图诊断必须先于「四幅图见上方」的普通提示')
  // 存量兼容分支仍保留（options 四个空串 + 有配图的老题不能被新判据挤掉）
  assert.match(vue, /String\(o\)\.trim\(\) && !isFigureOptionText\(o\)/)
})
