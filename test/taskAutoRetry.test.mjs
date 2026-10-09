/**
 * 「系统还会自己救的失败，不该显示成失败」的回归锁（2026-10-04 第 90 轮）
 *
 * 背景：自动重试其实**一直在跑**（`server/pendingTaskRecovery.js`，默认 5 分钟一轮，
 * `index.js:4513` 无条件 `start()`）。但失败任务在两次扫描之间（最长 5 分钟；配额类要等到
 * 自然日重置）一直以「识别异常 / 重新上传」示人 ⇒ 老师看到红色就点，既白等，
 * 又和自动重捞撞车（同一份作业被两个 job 各处理一遍，重复烧配额、错题可能重复入库）。
 *
 * 修法不是加一句「系统会自动重试」的提示（那还是把活推给老师），而是：
 *   ① 服务端唯一实现 `describeAutoRetry()` 回答「还会不会再试」，随列表/摘要下发；
 *   ② 前端三个入口只做翻译：自愈中 → 显示成"正在处理"、**没有按钮**；手动点也被去重挡住。
 *
 * ⛔ 本文件里最要紧的一条是 **SQL 漂移锁**：
 *    `describeAutoRetry` 的职责是"照实说系统还会不会再试"，所以它的判据必须跟着
 *    `scanFailedTasks` 的 SQL 走，而不是跟着 `isAIRefusalLikely` / `QUOTA_ERROR_PATTERNS`
 *    的设计意图走 —— 两套名单**不相等**（SQL 拒绝话术少了 无法识别 / 看不清 / 页识别失败 /
 *    AI_EMPTY；配额 SQL 的 `%配额%用尽%` 比 `所有魔搭视觉模型.*配额.*用尽` 宽）。
 *    谁改了一边没改另一边，界面就会替系统许下它不会兑现的承诺。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  describeAutoRetry,
  matchesAutoRetryIlike,
  AUTO_RETRY_ILIKE,
  IN_FLIGHT_JOB_STATES,
  collectInFlightTaskIds,
  MAX_AUTO_RETRIES,
  MAX_AI_REFUSAL_RETRIES,
  MAX_TRANSIENT_RETRIES,
  AUTO_RETRY_WINDOW_MS,
  isQuotaError,
} from '../server/pendingTaskRecovery.js'

import {
  autoRetryState,
  isSelfHealing,
  isFailedForTeacher,
  selfHealingNote,
} from '../src/domain/taskAutoRetry.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const RECOVERY_SRC = read('server/pendingTaskRecovery.js')
const INDEX_SRC = read('server/index.js')
const PAGE_SRC = read('src/pages/ProcessingPage.jsx')
const HOME_SRC = read('src/components/HomeDashboardV2.jsx')
const GRADE_SRC = read('src/workbench/views/GradeCenterWorkbench.vue')
// 2026-10-09：「tasks.status → workflowStatus」的归一（含自愈失败改判「处理中」）
// 已从 GRADE_SRC 抽到共享口径模块（首页 KPI / 侧栏徽标 / 服务端计数都读它）。
const CALIBER_SRC = read('src/workbench/utils/pendingReviewCaliber.js')
const APP_SRC = read('src/App.jsx')

// ── 时间夹具 ──
// ⚠️ NOW 取真实时钟：describeAutoRetry 里的「跨自然日」走 isBeforeTodayUtc()，它内部用
//    `new Date()`（真实时间），注入的 now 只影响 7 天窗口与冷却判据。两边必须一致，
//    否则「昨天失败」会算成"今天"（实测踩过：写死 2026-10-04 而机器是 10-03）。
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const TODAY = iso(NOW)
const YESTERDAY = iso(NOW - 24 * 60 * 60 * 1000)

/** 造一个失败任务；created_at/updated_at 默认都是"刚刚" */
const failed = (over = {}) => ({
  status: 'failed',
  last_error: '处理未完成',
  retry_count: 0,
  created_at: TODAY,
  updated_at: TODAY,
  ...over,
})

// ─────────────────────── ① describeAutoRetry 边界 ───────────────────────

