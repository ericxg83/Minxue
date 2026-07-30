// 视觉模型健康检查：逐个 (供应商 × 模型) 组合发一个最小识别请求，
// 探测可用性 + 响应时间 + 错误类型（耗尽 / 不可用 / 网络）。
//
// 用法：
//   node server/scripts/probe_vl_models.mjs
//
// 跑完会打印一张表，告诉你：
//   - 哪些 Key×模型组合今日配额已耗尽（必须跳过）
//   - 哪些组合当前还能用、响应多快
//   - 哪些组合已经下架/不可用（404 / has no provider）
//
// 用 axios 发起请求，与生产 ai.js 的 HTTP 客户端保持一致，
// 避免 Node 内置 fetch 在某些环境（Windows 旧版 Node）上 fetch failed 的干扰。
//
// 用 1x1 黑色 JPEG 作占位图，AI 返 200 + 短内容即可，主要验证链路通不通。

import axios from 'axios'
import 'dotenv/config'

// 1x1 黑色 JPEG（base64 解码后约 600B），不会触发图片超限。
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z'

const SYSTEM_PROMPT = '识别图片中的所有题目，以 JSON 数组返回。每个元素包含 question_number 和 content 字段。'
const USER_TEXT = '识别'

const MS_ENDPOINT = 'https://api-inference.modelscope.cn/v1/chat/completions'
const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

function keyTail(k) {
  return String(k || '').slice(-8)
}

function isQuotaExhausted(err) {
  const data = err?.response?.data
  const msg = data?.error?.message || data?.message || (typeof data === 'string' ? data : '') || ''
  return /exceeded[^.]*quota|quota[^.]*exceeded/i.test(msg)
}

function isModelUnavailable(err) {
  if (!err?.response) return false
  const status = err.response.status
  if (status !== 400 && status !== 404) return false
  const body = JSON.stringify(err.response.data || '').toLowerCase()
  return /no provider|not found|does not exist|has no provider supported/.test(body)
}

async function probe({ label, endpoint, apiKey, model, vendor = null, isGemini = false, timeout = 30000 }) {
  const start = Date.now()
  const http = axios.create({ timeout, validateStatus: () => true })
  try {
    let status, body, contentLen
    if (isGemini) {
      const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`
      const resp = await http.post(url, {
        contents: [{
          role: 'user',
          parts: [
            { text: `${SYSTEM_PROMPT}\n\n${USER_TEXT}` },
            { inline_data: { mime_type: 'image/jpeg', data: TINY_JPEG_B64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 128 },
      }, { headers: { 'Content-Type': 'application/json' } })
      status = resp.status
      body = resp.data
      const text = body?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || ''
      contentLen = text.length
    } else {
      const resp = await http.post(endpoint, {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${TINY_JPEG_B64}` } },
              { type: 'text', text: USER_TEXT },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 128,
      }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } })
      status = resp.status
      body = resp.data
      const text = body?.choices?.[0]?.message?.content || ''
      contentLen = text.length
    }
    const ms = Date.now() - start
    const errMsg = body?.error?.message || ''
    if (status >= 200 && status < 300) {
      return { label, status, ms, ok: true, contentLen, errMsg }
    }
    const fakeErr = { response: { status, data: body } }
    if (isQuotaExhausted(fakeErr)) {
      return { label, status, ms, ok: false, kind: 'QUOTA_EXHAUSTED', errMsg }
    }
    if (isModelUnavailable(fakeErr)) {
      return { label, status, ms, ok: false, kind: 'MODEL_UNAVAILABLE', errMsg }
    }
    return { label, status, ms, ok: false, kind: `HTTP_${status}`, errMsg: errMsg.substring(0, 120) }
  } catch (e) {
    const ms = Date.now() - start
    if (e.code === 'ECONNABORTED') {
      return { label, status: 0, ms, ok: false, kind: 'TIMEOUT', errMsg: `>${timeout}ms` }
    }
    return { label, status: 0, ms, ok: false, kind: 'NETWORK', errMsg: (e?.code || e?.message || '').substring(0, 120) }
  }
}

