import axios from 'axios'
import { createRateLimiter } from '../utils/aiRateLimiter.js'

// 全局禁用 HTTPS_PROXY/HTTP_PROXY 等系统代理：环境里若设置了不可达的代理（如沙箱代理），
// axios 默认会走它，导致 AI 请求出现 "400 The plain HTTP request was sent to HTTPS port"
// 或被代理 IP 触发 ModelScope 限流（429）。OSS/前端走的是浏览器/独立代理，与这里无关。
// 显式 proxy:false 之后 AI 调用直连对应供应商，正常返回 200/4xx。
// axios 0.27+ 默认尊重 process.env.proxy，0.22 同样。这里覆盖一次即可。
const proxyOff = { proxy: false, httpsAgent: false, httpAgent: false }
const axiosNoProxy = axios.create({ ...proxyOff, timeout: 120000 })
const backupAxios = axios.create({ ...proxyOff, timeout: 60000 })

export const AI_CONFIG = {
  get ENDPOINT() {
    return process.env.AI_ENDPOINT || 'https://api-inference.modelscope.cn/v1/chat/completions'
  },
  get API_KEY() {
    return process.env.AI_API_KEY || ''
  },
  get MODEL() {
    return process.env.AI_MODEL || 'Qwen/Qwen3.8-27B'
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
//   1) 真·额度耗尽（quota/credit/balance 用完、SenseNova 5h frequency limit）
//      ——重试到重置前也没用，唯一出路是换 Key / 换模型
//   2) 瞬时并发限流（HTTP 429 "Too Many Requests"、裸 "rate limit"、"retry after"）
//      ——退避重试有效，**绝不能按额度耗尽处理**，否则会把主模型拉黑一整天
//   3) 按分钟/秒的速率配额打满（`tpm exhausted` / `rpm limit`）—— 同上，属瞬时限流。
//      SenseNova 官方口径：高峰期出现 429 是正常现象，退避重试即可。
// 事故复盘（2026-09-04）：旧正则把 `too many requests` 也算额度耗尽，SenseNova
// 深度并发一次瞬时限流就把 deepseek-v4-pro 按「Key + 模型 + 自然日」拉黑，
// 全天 12/19 题降级到 glm-5.2 兜底。收紧匹配面，让"是否重试"由错误消息决定。
// ③ 按分钟/秒的速率配额（TPM/RPM/QPS）。官方口径：高峰期出现 429 属正常现象，
//    退避重试即可恢复。**必须排除在"额度耗尽"之外** —— 实测 2026-09-16：
//    SenseNova 返回 `tpm exhausted`，被下面正则里的裸词 `exhausted` 抓成"额度耗尽"，
//    于是整把 Key 被冷却 5 小时，答案引擎全线降级到弱模型（额度池当时是满的）。
const TRANSIENT_RATE_LIMIT_RE = /\b(tpm|rpm|qpm|qps|tps)\b[\s\S]{0,24}?(exhausted|exceeded|limit|rate)|too\s*many\s*requests|retry[\s_-]*after/i
// 明确指向"积分/余额/信用"的字样：出现任一个就不算瞬时限流
const QUOTA_WORD_RE = /quota|credit|balance|insufficient|out\s+of|no\s+credit/i

// ── 「按分钟窗」还是「按天」：以 Google 官方 quotaId 为准 ──────────────────────
// 2026-09-19 实测两组真实报文（同一 metric 名，靠 quotaId 才能区分）：
//   分钟窗：quotaId=GenerateRequestsPerMinutePerProjectPerModel-FreeTier, limit=15
//   按天  ：quotaId=GenerateRequestsPerDayPerProjectPerModel-FreeTier,    limit=20
// ⚠️ 千万别用 body 里的「Please retry in 12.3s」当判据 —— 实测**按天的配额耗尽也会给秒级提示**，
//    据此判成"瞬时限流"会让通道每 65s 重试一次却整天不可能成功（还白白烧掉重试预算）。
const QUOTA_FAILURE_TYPE = 'QuotaFailure'

/** 取 Google QuotaFailure 明细里的 quotaId 列表（唯一可靠的窗口/按天区分依据） */
export function quotaViolationIds(err) {
  const details = err?.response?.data?.error?.details
  if (!Array.isArray(details)) return []
  const ids = []
  for (const d of details) {
    if (typeof d?.['@type'] !== 'string' || !d['@type'].includes(QUOTA_FAILURE_TYPE)) continue
    for (const v of (Array.isArray(d.violations) ? d.violations : [])) {
      const id = String(v?.quotaId || '')
      if (id) ids.push(id)
    }
  }
  return ids
}

export function isQuotaExhaustedError(err) {
  const data = err?.response?.data
  const msg = data?.error?.message || data?.message || (typeof data === 'string' ? data : '') || ''
  if (!msg) return false
  if (TRANSIENT_RATE_LIMIT_RE.test(msg) && !QUOTA_WORD_RE.test(msg)) return false
  // ① 有官方 quotaId → 以它为准（最可靠）：
  //    PerDay → 当日额度真的耗尽（该换供应商/等明天）；PerMinute → 窗口限流（退避重试即可）
  const ids = quotaViolationIds(err)
  if (ids.length) return ids.some(id => /PerDay/i.test(id))
  // ② 无 quotaId（非 Google 系供应商）→ 退回文案判据
  return /exceeded[^.]*quota|quota[^.]*exceeded|quota.*limit|daily.*limit|out of quota|insufficient.*quota|balance.*insufficient|insufficient.*balance|exhausted|credit.{0,12}(exhausted|insufficient)|no.{0,8}credit|reject_no_credit|frequency\s*limit|usage.{0,12}exceeded/i.test(msg)
}

// 瞬时限流：状态 429 且不匹配上面的额度耗尽字样。调用方应做退避重试而不是冷却。
export function isTransientRateLimit(err) {
  return err?.response?.status === 429 && !isQuotaExhaustedError(err)
}

// 给 AnswerEngine 日志用的分类标签。让「一次 429 到底为什么」肉眼可读，
// 免得又出现「所有 pro 静默降级到 glm 却查不到根因」这种事故。
function classifyAnswerEngineError(err) {
  const status = err?.response?.status
  if (status === 429) return isQuotaExhaustedError(err) ? '429-quota-exhausted' : '429-transient-rate-limit'
  if (status) return `${status}`
  return err?.code || err?.name || 'unknown'
}

// 只取供应商返回的错误消息前 200 字，不含 Key、不含请求正文。
function extractErrorSnippet(err) {
  const data = err?.response?.data
  const raw = (data && typeof data === 'object')
    ? (data?.error?.message || data?.message || JSON.stringify(data))
    : (typeof data === 'string' ? data : (err?.message || ''))
  return String(raw).replace(/\s+/g, ' ').slice(0, 200)
}

// 「Key + 模型 + 冷却到期时间戳」记录该组合已耗尽。用 TTL 而不是自然日，因为：
//   - 魔搭是「账号 × 模型 × 自然日」→ 冷却到 UTC 当日 24 点
//   - SenseNova 是「账号 × 5 小时」→ 冷却到下一个重置点（默认 5h 后自动放行）
//   - 瞬时限流绝不该进这张表（由 isTransientRateLimit 走退避重试路径）
// 冷却到期后自动放行，不需要重启进程。
const _modelExhaustedUntil = new Map() // `${keyTail}|${model}` -> 冷却到期 ms

// 自然日剩余毫秒（ModelScope 的额度重置节奏）
function msUntilEndOfDayUtc() {
  const now = new Date()
  const eod = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  return Math.max(60_000, eod - now.getTime())
}

const keyTail = (apiKey) => String(apiKey || '').slice(-8)

/**
 * 标记某 Key×模型进入冷却。
 * @param {string} apiKey
 * @param {string} model
 * @param {number} [ttlMs] 冷却毫秒；默认到 UTC 当日 24 点（ModelScope 语义）。
 *                        SenseNova 请传 5h。
 */
function markModelExhausted(apiKey, model, ttlMs = msUntilEndOfDayUtc()) {
  if (!model) return
  const scope = `${keyTail(apiKey)}|${model}`
  const until = Date.now() + ttlMs
  const existing = _modelExhaustedUntil.get(scope)
  // 只在延长冷却时打日志，避免同一批次反复撞同一 Key×模型时刷屏
  if (existing && existing >= until) return
  _modelExhaustedUntil.set(scope, until)
  console.warn(`[AI] 模型 ${model}（Key…${keyTail(apiKey)}）配额已用尽，冷却 ${Math.round(ttlMs / 60000)} 分钟`)
}

function isModelExhausted(model, apiKey = AI_CONFIG.API_KEY) {
  if (!model) return false
  const until = _modelExhaustedUntil.get(`${keyTail(apiKey)}|${model}`)
  if (!until) return false
  if (Date.now() >= until) {
    _modelExhaustedUntil.delete(`${keyTail(apiKey)}|${model}`) // 到期即清，防内存爬升
    return false
  }
  return true
}

// 兼容旧调用点的名字（外部仍按自然日语义读的话，TTL 版是它的严格超集）
const isModelExhaustedToday = isModelExhausted
// 兼容旧导出名，worker/脚本里可能有引用
export { isModelExhaustedToday }

// 解析 Retry-After header：可能是秒数（"30"）也可能是 HTTP-date。返回毫秒或 null。
function parseRetryAfterMs(header) {
  if (!header) return null
  const sec = Number(header)
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return null
}

async function postWith429Retry(client, endpoint, body, axiosOptions, {
  retry429 = true,
  retry503 = true,
  exhaustedTtlMs = null, // null → 走 markModelExhausted 的默认（自然日剩余，MS 语义）
  // 429 退避时间表。默认 RETRY_DELAYS_429 = [3s, 5s]（共 8s），适合"稍安勿躁"型限流。
  // ⚠️ Google 免费档是**按分钟**的窗口限流（实测 flash 系列 5 RPM），8s 退避必然撞墙 ——
  //    必须跨过整个分钟窗才有意义，故 Gemini 直连通道显式传自己的时间表（见 GEMINI_DIRECT.RETRY_429_DELAYS）。
  retry429Delays = RETRY_DELAYS_429,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await withAiLimit(() => client.post(endpoint, body, axiosOptions))
      notifyAiSuccess()
      return response
    } catch (err) {
      const status = err.response?.status
      const auth = String(axiosOptions?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
      // 诊断：详细记录 400 错误（通常提示 prompt 过长 / 图片超限 / 字段格式错误）
      if (status === 400) {
        const body = err.response?.data
        const dataSize = JSON.stringify(body).length
        const imgSize = body?.messages?.[1]?.content?.find?.(c => c.type === 'image_url')?.image_url?.url?.length || 0
        console.error(`[AI] 400 bad request:`,
          `endpoint=${endpoint}`,
          `keyTail=${auth?.slice(-8)}`,
          `model=${body?.model || '(unknown)'}`,
          `dataSize=${dataSize}B`,
          `imageBase64Size=${imgSize}B`,
          `errorMsg=${body?.error?.message || JSON.stringify(body)?.substring(0, 300)}`)
      }
      // 真·额度耗尽（quota/credit/balance/frequency limit）：立刻放弃该 Key×模型组合并上抛，
      // 让调用方换组合，绝不浪费时间重试。瞬时限流（isTransientRateLimit）走下面的退避。
      if (status === 429 && isQuotaExhaustedError(err)) {
        const auth = String(axiosOptions?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
        markModelExhausted(auth, body?.model, exhaustedTtlMs ?? msUntilEndOfDayUtc())
        throw err
      }
      if (status === 429) notifyAiRateLimited()
      if (retry429 && status === 429 && attempt < retry429Delays.length) {
        // Retry-After 优先：服务端说等几秒就等几秒。
        // 注意：只有当服务端给的等待 ≤ 当前时间表的最大档时才会被采用 —— 否则以本通道
        // 自己的时间表为准（Google 不给 Retry-After，只在 body 里写 "Please retry in 46.6s"）。
        const header = err.response?.headers?.['retry-after']
        const raMs = parseRetryAfterMs(header)
        const maxScheduled = Math.max(...retry429Delays)
        const delay = (raMs != null && raMs <= maxScheduled)
          ? Math.max(500, raMs)
          : retry429Delays[attempt]
        console.warn(`[AI] 429 transient rate limit, retrying in ${Math.round(delay / 1000)}s (${attempt + 1}/${retry429Delays.length})${header ? ' [Retry-After]' : ''}`)
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
//   _modelExhaustedUntil 按模型单独 TTL 处理，不走这里。）
const MAIN_RATE_LIMIT_COOLDOWN_MS = 60 * 1000
let _mainRateLimitedUntil = 0

function markMainRateLimited() {
  _mainRateLimitedUntil = Date.now() + MAIN_RATE_LIMIT_COOLDOWN_MS
  console.warn(`[AI] 主模型限流，冷却 ${MAIN_RATE_LIMIT_COOLDOWN_MS / 1000}s 后自动恢复`)
}

export function isMainRateLimitedToday() {
  return Date.now() < _mainRateLimitedUntil
}

// 2026-09-15 重大变更：魔搭把 Qwen3-VL 全系下架（235B/8B/8B-Thinking 全部 400
// "has no provider supported"，且两把账号的 /v1/models 清单均已无任何 Qwen3-VL，
// 被 Qwen3.5/Qwen3.8 新系列替代）。旧列表绝不能放回——每次请求都会空轮 3 个死模型。
// 新清单排序依据（2026-09-15 双图×2轮基准，deliverables/bench_vision_3way_20260915_newms.json，
// 生产 OCR 提示词，与 9-13 旧 235B/sensenova 数据同口径对比）：
//   Qwen/Qwen3.5-122B-A10B                      主力：IMG_A 40s（三家最快）、严格 JSON 4/4 轮、
//                                               题数 15/15、坐标 27/30 合法、0 污染、要素命中 7/9（=旧235B）
//   Qwen/Qwen3.8-27B                            第一备份：质量同样好（坐标 30/30 全合法、要素 7/9），
//                                               但 IMG_A 94~131s 最慢
//   Shanghai_AI_Laboratory/Intern-S2-Preview    第二备份：单样本可用，answer 会抄学生答案（P3 闸兜底）
//   ⚠️ Qwen/Qwen3.8-Flash-Next 明确排除：IMG_A 关键要素只命中 4/9，缺根号嵌套/−√6/指数题——
//      有漏抽/识别偏差疑点，且 105~155s 最慢。
// AI_MODEL 环境变量作为队首（Render env 建议同步设为 Qwen/Qwen3.5-122B-A10B）。
export const VL_MODELS = [...new Set([
  process.env.AI_MODEL,
  process.env.VL_MODEL,
  'Qwen/Qwen3.5-122B-A10B',
  'Qwen/Qwen3.8-27B',
  'Shanghai_AI_Laboratory/Intern-S2-Preview',
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

export const BACKUP_VENDOR_DEFS = [
  {
    // SenseNova（商汤科技日日新，OpenAI 兼容）：第一备用供应商（2026-08 起排第二，仅次于魔搭）。
    // 2026-08 用户 Key 实测（token.sensenova.cn 端点有效）：
    //   - sensenova-6.8-flash-lite / sensenova-6.7-flash-lite：多模态（text+image → text），0 计费，均匀可作视觉 OCR
    //   - deepseek-v4-flash / glm-5.2：纯文本，0 计费（文本兜底）
    //   - sensenova-u1-fast / sensenova-u1.5-lite：text→image（文生图），勿用于 OCR
    //   - 该端点与 ZenMux/BigModel/Agnes 独立配额，天然适合作为魔搭耗尽后的首选兜底
    // 必须传 reasoning_effort:'none' 禁用思考模式，否则思考过程太长（3754+ tokens）
    // 导致 max_tokens 耗尽在 reasoning 阶段，永远拿不到 content。
    //
    // 2026-09-04 实测修正：
    //   - 'sensenova-6.7-flash-lite' 已下线，调用返回 404 model route not found，
    //     原值会让 SenseNova 在通用文本链路上整条失效 → 改为实测可用的 6.8-flash-lite。
    //   - 强推理场景（标准答案/解析生成）不要用 6.8-flash-lite：
    //     12 道复杂数学题基准里它只 7/12，DeepSeek V4 Pro 12/12。
    //     那条链路走下面的 ANSWER_ENGINE，不占用这里的 textModel。
    name: 'SenseNova',
    envKey: 'SENSENOVA_API_KEY',
    endpoint: 'https://token.sensenova.cn/v1/chat/completions',
    textModel: 'sensenova-6.8-flash-lite',
    vlModels: ['sensenova-6.8-flash-lite', 'sensenova-6.7-flash-lite'],
    referer: null,
    extraBody: { reasoning_effort: 'none' },
  },
  {
    // 辉辉云「另一组」key 的 gemini 池（2026-09-19 用户提供，**收费，按 token 计费**）：
    // ⚠️ 2026-09-19 用户换分组后模型池变化：3.7-flash / 3.6-flash / 3.1-pro(-preview) 可用，
    //    **gemini-3.8-flash 返回 404 Resource not found**（分组不含该模型，不是限流）。
    //    探测：server/_diag_gemini_pool_probe.mjs（秒级只读）。
    //
    // 选型实测（同题 13 张 A/B，server/_diag_37_vs_38_ab.mjs，报告 _几何重绘-换组归因结论-20260919.md）：
    //   - 能力：3.7-flash 12/13（92.3%；唯一失败是 403 `All available accounts exhausted`
    //     账号池打满，非模型能力）、平均 2.08 轮、标注冒名 0 条（辅助点全带 `_` 前缀）；
    //     3.8-flash 基线 13/13 但平均 ~2.5 轮，且历史批次 80 张里 **273/1003 条（27.2%）
    //     是内部占位符**（P1_left/L1_top/X_min/p_0）⇒ 标注比 3.7 脏，只是当时没有闸门。
    //   - 费用（用户账单）：3.7 = $0.00152/次、$0.270/M token；
    //     3.8 = $0.01970/次、$4.744/M token（即用户口径的「0.02/次」）
    //     ⇒ **3.8 贵 13×（按次）/ 17.6×（按 token），单张题成本 15.6×**。
    //     **结论：留在 3.7-flash，不要切回 3.8 分组。**
    //   - ⚠️ 换组后必须同步改下一行：旧组写 gemini-3.8-flash，新组写 gemini-3.7-flash，
    //     写错整条链 404（**配置与分组必须成对改**）。
    // 视觉 DSL 生成 92%+、2-20s/次、执行错误码 0——几何重绘 DSL 通道主力，
    // 也是 OCR/视觉识别的高质量后备。
    // ⚠️ 收费池：默认排在 SenseNova 之后（免费通道耗尽才触发）；魔搭恢复后仍是免费主力。
    //    不想自动消耗时删掉本段或清空 HUIHUIYUN_GEMINI_API_KEY 即可。
    name: 'HuihuiyunGemini',
    envKey: 'HUIHUIYUN_GEMINI_API_KEY',
    endpoint: 'https://api.huihuiyun.top/v1/chat/completions',
    vlModels: ['gemini-3.7-flash', 'gemini-3.1-pro'],
    maxTokens: 16384,
    referer: null,
    extraBody: null,
  },
  {
    // 阿里云百炼「Token Plan」（token-plan.cn-beijing.maas.aliyuncs.com）：OpenAI 兼容。    // 2026-09-16 接入：SenseNova 是「账号级 RPM」，白天被线上批改占满，本机/备用拿不到 pro；
    // 百炼 Token Plan 的 deepseek-v4-pro 是独立额度（sk-sp- Key 必须配套 token-plan 域名，
    // 打通用 dashscope 地址会 401 —— 见 skill「敏学练习册解析中断排查」）。
    // 实测：卷面第5题 5.4s 返回「3」（正确），277 tokens。
    // ⚠️ 该池是用户付费额度，只作答案引擎的**显式主供应商**（ANSWER_ENGINE_VENDOR=Bailian），
    //    不要默认加进 FALLBACK_VENDORS 自动消耗。
    name: 'Bailian',
    envKey: 'BAILIAN_API_KEY',
    endpoint: process.env.BAILIAN_BASE_URL
      ? `${process.env.BAILIAN_BASE_URL.replace(/\/+$/, '')}/chat/completions`
      : 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    textModel: 'deepseek-v4-pro',
    vlModels: [],
    referer: null,
    extraBody: null,
  },
  {
    // 辉辉云聚合网关（api.huihuiyun.top）：OpenAI 兼容中转。
    // 2026-09-13 首次接入，原因：官方 SenseNova Key 已 429 打满（tpm/rpm exhausted），
    //   魔搭限流后第一备用供应商实际是断的，此通道用于补位。
    //
    // 2026-09-18 换新 Key 后重测（15 个模型全量基准，脚本 server/_diag_hhy_bench.mjs，
    //   完整报告 _辉辉云后备模型选型-20260918.md）：
    //   - ⚠️ 原配置的 sensenova-6.8-flash-lite 已不在账号模型列表中，且实测 **0/20 可调用**
    //     （偶发约 10% 能通 —— 比彻底失效更危险，生产里表现为随机丢页）→ 已换掉。
    //     它同时也是答案引擎兜底的 textModel，一并换掉。
    //   - 账号 15 个模型中**只有 qwen3.8-max 可作视觉后备**：唯一坐标尺度正确（0-1000 归一化；
    //     deepseek-v4-flash-vision-exp / kimi-k3 / glm-5.3-flash 都给 y>1000 非法值），
    //     完整 OCR prompt 下 3/3 页出 JSON，50–80s/页。
    //   - 其余实测均不可用：qwen3.8-flash 空响应、glm-5.3 400、glm-5.2 502、
    //     MiniMax-M3 / qwen3.7-max 报错、minimax-m3 声称看不到图、deepseek-v4-pro 502 + 489s/页。
    //   - ⚠️ 三个接入硬前提，缺一即 100% 失败（qwen3.8-max @4096 实测 0/3 页全空）：
    //     ① extraBody 必须带 reasoning_effort:'none'（否则思考链吃满 max_tokens → content 空）
    //     ② 必须配 maxTokens ≥ 8192 —— 备份路径是 Math.min(maxTokens, vendor.maxTokens || 4096)，
    //        不配就被压到 4096（当年 sensenova 同一个坑）
    //     ③ 备份超时必须 ≥ 120s —— 单页 50–80s，默认 60s 会被掐死（见 BACKUP_VISION_TIMEOUT_MS）
    //   - 能力边界：**只能当「文字 OCR 兜底」，不能当「配图定位兜底」**。配图框 IoU≥0.5 仅 38%
    //     （未降级期魔搭是 100% 有框）；且实测「喂单题区块裁片」与「喂整页」命中率持平
    //     （3/6 vs 3/6），「改用区块裁片补图」这条路已被否证。配图必须靠主 OCR 锁模型解决。
    //   - grok 系列视觉不可用（student_answer 0/15 全空、内容误读），只能用于判题终裁，不进 OCR 链路。
    //   - 模型 id 必须用 /v1/models 返回的完整 id（短名会 404）。
    //   - 域名解析到境外 IP（154.9.255.39），国内直连 http=000 不通；
    //     Render (Oregon) 出站应可直接访问（与 ZenMux 同型），但**尚未在生产实测**。
    // ⚠️ extraBody / maxTokens 是供应商级、不按模型区分。本供应商当前只放 qwen3.8-max
    //    （它恰好同时满足 reasoning_effort:'none' + 大 maxTokens），故暂无冲突；
    //    若将来要在本供应商混配多个模型（如把 grok 加进来，它不接受 reasoning_effort），
    //    必须先改成按模型下发这两个字段。
    //
    // 2026-09-20 换新 Key（sk-30d6...，旧 key sk-ba3... 已 API_KEY_DISABLED）：
    //   /v1/models 实测新分组只有 7 个模型：auto / deepseek-v4-flash / glm-5.2 /
    //   grok-4.5 / grok-4.6 / sensenova-6.8-flash-lite —— **全是文本模型，无 qwen3.8-max**。
    //   ⇒ vlModels 清空（不再承担视觉兜底；文字 OCR 兜底仍由 SenseNova / HuihuiyunGemini 承担），
    //     textModel 保持 deepseek-v4-flash（答案引擎兜底链路实测可用）。
    name: 'Huihuiyun',
    envKey: 'HUIHUIYUN_API_KEY',
    endpoint: process.env.HUIHUIYUN_BASE_URL
      ? `${process.env.HUIHUIYUN_BASE_URL.replace(/\/+$/, '')}/chat/completions`
      : 'https://api.huihuiyun.top/v1/chat/completions',
    textModel: 'deepseek-v4-flash',
    vlModels: [],
    maxTokens: 32768,
    referer: null,
    extraBody: { reasoning_effort: 'none' },
  },
  {
    // ZenMux (https://zenmux.ai)：多模型聚合网关，OpenAI 兼容。
    // 2026-08-13 用户 Key 实测结论（sk-ai-v1- 前缀，账户余额 = 0）：
    //   - 付费视觉模型（xiaomi/mimo-v2.5、qwen/qwen3-vl-plus、google/gemini-2.5-flash）
    //     全部 402 reject_no_credit：账户余额必须 > 0 才可用（反滥用保护，非扣费）。
    //   - 免费视觉 z-ai/glm-4.6v-flash-free：零余额可用、能真正看图（有 429 限流）。
    //   - 免费视觉 sapiens-ai/agnes-2.0-flash：零余额可用、能看图但识别质量差一截。
    //   - 免费文本 z-ai/glm-4.7-flash-free：可用；deepseek/deepseek-v4-flash-free 也要求余额>0。
    // vlModels 顺序：免费 GLM 视觉放最前（零余额即可测）→ 充值后 MIMO/Qwen/Gemini 自动生效。
    // 注意：zenmux.ai 在中国大陆被 GFW 墙（DNS 污染），必须从 Render (Oregon) 出站；
    //      本地开发机若走系统代理可测（curl 需显式 -x 代理）。
    name: 'ZenMux',
    envKey: 'ZENMUX_API_KEY',
    endpoint: 'https://zenmux.ai/api/v1/chat/completions',
    modelsEndpoint: 'https://zenmux.ai/api/v1/models',
    textModel: 'z-ai/glm-4.7-flash-free',
    vlModels: [
      'z-ai/glm-4.6v-flash-free',   // 免费：零余额可用、能看图（限流较凶）
      'xiaomi/mimo-v2.5',           // 需余额>0：用户想试的 MIMO 视觉
      'xiaomi/mimo-v2.5-pro',
      'qwen/qwen3-vl-plus',
      'google/gemini-2.5-flash',
      'sapiens-ai/agnes-2.0-flash', // 免费：能看图，识别质量一般，作最后兜底
    ],
    keyPrefix: 'sk-ai-v1-',
    referer: null,
  },
  {
    // 智谱 BigModel (https://open.bigmodel.cn)：OpenAI 兼容，国内直连（无 GFW 问题）。
    // 2026-08-13 用户 Key 实测结论（账户余额 = 0）：
    //   - 免费文本 glm-4-flash / glm-4.5-flash：可用 ✅（文本兜底首选）
    //   - 免费视觉 glm-4v-flash：可用，但 max_tokens 硬上限 1024 → 长答案页会被截断。
    //     为不触发 1210，本供应商整体 maxTokens 取 1024（见下方 maxTokens 字段）。
    //   - 新品 GLM-5V-Turbo（glm-5v-turbo）：视觉模型存在，但需余额>0（1113），
    //     充值后自动作为首个视觉模型生效；届时 quality 若优于魔搭，可再把
    //     maxTokens 提到 4096（glm-5v-turbo 无 1024 限制），并把魔搭降为第一备用。
    //   - 付费文本 glm-4.5/4.6/4.7/5/5.1/5.2 及视觉 glm-4.5v/glm-4v-plus：需余额（1113）。
    name: 'BigModel',
    envKey: 'BIGMODEL_API_KEY',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    modelsEndpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
    textModel: 'glm-4-flash',
    vlModels: ['glm-5v-turbo', 'glm-4v-flash'],
    maxTokens: 1024, // glm-4v-flash 硬上限；充值后想用 glm-5v-turbo 完整输出可提到 4096
    // 2026-09-18 按模型下发：glm-5v-turbo 无 1024 限制，整页 OCR 需要 ~5000+ 字符。
    // 实测（`_diag_backup_chain.mjs`）glm-5v-turbo 整页返回 5175 字符 / 99.8s；
    // 若被压到 1024，端到端实测只回来 2841 字符且 JSON 在末尾断掉 → 整页失败。
    // 配图定位质量实测 IoU≥0.5 = 75%（比辉辉云 qwen3.8-max 的 38% 更好），是链路上值得保住的兜底。
    vlModelMaxTokens: { 'glm-5v-turbo': 8192 },
    keyPrefix: null, // 智谱 Key 形如 <id>.<secret>，无统一前缀，有 Key 即启用
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

// ── 免费视觉通道白名单（2026-09-20 写入侧补测专用）────────────────────────────
// 用途：`callVisionCompletion({ freeOnly: true })` 时，备份供应商只尝试这里的通道，
// 绝不触碰付费 key（HuihuiyunGemini 按 token 计费、Bailian 付费、Huihuiyun 聚合网关付费等）。
// 依据（config 注释与实测）：
//   · SenseNova sensenova-6.8-flash-lite —— 0 计费，可作视觉 OCR（弱，但量框够用）
//   · ZenMux   z-ai/glm-4.6v-flash-free —— 零余额可用，能看图（429 限流较凶）
//   · ZenMux   sapiens-ai/agnes-2.0-flash —— 零余额可用，识别质量差一截（白名单兜底）
//   · BigModel glm-4v-flash —— 零余额可用，max_tokens 硬上限 1024（量框 JSON 够用）
// 魔搭矩阵（VL_MODELS）本身是免费额度体系，不受 freeOnly 限制。
export const FREE_VL_CHANNELS = [
  { name: 'SenseNova', models: ['sensenova-6.8-flash-lite'] },
  { name: 'ZenMux', models: ['z-ai/glm-4.6v-flash-free', 'sapiens-ai/agnes-2.0-flash'] },
  { name: 'BigModel', models: ['glm-4v-flash'] },
]
export const isFreeVisionChannel = (vendorName, vlModel) =>
  FREE_VL_CHANNELS.some(c => c.name === vendorName && c.models.includes(vlModel))

let _resolvedVendorsCache = null

function getResolvedVendors() {
  if (!_resolvedVendorsCache) _resolvedVendorsCache = resolveBackupVendors()
  return _resolvedVendorsCache
}

/**
 * 备份供应商的 maxTokens 上限 —— 支持**按模型下发**，不再一个供应商一刀切。
 *
 * 背景（2026-09-18 端到端实测）：BigModel 的 `maxTokens: 1024` 是给 `glm-4v-flash`
 * 的硬上限（超了报 1210），但同一个供应商下的 `glm-5v-turbo` 并没有这个限制。
 * 供应商级一刀切的结果是：魔搭耗尽 → 辉辉云 404 → 落到 BigModel 时被压到 1024，
 * 整页 OCR 返回 ~2800 字符就被截断，JSON 在末尾断掉 → 整页识别失败。
 * 这正是「参数不匹配导致后备 100% 失败」这一类坑，与 maxTokens 未配时的 4096 同源。
 *
 * 优先级：vlModelMaxTokens[模型] > vendor.maxTokens > 4096（沿用原有兜底语义）。
 */
function backupModelMaxTokens(vendor, vlModel, maxTokens) {
  const cap = (vendor?.vlModelMaxTokens || {})[vlModel] || vendor?.maxTokens || 4096
  return Math.min(maxTokens, cap)
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

export const GEMINI_DIRECT = {
  get API_KEY() {
    // ⚠️ 2026-09-19：Render 上这把 key 曾被命名为 MODEL_GIMINI，而代码只认下面两个名字
    //    → GEMINI_DIRECT.ENABLED === false → 本文件里整段 Gemini 兜底被**静默跳过**，
    //    不报任何错，表现为"配了 key 但完全没用上"。这里兼容该别名，避免再踩。
    return process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.MODEL_GIMINI
      || ''
  },
  get ENABLED() {
    // ⛔ 2026-09-19 决策：**整条原生 Gemini 通道默认关闭**，几何重绘继续由辉辉云承担。
    //    依据（实测）：Google 免费档配额是「按项目 × 按模型 × 按天」，
    //    gemini-3.8-flash 只有 **20 次/天**（quotaId=GenerateRequestsPerDayPerProjectPerModel-FreeTier）。
    //    DSL 闭环每张图约 2.5 次视觉调用 → 每天最多 ~8 张图；105 张存量回填需 ~13 天。
    //    稳态量 4–20 张/天，覆盖不了上限 → 不足以当几何专用通道。
    //    改为**显式开启**，避免配了 key 就被静默接管（也避免悄悄消耗 20/天的额度）。
    //    想启用：设 GEMINI_DIRECT_ENABLED=1（并确认已配 GEMINI_API_KEY / GOOGLE_API_KEY / MODEL_GIMINI）。
    if (!this.API_KEY) return false
    return /^(?:1|true|on|yes)$/i.test(String(process.env.GEMINI_DIRECT_ENABLED || ''))
  },
  // ⚠️ 2026-09-19 实测：原写死的 gemini-2.5-flash 对**新用户已下架**，调用返回 404
  //    「no longer available to new users. Please update your code to use models/gemini-3.6-flash」。
  //    即 key 配对了、模型名不对，Gemini 直连依然全废（且 404 被 try/catch 吞掉，日志里看不到）。
  //    现改为 env 可配，换模型不必再改代码；默认取 gemini-3.8-flash
  //    （与辉辉云基线同模型，几何 DSL 实测 19/20 = 95%）。
  get MODEL() {
    return process.env.GEMINI_DIRECT_MODEL || 'gemini-3.8-flash'
  },
  // base URL 可覆盖（与 HUIHUIYUN_BASE_URL / BAILIAN_BASE_URL 同一约定）：
  // 便于本地用 mock server 端到端验证请求体，而不必真的出网。
  get BASE_URL() {
    return (process.env.GEMINI_DIRECT_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')
  },
  get ENDPOINT() {
    return `${this.BASE_URL}/v1beta/models/${this.MODEL}:generateContent`
  },
  // 免费档实测 flash 系列 5 RPM / lite 系列 15 RPM。取 4（留 20% 余量）压住 429。
  // 配额按 project+model 计，故本通道所有调用共用同一个限流器。
  get RPM() {
    const v = Number(process.env.GEMINI_DIRECT_RPM)
    return Number.isFinite(v) && v > 0 ? v : 4
  },
  // 思考预算：**默认不下发**（null）。
  // ⚠️ 2026-09-19 实测：`gemini-3.5-flash-lite` 收到 `thinkingConfig.thinkingBudget` 直接
  //    返回 **400 INVALID_ARGUMENT**（同一请求去掉该字段即 200 OK）。各模型对 thinkingConfig
  //    的支持面并不一致，无条件下发会把整条通道打挂 —— 所以改为**显式开启才下发**。
  // 需要时设 GEMINI_DIRECT_THINKING_BUDGET=0（关思考）/-1（动态）/正整数。
  get THINKING_BUDGET() {
    const raw = process.env.GEMINI_DIRECT_THINKING_BUDGET
    if (raw === undefined || raw === '') return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  },
  // 429 退避时间表。Google 免费档是**按分钟**的窗口限流，默认的 [3s,5s]（共 8s）必然撞墙
  // （实测：46.6s 的 retry 提示、短退避全部失败）。默认单次 65s（跨整窗 + 余量）。
  // 设 GEMINI_DIRECT_RETRY_WAIT_MS=0 可退回默认短退避。
  get RETRY_429_DELAYS() {
    const v = Number(process.env.GEMINI_DIRECT_RETRY_WAIT_MS)
    const ms = Number.isFinite(v) && v >= 0 ? v : 65000
    return ms > 0 ? [ms] : RETRY_DELAYS_429
  },
  // 视觉输出的 maxOutputTokens 下限。几何 DSL 产物可达数千字符，
  // 调用方常传 3072 → 一旦被思考或长输出吃满就是"空正文"失败。这里兜到 8192。
  get MIN_VISION_MAX_TOKENS() {
    const v = Number(process.env.GEMINI_DIRECT_MIN_MAX_TOKENS)
    return Number.isFinite(v) && v > 0 ? v : 8192
  },
}

// 通道级令牌桶（惰性创建，读取 env 的时机与其它 getter 一致）
let _geminiLimiter = null
let _geminiLimiterRpm = null
function geminiLimiter() {
  const rpm = GEMINI_DIRECT.RPM
  if (!_geminiLimiter || _geminiLimiterRpm !== rpm) {
    _geminiLimiter = createRateLimiter({ perMinute: rpm, burst: 1 })
    _geminiLimiterRpm = rpm
  }
  return _geminiLimiter
}

/** 从 data URL 解析真实 MIME 与 base64。别硬编码 image/jpeg —— 几何裁片是 PNG。 */
export function splitDataUrl(dataUrl) {
  const s = String(dataUrl || '')
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(s)
  if (m) return { mime: m[1], data: m[2] }
  return { mime: 'image/png', data: s.replace(/^data:[\w/+.-]+;base64,/, '') }
}

// ⚠️ 绝不要在 content 为空时回退到 message.reasoning / reasoning_content。
// 思考模型（如 Qwen/Qwen3-VL-8B-Thinking）在 max_tokens 耗尽于推理阶段时，
// content 为空而 reasoning 里是思维链原文（"用户现在需要识别作业……"）。
// 把它当正文返回会造成两个后果：
//   1. 下游 JSON.parse 必然失败；
//   2. 更糟的是把「AI 返回内容为空」（在非重试黑名单内，会被正确放弃）
//      伪装成「JSON 格式错误」（不在黑名单内，会被反复重试到 retry_count 耗尽）。
// content 为空就返回空，让上层 callVisionCompletion 换下一个 provider。
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
  // 命中真·额度耗尽时，该 Key×模型冷却多久。默认由 postWith429Retry 用「自然日剩余」，
  // 匹配 ModelScope 的账号×模型×日 配额。SenseNova 5h 窗口 / 其它短周期请显式传。
  exhaustedTtlMs = null,
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
    vendor ? backupAxios : axiosNoProxy,
    endpoint,
    body,
    { headers, timeout, proxy: false },
    { retry429, retry503, exhaustedTtlMs },
  )

  return extractContent(response.data?.choices?.[0]?.message)
}

async function requestGeminiText({ systemContent, userContent, temperature, maxTokens }) {
  // 通道侧限速：配额按 project+model 计，与视觉调用共用同一份额度
  await geminiLimiter().acquire()
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
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(GEMINI_DIRECT.THINKING_BUDGET === null
            ? {}
            : { thinkingConfig: { thinkingBudget: GEMINI_DIRECT.THINKING_BUDGET } }),
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: AI_CONFIG.TIMEOUT,
        proxy: false,
      },
      { retry429: true, retry429Delays: GEMINI_DIRECT.RETRY_429_DELAYS },
    )

  return response.data?.candidates?.[0]?.content?.parts
    ?.filter(part => part?.thought !== true)
    .map(part => part?.text || '').join('') || ''
}

async function requestGeminiVision({ systemPrompt, userText, imageDataURL, temperature, maxTokens }) {
  // 通道侧限速（见 GEMINI_DIRECT.RPM 注释）
  await geminiLimiter().acquire()
  // 真实 MIME 从 data URL 解析 —— 原代码硬编码 image/jpeg，而几何裁片是 PNG。
  // 标错 MIME 会让上游按 JPEG 解码 PNG 字节（可能 400 / 识别质量下降）。
  const { mime, data } = splitDataUrl(imageDataURL)
  // 输出预算兜底：调用方常传 3072，几何 DSL 产物可达数千字符，吃满即"空正文"失败
  const outputBudget = Math.max(Number(maxTokens) || 0, GEMINI_DIRECT.MIN_VISION_MAX_TOKENS)
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
                mime_type: mime,
                data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: outputBudget,
        ...(GEMINI_DIRECT.THINKING_BUDGET === null
          ? {}
          : { thinkingConfig: { thinkingBudget: GEMINI_DIRECT.THINKING_BUDGET } }),
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: AI_CONFIG.TIMEOUT,
      proxy: false,
    },
    { retry429: true, retry429Delays: GEMINI_DIRECT.RETRY_429_DELAYS },
  )

  // 必须剔除 thought 分片：思考内容是思维链原文，混进正文会让下游 JSON.parse 必然失败
  return response.data?.candidates?.[0]?.content?.parts
    ?.filter(part => part?.thought !== true)
    .map(part => part?.text || '').join('') || ''
}

export async function callTextCompletion(opts) {
  const { systemContent, userContent, temperature = 0.2, maxTokens = 500, model, preferredVendor } = opts
  const messages = buildOpenAIMessages(systemContent, userContent)

  // ── 指定「优先厂商」────────────────────────────────────────────────────────
  // 回填等场景用：本地实测常规降级链会先空耗 ~20s 等 Gemini 超时、再撞魔搭/SenseNova
  // 的 429 重试；指定可用厂商（如 BigModel，免费且 ~3s/条）后先直连它，成功即返回。
  // 指定厂商失败则静默回落常规链，不阻断。
  if (preferredVendor) {
    const pv = BACKUP_CONFIG.VENDORS.find(
      v => v.name.toLowerCase() === String(preferredVendor).trim().toLowerCase()
    )
    if (pv) {
      try {
        const content = await requestOpenAIProvider({
          endpoint: pv.endpoint,
          apiKey: process.env[pv.envKey] || '',
          model: model || pv.textModel,
          messages,
          temperature,
          maxTokens,
          timeout: AI_CONFIG.TIMEOUT,
          vendor: pv,
          extraBody: pv.extraBody || null,
        })
        if (content) return { content, usedBackup: true, vendor: pv.name }
      } catch {
        // 回落常规降级链
      }
    }
  }

  // GMI_FIRST=1 时把 GMI 顶到最前作为"主 KEY"。
  // 10 天免费期内避免触发魔搭限流；失效后改 0 即可回落，与视觉链共用同一开关。
  const gmiFirst = process.env.GMI_FIRST === '1'
  const gmiVendor = gmiFirst ? BACKUP_CONFIG.VENDORS.find(v => v.name === 'GMI' && process.env[v.envKey]) : null
  if (gmiVendor) {
    try {
      const content = await requestOpenAIProvider({
        endpoint: gmiVendor.endpoint,
        apiKey: process.env[gmiVendor.envKey] || '',
        model: model || gmiVendor.textModel,
        messages,
        temperature,
        maxTokens,
        timeout: 30000,
        retry429: false,
        vendor: gmiVendor,
        extraBody: gmiVendor.extraBody || null,
      })
      if (content) return { content, usedBackup: true }
    } catch {
      // GMI 失败回落到下方魔搭 / 其它供应商
    }
  }

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
        // ⚠️ 必须传 vendor.extraBody：Huihuiyun(sensenova-6.8-flash-lite) 不带
        //    reasoning_effort:'none' 会 100% 失败（思考链吃满 max_tokens，正文吐不出来）。
        extraBody: vendor.extraBody || null,
      })
      if (content) return { content, usedBackup: true }
    } catch {
      // fall through
    }
  }

  throw new Error('All text AI providers failed')
}

/**
 * ── 答案引擎（Answer Engine）────────────────────────────────────────────────
 * 职责切分：视觉模型只负责「看懂卷面」，标准答案与解析由专门的强推理文本模型产出。
 *
 * 依据（2026-09-04 实测，deliverables/complex_model_benchmark_report_20260904.md）：
 *   12 道中学数学复杂题基准 —— DeepSeek V4 Pro 12/12 · GLM-5.2 9/12 · SenseNova 6.8 7/12
 *   DeepSeek 同时 token 最省（2,398 vs 2,476 vs 2,741）。
 *   视觉模态实测：deepseek-v4-pro 明确返回 400「Model do not support image input」，
 *   所以它只能做文本，不能替代 OCR —— 这也是必须拆成两段式的原因。
 *
 * 与 callTextCompletion 的区别：callTextCompletion 会先打 GMI/MiniMax、再打魔搭、
 * 再走备用供应商，对「指定模型」是低效且不可控的（指定模型在前几站基本必失败）。
 * 答案引擎直连目标供应商 + 指定模型，失败后按 FALLBACK_MODELS 降级，
 * 全部失败才回落到通用文本链路，保证不阻塞批改。
 *
 * 关闭/回滚：ANSWER_ENGINE_ENABLED=0 → 完全退回改造前的 callTextCompletion 行为。
 */
export const ANSWER_ENGINE = {
  ENABLED: process.env.ANSWER_ENGINE_ENABLED !== '0',
  VENDOR: process.env.ANSWER_ENGINE_VENDOR || 'SenseNova',
  MODEL: process.env.ANSWER_ENGINE_MODEL || 'deepseek-v4-pro',
  FALLBACK_MODELS: (process.env.ANSWER_ENGINE_FALLBACK_MODELS || 'glm-5.2,sensenova-6.8-flash-lite')
    .split(',').map(s => s.trim()).filter(Boolean),
  // 主供应商（Key 池 × FALLBACK_MODELS）全部失败后、回落通用文本链路之前，
  // 再试这些**备用供应商**（各自用自己的 Key 与 textModel，互不影响主供应商配额）。
  // 2026-09-16 接入 Huihuiyun：SenseNova 高峰期 rpm 限流时，用免费的 sensenova-6.8-flash-lite
  // 顶上，避免掉进通用文本链路（实测会给出错误答案，如选择题答非所问）。
  FALLBACK_VENDORS: (process.env.ANSWER_ENGINE_FALLBACK_VENDORS || 'Huihuiyun')
    .split(',').map(s => s.trim()).filter(Boolean),
  TIMEOUT_MS: parseInt(process.env.ANSWER_ENGINE_TIMEOUT_MS, 10) || 60000,
  // 多 Key 池：ANSWER_ENGINE_KEYS 是逗号分隔的额外 Key（多个免费账号）。
  // 与供应商主 Key（vendor.envKey）合并去重后组成 Key 池。N 把 Key = N 倍配额。
  // 默认冷却 5 小时 —— 对齐 SenseNova「账号 × 5 小时」重置节奏。
  // 真实额度是服务端按账号计，冷却只是本端"别再打已耗尽的 Key"，重置后自动复用，无需重启。
  KEY_COOLDOWN_MS: parseInt(process.env.ANSWER_ENGINE_KEY_COOLDOWN_MS, 10) || 5 * 60 * 60 * 1000,
}

/**
 * 答案引擎 Key 池与冷却。
 * 按 Key 维度（而非「Key×模型×自然日」）记录冷却，因为 SenseNova 公测额度是
 * 「账号 × 5 小时」重置，与「自然日」不同步。配额耗尽的 Key 进入冷却，到期自动恢复。
 */
const _answerEngineKeyCooldown = new Map() // apiKey -> 冷却到期时间戳(ms)

export function getAnswerEngineKeys(vendor) {
  const primary = process.env[vendor.envKey] || ''
  const all = []
  if (primary) all.push(primary)
  // ANSWER_ENGINE_KEYS 语义 = 主供应商的「同账号额外 Key」；备用供应商（如 Bailian 付费池）
  // 绝不能混入主供应商的 Key，否则会出现"拿商汤 Key 打百炼域名"的 401 空转。
  if (vendor.name === ANSWER_ENGINE.VENDOR) {
    const extra = (process.env.ANSWER_ENGINE_KEYS || '')
      .split(',').map(s => s.trim()).filter(Boolean)
    for (const k of extra) if (!all.includes(k)) all.push(k)
  }
  return all
}

export function isAnswerEngineKeyCooling(apiKey) {
  const until = _answerEngineKeyCooldown.get(apiKey)
  return !!until && Date.now() < until
}

export function cooldownAnswerEngineKey(apiKey) {
  _answerEngineKeyCooldown.set(apiKey, Date.now() + ANSWER_ENGINE.KEY_COOLDOWN_MS)
  console.warn(`[AnswerEngine] Key 尾号 ${keyTail(apiKey)} 额度耗尽，进入冷却 ${Math.round(ANSWER_ENGINE.KEY_COOLDOWN_MS / 3600000)}h（重置后自动恢复）`)
}

/**
 * 答案引擎文本调用：优先直连 ANSWER_ENGINE.VENDOR 的强推理模型。
 * Key 池 + 按 Key 冷却：多账号 Key 自动分摊额度，某 Key 5h 额度用尽即冷却、换下一个，
 * 全部冷却或全失败再回落通用文本链路，绝不卡住批改。
 * @returns {Promise<{content: string, usedBackup: boolean, provider: string}>}
 */
export async function callAnswerEngineCompletion(opts) {
  const {
    systemContent,
    userContent,
    temperature = 0.2,
    maxTokens = 2048,
    // 单次调用覆盖主模型（分级路由 / 基准测试用）。不传则用 ANSWER_ENGINE.MODEL。
    model: modelOverride = null,
    // 关掉降级链，只打指定模型。基准测试要拿到"纯净"的单模型准确率时用；
    // 生产保持默认 true，失败要能自动让路，绝不能硬卡在一个模型上。
    fallback = true,
  } = opts

  // 一键回滚：保持改造前行为（走通用文本链路）
  if (!ANSWER_ENGINE.ENABLED) {
    const chain = await callTextCompletion(opts)
    return { ...chain, provider: 'legacy-text-chain' }
  }

  const vendor = getResolvedVendors().find(v => v.name === ANSWER_ENGINE.VENDOR)
  if (vendor) {
    const keys = getAnswerEngineKeys(vendor)
    if (keys.length === 0) {
      console.warn(`[AnswerEngine] 供应商 ${ANSWER_ENGINE.VENDOR} 未配置 Key，回落通用文本链路`)
    } else {
      const primary = modelOverride || ANSWER_ENGINE.MODEL
      const models = fallback ? [primary, ...ANSWER_ENGINE.FALLBACK_MODELS] : [primary]
      let allCooling = true
      for (const apiKey of keys) {
        if (isAnswerEngineKeyCooling(apiKey)) continue // 这把 Key 在冷却，跳过
        allCooling = false
        for (const model of models) {
          try {
            const content = await requestOpenAIProvider({
              endpoint: vendor.endpoint,
              apiKey,
              model,
              messages: buildOpenAIMessages(systemContent, userContent),
              temperature,
              maxTokens,
              timeout: ANSWER_ENGINE.TIMEOUT_MS,
              // 429 允许重试（最多等 8s，额度真耗尽时 postWith429Retry 会立刻上抛换 Key/换模型）；
              // 503 不重试 —— RETRY_DELAYS_503 累计可等 245s，会把批改卡死在一条链路上。
              // 这里选择快速失败并降级，绝不硬卡在一个模型/Key 上。
              retry429: true,
              retry503: false,
              vendor,
              extraBody: vendor.extraBody || null,
              // SenseNova 的重置是 5h 窗口而不是自然日；命中真·额度耗尽时按 Key 冷却时长冷却
              // 该 Key×模型即可，绝不能按「当日不再使用」拉黑 —— 那会让 pro 从早上禁言到半夜。
              exhaustedTtlMs: ANSWER_ENGINE.KEY_COOLDOWN_MS,
            })
            if (content) {
              return { content, usedBackup: true, provider: `${vendor.name}:${model}` }
            }
            console.warn(`[AnswerEngine] ${vendor.name}:${model} 返回空内容`)
          } catch (err) {
            const status = err.response?.status
            const errKind = classifyAnswerEngineError(err)
            const errSnippet = extractErrorSnippet(err)
            if (status === 401 || status === 403) {
              // 该 Key 鉴权失败（无效/未授权），所有模型都不会成功，直接换下一把 Key，
              // 避免在一把废 Key 上对多个模型各空打一次
              console.warn(`[AnswerEngine] ${vendor.name} Key 尾号 ${keyTail(apiKey)} 鉴权失败(${status})，跳过该 Key 全部模型`)
              break
            }
            if (isQuotaExhaustedError(err)) {
              // 该 Key 5h 额度已用尽 → 冷却此 Key，换下一把 Key，不在这把 Key 上继续空耗
              cooldownAnswerEngineKey(apiKey)
              console.warn(`[AnswerEngine] ${vendor.name}:${model} 失败: ${errKind} ${errSnippet} → Key 尾号 ${keyTail(apiKey)} 冷却`)
              break
            }
            // 瞬时限流（429）或网络/超时/5xx：只让这一 model 让路到下一个 model，
            // 不换 Key 也不冷却 —— 下一题 pro 仍是首选，避免一次并发风暴把主模型全线关停。
            console.warn(`[AnswerEngine] ${vendor.name}:${model} 失败: ${errKind} ${errSnippet}`)
          }
        }
      }
      if (allCooling) {
        console.warn(`[AnswerEngine] 所有 Key 均处于冷却（额度重置中），回落通用文本链路`)
      }
    }
  }

  // 备用供应商兜底：各自用自己的 Key 与 textModel，与主供应商的配额/冷却互不影响。
  // 注意这层在「主供应商 Key 池」之后、通用文本链路之前 —— 通用链路的模型质量
  // 实测不足以给练习册出参考答案（会给出张冠李戴的选项），能不走就不走。
  for (const vendorName of ANSWER_ENGINE.FALLBACK_VENDORS) {
    if (vendor && vendor.name === vendorName) continue // 主供应商就是它的话，上面已经试过
    const fbVendor = getResolvedVendors().find(v => v.name === vendorName)
    if (!fbVendor) continue
    const fbKey = process.env[fbVendor.envKey] || ''
    if (!fbKey) continue
    try {
      const content = await requestOpenAIProvider({
        endpoint: fbVendor.endpoint,
        apiKey: fbKey,
        model: fbVendor.textModel,
        messages: buildOpenAIMessages(systemContent, userContent),
        temperature,
        maxTokens,
        timeout: ANSWER_ENGINE.TIMEOUT_MS,
        retry429: true,
        retry503: false,
        vendor: fbVendor,
        extraBody: fbVendor.extraBody || null,
      })
      if (content) {
        console.warn(`[AnswerEngine] 主供应商不可用 → 备用供应商兜底成功: ${fbVendor.name}:${fbVendor.textModel}`)
        return { content, usedBackup: true, provider: `${fbVendor.name}:${fbVendor.textModel}` }
      }
      console.warn(`[AnswerEngine] 备用供应商 ${fbVendor.name}:${fbVendor.textModel} 返回空内容`)
    } catch (err) {
      console.warn(`[AnswerEngine] 备用供应商 ${fbVendor.name}:${fbVendor.textModel} 失败: ${classifyAnswerEngineError(err)} ${extractErrorSnippet(err)}`)
    }
  }

  // 答案引擎不可用 → 回落通用文本链路，绝不因为模型选择问题卡住批改
  const fallbackChain = await callTextCompletion(opts)
  return { ...fallbackChain, provider: 'fallback-text-chain' }
}

/**
 * 直接调用指定备份供应商的视觉接口 —— 供「双路并发搭配」使用（HYBRID_VISION_ENABLED）。
 * 与 callVisionCompletion 的区别：
 *   · 不打魔搭、不走供应商降级链，只打指定供应商；失败直接抛，由调用方决定兜底策略。
 *   · 用途：同一张图同时发给两个模型，再交叉合并结果。
 *
 * 背景（2026-09-13 实测，详见 deliverables/model_hybrid_plan_20260913.md）：
 *   魔搭 235B student_answer 抽得全（15/15）但 answer 字段 15/15 被学生答案污染；
 *   sensenova-6.8-flash-lite 格式合规、零污染但漏抽 4/15。两者能力正交，
 *   并发调用后合并可同时拿到「覆盖率」与「洁净度」，且 wall-clock = max(两路) 不增加延迟。
 */
export async function callVendorVisionCompletion({
  vendorName,
  systemPrompt,
  userText,
  imageDataURL,
  temperature = 0.3,
  maxTokens = 8192,
  timeout = 180000,
}) {
  const def = BACKUP_VENDOR_DEFS.find(v => v.name === vendorName)
  const vendor = getResolvedVendors().find(v => v.name === vendorName)
  if (!vendor) {
    throw new Error(`视觉供应商 ${vendorName} 未启用（缺少环境变量 ${def?.envKey || '?'}）`)
  }
  const apiKey = process.env[vendor.envKey]
  const model = (vendor.vlModels || [])[0]
  if (!model) throw new Error(`视觉供应商 ${vendorName} 未配置 vlModels`)
  const messages = buildVisionMessages(systemPrompt, userText, imageDataURL)
  const content = await requestOpenAIProvider({
    endpoint: vendor.endpoint,
    apiKey,
    model,
    messages,
    temperature,
    maxTokens,
    timeout,
    retry429: true,
    retry503: false,
    extraBody: vendor.extraBody || null,
  })
  return { content, vendor: vendorName, model }
}

/**
 * 指定供应商 + 指定模型的纯文本调用（判题终裁等场景用）。
 * 与 callVendorVisionCompletion 的区别：不带图片；model 可显式指定（如 grok-4.5），
 * 不传则回落到供应商 textModel。extraBody 默认沿用供应商配置，可显式传 null 覆盖 ——
 * 关键：Huihuiyun 的供应商级 extraBody 是 reasoning_effort:'none'（sensenova 专用），
 * grok 系列绝不能带，判题调用必须显式传 null。
 */
export async function callVendorTextCompletion({
  vendorName,
  model = null,
  systemPrompt,
  userText,
  temperature = 0.2,
  maxTokens = 1024,
  timeout = 30000,
  extraBody,
}) {
  const def = BACKUP_VENDOR_DEFS.find(v => v.name === vendorName)
  const vendor = getResolvedVendors().find(v => v.name === vendorName)
  if (!vendor) {
    throw new Error(`文本供应商 ${vendorName} 未启用（缺少环境变量 ${def?.envKey || '?'}）`)
  }
  const apiKey = process.env[vendor.envKey]
  const useModel = model || vendor.textModel
  if (!useModel) throw new Error(`文本供应商 ${vendorName} 未配置 textModel`)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ]
  const bodyExtra = extraBody !== undefined ? extraBody : (vendor.extraBody || null)
  const content = await requestOpenAIProvider({
    endpoint: vendor.endpoint,
    apiKey,
    model: useModel,
    messages,
    temperature,
    maxTokens,
    timeout,
    retry429: true,
    retry503: false,
    extraBody: bodyExtra,
  })
  return { content, vendor: vendorName, model: useModel }
}

export async function callVisionCompletion(opts) {
  const {
    imageDataURL,
    systemPrompt,
    userText = '请识别这张作业图片中的所有题目，并返回 JSON 结果。',
    temperature = 0.3,
    maxTokens = 8192,
    model,
    // noBackup=true：禁止静默降级到备份视觉供应商（MiniMax-M3/8B/sensenova/agnes/gpt-4o-mini 等）。
    //   背景（2026-09-09 练习册答案 PDF 错位修复）：答案页整本解析时 15 页并发打爆魔搭配额，
    //   请求被静默轮换到弱模型，双栏答案页阅读顺序错乱、单元标题漏读 → 全本答案错位入库。
    //   对质量敏感的 OCR 场景（练习册答案页）应传 noBackup，魔搭耗尽时宁可当页失败重试，
    //   也不能拿弱模型的错乱输出污染答案库。显式 env（BACKUP_FIRST/GMI_FIRST）也被本选项压住：
    //   调用方的质量约束比全局路由开关更具体。
    noBackup = false,
    // 指定视觉通道（2026-09-19）：几何重绘要独占一条低频免费通道，避免与 OCR/文本兜底
    // 抢同一份配额（Google 免费档按 project+model 计，flash 系列仅 5 RPM）。
    //   preferredVendor: 'GoogleGeminiDirect' → 该通道**置顶**，失败仍走原降级链
    //   onlyVendor:      'GoogleGeminiDirect' → **只走**该通道（失败即失败，不静默换弱模型）
    // noBackup=1 时 preferredVendor 不生效（答案页 OCR 的质量约束更强，保持原语义）；
    // onlyVendor 是调用方的显式指令，优先级最高。
    preferredVendor = null,
    onlyVendor = null,
    // freeOnly=true（2026-09-20 写入侧补测专用）：备份供应商只走 FREE_VL_CHANNELS 白名单
    // （零计费/零余额通道），绝不触碰付费 key（HuihuiyunGemini/Bailian/Huihuiyun 等）。
    // 魔搭矩阵本身是免费额度体系，不受影响；freeOnly 时 GMI 插队也被跳过（非白名单）。
    // 全部免费通道不可用 → 本次调用失败（上层捕获，不影响批改主流程）。
    freeOnly = false,
  } = opts
  if (noBackup) {
    console.log('[AI] noBackup=1：本次视觉请求仅使用魔搭（ModelScope）Key×模型矩阵，不降级备份供应商')
  }

  const messages = buildVisionMessages(systemPrompt, userText, imageDataURL)

  // 备份提供商超时：主 ModelScope 失败后快速尝试备选，防止阻塞批次。
  // 视觉请求整体比文本慢得多，20s 对大图会把本来能成功的备用也误杀，
  // 因此按 env 可调，默认放宽到 180s。
  // 2026-09-18 由 60s 提到 180s：辉辉云后备 qwen3.8-max 整页 OCR 实测（8 次，生产消息结构）
  //   分布 36.8 / 39.0 / 40.8 / 71.8 / 91.5 / 109.4 / 143.3 / 300+（超时），中位 ~72s、p90 ~145s。
  //   60s 会杀掉一半以上；120s 仍会杀掉 p90 的 143s 慢页，故取 180s 覆盖到 p90 之上。
  //   长尾（>180s）由重试与 watchdog 兜底 —— 与 maxTokens 被压到 4096 是同一类
  //   「参数不匹配导致后备 100% 失败」的坑，见 _辉辉云后备模型选型-20260918.md。
  const BACKUP_TIMEOUT = parseInt(process.env.BACKUP_VISION_TIMEOUT_MS) || 180000

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
    let content
    try {
      content = await requestOpenAIProvider({
        endpoint: AI_CONFIG.ENDPOINT,
        apiKey,
        model: vlModel,
        messages,
        temperature,
        maxTokens,
        // ⚠️ 超时必须大于模型真实延迟，否则主模型永远失败、每张图都被判成
        // "所有视觉模型均不可用：timeout of 45000ms exceeded"。
        // 2026-08-26 实测（Qwen3-VL-235B + 本 OCR 提示词，同一张 733KB 压缩图连测 3 次）：
        //   107935ms / 90119ms / 111313ms，三次都 finish_reason=stop、结果完整。
        // 此前硬上限 45s 低于正常延迟，大图（>600KB）注定超时。
        // 原注释担心的"卡在 503 重试累计 245s"由 retry503:false 兜住，与超时值无关。
        timeout: parseInt(process.env.VISION_TIMEOUT_MS) || 180000,
        retry429: true,
        retry503: false,
      })
      return { content, usedBackup: apiKey !== AI_CONFIG.API_KEY, vendorName: 'ModelScope' }
    } catch (err) {
      // ⚠️ 必须打标：否则 wrapVisionError 的按顺序推断会把连续多个魔搭组合的失败
      // 误标成 Agnes/FreeModel/SenseNova，前端出现「四家全灭」的假象（2026-09-15 实锤）。
      err._provider = 'ms'
      throw err
    }
  }

  const wantedModels = model ? [model] : VL_MODELS
  const mainSkippedByCooldown = MS_KEYS.length > 0 && isMainRateLimitedToday()

  // 测试开关：BACKUP_FIRST=1（或 ZENMUX_FIRST=1）时，把备份供应商（ZenMux 等）排到魔搭前面，
  // 用于「现在就测 ZenMux 效果」而不必等魔搭当日配额耗尽。魔搭仍会作为兜底被尝试，
  // 因此日常识别不会被阻塞。测完置空/改 0 即恢复默认「魔搭优先」。
  const forceBackupFirst = process.env.BACKUP_FIRST === '1' || process.env.ZENMUX_FIRST === '1'

  // GMI_FIRST=1 时把 GMI Cloud 顶到魔搭之前作为「主 KEY」。
  // 2026-09 用户场景：gmi-serving 提供「免费 10 天」Key，端点与魔搭独立、配额独立。
  // 10 天内用 GMI_FIRST=1 顶替魔搭避免限流，Key 失效后改 0/删 env 自动回落到魔搭。
  // 这里只对"魔搭优先分支"做插队；BACKUP_FIRST 路径里 BACKUP 已经在魔搭前面，GMI 自然排第一。
  const gmiFirst = process.env.GMI_FIRST === '1'
  // 提前取出 GMI 供应商对象（没配置 Key 时为 undefined，自动回落到原流程）
  const gmiVendor = gmiFirst ? BACKUP_CONFIG.VENDORS.find(v => v.name === 'GMI' && process.env[v.envKey]) : null

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

  if (!noBackup && (allMsExhausted || forceBackupFirst)) {
    if (forceBackupFirst) {
      console.warn('[AI] BACKUP_FIRST=1 已开启，备份供应商优先（ZenMux 等先于魔搭被尝试）')
    } else {
      console.warn('[AI] 魔搭所有 Key×模型组合今日配额均已耗尽，自动切换为备份供应商优先')
    }
    // 备份供应商视觉兜底（SenseNova → Agnes → FreeModel，各自独立配额）
    for (const vendor of BACKUP_CONFIG.VENDORS) {
      for (const vlModel of vendor.vlModels) {
        // freeOnly：只走免费白名单通道，付费 key 一律跳过
        if (freeOnly && !isFreeVisionChannel(vendor.name, vlModel)) continue
        providers.push(async () => {
          try {
            const content = await requestOpenAIProvider({
              endpoint: vendor.endpoint,
              apiKey: process.env[vendor.envKey] || '',
              model: model || vlModel,
              messages,
              temperature,
              maxTokens: backupModelMaxTokens(vendor, vlModel, maxTokens),
              timeout: BACKUP_TIMEOUT,
              retry503: false,
              // 备用供应商 429 直接失败，让下一个备用顶上来，避免每个备用都等 8s 重试
              retry429: false,
              vendor,
              extraBody: vendor.extraBody || null,
            })
            return { content, usedBackup: true, vendorName: vendor.name }
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
    // GMI_FIRST=1 时，把 GMI 插到最前作为"主 KEY"；
    // 魔搭仍保留在后面兜底，10 天 Key 失效后只需去掉 GMI_FIRST=1 即可自动回落到魔搭。
    // noBackup=1 时跳过 GMI（非魔搭供应商一律不用）。
    // freeOnly=1 时也跳过：GMI 不在免费白名单内，写入侧补测不借道。
    if (!noBackup && !freeOnly && gmiFirst && gmiVendor) {
      console.log(`[AI] GMI_FIRST=1 开启，GMI 顶替魔搭作为首选视觉供应商（端点=${gmiVendor.endpoint}）`)
      for (const vlModel of gmiVendor.vlModels) {
        providers.push(async () => {
          try {
            const content = await requestOpenAIProvider({
              endpoint: gmiVendor.endpoint,
              apiKey: process.env[gmiVendor.envKey] || '',
              model: model || vlModel,
              messages,
              temperature,
              maxTokens: Math.min(maxTokens, gmiVendor.maxTokens || 4096),
              timeout: BACKUP_TIMEOUT,
              retry503: false,
              // 备用供应商 429 直接失败，让下一个供应商顶上来
              retry429: false,
              vendor: gmiVendor,
              extraBody: gmiVendor.extraBody || null,
            })
            return { content, usedBackup: true, vendorName: gmiVendor.name }
          } catch (err) {
            err._provider = gmiVendor.name.toLowerCase()
            throw err
          }
        })
      }
    }
    // 第一优先级：魔搭 Key×模型矩阵（体验最好）
    for (const vlModel of wantedModels) {
      for (const apiKey of MS_KEYS) {
        if (isModelExhaustedToday(vlModel, apiKey)) continue
        providers.push(callMsProvider(apiKey, vlModel))
      }
    }
    // 备份供应商视觉兜底（Agnes → FreeModel → SenseNova，各自独立配额）
    // noBackup=1 时跳过：质量敏感场景宁可失败，不用弱模型输出。
    if (!noBackup) {
      for (const vendor of BACKUP_CONFIG.VENDORS) {
      for (const vlModel of vendor.vlModels) {
        // freeOnly：只走免费白名单通道，付费 key 一律跳过
        if (freeOnly && !isFreeVisionChannel(vendor.name, vlModel)) continue
        providers.push(async () => {
          try {
            const content = await requestOpenAIProvider({
              endpoint: vendor.endpoint,
              apiKey: process.env[vendor.envKey] || '',
              model: model || vlModel,
              messages,
              temperature,
              maxTokens: backupModelMaxTokens(vendor, vlModel, maxTokens),
              timeout: BACKUP_TIMEOUT,
              retry503: false,
              // 备用供应商 429 直接失败，让下一个备用顶上来
              retry429: false,
              vendor,
              extraBody: vendor.extraBody || null,
            })
            return { content, usedBackup: true, vendorName: vendor.name }
          } catch (err) {
            // 打标记让 wrapVisionError 知道是哪个 vendor 失败
            err._provider = vendor.name.toLowerCase()
            throw err
          }
        })
      }
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

  // ── 指定通道注入（2026-09-19）──────────────────────────────────────────────
  // 放在所有分支之后、执行循环之前，故对「魔搭优先」「备份优先」两条路径都生效。
  const wantsGemini = /^(?:gemini|googlegeminidirect)$/i.test(String(onlyVendor || ''))
    || (!noBackup && /^(?:gemini|googlegeminidirect)$/i.test(String(preferredVendor || '')))
  if (wantsGemini && GEMINI_DIRECT.ENABLED) {
    const geminiProvider = async () => {
      try {
        const content = await requestGeminiVision({ systemPrompt, userText, imageDataURL, temperature, maxTokens })
        if (!content) throw new Error('返回空内容')
        return { content, usedBackup: true, vendorName: 'GoogleGeminiDirect' }
      } catch (err) {
        // 打标 + 前缀，但**保留 err.response.status** —— 上游 withProviderRetry 依赖它判限流/过载
        err._provider = 'googlegeminidirect'
        if (err && typeof err.message === 'string' && !err.message.startsWith('Gemini 直连')) {
          err.message = `Gemini 直连(${GEMINI_DIRECT.MODEL})失败：${err.message}`
        }
        throw err
      }
    }
    if (onlyVendor) {
      // 独占：清掉魔搭/备份/末轮兜底，避免"静默降级到弱模型"（几何产物会与原图不一致）
      providers.length = 0
      providers.push(geminiProvider)
      console.log(`[AI] onlyVendor=GoogleGeminiDirect：本次视觉请求仅走 Gemini 直连（model=${GEMINI_DIRECT.MODEL}，${GEMINI_DIRECT.RPM} RPM）`)
    } else {
      providers.unshift(geminiProvider)
      console.log(`[AI] preferredVendor=GoogleGeminiDirect：Gemini 直连置顶（model=${GEMINI_DIRECT.MODEL}，${GEMINI_DIRECT.RPM} RPM），失败仍走原降级链`)
    }
  } else if (String(onlyVendor || preferredVendor || '') && /^(?:gemini|googlegeminidirect)$/i.test(String(onlyVendor || preferredVendor)) && !GEMINI_DIRECT.ENABLED) {
    // 显式要了 Gemini 但没配 key：必须吵出来，否则又是"配了却静默没生效"
    console.warn('[AI] ⚠️ 指定了 Gemini 直连通道，但 GEMINI_DIRECT.ENABLED=false（缺 GEMINI_API_KEY/GOOGLE_API_KEY/MODEL_GIMINI）→ 该指定被忽略，回退默认链路')
  }

  let lastError = null
  let msAttempted = false
  let geminiAttempted = false
  let agnesAttempted = false
  let fmAttempted = false
  let snAttempted = false
  for (const provider of providers) {
    try {
      const result = await provider()
      if (result.content) return result
      lastError = new Error('AI returned empty content')
    } catch (err) {
      // 仅瞬时限流才进冷却；配额耗尽已按模型单独标记，不应连带冷却整个主站。
      // ⚠️ 2026-09-19：**必须排除 Gemini 直连通道** —— 它用的是完全独立的配额（Google 项目级），
      //    它 429 跟魔搭没有任何关系。实测未排除时日志出现
      //    「[AI] 主模型限流，冷却 60s」+「魔搭所有 Key×模型组合今日配额均已耗尽」，
      //    归因完全错方向，还会平白把魔搭冷却掉。
      const fromGeminiDirect = err._provider === 'googlegeminidirect'
      if (!fromGeminiDirect && err.response?.status === 429 && !isQuotaExhaustedError(err) && !isMainRateLimitedToday()) {
        markMainRateLimited()
      }
      lastError = err
      // 标记哪些 provider 真正被尝试过
      if (err._provider === 'ms' || /魔搭|ModelScope|ms provider/i.test(err.message || '')) msAttempted = true
      else if (err._provider === 'agnes' || /Agnes|agnes/i.test(err.message || '')) agnesAttempted = true
      else if (err._provider === 'freemodel' || /FreeModel|freemodel/i.test(err.message || '')) fmAttempted = true
      else if (err._provider === 'sensenova' || /SenseNova|sensenova/i.test(err.message || '')) snAttempted = true
      else if (err._provider === 'googlegeminidirect') {
        // Gemini 直连失败：**不计入**魔搭/备份计数。
        // 否则会掉进下面的"按调用顺序推断"分支，被误标成"魔搭配额耗尽"，
        // 让 last_error 指向错误的方向（本项目已多次踩过"归因错方向"的坑）。
        geminiAttempted = true
      }
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
  throw wrapVisionError(lastError, { msAttempted, agnesAttempted, fmAttempted, snAttempted, geminiAttempted })
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
 *   - 仅 Gemini 直连失败（onlyVendor 通道）→ 保留原 message，不改写成"魔搭耗尽"
 */
export function wrapVisionError(lastError, { msAttempted = false, agnesAttempted = false, fmAttempted = false, snAttempted = false, geminiAttempted = false } = {}) {
  if (!lastError) return new Error('All vision AI providers failed')
  // 独占通道（onlyVendor=Gemini）下失败就是失败，不要把归因指向魔搭
  if (geminiAttempted && !msAttempted && !agnesAttempted && !fmAttempted && !snAttempted) return lastError
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

/**
 * OCR 提示词。answer 字段的语义由 OCR_ANSWER_MODE 控制：
 * - copy_only（默认，2026-09-04 起）：视觉模型只负责「看懂卷面」，标准答案只照抄卷面上
 *   印刷的答案栏/参考答案，不自行求解。
 *   理由：视觉模型（MiniMax / SenseNova 6.8）的计算能力弱，12 道复杂题基准只有 7/12，
 *   让它算答案既费 token 又容易错；而它算出来的答案在 Step 7 会被答案引擎整体覆盖，
 *   等于白算。留空后统一由 DeepSeek V4 Pro 基于识别出的题干重解并回填。
 * - legacy：恢复「视觉模型独立解出标准答案」的旧行为（一键回滚开关）。
 */
export const buildOCRPrompt = () => {
const legacy = process.env.OCR_ANSWER_MODE === 'legacy'
return `你是一个专业的作业题目识别助手。请识别图片中的题目，并严格返回 JSON，不要输出任何额外说明。

返回格式：
{
  "page_title": "页面顶部/页眉的印刷体标题，如'第十九章 单元测试卷'、'堂堂练① 19.1(1) 算术平方根'、'七年级数学期中练习卷'；没有印刷标题则填 null",
  "section_title": "正文内印着的【本页单元/课时小标题】（如'27.4（2）二次函数与一元二次方程（2）'、'19.1(1) 算术平方根'）；它是正文里字号最大的那一行小标题，常在页眉书名之下、第一道题之上，或页中栏的居中大字；整页没有则填 null",
  "questions": [
    {
      "question_id": "唯一标识",
      "question_number": 1,
      "sub_no": null,  // 多小问大题（如 21.(1)(2)）填小问号 "1"/"2"…；普通题填 null
      "parent_stem": null,  // 多小问大题必填：第一个小问标号之前的公共题干原文；同一大题各小问必须逐字相同。普通题填 null
      "content": "题目内容（多小问拆行时只写本小问的题干，不要重复 parent_stem 的内容）",
      "options": ["选项A的正文", "选项B的正文", "选项C的正文", "选项D的正文"],
      "answer": ${legacy
        ? `"标准答案（由你独立解出本题得到的参考答案；绝不能抄写卷面上的任何笔迹——既不是学生写的，也不是老师红笔批的）"`
        : `"卷面上【印刷体】给出的标准答案（如练习册答案栏、卷末参考答案）；卷面上没有印刷答案就填 null，不要自己解题"`},
      "student_answer": "学生答案",
      "is_correct": true,
      "confidence": 0.95,
      "analysis": "解析",
      "question_type": "choice",  // 必须是下列之一: "choice"(选择题) | "fill"(填空题) | "judge"(判断题) | "answer"(解答题)
      "block_coordinates": { "x": 0, "y": 0, "width": 1000, "height": 1000 },
      "text_bbox": { "x": 0, "y": 0, "width": 1000, "height": 600 },
      "image_type": "geometry/chart/none",
      "image_bbox": null,  // 有配图时填 { "x": 640, "y": 180, "width": 200, "height": 130 }（只框图形本身）
      "geometry_image": null
    }
  ]
}

要求：
1. 只返回合法 JSON。
2. 没有配图时 image_type 填 "none"，image_bbox 和 geometry_image 填 null。
3. 坐标统一使用 0-1000 的整数，相对整张图片归一化。
   ⚠️ block_coordinates / text_bbox / image_bbox 三个框的 width/height 都必须是【宽和高】，
   不是右下角坐标。右下角 = x+width、y+height。把右下角的 x2/y2 填进 width/height，
   会让框整体拉伸出页面，前端定位和配图裁剪全部错位。
4. image_bbox 是【配图本身】的外接矩形，只框图形（几何图、函数图、统计图表、示意图），
   不要把题干文字、选项文字、答题横线框进去。
   ⚠️ 常见排版陷阱：很多试卷把好几道题的配图集中排成一行，图的正下方标注"第1题图"
   "第2题图"…，而不是把图放在各自题目的正下方。遇到这种排版，必须按下方标注找到
   属于本题的那一格图，只框那一格（例如第2题就框标注"第2题图"的那一张），
   绝不能框题干下面的那条文字，也不要把整行图全框进来。
   如果确实找不到本题的配图，image_type 填 "none"、image_bbox 填 null，
   不要用题干区域的坐标凑一个框——凑出来的框裁出的是文字，会被当成配图展示给学生。
   ⚠️ 多小问大题（拆成多行输出、公共题干写在 parent_stem）：如果图形出现在公共题干里
   （公共题干含"如图/图1/图示/附图/见图"），那么**拆出来的每一个小问都必须返回同一个
   image_type 与 image_bbox**（同一个图形，坐标逐字相同），不能只在其中一个小问上返回、
   也不能都不返回。小问自己另配图时，才返回它自己的框。
5. 如果题目无法识别，不要编造内容。
6. 剔除卷面批改痕迹（重要）：
   - 卷面上的"√/✓/✔/×/✗/圈错/半对/分数/批语"都是批改痕迹，不是学生作答内容。
     识别出来的作用只有一个：把它们从 student_answer 里剔除干净。
   - student_answer 只填学生本人的作答笔迹。批改痕迹与学生笔迹重叠时以学生笔迹为准。
   - 不要输出任何表示"老师判对/判错"的字段，也不要因为看到红勾就把 is_correct 填 true。
     正误由服务端按 student_answer 与 answer 的比对决定，卷面痕迹不参与判定。
7. 判断题（对/错）的答案或学生答案若是"√/✗"符号，直接填入对应符号即可。
8. question_type 必须从四个值中选一个填空，每题只能填一个值，绝不能填 "choice/fill/judge/answer" 这种枚举字符串：
   - "choice" 选择题（有 A/B/C/D 选项的）
   - "fill" 填空题（横线/方框让学生填空的）
   - "judge" 判断题（对/错、√/×）
   - "answer" 解答题（需要写过程或计算的简答/计算题）
9. options 只填【选项正文】，绝不能带 A/B/C/D 标号。
   试卷上印的 "（A）3/4"、"(B) 4/3"、"A. apple"、"B、SAS" 等标号必须去掉，
   只留 ["3/4", "4/3"]、["apple", "SAS"] 这样的正文，按 A、B、C、D 顺序排列。
   标号由界面按顺序自动生成，options 里再带一遍会显示成 "A. （A）3/4"。
   判断题的 options 填 ["正确", "错误"]；非选择题 options 填 []。
10. 【标题要分清两个字段，不要混用】
   - page_title 只读【页面顶部/页眉的印刷体标题】，用于给这份作业命名，尽量完整（含"第X章"、圈序号 ①②③、课时号 19.1(1) 等）。
     不要把题号、题干、学生姓名、班级、页码、"一、选择题"这类栏目名当标题。整页没有印刷标题就填 null，不要编造。
   - section_title 只读【正文里的本页单元/课时小标题】，它是练习册/讲义分课时印的小标题，
     形如"27.4（2）二次函数与一元二次方程（2）"、"19.1(1) 算术平方根"、"27.2（4）二次函数的图像与性质"。
     ⚠️ 练习册常在页眉印一行全书通用的书名（如"新闵学校"成长·桥"练习 第01周"、"数学堂堂清"）。
     这一行是【书名的跑马灯】，要填进 page_title，**绝不能填进 section_title**——
     它对不上任何一节内容，填错了这一页的答案会整页作废。
     section_title 要的是"这一页具体在讲哪一节"，找不到就填 null，不要用书名或栏目名凑。
     整页确实只有书名没有小标题（如整本是单元测试卷）时，section_title 填 null。
11. answer（标准答案）字段规则（与卷面笔迹严格隔离）：
   - 绝不能把老师红笔写的批语、分数、对错符号、订正内容（如"计算错误""正确""×""√""-1分"等）填进 answer——这些是批改痕迹，一律丢弃。
   - 也绝不能把学生手写的答案抄成 answer；学生笔迹只进 student_answer。
   - **严禁把"学生演算的中间结果"（如"77""3×36-36+5"）误当成标准答案填入 answer。**
${legacy ? `   - 你要【独立解出本题】再填 answer。题目已印了标准答案（如练习册答案栏）时可照抄印刷体答案，但仍不得抄红笔/学生笔迹。
   - 若确实无法解出，answer 填 null，不要用卷面上的批改文字或学生答案凑一个假答案。` : `   - 【本系统由专门的答案引擎独立求解，你不需要也不应该自己计算本题。】
     只在卷面【印刷区】明确印出了标准答案（练习册答案栏、卷末参考答案、题后括号内印刷答案）时才照抄，
     其余情况一律填 null。空着不影响系统：标准答案会在后续步骤由强推理模型基于你识别出的 content 重新解出。
   - 抄印刷答案时只抄答案本身，不要带上"答案："之外的题号、解析文字。`}

12. 多小问大题（同一题号下有 (1)(2) 等多个小问）的**公共题干绝不能丢**：
   大题的公共条件（第一个小问标号之前的公共已知条件、公共图形文字描述、公共设问前提）
   是学生作答的前提，丢掉之后这道题在错题重练卷上会变成没有条件的空题、学生无法作答。
   - 若你把多个小问合并成一条 content 输出：公共条件必须完整留在 content 里。
   - 若你把每个小问拆成独立的 question 对象输出：question_number 都填大题号，
     sub_no 填小问号（"1"/"2"…），content 只写该小问自己的题干，
     并**必须额外用 parent_stem 字段输出上述公共题干原文**（原样，不得改写、不得省略），
     同一大题拆出的各小问 parent_stem 必须逐字相同。公共题干跨多行（含图形说明、表格、
     "其中…"补充条件）时必须完整并入，不要只取第一行。
   - 没有小问的普通题：parent_stem 填 null。
   反例（务必避免）：原题「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).(1)求 a、b 的值；(2)求抛物线与直线 y=x+5 的两交点及顶点所构成的三角形的面积。」
     错误：只输出 content「(1)求 a、b 的值；」「(2)求…面积。」，parent_stem 留空
       → 公共条件彻底丢失。
     正确：两条都带 parent_stem = "已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b)."

${legacy ? `【答案字段强约束（防止串行污染与算术幻觉）】
- 「answer」 与 「student_answer」 是两个**互相独立**的字段。answer 是题目印刷区显式给出的或你独立解出的标准答案；student_answer 是学生写在答题区的内容。两者绝不能混入对方的数字串——例如学生写了 83，answer 不能再出现 83。
- 「analysis」 末尾"最终答案/答案为/答案是"给出的 X，必须满足：**从题目中可提取的函数表达式 + 代入值，用四则运算可回算得到 X**。
  - 例：解析里写"展开 y=3(x-1)²+2，代入 x=6 得 y=3×36-36+5=83"。这里算式「3*36-36+5=77」，与"最终答案为 83"不一致——是算术幻觉。
  - 出现这种情况时，请重新仔细核验算式；若仍无法保证 X 正确，在 analysis 末尾显式写【未自检】而不是 X。
- 禁止用 「analysis」 里的"答案/结果/得"作为 prompt 上下文来推断 「answer」（避免循环自证）。answer 必须独立于 analysis 求得。

【易混概念清单（算 answer 前必须显式判定方向）】
下列概念在中学数学里高频混淆，AI 容易按"默认定义"分支答非所问。算 answer 前必须先判定题目问的是 X 还是 Y，再作答；不要默认走"标准定义"那条路。
- "平方根" vs "算术平方根"：
  · 题目写"√a 的值" / "a 的算术平方根" / 直接出现 √ 符号求值 → 默认非负（一个值）。
  · 题目写"a 的平方根" / "x²=a 的解" / "√a 的平方根" / 题面或上下文涉及 ± 形式 → 取 ±（两个值，含 ±）。
  · 反例（2026-09-03 线上事故）：题"√81的平方根是____"标准答案为 ±3（先算 √81=9，再求 9 的平方根）；AI 按算术平方根分支答 9。
- "相反数" vs "绝对值"：求 -a 的相反数 = a（符号无关），求 -a 的绝对值 = |a|（永远非负）。
- "方程的解" vs "不等式的解集"：方程解是离散点，不等式解集是范围（含 ≥/≤ 端点判定）。
- "解方程" vs "方程的解"：前者是过程（动词），后者是结果（名词）——别把求的过程填进 answer。
- "约分" vs "通分"：约分使分式变简，通分使分式变相同分母。
- "最简分数" vs "真分数"：约到最简 ≠ 一定小于 1。
判定不确定时，回看一遍题面"问"的是什么；不要默认走最常见的标准定义分支。` : `【字段隔离约束】
- 「answer」 与 「student_answer」 是两个**互相独立**的字段。answer 只来自卷面印刷区；student_answer 是学生写在答题区的内容。两者绝不能混入对方的数字串——例如学生写了 83，answer 不能再出现 83。
- 「analysis」 只在卷面本身印有解析时照抄印刷体解析；没有印刷解析就填 null，不要自己写解析。`}

【数学符号识别规范（必须严格遵守）】
- content（题干）、answer（答案）、student_answer（学生答案）中的数学式子必须完整、准确地转录，禁止漏写、替换或臆造符号。
- 严格区分三种"叉形"符号：
  · 算式中间表示相乘的是乘号"×"（如"3×4"、"√12 × √(1/3)"）；
  · 出现在未知数/方程/代数式里的是字母"x/X"（如"x²-3x+2=0"、"x÷3"）；
  · 判断题批改标记、或题干里明确是判断结果时才用"√/✗"。
  绝不要用"×"去替代方程里的字母 x，也不要把题干文字里的打叉当成乘号。
- 除号"÷"、分数线"/"、根号"√"、平方"²"、立方"³"、指数、小数点"."、百分号"%"必须原样保留。
- 若某处文字或符号实在模糊无法辨认，用"□"占位，绝不要输出一堆无意义的符号（如"× ×"、"% = %"、"= = ="）。
- 简答题/解答题/计算题的题干一定包含汉字描述或数字（如"计算"、"化简"、"解方程"、"求值"）。
  如果识别出的 content 全部是符号、不含任何汉字和数字（如"÷ = × ×"），说明识别错误，
  必须重新仔细查看该题原图后重新填写真实题干。
- 分数与紧邻自变量字符的边界（易错点，必须严格遵守）：
  · 当分数 1/3、2/5、a/b 后面紧接独立自变量（x²、y³、t、z^n），必须理解为「系数 × 自变量」
    ——分母是该分数的分母，自变量是该字符和它后面的指数，两者各自独立。
  · 正例：y = -1/3 x² 表示 -(1/3)·x² = -x²/3，分母是 3、自变量是 x²。
  · 反例：写成 y = -1/(3x)² 是错的——分母变成 3x²，等价于 -1/(9x²)，原题没有这个意思。
    除非原题明确把分母用括号括起来（如 1/(3x)），否则不要把分母和紧邻自变量合并。
  · 紧凑排版的视觉错觉：印刷体里分数 -1/3 和紧邻 x² 之间只有很窄的视觉间隙，
    模型容易把分母 3 和自变量 x 合并为 3x——必须警惕。
  · 同样适用于所有「分数 + 自变量 + 指数」组合：1/2 y³、2/5 t、a/b z^n、1/4 x、3/5 sinθ 等。`
}

export const buildAnswerGenerationPrompt = () => `你是一个中小学题目解答助手。请根据给定题目生成标准答案与解析，只返回 JSON：
{
  "answer": "标准答案",
  "analysis": "解析过程",
  "subject": "学科"
}

要求：
1. 只返回 JSON。
2. 解析结尾要明确给出最终答案，且必须与 answer 字段完全一致。
3. 选择题 answer 只返回选项字母（如 "C"），不要带"选项""选"等叙述。
4. answer 必须是化到最简的最终结果，不能停在中间形态：
   - 二次根式要最简：分母不含根号（1/√2 要写成 √2/2）、根号内不含分数（√(3/2) 要写成 √6/2）、
     被开方数不留能开出的平方因子（√18 要写成 3√2）。
   - 比也要有理化后再约到最简："√3:√2" 必须写成 "√6:2"。
   - 分数约到最简；能整除时写成整数。
5. 多空填空题按空的顺序用中文逗号分隔，不要写"第一空为…"这类叙述。
6. 不要把"求解过程"填进 answer：answer 只是最终结果（"解方程"是过程，"方程的解"才是结果）。
7. 确实无法唯一确定答案时，answer 填 "待人工补充"，不要编造。

【算术自检（写 analysis 前必须过一遍）】
- analysis 里出现的具体算式，其四则运算结果必须等于你给出的 answer。
  例：解析写"代入 x=6 得 y=3×36-36+5=83"，但 3*36-36+5=77 ≠ 83 —— 这是算术幻觉，必须重算。
- 算完后把 answer 代回原题条件验一遍（方程代回原方程、几何题检查量纲与取值范围）。
- 无法保证自洽时，answer 填 "待人工补充"，不要输出没验算过的结果。

【易混概念清单（作答前必须显式判定方向）】
下列概念在中学数学里高频混淆，容易按"默认定义"分支答非所问。必须先判定题目问的是哪一个，再作答。
- "平方根" vs "算术平方根"：
  · 题面写"a 的算术平方根" / 求 √a 的值 → 非负（一个值）。
  · 题面写"a 的平方根" / "x²=a 的解" / "√a 的平方根" / 上下文涉及 ± → 取 ±（两个值）。
  · 典型陷阱："√81的平方根是____"，先算 √81=9，再求 9 的平方根 → ±3，不是 9。
- "相反数" vs "绝对值"：-a 的相反数是 a；-a 的绝对值是 |a|（永远非负）。
- "方程的解" vs "不等式的解集"：方程解是离散点，不等式解集是范围（注意 ≥/≤ 端点是否取到）。
- "约分" vs "通分"：约分使分式变简，通分使分式同分母。
- "最简分数" vs "真分数"：约到最简 ≠ 一定小于 1。
- 求"取值范围"/"参数范围"时，注意分母不为 0、根号内非负、对数真数大于 0 等隐含约束。`

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

export const buildGeometryReconstructionPrompt = () => `你是几何图结构识别助手。看印刷的几何示意图，提取其结构，只返回 JSON。

坐标约定（必须严格遵守）：
- 每个顶点都要给出平面坐标 x、y。以图形最低最左处为参考，x 向右增大，y 向上增大（数学坐标，不是屏幕坐标）。
- 坐标落在 0~100 区间，保留 1 位小数。只需相对位置准确，绝对尺度不限。
- 顶点的高低、左右、远近关系必须与原图一致：原图左上方的点，y 要大且 x 要小。
- 角度与边长比例贴近原图。原图不是正三角形就不要画成正三角形。

返回格式：
{
  "figure_type": "geometry",
  "points": [ { "label": "A", "x": 12.5, "y": 88.0, "type": "vertex" } ],
  "segments": [ { "from": "A", "to": "B", "style": "solid", "relation": "normal" } ],
  "circles": [ { "cx": 50.0, "cy": 50.0, "r": 20.0, "style": "solid" } ],
  "polygons": [ { "points": ["A", "B", "C"], "fill": true } ],
  "arcs": [ { "center": "O", "from": "A", "to": "B", "style": "solid" } ],
  "angleMarks": [ { "vertex": "A", "from": "B", "to": "C" } ],
  "rightAngles": [ { "vertex": "C", "from": "A", "to": "B" } ],
  "coordinate_system": { "exists": false, "origin": "", "x_axis": false, "y_axis": false },
  "constraints": [],
  "labels": []
}

字段规则：
- figure_type：纯几何示意图填 "geometry"；坐标系/函数图象填 "coordinate"；画在坐标背景里的几何图填 "geometry_with_coords"。
- points：图上的顶点、交点、圆心。label 用原图字母，必须含 x、y。
- segments：端点必须引用 points 里存在的 label。style 取 solid|dashed|dotted；relation 取 normal|perpendicular|parallel。
- circles：圆心的 cx/cy 与半径 r，都是 0~100 区间内的数。
- polygons：只有原图上有**灰底阴影区域**（教材里"求阴影部分面积"那种）时才填，points 按顺时针或逆时针依次列出顶点 label（至少 3 个），fill 填 true。
  ⚠️ 多边形的每条边都必须同时用 segments 表达（重绘时会核对：边不在 segments 里就不上色）。
  没有阴影区域就填 []，不要为了"补全图形"而填。
- arcs：原图上有**圆弧**（扇形弧、优弧、劣弧）时才填。center/from/to 都是 points 里的 label，
  弧从 from 逆时针扫到 to。普通直线边不要用 arcs 表达。
- angleMarks：原图在角上画了**小弧线标记**（表示"这个角相等/是这个角"）时才填，
  vertex 是角的顶点，from/to 是两条边上的另一点。直角用 rightAngles，不要用 angleMarks。
- rightAngles：原图上有直角小方块标记时填写，vertex 是直角所在顶点。
- labels：见下方"标注纪律"，通常应为空数组。
- constraints：原图明确给出的等量/平行/垂直关系，如 { "type": "parallel", "segments": ["AB","CD"] }。

标注纪律（重要）：
这张图会被重绘成干净的教材插图供学生答题使用，所以 labels 只允许收录**题干里不太可能出现的符号名**，例如角标记 α、β、θ，或线名 l、m。
除此之外一律留空，具体禁止收录：
- 任何数字、长度值、角度值（如 4、5/2、2、√18、90°、30、6cm）——学生常把已知条件和算出的答案手写在图旁，抄进来会让答案伪装成题设。
- 顶点的字母（A、B、C 由 points 自动标注，不要重复放进 labels）。
- 题号、页码、"第11题"、"图3"、水印、答题区文字。
若拿不准某条标注是否该收录，就不收录。

其它纪律：
1. 只输出 JSON，不要任何解释文字。
2. 不要补画原图中不存在的点、线、圆、面、弧、坐标轴。宁缺毋滥：拿不准的元素直接不填。
3. 若该点是由作图关系定义的派生点，必须在该点上追加 "derived" 字段说明来源。
   **一律用下面的扁平写法**（服务端只认这几种键名，写错等于没标）：
   - 垂足：{ "label": "D", "x": 30.0, "y": 55.0, "derived": { "foot_of": "C", "perpendicular_to": "AB" } }
   - 中点：{ "derived": { "midpoint_of": "AB" } }
   - 两线交点：{ "derived": { "intersection": ["AF", "BC"] } }
   - 线段上的点：{ "derived": { "on_segment": "AB" } }
   - 直线上的点（不在线段内）：{ "derived": { "on_line": "AB" } }
   - 圆上的点：{ "derived": { "on_circle": "O" } }
   - 折叠/对称的像（带撇点）：{ "derived": { "reflect_of": "B", "axis": "AC" } }
   - 重心/内心/外心：{ "derived": { "centroid_of": "ABC" } }（内心写 "incenter_of"，外心写 "circumcenter_of"）
   宁可标注 derived，也不要把位置猜成一个自由点。拿不准是哪一种就标最贴近的那个，不要自造键名。
4. 忽略一切手写笔迹：解题演算、涂画、勾选、红笔批改。
5. 若图中没有任何可定位的印刷几何结构（实物照片、统计图表、纯文字示意），返回 {"figure_type":"geometry","points":[],"segments":[],"circles":[],"polygons":[],"arcs":[],"angleMarks":[]}。`

export const buildTikzGenerationPrompt = () => `你是一个 TikZ 代码生成助手。请根据输入几何图输出完整的 tikzpicture 代码，不要附加任何解释。`
