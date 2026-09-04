import fs from 'fs'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })
const endpoint = 'https://token.sensenova.cn/v1/chat/completions'
const apiKey = process.env.SENSENOVA_API_KEY
if (!apiKey) throw new Error('SENSENOVA_API_KEY is missing')

const problems = [
  ['P01', '根式方程', '解方程：√(x+4) - √(x-1) = 1。给出所有实数解，并检查定义域。', 'x=5'],
  ['P02', '绝对值方程', '解方程：|x-2| + |x+1| = 7。给出所有实数解并按从小到大排列。', 'x=-3,4'],
  ['P03', '一次函数综合', '直线 l 经过直线 y=2x+1 与 y=-x+4 的交点，并且与 x 轴交于点(3,0)。求直线 l 的函数表达式。', 'y=-3x/2+9/2'],
  ['P04', '勾股与射影定理', '在直角三角形 ABC 中，∠A=90°，AD⊥BC，垂足为D。已知BD=4，DC=9。求AB、AC、AD。', 'AB=2√13, AC=3√13, AD=6'],
  ['P05', '最大公因数与最小公倍数', '正整数 n 满足 gcd(n,60)=12 且 lcm(n,60)=420，求 n，并验证结果。', 'n=84'],
  ['P06', '对数方程', '解方程：log₂(x-1)+log₂(x+3)=3。特别检查真数条件并舍去增根。', 'x=-1+2√3'],
  ['P07', '分式不等式', '解不等式：(x-1)/(x+2) ≥ 2，并用区间表示解集。', '[-5,-2)'],
  ['P08', '递推数列', '数列满足 a₁=1，aₙ₊₁=2aₙ+3。求 a₁₀，并给出通项公式。', 'aₙ=2^(n+1)-3, a₁₀=2045'],
  ['P09', '不放回概率', '袋中有3个红球和2个蓝球，随机不放回取出2个球。求取到颜色相同的概率。', '2/5'],
  ['P10', '几何最值', '一个矩形内接于半径为5的圆。求矩形面积最大值，并说明达到最大值时的形状。', '最大值50，正方形'],
  ['P11', '均值不等式', 'a,b,c>0且a+b+c=1。求a²b²c²最大值，并说明等号成立条件。', '最大值1/729，a=b=c=1/3'],
  ['P12', '参数二次方程', '关于x的方程(x-2)(x-m)=0有两个互不相同且都属于区间(0,4)的实数根。求参数m的取值范围。', 'm∈(0,4)且m≠2'],
].map(([id, topic, question, gold]) => ({ id, topic, question, gold }))

const models = [
  { name: 'SenseNova 6.8', id: 'sensenova-6.8-flash-lite' },
  { name: 'DeepSeek V4 Pro', id: 'deepseek-v4-pro' },
  { name: 'GLM-5.2', id: 'glm-5.2' },
]

const questionText = problems.map((p, i) => `${i + 1}. [${p.topic}] ${p.question}`).join('\n')
const system = '你是敏学系统的中学数学标准答案引擎。准确率优先于速度和篇幅。请逐题独立推导，完成后逐题重新代入或检查边界、定义域、增根、符号、指数和最终数值。不要凭直觉，不要猜测。只返回合法 JSON 数组，不要 Markdown。'
const user = `${questionText}\n\n返回格式：[{"id":"P01","final_answer":"最终答案","check":"最关键的复核","confidence":0到1之间的小数}]。不要省略任何题。`
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
const output = { generatedAt: new Date().toISOString(), transport: 'direct (proxy disabled)', problems, models, prompt: user, results: [] }

for (const model of models) {
  const started = Date.now()
  const record = { model: model.name, modelId: model.id, status: 0, elapsedMs: 0, usage: null, finishReason: null, content: '', parsed: null, error: null }
  try {
    const response = await axios.post(endpoint, {
      model: model.id,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      max_tokens: 5000,
      stream: false,
      reasoning_effort: 'none',
    }, { headers, timeout: 240000, proxy: false })
    const content = response.data?.choices?.[0]?.message?.content || ''
    let parsed = null
    try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()) } catch {
      const match = content.match(/\[[\s\S]*\]/)
      if (match) { try { parsed = JSON.parse(match[0]) } catch {} }
    }
    Object.assign(record, { status: response.status, elapsedMs: Date.now() - started, usage: response.data?.usage || null, finishReason: response.data?.choices?.[0]?.finish_reason || null, content, parsed })
  } catch (error) {
    Object.assign(record, { status: error.response?.status || 0, elapsedMs: Date.now() - started, error: error.response?.data?.error?.message || error.response?.data?.message || error.message })
  }
  output.results.push(record)
  console.log(JSON.stringify({ model: record.model, status: record.status, elapsedMs: record.elapsedMs, usage: record.usage, parsed: record.parsed, error: record.error }, null, 2))
}

const file = 'D:/Minxue_App_V3/deliverables/complex_batch_benchmark_raw_20260904.json'
fs.writeFileSync(file, JSON.stringify(output, null, 2))
console.log(`RAW_RESULT=${file}`)
