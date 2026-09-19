import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GEMINI_DIRECT, splitDataUrl, wrapVisionError, isQuotaExhaustedError, quotaViolationIds } from '../server/config/ai.js'
import { createRateLimiter } from '../server/utils/aiRateLimiter.js'

/**
 * 2026-09-19：Google Gemini 直连作为「几何重绘专用低速通道」的接入契约。
 *
 * 背景（全部为实测，非推断）：
 *   · 原 GEMINI_DIRECT 把模型写死成 gemini-2.5-flash → 该模型对新用户已下架，
 *     调用返回 404「no longer available to new users」→ 通道静默全废。
 *   · 原 API_KEY 只读 GEMINI_API_KEY / GOOGLE_API_KEY，而 Render 上配的是 MODEL_GIMINI
 *     → ENABLED=false → 整段兜底被跳过，不报错。
 *   · 免费档 flash 系列 5 RPM、lite 系列 15 RPM；无节流实测 29 次调用 21 次 429（72%）。
 *   · Google 的**每分钟**限流报文含 "quota" 字样，被旧判据当成"当日额度耗尽"
 *     → markModelExhausted 冷却到当日结束 → 一次分钟抖动换来整条通道当天失效。
 *   · 原 requestGeminiVision 把 mime 硬编码 image/jpeg，而几何裁片是 PNG。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AI_SRC = fs.readFileSync(path.resolve(__dirname, '../server/config/ai.js'), 'utf8')
const GEO_SRC = fs.readFileSync(path.resolve(__dirname, '../server/geometryWorker.js'), 'utf8')

/** 在受控 env 下读取 GEMINI_DIRECT（getter 每次读 process.env，故可直接改） */
function withEnv(patch, fn) {
  const saved = {}
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MODEL_GIMINI']

// ── 1. 配置读取 ──────────────────────────────────────────────────────────────

test('模型名不再写死为已下架的 gemini-2.5-flash', () => {
  withEnv({ GEMINI_DIRECT_MODEL: undefined }, () => {
    assert.equal(GEMINI_DIRECT.MODEL, 'gemini-3.8-flash')
    assert.match(GEMINI_DIRECT.ENDPOINT, /models\/gemini-3\.8-flash:generateContent$/)
  })
})

test('模型可由 env 覆盖，ENDPOINT 跟着变（换模型不必再改代码）', () => {
  withEnv({ GEMINI_DIRECT_MODEL: 'gemini-3.6-flash' }, () => {
    assert.equal(GEMINI_DIRECT.MODEL, 'gemini-3.6-flash')
    assert.match(GEMINI_DIRECT.ENDPOINT, /models\/gemini-3\.6-flash:generateContent$/)
  })
})

test('三个变量名都能点亮通道的"密钥"（含 Render 上实际用的 MODEL_GIMINI）', () => {
  for (const name of KEY_VARS) {
    withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, MODEL_GIMINI: undefined, [name]: 'k-123' }, () => {
      assert.equal(GEMINI_DIRECT.API_KEY, 'k-123', `${name} 应被识别`)
    })
  }
})

test('⛔ 通道默认关闭：光配了 key 不算启用，必须显式 GEMINI_DIRECT_ENABLED=1', () => {
  const keys = { GEMINI_API_KEY: 'k-123', GOOGLE_API_KEY: undefined, MODEL_GIMINI: undefined }
  // 只配 key → 仍然关闭（避免静默接管几何链路、悄悄烧掉 20/天的额度）
  withEnv({ ...keys, GEMINI_DIRECT_ENABLED: undefined }, () => assert.equal(GEMINI_DIRECT.ENABLED, false))
  withEnv({ ...keys, GEMINI_DIRECT_ENABLED: '' }, () => assert.equal(GEMINI_DIRECT.ENABLED, false))
  withEnv({ ...keys, GEMINI_DIRECT_ENABLED: '0' }, () => assert.equal(GEMINI_DIRECT.ENABLED, false))
  // 显式打开
  withEnv({ ...keys, GEMINI_DIRECT_ENABLED: '1' }, () => assert.equal(GEMINI_DIRECT.ENABLED, true))
  withEnv({ ...keys, GEMINI_DIRECT_ENABLED: 'true' }, () => assert.equal(GEMINI_DIRECT.ENABLED, true))
  // 没有 key 时，开开关也没用
  withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, MODEL_GIMINI: undefined, GEMINI_DIRECT_ENABLED: '1' }, () => {
    assert.equal(GEMINI_DIRECT.ENABLED, false)
  })
})

