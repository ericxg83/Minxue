import axios from 'axios'

export const AI_CONFIG = {
  get ENDPOINT() {
    return process.env.AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions'
  },
  get API_KEY() {
    return process.env.AI_API_KEY || ''
  },
  get MODEL() {
    return process.env.AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct'
  },
  TIMEOUT: 120000,
  MAX_RETRIES: 2,
}

// 429 退避策略：原 [5000, 10000, 20000] 总共 35s 的等待经常白费，因为 8B 配额耗尽时
// 等再久也是 429；外层 callVisionCompletion 会轮询 MS_KEYS × VL_MODELS（多个 Key×模型），
// 单个 provider 内重试 1~2 次即可，剩余时间留给其它组合尝试。
export const RETRY_DELAYS_429 = [3000, 5000] // 429 限流最多重试 2 次，共等 8s
export const RETRY_DELAYS_503 = [5000, 10000, 20000, 30000, 60000, 120000] // 503 最多重试 6 次，总等待 245 秒

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// 自适应并发：ModelScope 免费额度对并发敏感，固定高并发会打出 429 风暴，
// 既大量丢页又因重试等待反而更慢。遇 429 自动降并发，持续成功再缓慢恢复。
const AI_LIMIT_MAX = Math.max(1, parseInt(process.env.AI_CONCURRENCY || '3', 10))
const AI_LIMIT_MIN = 1
const AI_RECOVER_AFTER_SUCCESS = 20
const AI_RECOVER_QUIET_MS = 30000

let _aiLimit = AI_LIMIT_MAX
let _aiActive = 0
const _aiWaiters = []
let _lastThrottleAt = 0
let _successSinceThrottle = 0

function notifyAiRateLimited() {
  _lastThrottleAt = Date.now()
  _successSinceThrottle = 0
  if (_aiLimit > AI_LIMIT_MIN) {
    _aiLimit -= 1
    console.warn(`[AI] 检测到限流，并发降至 ${_aiLimit}`)
  }
}

function notifyAiSuccess() {
  if (_aiLimit >= AI_LIMIT_MAX) return
  _successSinceThrottle += 1
  if (_successSinceThrottle >= AI_RECOVER_AFTER_SUCCESS && Date.now() - _lastThrottleAt > AI_RECOVER_QUIET_MS) {
    _aiLimit += 1
    _successSinceThrottle = 0
    console.log(`[AI] 持续成功，并发恢复至 ${_aiLimit}`)
  }
}

function _acquireAiSlot() {
  if (_aiActive < _aiLimit) {
    _aiActive += 1
    return Promise.resolve()
  }
  return new Promise(resolve => _aiWaiters.push(resolve))
}

function _releaseAiSlot() {
  // 并发上限被动态下调后，多余槽位直接回收而不唤醒等待者。
  // 回收后 _aiActive >= _aiLimit >= 1，仍有在途请求会在其结束时唤醒等待者，不会饿死。
  if (_aiActive > _aiLimit) {
    _aiActive -= 1
    return
  }
  const next = _aiWaiters.shift()
  if (next) {
    next()
    return
  }
  _aiActive = Math.max(0, _aiActive - 1)
}

export async function withAiLimit(fn) {
  await _acquireAiSlot()
  try {
    return await fn()
  } finally {
    _releaseAiSlot()
  }
}

// 429 有两种完全不同的成因，必须区别对待，否则会白等几十分钟还是全页失败：
//   1) 当日配额用尽（"exceeded today's quota for model X"）——重试到明天也没用，
//      唯一出路是换一个模型（ModelScope 的报错自己就写着 "consider using other models"）
//   2) 瞬时并发限流——退避重试有效
function isQuotaExhaustedError(err) {
  const data = err?.response?.data
  const msg = data?.error?.message || data?.message || (typeof data === 'string' ? data : '') || ''
  return /exceeded[^.]*quota|quota[^.]*exceeded/i.test(msg)
}

// 按「Key + 模型 + 自然日」记录配额耗尽，避免整轮解析反复撞同一个已耗尽的组合。
// 魔搭配额按「账号 × 模型 × 自然日」计：多把 Key 若属同一账号则共享配额
// （第二把 Key 也会撞 429 然后被独立标记），若属不同账号则是真正的独立配额。
// 按 Key 细分标记两种情况都正确。
const _modelExhaustedDate = new Map()

