/**
 * 回归测试：L1-c —— 答案引擎空手而归时用「纯题干定向重解」（2026-09-23 三层分流）
 *
 * ══ 一个必须记住的测量教训 ══
 * 本功能最初立项的依据是：「近 14 天 110 道缺参考答案里 92 道（84%）的答案与学生答案
 * 逐字全等 ⇒ 答案引擎在抄学生的笔迹」。**这个前提是错的。**
 *
 * 复测（server/_diag_l1c_recheck_0923.mjs）：
 *   · 被误当作判据的字段是 `ai_answer`。而 `ai_answer` 按定义就等于学生答案
 *     （worker.js: `const aiAnswer = rawStudentAnswer`）—— 它是 OCR 对**学生笔迹的
 *     抄录**，不是参考答案。拿它做污染判据，测出来必然是"100% 污染"的假信号。
 *   · 真正的参考答案字段 `answer` 与 student_answer 逐字全等：**0 / 110**。
 *   · 缺参考答案的 110 道里 95 道是 `answer` **为空**（95 空 / 15 非空）。
 *
 * ⇒ 结论：**「抄学生」不是主因**。真正该补的缺口是"引擎没给出答案"。
 *   且"抄学生"这一真实场景早已由 worker 的 P3 闸处理
 *   （standardAnswer === cleanedStudentAnswer → 置空 → 转后续答案链路）。
 *   本功能因此改为：**引擎失败时用纯题干再定向重解一次**。
 *
 * 本测试锁四条契约：
 *   ① 纯题干输入里绝不能出现 student_answer / answer / analysis（否则引入前一轮的
 *      污染或错误结论，"独立求解"这件事就不成立了）
 *   ② 只在引擎空手而归时触发，绝不在引擎已给出答案时覆盖（补缺口 vs 推翻结论，性质不同）
 *   ③ 重解候选必须过 validateAIAnswer + 不等于学生答案才可采纳
 *   ④ 所有失败路径都不改动状态（零回归）
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
const SELF_CHECK = readFileSync(resolve(ROOT, 'server/utils/aiParseSelfCheck.js'), 'utf8')
const JUDGE = readFileSync(resolve(ROOT, 'server/services/judgeService.js'), 'utf8')

const { buildTextOnlyResolveInput, detectAnswerCopiedFromStudent } = await import(
  '../server/utils/aiParseSelfCheck.js'
)

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

const WORKER_CODE = stripComments(WORKER)
const SELF_CHECK_CODE = stripComments(SELF_CHECK)

const helperBody = (() => {
  const start = WORKER_CODE.indexOf('const resolveCopiedAnswerViaTextOnly = async')
  assert.ok(start > -1, '找不到 resolveCopiedAnswerViaTextOnly')
  const rest = WORKER_CODE.slice(start + 10)
  const next = rest.search(/\n(const|export|let|function) /)
  return WORKER_CODE.slice(start, next > -1 ? start + 10 + next : undefined)
})()

// ── ① 纯题干输入契约 ─────────────────────────────────────

test('★ L1-c：纯题干输入只含题干字段，绝不带学生答案/参考答案/解析', () => {
  const out = buildTextOnlyResolveInput({
    parent_stem: '如图，在△ABC中，D为BC上一点',
    content: '(1) 求证 AB=AC',
    student_answer: '证明：因为 AB=AC 所以三角形是等腰三角形',
    answer: '证明：由 SSS 全等得 AB=AC',
    analysis: '这是一段解析',
  })
  assert.ok(out.includes('△ABC'), '必须含 parent_stem')
  assert.ok(out.includes('(1) 求证 AB=AC'), '必须含 content')
  assert.ok(!out.includes('等腰三角形'), '绝不能含学生答案')
  assert.ok(!out.includes('SSS'), '绝不能含上一轮的参考答案')
  assert.ok(!out.includes('这是一段解析'), '绝不能含上一轮解析')
})

test('★ L1-c：选择题必须带上选项（否则纯文本链路无解）', () => {
  const out = buildTextOnlyResolveInput({ content: '下列哪个正确' }, ['A. 1', 'B. 2'])
  assert.ok(out.includes('A. 1') && out.includes('B. 2'), '选项必须进输入')
})

test('L1-c：无题干时返回空串（调用方据此放弃重解）', () => {
  assert.equal(buildTextOnlyResolveInput({}), '')
  assert.equal(buildTextOnlyResolveInput({ content: '  ' }), '')
  assert.equal(buildTextOnlyResolveInput(null), '')
})

test('L1-c：选项容错（非数组/空值不炸）', () => {
  assert.doesNotThrow(() => buildTextOnlyResolveInput({ content: '题' }, 'not-array'))
  assert.equal(buildTextOnlyResolveInput({ content: '题' }, null), '题')
})

test('L1-c：共享构造器里不得出现 student_answer（防调用方误传整行 question）', () => {
  const start = SELF_CHECK_CODE.indexOf('export function buildTextOnlyResolveInput')
  assert.ok(start > -1)
  const body = SELF_CHECK_CODE.slice(start, start + 1600)
  assert.ok(!/student_answer/.test(body), '构造器内不得引用 student_answer')
})

// ── ② 触发时机：只补缺口，不推翻结论 ─────────────────────

test('★ 红线：只在引擎空手而归时触发（避免"补缺口"变成"推翻已有结论"）', () => {
  assert.match(
    WORKER_CODE,
    /const engineCameBackEmpty = /,
    '必须有显式的"引擎空手而归"判据'
  )
  assert.match(
    WORKER_CODE,
    /if \(engineCameBackEmpty\) \{/,
    '重解必须以该判据为门'
  )
  // 空答案的四种形态都要覆盖
  for (const marker of ['待人工补充', '此为主观题，无唯一标准答案']) {
    assert.ok(
      WORKER_CODE.includes(marker),
      `空手而归判据必须包含「${marker}」这种形态`
    )
  }
})

test('★ 红线：不得再用 detectAnswerCopiedFromStudent 触发重解（前提已被推翻）', () => {
  const idx = WORKER_CODE.indexOf('engineCameBackEmpty)')
  assert.ok(idx > -1)
  const block = WORKER_CODE.slice(Math.max(0, idx - 3000), idx + 2000)
  assert.ok(
    !/detectAnswerCopiedFromStudent\(result\.answer, q\.student_answer\)/.test(block),
    '对 result.answer 做"抄学生"判定会重新引入被推翻的前提；且该场景已由 P3 闸处理'
  )
})

test('L1-c：P3 闸（抄学生 → 置空重解）必须仍然存在（本功能的前提是它已生效）', () => {
  assert.match(
    WORKER_CODE,
    /isSameAnswerText\(standardAnswer, cleanedStudentAnswer\)/,
    'P3 闸是"抄学生"场景的真实处理点，不得被本功能取代而删除'
  )
})

// ── ③ 采纳判据 ───────────────────────────────────────────

test('★ 红线：重解候选必须过 validateAIAnswer 才可采纳', () => {
  assert.match(helperBody, /validateAIAnswer\(retryResult\.answer/, '必须过有效性闸')
  assert.match(helperBody, /why: 'invalid_answer'/, '无效答案必须拒绝')
})

test('L1-c：重解结果等于学生答案时保持保守（不采纳）', () => {
  assert.match(
    helperBody,
    /detectAnswerCopiedFromStudent\(retryResult\.answer,\s*q\?\.student_answer\)/,
    '必须保留保守闸 —— 引擎两次都给出等于学生答案的值时，更可能是读到了笔迹'
  )
  assert.match(helperBody, /why: 'still_copied'/, '必须给出原因便于排查')
})

test('L1-c：四种失败原因都不改动状态（零回归）', () => {
  for (const why of ['no_stem', 'invalid_answer', 'still_copied', 'engine_failed']) {
    assert.ok(helperBody.includes(`why: '${why}'`), `必须显式处理 ${why}`)
  }
  const adoptedTrue = helperBody.match(/adopted: true/g) || []
  assert.equal(adoptedTrue.length, 1, '只允许一个采纳出口')
})

test('L1-c：重解输入必须走 buildTextOnlyResolveInput（不得手拼 q.content）', () => {
  assert.match(helperBody, /buildTextOnlyResolveInput\(q,\s*q\?\.options\)/)
})

// ── ④ 不写误导老师的原因 ─────────────────────────────────

test('★ L1-c：不得写「疑似抄学生」原因（会把老师引向被推翻的错误方向）', () => {
  assert.ok(
    !/answer_copied_suspected/.test(JUDGE),
    'UNJUDGED_REASONS 不得有 answer_copied_suspected —— 复测证明抄学生不是主因'
  )
})

test('L1-c：重解未果时的原因文案必须说清"引擎没给出答案"', () => {
  assert.match(
    WORKER_CODE,
    /定向重解未果/,
    '老师需要知道"系统已重试过一次仍未果"，否则会以为系统只跑了一次就放弃了'
  )
})

// ── ⑤ 判据本身的性质（保留作为"保守闸"，不再是污染证据）────────

test('判据性质：8 字符门槛下短答案不触发、长答案触发', () => {
  // 该判据现在只用于"引擎两次给出同一值且等于学生答案时保持保守"，
  // 不再作为"抄学生"的证据（纯文本层区分不了"抄"与"答对且值相同"）。
  assert.equal(detectAnswerCopiedFromStudent('24', '24'), false, '短答案不触发')
  assert.equal(detectAnswerCopiedFromStudent('3x²-8xy+5', '3x²-8xy+5'), true, '长答案触发')
  assert.equal(detectAnswerCopiedFromStudent('', ''), false)
  assert.equal(detectAnswerCopiedFromStudent(null, 'x'), false)
})
