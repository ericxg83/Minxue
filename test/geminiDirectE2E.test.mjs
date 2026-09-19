import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { callVisionCompletion } from '../server/config/ai.js'

/**
 * 端到端（本地 mock server，不出网）：验证 ai.js 走 Gemini 直连通道时
 * **真实发出的请求体**与**返回解析**都正确。
 *
 * 为什么必须有这一层：本地直连 Google 被墙（且 ai.js 的 axios 实例显式 proxy:false，
 * 不认 HTTP_PROXY），所以"改完代码在本机跑一次"验证不到任何东西。
 * 借 GEMINI_DIRECT_BASE_URL（与 HUIHUIYUN_BASE_URL 同一约定）把请求打到本地 mock，
 * 就能把「URL / 模型名 / MIME / 思考预算 / 输出预算 / thought 剔除 / 独占语义」全部锁住。
 */

async function withMockServer(handler, fn, extraEnv = {}) {
  const captured = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let parsed = null
      try { parsed = JSON.parse(body) } catch { /* 保留 null，由断言暴露 */ }
      captured.push({ url: req.url, method: req.method, headers: req.headers, body: parsed })
      handler(parsed, res, captured.length)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()

  const saved = {}
  const patch = {
    GEMINI_API_KEY: 'test-key',
    // 通道默认关闭，测试里显式打开
    GEMINI_DIRECT_ENABLED: '1',
    GEMINI_DIRECT_BASE_URL: `http://127.0.0.1:${port}`,
    GEMINI_DIRECT_MODEL: 'gemini-3.8-flash',
    // 思考预算必须显式设置才下发；测试里清掉，保证默认形态可复现
    GEMINI_DIRECT_THINKING_BUDGET: undefined,
    // 测试里把限流放宽，否则模块级令牌桶（4/min）会让第二个用例白等 15s
    GEMINI_DIRECT_RPM: '100000',
    ...extraEnv,
  }
  for (const [k, v] of Object.entries(patch)) { saved[k] = process.env[k]; process.env[k] = v }
  try {
    return await fn(captured)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await new Promise((r) => server.close(r))
  }
}

const okReply = (parts) => JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }] })

test('onlyVendor=GoogleGeminiDirect：URL/模型/MIME/思考预算/输出预算全部正确', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([{ text: '{"points":[]}' }]))
  }, async (captured) => {
    const r = await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS',
      userText: 'USR',
      temperature: 0.1,
      maxTokens: 3072,          // 调用方原样传 3072（几何链路的真实值）
      onlyVendor: 'GoogleGeminiDirect',
    })

    assert.equal(r.content, '{"points":[]}')
    assert.equal(captured.length, 1, '只应发出一次请求（独占通道，不并发探测其它供应商）')

    const req = captured[0]
    assert.equal(req.method, 'POST')
    assert.match(req.url, /^\/v1beta\/models\/gemini-3\.8-flash:generateContent\?key=test-key$/,
      'URL 必须带正确的模型名与 key（写死 gemini-2.5-flash 会被 404 下架）')

    const parts = req.body.contents[0].parts
    assert.equal(parts[0].text, 'SYS\n\nUSR', 'systemPrompt 与 userText 拼进同一 text part（与原实现同构）')
    assert.equal(parts[1].inline_data.mime_type, 'image/png',
      'MIME 必须来自 data URL —— 几何裁片是 PNG，硬编码 image/jpeg 会让上游按 JPEG 解码')
    assert.equal(parts[1].inline_data.data, 'QUJD', 'base64 必须剥掉 data URL 前缀')

    const gc = req.body.generationConfig
    assert.equal(gc.temperature, 0.1)
    assert.equal(gc.thinkingConfig, undefined,
      '默认不下发 thinkingConfig —— lite 系模型收到该字段会 400 INVALID_ARGUMENT')
    assert.equal(gc.maxOutputTokens, 8192, '调用方传 3072 必须被兜到 8192（几何 DSL 产物可达数千字符）')
  })
})

