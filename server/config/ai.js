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

export const RETRY_DELAYS_429 = [5000, 10000, 20000] // 429 限流最多重试 3 次，间隔递增
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

// 按「模型 + 自然日」记录配额耗尽，避免整轮解析反复撞同一个已耗尽的模型
const _modelExhaustedDate = new Map()

function today() {
  return new Date().toISOString().slice(0, 10)
}

function markModelExhaustedToday(model) {
  if (!model || _modelExhaustedDate.get(model) === today()) return
  _modelExhaustedDate.set(model, today())
  console.warn(`[AI] 模型 ${model} 当日配额已用尽，今日不再使用，自动切换其他模型`)
}

export function isModelExhaustedToday(model) {
  return Boolean(model) && _modelExhaustedDate.get(model) === today()
}

async function postWith429Retry(client, endpoint, body, axiosOptions, { retry429 = true, retry503 = true } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await withAiLimit(() => client.post(endpoint, body, axiosOptions))
      notifyAiSuccess()
      return response
    } catch (err) {
      const status = err.response?.status
      // 配额耗尽：立刻放弃该模型并上抛，让调用方换模型，绝不浪费时间重试
      if (status === 429 && isQuotaExhaustedError(err)) {
        markModelExhaustedToday(body?.model)
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

export const VL_MODELS = [...new Set([
  process.env.AI_MODEL,
  process.env.VL_MODEL,
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-VL-30B-A3B-Instruct',
].filter(Boolean))]

export const TEXT_MODELS = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-8B-Instruct',
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
    name: 'Agnes',
    envKey: 'AGNES_API_KEY',
    endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
    textModel: 'agnes-1.5-flash',
    vlModels: ['agnes-1.5-flash', 'gpt-4o-mini', 'Qwen/Qwen3-VL-8B-Instruct', 'Qwen2.5-VL-7B-Instruct'],
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
}) {
  const headers = vendor ? buildVendorHeaders(vendor, apiKey) : {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  const response = await postWith429Retry(
    vendor ? backupAxios : axios,
    endpoint,
    {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
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

  const callMainProvider = (vlModel) => async () => {
    const content = await requestOpenAIProvider({
      endpoint: AI_CONFIG.ENDPOINT,
      apiKey: AI_CONFIG.API_KEY,
      model: vlModel,
      messages,
      temperature,
      maxTokens,
      timeout: AI_CONFIG.TIMEOUT,
      retry429: true,
    })
    return { content, usedBackup: false }
  }

  // 主站按 VL_MODELS 顺序全部尝试：单个模型当日配额用尽时自动换下一个。
  // 历史实现只用 getCurrentVLModel()，从不轮换，8B 配额一用尽整册就全灭。
  const mainModels = (model ? [model] : VL_MODELS).filter(m => !isModelExhaustedToday(m))
  const mainSkippedByCooldown = Boolean(AI_CONFIG.API_KEY) && isMainRateLimitedToday()

  if (!mainSkippedByCooldown && AI_CONFIG.API_KEY) {
    for (const vlModel of mainModels) providers.push(callMainProvider(vlModel))
  }

  // ModelScope 备份 Key（虽然提示需绑定账号，但有些环境可能可用）
  if (MODELSCOPE_BACKUP.ENABLED) {
    providers.push(async () => {
      const content = await requestOpenAIProvider({
        endpoint: MODELSCOPE_BACKUP.ENDPOINT,
        apiKey: MODELSCOPE_BACKUP.API_KEY,
        model: model || MODELSCOPE_BACKUP.MODEL,
        messages,
        temperature,
        maxTokens,
        timeout: BACKUP_TIMEOUT,
        retry503: false,
      })
      return { content, usedBackup: true }
    })
  }

  // Agnes 视觉兜底
  for (const vendor of BACKUP_CONFIG.VENDORS) {
    for (const vlModel of vendor.vlModels) {
      providers.push(async () => {
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
        })
        return { content, usedBackup: true }
      })
    }
  }

  // 最后兜底：所有备份都不可用时，等主模型冷却结束再重试（最多 2 轮）。
  // 备份提供商经常整体不可用（401/503），主模型是唯一出路，绝不能因一次瞬时限流就放弃整页。
  // 无条件加入：既覆盖「进入时已被冷却跳过」，也覆盖「本次调用中主模型 429 耗尽后才触发冷却」。
  if (AI_CONFIG.API_KEY) {
    for (let round = 0; round < 2; round += 1) {
      providers.push(async () => {
        // 重新过滤：本次调用过程中可能又有模型被判定为配额耗尽
        const usable = (model ? [model] : VL_MODELS).filter(m => !isModelExhaustedToday(m))
        if (!usable.length) throw new Error('所有视觉模型当日配额均已用尽，请明日再试或配置其他模型')
        const waitMs = Math.max(0, _mainRateLimitedUntil - Date.now())
        if (waitMs > 0) {
          console.warn(`[AI] 备份不可用，等待 ${Math.ceil(waitMs / 1000)}s 主模型冷却结束后重试（第 ${round + 1} 轮兜底）`)
          await sleep(waitMs)
        }
        let err = null
        for (const vlModel of usable) {
          try {
            return await callMainProvider(vlModel)()
          } catch (e) {
            err = e
          }
        }
        throw err
      })
    }
  }

  let lastError = null
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
    }
  }

  throw lastError || new Error('All vision AI providers failed')
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
4. 如果题目无法识别，不要编造内容。`

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
