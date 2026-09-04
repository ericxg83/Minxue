import path from 'path'
import { pathToFileURL } from 'url'
import dotenv from 'dotenv'

const ROOT = path.resolve('D:/Minxue_App_V3')
dotenv.config({ path: path.join(ROOT, 'server/.env') })

// 本机代理会把 HTTPS 转成错误 plain HTTP，导致假性 400；直连测试
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href)

const CASES = [
  {
    id: 'Q1 根式方程（需验根）',
    text: '解方程：√(2x-1) = x - 2',
    expect: 'x=5',
  },
  {
    id: 'Q2 最大公约数/最小公倍数',
    text: '已知两个正整数的最大公约数是 12，最小公倍数是 252，其中一个数是 36，求另一个数。',
    expect: '84',
  },
  {
    id: 'Q3 易混概念陷阱（平方根 vs 算术平方根）',
    text: '√81 的平方根是____',
    expect: '±3',
  },
  {
    id: 'Q4 选择题（只返回字母）',
    text: '下列运算正确的是（  ）\n选项：\nA. √4 = ±2\nB. √((-3)²) = -3\nC. -√9 = -3\nD. √(a²) = a',
    expect: 'C',
  },
]

const prompt = ai.buildAnswerGenerationPrompt()
console.log('答案引擎配置:', ai.ANSWER_ENGINE)
console.log('提示词字符数:', prompt.length)
console.log('='.repeat(70))

let pass = 0
let totalTokens = 0

for (const c of CASES) {
  const t0 = Date.now()
  try {
    const { content, provider } = await ai.callAnswerEngineCompletion({
      systemContent: prompt,
      userContent: `请计算以下题目的标准答案：\n\n${c.text}`,
      temperature: 0.2,
      maxTokens: 2048,
    })
    const ms = Date.now() - t0
    let parsed = null
    try {
      parsed = JSON.parse(String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    } catch (e) {
      console.log(`\n[${c.id}] ❌ JSON 解析失败`)
      console.log('  原始返回:', String(content).slice(0, 400))
      continue
    }
    const ok = String(parsed.answer).replace(/\s/g, '') === c.expect.replace(/\s/g, '')
    if (ok) pass++
    console.log(`\n[${c.id}] ${ok ? '✅' : '❌'}  用时 ${(ms / 1000).toFixed(1)}s  供应商=${provider}`)
    console.log(`  answer   : ${parsed.answer}   期望: ${c.expect}`)
    console.log(`  subject  : ${parsed.subject}`)
    console.log(`  analysis : ${String(parsed.analysis || '').slice(0, 160)}...`)
  } catch (err) {
    console.log(`\n[${c.id}] ❌ 调用失败: ${err.response?.status || err.code || err.message}`)
    if (err.response?.data) console.log('  响应:', JSON.stringify(err.response.data).slice(0, 300))
  }
}

console.log('\n' + '='.repeat(70))
console.log(`结果: ${pass}/${CASES.length} 正确`)
