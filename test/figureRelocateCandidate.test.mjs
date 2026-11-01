/**
 * 回归测试：视觉重定位清扫候选条件（2026-11-01 闭环缺口修复）
 *
 * 事故背景（2026-11-01「待复核作业全是缺配图」排查）：
 *   被缺配图预判闸（figureRequirementGuard）跳过解析的题：answer_exception=true、
 *   is_correct=NULL（未判定）、answer_source='recognized' —— 原候选条件
 *   `is_correct=FALSE OR answer_source='blank'` **永远不包含它们**，
 *   视觉重定位清扫自 2026-09-27 部署以来对这类题从未生效（实测重定位池=0）。
 *   而这类题恰是「OCR 模型确认有图却被 refine 误杀」后的唯一出路：
 *   补裁清扫会永远循环同一拒绝（refine 宁缺毋滥，判据不可放宽）。
 *
 * 锁定红线：
 *   ① 候选必须含「被缺图闸跳过解析」分支（answer_exception=true + reason 逐字等于闸文案）；
 *   ② 原有两类候选（判错题 / 空答题）不得丢失；
 *   ③ reason 匹配必须用 MISSING_FIGURE_SKIP_REASON 常量逐字匹配，不得 LIKE 宽匹配
 *      （防止把其它 answer_exception 的题误拉进付费视觉通道）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { CANDIDATE_SQL, relocateOneFigure } = await import('../server/services/figureRelocateSweep.js')
const { MISSING_FIGURE_SKIP_REASON } = await import('../server/utils/figureRequirementGuard.js')

test('★ 红线①：候选含「被缺图闸跳过解析」分支', () => {
  assert.match(CANDIDATE_SQL, /q\.answer_exception = TRUE/)
  assert.match(CANDIDATE_SQL, /q\.answer_exception_reason = \$2::text/)
})

test('★ 红线②：原有候选（判错 / 空答）不丢失', () => {
  assert.match(CANDIDATE_SQL, /q\.is_correct = FALSE/)
  assert.match(CANDIDATE_SQL, /q\.answer_source = 'blank'/)
})

test('★ 红线③：reason 逐字匹配闸文案常量（参数化，非 SQL 内宽匹配）', () => {
  // SQL 里不允许出现 LIKE '%...%' 形式的 reason 匹配
  assert.doesNotMatch(CANDIDATE_SQL, /answer_exception_reason LIKE/)
  // 常量必须与闸文案逐字一致（两模块各自 import 同一常量，这里防常量被本地改写）
  assert.equal(MISSING_FIGURE_SKIP_REASON, '题干要求配图但本题未采集到配图，已跳过 AI 解析（补图后可重算）')
})

test('候选 SQL 保留引图判据与页图/软删防护', () => {
  assert.match(CANDIDATE_SQL, /如图\|图\[0-9\]\+\|图示\|附图\|见图/)
  assert.match(CANDIDATE_SQL, /q\.geometry_image_url IS NULL/)
  assert.match(CANDIDATE_SQL, /q\.deleted_at IS NULL/)
  assert.match(CANDIDATE_SQL, /t\.deleted_at IS NULL/)
  assert.match(CANDIDATE_SQL, /t\.images IS NOT NULL/)
})

test('跨学生共享 targets 同样覆盖缺图闸跳过的题', async () => {
  // sweepFigureCrossStudentShare 的 SQL 内联在函数体里，读源码断言（无独立导出）
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../server/services/figureRelocateSweep.js', import.meta.url), 'utf8')
  const crossShareIdx = src.indexOf('sweepFigureCrossStudentShare')
  assert.ok(crossShareIdx > 0)
  const body = src.slice(crossShareIdx, src.indexOf('scheduleFigureRelocateSweep'))
  assert.match(body, /q\.answer_exception = TRUE/)
  assert.match(body, /answer_exception_reason = \$1::text/)
})

test('模块导出完整（relocateOneFigure 可复用）', () => {
  assert.equal(typeof relocateOneFigure, 'function')
})