test('非失败任务一律 n/a（不是"不会重试"，是"这个问题不适用"）', () => {
  for (const status of ['pending', 'processing', 'queued', 'done', 'reviewed', undefined, '', null]) {
    const r = describeAutoRetry({ status }, NOW)
    assert.equal(r.willRetry, false, `${status} 不该被判为会重试`)
    assert.equal(r.state, 'n/a', `${status} 应该是 n/a`)
  }
  assert.equal(describeAutoRetry(null, NOW).state, 'n/a')
  assert.equal(describeAutoRetry(undefined, NOW).state, 'n/a')
})

test('常规错误：额度 MAX_AUTO_RETRIES=3，撞上限才放弃', () => {
  assert.equal(MAX_AUTO_RETRIES, 3)
  assert.equal(describeAutoRetry(failed({ retry_count: 0 }), NOW).state, 'retrying')
  assert.equal(describeAutoRetry(failed({ retry_count: 2 }), NOW).state, 'retrying')
  const over = describeAutoRetry(failed({ retry_count: 3 }), NOW)
  assert.equal(over.state, 'gave-up')
  assert.equal(over.willRetry, false)
  assert.match(over.reason, /3/, '放弃理由要说清是撞了哪条上限')
})

test('拒绝话术 / JSON 格式错误：额度放宽到 10（8B 模型配额紧张时会抽风）', () => {
  assert.equal(MAX_AI_REFUSAL_RETRIES, 10)
  const samples = [
    '页识别失败：AI 提示: 图片是空白',
    'AI 返回: 图片为空白',
    'Unable to identify any question in the image',
    'no text detected in the provided image',
    'cannot identify the content',
    '很抱歉，我无法完成这个请求',
    '对不起，我不能识别这张图片',
    '由于您提供的图片质量较差',
    'AI 输出 JSON 格式错误: Unexpected token',
  ]
  for (const last_error of samples) {
    const nine = describeAutoRetry(failed({ last_error, retry_count: 9 }), NOW)
    assert.equal(nine.state, 'retrying', `「${last_error}」第 9 次就该继续重试`)
    const ten = describeAutoRetry(failed({ last_error, retry_count: 10 }), NOW)
    assert.equal(ten.state, 'gave-up', `「${last_error}」第 10 次才该放弃`)
  }
})

test('下载类瞬时错误：额度 5，且 5 分钟冷却只改理由不改结论', () => {
  assert.equal(MAX_TRANSIENT_RETRIES, 5)
  const last_error = '下载图片失败(第 2/2 页): Request failed with status code 400'
  assert.equal(describeAutoRetry(failed({ last_error, retry_count: 4 }), NOW).state, 'retrying')
  assert.equal(describeAutoRetry(failed({ last_error, retry_count: 5 }), NOW).state, 'gave-up')

  // 冷却中：仍然"还会重试"，只是这一轮先跳过
  const cooling = describeAutoRetry(failed({ last_error, updated_at: iso(NOW - 60 * 1000) }), NOW)
  assert.equal(cooling.willRetry, true)
  assert.equal(cooling.state, 'retrying')
  assert.match(cooling.reason, /冷却/, '冷却中必须说出来，否则看着像卡住')

  const warmed = describeAutoRetry(failed({ last_error, updated_at: iso(NOW - 10 * 60 * 1000) }), NOW)
  assert.ok(!/冷却/.test(warmed.reason))
})

test('配额 / 限流：当天一律"等"、跨自然日自动继续，且不受 3 次额度约束', () => {
  const last_error = '所有魔搭视觉模型配额已用尽，请稍后重试'
  // 当天：不动它（防烧配额），但明天会自己继续 ⇒ 老师看到的应该是"等 AI 服务恢复"
  const today = describeAutoRetry(failed({ last_error, retry_count: 0 }), NOW)
  assert.equal(today.willRetry, true)
  assert.equal(today.state, 'quota-wait')

  // ⛔ 关键：retry_count 早就超过常规上限 3，配额分支也不设上限（SQL 里配额分支不看 retry_count）
  const many = describeAutoRetry(failed({ last_error, retry_count: 9 }), NOW)
  assert.equal(many.willRetry, true, '配额类被判成 gave-up 是最危险的方向：界面说放弃了、其实明天会自愈')
  assert.equal(many.state, 'quota-wait')

  // 跨自然日：配额已重置 → 下一轮扫描就会捞走
  const crossed = describeAutoRetry(failed({ last_error, retry_count: 9, updated_at: YESTERDAY }), NOW)
  assert.equal(crossed.state, 'retrying')
  assert.match(crossed.reason, /重置/)
})

