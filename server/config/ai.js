// Use getters so env vars are resolved lazily at access time, not at module import time.
// This allows dotenv.config() in index.js / worker.js to set process.env before AI_CONFIG is used.
import axios from 'axios'

export const AI_CONFIG = {
  get ENDPOINT() { return process.env.AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions' },
  get API_KEY() { return process.env.AI_API_KEY || 'ms-dae707ae-bcc4-4d7e-aa83-e2165d0cdbf5' },
  get MODEL() { return process.env.AI_MODEL || 'Qwen/Qwen3-VL-8B-Instruct' },
  TIMEOUT: 120000,
  MAX_RETRIES: 2
}

// ── 429 限流退避策略 ──
// 命中 429（配额/限流）时，对同一 provider 依次等待后重试；耗尽后再走切备用/抛出逻辑。
export const RETRY_DELAYS_429 = [5000, 15000, 60000]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── 全局 AI 并发信号量 ──
// 跨所有任务、所有题目共享的闸门，限制"同时在途"的 AI HTTP 请求数，从源头压住 429。
// 上限由 AI_CONCURRENCY 控制，默认 2。等待期间（含 429 退避 sleep）会释放名额，避免占坑。
const _aiLimit = parseInt(process.env.AI_CONCURRENCY) || 2
let _aiActive = 0
const _aiWaiters = []

function _acquireAiSlot() {
  if (_aiActive < _aiLimit) {
    _aiActive++
    return Promise.resolve()
  }
  return new Promise(resolve => _aiWaiters.push(resolve))
}

function _releaseAiSlot() {
  const next = _aiWaiters.shift()
  if (next) {
    next() // 名额转交给下一个等待者，_aiActive 保持不变
  } else {
    _aiActive = Math.max(0, _aiActive - 1)
  }
}

/**
 * 在全局 AI 并发闸门内执行一次异步操作（通常是一次 HTTP 请求）。
 * 保证任一时刻在途 AI 请求不超过 AI_CONCURRENCY（默认 2）。
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withAiLimit(fn) {
  await _acquireAiSlot()
  try {
    return await fn()
  } finally {
    _releaseAiSlot()
  }
}

/**
 * 发起一次带 429 指数退避重试的 axios 请求，整体处于全局并发闸门内。
 * - 命中 429：按 RETRY_DELAYS_429（5s/15s/60s）等待后重试同一请求；
 *   退避 sleep 期间释放并发名额（把 sleep 放在闸门外，重试时重新入闸）。
 * - 非 429 错误：直接抛出，交由上层 provider 切换逻辑处理。
 * @param {import('axios').AxiosInstance | typeof import('axios').default} client
 * @param {string} endpoint
 * @param {object} body
 * @param {object} axiosOptions
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function postWith429Retry(client, endpoint, body, axiosOptions, { retry429 = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withAiLimit(() => client.post(endpoint, body, axiosOptions))
    } catch (err) {
      const status = err.response?.status
      // retry429=false 时（主 API 直连场景）：429 不重试，立即抛出交由上层切备用，避免白等退避
      if (retry429 && status === 429 && attempt < RETRY_DELAYS_429.length) {
        const delay = RETRY_DELAYS_429[attempt]
        console.warn(`⚠️ [AI] 429 限流，${delay / 1000}s 后重试（第 ${attempt + 1}/${RETRY_DELAYS_429.length} 次）...`)
        await sleep(delay)
        continue
      }
      throw err
    }
  }
}

// ── 主 API 当日限额标记 ──
// 一旦主 API（ModelScope）命中 429，当天剩余时间都不再直连主 API，
// 直接从跨厂商备用开始尝试，避免每个任务都白等 80s 退避（免费额度按天重置）。
let _mainRateLimitedDate = null
function markMainRateLimited() {
  _mainRateLimitedDate = new Date().toISOString().slice(0, 10)
}
export function isMainRateLimitedToday() {
  return _mainRateLimitedDate === new Date().toISOString().slice(0, 10)
}

// ── AI 模型轮换机制 ──
// ModelScope 免费模型每日有配额限制，单个模型耗尽时自动切换到其他模型

/** 视觉模型列表（OCR 识别用）
 *  第一个优先取环境变量 AI_MODEL / VL_MODEL，方便线上快速切换而无需改代码；
 *  其余为 ModelScope 当前可用的候选，模型下线（400 no provider）或配额耗尽时自动向后轮换。
 *  注意：数组内去重，避免环境变量与候选重复导致轮换空转。
 *  ⚠️ 2026-07 实测：ModelScope 免费在线推理仅 Qwen3-VL 系列可用，
 *     Qwen2.5-VL 及非 Qwen 模型均 "has no provider supported"。
 *     平台日后恢复其他模型时，改 Render 环境变量 AI_MODEL 即可，无需改代码。 */
// ⚠️ 默认优先 8B（免费额度更稳、不易 429）；30B 仅作为 8B 配额耗尽时的轮换候选。
// 顺序即轮换顺序：getCurrentVLModel() 取 VL_MODELS[0]，故 8B 必须排在最前。
export const VL_MODELS = [...new Set([
  process.env.AI_MODEL,
  process.env.VL_MODEL,
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-VL-30B-A3B-Instruct',
].filter(Boolean))]

/** 文本模型列表（答案生成、标签生成用） */
export const TEXT_MODELS = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-8B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/QwQ-32B',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
]

let _textIdx = 0
let _vlIdx = 0

/** 获取当前文本模型 */
export function getCurrentTextModel() {
  return TEXT_MODELS[_textIdx] || TEXT_MODELS[0]
}

/** 获取当前视觉模型 */
export function getCurrentVLModel() {
  return VL_MODELS[_vlIdx] || VL_MODELS[0]
}

/** 切换到下一个文本模型，返回新模型名；如果已遍历所有模型则返回 null */
export function rotateTextModel() {
  if (_textIdx >= TEXT_MODELS.length - 1) {
    console.warn(`⚠️ [ModelRotation] 所有文本模型已尝试完毕`)
    return null
  }
  _textIdx++
  console.log(`🔄 [ModelRotation] 切换到文本模型: ${TEXT_MODELS[_textIdx]}`)
  return TEXT_MODELS[_textIdx]
}

/** 切换到下一个视觉模型，返回新模型名；如果已遍历所有模型则返回 null */
export function rotateVLModel() {
  if (_vlIdx >= VL_MODELS.length - 1) {
    console.warn(`⚠️ [ModelRotation] 所有视觉模型已尝试完毕`)
    return null
  }
  _vlIdx++
  console.log(`🔄 [ModelRotation] 切换到视觉模型: ${VL_MODELS[_vlIdx]}`)
  return VL_MODELS[_vlIdx]
}

/** 重置所有模型索引到初始值 */
export function resetModelIndex() {
  _textIdx = 0
  _vlIdx = 0
}

