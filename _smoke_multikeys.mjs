import path from 'path'
import { pathToFileURL } from 'url'
import dotenv from 'dotenv'

const ROOT = path.resolve('D:/Minxue_App_V3')
dotenv.config({ path: path.join(ROOT, 'server/.env') })
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

const ORIGINAL_KEY = process.env.SENSENOVA_API_KEY
const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}`)
const Q = '解方程：√(2x-1) = x - 2'

console.log('===== 1. getAnswerEngineKeys 合并多 Key =====')
process.env.SENSENOVA_API_KEY = ORIGINAL_KEY
process.env.ANSWER_ENGINE_KEYS = 'sk-bogus-AA,sk-bogus-BB'
const vendor = { name: 'SenseNova', envKey: 'SENSENOVA_API_KEY' }
const keys = ai.getAnswerEngineKeys(vendor)
console.log(`  合并后 Key 数: ${keys.length}（应 = 1 主 + 2 额外 = 3）`)
console.log(`  Key 尾号: ${keys.map(k => k.slice(-6)).join(', ')}`)
console.log(`  含去重: ${ai.getAnswerEngineKeys(vendor).length === 3 ? '✅' : '❌'}`)

console.log('\n===== 2. isQuotaExhaustedError 识别 SenseNova 5h 上限 =====')
const sensovaMsg = { response: { status: 429, data: { error: { message: 'usage exceeds frequency limit' } } } }
const normal429 = { response: { status: 429, data: { error: { message: 'temporarily unavailable, please retry' } } } }
const ok = ai.isQuotaExhaustedError(sensovaMsg)
console.log(`  "usage exceeds frequency limit" → ${ok} (期望 true)`)
console.log(`  普通 429 → ${ai.isQuotaExhaustedError(normal429)} (期望 false)`)

console.log('\n===== 3. 按 Key 冷却机制 =====')
ai.cooldownAnswerEngineKey('sk-test-cooldown')
console.log(`  冷却后 isAnswerEngineKeyCooling('sk-test-cooldown') → ${ai.isAnswerEngineKeyCooling('sk-test-cooldown')} (期望 true)`)
console.log(`  其它 Key 不受影响 → ${ai.isAnswerEngineKeyCooling('sk-other')} (期望 false)`)

console.log('\n===== 4. 多 Key 轮询：坏 Key(401) 自动跳过，落到有效 Key =====')
// 主 Key 设成无效，真实 Key 放进额外 Key 池 → keys = [bad, real]
process.env.SENSENOVA_API_KEY = 'sk-bogus-INVALID-FIRST'
process.env.ANSWER_ENGINE_KEYS = ORIGINAL_KEY
const t0 = Date.now()
const r = await ai.callAnswerEngineCompletion({
  systemContent: ai.buildAnswerGenerationPrompt(),
  userContent: `请计算以下题目的标准答案：\n\n${Q}`,
  temperature: 0.2,
  maxTokens: 2048,
})
const parsed = JSON.parse(String(r.content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
console.log(`  用时 ${(Date.now() - t0) / 1000}s  provider=${r.provider}`)
console.log(`  answer=${parsed.answer} (期望 5)`)
console.log(`  ${parsed.answer && parsed.answer !== '待人工补充' ? '✅ 坏 Key 被跳过、有效 Key 成功生成' : '❌ 未成功'}`)

console.log('\n===== 5. 恢复 SENSENOVA_API_KEY 后正常主 Key 路径 =====')
process.env.SENSENOVA_API_KEY = ORIGINAL_KEY
process.env.ANSWER_ENGINE_KEYS = ''
const r2 = await ai.callAnswerEngineCompletion({
  systemContent: ai.buildAnswerGenerationPrompt(),
  userContent: `请计算以下题目的标准答案：\n\n${Q}`,
  temperature: 0.2,
  maxTokens: 2048,
})
const p2 = JSON.parse(String(r2.content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
console.log(`  provider=${r2.provider}  answer=${p2.answer}`)
