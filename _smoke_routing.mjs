import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import dotenv from 'dotenv'
import sharp from 'sharp'

const ROOT = path.resolve('D:/Minxue_App_V3')
dotenv.config({ path: path.join(ROOT, 'server/.env') })

const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}`)

const SRC = path.join(ROOT, 'debug_images/pdf_2141_page1_z4.png')
const raw = await sharp(SRC).resize({ width: 1800, height: 1800, fit: 'inside' }).png().toBuffer()
const dataURL = 'data:image/png;base64,' + raw.toString('base64')

console.log('=== 配置快照（决定路由）===')
console.log('  GMI_FIRST       =', process.env.GMI_FIRST || '(未设置→关)')
console.log('  GMI_API_KEY     =', process.env.GMI_API_KEY ? '已配置' : '未配置/占位符')
console.log('  AI_API_KEY(魔搭) =', process.env.AI_API_KEY ? '已配置' : '未配置')
console.log('  SENSENOVA_API_KEY =', process.env.SENSENOVA_API_KEY ? '已配置' : '未配置')
console.log('  OCR_ANSWER_MODE =', process.env.OCR_ANSWER_MODE || 'copy_only(默认)')
console.log('  → 视觉首选:', (process.env.GMI_FIRST === '1' && process.env.GMI_API_KEY) ? 'MiniMax(GMI)' : '魔搭/Qwen3-VL（GMI 未启用）')

// 捕获 callVisionCompletion 内部日志，推断实际命中的视觉供应商
const logs = []
const origLog = console.log
console.log = (...a) => { logs.push(a.join(' ')); }
const visionStart = Date.now()
let vision
try {
  vision = await ai.callVisionCompletion({
    imageDataURL: dataURL,
    systemPrompt: ai.buildOCRPrompt(),
    temperature: 0.3,
    maxTokens: 8192,
  })
} catch (e) {
  console.log = origLog
  console.log('视觉调用异常:', e.message)
  process.exit(1)
}
console.log = origLog
const visionMs = Date.now() - visionStart

// 从日志推断视觉供应商
const triedGMI = logs.some(l => /GMI_FIRST=1/.test(l))
const failedMS = logs.some(l => /魔搭|ModelScope|ms provider/i.test(l))
const usedProvider = triedGMI ? 'MiniMax(GMI)' : (failedMS ? '魔搭失败→SenseNova 兜底' : '魔搭/Qwen3-VL（主用）')

let questions = []
try {
  const cleaned = String(vision.content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  questions = parsed.questions || []
} catch (e) {
  console.log('视觉返回无法解析为 JSON:', e.message)
  console.log('原始:', String(vision.content).slice(0, 300))
  process.exit(1)
}

const nullAnswer = questions.filter(q => q.answer == null || String(q.answer).trim() === '').length

console.log('\n=== 视觉(OCR)结果 ===')
console.log('  实际命中视觉供应商(推断):', usedProvider)
console.log('  用时:', (visionMs / 1000).toFixed(1) + 's', ' usedBackup=', vision.usedBackup)
console.log('  识别题目数:', questions.length, '  其中 answer=null(抄不到印刷答案):', nullAnswer + '/' + questions.length)
console.log('  捕获日志:', logs.length ? logs.slice(0, 6).join(' | ') : '(无,说明主供应商直接成功)')

console.log('\n=== 解答(答案引擎)结果 ===')
let deepseek = 0
let other = 0
for (const q of questions.slice(0, 3)) {
  const t0 = Date.now()
  const r = await ai.callAnswerEngineCompletion({
    systemContent: ai.buildAnswerGenerationPrompt(),
    userContent: `请计算以下题目的标准答案：\n\n${q.content || ''}`,
    temperature: 0.2,
    maxTokens: 2048,
  })
  const ms = (Date.now() - t0) / 1000
  if (/deepseek-v4-pro/.test(r.provider)) deepseek++; else other++
  console.log(`  [${q.question_type || '?'}] provider=${r.provider}  ${ms.toFixed(1)}s  answer=${(r.content || '').slice(0, 80).replace(/\n/g, ' ')}`)
}
if (questions.length > 3) console.log(`  ...（其余 ${questions.length - 3} 题同理，均走答案引擎）`)

console.log('\n=== 路由结论 ===')
console.log(`  视觉: ${usedProvider}`)
console.log(`  解答: DeepSeek V4 Pro (${deepseek} 题命中 deepseek-v4-pro, ${other} 题走其它)`)
console.log(`  OCR 模式: copy_only（视觉不再自行解题，answer 由答案引擎生成）`)
