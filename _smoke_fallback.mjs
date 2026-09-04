import path from 'path'
import { pathToFileURL } from 'url'
import dotenv from 'dotenv'

const ROOT = path.resolve('D:/Minxue_App_V3')
dotenv.config({ path: path.join(ROOT, 'server/.env') })
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

const Q = '解方程：√(2x-1) = x - 2'

const load = async (label) => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}`)
  return mod
}

console.log('===== 场景 1：主模型不存在 → 应降级到 glm-5.2 =====')
process.env.ANSWER_ENGINE_MODEL = 'definitely-not-a-real-model'
{
  const ai = await load()
  const t0 = Date.now()
  const { content, provider } = await ai.callAnswerEngineCompletion({
    systemContent: ai.buildAnswerGenerationPrompt(),
    userContent: `请计算以下题目的标准答案：\n\n${Q}`,
    temperature: 0.2,
    maxTokens: 2048,
  })
  const parsed = JSON.parse(String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
  console.log(`  provider=${provider}  用时 ${(Date.now() - t0) / 1000}s`)
  console.log(`  answer=${parsed.answer}  (期望 x=5)`)
}

console.log('\n===== 场景 2：全部模型都不可用 → 应回落到通用文本链路 =====')
{
  // 重新加载模块，让 ANSWER_ENGINE 读取新的 env
  process.env.ANSWER_ENGINE_VENDOR = 'NoSuchVendor'
  const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}2`)
  const t0 = Date.now()
  try {
    const { content, provider } = await ai.callAnswerEngineCompletion({
      systemContent: ai.buildAnswerGenerationPrompt(),
      userContent: `请计算以下题目的标准答案：\n\n${Q}`,
      temperature: 0.2,
      maxTokens: 2048,
    })
    const parsed = JSON.parse(String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    console.log(`  provider=${provider}  用时 ${(Date.now() - t0) / 1000}s`)
    console.log(`  answer=${parsed.answer}  (期望 x=5)`)
  } catch (err) {
    console.log(`  通用链路也失败: ${err.message}`)
  }
}

console.log('\n===== 场景 3：ANSWER_ENGINE_ENABLED=0 → 走 legacy 文本链路 =====')
{
  process.env.ANSWER_ENGINE_ENABLED = '0'
  process.env.ANSWER_ENGINE_VENDOR = 'SenseNova'
  delete process.env.ANSWER_ENGINE_MODEL
  const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}3`)
  console.log('  ANSWER_ENGINE.ENABLED =', ai.ANSWER_ENGINE.ENABLED)
  const t0 = Date.now()
  const { content, provider } = await ai.callAnswerEngineCompletion({
    systemContent: ai.buildAnswerGenerationPrompt(),
    userContent: `请计算以下题目的标准答案：\n\n${Q}`,
    temperature: 0.2,
    maxTokens: 2048,
  })
  const parsed = JSON.parse(String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
  console.log(`  provider=${provider}  用时 ${(Date.now() - t0) / 1000}s`)
  console.log(`  answer=${parsed.answer}  (期望 x=5)`)
}
