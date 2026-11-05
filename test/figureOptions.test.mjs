// 回归测试：A/B/C/D 四个选项本身是图形（2026-11-05 负责人截图事故沉淀）
//
// 事故现场：卷面「一次函数 y=ax+b 与二次函数 y=ax²+bx …大致图象可能是（ ）」
// 的四个选项各是一幅坐标系小图。整页 OCR 的 options 契约只有「印刷体选项正文」，
// 配图规则还要求「不要把选项文字框进去」⇒ 落库后 A/B/C/D 全是空文本、
// 配图只抠到一格 ⇒ 复核页看不到另外三幅图，无法判定批改。
//
// 修复口径（不改 DB schema）：图形选项题要求
//   ① options = 可区分文字描述；② image_type = 'option_figures'；
//   ③ image_bbox = 整条四幅选项图 ⇒ 裁剪白名单保留整条 ⇒ 视觉求解看图给字母。
// 本测试锁死判据、四条 prompt 接线、完整性闸豁免、裁剪 skipRefine 透传。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FIGURE_OPTION_IMAGE_TYPE,
  isFigureOptionText,
  hasFigureOptionDescriptions,
  isFigureOptionQuestion,
  isUndifferentiatedFigureOptions,
} from '../src/utils/figureOptions.js'
import { sanitizeBackfillOptions } from '../server/utils/optionsBackfill.js'
import {
  checkQuestionCompleteness,
  resolveEffectiveQuestionType,
  COMPLETENESS_CODES,
} from '../server/utils/questionCompleteness.js'
import { checkQuestionCompleteness as checkQuestionCompletenessFront } from '../src/utils/questionCompleteness.js'
import { cropGeometryFigures } from '../server/utils/geometryCrop.js'
import {
  buildOCRPrompt,
  buildOptionsBackfillPrompt,
  buildAnswerGenerationPrompt,
} from '../server/config/ai.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const STEM = '一次函数 y=ax+b 与二次函数 y=ax²+bx 在同一平面直角坐标系中的大致图象可能是（ ）'
const GOOD_DESCRIPTIONS = [
  '图A：抛物线开口向下、直线斜率为正',
  '图B：抛物线开口向上、直线斜率为正',
  '图C：抛物线开口向下、直线斜率为负',
  '图D：抛物线开口向上、直线斜率为负',
]

// ── 唯一判据 ──

test('图形选项判据: image_type 标记 / 描述兜底 / 普通题不误伤', () => {
  assert.equal(FIGURE_OPTION_IMAGE_TYPE, 'option_figures')
  assert.equal(isFigureOptionQuestion({ image_type: 'option_figures', options: [] }), true)
  assert.equal(isFigureOptionQuestion({ image_type: 'OPTION_FIGURES', options: null }), true)
  assert.equal(isFigureOptionQuestion({ options: GOOD_DESCRIPTIONS }), true)
  assert.equal(isFigureOptionQuestion({ image_type: 'geometry', options: ['3/4', '4/3'] }), false)
  assert.equal(isFigureOptionQuestion({ image_type: 'chart', options: [] }), false)
  assert.equal(isFigureOptionQuestion({ options: [] }), false)
  assert.equal(isFigureOptionQuestion(null), false)
})

test('图形选项文字识别: 「图中阴影面积」这类正常选项正文不算图形选项', () => {
  assert.equal(isFigureOptionText('图A：开口向下'), true)
  assert.equal(isFigureOptionText('选项A图'), true)
  assert.equal(isFigureOptionText('图中阴影部分的面积'), false)
  assert.equal(isFigureOptionText('图形是平行四边形'), false)
  assert.equal(hasFigureOptionDescriptions(['图A：a', '3/4']), false)
  assert.equal(hasFigureOptionDescriptions(GOOD_DESCRIPTIONS), true)
})

test('退化占位: 四项全是「选项A图」或空「图A：」必须被识别', () => {
  assert.equal(isUndifferentiatedFigureOptions(['选项A图', '选项B图', '选项C图', '选项D图']), true)
  assert.equal(isUndifferentiatedFigureOptions(['图A：', '图B：']), true)
  assert.equal(isUndifferentiatedFigureOptions(GOOD_DESCRIPTIONS), false)
  assert.equal(isUndifferentiatedFigureOptions(['3/4', '4/3']), false)
  assert.equal(isUndifferentiatedFigureOptions([]), false)
})

// ── 补选项链路不许写进「看似有选项」的垃圾 ──

test('跨页补选项: 占位图形选项 / 纯字母回抄一律拒绝，有区分度描述放行', () => {
  assert.equal(sanitizeBackfillOptions(['选项A图', '选项B图', '选项C图', '选项D图']), null)
  assert.equal(sanitizeBackfillOptions(['A', 'B', 'C', 'D']), null)
  assert.deepEqual(sanitizeBackfillOptions(GOOD_DESCRIPTIONS), GOOD_DESCRIPTIONS)
  assert.deepEqual(sanitizeBackfillOptions([' 3/4 ', '4/3']), ['3/4', '4/3'])
})

// ── 四条 OCR / 答案 prompt 全部带上同一份规则 ──

test('主 OCR prompt: 图形选项专章（整条选项图 + 禁空 + 禁占位）', () => {
  const p = buildOCRPrompt()
  assert.match(p, /option_figures/)
  assert.match(p, /图形选项专章/)
  assert.match(p, /整条选项图/)
  assert.match(p, /绝不允许：options 留空/)
  assert.match(p, /唯一例外/)
})

