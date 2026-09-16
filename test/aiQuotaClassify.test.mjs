import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isQuotaExhaustedError, isTransientRateLimit } from '../server/config/ai.js'

const ROOT = resolve(import.meta.dirname, '..')
const AI_SRC = readFileSync(resolve(ROOT, 'server/config/ai.js'), 'utf8')

/**
 * 429 分类：瞬时限流 vs 真·额度耗尽（2026-09-16 事故沉淀）
 *
 * 事故：SenseNova 返回 `tpm exhausted`（按分钟的 token 限流，官方口径高峰期的 429 属正常），
 * 被旧的"额度耗尽"正则里的裸词 `exhausted` 抓中 → 整把 Key 冷却 5 小时 →
 * 答案引擎全线降级 glm-5.2 / flash-lite（同样撞限流）→ 最后回落通用文本链路，
 * 21 道题跑 29 分钟且答案质量崩坏（选择题给出错误选项）。
 * 而当时账户的通用积分池与 Flash-Lite 专属积分池的 5h 窗口都是「100% 可用」——额度并没耗尽。
 *
 * 判据边界：
 *   · 明确提到 TPM/RPM/QPS 速率 + exhausted/exceeded/limit → 瞬时限流，退避重试；
 *   · 只要同一句里出现 quota/credit/balance/insufficient 等额度字样 → 仍按额度耗尽处理；
 *   · 5h 窗口的 `frequency limit` 仍按额度耗尽处理（不变）。
 */

const err429 = (message) => ({ response: { status: 429, data: { error: { message } } } })

test('tpm exhausted 是瞬时限流，绝不能当额度耗尽（本次事故原型）', () => {
  assert.equal(isQuotaExhaustedError(err429('tpm exhausted')), false)
  assert.equal(isQuotaExhaustedError(err429('rpm exhausted')), false)
  assert.equal(isQuotaExhaustedError(err429('tpm limit exceeded')), false)
  assert.equal(isQuotaExhaustedError(err429('qps exceeded')), false)
  assert.equal(isTransientRateLimit(err429('tpm exhausted')), true)
})

test('真·额度耗尽仍然要判成额度耗尽', () => {
  assert.equal(isQuotaExhaustedError(err429('quota exceeded')), true)
  assert.equal(isQuotaExhaustedError(err429('insufficient balance')), true)
  assert.equal(isQuotaExhaustedError(err429('usage exceeded')), true)
  assert.equal(isQuotaExhaustedError(err429('reject_no_credit')), true)
  assert.equal(isQuotaExhaustedError(err429('frequency limit reached')), true)
})

test('速率字样 + 额度字样同时出现时，以额度为准', () => {
  assert.equal(isQuotaExhaustedError(err429('tpm exhausted: quota exceeded')), true)
  assert.equal(isQuotaExhaustedError(err429('rate limit; balance insufficient')), true)
})

test('裸瞬时限流文案仍归瞬时（回归保护 2026-09-04 事故）', () => {
  assert.equal(isQuotaExhaustedError(err429('Too Many Requests')), false)
  assert.equal(isQuotaExhaustedError(err429('rate limit')), false)
  assert.equal(isQuotaExhaustedError(err429('Please retry after 3s')), false)
})

test('非 429 或空消息不误判', () => {
  assert.equal(isQuotaExhaustedError({ response: { status: 500, data: { error: { message: 'internal error' } } } }), false)
  assert.equal(isQuotaExhaustedError(err429('')), false)
  assert.equal(isQuotaExhaustedError({}), false)
})

test('源码级：瞬时限流判据必须排在额度耗尽返回之前', () => {
  const iTransient = AI_SRC.indexOf('TRANSIENT_RATE_LIMIT_RE.test(msg)')
  const iReturn = AI_SRC.indexOf("return /exceeded[^.]*quota")
  assert.ok(iTransient > 0 && iReturn > 0, '两处都已存在')
  assert.ok(iTransient < iReturn, '瞬时限流判据必须在额度耗尽正则之前生效')
})

test('源码级：答案引擎必须有备用供应商兜底层（排在通用文本链路之前）', () => {
  assert.match(AI_SRC, /FALLBACK_VENDORS/)
  const iFallbackVendor = AI_SRC.indexOf('备用供应商兜底')
  const iLegacyChain = AI_SRC.indexOf("回落通用文本链路，绝不因为模型选择问题卡住批改")
  assert.ok(iFallbackVendor > 0 && iLegacyChain > 0)
  assert.ok(iFallbackVendor < iLegacyChain, '备用供应商兜底必须在通用文本链路之前尝试')
  // 备用供应商必须用自己的 Key（不能用主供应商的 Key 池去打别家网关）
  assert.match(AI_SRC, /const fbKey = process\.env\[fbVendor\.envKey\] \|\| ''/)
})