function today() {
  return new Date().toISOString().slice(0, 10)
}

const keyTail = (apiKey) => String(apiKey || '').slice(-8)

function markModelExhaustedToday(apiKey, model) {
  if (!model) return
  const scope = `${keyTail(apiKey)}|${model}`
  if (_modelExhaustedDate.get(scope) === today()) return
  _modelExhaustedDate.set(scope, today())
  console.warn(`[AI] 模型 ${model}（Key…${keyTail(apiKey)}）当日配额已用尽，今日不再使用，自动切换`)
}

export function isModelExhaustedToday(model, apiKey = AI_CONFIG.API_KEY) {
  return Boolean(model) && _modelExhaustedDate.get(`${keyTail(apiKey)}|${model}`) === today()
}

async function postWith429Retry(client, endpoint, body, axiosOptions, { retry429 = true, retry503 = true } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await withAiLimit(() => client.post(endpoint, body, axiosOptions))
      notifyAiSuccess()
      return response
    } catch (err) {
      const status = err.response?.status
      // 诊断：详细记录 400 错误（通常提示 prompt 过长 / 图片超限 / 字段格式错误）
      if (status === 400) {
        const body = err.response?.data
        const dataSize = JSON.stringify(body).length
        const imgSize = body?.messages?.[1]?.content?.find?.(c => c.type === 'image_url')?.image_url?.url?.length || 0
        console.error(`[AI] 400 bad request:`,
          `model=${body?.model}`,
          `dataSize=${dataSize}B`,
          `imageBase64Size=${imgSize}B`,
          `errorMsg=${body?.error?.message || JSON.stringify(body)?.substring(0, 300)}`)
      }
      // 配额耗尽：立刻放弃该 Key×模型组合并上抛，让调用方换组合，绝不浪费时间重试
      if (status === 429 && isQuotaExhaustedError(err)) {
        const auth = String(axiosOptions?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
        markModelExhaustedToday(auth, body?.model)
        throw err
      }
      if (status === 429) notifyAiRateLimited()
      if (retry429 && status === 429 && attempt < RETRY_DELAYS_429.length) {
        const delay = RETRY_DELAYS_429[attempt]
        console.warn(`[AI] 429 rate limit, retrying in ${delay / 1000}s (${attempt + 1}/${RETRY_DELAYS_429.length})`)
        await sleep(delay)
        continue
      }
      // 503 Service Unavailable：AI 服务临时过载，等待后重试
      if (retry503 && status === 503 && attempt < RETRY_DELAYS_503.length) {
        const delay = RETRY_DELAYS_503[attempt]
        console.warn(`[AI] 503 service unavailable, retrying in ${delay / 1000}s (${attempt + 1}/${RETRY_DELAYS_503.length})`)
        await sleep(delay)
        continue
      }
      throw err
    }
  }
}

// 主模型瞬时限流冷却：只在短时间窗口内跳过主模型，绝不整天禁用。
// （历史实现按自然日锁定，一次 429 就让当天所有请求全部落到坏掉的备份上，
//   导致「全部 N 页 OCR 识别失败」，务必保持为短窗口。配额耗尽由
//   _modelExhaustedDate 按模型单独处理，不走这里。）
const MAIN_RATE_LIMIT_COOLDOWN_MS = 60 * 1000
let _mainRateLimitedUntil = 0

function markMainRateLimited() {
  _mainRateLimitedUntil = Date.now() + MAIN_RATE_LIMIT_COOLDOWN_MS
  console.warn(`[AI] 主模型限流，冷却 ${MAIN_RATE_LIMIT_COOLDOWN_MS / 1000}s 后自动恢复`)
}

export function isMainRateLimitedToday() {
  return Date.now() < _mainRateLimitedUntil
}