test('永久黑名单：重试无意义的才叫 blocked（数据/资源问题）', () => {
  const samples = [
    '下载图片失败: 返回内容不是图片（1234 bytes, not jpeg）',
    '下载图片失败(第 1 页): 图片分辨率过低（400×600），请重新上传更清晰的图片',
    '所有图片URL无效',
    'Invalid model id: qwen3-8b-instruct',
    '文件上传未成功完成',
    '缺少 worksheetId',
  ]
  for (const last_error of samples) {
    const r = describeAutoRetry(failed({ last_error, retry_count: 0 }), NOW)
    assert.equal(r.willRetry, false, `「${last_error}」不该被承诺会重试`)
    assert.equal(r.state, 'blocked', `「${last_error}」应该是 blocked`)
  }
})

test('超出 7 天窗口：扫描的 SQL 不会再捞它 ⇒ 不能对外说"还会重试"', () => {
  assert.equal(AUTO_RETRY_WINDOW_MS, 7 * 24 * 60 * 60 * 1000)
  const old = describeAutoRetry(failed({ created_at: iso(NOW - 8 * 24 * 3600 * 1000) }), NOW)
  assert.equal(old.willRetry, false)
  assert.equal(old.state, 'gave-up')
  assert.match(old.reason, /7 天/)

  const fresh = describeAutoRetry(failed({ created_at: iso(NOW - 6 * 24 * 3600 * 1000) }), NOW)
  assert.equal(fresh.state, 'retrying')
})

test('脏输入不炸：字段缺失 / 类型不对 / 非对象一律给保守答案', () => {
  const dirty = [
    undefined, null, 0, 'x', [], {},
    { status: 'failed' },                                   // 无 last_error / retry_count
    { status: 'failed', retry_count: 'abc' },               // 非数字
    { status: 'failed', created_at: 'not-a-date' },         // 时间不可解析
    { status: 'failed', last_error: 123, retry_count: -5 }, // 奇怪但可救
  ]
  for (const t of dirty) {
    const r = describeAutoRetry(t, NOW)
    assert.equal(typeof r.willRetry, 'boolean')
    assert.ok(['n/a', 'retrying', 'quota-wait', 'gave-up', 'blocked'].includes(r.state))
  }
  // 缺 last_error 的失败任务：没有证据说它不可救 ⇒ 保守判"还会重试"
  assert.equal(describeAutoRetry({ status: 'failed', retry_count: 0 }, NOW).state, 'retrying')
})

// ─────────────────── ② ILIKE 语义 + SQL 漂移锁 ───────────────────

test('matchesAutoRetryIlike：语义等同 SQL 的 last_error ILIKE 任意一项', () => {
  assert.ok(matchesAutoRetryIlike('refusal', 'xx图片是空白xx'))
  assert.ok(matchesAutoRetryIlike('refusal', 'unable to identify'))  // 大小写不敏感
  assert.ok(matchesAutoRetryIlike('refusal', 'AI 输出 JSON 格式错误'))
  assert.ok(!matchesAutoRetryIlike('refusal', '页识别失败'), 'SQL 名单里没有"页识别失败"，不能替系统许愿')
  assert.ok(!matchesAutoRetryIlike('refusal', 'AI_EMPTY'))
  assert.ok(matchesAutoRetryIlike('transient', '下载图片失败'))
  assert.ok(!matchesAutoRetryIlike('transient', 'status code 400'), 'SQL 瞬时分支只列了"下载图片失败"')
  assert.ok(matchesAutoRetryIlike('quota', 'HTTP 429 Too Many Requests'))
  assert.ok(matchesAutoRetryIlike('quota', 'rate limit exceeded'))
  assert.ok(matchesAutoRetryIlike('quota', '所有视觉模型均不可用'))
  assert.ok(!matchesAutoRetryIlike('nope', 'whatever'))
  assert.ok(!matchesAutoRetryIlike('refusal', null))
  assert.ok(!matchesAutoRetryIlike('refusal', ''))
})