const MS_KEYS = [...new Set([
  process.env.AI_API_KEY,
  process.env.MODELSCOPE_BACKUP_API_KEY,
].filter(Boolean))]

const PROBES = []

// 摩搭所有 Key×VL_MODELS 组合
const VL_MODELS = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'Qwen/Qwen3-VL-235B-A22B-Instruct',
  'Qwen/Qwen3-VL-8B-Thinking',
]
for (const [ki, key] of MS_KEYS.entries()) {
  for (const m of VL_MODELS) {
    PROBES.push(probe({
      label: `MS[${ki}] key…${keyTail(key)} | ${m}`,
      endpoint: MS_ENDPOINT,
      apiKey: key,
      model: m,
    }))
  }
}

// Agnes（Agnes 端独立模型，按用户偏好放前两位；中转摩搭的 8B 已从 ai.js 移除）
if (process.env.AGNES_API_KEY) {
  const agnesModels = ['agnes-1.5-flash', 'gpt-4o-mini', 'Qwen2.5-VL-7B-Instruct']
  for (const m of agnesModels) {
    PROBES.push(probe({
      label: `Agnes | ${m}`,
      endpoint: AGNES_ENDPOINT,
      apiKey: process.env.AGNES_API_KEY,
      model: m,
    }))
  }
}

// Gemini
if (process.env.GEMINI_API_KEY) {
  PROBES.push(probe({
    label: 'Gemini | gemini-2.5-flash',
    apiKey: process.env.GEMINI_API_KEY,
    isGemini: true,
  }))
}

console.log(`\n探测 ${PROBES.length} 个组合（每个最多 30s），请稍候…\n`)
const t0 = Date.now()
const results = await Promise.all(PROBES)
const totalMs = Date.now() - t0

// 输出表格
const fmt = (r) => {
  const t = `${r.ms}ms`.padStart(7)
  if (r.ok) {
    return `  ✅  ${t}  HTTP ${r.status}  content=${r.contentLen}B   ${r.label}`
  }
  return `  ❌  ${t}  ${r.kind.padEnd(18)}  ${r.label}  ${r.errMsg ? '— ' + r.errMsg : ''}`
}
console.log('━'.repeat(120))
console.log('  视觉模型健康检查结果（耗尽 = 当日配额耗尽；UNAVAILABLE = 平台已下架 / has no provider）')
console.log('━'.repeat(120))
const sorted = results.sort((a, b) => {
  if (a.ok && !b.ok) return -1
  if (!a.ok && b.ok) return 1
  return a.ms - b.ms
})
for (const r of sorted) console.log(fmt(r))
console.log('━'.repeat(120))

const ok = results.filter(r => r.ok)
const exhausted = results.filter(r => !r.ok && r.kind === 'QUOTA_EXHAUSTED')
const unavailable = results.filter(r => !r.ok && r.kind === 'MODEL_UNAVAILABLE')
const other = results.filter(r => !r.ok && r.kind !== 'QUOTA_EXHAUSTED' && r.kind !== 'MODEL_UNAVAILABLE')

console.log(`\n汇总：总计 ${results.length} 组合 / 可用 ${ok.length} / 配额耗尽 ${exhausted.length} / 不可用 ${unavailable.length} / 其它 ${other.length}（耗时 ${totalMs}ms）\n`)

if (ok.length) {
  console.log('🟢 当前可用（按速度升序）：')
  for (const r of ok.sort((a, b) => a.ms - b.ms)) {
    console.log(`   ${r.ms}ms  ${r.label}`)
  }
  console.log()
}
if (exhausted.length) {
  console.log('🟡 当日配额耗尽（必须跳过）：')
  for (const r of exhausted) console.log(`   ${r.label}  — ${r.errMsg}`)
  console.log()
}
if (unavailable.length) {
  console.log('🔴 平台已下架/不可用（从 VL_MODELS / Agnes vlModels 里删掉）：')
  for (const r of unavailable) console.log(`   ${r.label}  — ${r.errMsg}`)
  console.log()
}
if (other.length) {
  console.log('⚠️  其它失败（网络 / 鉴权 / 超时）：')
  for (const r of other) console.log(`   ${r.label}  — ${r.errMsg}`)
  console.log()
}

process.exit(0)