test('通道限速默认 4 次/分（5 RPM 上限留 20% 余量），且可 env 覆盖', () => {
  withEnv({ GEMINI_DIRECT_RPM: undefined }, () => assert.equal(GEMINI_DIRECT.RPM, 4))
  withEnv({ GEMINI_DIRECT_RPM: '3' }, () => assert.equal(GEMINI_DIRECT.RPM, 3))
})

test('429 退避默认跨整分钟窗（65s）—— 默认的 [3s,5s] 对按分钟限流必然撞墙', () => {
  withEnv({ GEMINI_DIRECT_RETRY_WAIT_MS: undefined }, () => {
    assert.deepEqual(GEMINI_DIRECT.RETRY_429_DELAYS, [65000])
  })
  withEnv({ GEMINI_DIRECT_RETRY_WAIT_MS: '70000' }, () => {
    assert.deepEqual(GEMINI_DIRECT.RETRY_429_DELAYS, [70000])
  })
  // 设 0 → 退回通用短退避表（保留逃生口）
  withEnv({ GEMINI_DIRECT_RETRY_WAIT_MS: '0' }, () => {
    assert.deepEqual(GEMINI_DIRECT.RETRY_429_DELAYS, [3000, 5000])
  })
})

test('思考预算默认**不下发**（null）—— lite 系模型收到该字段会 400，无条件下发会把通道打挂', () => {
  withEnv({ GEMINI_DIRECT_THINKING_BUDGET: undefined }, () => assert.equal(GEMINI_DIRECT.THINKING_BUDGET, null))
  withEnv({ GEMINI_DIRECT_THINKING_BUDGET: '' }, () => assert.equal(GEMINI_DIRECT.THINKING_BUDGET, null))
  withEnv({ GEMINI_DIRECT_THINKING_BUDGET: 'abc' }, () => assert.equal(GEMINI_DIRECT.THINKING_BUDGET, null))
  // 显式开启才生效
  withEnv({ GEMINI_DIRECT_THINKING_BUDGET: '0' }, () => assert.equal(GEMINI_DIRECT.THINKING_BUDGET, 0))
  withEnv({ GEMINI_DIRECT_THINKING_BUDGET: '-1' }, () => assert.equal(GEMINI_DIRECT.THINKING_BUDGET, -1))
})

// ── 2. MIME 解析（几何裁片是 PNG，不能硬编码 jpeg）────────────────────────────

test('data URL 解析出真实 MIME 与 base64', () => {
  assert.deepEqual(splitDataUrl('data:image/png;base64,AAAA'), { mime: 'image/png', data: 'AAAA' })
  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,BBBB'), { mime: 'image/jpeg', data: 'BBBB' })
  assert.deepEqual(splitDataUrl('data:image/webp;base64,CCCC'), { mime: 'image/webp', data: 'CCCC' })
})

test('无 data 前缀时按裸 base64 处理，兜底 PNG', () => {
  assert.deepEqual(splitDataUrl('DDDD'), { mime: 'image/png', data: 'DDDD' })
  assert.deepEqual(splitDataUrl(''), { mime: 'image/png', data: '' })
  assert.deepEqual(splitDataUrl(null), { mime: 'image/png', data: '' })
})

// ── 3. 429 误分类（本次最关键的修复）──────────────────────────────────────────

// 2026-09-19 实测抓到的两组真实 429 报文（原样保留 details，判据必须靠 quotaId 区分）
const GOOGLE_RPM_429 = {
  response: {
    status: 429,
    data: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota, please check your plan and billing details. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite\nPlease retry in 46.623222681s.',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
              quotaDimensions: { location: 'global', model: 'gemini-3.5-flash-lite' },
            }],
          },
        ],
      },
    },
  },
}

const GOOGLE_RPD_429 = {
  response: {
    status: 429,
    data: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        // ⚠️ 按天的配额耗尽**也会**给秒级重试提示 —— 这就是不能用它当判据的原因
        message: 'You exceeded your current quota, please check your plan and billing details. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash\nPlease retry in 12.359255316s.',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaDimensions: { location: 'global', model: 'gemini-3.8-flash' },
            }],
          },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo' },
        ],
      },
    },
  },
}