test('显式设了思考预算才下发（各模型支持面不一致，故必须可选）', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([{ text: 'ok' }]))
  }, async (captured) => {
    await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS', userText: 'USR',
      onlyVendor: 'GoogleGeminiDirect',
    })
    assert.equal(captured[0].body.generationConfig.thinkingConfig?.thinkingBudget, 0,
      '显式设 GEMINI_DIRECT_THINKING_BUDGET=0 时应下发 thinkingConfig')
  }, { GEMINI_DIRECT_THINKING_BUDGET: '0' })
})

test('thought 分片必须被剔除，否则思维链混进正文会让下游 JSON.parse 必失败', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([
      { text: '用户现在需要识别几何图……', thought: true },
      { text: '{"points":[{"label":"A"}]}' },
    ]))
  }, async () => {
    const r = await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS', userText: 'USR',
      onlyVendor: 'GoogleGeminiDirect',
    })
    assert.equal(r.content, '{"points":[{"label":"A"}]}')
    assert.doesNotMatch(r.content, /用户现在需要/)
  })
})

test('独占通道失败时归因指向 Gemini，不会被改写成"魔搭视觉模型配额耗尽"', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 500, message: 'internal boom' } }))
  }, async () => {
    await assert.rejects(
      callVisionCompletion({
        imageDataURL: 'data:image/png;base64,QUJD',
        systemPrompt: 'SYS', userText: 'USR',
        onlyVendor: 'GoogleGeminiDirect',
      }),
      (err) => {
        assert.match(err.message, /Gemini 直连/)
        assert.doesNotMatch(err.message, /魔搭/, '归因错方向会让人去查错的地方')
        return true
      }
    )
  })
})

test('preferredVendor=GoogleGeminiDirect：Gemini 被**置顶优先**尝试（几何链路实际用的模式）', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([{ text: '{"points":[{"label":"B"}]}' }]))
  }, async (captured) => {
    const r = await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS', userText: 'USR',
      preferredVendor: 'GoogleGeminiDirect',   // 注意：不是 onlyVendor
    })
    assert.equal(r.content, '{"points":[{"label":"B"}]}')
    assert.equal(r.vendorName, 'GoogleGeminiDirect')
    assert.equal(captured.length, 1, '置顶通道命中后不应再打其它供应商')
  })
})

test('Google 的每分钟 429 按本通道退避表重试并成功（不被当成"当日额度耗尽"直接放弃）', async () => {
  await withMockServer((_body, res, n) => {
    if (n === 1) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          code: 429, status: 'RESOURCE_EXHAUSTED',
          message: 'You exceeded your current quota, please check your plan and billing details. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.8-flash\nPlease retry in 46.623222681s.',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
                quotaDimensions: { location: 'global', model: 'gemini-3.8-flash' },
              }],
            },
          ],
        },
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([{ text: '{"points":[{"label":"C"}]}' }]))
  }, async (captured) => {
    const r = await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS', userText: 'USR',
      onlyVendor: 'GoogleGeminiDirect',
    })
    assert.equal(r.content, '{"points":[{"label":"C"}]}', '应按本通道退避表重试后成功')
    assert.equal(captured.length, 2, '恰好重试一次')
  }, { GEMINI_DIRECT_RETRY_WAIT_MS: '20' })  // 测试里把 65s 缩短，避免真等
})

test('未指定通道时不走 Gemini（几何以外的链路行为不变）', async () => {
  await withMockServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(okReply([{ text: 'should-not-be-used' }]))
  }, async (captured) => {
    // 没有 key 时 ENABLED=false，调用会走魔搭/备份链路；本地出网会失败，
    // 但关键断言是：**一次都没打到我们的 Gemini mock**
    await callVisionCompletion({
      imageDataURL: 'data:image/png;base64,QUJD',
      systemPrompt: 'SYS', userText: 'USR',
    }).catch(() => {})
    assert.equal(captured.length, 0, '未指定通道时不该碰 Gemini 直连')
  })
})
