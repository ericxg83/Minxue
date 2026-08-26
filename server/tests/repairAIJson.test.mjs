import { repairAIJson, salvageTruncatedJson, stripCodeFence } from '../worker.js'

// 覆盖线上实际出现过的坐标畸形形态。
// 线上最高频是 C 系列（半对象）：报错定位在 buildOCRPrompt 模板第 16 行、第 39~40 列，
// 正是 block_coordinates 写成 {"x": 60, 200, 650, 27} 的位置。
const cases = [
  ['A 裸元组', `{"a":1,"block_coordinates": 60, 200, 650, 27}`],
  ['B 数组', `{"a":1,"block_coordinates": [60, 200, 650, 27]}`],
  ['C 半对象(单标签)', `{"a":1,"block_coordinates": {"x": 60, 200, 650, 27}}`],
  ['C2 半对象(双标签)', `{"a":1,"block_coordinates": {"x": 60, "y": 200, 650, 27}}`],
  ['C3 半对象(三标签)', `{"a":1,"block_coordinates": {"x": 60, "y": 200, "width": 650, 27}}`],
  ['C4 裸大括号', `{"a":1,"block_coordinates": {60, 200, 650, 27}}`],
  ['D 正常对象(幂等)', `{"a":1,"block_coordinates": {"x":60,"y":200,"width":650,"height":27}}`],
  ['E text_bbox 半对象', `{"a":1,"text_bbox": {"x": 60, "y": 200, 650, 27}}`],
  ['F image_bbox 半对象', `{"a":1,"image_bbox": {"x": 60, "y": 200, 650, 27}}`],
  ['G 多字段同时畸形', `{"block_coordinates": {"x": 1, 2, 3, 4}, "text_bbox": {"x": 5, 6, 7, 8}}`],
  ['H 畸形坐标 + 后续字段', `{"block_coordinates": {"x": 1, 2, 3, 4}, "content": "题目"}`],
  ['I 裸元组 + 后续字段', `{"block_coordinates": 1, 2, 3, 4, "content": "题目"}`],
  ['J 嵌套在 questions 数组内', `{"questions":[{"question_number":1,"block_coordinates": {"x": 60, 200, 650, 27},"content":"计算"}]}`],
  // 回归：坐标修复不能破坏 LaTeX 反斜杠与字符串内引号的既有修复能力
  ['K LaTeX 反斜杠', `{"content":"求 \\angle ABC 的度数"}`],
  ['L 字符串内换行', `{"content":"第一行\n第二行"}`],
]

let pass = 0
let fail = 0
for (const [name, raw] of cases) {
  let ok = false
  let detail = ''
  try {
    JSON.parse(raw)
    ok = true
    detail = '原文即合法'
  } catch {
    try {
      const repaired = repairAIJson(raw)
      const parsed = JSON.parse(repaired)
      ok = true
      detail = JSON.stringify(parsed).slice(0, 70)
    } catch (e) {
      detail = e.message.slice(0, 70)
    }
  }
  if (ok) { pass++; console.log(`✅ ${name.padEnd(24)} ${detail}`) }
  else { fail++; console.log(`❌ ${name.padEnd(24)} ${detail}`) }
}

// 坐标值必须被正确保留，而不是只做到「能 parse」
const v = JSON.parse(repairAIJson(`{"block_coordinates": {"x": 60, 200, 650, 27}}`))
const bc = v.block_coordinates
const valuesOk = bc.x === 60 && bc.y === 200 && bc.width === 650 && bc.height === 27
console.log(valuesOk ? '✅ 坐标值保留正确' : `❌ 坐标值错误: ${JSON.stringify(bc)}`)
valuesOk ? pass++ : fail++

// ── salvageTruncatedJson：max_tokens 截断抢救 ──
// 线上真实形态：30483.jpg 报 "Unterminated string in JSON at position 5392 (line 88)"，
// 说明 8192 token 对满页试卷不够，截断发生在某道题的字符串中间。
console.log('\n── 截断抢救 ──')

const truncCases = [
  ['截断在字符串中间', `{"questions":[{"question_number":1,"content":"甲"},{"question_number":2,"content":"乙"},{"question_number":3,"content":"丙未写完`, 2],
  ['截断在键名上', `{"questions":[{"question_number":1,"content":"甲"},{"question_number":2,"cont`, 1],
  ['截断在数字上', `{"questions":[{"question_number":1,"content":"甲"},{"question_number":2,"confidence":0.9`, 1],
  ['截断在嵌套坐标内', `{"questions":[{"question_number":1,"content":"甲"},{"question_number":2,"block_coordinates":{"x":1,"y":2`, 1],
  ['数组顶层截断', `[{"question_number":1,"content":"甲"},{"question_number":2,"content":"乙"},{"question_num`, 2],
]