test('补选项 prompt / 答案引擎 prompt 同口径接线', () => {
  const backfill = buildOptionsBackfillPrompt([{ questionNumber: 2, stem: STEM }])
  assert.match(backfill, /图形选项/)
  assert.match(backfill, /原卷裁剪/)

  const answer = buildAnswerGenerationPrompt()
  assert.match(answer, /选项为图形的题/)
  assert.match(answer, /严禁凭题干文字猜一个字母/)

  // 单题重识别与练习册 OCR 都是内联 prompt，用源码文本锁接线
  assert.match(read('server/services/questionOCRService.js'), /FIGURE_OPTION_TEXT_RULES/)
  const worker = read('server/worker.js')
  assert.match(worker, /FIGURE_OPTION_OCR_RULES/)
  assert.match(worker, /不许四项全写「选项A图」/)
  assert.doesNotMatch(worker, /形如 \["选项A图", "选项B图"/)
})

// ── 完整性闸：选项在配图里时不拦入册；没图的残题照拦 ──

test('完整性闸: 图形选项题有「选项图」时不报 missing_options，无图仍拦', () => {
  const base = {
    content: STEM,
    question_type: 'choice',
    image_type: 'option_figures',
    options: [],
    answer: 'B',
  }
  const withFig = checkQuestionCompleteness({ ...base, geometry_image_url: 'https://oss/option-figures.jpg' })
  assert.equal(withFig.codes.includes(COMPLETENESS_CODES.missing_options), false)
  assert.equal(withFig.isComplete, true)

  const noFig = checkQuestionCompleteness({ ...base, geometry_image_url: null })
  assert.equal(noFig.codes.includes(COMPLETENESS_CODES.missing_options), true)

  const plain = checkQuestionCompleteness({
    content: '下列各式中正确的是（ ）', question_type: 'choice', options: [], answer: 'A',
  })
  assert.equal(plain.codes.includes(COMPLETENESS_CODES.missing_options), true)
})

test('题型纠偏: 图形选项题即使 options 空也不被改判成填空题', () => {
  const q = {
    content: '下图中正确的是____',
    question_type: 'choice',
    image_type: 'option_figures',
    options: [],
  }
  assert.equal(resolveEffectiveQuestionType(q).type, 'choice')
  assert.equal(resolveEffectiveQuestionType(q).corrected, false)
  // 普通「choice + 空选项 + 填空线」仍按原口径纠偏，未被放宽
  const plain = { content: '结果是____', question_type: 'choice', options: [] }
  assert.equal(resolveEffectiveQuestionType(plain).type, 'fill')
})

// ── 裁剪白名单：整条选项图不能被退化框闸丢掉，且必须跳过像素收紧 ──

test('裁剪: 图形选项题的整条框保留 + skipRefine=true；普通题退化框仍丢弃', async () => {
  // 与题目 block 左对齐同宽 —— 正是 isDegenerateFigureBox 判为「机械推出来的框」的形态，
  // 但图形选项题的四幅小图整条恰好就是这么排的。
  const bbox = { x: 100, y: 250, width: 800, height: 90 }
  const block = { x: 100, y: 200, width: 800, height: 140 }
  const calls = []
  const cropImage = async (_buf, px, _sid, _qid, opts) => {
    calls.push({ px, opts })
    return 'https://oss/fig.jpg'
  }

  const figureQ = {
    id: 'fig-opt', question_number: 2, page_number: 1,
    image_type: 'option_figures', image_bbox: bbox, block_coordinates: block,
    options: GOOD_DESCRIPTIONS,
  }
  const r1 = await cropGeometryFigures({
    questions: [figureQ], pageBuffers: new Map([[1, Buffer.from('x')]]),
    cropImage, studentId: 'stu', log: () => {}, warn: () => {},
  })
  assert.equal(r1.cropped, 1)
  assert.equal(figureQ.geometry_image_url, 'https://oss/fig.jpg')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].opts.skipRefine, true)

  const plainQ = {
    id: 'plain', question_number: 3, page_number: 1,
    image_type: 'geometry', image_bbox: bbox, block_coordinates: block,
  }
  const r2 = await cropGeometryFigures({
    questions: [plainQ], pageBuffers: new Map([[1, Buffer.from('x')]]),
    cropImage, studentId: 'stu', log: () => {}, warn: () => {},
  })
  assert.equal(r2.cropped, 0)
  assert.equal(plainQ.geometry_image_url, undefined)
  assert.equal(calls.length, 1, '普通退化框不得触发裁剪')
})

// ── 前端完整性镜像必须与服务端同源（本仓有「两份镜像」的历史约定） ──

test('前后端完整性镜像: 图形选项题结果逐字一致', () => {
  const cases = [
    { content: STEM, question_type: 'choice', image_type: 'option_figures', options: [], answer: 'B', geometry_image_url: 'https://oss/f.jpg' },
    { content: STEM, question_type: 'choice', image_type: 'option_figures', options: [], answer: 'B', geometry_image_url: null },
    { content: '下列各式中正确的是（ ）', question_type: 'choice', options: [], answer: 'A' },
    { content: STEM, question_type: 'choice', options: GOOD_DESCRIPTIONS, answer: 'C' },
  ]
  for (const q of cases) {
    assert.deepEqual(checkQuestionCompletenessFront(q), checkQuestionCompleteness(q))
  }
  // 源码契约：两份镜像都必须引用同一个共享判据模块，不许各写一份
  assert.match(read('src/utils/questionCompleteness.js'), /isFigureOptionQuestion/)
  assert.match(read('server/utils/questionCompleteness.js'), /isFigureOptionQuestion/)
})
