// 回归测试：「框选识别卡死 7 分钟」事故的四道护栏（2026-10-30，commit 3430ce2）
//
// 事故背景（2026-10-30 10:43 老师报告，PC 批改工作台「框选这道题所在的区域 → 开始识别」
// 无限转圈；curl 实测 420s 无响应）。三层根因叠加：
//   ① vendorChain 链步 429 也打全局并发闸（notifyAiRateLimited 每次 -1，最低 1，
//      429 风暴下永不恢复）⇒ SenseNova 持续限流（直测 0.3s 一发 429）把 _aiLimit 压到 1
//      （backend-live.log 当天 25 次「并发降至」实锤）。
//   ② 并发 1 + withAiLimit 排队无超时无日志 ⇒ 老师的识别请求在闸外静默排队数分钟。
//   ③ qwen3.8-flash 默认思考模式：单题转录长指令下 max_tokens 全烧在 reasoning 上不出
//      content ⇒ 每次跑满 180s 超时。对照实验（真实试卷图 + 后端原版 prompt）：
//      默认 120s+ 跑不完；enable_thinking:false 同图 3.2s 出正确 JSON。
//
// 本测试锁定（全部源码级闸，防「改回去」）：
//   A. vendorChain 链步 429 豁免打全局闸（rateLimitPenalty:false）与主站冷却
//      （_fromVendorChain 标记 + markMainRateLimited 豁免）。
//   B. WORKBOOK/GENERAL 两条 OCR 链的 Bailian:qwen3.8-flash 步必须带
//      enable_thinking:false（step 级 extraBody；供应商级不能带——Bailian 的
//      textModel 是 deepseek-v4-pro，盲目带 qwen 参数可能 400）。
//   C. withAiLimit/_acquireAiSlot 支持排队超时（waitTimeoutMs，默认 null 旧行为），
//      同步识别两服务（questionOCRService/answerOCRService）必须显式传
//      timeout + queueTimeoutMs（教师点按钮同步等结果，不能吃整页 OCR 的 180s 大图口径）。
//   D. vendorChain 步骤级 429 冷却存在（_vendorStep429Cooldown）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

test('A1: vendorChain 链步 429 必须豁免全局并发闸（rateLimitPenalty:false）', () => {
  const src = read('server/config/ai.js')
  // vendorChain 步构建块内：retry429:false 附近必须同时带 rateLimitPenalty:false
  const start = src.indexOf('providers.push(async () => {', src.indexOf('vendorChainMode)'))
  assert.ok(start > 0, '未找到 vendorChain 步构建块')
  const block = src.slice(start, src.indexOf('if (!providers.length)', start))
  assert.ok(block.includes('retry429: false'), 'vendorChain 步应保持 retry429:false（429 立即换链内下一步）')
  assert.ok(
    block.includes('rateLimitPenalty: false'),
    'vendorChain 链步 429 必须豁免打全局并发闸。链内 429 语义是「换通道」不是「全站过载」——' +
    'SenseNova 持续 429 时每次打闸会把 _aiLimit 压到 1，全系统 AI 排队雪崩（2026-10-30 事故根因①）'
  )
})

test('A2: 主循环 429 必须豁免 vendorChain 步的 markMainRateLimited（_fromVendorChain 标记）', () => {
  const src = read('server/config/ai.js')
  assert.ok(
    src.includes('!err._fromVendorChain && err.response?.status === 429'),
    'provider 主循环的 markMainRateLimited 必须排除 vendorChain 链步 429（err._fromVendorChain）——' +
    '链内 429 与魔搭主站配额无关，误触发会把魔搭兜底白冷却 60s（与 Gemini 直连豁免同一族坑）'
  )
  // 链步闭包必须打标
  const start = src.indexOf('providers.push(async () => {', src.indexOf('vendorChainMode)'))
  const block = src.slice(start, src.indexOf('if (!providers.length)', start))
  assert.ok(
    block.includes('err._fromVendorChain = true') && block.includes('err._providerLabel'),
    'vendorChain 步 catch 必须打 _fromVendorChain + _providerLabel 标记（豁免主站冷却 + 精确归因）'
  )
})

test('A3: wrapVisionError 必须支持 extraTried（链外供应商名不被 else 推断误标成魔搭）', () => {
  const src = read('server/config/ai.js')
  const fnIdx = src.indexOf('export function wrapVisionError')
  const body = src.slice(fnIdx, src.indexOf('\n}\n', fnIdx))
  assert.ok(body.includes('extraTried'), 'wrapVisionError 必须收 extraTried——bailian 等链外供应商名' +
    '不在四类 _provider 枚举里，否则被 else 推断误标成「魔搭」，错误文案归因错方向')
})