/** 从源码里抠出所有 `last_error ILIKE '<字面量>'` */
const ilikeLiterals = (src) => [...src.matchAll(/last_error\s+ILIKE\s+'([^']*)'/g)].map((m) => m[1])
const sliceBetween = (src, from, to) => {
  const a = src.indexOf(from)
  assert.ok(a >= 0, `源码里找不到锚点：${from}`)
  const b = src.indexOf(to, a + from.length)
  assert.ok(b > a, `源码里找不到结束锚点：${to}`)
  return src.slice(a, b)
}
const sorted = (arr) => [...arr].sort()

test('⛔ SQL 漂移锁：AUTO_RETRY_ILIKE 与 scanFailedTasks 的 SQL 字面量集合必须相等', () => {
  const inFile = new Set(ilikeLiterals(RECOVERY_SRC))
  const inTables = new Set([
    ...AUTO_RETRY_ILIKE.refusal,
    ...AUTO_RETRY_ILIKE.transient,
    ...AUTO_RETRY_ILIKE.quota,
  ])
  assert.deepEqual(
    sorted(inFile),
    sorted(inTables),
    'SQL 里的 ILIKE 名单和 AUTO_RETRY_ILIKE 对不上了 —— 改了一边必须改另一边，'
    + '否则 describeAutoRetry 会按"设计意图"许下系统不兑现的承诺'
  )
})

test('⛔ SQL 漂移锁：三个分支各管各的，不能串（分支归属错了 = 额度算错）', () => {
  // ① 拒绝话术分支：`COALESCE(retry_count, 0) < $1` 与 `< $2` 之间
  const refusalBlock = sliceBetween(RECOVERY_SRC, 'COALESCE(retry_count, 0) < $1', 'COALESCE(retry_count, 0) < $2')
  assert.deepEqual(sorted(new Set(ilikeLiterals(refusalBlock))), sorted(AUTO_RETRY_ILIKE.refusal))

  // ② 瞬时分支
  const transientBlock = sliceBetween(RECOVERY_SRC, '-- ③ 瞬时下载/网络错误', '-- ④ 配额/限流')
  assert.deepEqual(sorted(new Set(ilikeLiterals(transientBlock))), sorted(AUTO_RETRY_ILIKE.transient))

  // ③ 配额分支
  const quotaBlock = sliceBetween(RECOVERY_SRC, '-- ④ 配额/限流', 'ORDER BY updated_at ASC')
  assert.deepEqual(sorted(new Set(ilikeLiterals(quotaBlock))), sorted(AUTO_RETRY_ILIKE.quota))
})

test('QUOTA_ERROR_PATTERNS ⊆ SQL 配额名单（当前成立；破了说明 classify 会比 SQL 更宽）', () => {
  const samples = [
    '所有魔搭视觉模型配额已用尽',
    '所有视觉模型不可用',
    '所有视觉模型调用失败',
    'quota exhausted',
    'rate limit exceeded',
    'rate_limit hit',
    'HTTP 429',
  ]
  for (const s of samples) {
    assert.ok(isQuotaError(s), `样本本身没命中 isQuotaError：${s}`)
    assert.ok(matchesAutoRetryIlike('quota', s), `isQuotaError 认但 SQL 不认 ⇒ describeAutoRetry 会多许愿：${s}`)
  }
})

// ─────────────────── ③ 在途去重口径 ───────────────────

test('IN_FLIGHT_JOB_STATES / collectInFlightTaskIds：手动与自动必须同一套口径', () => {
  assert.deepEqual(IN_FLIGHT_JOB_STATES, ['waiting', 'active', 'delayed'])
  const ids = collectInFlightTaskIds([
    { data: { taskId: 'a' } },
    { data: { taskId: 'a' } },      // 重复 → 集合去重
    { data: { taskId: 'b' } },
    { data: {} },                   // 没有 taskId
    { data: { taskId: '' } },       // 空串不算
    {},
    null,
  ])
  assert.deepEqual([...ids], ['a', 'b'])
  assert.equal(collectInFlightTaskIds(null).size, 0)
  assert.equal(collectInFlightTaskIds(undefined).size, 0)
  assert.equal(collectInFlightTaskIds('not-an-array').size, 0)
})

// ─────────────────── ④ 前端翻译层（唯一口径） ───────────────────

