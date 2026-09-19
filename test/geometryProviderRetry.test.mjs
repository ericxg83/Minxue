import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRateLimitError, isOverloadError, withProviderRetry } from '../server/utils/aiProviderRetry.js'

/**
 * 2026-09-19：几何重绘链路的「限流误判成永久放弃」安全网。
 *
 * 事故机理（代码级）：
 *   geometryWorker.js 里任何异常 → handleRetry() → retry_count+1
 *   → 第 3 次后写 tikz_status='none' = **永久放弃重绘**，前端静默回退裁剪原图。
 *   而限流（429/配额窗口）与过载（503）是常态噪声，不该消耗这道 3 次预算。
 *
 * 实测依据（Google Gemini 免费档，2026-09-19）：
 *   flash 系列 5 RPM / lite 系列 15 RPM；DSL 闭环需 ~6 次/分 > 5 RPM；
 *   429 短退避（2.5/5/7.5s）全部撞墙，必须等满 ~65s（跨整分钟窗）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEO_SRC = fs.readFileSync(path.resolve(__dirname, '../server/geometryWorker.js'), 'utf8')

// 生产实测报文（原样，不要改写 —— 判据的价值就在于能不能顶住真实报文形态）
const GOOGLE_RPM_429 = {
  response: {
    status: 429,
    data: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash\nPlease retry in 46.623222681s.',
      },
    },
  },
}

const GOOGLE_503 = {
  response: {
    status: 503,
    data: { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } },
  },
}

// ── 1. 分类判据 ──────────────────────────────────────────────────────────────

test('Google 免费档每分钟限流（limit: 5）判为限流 —— 这是本次要吸收的头号噪声', () => {
  assert.equal(isRateLimitError(GOOGLE_RPM_429), true)
  assert.equal(isOverloadError(GOOGLE_RPM_429), false, '限流不该被当成过载（等待时长差 13 倍）')
})

test('上游高负载 503 判为过载（短等待即可重试）', () => {
  assert.equal(isOverloadError(GOOGLE_503), true)
  assert.equal(isRateLimitError(GOOGLE_503), false, '过载不该被当成限流（否则每轮白等 65s）')
})

test('裸 status=429 / 503 也能识别（错误对象形态不统一）', () => {
  assert.equal(isRateLimitError({ response: { status: 429 } }), true)
  assert.equal(isOverloadError({ response: { status: 503 } }), true)
  assert.equal(isRateLimitError({ status: 429 }), true)
})

test('供应商级"通道暂时打不通"与余额耗尽同样算限流（等价于等窗口后重试）', () => {
  for (const msg of [
    '所有视觉模型不可用',
    '所有魔搭视觉模型配额已用尽',
    'insufficient balance',
    'Too many requests, please retry later',
    'rate limit exceeded',
  ]) {
    assert.equal(isRateLimitError({ message: msg }), true, `应判为限流：${msg}`)
  }
})

test('确定性错误绝不判为瞬态（否则会无限重试、白等 65s×3）', () => {
  for (const msg of [
    '视觉闭环未收到对照图（imageDataURL 为空）',
    'JSON 格式错误: Unexpected token < in JSON',
    'no_dsl_in_reply',
    '图中无可重绘的几何结构（数轴/实物/统计图）',
  ]) {
    const err = { message: msg }
    assert.equal(isRateLimitError(err), false, `不该判为限流：${msg}`)
    assert.equal(isOverloadError(err), false, `不该判为过载：${msg}`)
  }
  assert.equal(isRateLimitError(null), false)
  assert.equal(isOverloadError(undefined), false)
})

// ── 2. 有界重试行为 ──────────────────────────────────────────────────────────

/** 注入 sleep 收集等待时长，避免测试真的睡 65 秒 */
function recorder() {
  const waits = []
  return { waits, sleep: async (ms) => { waits.push(ms) } }
}

test('首次即成功：不产生任何等待', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  const r = await withProviderRetry(async () => { calls += 1; return 'ok' }, { sleep })
  assert.equal(r, 'ok')
  assert.equal(calls, 1)
  assert.deepEqual(waits, [])
})

