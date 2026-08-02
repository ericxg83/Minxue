/**
 * 测试 parseAnswerText 的题号连续性校验
 *
 * 根因场景：AI 漏识别"试卷① 19.1..."单元标题行，下面所有题号错挂到上一个父单元。
 * 验证：validateQuestionNumberSequence 能识别 reverse / gap / reset 三种异常。
 *
 * 运行：node server/scripts/test_answer_seq_anomaly.mjs
 */
import { parseAnswerText } from '../services/answerParseService.js'

// ANSI 颜色
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

let pass = 0
let fail = 0

const assert = (cond, label) => {
  if (cond) {
    console.log(`${GREEN}✓${RESET} ${label}`)
    pass++
  } else {
    console.log(`${RED}✗${RESET} ${label}`)
    fail++
  }
}

const findAnomalies = (lowConf) => lowConf.filter(x => x && x.kind === 'question_seq_anomaly')

console.log(`${YELLOW}=== 测试 1: 正常跨单元题号（应无异常） ===${RESET}`)
{
  // 试卷① 19.1 + 1-3, 试卷② 19.2 + 1-3：两个独立单元，题号各自从 1 开始
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '1. A',
    '2. B',
    '3. C',
    '试卷② 19.2(1) 二次根式的性质',
    '1. D',
    '2. E',
    '3. F',
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  assert(result.answers.length === 6, '应解析 6 条答案（每个单元 3 条）')
  assert(anomalies.length === 0, '正常跨单元题号应无异常')
}

console.log(`\n${YELLOW}=== 测试 2: 漏识别"试卷② 19.2..."标题（应检测 reset 异常） ===${RESET}`)
{
  // 试卷① 19.1 + 1-3, 然后直接 1-3（漏了试卷②标题，全部挂在试卷①）
  // 同一 unit_key + section 下，3 → 1 是重置
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '1. A',
    '2. B',
    '3. C',
    '1. D',  // 应是试卷②的题 1，但试卷②标题漏了
    '2. E',
    '3. F',
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  console.log(`  异常示例: ${anomalies[0]?.message}`)
  assert(result.answers.length === 6, '应解析 6 条答案')
  const resetAnoms = anomalies.filter(a => a.reason === 'reset')
  assert(resetAnoms.length >= 1, '应至少检测到 1 个 reset 异常（3 → 1 重置）')
}

console.log(`\n${YELLOW}=== 测试 3: 同一单元内题号反向（应检测 reverse 异常） ===${RESET}`)
{
  // AI 漏识别大题组标题"二、选择题"，把选择题的题号也读出来但混在一起
  // 实际场景：一、填空题 1, 2, 3，然后漏读"二、选择题"标题，但读出 4, 5, 6（应重置为 1, 2, 3）
  // 这里我们手工构造反向：1, 2, 3, 2（重复 + 反向）
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '一、填空题',
    '1. A',
    '2. B',
    '3. C',
    '2. D',  // 异常反向：3 → 2
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  console.log(`  异常示例: ${anomalies[0]?.message}`)
  const reverseAnoms = anomalies.filter(a => a.reason === 'reverse')
  assert(reverseAnoms.length >= 1, '应检测到 1 个 reverse 异常（3 → 2）')
}

console.log(`\n${YELLOW}=== 测试 4: 跳号过大（应检测 gap 异常） ===${RESET}`)
{
  // 正常题号，但中间漏读 5-9 → 1, 2, 3, 4, 10
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '1. A',
    '2. B',
    '3. C',
    '4. D',
    '10. E',  // 跳号 5-9
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  const gapAnoms = anomalies.filter(a => a.reason === 'gap')
  assert(gapAnoms.length >= 1, '应检测到 1 个 gap 异常（4 → 10 跳号 5 题）')
  assert(gapAnoms[0]?.gap === 5, 'gap 应为 5（4-10 之间缺 5 题）')
}

console.log(`\n${YELLOW}=== 测试 5: 正常大题组重置（应有 reset 异常但不算 bug） ===${RESET}`)
{
  // 一、填空题 1, 2, 3，然后二、选择题 1, 2, 3 → group 变了，reset 正常
  // 但因为 group 不同，每个 group 内部都从 1 开始，应该不报警
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '一、填空题',
    '1. A',
    '2. B',
    '3. C',
    '二、选择题',
    '1. D',
    '2. E',
    '3. F',
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  assert(result.answers.length === 6, '应解析 6 条答案（填空 3 + 选择 3）')
  assert(anomalies.length === 0, '正常大题组重置不应报警（group 已切分）')
}