test('isSelfHealing：只有服务端明确说 willRetry===true 才算，缺字段一律 false', () => {
  assert.equal(isSelfHealing({ auto_retry: { willRetry: true, state: 'retrying' } }), true)
  assert.equal(isSelfHealing({ autoRetry: { willRetry: true, state: 'quota-wait' } }), true)
  assert.equal(isSelfHealing({ auto_retry: { willRetry: false, state: 'gave-up' } }), false)
  // ⛔ 老缓存（localStorage tasks_cache_*）升级瞬间缺这个字段：宁可多显示一次失败，
  //    也不能把真失败藏起来
  assert.equal(isSelfHealing({ status: 'failed' }), false)
  assert.equal(isSelfHealing({ auto_retry: {} }), false)
  assert.equal(isSelfHealing({ auto_retry: { willRetry: 'true' } }), false, '字符串不是 true')
  assert.equal(isSelfHealing(null), false)
})

test('isFailedForTeacher / autoRetryState / selfHealingNote', () => {
  assert.equal(isFailedForTeacher({ status: 'failed' }), true)
  assert.equal(isFailedForTeacher({ status: 'failed', auto_retry: { willRetry: true } }), false)
  assert.equal(isFailedForTeacher({ status: 'done' }), false)

  assert.equal(autoRetryState({ auto_retry: { state: 'quota-wait' } }), 'quota-wait')
  assert.equal(autoRetryState({ autoRetry: { state: 'retrying' } }), 'retrying')
  assert.equal(autoRetryState({}), '')
  assert.equal(autoRetryState(null), '')

  // 配额类要说清在等什么，否则"正在处理"看着像卡死；两种说法都**不许出现"重试"字样**
  assert.equal(selfHealingNote({ auto_retry: { state: 'quota-wait' } }), 'AI 服务额度已用满，恢复后自动继续')
  assert.equal(selfHealingNote({ auto_retry: { state: 'retrying' } }), '正在处理')
  assert.ok(!/重试/.test(selfHealingNote({ auto_retry: { state: 'retrying' } })))
  assert.ok(!/重试/.test(selfHealingNote({ auto_retry: { state: 'quota-wait' } })))
})

// ─────────────────── ⑤ 接线锁（源码级） ───────────────────

