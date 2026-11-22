/**
 * 错因诊断三段式 —— 回归锁（2026-11-22 T0，OmniEdu 评审落地第一项）
 *
 * 背景：旧 prompt 直接把「题目 + 学生答案 + 正确答案 + 题型」丢给模型，让它从十类词表里挑一个。
 * 这不叫诊断，叫猜 —— 因为模型没有被要求先定位「学生从哪一步开始错」。
 * 实测 2104 条错题的错因分布：「计算错误 752 + 未作答 498 + 概念不理解 395」= 78%，
 * 真正可教学的「审题 / 步骤遗漏 / 方法选择」类只占零头。
 *
 * 本锁守五件事，每条都对应一次会静默劣化的退化路径：
 *  ① error_step 必须排在 error_type 之前 —— 顺序反了模型会先贴标签再补理由（标签照抄）
 *  ② 十类词表约束不许放宽 —— 放宽后模型自创「粗心大意」「基础不牢」，词表就废了
 *  ③ 证据不足必须认输，且禁止用题目难度反推 —— 不然它会给每道题编一个像样的出错步骤
 *  ④ reason 是一句能指导教学的判语，不是标签拼接
 *  ⑤ 学科上下文可选注入，不能把「学科：null」写进 prompt
 *
 * 断言对象是 prompt 文本本身，不是模型行为 —— 因为 prompt 是这条链路上唯一能被静态篡改的部分。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildErrorAnalysisPrompt } from '../server/services/diagnosisService.js'

const VOCAB = [
  '计算错误',
  '审题错误',
  '公式记忆错误',
  '概念不理解',
  '步骤遗漏',
  '单位错误',
  '方法选择错误',
  '不会分析',
  '抄写错误',
  '粗心'
]

const PROMPT = buildErrorAnalysisPrompt(VOCAB, '数学')

test('① 三段式顺序：先定位出错环节，再判类别', () => {
  const iStep = PROMPT.indexOf('1. error_step')
  const iType = PROMPT.indexOf('2. error_type')
  assert.ok(iStep >= 0, 'prompt 必须包含编号为 1 的 error_step 步骤')
  assert.ok(iType >= 0, 'prompt 必须包含编号为 2 的 error_type 步骤')
  assert.ok(iStep < iType, 'error_step 必须排在 error_type 之前；顺序反了模型会先贴标签再编理由')
})

test('② 十类词表约束不许放宽', () => {
  for (const w of VOCAB) {
    assert.ok(PROMPT.includes(w), `词表项「${w}」必须出现在 prompt 里`)
  }
  assert.ok(PROMPT.includes('不得自创'), '必须保留「不得自创」约束')
  assert.ok(PROMPT.includes('必须严格来自上面的列表'), '必须保留词表校验语')
})

test('③ 证据不足必须认输，且禁止编造步骤', () => {
  assert.ok(PROMPT.includes('证据不足'), '必须明确「证据不足」这个合法输出')
  assert.ok(PROMPT.includes('禁止编造步骤'), '必须显式禁止编造出错步骤')
  // 这条是防「用题目难度/常见错误反推」的关键 —— 少了它，模型会给每道题都编一个步骤
  assert.ok(PROMPT.includes('禁止用题目难度'), '必须禁止用题目难度反推出错步骤')
  assert.ok(PROMPT.includes('confidence 不得高于 0.5'), '证据不足时必须压低置信度')
})

test('④ reason 是一句判语，不是标签拼接', () => {
  assert.ok(PROMPT.includes('不超过 60 字'), 'reason 必须有字数上限')
  assert.ok(PROMPT.includes('错在哪一步'), 'reason 必须说清出错环节')
  assert.ok(PROMPT.includes('不要写「学生做错了」'), '必须禁止无法指导教学的空话')
  // 2026-11-22 决定：不往 error_reason 塞结构化前缀。
  // 它的下游 englishAnalyzer.classifyEnglishErrorType() 会把字段拼成正则 haystack，
  // 而 /the\b/、/复数/ 这类模式极宽，塞前缀会污染英语错因归类。
  assert.ok(!PROMPT.includes('【步骤】'), '不许要求模型输出【步骤】前缀 —— 会污染 error_reason 的正则消费方')
  assert.ok(!PROMPT.includes('｜'), '不许引入全角竖线分隔符 —— error_reason 是自然语言展示字段')
})

test('⑤ 学科上下文可选注入，空学科不许写进 prompt', () => {
  assert.ok(PROMPT.includes('学科：数学'))
  const noSubject = buildErrorAnalysisPrompt(VOCAB)
  assert.ok(!noSubject.includes('学科：'), '未传学科时不许出现「学科：」半截标签')
})

test('新增三个中间字段都在返回格式里', () => {
  for (const f of ['error_step', 'misconception', 'missing_prereq']) {
    assert.ok(PROMPT.includes(f), `返回格式必须含 ${f}`)
  }
})