for (const [name, raw, expectCount] of truncCases) {
  const salvaged = salvageTruncatedJson(repairAIJson(raw))
  if (!salvaged) { fail++; console.log(`❌ ${name.padEnd(20)} 返回 null`); continue }
  try {
    const parsed = JSON.parse(salvaged)
    const arr = Array.isArray(parsed) ? parsed : parsed.questions
    if (arr.length === expectCount) {
      pass++
      console.log(`✅ ${name.padEnd(20)} 保住 ${arr.length} 道题（期望 ${expectCount}）`)
    } else {
      fail++
      console.log(`❌ ${name.padEnd(20)} 保住 ${arr?.length} 道题，期望 ${expectCount}`)
    }
  } catch (e) {
    fail++
    console.log(`❌ ${name.padEnd(20)} 抢救后仍不合法: ${e.message.slice(0, 50)}`)
  }
}

// 完全没有完整元素时应返回 null，而不是硬凑一个畸形 JSON
const noneSalvage = salvageTruncatedJson(`{"questions":[{"question_number":1,"content":"甲未写完`)
if (noneSalvage === null) { pass++; console.log('✅ 无完整元素时返回 null') }
else { fail++; console.log(`❌ 无完整元素时应返回 null，实际: ${noneSalvage}`) }

// 字符串内的括号不能误判为结构括号
const bracketInStr = salvageTruncatedJson(`{"questions":[{"content":"求 f(x)={x}[y] 的值"},{"content":"截断`)
try {
  const p = JSON.parse(bracketInStr)
  if (p.questions.length === 1 && p.questions[0].content.includes('{x}[y]')) {
    pass++; console.log('✅ 字符串内的括号未被误判')
  } else { fail++; console.log(`❌ 字符串内括号处理错误: ${bracketInStr}`) }
} catch (e) { fail++; console.log(`❌ 字符串内括号导致不合法: ${e.message.slice(0, 50)}`) }

// ── stripCodeFence：markdown 围栏剥离 ──
// 线上 30483.jpg 连续 5 次重试都死在这里：响应被截断，只有开头的 ```json
// 没有收尾的 ```，旧的成对正则匹配失败 → 反引号被当成 JSON → Unexpected token '`'
console.log('\n── 围栏剥离 ──')

const fenceCases = [
  ['成对 ```json', '```json\n{"a":1}\n```', '{"a":1}'],
  ['成对 ```', '```\n{"a":1}\n```', '{"a":1}'],
  ['只有开头围栏(截断)', '```json\n{"questions":[{"a":1}', '{"questions":[{"a":1}'],
  ['只有结尾围栏', '{"a":1}\n```', '{"a":1}'],
  ['无围栏', '{"a":1}', '{"a":1}'],
  ['前缀寒暄', '好的，识别结果如下：\n{"a":1}', '{"a":1}'],
  ['围栏+前缀寒暄', '```json\n好的：{"a":1}', '{"a":1}'],
  ['数组顶层', '```json\n[{"a":1}]\n```', '[{"a":1}]'],
  ['拒绝话术(无 JSON)', '很抱歉，图片较模糊', '很抱歉，图片较模糊'],
  ['围栏内含反引号文本', '```json\n{"c":"用 `x` 表示"}\n```', '{"c":"用 `x` 表示"}'],
]

for (const [name, raw, expect] of fenceCases) {
  const got = stripCodeFence(raw)
  if (got === expect) { pass++; console.log(`✅ ${name.padEnd(22)} → ${got.slice(0, 40)}`) }
  else { fail++; console.log(`❌ ${name.padEnd(22)} 期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(got)}`) }
}

// 端到端：截断 + 只有开头围栏 + 坐标畸形，三重叠加也要能救出题目
const worst = '```json\n{"questions":[{"question_number":1,"block_coordinates":{"x":10,20,30,40},"content":"甲"},{"question_number":2,"content":"乙截断'
const e2e = salvageTruncatedJson(repairAIJson(stripCodeFence(worst)))
try {
  const p = JSON.parse(e2e)
  if (p.questions.length === 1 && p.questions[0].block_coordinates.width === 30) {
    pass++; console.log('✅ 三重叠加(围栏+畸形+截断) 救出 1 道题')
  } else { fail++; console.log(`❌ 三重叠加结果异常: ${e2e}`) }
} catch (e) { fail++; console.log(`❌ 三重叠加仍不合法: ${e.message.slice(0, 60)}`) }

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)