// 2026-07 实测魔搭在线推理模型清单：Qwen3-VL-30B-A3B-Instruct 已下架
// （请求返回 200 但 choices=null，绝不能再放进轮换列表——空响应会拖慢整批），
// 235B-A22B-Instruct 与 8B-Thinking 在线且各有独立当日配额。
// 顺序 = 成本优先：8B 便宜量大 → 235B 质量最好 → 8B-Thinking 兜底（推理模型较慢）。
// ⚠️ 现实里 8B 当日配额极容易耗尽，调用方需要保证 235B / 8B-Thinking 也都被真正试过，
// 因此下面 callVisionCompletion 不能在 8B 失败时直接抛错。
export const VL_MODELS = [...new Set([
  process.env.AI_MODEL,
  process.env.VL_MODEL,
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-VL-235B-A22B-Instruct',
  'Qwen/Qwen3-VL-8B-Thinking',
].filter(Boolean))]

// 2026-08 实测：魔搭当前没有可用的纯文本在线模型：
// - Qwen/Qwen3-8B-Instruct 已下架（Invalid model id）
// - Qwen/Qwen2.5-7B-Instruct / 14B-Instruct 报 "has no provider supported"
// - Qwen/Qwen3-VL-8B-Instruct 在线接口要求请求必须含图片，纯文本会报 invalid image format
// 因此文本回填直接走 Gemini / 备份供应商，不再尝试魔搭主站文本模型。
export const TEXT_MODELS = [
]

let _textIdx = 0
let _vlIdx = 0

export function getCurrentTextModel() {
  return TEXT_MODELS[_textIdx] || TEXT_MODELS[0]
}

export function getCurrentVLModel() {
  return VL_MODELS[_vlIdx] || VL_MODELS[0]
}

export function rotateTextModel() {
  if (_textIdx >= TEXT_MODELS.length - 1) return null
  _textIdx += 1
  return TEXT_MODELS[_textIdx]
}

export function rotateVLModel() {
  if (_vlIdx >= VL_MODELS.length - 1) return null
  _vlIdx += 1
  return VL_MODELS[_vlIdx]
}

export function resetModelIndex() {
  _textIdx = 0
  _vlIdx = 0
}