test('手机任务页：自愈档必须排在 failed 之前，且不算 bad（= 不给按钮）', () => {
  assert.match(PAGE_SRC, /import \{ isSelfHealing, selfHealingNote \} from '\.\.\/domain\/taskAutoRetry'/)
  // 顺序：先判自愈，再判失败 —— 反了的话自愈任务会被当成 failed 渲染
  assert.match(PAGE_SRC, /const stage = t => isSelfHealing\(t\) \? 'self-healing'\s*\n\s*: t\.status === 'failed' \? 'failed'/,
    'stage() 必须先判自愈再判 failed')
  assert.match(PAGE_SRC, /const bad = current === 'failed' \|\| current === 'stalled'/,
    'bad 一旦包含 self-healing，那一行就会冒出「重新上传」按钮')
  assert.ok(!/const bad = [^\n]*healing/.test(PAGE_SRC), 'self-healing 绝不能进 bad')
  assert.match(PAGE_SRC, /const healing = current === 'self-healing'/)
  assert.match(PAGE_SRC, /const busy = current === 'processing' \|\| healing/, '自愈行要转圈')
  assert.match(PAGE_SRC, /healing \? selfHealingNote\(task\)/, '自愈行的说明要走统一文案')
  // 自愈行也要算"在途"，否则那行会一直停在「正在处理」等用户手动刷新
  assert.match(PAGE_SRC, /stage\(t\) === 'self-healing'/, 'hasInFlight 必须把自愈算作在途')
  // 重试按钮只在 bad 分支出现
  assert.match(PAGE_SRC, /\{bad && <div className='mt-1 pl-10'>/, '重试按钮的渲染条件被改了')
})

test('手机首页提醒：自愈任务既不算 failed 也不算 stalled ⇒ 落进「作业批改中」', () => {
  assert.match(HOME_SRC, /import \{ autoRetryState, isFailedForTeacher, isSelfHealing, selfHealingNote \} from '\.\.\/domain\/taskAutoRetry'/)
  assert.match(HOME_SRC, /const failed = \(task\) => isFailedForTeacher\(task\)/)
  assert.match(HOME_SRC, /const stalled = [^\n]*!isSelfHealing\(task\)/,
    '不排除自愈 ⇒ 会弹「上次作业处理超时」，把正在自愈的任务说成卡死')
  assert.match(HOME_SRC, /const processing = \(task\) => !complete\(task\) && !failed\(task\) && !stalled\(task\)/)
  assert.match(HOME_SRC, /autoRetryState\(activeTask\) === 'quota-wait' \? selfHealingNote\(activeTask\)/,
    '等配额时首页要说清在等什么')
})

test('PC 批改中心：自愈的失败要归到「处理中」，不显示成「识别异常」', () => {
  // 2026-10-09：归一函数搬进共享口径模块，批改中心改为 import 它（唯一实现）。
  assert.match(GRADE_SRC, /normalizeHomeworkStatus[\s\S]{0,200}?from '\.\.\/utils\/pendingReviewCaliber'/,
    '批改中心必须 import 共享口径的归一函数，不得再自建一套')
  assert.match(CALIBER_SRC, /import \{ isSelfHealing, autoRetryState \} from '\.\.\/\.\.\/domain\/taskAutoRetry\.js'/,
    '自愈判据仍来自 domain/taskAutoRetry（服务端 describeAutoRetry 的翻译层）')
  assert.match(CALIBER_SRC, /export function normalizeHomeworkStatus\(task\)/,
    '判据要拿到整个 task（auto_retry 挂在任务上）')
  assert.match(CALIBER_SRC, /if \(status === 'failed' && isSelfHealing\(task\)\)/)
  assert.match(GRADE_SRC, /const state = normalizeHomeworkStatus\(task\)/,
    '调用点必须传 task，传 task.status 的话自愈判断拿不到 auto_retry')
  assert.match(CALIBER_SRC, /statusLabel: '等待 AI 服务恢复'/)
})

test('重试响应文案：服务端说「已在处理」时，前端不能还回一句「已重新提交」', () => {
  assert.match(APP_SRC, /const res = await apiRequest\('\/tasks\/retry'/)
  assert.match(APP_SRC, /Toast\.show\(\{ message: res\?\.message \|\|/, '移动端要读服务端的 message')
  assert.match(GRADE_SRC, /ElMessage\.success\(res\?\.message \|\|/, 'PC 端要读服务端的 message')
  // 三处重试端点共用同一句去重文案
  assert.equal((INDEX_SRC.match(/这份作业正在处理中，不用重复提交/g) || []).length, 3)
})

test('服务端下发：列表每行带 auto_retry，摘要按同一判据过滤', () => {
  assert.match(INDEX_SRC, /auto_retry: describeAutoRetry\(row\)/, '任务列表必须下发判定结果')
  assert.match(INDEX_SRC, /const failedTasks = failedDetail\.filter\(\(d\) => !describeAutoRetry\(d\)\.willRetry\)\.length/,
    '摘要里的失败数必须排除"还会自愈"的')
  assert.match(INDEX_SRC, /filter\(\(t\) => t\.status !== 'failed' \|\| !describeAutoRetry\(t\)\.willRetry\)/,
    '最近任务列表要滤掉还会自愈的失败行')
  assert.match(INDEX_SRC, /autoRetry: describeAutoRetry\(t\)/)
})

test('手动重试的防重复入队：必须在写库之前拦下，且不动 status / retry_count / last_error', () => {
  const body = INDEX_SRC.slice(INDEX_SRC.indexOf('async function retryTaskById'), INDEX_SRC.indexOf('async function retryTaskById') + 3000)
  const dedupIdx = body.indexOf('alreadyQueued: true')
  const updateIdx = body.indexOf('retry_count = 0')
  assert.ok(dedupIdx >= 0, '缺少在途去重')
  assert.ok(updateIdx >= 0, '找不到重置 retry_count 的 UPDATE')
  assert.ok(dedupIdx < updateIdx, '去重必须早于写库：晚于写库就等于已经把老师这次重试提交出去了')
  assert.match(body, /queue\.getJobs\(IN_FLIGHT_JOB_STATES\)/, '必须用共享的在途三态')
  assert.match(body, /collectInFlightTaskIds\(inFlightJobs\)\.has\(taskId\)/)
  // 去重分支只读，不写状态
  const dedupBranch = body.slice(body.lastIndexOf('if (', dedupIdx), dedupIdx + 200)
  assert.ok(!/UPDATE|SET /.test(dedupBranch), '去重命中时不该写任何状态（排队的那份会自己跑）')
})