test('限流后重试并成功：按整分钟窗等待，而不是短退避', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  const r = await withProviderRetry(async () => {
    calls += 1
    if (calls < 3) throw GOOGLE_RPM_429
    return 'ok'
  }, { sleep })
  assert.equal(r, 'ok')
  assert.equal(calls, 3)
  // 默认 65s —— 短退避（2.5/5/7.5s）实测全部撞墙
  assert.deepEqual(waits, [65000, 65000])
})

test('过载用短等待，与限流的等待窗互不串用', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  await withProviderRetry(async () => {
    calls += 1
    if (calls === 1) throw GOOGLE_503
    if (calls === 2) throw GOOGLE_RPM_429
    return 'ok'
  }, { sleep })
  assert.deepEqual(waits, [5000, 65000], '503 → 5s，429 → 65s')
})

test('重试次数有界：用尽后原样上抛，不无限循环', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  await assert.rejects(
    withProviderRetry(async () => { calls += 1; throw GOOGLE_RPM_429 }, { sleep, rateLimitRetries: 2 }),
    (err) => err === GOOGLE_RPM_429
  )
  assert.equal(calls, 3, '1 次首发 + 2 次重试')
  assert.equal(waits.length, 2)
})

test('限流预算与过载预算各自独立，不互相挤占', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  await assert.rejects(withProviderRetry(async () => {
    calls += 1
    // 交替抛两种错误：若预算共用，会提前耗尽
    throw calls % 2 === 1 ? GOOGLE_RPM_429 : GOOGLE_503
  }, { sleep, rateLimitRetries: 2, overloadRetries: 2 }))
  assert.equal(calls, 5, '1 首发 + 2 限流 + 2 过载')
  assert.deepEqual(waits, [65000, 5000, 65000, 5000])
})

test('非瞬态错误立即上抛，一次都不重试', async () => {
  const { waits, sleep } = recorder()
  let calls = 0
  const boom = new Error('JSON 格式错误: Unexpected token < in JSON')
  await assert.rejects(
    withProviderRetry(async () => { calls += 1; throw boom }, { sleep }),
    (err) => err === boom
  )
  assert.equal(calls, 1)
  assert.deepEqual(waits, [])
})

// ── 3. 源码契约：防止以后有人把安全网拆掉 ────────────────────────────────────

test('几何链路的两个视觉调用点都被安全网包住', () => {
  assert.match(GEO_SRC, /import\s*\{\s*withProviderRetry\s*\}\s*from\s*'\.\/utils\/aiProviderRetry\.js'/,
    'geometryWorker.js 必须 import withProviderRetry')

  // 每个 callVisionCompletion( 调用都必须出现在 withProviderRetry( 之后
  const callSites = [...GEO_SRC.matchAll(/callVisionCompletion\(\{/g)].map(m => m.index)
  const wraps = [...GEO_SRC.matchAll(/withProviderRetry\(/g)].map(m => m.index)
  // ⚠️ 不要断言固定条数：调用点数随几何通道的演进会变
  //   （HEAD 只有 reconstructGeometrySvg 一处；函数图象/DSL 通道落地后会有三处）。
  //   契约是「**每一个**调用点都被包住」，而不是「恰好 N 个」。
  assert.ok(callSites.length >= 1, `几何链路应有视觉调用点，实际 ${callSites.length}`)
  assert.equal(wraps.length, callSites.length,
    `withProviderRetry 包裹数(${wraps.length}) 必须与 callVisionCompletion 调用数(${callSites.length}) 一致`)

  for (const idx of callSites) {
    const near = wraps.some(w => w < idx && idx - w < 400)
    assert.ok(near, `位置 ${idx} 的 callVisionCompletion 未被 withProviderRetry 包裹`)
  }
})

test('安全网没有把 handleRetry 的永久放弃语义改掉（保持最小改动）', () => {
  // 本次只加"吸收瞬态"这一层；'none' 仍是超过 MAX_RETRIES 后的最终语义
  assert.match(GEO_SRC, /tikz_status:\s*'none'/, "handleRetry 的 'none' 收尾必须保留")
  assert.match(GEO_SRC, /const MAX_RETRIES = RETRY_DELAYS\.length/, 'MAX_RETRIES 推导未被改动')
})