export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AI_CONFIG.API_KEY}`,
})

const BACKUP_VENDOR_DEFS = [
  {
    // SenseNova（商汤日日新）：OpenAI 兼容格式，公测期免费。
    // sensenova-6.7-flash-lite 支持多模态视觉理解，配额 1500 次/5 小时。
    // 必须传 reasoning_effort:'none' 禁用思考模式，否则思考过程太长（3754+ tokens）
    // 导致 max_tokens 耗尽在 reasoning 阶段，永远拿不到 content。
    // 顺序：视觉效果好且配额独立，放备份供应商第一位（魔搭之后）。
    name: 'SenseNova',
    envKey: 'SENSENOVA_API_KEY',
    endpoint: 'https://token.sensenova.cn/v1/chat/completions',
    textModel: 'sensenova-6.7-flash-lite',
    vlModels: ['sensenova-6.7-flash-lite'],
    referer: null,
    extraBody: { reasoning_effort: 'none' },
  },
  {
    name: 'Agnes',
    envKey: 'AGNES_API_KEY',
    endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
    textModel: 'agnes-1.5-flash',
    // 顺序：Agnes 自家独立模型（agnes-1.5-flash / gpt-4o-mini）放最前，独立配额不与魔搭冲突；
    // 之前在列表里的 'Qwen/Qwen3-VL-8B-Instruct' 实际是通过 Agnes 中转到魔搭，
    // 一旦魔搭 8B 配额耗尽会再次撞 429 必须被排除，避免阻塞整个视觉链；
    // 'Qwen2.5-VL-7B-Instruct' 留在末尾作为补充（Agnes 走的是另一组 provider，与 8B 独立）。
    vlModels: ['agnes-1.5-flash', 'gpt-4o-mini', 'Qwen2.5-VL-7B-Instruct'],
    referer: null,
  },
  {
    // FreeModel：多模型聚合网关，OpenAI 兼容格式。
    // 配额 5 小时重置（非按日），不能作为主 API，仅作最后兜底。
    // model='auto' 让网关自动路由到最合适的模型，无需手动选模型。
    name: 'FreeModel',
    envKey: 'FREEMODEL_API_KEY',
    endpoint: 'https://api.freemodel.dev/v1/chat/completions',
    textModel: 'auto',
    vlModels: ['auto'],
    referer: null,
  },
]

function resolveBackupVendors() {
  return BACKUP_VENDOR_DEFS.filter(vendor => {
    const key = process.env[vendor.envKey] || ''
    if (!key) return false
    return vendor.keyPrefix ? key.startsWith(vendor.keyPrefix) : true
  })
}

let _resolvedVendorsCache = null

function getResolvedVendors() {
  if (!_resolvedVendorsCache) _resolvedVendorsCache = resolveBackupVendors()
  return _resolvedVendorsCache
}

export const BACKUP_CONFIG = {
  get VENDORS() {
    return getResolvedVendors()
  },
  get ENABLED() {
    return getResolvedVendors().length > 0
  },
  get PRIMARY() {
    return getResolvedVendors()[0] || null
  },
  get ENDPOINT() {
    return process.env.BACKUP_ENDPOINT || this.PRIMARY?.endpoint || ''
  },
  get API_KEY() {
    return process.env.BACKUP_API_KEY || ''
  },
  get MODEL() {
    return process.env.BACKUP_MODEL || this.PRIMARY?.textModel || ''
  },
  get VL_MODELS_LIST() {
    if (process.env.BACKUP_VL_MODEL) return [process.env.BACKUP_VL_MODEL]
    return getResolvedVendors().flatMap(vendor => vendor.vlModels)
  },
}

export const MODELSCOPE_BACKUP = {
  get ENDPOINT() {
    return AI_CONFIG.ENDPOINT
  },
  get API_KEY() {
    return process.env.MODELSCOPE_BACKUP_API_KEY || ''
  },
  get MODEL() {
    return process.env.MODELSCOPE_BACKUP_MODEL || AI_CONFIG.MODEL
  },
  get ENABLED() {
    return Boolean(this.API_KEY)
  },
}

const GEMINI_DIRECT = {
  get API_KEY() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  },
  get ENABLED() {
    return Boolean(this.API_KEY)
  },
  MODEL: 'gemini-2.5-flash',
  ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
}

const backupAxios = axios.create({ timeout: 60000 })

export function extractContent(message) {
  if (!message) return ''

  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content.map(item => {
      if (typeof item === 'string') return item
      if (typeof item?.text === 'string') return item.text
      return ''
    }).join('').trim()
    if (text) return text
  }

  const reasoning = message.reasoning || message.reasoning_content
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning

  return ''
}

function buildOpenAIMessages(systemContent, userContent) {
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
}

function buildVisionMessages(systemPrompt, userText, imageDataURL) {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataURL } },
        { type: 'text', text: userText },
      ],
    },
  ]
}

function buildVendorHeaders(vendor, key) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  }
  if (vendor.referer) {
    headers['HTTP-Referer'] = vendor.referer
    headers['X-Title'] = 'Minxue'
  }
  return headers
}

async function requestOpenAIProvider({
  endpoint,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  timeout,
  retry429 = true,
  retry503 = true,
  vendor = null,
  extraBody = null,
}) {
  const headers = vendor ? buildVendorHeaders(vendor, apiKey) : {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  }
  // SenseNova 等模型需要额外参数（如 reasoning_effort: 'none' 禁用思考模式）
  if (extraBody && typeof extraBody === 'object') {
    Object.assign(body, extraBody)
  }

  const response = await postWith429Retry(
    vendor ? backupAxios : axios,
    endpoint,
    body,
    { headers, timeout },
    { retry429, retry503 },
  )

  return extractContent(response.data?.choices?.[0]?.message)
}

async function requestGeminiText({ systemContent, userContent, temperature, maxTokens }) {
  const response = await postWith429Retry(
    backupAxios,
    `${GEMINI_DIRECT.ENDPOINT}?key=${encodeURIComponent(GEMINI_DIRECT.API_KEY)}`,
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemContent}\n\n${userContent}` }],
        },
      ],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: AI_CONFIG.TIMEOUT,
    },
    { retry429: true },
  )

  return response.data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('') || ''
}

