/**
 * taskRoute.test.mjs — 批改路线改写的唯一口径（2026-09-20）
 *
 * 锁定事故：上传时选了「练习册批改路线」、卷子其实不是那本练习册时，
 * workbook 管线拿 A 册答案库对 B 卷题号 ⇒ 整卷错判 + 题干落成「第 N 题」占位 +
 * 错题以错误 worksheet_id 入册。而改路线时**只清 task_type 不清 worksheet_id**
 * 是头号陷阱：retryTaskById 在非 workbook 时把 worksheet_id 兜底填进 resourceId
 * ⇒ 任务拐进 processAnswerBankGrading，用同一本练习册的 resource_answers 再错一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planTaskRouteChange, resolveRouteKind, ROUTE_TARGETS, shouldResetTaskName, isRouteAutoName, buildAutoTaskName, describeRouteRisk, isRouteConvertEnabled, ROUTE_CONVERT_DISABLED_MESSAGE } from '../server/utils/taskRoute.js'

const WS = '11111111-1111-4111-8111-111111111111'
const RS = '22222222-2222-4222-8222-222222222222'

// ── ① 头号陷阱：worksheet_id 必须与 resource_id 一起清 ──

test('workbook → homework：worksheet_id 与 resource_id 都要置 NULL', () => {
  const r = planTaskRouteChange({ task_type: 'workbook', worksheet_id: WS, resource_id: null }, 'homework')
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { task_type: 'homework', worksheet_id: null, resource_id: null })
})

test('workbook 且 resource_id 也非空：两个都要清（防 resourceId 兜底再错一次）', () => {
  const r = planTaskRouteChange({ task_type: 'workbook', worksheet_id: WS, resource_id: RS }, 'homework')
  assert.equal(r.ok, true)
  assert.equal(r.patch.resource_id, null)
  assert.equal(r.patch.worksheet_id, null)
})

test('answers_bank（exam + resource_id）→ homework：resource_id 必须清', () => {
  const r = planTaskRouteChange({ task_type: 'exam', worksheet_id: null, resource_id: RS }, 'homework')
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { task_type: 'homework', worksheet_id: null, resource_id: null })
})

// ── ② 转 exam（答案库）路线 ──

test('转 exam 必须带合法 resourceId，缺了就拒绝', () => {
  const r = planTaskRouteChange({ task_type: 'homework' }, 'exam')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'exam_needs_resource')
})

test('转 exam 带非法 resourceId 也拒绝（不是 uuid）', () => {
  const r = planTaskRouteChange({ task_type: 'homework' }, 'exam', { resourceId: 'not-a-uuid' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'exam_needs_resource')
})

test('转 exam 合法：task_type=exam、worksheet_id 置 NULL、resource_id 指向答案库', () => {
  const r = planTaskRouteChange({ task_type: 'workbook', worksheet_id: WS, resource_id: null }, 'exam', { resourceId: RS })
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { task_type: 'exam', worksheet_id: null, resource_id: RS })
})

// ── ③ 重练卷一律禁止 ──

test('wrong_retry 卷禁止转路线（题目行共用原作业，转=毁数据）', () => {
  const r = planTaskRouteChange({ task_type: 'wrong_retry', worksheet_id: null, resource_id: null }, 'homework')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'blocked_retry_paper')
})

test('task_type 是 homework 但挂着 generated_exam_id：按重练卷处理，禁止', () => {
  const r = planTaskRouteChange({ task_type: 'homework', generated_exam_id: RS }, 'homework')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'blocked_retry_paper')
})

test('retry_paper 同样禁止', () => {
  const r = planTaskRouteChange({ task_type: 'retry_paper' }, 'exam', { resourceId: RS })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'blocked_retry_paper')
})

// ── ④ noop / 非法目标 / 空任务 ──

test('已经是 homework 且两个资源字段都空 → noop，不应触发重跑', () => {
  const r = planTaskRouteChange({ task_type: 'homework', worksheet_id: null, resource_id: null }, 'homework')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'noop')
})

test('workbook 但 worksheet_id 丢了（异常态）→ 允许转，不许卡住', () => {
  const r = planTaskRouteChange({ task_type: 'workbook', worksheet_id: null, resource_id: null }, 'homework')
  assert.equal(r.ok, true)
})

test('目标路线非法 / 任务缺失', () => {
  assert.equal(planTaskRouteChange({ task_type: 'workbook' }, 'wrong_retry').code, 'bad_target')
  assert.equal(planTaskRouteChange({ task_type: 'workbook' }, 'slim').code, 'bad_target')
  assert.equal(planTaskRouteChange(null, 'homework').code, 'no_task')
})

test('三种路线互转：workbook 转 workbook 必须显式给 worksheetId（不能拍脑袋）', () => {
  assert.deepEqual(ROUTE_TARGETS, ['homework', 'exam', 'workbook'])
  assert.equal(planTaskRouteChange({ task_type: 'homework' }, 'workbook').code, 'workbook_needs_worksheet')
  assert.equal(planTaskRouteChange({ task_type: 'homework' }, 'workbook', { worksheetId: 'x' }).code, 'workbook_needs_worksheet')

  const r = planTaskRouteChange({ task_type: 'homework', worksheet_id: null, resource_id: RS }, 'workbook', { worksheetId: WS })
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { task_type: 'workbook', worksheet_id: WS, resource_id: null })
})

test('互转闭环：workbook → homework → workbook 来回都能算（幂等字段口径）', () => {
  const a = planTaskRouteChange({ task_type: 'workbook', worksheet_id: WS, resource_id: null }, 'homework').patch
  assert.deepEqual(a, { task_type: 'homework', worksheet_id: null, resource_id: null })
  const b = planTaskRouteChange({ task_type: a.task_type, worksheet_id: a.worksheet_id, resource_id: a.resource_id }, 'workbook', { worksheetId: WS }).patch
  assert.deepEqual(b, { task_type: 'workbook', worksheet_id: WS, resource_id: null })
})

// ── ⑤ 路线识别（顺序与 worker 路由一致）──

// ── ⑥ 任务名还原（转路线后必须回到目标路线的命名口径）──

test('练习册式自动名「科目 · 册名」必须还原，通用自动名与人工名不动', () => {
  assert.equal(shouldResetTaskName('数学 · 上海作业'), true)
  // 通用自动名本来就是目标口径，不动（避免无意义改写）
  assert.equal(shouldResetTaskName('数学作业 09/18 19:44'), false)
  // 人工名（卷面标题改写后的）永不动
  assert.equal(shouldResetTaskName('19.2(3) 实数与数轴'), false)
})

test('isRouteAutoName 同时认「科目 · 册名」与「科目作业 时间」', () => {
  assert.equal(isRouteAutoName('数学 · 上海作业'), true)
  assert.equal(isRouteAutoName('数学作业 09/18 19:44'), true)
  assert.equal(isRouteAutoName('IMG_0231.jpg'), true)
  assert.equal(isRouteAutoName('19.2(3) 实数与数轴'), false)
})

test('还原名 = 客户端同款「{科目}作业 MM/DD HH:mm」，且按 GMT+8 拼（服务端是 UTC）', () => {
  // 2026-09-18T11:44:00Z = 北京时间 09/18 19:44
  assert.equal(buildAutoTaskName({ subject: '数学', createdAt: '2026-09-18T11:44:00Z' }), '数学作业 09/18 19:44')
  // 跨日：2026-09-18T16:30:00Z = 北京 09/19 00:30
  assert.equal(buildAutoTaskName({ subject: '数学', createdAt: '2026-09-18T16:30:00Z' }), '数学作业 09/19 00:30')
  // 学科缺失 / 时间非法都不许抛错
  assert.match(buildAutoTaskName({ createdAt: 'not-a-date' }), /^数学作业 \d{2}\/\d{2} \d{2}:\d{2}$/)
})

// ── ⑦ 转练习册的"数据代价"提示（日常 → 练习册方向才有，且必须量化）──

test('转 homework / exam 没有代价提示（题干仍来自卷面 OCR，信息量不减）', () => {
  assert.deepEqual(describeRouteRisk({ target: 'homework', questions: 20, placeholderQuestions: 0 }), [])
  assert.deepEqual(describeRouteRisk({ target: 'exam', questions: 20, placeholderQuestions: 20 }), [])
})

test('转 workbook：已识别的完整题干会被答案库题干替换 —— 必须点名题数', () => {
  const r = describeRouteRisk({ target: 'workbook', questions: 20, placeholderQuestions: 3, workbookAnswerCount: 400 })
  assert.equal(r.length, 1)
  assert.match(r[0], /17 道/)
  assert.match(r[0], /第 N 题/)
})

test('转 workbook 且该册答案为 0 条：必须警告整卷拿不到参考答案', () => {
  // 20 道完整题干命中"题干被替换"，0 条答案命中"无参考答案" ⇒ 两条都要给
  const r = describeRouteRisk({ target: 'workbook', questions: 20, placeholderQuestions: 0, workbookAnswerCount: 0 })
  assert.equal(r.length, 2)
  assert.match(r[1], /0 条/)
  assert.match(r[1], /参考答案/)
  // 全是占位题干（典型的"已走错 workbook 路线"）时，只剩答案数这一条
  const only = describeRouteRisk({ target: 'workbook', questions: 20, placeholderQuestions: 20, workbookAnswerCount: 0 })
  assert.equal(only.length, 1)
  assert.match(only[0], /0 条/)
})

test('两种代价同时命中就给两条；没题 / 未传答案数时不虚报', () => {
  const both = describeRouteRisk({ target: 'workbook', questions: 10, placeholderQuestions: 0, workbookAnswerCount: 0 })
  assert.equal(both.length, 2)
  assert.deepEqual(describeRouteRisk({ target: 'workbook', questions: 0, placeholderQuestions: 0, workbookAnswerCount: null }), [])
})

// ── ⓪ 功能开关：高危功能默认关闭（2026-09-21）──

test('转路线功能默认关闭：env 未配 / 配 0 / 配空串都是关', () => {
  assert.equal(isRouteConvertEnabled({}), false)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: '' }), false)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: '0' }), false)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: 'false' }), false)
  // 未显式传 env 时读真实 process.env —— 测试机上没配就必须是关
  assert.equal(['1', 'true', 'yes', 'on'].includes(String(process.env.TASK_ROUTE_CONVERT_ENABLED || '').trim().toLowerCase()), isRouteConvertEnabled())
})

test('开关打开：只认真值 1/true/yes/on（大小写不敏感）', () => {
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: '1' }), true)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: 'TRUE' }), true)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: 'on' }), true)
  assert.equal(isRouteConvertEnabled({ TASK_ROUTE_CONVERT_ENABLED: ' yes ' }), true)
  // 拒绝理由必须说清是"功能关闭"，便于日志 grep
  assert.match(ROUTE_CONVERT_DISABLED_MESSAGE, /关闭/)
})

test('resolveRouteKind：重练 > workbook > 答案库 > general', () => {
  assert.equal(resolveRouteKind({ task_type: 'workbook', worksheet_id: WS, resource_id: RS }), 'workbook')
  assert.equal(resolveRouteKind({ task_type: 'workbook', worksheet_id: null, resource_id: RS }), 'workbook')
  assert.equal(resolveRouteKind({ task_type: 'homework', resource_id: RS }), 'answer_bank')
  assert.equal(resolveRouteKind({ task_type: 'homework' }), 'general')
  assert.equal(resolveRouteKind({ task_type: 'homework', generated_exam_id: RS }), 'slim_retry')
  assert.equal(resolveRouteKind(null), 'unknown')
})
