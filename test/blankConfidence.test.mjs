/**
 * 回归测试：L1-a —— 未作答（blank）的 confidence 统一写 1.0（2026-09-23）
 *
 * ── 为什么要有这条契约 ──
 * blank（学生未作答）是**终态**：getReviewState 直接返回 'blank'，
 * 「未作答等同不会」已是统计口径，老师无需为它拍板任何事。
 * 但批改管线的不同分支给空题写了**分裂的** confidence：
 *   · processTask            → `q.confidence || 0`（一般为 0）
 *   · workbook 管线          → `isEmpty ? 0 : …`
 *   · workbook 建题段        → `q.is_correct !== null ? 0.95 : null`（blank 写 null）
 *   · 重练 slim 预填         → 0，且 UPDATE 用 COALESCE 把旧值留下
 * 后果有两个，实测都发生过：
 *   ① 0 < 0.8（CONFIDENCE_THRESHOLD）⇒ 空题命中入册闸的 low_confidence
 *      ⇒ 整卷被错题弹窗拦下，老师为空题点一次「本次不加入」（14 天 27 道）
 *   ② 0.95 会被前端 mergeJudgements 当"AI 敢下结论"的置信度合并，
 *      空题因此参与 6 态判定（14 天 56 道）
 * 统一成 1.0 后：既不触发任何阈值闸，也不会被误当判题置信度，
 * 同时如实表达"这道题的判定没有不确定性"。
 *
 * ⚠️ 本测试锁的是**代码契约**（写入点必须显式处理 blank），不是某个数字的巧合。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
const FINALIZER = readFileSync(resolve(ROOT, 'server/services/gradingFinalizer.js'), 'utf8')

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

const WORKER_CODE = stripComments(WORKER)
const FINALIZER_CODE = stripComments(FINALIZER)

// ── 主 OCR 管线（processTask）────────────────────────────

test('L1-a：processTask 的 blank 必须写 1.0', () => {
  const m = WORKER_CODE.match(/confidence:\s*answerSource === 'blank' \? ([\d.]+)/)
  assert.ok(m, "processTask 建题段必须显式判 answerSource === 'blank'")
  assert.equal(m[1], '1.0', 'blank 的 confidence 必须是 1.0')
})

// ── 练习册答案库管线（workbook）───────────────────────────

test('L1-a：workbook 答案匹配段对 blank 必须显式写 1.0', () => {
  const idx = WORKER_CODE.indexOf("q.answer_source = 'blank'")
  assert.ok(idx > -1, '找不到 workbook 的 blank 赋值点')
  const block = WORKER_CODE.slice(idx, idx + 500)
  assert.match(block, /q\.confidence = 1(\.0)?[,\s;]/, 'blank 分支里必须把 confidence 归到 1.0')
})

test('L1-a：workbook 建题段 blank 不得写 null（null 会被前端当"处理中"占待办）', () => {
  const m = WORKER_CODE.match(/confidence:\s*isEmpty \? ([\d.]+)/)
  assert.ok(m, '找不到 workbook 建题段的 confidence 表达式')
  assert.equal(m[1], '1.0', 'isEmpty(blank) 的 confidence 必须是 1.0')
})

test('L1-a：workbook 审计记录与 questions.confidence 同口径', () => {
  const m = WORKER_CODE.match(/confidence:\s*q\.answer_source === 'blank' \? ([\d.]+)/)
  assert.ok(m, 'workbook createJudgement 必须显式判 blank')
  assert.equal(m[1], '1.0', '审计记录的 blank confidence 也必须是 1.0')
})

// ── 重练 slim 管线 ───────────────────────────────────────

test('L1-a：slim 不得用 COALESCE 保留空题的旧 confidence', () => {
  const idx = WORKER_CODE.indexOf('SET student_answer = $1')
  assert.ok(idx > -1, '找不到 slim 预填 UPDATE')
  const block = WORKER_CODE.slice(Math.max(0, idx - 800), idx + 500)
  assert.match(
    block,
    /nextConfidence\s*=\s*nextAnswerSource === 'blank' \? 1/,
    'blank 必须显式写 1，不能把可能是旧的 r.confidence 传进 COALESCE'
  )
})

// ── 结算 / 改判（gradingFinalizer）────────────────────────

test('L1-a：finalizeRejudgeResult 对 blank 必须无条件覆盖 confidence', () => {
  assert.match(
    FINALIZER_CODE,
    /isBlankQuestion\s*=\s*question\.answer_source === 'blank'/,
    '改判链路必须识别 blank'
  )
  // 必须走「无条件覆盖」而不是 GREATEST —— 旧值可能是 0.95，只抬不降会留下错值
  assert.match(
    FINALIZER_CODE,
    /WHEN \$4::boolean THEN 1\.0/,
    'SQL 里 blank 必须无条件写 1.0（不能走 GREATEST，否则 0.95 的旧值会被留下）'
  )
  assert.ok(
    /isBlankQuestion \? 1\.0 : effectiveConfidence/.test(FINALIZER_CODE),
    '返回值必须与落库值一致，否则调用方拿到的 confidence 与库里不符'
  )
})

test('L1-a：finalizeGradingBatch 的审计记录对 blank 写 1.0', () => {
  assert.match(
    FINALIZER_CODE,
    /confidence:\s*question\.answer_source === 'blank' \? 1\.0/,
    '结算审计必须与 questions.confidence 同口径'
  )
})

// ── 反向：入册闸必须继续把 blank 排除在置信度闸外 ──────────

test('★ 红线：入册闸不得改成"依赖 blank 的 confidence 数值"', () => {
  const NEON = stripComments(readFileSync(resolve(ROOT, 'server/services/neonService.js'), 'utf8'))
  const hits = NEON.match(/answer_source === 'blank'\) continue/g) || []
  assert.ok(
    hits.length >= 1,
    'addWrongQuestions 的置信度闸必须继续显式跳过 blank —— ' +
    '若改成靠"blank 的 confidence=1.0 自然过闸"，后来人一改那个数字，空题就会悄悄开始被阈值卡住'
  )
})
