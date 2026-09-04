import fs from 'fs'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config({ path: 'D:/Minxue_App_V3/server/.env' })

const endpoint = 'https://token.sensenova.cn/v1/chat/completions'
const apiKey = process.env.SENSENOVA_API_KEY
if (!apiKey) throw new Error('SENSENOVA_API_KEY is missing')

const problems = [
  {
    id: 'P01_radical_equation',
    topic: '根式方程',
    question: '解方程：√(x+4) - √(x-1) = 1。请给出所有实数解，并检查定义域。',
    gold: 'x=5',
  },
  {
    id: 'P02_absolute_value',
    topic: '绝对值方程',
    question: '解方程：|x-2| + |x+1| = 7。请给出所有实数解，并按从小到大排列。',
    gold: 'x=-3,4',
  },
  {
    id: 'P03_line_intersection',
    topic: '一次函数综合',
    question: '直线 l 经过直线 y=2x+1 与 y=-x+4 的交点，并且与 x 轴交于点 (3,0)。求直线 l 的函数表达式。',
    gold: 'y=-3x/2+9/2',
  },
  {
    id: 'P04_right_triangle_altitude',
    topic: '勾股与射影定理',
    question: '在直角三角形 ABC 中，∠A=90°，AD⊥BC，垂足为 D。已知 BD=4，DC=9。求 AB、AC、AD。',
    gold: 'AB=2√13, AC=3√13, AD=6',
  },
  {
    id: 'P05_gcd_lcm',
    topic: '最大公因数与最小公倍数',
    question: '正整数 n 满足 gcd(n,60)=12 且 lcm(n,60)=420，求 n，并验证结果。',
    gold: 'n=84',
  },
  {
    id: 'P06_log_equation',
    topic: '对数方程',
    question: '解方程：log₂(x-1)+log₂(x+3)=3。请特别检查真数条件并舍去增根。',
    gold: 'x=-1+2√3',
  },
  {
    id: 'P07_rational_inequality',
    topic: '分式不等式',
    question: '解不等式：(x-1)/(x+2) ≥ 2，并用区间表示解集。',
    gold: '(-∞,-5]',
  },
  {
    id: 'P08_recurrence',
    topic: '递推数列',
    question: '数列满足 a₁=1，aₙ₊₁=2aₙ+3。求 a₁₀，并给出通项公式。',
    gold: 'aₙ=4·2^(n-1)-3, a₁₀=2045',
  },
  {
    id: 'P09_probability',
    topic: '不放回概率',
    question: '袋中有 3 个红球和 2 个蓝球，随机不放回地取出 2 个球。求取到颜色相同的概率。',
    gold: '2/5',
  },
  {
    id: 'P10_circle_rectangle',
    topic: '几何最值',
    question: '一个矩形内接于半径为 5 的圆。求矩形面积的最大值，并说明达到最大值时矩形是什么形状。',
    gold: '最大面积50，正方形',
  },
  {
    id: 'P11_product_maximum',
    topic: '均值不等式',
    question: 'a,b,c>0 且 a+b+c=1。求 a²b²c² 的最大值，并说明等号成立条件。',
    gold: '最大值1/729，a=b=c=1/3',
  },
  {
    id: 'P12_parameter_quadratic',
    topic: '参数二次方程',
    question: '关于 x 的方程 (x-2)(x-m)=0 有两个互不相同且都属于区间 (0,4) 的实数根。求参数 m 的取值范围。',
    gold: 'm∈(0,4)且m≠2',
  },
]

const models = [
  { name: 'SenseNova 6.8', id: 'sensenova-6.8-flash-lite' },
  { name: 'DeepSeek V4 Pro', id: 'deepseek-v4-pro' },
  { name: 'GLM-5.2', id: 'glm-5.2' },
]

const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
const system = '你是敏学系统的中学数学标准答案引擎。准确率优先于速度和篇幅。每一步都要自行复核，特别检查定义域、增根、符号、边界、单位和最终答案。不要猜测。只返回合法 JSON，不要 Markdown 代码块。'

const results = {
  generatedAt: new Date().toISOString(),
  benchmark: '12道独立复杂数学题；每题每模型单独请求；同一提示词；reasoning_effort=none；temperature=0.2；只比较答案正确性，不比较文风。',
  problems,
  models,
  results: [],
}

function extractContent(data) {
  return data?.choices?.[0]?.message?.content || ''
}

function parseJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(text) } catch {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch {}
  }
  return null
}

for (const problem of problems) {
  for (const model of models) {
    const started = Date.now()
    const record = {
      problemId: problem.id,
      topic: problem.topic,
      model: model.name,
      modelId: model.id,
      gold: problem.gold,
      status: 0,
      elapsedMs: 0,
      usage: null,
      finishReason: null,
      content: '',
      parsed: null,
      error: null,
    }
    try {
      const response = await axios.post(endpoint, {
        model: model.id,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `${problem.question}\n\n返回 JSON：{"final_answer":"最终答案","verification":"用一句话说明关键复核结果","confidence":0到1之间的小数}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
        reasoning_effort: 'none',
      }, { headers, timeout: 180000, proxy: false })
      const content = extractContent(response.data)
      Object.assign(record, {
        status: response.status,
        elapsedMs: Date.now() - started,
        usage: response.data?.usage || null,
        finishReason: response.data?.choices?.[0]?.finish_reason || null,
        content,
        parsed: parseJson(content),
      })
    } catch (error) {
      Object.assign(record, {
        status: error.response?.status || 0,
        elapsedMs: Date.now() - started,
        error: error.response?.data?.error?.message || error.response?.data?.message || error.message,
      })
    }
    results.results.push(record)
    console.log(JSON.stringify({ problemId: record.problemId, model: record.model, status: record.status, elapsedMs: record.elapsedMs, usage: record.usage, parsed: record.parsed, error: record.error }, null, 2))
  }
}

const output = 'D:/Minxue_App_V3/deliverables/complex_model_benchmark_raw_20260904.json'
fs.writeFileSync(output, JSON.stringify(results, null, 2))
console.log(`RAW_RESULT=${output}`)
