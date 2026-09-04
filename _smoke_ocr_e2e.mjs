import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import dotenv from 'dotenv'
import axios from 'axios'
import sharp from 'sharp'

const ROOT = path.resolve('D:/Minxue_App_V3')
dotenv.config({ path: path.join(ROOT, 'server/.env') })
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

const SRC = path.join(ROOT, 'debug_images/pdf_2141_page1_z4.png')
const KEY = process.env.SENSENOVA_API_KEY
const MODEL = 'sensenova-6.8-flash-lite'
const ENDPOINT = 'https://token.sensenova.cn/v1/chat/completions'

// 魔搭有 2048x2048 硬限制，SenseNova 虽无此限制但统一压缩以对齐线上链路
const raw = await sharp(SRC).resize({ width: 1800, height: 1800, fit: 'inside' }).png().toBuffer()
const meta = await sharp(raw).metadata()
const dataURL = 'data:image/png;base64,' + raw.toString('base64')
console.log(`测试图: ${path.basename(SRC)} → ${meta.width}x${meta.height}, ${(raw.length / 1024).toFixed(0)}KB`)

const callOnce = async (systemPrompt, label) => {
  const t0 = Date.now()
  const resp = await axios.post(ENDPOINT, {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张作业图片中的所有题目，并返回 JSON 结果。' },
          { type: 'image_url', image_url: { url: dataURL } },
        ],
      },
    ],
    temperature: 0.3,
    max_tokens: 8192,
    reasoning_effort: 'none',
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    timeout: 300000,
    proxy: false,
  })
  const ms = Date.now() - t0
  const content = resp.data?.choices?.[0]?.message?.content || ''
  const usage = resp.data?.usage || {}

  let parsed = null
  let err = null
  try {
    const cleaned = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch (e) {
    err = e.message
  }
  const qs = parsed?.questions || []
  const withAnswer = qs.filter(q => q.answer != null && String(q.answer).trim() !== '').length
  const withAnalysis = qs.filter(q => q.analysis != null && String(q.analysis).trim() !== '').length

  console.log(`\n===== ${label} =====`)
  console.log(`  用时: ${(ms / 1000).toFixed(1)}s`)
  console.log(`  prompt_tokens=${usage.prompt_tokens}  completion_tokens=${usage.completion_tokens}  total=${usage.total_tokens}`)
  console.log(`  解析: ${err ? '❌ ' + err : '✅ JSON 合法'}，题目数: ${qs.length}`)
  console.log(`  非空 answer: ${withAnswer}/${qs.length}   非空 analysis: ${withAnalysis}/${qs.length}`)
  if (qs.length) {
    console.log(`  示例 Q1: answer=${JSON.stringify(qs[0].answer)}  student_answer=${JSON.stringify(qs[0].student_answer)}`)
    console.log(`  示例题干: ${String(qs[0].content || '').slice(0, 60)}`)
  }
  return { ms, usage, qCount: qs.length, withAnswer, withAnalysis }
}

// 加载 ai.js 两次以拿到两种模式的提示词
process.env.OCR_ANSWER_MODE = 'copy_only'
const aiNew = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + '?m=new')
const pNew = aiNew.buildOCRPrompt()

process.env.OCR_ANSWER_MODE = 'legacy'
const aiOld = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + '?m=old')
const pOld = aiOld.buildOCRPrompt()

console.log(`\n提示词字符数: copy_only=${pNew.length}  legacy=${pOld.length}  (差 ${pOld.length - pNew.length})`)

const a = await callOnce(pNew, 'copy_only（新默认：不自行解题）')
const b = await callOnce(pOld, 'legacy（旧行为：视觉模型自行解题）')

console.log('\n' + '='.repeat(60))
console.log('对比汇总:')
console.log(`  输出 token: ${a.usage.completion_tokens} → ${b.usage.completion_tokens}  (节省 ${b.usage.completion_tokens - a.usage.completion_tokens}, ${((1 - a.usage.completion_tokens / b.usage.completion_tokens) * 100).toFixed(1)}%)`)
console.log(`  总 token  : ${a.usage.total_tokens} → ${b.usage.total_tokens}  (节省 ${b.usage.total_tokens - a.usage.total_tokens}, ${((1 - a.usage.total_tokens / b.usage.total_tokens) * 100).toFixed(1)}%)`)
console.log(`  用时      : ${(a.ms / 1000).toFixed(1)}s → ${(b.ms / 1000).toFixed(1)}s  (快 ${((1 - a.ms / b.ms) * 100).toFixed(1)}%)`)