console.log(`\n${YELLOW}=== 测试 6: 跨大题组但 group 漏识别（同 group 重置到 1，应报警） ===${RESET}`)
{
  // 一、填空题 1, 2, 3，然后 1, 2, 3（漏了"二、选择题"标题）
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '一、填空题',
    '1. A',
    '2. B',
    '3. C',
    '1. D',  // 应是"二、选择题"的题 1，但 group 标题漏了
    '2. E',
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  const resetAnoms = anomalies.filter(a => a.reason === 'reset')
  assert(resetAnoms.length >= 1, '应检测到 reset 异常（大题组标题漏识别）')
}

console.log(`\n${YELLOW}=== 测试 7: 跨批 OCR 状态传递 + 异常累积 ===${RESET}`)
{
  // 第一页：试卷① 19.1 + 1, 2, 3
  // 第二页：试卷② 19.2 + 1, 2（无异常，state 应透传）
  // 第三页：试卷③ 19.3 + 1, 2, 3（无异常）
  // 模拟 parseAnswerText 跨批调用（用 lastState 透传）
  const lowConf = []
  let state = null

  const text1 = ['试卷① 19.1 平方根与立方根 基础性测试', '1. A', '2. B', '3. C'].join('\n')
  const r1 = parseAnswerText(text1, lowConf, state, 1)
  state = r1.lastState

  const text2 = ['试卷② 19.2(1) 二次根式的性质', '1. D', '2. E'].join('\n')
  const r2 = parseAnswerText(text2, lowConf, state, 2)
  state = r2.lastState

  const text3 = ['试卷③ 19.3(1) 二次根式的应用', '1. F', '2. G', '3. H'].join('\n')
  const r3 = parseAnswerText(text3, lowConf, state, 3)
  state = r3.lastState  // 透传到下一次调用

  const total = r1.answers.length + r2.answers.length + r3.answers.length
  const anomalies = findAnomalies(lowConf)
  console.log(`  三批总解析 ${total} 条答案，异常数 ${anomalies.length}`)
  assert(total === 8, '应解析 8 条答案')
  assert(anomalies.length === 0, '正常跨单元跨批应无异常')
  // unit_key 形如 '试卷3|19.3(1)'（ordinal 用阿拉伯数字，便于 SQL 排序）
  assert(state.unit?.unit_key?.startsWith('试卷3|19.3(1)') === true, `lastState.unit 应指向试卷3 19.3(1)，实际: ${state.unit?.unit_key}`)
}

console.log(`\n${YELLOW}=== 测试 8: 综合场景 - 试卷① 答案全挂到试卷②（用户截图实例） ===${RESET}`)
{
  // 模拟用户场景：AI 漏识别"试卷① 19.1..."，把试卷①的题 1-15 全部挂到试卷② 19.2
  // 然后试卷②的题 1-5 又被读出来（如果 AI 漏识别试卷②，则不会读）
  // 这里简化：试卷① + 1-15 (实际是试卷②的题 1-5 + 试卷①的 6-15) + 试卷② + 1-5
  // 测得：同 unit_key='试卷①' 内出现题号 1-15（看起来正常），但跨大题组"二、选择题"可能漏识别
  // 这里我们构造：试卷① 1, 2, 3, 1, 2, 3, 4（同 group 重置多次）
  const text = [
    '试卷① 19.1 平方根与立方根 基础性测试',
    '一、填空题',
    '1. A',
    '2. B',
    '3. C',
    '1. D',  // 漏识别"二、选择题"
    '2. E',
    '3. F',
    '4. G',
  ].join('\n')
  const lowConf = []
  const result = parseAnswerText(text, lowConf)
  const anomalies = findAnomalies(lowConf)
  console.log(`  解析到 ${result.answers.length} 条答案`)
  console.log(`  异常数: ${anomalies.length}`)
  console.log(`  异常示例: ${anomalies[0]?.message}`)
  const resetAnoms = anomalies.filter(a => a.reason === 'reset')
  assert(resetAnoms.length >= 1, '应检测到 reset 异常（漏识别大题组标题）')
}

console.log(`\n${YELLOW}=== 总结 ===${RESET}`)
console.log(`${GREEN}通过: ${pass}${RESET}`)
console.log(`${fail > 0 ? RED : GREEN}失败: ${fail}${RESET}`)
process.exit(fail > 0 ? 1 : 0)