export const getAIHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AI_CONFIG.API_KEY}`
})

// ── 备用 API（TackleKey 单厂商，按 key 前缀识别）──
// 当主 API（ModelScope）因配额/限流失败时，自动切换到 TackleKey 兜底。
// TackleKey：TACKLEKEY_API_KEY，endpoint api.tacklekey.com，聚合多家模型。
// 统一使用 google/gemini-2.5-flash-nothink：实测可跑视觉 OCR 且返回干净 JSON，
// 文本 / 视觉链路均可用，是主 API 之外唯一稳定可用的兜底。
// （Sensnova / Agnes / OpenRouter 均因不产 JSON 或免费额度不可用，已移除。）
const BACKUP_VENDOR_DEFS = [
  {
    name: 'TackleKey',
    envKey: 'TACKLEKEY_API_KEY',
    keyPrefix: 'sk-6f',
    endpoint: 'https://api.tacklekey.com/v1/chat/completions',
    // 文本、视觉统一用 gemini-2.5-flash-nothink（实测视觉 OCR 产干净 JSON）
    textModel: 'google/gemini-2.5-flash-nothink',
    vlModels: ['google/gemini-2.5-flash-nothink'],
    isThinking: false,
    referer: null
  }
]

// 已启用（配了有效 key）的厂商，按列表顺序即优先级（当前仅 TackleKey）
function resolveBackupVendors() {
  return BACKUP_VENDOR_DEFS.filter(v => {
    const key = process.env[v.envKey] || ''
    return key && key.startsWith(v.keyPrefix)
  })
}

export const BACKUP_CONFIG = {
  // 所有已启用的备用厂商（按优先级排列）
  get VENDORS() {
    return resolveBackupVendors()
  },
  get ENABLED() {
    return resolveBackupVendors().length > 0
  },
  // 第一个启用的厂商（文本链路默认用它）
  get PRIMARY() {
    return resolveBackupVendors()[0] || null
  },
  // 兼容旧调用：默认 endpoint / key / model（取第一个启用厂商）
  get ENDPOINT() {
    return process.env.BACKUP_ENDPOINT || this.PRIMARY?.endpoint ||
      'https://token.sensenova.cn/v1/chat/completions'
  },
  get API_KEY() {
    return this.PRIMARY?.apiKey || process.env.BACKUP_API_KEY || ''
  },
  get MODEL() {
    return process.env.BACKUP_MODEL || this.PRIMARY?.textModel || 'sensenova-6.7-flash-lite'
  },
  // 所有启用厂商的视觉模型（按优先级平铺，任一成功即返回）
  get VL_MODELS_LIST() {
    if (process.env.BACKUP_VL_MODEL) return [process.env.BACKUP_VL_MODEL]
    return resolveBackupVendors().flatMap(v => v.vlModels)
  },
  get DISABLE_REASONING() {
    return process.env.BACKUP_DISABLE_REASONING === 'true' ||
      (this.PRIMARY?.textModel || '').includes('hy3')
  }
}

// ── 备用2 API（魔搭 ModelScope 第二把 Key）──
// 与主 API 同一端点（api-inference.modelscope.cn），但使用独立的免费额度 Key。
// 当主 Key 配额耗尽（429）时，先切换到此 Key 继续消耗独立额度；
// 仍失败才走跨厂商备用（OpenRouter / Agnes）。
// Key / Model 全部通过环境变量注入，部署端（Render）后台填写即可。
export const MODELSCOPE_BACKUP = {
  get ENDPOINT() {
    return AI_CONFIG.ENDPOINT
  },
  get API_KEY() {
    return process.env.MODELSCOPE_BACKUP_API_KEY || ''
  },
  // 默认与主 API 同模型（都是 ModelScope 在线推理，可独立覆盖）
  get MODEL() {
    return process.env.MODELSCOPE_BACKUP_MODEL || AI_CONFIG.MODEL
  },
  get ENABLED() {
    return Boolean(process.env.MODELSCOPE_BACKUP_API_KEY)
  }
}

const _backupAxios = axios.create({ timeout: 60000 })

/**
 * 从模型响应消息中提取正文内容。
 * 多数 OpenAI 风格模型把正文放在 message.content；
 * 但部分思考模型（如商汤 sensenova-6.7-flash-lite、Agnes）正文只进
 * message.reasoning，content 恒为空——此时回退用 reasoning 作为内容，
 * 否则会被上层判成"空响应"而失败。
 * @param {object} message 响应中的 choices[].message
 * @returns {string}
 */
export function extractContent(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  const reasoning = message.reasoning
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning
  return ''
}

/**
 * 统一发起一次文本聊天补全请求，内置"主 API → 备用 API"自动切换。
 *
 * @param {{systemContent:string, userContent:string, temperature?:number, maxTokens?:number, model?:string}} opts
 * @returns {Promise<{content:string, usedBackup:boolean}>}
 * @throws 当主、备均调用失败（非限流类错误）时抛出最后一个错误
 *
 * 设计要点：
 * - 限流（429）或主 Key 缺失时，自动尝试备用；
 * - 若连备用也限流，仍抛出错误，由调用方决定重试/写未分类；
 * - 调用方无需关心当前用的是哪家，只拿回 content 文本。
 */
export async function callTextCompletion(opts) {
  const { systemContent, userContent, temperature = 0.2, maxTokens = 500, model } = opts
  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ]

  // 1. 先尝试主 API（ModelScope）
  const primaryBody = {
    model: model || getCurrentTextModel(),
    messages,
    temperature,
    max_tokens: maxTokens
  }

  // 主 API 空响应 / 瞬时网络抖动：原地重试，不急于切备用（节省配额、避免误判限流）。
  const MAX_PRIMARY_RETRY = 2
  let primaryErr = null
  const tryPrimary = async () => {
    for (let attempt = 0; attempt <= MAX_PRIMARY_RETRY; attempt++) {
      try {
        const resp = await postWith429Retry(axios, AI_CONFIG.ENDPOINT, primaryBody, {
          headers: getAIHeaders(),
          timeout: 30000
        }, { retry429: false })
        const content = resp.data?.choices?.[0]?.message?.content
        if (!content) {
          primaryErr = new Error('AI 返回内容为空')
          console.warn(`⚠️ [AI] 主 API 返回空内容（第 ${attempt + 1}/${MAX_PRIMARY_RETRY + 1} 次），${attempt < MAX_PRIMARY_RETRY ? '立即重试' : '放弃并转备用'}`)
          continue
        }
        return { content }
      } catch (err) {
        primaryErr = err
        const isNetwork = !err.response || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
        if (isNetwork && attempt < MAX_PRIMARY_RETRY) {
          console.warn(`⚠️ [AI] 主 API 网络异常（第 ${attempt + 1} 次），重试...`)
          continue
        }
        return { err } // 非网络错误（400/503 等）→ 直接交备用
      }
    }
    return { err: primaryErr }
  }

  // 当天主 API 已限额：跳过主 API 直连，直接走备用，避免每个任务白等
  if (isMainRateLimitedToday()) {
    console.warn(`⚠️ [AI] 主 API 今日已限额，跳过直连，直接从备用 API 开始`)
    primaryErr = new Error('主 API 今日限额，已跳过')
    const status = 429
    const isQuota = true
    const primaryKeyMissing = false
    if (!isQuota && !primaryKeyMissing && !primaryErr.response) {
      throw primaryErr
    }
    console.warn(`⚠️ [AI] 主 API 调用失败（429 限流），尝试备用 API...`)
  } else {
    const primaryResult = await tryPrimary()
    if (primaryResult.content) {
      return { content: primaryResult.content, usedBackup: false }
    }
    primaryErr = primaryResult.err
    const status = primaryErr.response?.status
    const isQuota = status === 429
    const primaryKeyMissing = !AI_CONFIG.API_KEY
    if (!isQuota && !primaryKeyMissing && !primaryErr.response) {
      // 非限流、非 Key 缺失的网络异常 → 直接抛出，不轻易切备用（可能是临时抖动由调用方重试）
      throw primaryErr
    }
    console.warn(`⚠️ [AI] 主 API 调用失败${isQuota ? '（429 限流）' : primaryKeyMissing ? '（Key 缺失）' : ''}，尝试备用 API...`)
  }

  // 1.5 备用2 API（魔搭第二把 Key，同一端点独立免费额度）
  if (MODELSCOPE_BACKUP.ENABLED) {
    const b2Model = model || MODELSCOPE_BACKUP.MODEL
    const b2Body = {
      model: b2Model,
      messages,
      temperature,
      max_tokens: maxTokens
    }
    try {
      const resp = await postWith429Retry(axios, MODELSCOPE_BACKUP.ENDPOINT, b2Body, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MODELSCOPE_BACKUP.API_KEY}`
        },
        timeout: 30000
      })
      const content = extractContent(resp.data?.choices?.[0]?.message)
      if (!content) throw new Error('备用2 AI 返回内容为空')
      console.log(`✅ [AI] 备用2 API（魔搭第二 Key）调用成功（${b2Model}）`)
      return { content, usedBackup: true }
    } catch (b2Err) {
      console.warn(`⚠️ [AI] 备用2 API（魔搭第二 Key）失败：${b2Err.message}，继续尝试跨厂商备用...`)
    }
  }

  // 2. 备用 API（跨厂商，按优先级 Sensnova → Agnes → OpenRouter，任一成功即返回）
  if (!BACKUP_CONFIG.ENABLED) {
    throw new Error(`主 API 失败且无备用 API：${primaryErr.message}`)
  }
  const backupVendors = BACKUP_CONFIG.VENDORS
  for (const v of backupVendors) {
    const vKey = process.env[v.envKey] || ''
    const backupBody = {
      model: model || v.textModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      // 部分免费模型（如 tencent/hy3）是"思考模型"，默认把预算花在 reasoning 上导致 content 为空；
      // 显式关闭思考，强制直接输出正文。
      ...(v.textModel.includes('hy3') ? { reasoning: { enabled: false } } : {})
    }
    try {
      const resp = await postWith429Retry(_backupAxios, v.endpoint, backupBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${vKey}`,
          ...(v.referer ? { 'HTTP-Referer': v.referer, 'X-Title': 'Minxue' } : {})
        }
      })
      const content = extractContent(resp.data?.choices?.[0]?.message)
      if (!content) throw new Error('备用 AI 返回内容为空')
      console.log(`✅ [AI] 备用 API（${v.name}）调用成功（${model || v.textModel}）`)
      return { content, usedBackup: true }
    } catch (backupErr) {
      console.warn(`⚠️ [AI] 备用 API（${v.name}）失败：${backupErr.message}，尝试下一个...`)
    }
  }
  console.error(`❌ [AI] 所有备用 API 均失败`)
  throw new Error(`所有备用 API 均失败：${primaryErr.message}`)
}

/**
 * 发起一次「视觉（多模态）」聊天补全请求，按 Provider 列表依次尝试，任一成功即返回。
 *
 * Provider 顺序：
 *   1. 主 API（ModelScope Qwen3-VL，Key A）
 *   2. 备用2 API（ModelScope 第二把 Key，同一端点独立免费额度）
 *   3. 跨厂商备用（按优先级 Sensnova → Agnes → OpenRouter，视觉模型逐个轮询）
 *
 * 只有在所有 Provider 均失败时才抛出错误，记录失败日志。
 * 几何图重建 Worker 使用此函数，保证即使主 API 配额耗尽也能继续。
 *
 * @param {{imageDataURL:string, systemPrompt:string, userText?:string, temperature?:number, maxTokens?:number, model?:string}} opts
 * @returns {Promise<{content:string, usedBackup:boolean}>}
 * @throws 所有 Provider 均失败时抛出最后一个错误
 */
export async function callVisionCompletion(opts) {
  const {
    imageDataURL,
    systemPrompt,
    userText = '请识别这张作业图片中的所有题目，并返回JSON格式结果。',
    temperature = 0.3,
    maxTokens = 8192,
    model
  } = opts

  const buildMessages = () => ([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataURL } },
        { type: 'text', text: userText }
      ]
    }
  ])

  // ── Provider 定义列表 ──
  // 按顺序尝试，任一成功即返回。
  const skipMainToday = isMainRateLimitedToday()
  if (skipMainToday) {
    console.warn(`⚠️ [AI-Vision] 主 API 今日已限额，跳过直连，从备用开始尝试`)
  }
  const providers = []

  // 主 API（ModelScope）：当天未限额时才加入；命中 429 时立即标记，后续任务跳过
  if (!skipMainToday) {
    providers.push({
      name: '主 API (ModelScope)',
      endpoint: AI_CONFIG.ENDPOINT,
      model: () => model || getCurrentVLModel(),
      headers: () => getAIHeaders(),
      buildBody: (m) => ({
        model: m,
        messages: buildMessages(),
        temperature,
        max_tokens: maxTokens
      }),
      // 429 不重试（retry429=false），命中即标记当日限额并跳过；Key 缺失也跳过
      shouldSkipOnError: (err) => {
        const status = err.response?.status
        if (status === 429) markMainRateLimited()
        return status === 429 || !AI_CONFIG.API_KEY
      }
    })
  }

  // 备用2 API（魔搭第二把 Key，同一端点独立免费额度）
  if (MODELSCOPE_BACKUP.ENABLED) {
    providers.push({
      name: '备用2 API (魔搭第二 Key)',
      endpoint: MODELSCOPE_BACKUP.ENDPOINT,
      model: () => model || MODELSCOPE_BACKUP.MODEL,
      headers: () => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MODELSCOPE_BACKUP.API_KEY}`
      }),
      buildBody: (m) => ({
        model: m,
        messages: buildMessages(),
        temperature,
        max_tokens: maxTokens
      }),
      // 备用 Provider：任一错误（含 401 鉴权失败 / Key 未绑定阿里云账号）都跳过，
      // 继续尝试后续跨厂商备用（OpenRouter / agnES），绝不因本层失败而中止整条链路
      // （旧逻辑对 401 返回 false 会直接 throw，挡住后面真正可用的备用）。
      shouldSkipOnError: () => true
    })
  }

  // 备用 API（跨厂商：按优先级 Sensnova → Agnes → OpenRouter，各自独立 Key）
  // 每个启用厂商的视觉模型逐个展开为独立 Provider，按厂商优先级排列；
  // 任一成功即返回，全部失败则跳过，不影响主链路。
  if (BACKUP_CONFIG.ENABLED) {
    BACKUP_CONFIG.VENDORS.forEach(vendor => {
      const vKey = process.env[vendor.envKey] || ''
      const vlModels = process.env.BACKUP_VL_MODEL
        ? [process.env.BACKUP_VL_MODEL]
        : vendor.vlModels
      vlModels.forEach((vlModel, idx) => {
        providers.push({
          name: `备用 API (${vendor.name}${vlModels.length > 1 ? ` #${idx + 1}` : ''})`,
          endpoint: vendor.endpoint,
          model: () => model || vlModel,
          headers: () => {
            const h = {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${vKey}`
            }
            if (vendor.referer) {
              h['HTTP-Referer'] = vendor.referer
              h['X-Title'] = 'Minxue'
            }
            return h
          },
          buildBody: (m) => {
            const body = {
              model: m,
              messages: buildMessages(),
              temperature,
              max_tokens: maxTokens
            }
            if (vendor.textModel.includes('hy3')) {
              body.reasoning = { enabled: false }
            }
            return body
          },
          // 备用 Provider：任一错误都跳过，继续尝试下一个（含思考模型 reasoning 回退）
          shouldSkipOnError: () => true
        })
      })
    })
  }

  // ── 依次尝试每个 Provider ──
  let lastError = null
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    const currentModel = p.model()
    // 单 Provider 空响应 / 瞬时网络抖动：原地重试，避免空响应被直接判为"该 Provider 失败"。
    const MAX_PROVIDER_RETRY = 2
    let providerContent = null
    let providerLastErr = null
    for (let attempt = 0; attempt <= MAX_PROVIDER_RETRY && !providerContent; attempt++) {
      try {
        const resp = await postWith429Retry(_backupAxios, p.endpoint, p.buildBody(currentModel), {
          headers: p.headers(),
          timeout: AI_CONFIG.TIMEOUT
        }, { retry429: i !== 0 })
        const content = extractContent(resp.data?.choices?.[0]?.message)
        if (!content) {
          providerLastErr = new Error('AI 返回内容为空')
          console.warn(`⚠️ [AI-Vision] ${p.name}（${currentModel}）返回空内容（第 ${attempt + 1}/${MAX_PROVIDER_RETRY + 1} 次），${attempt < MAX_PROVIDER_RETRY ? '立即重试' : '放弃并跳到下一个 Provider'}`)
          continue
        }
        providerContent = content
      } catch (err) {
        providerLastErr = err
        const isNetwork = !err.response || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
        if (isNetwork && attempt < MAX_PROVIDER_RETRY) {
          console.warn(`⚠️ [AI-Vision] ${p.name}（${currentModel}）网络异常（第 ${attempt + 1} 次），重试...`)
          continue
        }
        break // 非网络错误（含 429）→ 跳出，按 shouldSkipOnError 决定是否跳下一个
      }
    }

    if (providerContent) {
      const usedMain = p.name.includes('主 API')
      const label = usedMain ? '主' : `备用 (${i})`
      console.log(`✅ [AI-Vision] ${label} API 调用成功（${currentModel}）`)
      return { content: providerContent, usedBackup: !usedMain }
    }

    const err = providerLastErr || new Error('空响应')
    lastError = err
    const status = err.response?.status
    const skip = p.shouldSkipOnError(err)
    const reason = status === 429 ? '429 配额耗尽'
      : status === 503 ? '503 服务不可用'
      : status === 400 ? '400 模型不可用'
      : status ? `HTTP ${status}`
      : err.code || err.message
    console.warn(`⚠️ [AI-Vision] ${p.name}（${currentModel}）失败: ${reason}${skip ? '，尝试下一个...' : '（不可跳过）'}`)
    if (!skip) {
      // 不可跳过的错误（如 400 模型下线）→ 直接抛出，让调用方处理模型轮换
      throw err
    }
  }

  // 所有 Provider 均失败
  console.error(`❌ [AI-Vision] 所有 Provider 均失败，共 ${providers.length} 个`)
  throw lastError || new Error('所有 Vision API Provider 均不可用')
}

export const buildOCRPrompt = () => `你是一个专业的教育题目识别助手。请仔细分析上传的作业图片，识别其中的题目内容、几何配图和位置。

请按以下 JSON 格式返回识别结果：
{
  "questions": [
    {
      "question_id": "唯一标识",
      "question_number": 1,
      "content": "题目内容（纯文本）",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案",
      "student_answer": "学生作答",
      "is_correct": true/false,
      "confidence": 0.95,
      "analysis": "题目解析",
      "question_type": "choice/fill/judge/answer",
      "has_manual_checkmark": true/false,
      "block_coordinates": {
        "x": 100,
        "y": 200,
        "width": 800,
        "height": 150
      },
      "text_bbox": {
        "x": 100,
        "y": 200,
        "width": 800,
        "height": 100
      },
      "image_type": "geometry/chart/none",
      "image_bbox": {
        "x": 200,
        "y": 350,
        "width": 250,
        "height": 200
      },
      "geometry_image": null
    }
  ]
}

页面结构分析（重要新功能）：
- question_number: 该题在试卷上的题号（如第1题填1，第2题填2）。如果无明确编号，按从上到下顺序从1开始编号。
- block_coordinates: 题目整体区域（包括题干、选项、配图、作答区）在整张图片中的边界框坐标（归一化 0-1000 整数，见下方坐标系说明）。
- text_bbox: 仅题目文字区域（题干+选项，不含配图）的边界框坐标。
- image_type: 配图类型，取值：
  * "geometry" — 几何图形（三角形、圆、函数图像等）
  * "chart" — 图表（统计图、表格等）
  * "none" — 无配图
- image_bbox: 配图区域在整张图片中的边界框坐标。如果 image_type 为 "none"，该字段可省略或填 null。
  ⚠️ image_bbox 必须【紧贴】该题自己的几何图形本身，遵守以下硬性规则：
  * 只框住图形（线条、坐标系、顶点字母 A/B/C/D 等），不要把题干文字、选项、解析、作答区大段包进去。
  * 绝对不允许跨越到【上一道或下一道题】——image_bbox 的范围必须完全落在本题 block_coordinates 之内。
  * 若上下相邻还有别的题目或别的配图，务必让本题的 image_bbox 底边停在本题结束处之前，不要延伸到下一题的题号/题干/配图。
  * bbox 高度通常较小（一般不超过本题 block 高度）；如果你框出的高度很大、几乎覆盖多道题，说明框错了，请重新收紧。

geometry_image 说明（多模态切题核心字段，保持向后兼容）：
- 如果该题目包含几何图形/配图，请填写 geometry_image 对象，否则填 null
- geometry_image 对象格式：
  {
    "has_image": true,
    "bbox": { "x": 200, "y": 350, "width": 250, "height": 200 },
    "description": "直角三角形ABC的几何示意图"
  }
- bbox 是配图在整张试卷图片中的边界框坐标（归一化 0-1000 整数），必须与 image_bbox 保持一致
- 如果题干中提到"如图"、"如图所示"、"图1"、"附图"等关键词，请务必找到对应的配图并标注 bbox
- 配图通常在题干下方或右方

block_coordinates 说明（必填）：
⚠️ 坐标系统一说明（block_coordinates、text_bbox、image_bbox、geometry_image.bbox 全部适用）：
所有 bbox 一律使用【归一化坐标】，取值 0-1000 的整数，相对整张图片：
- 图片左上角为原点 (0,0)，右下角为 (1000,1000)；x 向右增大，y 向下增大。
- x = 区域左边缘 ÷ 图片宽度 × 1000；y = 区域上边缘 ÷ 图片高度 × 1000。
- width = 区域宽度 ÷ 图片宽度 × 1000；height = 区域高度 ÷ 图片高度 × 1000。
- **绝对不要输出真实像素值。** 例如位于图片正中、约占四分之一面积的区域应为
  { "x": 375, "y": 375, "width": 250, "height": 250 }。
- 越靠近页面底部的题目，y 值越大（接近 1000）；请按题目在整页中的真实上下位置准确给出 y。
- x: 题目区域左上角横坐标（0-1000）
- y: 题目区域左上角纵坐标（0-1000）
- width: 题目区域宽度（占图片宽度的千分比，0-1000）
- height: 题目区域高度（占图片高度的千分比，0-1000）
- 请根据题目在图片中的实际位置准确估算，后续批改页面将用这些坐标来高亮标记题目区域

题目类型说明：
- choice: 选择题（有A/B/C/D等选项）
- fill: 填空题（有下划线或空格需要填写）
- judge: 判断题（判断对错，答案通常为"正确/错误""对/错""√/×"）
- answer: 解答题（需要文字说明或计算过程）

字段说明：
- answer: 题目的标准答案/参考答案
- student_answer: 学生实际填写的答案
- is_correct: 仅作为 AI 的参考判断，实际正确性由服务端根据 student_answer 与 answer 的比对结果决定
- analysis: 题目解析，讲解题目本身的知识点和解法，绝不能提及学生答案或作答情况
- has_manual_checkmark: 是否在该题目旁边看到了人工批改的勾号（✓/✔/√ 打勾标记）。如果有，说明老师已批改此题，请设为 true

识别重点：
1. 务必确保 student_answer 和 answer 字段的识别尽可能准确，它们是评判正确性的唯一依据
2. 如果无法识别学生答案，student_answer 留空字符串，不要编造
3. 如果题目没有标准答案，answer 留空字符串
4. 对于填空题，用 ____ 表示填空位置，仔细识别学生填写的内容
5. 重点检测题目旁边是否有老师批改的打勾（✓）或打叉（✗）标记
6. **重点**：仔细扫描题干中的"如图"、"如图所示"、"图1"、"附图"等关键词，找到对应的几何配图并准确标注 bbox

针对 student_answer 的识别：
- 如果图片中同时出现了学生笔迹和老师批改痕迹，student_answer 以学生笔迹为准
- 如果图片中只有打印的题目和空白，student_answer 留空

注意事项：
1. 只返回 JSON 格式数据，不要包含其他文字说明
2. 如果识别不到选项，options 为空数组
3. confidence 表示识别置信度，范围 0-1
4. 对于填空题，用 ____ 表示填空位置
5. 对于解答题，content 包含完整题目描述
6. 分析规则（重要）：analysis 必须只讲解题目本身的知识点和解法，绝对不能提及学生答案是什么、学生作答情况或任何关于学生表现的评价。分析文本不参与 is_correct 判定。
7. geometry_image.bbox 标注时，请确保包围完整的几何图形（包括图形外围的顶点字母如A、B、C、D），但【绝不能】把相邻题目的内容包进来——bbox 必须落在本题 block_coordinates 之内。
8. 一图多题：如果同一张配图对应多道题目，每道题都要独立标注该配图的 bbox
9. **切图边界（极其重要）**：每道题的 image_bbox 只能框住【本题】的配图。试卷上下相邻常有多道带图的题，绝不能一个框跨两题。如果一个框里同时出现了两个几何图、或图形下方还有别的题号（如"9."、"10."）和文字，说明框大了、框错了，必须收紧到只剩本题的那一个图形。`

export const buildAnswerGenerationPrompt = () => `你是一个专业的K12教育数学与理科助教。你的任务是根据题目内容，计算出该题的标准答案/参考答案。

核心规则：
1. 对于数学计算题、方程题、几何题，必须给出精确的计算结果，不是估算。答案要使用标准的 LaTeX 数学格式，用 \\(...\\) 包裹行内公式，用 $$...$$ 包裹独立公式块。例如分数写为 \\(\\frac{1}{2}x + 2\\) 而不是 "1/2 x + 2"。
**重要：answer 字段必须填入最简形式的最终结果。例如 \\frac{30}{\\sqrt{3}} 必须化简为 10\\sqrt{3} 或具体的数值。绝不能在 answer 字段使用未经化简的表达式。**
2. 答案应简洁明确，适合与学生的答案进行对比判定。选择题给出正确选项字母（如 "C"），填空题给出填空内容，解答题给出关键步骤和最终结果。
3. 如果题目是纯文字主观题（如语文阅读理解、作文题）且没有唯一标准答案，返回 { "answer": "", "analysis": "此题为主观题，无唯一标准答案" }。
4. 物理、化学题目给出数值+单位（如 "10M/S", "2KG"），涉及公式时使用 LaTeX 格式。
5. 对于完全无法生成答案的题目（例如题目内容残缺、非学术内容），返回 { "answer": "待人工补充", "analysis": "" }。

答案一致性要求（极其重要，必须严格遵守）：
1. **先写 analysis（完整解题过程），再从 analysis 中提取最终答案填入 answer 字段。**
2. **answer 字段必须与 analysis 的推导结论完全一致。** 绝不允许 analysis 中说"应选A"但 answer 填 "C"。
3. 选择题：analysis 最后一句必须明确写出"因此正确答案是X"或"应选X"（X为A/B/C/D），answer 字段必须填相同的字母。
4. 填空题：answer 是填空的具体内容，analysis 中必须推导出该内容。
5. 解答题：answer 是关键结果/最终答案，analysis 中必须得出该结果。
6. 输出前自查：answer 和 analysis 是否指向同一个答案？如果不一致，以 analysis 推导的结论为准修正 answer。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "answer": "标准答案（需要 LaTeX 格式的数学内容请使用 \\(...\\) 或 $$...$$ 包裹。选择题只填选项字母，如 C）",
  "analysis": "解题过程或思路说明（同样支持 LaTeX）。最后必须明确给出结论，如'因此正确答案是 C'。",
  "subject": "数学/物理/化学/语文/英语/其他"
}`

export const buildTaggingPrompt = (subject = null) => {
  const subjectHint = subject ? `\n本题所属学科：${subject}\n` : '\n'

  return `你是一个专业的中小学（K12）学科知识点分类助手。你的任务是根据题目内容，精准识别该题目考察的具体知识点标签。${subjectHint}
核心规则（必须严格遵守）：
1. 标签必须是"独立的知识概念"，而不是教材章节目录（如"第一章""有理数"是知识点，"七上第一章"不是）。
2. 一道题可能考察多个知识点，必须返回所有相关标签，不能只给一个。
3. 标签要简洁规范，使用最通用的学术名称。
4. 不要提取重复或近义的标签（"分数加减"和"分数运算"只保留一个）。
5. 以下为各学科常见知识点列表（供参考，不限于此）：

数学：整数运算、小数运算、分数运算、百分数、比例、有理数、实数、代数式、方程、方程组、不等式、不等式组、函数、一次函数、二次函数、反比例函数、平面几何、三角形、四边形、圆、相似、全等、勾股定理、三角函数、概率、统计、数列、向量、集合、复数、导数、积分、逻辑推理、应用题、行程问题、工程问题、经济问题
物理：机械运动、声现象、光现象、透镜、物态变化、内能、电路、欧姆定律、电功率、电与磁、信息与能源、力、运动和力、压强、浮力、功和机械能、简单机械、机械效率
化学：物质的变化和性质、化学实验、空气、氧气、碳和碳的氧化物、燃烧与灭火、溶液、酸碱盐、金属、化学计算、化学与生活
语文：字音字形、词语理解、成语运用、病句修改、标点符号、修辞手法、文学常识、古诗词默写、古诗词鉴赏、文言文字词、文言文翻译、文言文阅读、现代文阅读、名著阅读、综合性学习、写作
英语：字母与发音、词汇辨析、名词、冠词、代词、形容词、副词、介词、连词、动词时态、被动语态、非谓语动词、情态动词、从句、主谓一致、情景交际、完形填空、阅读理解、书面表达

6. 如果学科已知（如上文给出），优先从该学科的知识点列表中匹配；如果学科未知，先根据题目内容判断学科，再从对应列表中匹配。
7. **标签必须具体**，不能停留在学科级别（如"数学"不是知识点标签，"有理数运算""一元一次方程"才是）。至少要达到"小数运算""勾股定理""欧姆定律""文言文翻译"这个粒度。
8. 仅在题目内容完全残缺、空白或无法理解时，才返回 ["未分类"]。能判断学科但不确定具体知识点的，返回该学科最相关的通用标签（如数学的计算题 → ["整数运算"]，物理的光学题 → ["光现象"]）。

难度判定（K12 通用五级，必须返回 1-5 的整数）：
- 1（基础识记）：直接套用定义/公式/记忆即可，单步、无需推理。如背默、直接代入、基础计算。
- 2（简单）：单一知识点的常规应用，1 步左右的简单推理。
- 3（中等）：需要 1-2 步推理，或结合 2 个知识点，属于常规题、大多数学生经努力可解。
- 4（较难）：多步推理、综合多个知识点，或需要一定转化/构造，属于中上难度。
- 5（难题/压轴）：综合性强、需要技巧或多步复杂推理、易错，属于压轴/竞赛级别。
判定要点：结合题型、涉及知识点数量、推理步骤、计算复杂度综合判断；即使不确定也必须给出最接近的整数，绝不能返回 null 或 0。仅在题目内容完全残缺无法理解时，才可返回 3（默认中等）。

请按以下 JSON 格式返回结果（只返回 JSON，不要包含其他文字）：
{
  "tags": ["知识点1", "知识点2", "知识点3"],
  "difficulty": 3
}`
}

/**
 * 构建几何结构分析 prompt — 用于从净化的几何图中提取抽象结构（点、线、标签）。
 *
 * 输入：经过 Sharp 净化处理后的几何图（白底黑线，去除非几何文字/手写痕迹）
 * 输出：TikZ 代码
 */
export const buildGeometryExtractionPrompt = () => `你是一个专业的几何图形提取助手。请分析给定的几何图裁剪区域，从中提取纯几何元素，输出 TikZ 代码。

## 核心任务
从裁剪图中识别哪些元素属于几何图形，忽略非几何内容，只生成纯几何的 TikZ 矢量图。

## 保留的元素
- 几何线段（实线、虚线、点划线）
- 顶点标注字母（A/B/C/D/O/P/Q/M/N 等）
- 角度弧线、角度数值（如 30°、45°、90°）
- 长度标注（如 2cm、3cm、a、b、x 等几何相关变量）
- 直角符号（方形标记）
- 圆、弧线
- 平行/垂直标记符号（箭头、小线段）
- 坐标轴（如果存在）

## 删除的元素
- 所有中文文字（题目描述、说明文字）
- 题号编号（如 "图1"、"图2"、"图3"、"第1题" 等）
- 页码、页眉页脚
- 解析文字、解题过程
- 学生笔迹、涂鸦
- 水印、二维码、条形码
- 非几何装饰元素

## 输出要求
1. 只输出完整的 TikZ 代码（包含 \\\\begin{tikzpicture} 和 \\\\end{tikzpicture}），不要附加任何说明文字。
2. 使用绝对坐标 (x,y)，单位 cm，保持几何关系与原图一致。
3. 实线用 \\\\draw，虚线用 \\\\draw[dashed]，点划线用 \\\\draw[dotted]。
4. 顶点字母用 \\\\node 标注，位置在点的外部（如 above, below, left, right）。
5. 角度用 \\\\draw arc 路径绘制，弧线半径 0.3-0.5cm。
6. 直角用直角标记（两个小线段或 rectangle 路径）。
7. 缩放比例建议 scale=1 或 scale=0.8。
8. 不要添加原图中没有的辅助线或标注。
9. 生成的 TikZ 代码应该看起来像教材中的几何插图。
10. 不要使用 \\\\tkzMarkAngle 等需要额外包的命令，使用纯 TikZ 路径。`

/**
 * 构建几何重建 prompt — 让视觉模型识别几何结构，输出结构化 JSON（而非图像/TikZ）。
 *
 * 几何重建流程（第三阶段）：
 * 视觉模型只负责"看懂"几何图，输出点/线/圆/坐标系/约束的结构化数据；
 * 服务端拿到 JSON 后确定性地渲染成干净 SVG（白底黑线，仅含几何元素）。
 * 这样输出完全可控，不受模型排版能力影响，天然去除中文/题号/笔迹/水印。
 *
 * 坐标系约定：数学平面，原点任意，x 向右为正，y 向上为正（服务端渲染时会翻转 y）。
 */
export const buildGeometryReconstructionPrompt = () => `你是一个专业的几何图形识别与重建助手。请仔细观察给定的几何图裁剪区域，识别其中的纯几何结构，输出结构化 JSON 数据。

## 核心任务
只识别几何图形本身的结构，忽略所有非几何内容。你不需要画图，只需要把图中的几何元素"读"成结构化数据。

关键要求：必须提取【空间关系】和【几何约束】，而不仅仅是"有哪些点和线"。

## 最高优先级原则：严格还原，不要重新设计
你的职责是【复刻原图】，不是【根据题意重画一张更"标准"的图】。流程必须是：
  看图 → 提取图中真实存在的元素 → 输出结构化数据。
绝对禁止：
- 根据题意 / 数学常识补充原图中没有画出的点、线、坐标轴、辅助线。
- 根据数学关系"优化"或"补全"图形（例如原图是随手画的钝角三角形，不要纠正成直角）。
- 用数学推理反推图中未画出的数字或长度。
生成优先级：① 原图视觉信息 > ② 原图文字标注 > ③ 题目要求。不要用数学推理去补充缺失信息。

## 图形类型判断层（先判断类型，再决定是否有坐标轴）
在识别元素之前，先判断整张裁剪图属于以下哪一类，填入 figure_type 字段：

### 类型 A：coordinate（坐标系 / 函数图）
判断标准：
- 图中【真实画出了】x 轴、y 轴、箭头、原点 O
- 或有函数曲线、抛物线、双曲线等函数图像
→ coordinate_system.exists = true，如实标出 x_axis / y_axis / origin。

### 类型 B：geometry（纯几何示意图）
判断标准：
- 三角形、四边形、平行四边形、圆、辅助线、点 A/B/C 等
- 图中【没有】坐标轴、箭头、刻度
→ coordinate_system.exists 必须 = false。绝对不要凭空添加坐标轴、刻度、原点。

### 类型 C：geometry_with_coords（几何图带坐标背景）
判断标准：
- 以几何图形为主，但原图确实画有坐标轴作为背景
→ 只保留原图【已经画出】的坐标轴，不要补全另一条不存在的轴。

### 判断硬性规则（极其重要）
1. 只有当图中【肉眼可见地画出了带箭头的坐标轴线】时，figure_type 才能是 coordinate 或 geometry_with_coords
2. 仅仅"感觉像坐标系"或"根据题目应该有坐标系"不算，必须亲眼看到画出来的轴线
3. 如果拿不准，宁可判成 geometry，也不要给几何题强加坐标系
4. 几何题中的三角形、平行四边形等一律判为 geometry，不要因为"看起来像要画坐标轴"而误判

## 坐标轴方向约定（仅当确有坐标轴时）
标准数学方向（中国初中教材统一习惯）：
~~~
   y
   ↑
   |
   |
   O ——→ x
~~~
- y 轴向上为正、箭头在上端
- x 轴向右为正、箭头在右端
- 原点 O 在左下
- 绝不允许 y 轴方向向下或箭头在下方

## 坐标轴标签位置规则（中国初中教材习惯）
只有图中确实有坐标轴时才标注：
- x 标签必须放在 x 轴【正方向箭头附近（右侧）】
- y 标签必须放在 y 轴【正方向箭头附近（上方）】
- 绝不允许把 y 放在原点下方或负方向
- 绝不允许出现负方向坐标轴标签，除非原图明确画出

## 数字生成规则（严格）
只有满足以下任一条件的数字/长度/角度才允许进入 geometry_labels：
1. 原图中【明确画出/写出】了该数字（边旁、角旁的数字）
2. 题目文字明确要求标注该长度/角度，且原图对应位置已表达
3. 该数字是原图已表达的、解题必需的标注

除此之外一律【严格禁止】自动添加：
- 边长数字（如 3、4、5 等）
- 坐标值（如 (2,3) 等坐标刻度）
- 长度标记
- 角度数字
- 刻度

中国初中教材插图默认风格：
- 只有点、线、字母标记
- 没有多余数字
- 没有辅助说明

⚠️ 若不确定某数字是否真的画在原图上，放入 ignored_labels，绝不放进 geometry_labels。

## 需要识别并保留的元素

### 1. 几何点 (points)
每个点必须包含：
- label: 字母标注（A/B/C/D/E/F/O/P/Q/M/N 等）
- position: { x, y } 平面坐标
- type: 点类型
  - "vertex" — 顶点（线段端点、多边形顶点）
  - "origin" — 坐标原点 O
  - "point" — 普通点（如线段上的点、圆上的点，无连线仅为标记位置）

### 2. 线段/连线 (segments)
每条线段必须包含：
- from: 起点字母（必须与 points 中的 label 一致）
- to: 终点字母
- style: "solid" / "dashed" / "dotted"
- relation: 线段之间的空间关系
  - "normal" — 普通连线
  - "perpendicular" — 垂直（⊥）
  - "parallel" — 平行（∥）
  - 判断依据：图中是否有垂直/平行标记符号

### 3. 圆 (circles)
- cx, cy: 圆心坐标
- r: 半径
- style: "solid" / "dashed" / "dotted"
- 只有图中确有圆形时标注，不要虚构

### 4. 坐标系 (coordinate_system)
识别图中是否有坐标轴（必须与 figure_type 一致）：
- exists: true/false — 图中是否【真实画出】x/y 坐标轴
- origin: 原点字母标签（如 "O"），若没有标注则用 ""
- x_axis: true/false — 是否有 x 轴
- y_axis: true/false — 是否有 y 轴
- 只有 figure_type 为 "coordinate" 或 "geometry_with_coords" 时才可能为 true；
  figure_type 为 "geometry" 时，exists 必须 false（服务端也会强制关闭）。

### 5. 几何约束 (constraints)
用自然语言描述图中所有几何约束关系，例如：
- "AB ⟂ BC"（AB 垂直于 BC）
- "AB ∥ CD"（AB 平行于 CD）
- "D is midpoint of AB"（D 是 AB 中点）
- "C lies on OA"（C 在 OA 上）
- "AB = CD"（AB 等于 CD）
- "∠ABC = 90°"（角 ABC 是直角）
- 一条约束一个字符串，没有则用空数组 []

### 6. 几何标注 (geometry_labels)
只放【真正属于几何图本身】的标注。一个数字/符号要进入 geometry_labels，必须同时满足：
1. 位于几何线段（边、弧、坐标轴）近旁；
2. 与某个几何元素存在明确空间关系（是某条边长、某个角度、某点的注记）；
3. 不属于题干文字区域、不是学生笔迹/计算、不是页码、不是题号。
例如：边长 "4"、"a"、角度 "30°"、"∠ABC"。
每个条目的格式：
- text: 标注文字（如 "4"、"30°"、"x"、"a"）
- x, y: 标注位置坐标（几何图内部的数学坐标）
- type: "length" / "angle" / "text"

### 7. 忽略标注 (ignored_labels)
凡是【不属于几何图】的数字/符号，一律放入 ignored_labels（不参与任何渲染）：
- 题干中的数字（如 "2.5"、"6"、比例、算式里的数）
- 学生的计算或笔迹数字
- 页码、题号（如 "11"、"13"、"图1"）
- 任何悬浮在几何图之外、与任何几何元素无空间关系的数字
格式同 geometry_labels：{ "text": "...", "x": ..., "y": ..., "type": "text" }。
⚠️ 如果你无法确定某个数字是不是几何标注，宁可放进 ignored_labels，也绝不放进 geometry_labels。

### 7. 直角标记 (rightAngles)
- vertex: 直角顶点字母
- from: 一条边上的点
- to: 另一条边上的点

## 必须忽略删除的元素（绝对不要出现在输出中）
- 所有中文文字（题目描述、说明文字、解析）
- 题号编号（"图1"、"图2"、"图3"、"第1题"、"(1)"、"①" 等）
- 页码、页眉页脚、水印、二维码、条形码
- 学生笔迹、铅笔草稿、涂改痕迹、批改符号
- 任何与几何图形本身无关的数字或文字

## 坐标系约定
- 使用数学平面坐标：x 向右为正，y 向上为正
- 坐标数值范围建议 0~10，保持各点之间的相对位置与原图一致（比例、角度尽量准确）
- 不需要真实单位，只要相对关系正确即可

## 输出格式（严格的纯 JSON，不要任何解释文字、不要 markdown 代码块）
{
  "figure_type": "geometry",
  "points": [
    { "label": "A", "type": "vertex", "position": { "x": 0, "y": 0 } },
    { "label": "B", "type": "vertex", "position": { "x": 4, "y": 0 } },
    { "label": "C", "type": "vertex", "position": { "x": 4, "y": 3 } },
    { "label": "O", "type": "origin", "position": { "x": 0, "y": 0 } }
  ],
  "segments": [
    { "from": "A", "to": "B", "style": "solid", "relation": "normal" },
    { "from": "B", "to": "C", "style": "solid", "relation": "perpendicular" },
    { "from": "C", "to": "A", "style": "solid", "relation": "normal" }
  ],
  "circles": [
    { "cx": 2, "cy": 1.5, "r": 2, "style": "solid" }
  ],
  "coordinate_system": {
    "exists": false,
    "origin": "",
    "x_axis": false,
    "y_axis": false
  },
  "constraints": [
    "AB ⟂ BC",
    "∠ABC = 90°"
  ],
  "geometry_labels": [
    { "text": "4", "x": 2, "y": -0.4, "type": "length" },
    { "text": "30°", "x": 3.4, "y": 0.4, "type": "angle" }
  ],
  "ignored_labels": [
    { "text": "2.5", "x": 8, "y": 9, "type": "text" },
    { "text": "图1", "x": 1, "y": 11, "type": "text" }
  ],
  "rightAngles": [
    { "vertex": "B", "from": "A", "to": "C" }
  ]
}

## 规则
1. 只输出 JSON 对象本身，第一个字符必须是 {，最后一个字符必须是 }。
2. figure_type 必须是 "coordinate" / "geometry" / "geometry_with_coords" 之一，按上文"图形类型判断层"判定；拿不准时用 "geometry"。
3. style 只能是 "solid"、"dashed"、"dotted" 之一，无法判断时用 "solid"。
4. relation 只能是 "normal"、"perpendicular"、"parallel" 之一，无法判断时用 "normal"。
5. 若图中没有圆，circles 用空数组 []；没有几何标注，geometry_labels 用空数组 []；没有需忽略的数字，ignored_labels 用空数组 []；没有直角，rightAngles 用空数组 []；没有约束，constraints 用空数组 []。
6. 坐标轴存在性（coordinate_system.exists）必须严格根据图中是否有画出的坐标轴来判断，且与 figure_type 一致；figure_type 为 "geometry" 时必须为 false。
7. label 用图中实际出现的字母；segments 的 from/to 必须是 points 中存在的 label。
8. 如果裁剪图中没有任何有效几何结构（纯文字或无法识别），输出 {"figure_type":"geometry","points":[],"segments":[],"circles":[],"geometry_labels":[],"ignored_labels":[],"rightAngles":[],"coordinate_system":{"exists":false,"origin":"","x_axis":false,"y_axis":false},"constraints":[]}。
9. 不要虚构原图中不存在的点、线、圆、标注、坐标轴或数字（见"严格还原"与"数字生成规则"）。
10. 如果裁剪图中意外出现了两个或多个几何图形（例如切图时带进了相邻题目的图），只识别【面积最大、最居中的那一个主图形】，忽略其余零碎图形和任何文字/题号。
11. 坐标轴也是线段，但不要添加到 segments 中，只在 coordinate_system 中描述。`

/**
 * 构建 TikZ 代码生成 prompt — 让 VL 模型根据几何图输出 TikZ 源码。
 *
 * 输入：经过 Sharp 净化的几何图（白底黑线，保留几何标注）
 * 输出：TikZ 代码字符串（含 \begin{tikzpicture}）
 */
export const buildTikzGenerationPrompt = () => `你是一个专业的 TikZ 矢量图生成助手。请分析给定的几何图形，生成对应的 TikZ 代码。

## 最高优先级原则：严格还原原图，绝对不要重新设计
你的职责是【复刻原图】，不是【根据题意重画一张更"标准"的图】。
绝对禁止：
- 根据题意 / 数学常识补充原图中没有画出的点、线、坐标轴、辅助线
- 根据数学关系"优化"或"补全"图形
- 用数学推理反推图中未画出的数字或长度

## 图形类型判断（生成前先判断）
在生成 TikZ 之前，先判断原图属于哪一类：

### 类型 A：坐标系 / 函数图
特征：图中真实画出了 x 轴、y 轴、箭头、原点 O，或有函数曲线
→ 绘制完整坐标系

### 类型 B：纯几何示意图
特征：三角形、四边形、圆、辅助线、点 A/B/C 等，图中没有坐标轴
→ **不要添加坐标轴、不要添加数字、不要生成刻度**

### 类型 C：几何图带坐标背景
特征：以几何图形为主，但原图确实画有坐标轴
→ 只保留原图已经画出的坐标轴

判断规则：只有肉眼可见的坐标轴线才算，拿不准当类型 B 处理。

## 通用要求
1. 只输出完整的 TikZ 代码（包含 \\begin{tikzpicture} 和 \\end{tikzpicture}），不要附加任何说明文字。
2. 使用 plain TeX 路径，不要加载额外包（除非绝对必要）。
3. 代码必须完全自包含，缩放比例合适（建议 scale=1 或 scale=0.8）。
4. 所有顶点字母标签（A/B/C/D 等）都必须与原图一致。
5. 实线用 \\draw，虚线用 \\draw[dashed]，圆用 \\draw circle。
6. 使用 \\node 标注顶点字母，位置在点的外部（如 above, below, left, right）。
7. 坐标使用绝对坐标 (x,y)，单位 cm，保持几何关系与原图一致。
8. 直角用 right angle 标记，角度用 arc 路径绘制。

## 坐标轴规则（仅当原图确有坐标轴时才画）
9. 若原图没有坐标轴，绝对不要添加坐标轴、刻度或原点。
10. 若原图有坐标轴，必须遵守中国初中教材习惯：
    - x 轴向右为正、箭头在右端，使用 \\draw[->,thick]
    - y 轴向上为正、箭头在上端，使用 \\draw[->,thick]
    - **x 标签必须放在 x 轴正方向箭头附近**：node[right] {$x$}
    - **y 标签必须放在 y 轴正方向箭头附近**：node[above] {$y$}
    - 绝不允许把 y 放在原点下方
    - 绝不允许出现负方向坐标轴标签（除非原图明确画出）

## 数字规则（严格禁止自动添加）
11. 只保留原图中**真实画出的**数字/长度/角度标注
12. **严格禁止**自动添加：
    - 边长数字（如 3、4、5 等）
    - 坐标值（如刻度数字）
    - 长度标记
    - 角度数字
    - 任何原图中没有的数字

中国初中教材插图默认风格：
- 只有点、线、字母标记
- 没有多余数字
- 没有辅助说明

请直接输出 TikZ 代码，不要加 \`\`\` 代码块标记。`