test('按分钟的窗口限流（quotaId=PerMinute）判为瞬时限流 —— 退避重试即可恢复', () => {
  assert.equal(isQuotaExhaustedError(GOOGLE_RPM_429), false,
    '判成额度耗尽会把整条通道冷却到当日结束')
})

test('按天的配额耗尽（quotaId=PerDay）判为真·耗尽 —— 退避重试一整天也不可能成功', () => {
  assert.equal(isQuotaExhaustedError(GOOGLE_RPD_429), true)
})

test('按天耗尽同样带"Please retry in 12s"，绝不能被秒级提示骗成瞬时限流（回归）', () => {
  const msg = GOOGLE_RPD_429.response.data.error.message
  assert.match(msg, /retry in 12\.\d+s/, '该报文确实带秒级重试提示')
  assert.equal(isQuotaExhaustedError(GOOGLE_RPD_429), true, '但仍必须判为额度耗尽')
})

test('quotaId 判据可用且只认 PerDay', () => {
  assert.deepEqual(quotaViolationIds(GOOGLE_RPM_429), ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier'])
  assert.deepEqual(quotaViolationIds(GOOGLE_RPD_429), ['GenerateRequestsPerDayPerProjectPerModel-FreeTier'])
  assert.deepEqual(quotaViolationIds({}), [])
})

test('真·额度耗尽仍判为耗尽（无 details 时退回文案判据，边界不放宽）', () => {
  const mk = (message) => ({ response: { status: 429, data: { error: { message } } } })
  assert.equal(isQuotaExhaustedError(mk('quota exceeded')), true)
  assert.equal(isQuotaExhaustedError(mk('insufficient balance')), true)
  assert.equal(isQuotaExhaustedError(mk('reject_no_credit')), true)
})

// ── 4. 错误归因不能指向魔搭 ──────────────────────────────────────────────────

test('独占 Gemini 通道失败时，错误不被改写成"魔搭配额耗尽"', () => {
  const raw = new Error('Gemini 直连(gemini-3.8-flash)失败：Request failed with status code 429')
  const out = wrapVisionError(raw, { geminiAttempted: true })
  assert.equal(out, raw, '应原样上抛，保留真实归因')
})

test('既有归因逻辑不受影响（魔搭 + Agnes 仍合并提示）', () => {
  const raw = new Error('boom')
  const out = wrapVisionError(raw, { msAttempted: true, agnesAttempted: true })
  assert.match(out.message, /所有视觉模型（魔搭 \+ Agnes）均不可用/)
})

// ── 5. 通道侧令牌桶 ──────────────────────────────────────────────────────────

test('令牌桶把速率压在 perMinute 之下（4/min → 每 15s 放一个）', async () => {
  let t = 0
  const waits = []
  const limiter = createRateLimiter({
    perMinute: 4,
    burst: 1,
    now: () => t,
    sleep: async (ms) => { waits.push(ms); t += ms },
  })
  assert.equal(limiter.intervalMs, 15000)
  for (let i = 0; i < 5; i++) await limiter.acquire()
  assert.deepEqual(waits, [15000, 15000, 15000, 15000], '首次不等待，其余各等一个间隔')
  assert.equal(t, 60000, '5 次调用共耗 60s → 恰好 5 次/分')
})

test('长时间空闲不会攒出超额突发（burst 上限生效）', async () => {
  let t = 0
  const limiter = createRateLimiter({ perMinute: 4, burst: 2, now: () => t, sleep: async () => {} })
  t = 10 * 60 * 1000 // 空闲 10 分钟
  await limiter.acquire()
  await limiter.acquire()
  assert.equal(limiter._tokens(), 0, '最多只攒到 burst 个令牌')
})

test('perMinute 非法时立即报错（不静默变成无限流）', () => {
  assert.throws(() => createRateLimiter({ perMinute: 0 }), /perMinute/)
  assert.throws(() => createRateLimiter({ perMinute: -1 }), /perMinute/)
  assert.throws(() => createRateLimiter({ perMinute: NaN }), /perMinute/)
})

// ── 6. 源码契约 ──────────────────────────────────────────────────────────────

test('ai.js 不再残留已下架的写死模型名', () => {
  assert.doesNotMatch(AI_SRC, /'gemini-2\.5-flash'/,
    'gemini-2.5-flash 对新用户已下架（404），不能写死')
})

test('requestGeminiVision 用解析出的 MIME，且 thinkingConfig 是条件下发', () => {
  const i = AI_SRC.indexOf('async function requestGeminiVision')
  const body = AI_SRC.slice(i, i + 2200)
  assert.match(body, /splitDataUrl\(imageDataURL\)/, 'MIME 必须从 data URL 解析')
  assert.doesNotMatch(body, /mime_type:\s*'image\/jpeg'/, '不能硬编码 image/jpeg（裁片是 PNG）')
  assert.match(body, /THINKING_BUDGET === null[\s\S]{0,80}\?\s*\{\}/,
    'thinkingConfig 必须条件下发：lite 系模型收到该字段会 400 INVALID_ARGUMENT')
  assert.match(body, /thought\s*!==\s*true/, '必须剔除 thought 分片，否则下游 JSON.parse 必失败')
})

test('Gemini 直连的两个请求函数都过通道限流器，且用自己的 429 退避表', () => {
  const iText = AI_SRC.indexOf('async function requestGeminiText')
  const iVision = AI_SRC.indexOf('async function requestGeminiVision')
  assert.ok(iText > 0 && iVision > 0)
  for (const [name, i] of [['text', iText], ['vision', iVision]]) {
    const body = AI_SRC.slice(i, i + 2600)
    assert.match(body, /geminiLimiter\(\)\.acquire\(\)/, `${name} 必须过通道限流器`)
    assert.match(body, /retry429Delays:\s*GEMINI_DIRECT\.RETRY_429_DELAYS/,
      `${name} 必须用跨窗退避表，否则 429 会静默降级到收费通道`)
  }
})

test('Gemini 通道的 429 不得冷却魔搭主站（归因必须正确）', () => {
  // 取**最后一处**调用：ai.js 里 markMainRateLimited 有两处，
  // 第一处在 callMsProvider 内（魔搭自己的 429，冷却自己是对的），
  // 我们要查的是 callVisionCompletion 外层 catch 里那处（所有 provider 共用）。
  const i = AI_SRC.lastIndexOf('markMainRateLimited()')
  assert.ok(i > 0)
  const blk = AI_SRC.slice(Math.max(0, i - 900), i)
  assert.match(blk, /fromGeminiDirect/,
    '外层 catch 的 markMainRateLimited 前必须排除 Gemini 直连 —— 它用的是独立的 Google 项目配额，与魔搭无关')
  assert.match(blk, /!fromGeminiDirect\s*&&/)
})

test('callVisionCompletion 支持指定通道，且 onlyVendor 会清空降级链', () => {
  assert.match(AI_SRC, /preferredVendor = null/)
  assert.match(AI_SRC, /onlyVendor = null/)
  const i = AI_SRC.indexOf('const wantsGemini')
  assert.ok(i > 0, 'wantsGemini 判定必须存在')
  const blk = AI_SRC.slice(i, i + 1600)
  assert.match(blk, /providers\.length = 0/, 'onlyVendor 必须清空 providers，避免静默降级到弱模型')
  assert.match(blk, /providers\.unshift\(geminiProvider\)/, 'preferredVendor 只置顶')
  assert.match(blk, /GEMINI_DIRECT\.ENABLED/, '必须检查 ENABLED，否则配了没 key 会静默失效')
})

test('几何链路的每个视觉调用点都带上专用通道指定', () => {
  const sites = [...GEO_SRC.matchAll(/callVisionCompletion\(\{/g)].length
  const pins = [...GEO_SRC.matchAll(/preferredVendor:\s*GEOMETRY_VISION_VENDOR/g)].length
  // ⚠️ 不断言固定条数：调用点数随几何通道演进会变（HEAD 一处；函数图象/DSL 落地后三处）。
  //    契约是「每个调用点都带指定」，不是「恰好 N 个」。
  assert.ok(sites >= 1, `几何链路应有视觉调用点，实际 ${sites}`)
  assert.equal(pins, sites, `每个调用点都要带 preferredVendor（${pins}/${sites}）`)
})

test('几何链路的专用通道**默认关闭**，需显式指定才置顶', () => {
  assert.match(GEO_SRC, /process\.env\.GEOMETRY_VISION_VENDOR/)
  assert.match(GEO_SRC, /if \(raw === undefined\) return null\s*\/\/\s*未设置 → 不指定/,
    '未设置时必须不指定（默认走原降级链，几何由辉辉云承担）')
})