test('B1: WORKBOOK/GENERAL 两条 OCR 链的 Bailian:qwen3.8-flash 步必须带 enable_thinking:false', () => {
  const src = read('server/config/ai.js')
  const chains = ['WORKBOOK_OCR_VENDOR_CHAIN', 'GENERAL_OCR_VENDOR_CHAIN']
  for (const name of chains) {
    const start = src.indexOf(`export const ${name}`)
    assert.ok(start > 0, `未找到 ${name}`)
    const body = src.slice(start, src.indexOf(']', start))
    const bailianLine = body.split('\n').find(l => l.includes("vendor: 'Bailian'") && l.includes('qwen3.8-flash'))
    assert.ok(bailianLine, `${name} 里必须显式点名 Bailian:qwen3.8-flash（质量决策，勿删步）`)
    assert.ok(
      bailianLine.includes('enable_thinking: false'),
      `${name} 的 Bailian 步必须带 extraBody:{enable_thinking:false}——qwen3.8-flash 默认思考模式，` +
      '长转录指令下 max_tokens 全烧在 reasoning 上，每次跑满 timeout 超时（2026-10-30 对照实验：' +
      '默认 120s+ 无结果，关思考 3.2s 正确）。⚠️ 只能加在 step 级，Bailian 供应商级 extraBody ' +
      '不能带 qwen 参数（其 textModel=deepseek-v4-pro）'
    )
  }
})

test('C1: withAiLimit/_acquireAiSlot 必须支持排队超时（waitTimeoutMs，默认 null 保持旧行为）', () => {
  const src = read('server/config/ai.js')
  const acquireIdx = src.indexOf('function _acquireAiSlot')
  const acquireBody = src.slice(acquireIdx, src.indexOf('\nfunction ', acquireIdx + 10))
  assert.ok(
    acquireBody.includes('waitTimeoutMs') && acquireBody.includes('_aiWaiters.splice'),
    '_acquireAiSlot 必须支持 waitTimeoutMs：排队有界（超时从队列摘除并 reject 可读错误）。' +
    '无界排队 + 并发被压到 1 时，请求会静默排队数分钟（2026-10-30 事故根因②，日志一个字都没有）'
  )
  assert.ok(
    src.includes('waitTimeoutMs = null') && src.includes('_aiWaiters.splice'),
    'waitTimeoutMs 默认必须为 null（无限等）——异步批改链路行为零变化，只有同步交互链路显式传'
  )
  const withIdx = src.indexOf('export async function withAiLimit')
  const withBody = src.slice(withIdx, src.indexOf('\n}', withIdx))
  assert.ok(withBody.includes('_acquireAiSlot(waitTimeoutMs)'), 'withAiLimit 必须把 waitTimeoutMs 透传给 _acquireAiSlot')
})

test('C2: postWith429Retry 必须透传 queueTimeoutMs 给 withAiLimit', () => {
  const src = read('server/config/ai.js')
  const postIdx = src.indexOf('async function postWith429Retry')
  const body = src.slice(postIdx, src.indexOf('\nasync function ', postIdx + 10))
  assert.ok(
    body.includes('queueTimeoutMs') && body.includes('waitTimeoutMs: queueTimeoutMs'),
    'postWith429Retry 必须把 queueTimeoutMs 透传成 withAiLimit 的 waitTimeoutMs——否则同步链路的' +
    '排队上限半路丢失，等于没做'
  )
  // requestOpenAIProvider 必须把两参数透传给 postWith429Retry
  const reqIdx = src.indexOf('async function requestOpenAIProvider')
  const reqBody = src.slice(reqIdx, src.indexOf('\nasync function ', reqIdx + 10))
  assert.ok(
    reqBody.includes('rateLimitPenalty') && reqBody.includes('queueTimeoutMs'),
    'requestOpenAIProvider 必须透传 rateLimitPenalty/queueTimeoutMs'
  )
})

test('C3: 同步识别两服务必须显式传 timeout(75s)+queueTimeoutMs(30s)，不许吃整页大图口径', () => {
  const cases = [
    ['server/services/questionOCRService.js', 'callVisionCompletion({'],
    ['server/services/answerOCRService.js', 'callVisionCompletion({'],
  ]
  for (const [file, marker] of cases) {
    const src = read(file)
    const start = src.indexOf(marker)
    assert.ok(start > 0, `${file} 未找到 ${marker}`)
    const body = src.slice(start, src.indexOf('})', start))
    assert.ok(
      body.includes('timeout: 75_000'),
      `${file} 必须显式 timeout:75_000——教师点按钮同步等结果、吃单题小图，180s 整页大图口径会让前端先超时`
    )
    assert.ok(
      body.includes('queueTimeoutMs: 30_000'),
      `${file} 必须显式 queueTimeoutMs:30_000——并发闸被压到 1 时排队必须有界，宁可快速失败让人重试`
    )
  }
})

test('D1: vendorChain 步骤级 429 冷却必须存在（60s 内跳过持续限流通道）', () => {
  const src = read('server/config/ai.js')
  assert.ok(
    src.includes('VENDOR_STEP_429_COOLDOWN_MS') && src.includes('_vendorStep429Cooldown'),
    'vendorChain 步骤级 429 冷却必须存在——SenseNova 持续 429 时每个请求都白挨一发' +
    '（占闸排队 + 日志噪音），冷却期内直接跳该步直达链尾'
  )
})

test('E1: 前端识别请求超时必须大于后端最坏总时长（240s > 30+75×2）', () => {
  const src = read('src/api/answerOCR.js')
  const count = (src.match(/timeout: 240 \* 1000/g) || []).length
  assert.ok(
    count >= 2,
    'recognizeAnswer/recognizeQuestion 的前端 timeout 必须 240s——后端最坏 = 排队30s+每步75s×2≈150s+开销，' +
    '前端更短会在后端还在跑时先断，老师重试反而加重排队（雪崩放大器）'
  )
})
