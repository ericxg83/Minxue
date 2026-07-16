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

export const RETRY_DELAYS_429 = [5000]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const _aiLimit = parseInt(process.env.AI_CONCURRENCY || '4', 10)
let _aiActive = 0
const _aiWaiters = []

function _acquireAiSlot() {
  if (_aiActive < _aiLimit) {
    _aiActive += 1
    return Promise.resolve()
  }
  return new Promise(resolve => _aiWaiters.push(resolve))
}

function _releaseAiSlot() {
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

async function postWith429Retry(client, endpoint, body, axiosOptions, { retry429 = true } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withAiLimit(() => client.post(endpoint, body, axiosOptions))
    } catch (err) {
      const status = err.response?.status
      if (retry429 && status === 429 && attempt < RETRY_DELAYS_429.length) {
        const delay = RETRY_DELAYS_429[attempt]
        console.warn(`[AI] 429 rate limit, retrying in ${delay / 1000}s (${attempt + 1}/${RETRY_DELAYS_429.length})`)
        await sleep(delay)
        continue
      }
      throw err
    }
  }
}

let _mainRateLimitedDate = null

function markMainRateLimited() {
  _mainRateLimitedDate = new Date().toISOString().slice(0, 10)
}

export function isMainRateLimitedToday() {
  return _mainRateLimitedDate === new Date().toISOString().slice(0, 10)
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
    vlModels: ['agnes-1.5-flash'],
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
    { retry429 },
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
    try {
      const content = await requestOpenAIProvider({
        endpoint: AI_CONFIG.ENDPOINT,
        apiKey: AI_CONFIG.API_KEY,
        model: model || getCurrentTextModel(),
        messages,
        temperature,
        maxTokens,
        timeout: 30000,
        retry429: false,
      })
      if (content) return { content, usedBackup: false }
    } catch (err) {
      if (err.response?.status === 429) markMainRateLimited()
      const status = err.response?.status
      if (!status && AI_CONFIG.API_KEY) throw err
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

  const providers = []

  if (!isMainRateLimitedToday() && AI_CONFIG.API_KEY) {
    providers.push(async () => {
      const content = await requestOpenAIProvider({
        endpoint: AI_CONFIG.ENDPOINT,
        apiKey: AI_CONFIG.API_KEY,
        model: model || getCurrentVLModel(),
        messages,
        temperature,
        maxTokens,
        timeout: AI_CONFIG.TIMEOUT,
        retry429: false,
      })
      return { content, usedBackup: false }
    })
  }

  if (MODELSCOPE_BACKUP.ENABLED) {
    providers.push(async () => {
      const content = await requestOpenAIProvider({
        endpoint: MODELSCOPE_BACKUP.ENDPOINT,
        apiKey: MODELSCOPE_BACKUP.API_KEY,
        model: model || MODELSCOPE_BACKUP.MODEL,
        messages,
        temperature,
        maxTokens,
        timeout: AI_CONFIG.TIMEOUT,
      })
      return { content, usedBackup: true }
    })
  }

  for (const vendor of BACKUP_CONFIG.VENDORS) {
    for (const vlModel of vendor.vlModels) {
      providers.push(async () => {
        const content = await requestOpenAIProvider({
          endpoint: vendor.endpoint,
          apiKey: process.env[vendor.envKey] || '',
          model: model || vlModel,
          messages,
          temperature,
          maxTokens,
          timeout: AI_CONFIG.TIMEOUT,
          vendor,
        })
        return { content, usedBackup: true }
      })
    }
  }

  // Agnes 视觉兜底
  const AGNES_KEY = process.env.AGNES_API_KEY
  if (AGNES_KEY) {
    providers.push(async () => {
      const content = await requestOpenAIProvider({
        endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
        apiKey: AGNES_KEY,
        model: 'agnes-1.5-flash',
        messages,
        temperature,
        maxTokens: Math.min(maxTokens, 4096),
        timeout: AI_CONFIG.TIMEOUT,
        vendor: { name: 'Agnes', referer: null },
      })
      return { content, usedBackup: true }
    })
  }

  let lastError = null
  for (const provider of providers) {
    try {
      const result = await provider()
      if (result.content) return result
      lastError = new Error('AI returned empty content')
    } catch (err) {
      if (err.response?.status === 429 && !isMainRateLimitedToday()) {
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