async function requestGeminiVision({ systemPrompt, userText, imageDataURL, temperature, maxTokens }) {
  const response = await postWith429Retry(
    backupAxios,
    `${GEMINI_DIRECT.ENDPOINT}?key=${encodeURIComponent(GEMINI_DIRECT.API_KEY)}`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${systemPrompt}\n\n${userText}` },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageDataURL.replace(/^data:image\/\w+;base64,/, ''),
              },
            },
          ],
        },
      ],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: AI_CONFIG.TIMEOUT,
    },
    { retry429: true },
  )

  return response.data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('') || ''
}

export async function callTextCompletion(opts) {
  const { systemContent, userContent, temperature = 0.2, maxTokens = 500, model } = opts
  const messages = buildOpenAIMessages(systemContent, userContent)

  if (!isMainRateLimitedToday() && AI_CONFIG.API_KEY) {
    // 与视觉链一致：按 TEXT_MODELS 依次尝试，跳过当日配额已耗尽的模型
    const textModels = (model ? [model] : TEXT_MODELS).filter(m => !isModelExhaustedToday(m))
    for (const textModel of textModels) {
      try {
        const content = await requestOpenAIProvider({
          endpoint: AI_CONFIG.ENDPOINT,
          apiKey: AI_CONFIG.API_KEY,
          model: textModel,
          messages,
          temperature,
          maxTokens,
          timeout: 30000,
          retry429: false,
        })
        if (content) return { content, usedBackup: false }
      } catch (err) {
        const status = err.response?.status
        if (status === 429 && !isQuotaExhaustedError(err)) markMainRateLimited()
        // 配额耗尽/该模型不可用：继续尝试下一个模型
        if (status) continue
        throw err
      }
    }
  }

  if (MODELSCOPE_BACKUP.ENABLED) {
    try {
      const content = await requestOpenAIProvider({
        endpoint: MODELSCOPE_BACKUP.ENDPOINT,
        apiKey: MODELSCOPE_BACKUP.API_KEY,
        model: model || MODELSCOPE_BACKUP.MODEL,
        messages,
        temperature,
        maxTokens,
        timeout: 30000,
      })
      if (content) return { content, usedBackup: true }
    } catch {
      // fall through
    }
  }

  // Gemini 文本兜底：独立配额，与魔搭/备份供应商互不干扰
  if (GEMINI_DIRECT.ENABLED) {
    try {
      const content = await requestGeminiText({ systemContent, userContent, temperature, maxTokens })
      if (content) return { content, usedBackup: true }
    } catch {
      // fall through
    }
  }

  for (const vendor of BACKUP_CONFIG.VENDORS) {
    try {
      const content = await requestOpenAIProvider({
        endpoint: vendor.endpoint,
        apiKey: process.env[vendor.envKey] || '',
        model: model || vendor.textModel,
        messages,
        temperature,
        maxTokens,
        timeout: AI_CONFIG.TIMEOUT,
        vendor,
      })
      if (content) return { content, usedBackup: true }
    } catch {
      // fall through
    }
  }

  throw new Error('All text AI providers failed')
}

export async function callVisionCompletion(opts) {
  const {
    imageDataURL,
    systemPrompt,
    userText = '请识别这张作业图片中的所有题目，并返回 JSON 结果。',
    temperature = 0.3,
    maxTokens = 8192,
    model,
  } = opts

  const messages = buildVisionMessages(systemPrompt, userText, imageDataURL)

  // 备份提供商超时：主 ModelScope 失败后快速尝试备选，防止阻塞批次
  const BACKUP_TIMEOUT = 30000

  const providers = []

  // ModelScope Key 池：主 Key + 备用 Key，与 VL_MODELS 组成「Key×模型」矩阵。
  // 配额按账号×模型计，同一模型先主 Key 后备用 Key，都耗尽再换下一个模型。
  // ⭐ 摩搭是体验最好的供应商（速度快、正确率高），必须作为第一优先级。
  const MS_KEYS = [...new Set([
    AI_CONFIG.API_KEY,
    MODELSCOPE_BACKUP.ENABLED ? MODELSCOPE_BACKUP.API_KEY : null,
  ].filter(Boolean))]

  const callMsProvider = (apiKey, vlModel) => async () => {
    if (isModelExhaustedToday(vlModel, apiKey)) {
      throw new Error(`模型 ${vlModel} 当日配额已用尽（跳过）`)
    }
    const content = await requestOpenAIProvider({
      endpoint: AI_CONFIG.ENDPOINT,
      apiKey,
      model: vlModel,
      messages,
      temperature,
      maxTokens,
      timeout: AI_CONFIG.TIMEOUT,
      retry429: true,
    })
    return { content, usedBackup: apiKey !== AI_CONFIG.API_KEY }
  }

  const wantedModels = model ? [model] : VL_MODELS
  const mainSkippedByCooldown = MS_KEYS.length > 0 && isMainRateLimitedToday()

  // 动态决定优先级：
  //   默认魔搭优先（体验最好：速度快 + 正确率高）。
  //   但魔搭当日配额按账号×模型计，6 个组合极易全部耗尽；
  //   一旦全耗尽就立刻让 Agnes 顶上去，否则今天一张图都跑不通。
  //   明天魔搭恢复后又会自动切回魔搭优先，不需要手动改。
  //   MS_KEYS 为空（极端情况）或被主站冷却时，也按"全耗尽"走 Agnes。
  let allMsExhausted = true
  if (MS_KEYS.length > 0 && !mainSkippedByCooldown) {
    outer: for (const vlModel of wantedModels) {
      for (const apiKey of MS_KEYS) {
        if (!isModelExhaustedToday(vlModel, apiKey)) {
          allMsExhausted = false
          break outer
        }
      }
    }
  }

  if (allMsExhausted) {
    console.warn('[AI] 魔搭所有 Key×模型组合今日配额均已耗尽，自动切换为备份供应商优先')
    // 备份供应商视觉兜底（SenseNova → Agnes → FreeModel，各自独立配额）
    for (const vendor of BACKUP_CONFIG.VENDORS) {
      for (const vlModel of vendor.vlModels) {
        providers.push(async () => {
          try {
            const content = await requestOpenAIProvider({
              endpoint: vendor.endpoint,
              apiKey: process.env[vendor.envKey] || '',
              model: model || vlModel,
              messages,
              temperature,
              maxTokens: Math.min(maxTokens, 4096),
              timeout: BACKUP_TIMEOUT,
              retry503: false,
              vendor,
              extraBody: vendor.extraBody || null,
            })
            return { content, usedBackup: true }
          } catch (err) {
            err._provider = vendor.name.toLowerCase()
            throw err
          }
        })
      }
    }
    // 魔搭（如果中途有任何一个组合意外恢复了，仍会兜底试一次）
    if (!mainSkippedByCooldown) {
      for (const vlModel of wantedModels) {
        for (const apiKey of MS_KEYS) {
          if (isModelExhaustedToday(vlModel, apiKey)) continue
          providers.push(callMsProvider(apiKey, vlModel))
        }
      }
    }
  } else {
    // 第一优先级：魔搭 Key×模型矩阵（体验最好）
    for (const vlModel of wantedModels) {
      for (const apiKey of MS_KEYS) {
        if (isModelExhaustedToday(vlModel, apiKey)) continue
        providers.push(callMsProvider(apiKey, vlModel))
      }
    }
    // 备份供应商视觉兜底（Agnes → FreeModel → SenseNova，各自独立配额）
    for (const vendor of BACKUP_CONFIG.VENDORS) {
      for (const vlModel of vendor.vlModels) {
        providers.push(async () => {
          try {
            const content = await requestOpenAIProvider({
              endpoint: vendor.endpoint,
              apiKey: process.env[vendor.envKey] || '',
              model: model || vlModel,
              messages,
              temperature,
              maxTokens: Math.min(maxTokens, 4096),
              timeout: BACKUP_TIMEOUT,
              retry503: false,
              vendor,
              extraBody: vendor.extraBody || null,
            })
            return { content, usedBackup: true }
          } catch (err) {
            // 打标记让 wrapVisionError 知道是哪个 vendor 失败
            err._provider = vendor.name.toLowerCase()
            throw err
          }
        })
      }
    }
  }

  // 最后兜底：所有备份都不可用时，等主站冷却结束再把「Key×模型」矩阵全部重试（最多 2 轮）。
  // 备份提供商经常整体不可用（401/503），ModelScope 是唯一出路，绝不能因一次瞬时限流就放弃整页。
  // 无条件加入：既覆盖「进入时已被冷却跳过」，也覆盖「本次调用中主站 429 耗尽后才触发冷却」。
  if (MS_KEYS.length) {
    for (let round = 0; round < 2; round += 1) {
      providers.push(async () => {
        // 重新过滤：本次调用过程中可能又有 Key×模型组合被判定为配额耗尽
        const combos = []
        for (const vlModel of (model ? [model] : VL_MODELS)) {
          for (const apiKey of MS_KEYS) {
            if (!isModelExhaustedToday(vlModel, apiKey)) combos.push([apiKey, vlModel])
          }
        }
        if (!combos.length) throw new Error('所有魔搭视觉模型当日配额均已用尽，请明日再试或配置其他模型')
        const waitMs = Math.max(0, _mainRateLimitedUntil - Date.now())
        if (waitMs > 0) {
          console.warn(`[AI] 备份不可用，等待 ${Math.ceil(waitMs / 1000)}s 主站冷却结束后重试（第 ${round + 1} 轮兜底）`)
          await sleep(waitMs)
        }
        let err = null
        for (const [apiKey, vlModel] of combos) {
          try {
            return await callMsProvider(apiKey, vlModel)()
          } catch (e) {
            err = e
          }
        }
        throw err
      })
    }
  }

  let lastError = null
  let msAttempted = false
  let agnesAttempted = false
  let fmAttempted = false
  let snAttempted = false
  for (const provider of providers) {
    try {
      const result = await provider()
      if (result.content) return result
      lastError = new Error('AI returned empty content')
    } catch (err) {
      // 仅瞬时限流才进冷却；配额耗尽已按模型单独标记，不应连带冷却整个主站
      if (err.response?.status === 429 && !isQuotaExhaustedError(err) && !isMainRateLimitedToday()) {
        markMainRateLimited()
      }
      lastError = err
      // 标记哪些 provider 真正被尝试过
      if (err._provider === 'ms' || /魔搭|ModelScope|ms provider/i.test(err.message || '')) msAttempted = true
      else if (err._provider === 'agnes' || /Agnes|agnes/i.test(err.message || '')) agnesAttempted = true
      else if (err._provider === 'freemodel' || /FreeModel|freemodel/i.test(err.message || '')) fmAttempted = true
      else if (err._provider === 'sensenova' || /SenseNova|sensenova/i.test(err.message || '')) snAttempted = true
      else {
        // provider 闭包内未显式打标时，按调用顺序推断（先魔搭后 Agnes 再 FreeModel 再 SenseNova）
        if (!msAttempted) msAttempted = true
        else if (!agnesAttempted) agnesAttempted = true
        else if (!fmAttempted) fmAttempted = true
        else snAttempted = true
      }
    }
  }

  // ── 统一错误信息：让用户/前端/黑名单都能精确知道是哪一类 provider 不可用 ──
  // 仅魔搭失败 → 提示"魔搭视觉模型当日配额耗尽或限流，请明日再试或配置其他模型"
  // 魔搭+Agnes 都失败 → 提示"所有视觉模型均不可用，请稍后重试"
  throw wrapVisionError(lastError, { msAttempted, agnesAttempted, fmAttempted, snAttempted })
}

/**
 * 根据已尝试的 provider 类型，把 lastError 包装成精确错误信息。
 * 纯函数，导出供单测。
 *
 * 规则：
 *   - 仅魔搭失败 → 保留原 message（让黑名单 pattern "所有魔搭视觉模型...用尽" 能命中）
 *   - 仅 Agnes 失败 → "所有 Agnes 视觉模型均不可用：${baseMsg}"
 *   - 魔搭 + Agnes 都失败 → "所有视觉模型（魔搭 + Agnes）均不可用：${baseMsg}"
 *   - 都没尝试（理论不可能）→ 抛原 error
 */
export function wrapVisionError(lastError, { msAttempted = false, agnesAttempted = false, fmAttempted = false, snAttempted = false } = {}) {
  if (!lastError) return new Error('All vision AI providers failed')
  // 收集所有尝试过的 provider 名称
  const tried = []
  if (msAttempted) tried.push('魔搭')
  if (agnesAttempted) tried.push('Agnes')
  if (fmAttempted) tried.push('FreeModel')
  if (snAttempted) tried.push('SenseNova')
  if (tried.length >= 2) {
    const wrapped = new Error(`所有视觉模型（${tried.join(' + ')}）均不可用：${lastError.message || '未知错误'}`)
    wrapped.cause = lastError
    return wrapped
  }
  if (agnesAttempted && !msAttempted && !fmAttempted && !snAttempted) {
    const wrapped = new Error(`所有 Agnes 视觉模型均不可用：${lastError.message || '未知错误'}`)
    wrapped.cause = lastError
    return wrapped
  }
  return lastError
}

export const buildOCRPrompt = () => `你是一个专业的作业题目识别助手。请识别图片中的题目，并严格返回 JSON，不要输出任何额外说明。

返回格式：
{
  "questions": [
    {
      "question_id": "唯一标识",
      "question_number": 1,
      "content": "题目内容",
      "options": ["A", "B", "C", "D"],
      "answer": "标准答案",
      "student_answer": "学生答案",
      "is_correct": true,
      "confidence": 0.95,
      "analysis": "解析",
      "question_type": "choice/fill/judge/answer",
      "has_manual_checkmark": false,
      "block_coordinates": { "x": 0, "y": 0, "width": 1000, "height": 1000 },
      "text_bbox": { "x": 0, "y": 0, "width": 1000, "height": 600 },
      "image_type": "geometry/chart/none",
      "image_bbox": null,
      "geometry_image": null
    }
  ]
}

要求：
1. 只返回合法 JSON。
2. 没有配图时 image_type 填 "none"，image_bbox 和 geometry_image 填 null。
3. 坐标统一使用 0-1000 的整数，相对整张图片归一化。
4. 如果题目无法识别，不要编造内容。
5. 识别老师批改痕迹（重要）：
   - 若某题旁出现老师用红笔（或与印刷/学生墨迹不同的笔）打的"√/✓/✔"，说明该题老师已判对，应将 has_manual_checkmark 设为 true，并且 student_answer 填学生实际笔迹（以学生墨迹为准，剔除老师的红勾）。
   - 若出现"×/✗/半对半错"等批改，has_manual_checkmark 设为 false，交由答案比对判定。
   - 只在能明确辨认出独立批改标记时才置 true，否则保持 false，宁可不置也不要误判。
6. 判断题（对/错）的答案或学生答案若是"√/✗"符号，直接填入对应符号即可。`

export const buildAnswerGenerationPrompt = () => `你是一个中小学题目解答助手。请根据给定题目生成标准答案与解析，只返回 JSON：
{
  "answer": "标准答案",
  "analysis": "解析过程",
  "subject": "学科"
}

要求：
1. 只返回 JSON。
2. 解析结尾要明确给出最终答案。
3. 选择题 answer 只返回选项字母。`

export const buildTaggingPrompt = (subject = null) => `你是一个 K12 题目知识点分类助手。请根据题目内容输出知识点和难度，只返回 JSON。
${subject ? `已知学科：${subject}\n` : ''}
返回格式：
{
  "tags": ["知识点1", "知识点2"],
  "difficulty": 3
}

要求：
1. tags 使用具体知识点名称，不要只写学科名。
2. difficulty 必须是 1-5 的整数。
3. 无法准确判断时，difficulty 默认 3。`

export const buildGeometryExtractionPrompt = () => `你是一个几何图提取助手。请识别图片中的纯几何元素并输出 TikZ 代码，只返回完整 tikzpicture 代码，不要解释。`

export const buildGeometryReconstructionPrompt = () => `你是一个几何图结构识别助手。请从图片中提取几何结构，只返回 JSON。

返回格式：
{
  "figure_type": "geometry",
  "points": [],
  "segments": [],
  "circles": [],
  "coordinate_system": { "exists": false, "origin": "", "x_axis": false, "y_axis": false },
  "constraints": [],
  "geometry_labels": [],
  "ignored_labels": [],
  "rightAngles": []
}

要求：
1. 只返回 JSON。
2. 不要补画原图中不存在的点、线、圆、坐标轴。
3. 无法识别时返回空结构。`

export const buildTikzGenerationPrompt = () => `你是一个 TikZ 代码生成助手。请根据输入几何图输出完整的 tikzpicture 代码，不要附加任何解释。`
