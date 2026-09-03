/**
 * aiParseSelfCheck 的 answer_sign_mismatch 检测单测。
 *
 * 线上事故：用户截图题"√81的平方根是____"，学生答 ±3、AI 参考答案 9。
 * 现有自检只抓 serial_pollution / arithmetic_mismatch / self_check_skipped 三类，
 * 漏掉"学生写 ± AI 没写"这种符号集合冲突。
 *
 * 规则（仅单向，避免误伤多空填空）：
 *   - 学生答案含 ± 且 AI answer 不含 ± → flag answer_sign_mismatch
 *   - 学生答案不含 ± 时无论 AI 是否含 ± 都不报
 *   - answer 为 null / 空字符串时跳过（无标准答案不参与判定）
 */
import { aiParseSelfCheck } from '../utils/aiParseSelfCheck.js'

const cases = [
  // ── 主路径：学生 ±N vs AI N（必须 flag） ──
  {
    name: '主路径: 学生 ±3 vs AI 9（√81 的平方根场景）',
    input: { answer: '9', student_answer: '±3', analysis: '√81=9，平方根是±3' },
    expectIssues: ['answer_sign_mismatch'],
  },
  {
    name: '主路径: 学生 ±12 vs AI 12（符号漏判）',
    input: { answer: '12', student_answer: '±12', analysis: '解为 ±12' },
    expectIssues: ['answer_sign_mismatch'],
  },
  {
    name: '主路径: 多空题第一空含 ±',
    input: { answer: '3', student_answer: '±3, 4', analysis: '两空：±3 与 4' },
    expectIssues: ['answer_sign_mismatch'],
  },
  {
    name: '主路径: 含 ±√ 形态（±√2）',
    input: { answer: '√2', student_answer: '±√2', analysis: '解为 ±√2' },
    expectIssues: ['answer_sign_mismatch'],
  },

  // ── 双向都不含 ±：不 flag ──
  {
    name: '回归: 学生答对无 ±',
    input: { answer: '3', student_answer: '3', analysis: '代入 x=1: 2*1+1=3，最终答案为 3' },
    expectIssues: [],
  },
  {
    name: '回归: 学生答错无 ±',
    input: { answer: '9', student_answer: '3', analysis: '代入 x=1: 2*1+1=3，最终答案为 3' },
    expectIssues: [],
  },
  {
    name: '回归: 纯文字判断题',
    input: { answer: '正确', student_answer: '错误', analysis: '题目无算式，最终答案为 正确' },
    expectIssues: [],
  },
  {
    name: '回归: 多空题都不含 ±',
    input: { answer: '3, 4', student_answer: '3, 5', analysis: '代入 x=1: 2*1+1=3，代入 x=2: 2*2+0=4，最终答案为 3, 4' },
    expectIssues: [],
  },

  // ── 双向都含 ±：不 flag ──
  {
    name: '回归: 学生 AI 都写 ±（一致）',
    input: { answer: '±3', student_answer: '±3', analysis: '平方根是 ±3' },
    expectIssues: [],
  },
  {
    name: '回归: 学生 AI 都写 ± 但符号值不同（学生答错，不归 sign_mismatch）',
    input: { answer: '±3', student_answer: '±5', analysis: '平方根是 ±3' },
    expectIssues: [],
  },

  // ── 学生不含 ± 但 AI 含 ±：不 flag（学生可能漏写 ±，保守不报） ──
  {
    name: '保守: 学生漏写 ± 不报（避免误伤）',
    input: { answer: '±3', student_answer: '3', analysis: '平方根是 ±3' },
    expectIssues: [],
  },

  // ── answer 为 null / 空：跳过 sign_mismatch 检查 ──
  {
    name: '边界: answer=null 不报',
    input: { answer: null, student_answer: '±3', analysis: '题目无标准答案' },
    expectIssues: [],
  },
  {
    name: '边界: answer="" 不报',
    input: { answer: '', student_answer: '±3', analysis: '题目无标准答案' },
    expectIssues: [],
  },

  // ── student_answer 非字符串：跳过（防御性） ──
  {
    name: '边界: student_answer=null 不报',
    input: { answer: '9', student_answer: null, analysis: '题目无学生答案' },
    expectIssues: [],
  },
]

let pass = 0
let fail = 0

for (const { name, input, expectIssues } of cases) {
  const result = aiParseSelfCheck(input)
  const issues = result.issues || []
  const actualSorted = [...issues].sort().join(',')
  const expectSorted = [...expectIssues].sort().join(',')

  // sign_mismatch 可以和其他已知 issue 并存；这里只检查"期望的 issue 都出现了"
  const allExpectedPresent = expectIssues.every(i => issues.includes(i))
  // sign_mismatch 不应误报（当期望为空时 issues 必须为空）
  const noUnexpected = expectIssues.length === 0 ? issues.length === 0 : true

  if (allExpectedPresent && noUnexpected) {
    pass++
    console.log(`✅ ${name}`)
  } else {
    fail++
    console.log(`❌ ${name}`)
    console.log(`   期望 issues: [${expectSorted}]`)
    console.log(`   实际 issues: [${actualSorted}]`)
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)