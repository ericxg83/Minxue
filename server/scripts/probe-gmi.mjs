// 探测 gmi-serving.com 端点的连通性 + 模型清单。
// 用法：
//   1) 先把 GMI_API_KEY 写到 server/.env（注意 GMI_BASE_URL 可选，默认 api.gmi-serving.com/v1）
//   2) node server/scripts/probe-gmi.mjs
// 目的：用户拿到新 Key 后，第一次用之前先看端点能不能通、列出来的模型有哪些，
//      再把模型名写进 GMI_VL_MODELS / GMI_TEXT_MODEL 环境变量。
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const API_KEY = process.env.GMI_API_KEY
const BASE_URL = (process.env.GMI_BASE_URL || 'https://api.gmi-serving.com/v1').replace(/\/+$/, '')

if (!API_KEY) {
  console.error('❌ GMI_API_KEY 未配置（请在 server/.env 里加一行 GMI_API_KEY=...）')
  process.exit(1)
}

console.log(`🔍 探测 GMI Cloud 端点: ${BASE_URL}`)
console.log(`🔑 API Key 前缀: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`)

async function probe(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, headers: Object.fromEntries(res.headers) }
}

console.log('\n1) /v1/models 探测（拿可用模型清单）')
try {
  const r = await probe(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  })
  if (r.status === 200 && r.body?.data) {
    const models = r.body.data.map(m => m.id).sort()
    console.log(`✅ 拿到 ${models.length} 个模型：`)
    const vlLike = models.filter(m => /vl|vision|qvq|qwen.*-vl|qwen-vl/i.test(m))
    const textLike = models.filter(m => !/vl|vision|image|qvq/i.test(m) && /instruct|chat|flash|plus|turbo|pro/i.test(m))
    if (vlLike.length) {
      console.log('\n  视觉模型候选（vlModels 候选）：')
      vlLike.forEach(m => console.log(`    - ${m}`))
    }
    if (textLike.length) {
      console.log('\n  文本模型候选（textModel 候选）：')
      textLike.forEach(m => console.log(`    - ${m}`))
    }
    console.log('\n💡 建议：把上面视觉/文本候选复制到 .env：')
    console.log('   GMI_VL_MODELS=' + vlLike.slice(0, 3).join(','))
    console.log('   GMI_TEXT_MODEL=' + (textLike[0] || 'auto'))
    console.log('   GMI_FIRST=1')
  } else {
    console.log(`❌ 状态 ${r.status}:`)
    console.log(JSON.stringify(r.body, null, 2).slice(0, 600))
  }
} catch (e) {
  console.log(`❌ 请求失败: ${e.message}`)
}

console.log('\n2) /v1/chat/completions 探测（用默认视觉模型试一次空图 → 期望 400 但说明端点通）')
try {
  const r = await probe(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    }),
  })
  console.log(`  状态: ${r.status}`)
  if (r.status === 401 || r.status === 403) {
    console.log('  ❌ Key 无效或被拒')
  } else if (r.status === 404) {
    console.log('  ⚠️  模型名不存在（说明 gmi 用的是别的模型 ID，需要先调 /v1/models 看实际清单）')
  } else if (r.status === 429) {
    console.log('  ⚠️  限流（Key 本身有效）')
  } else {
    console.log('  ✅ Key + 端点都通')
    console.log('  响应摘要:', JSON.stringify(r.body).slice(0, 200))
  }
} catch (e) {
  console.log(`❌ 请求失败: ${e.message}`)
}
