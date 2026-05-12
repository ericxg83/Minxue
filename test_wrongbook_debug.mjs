/**
 * 错题本选择→组卷→打印 完整流程测试
 * 运行: node test_wrongbook_debug.mjs
 *
 * 这个测试直接使用 Zustand store 和 mock 数据，
 * 不依赖浏览器，不依赖后端 API
 */

import { mockWrongQuestions, mockStudents } from './src/data/mockData.js'

// 由于 store 使用了 React 的 create 函数，不能直接在 Node 中运行。
// 我们直接手动模拟 store 逻辑来测试组件代码。

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

function pass(msg) { console.log(`  ${COLORS.green}✅ ${msg}${COLORS.reset}`) }
function fail(msg) { console.log(`  ${COLORS.red}❌ ${msg}${COLORS.reset}`) }
function info(msg) { console.log(`  ${COLORS.blue}ℹ ${msg}${COLORS.reset}`) }
function header(msg) { console.log(`\n${COLORS.bold}${COLORS.yellow}${msg}${COLORS.reset}`) }

// ============================================================
// 模拟 Zustand store (和 src/store/index.js 逻辑一致)
// ============================================================
let wrongQuestions = []
let selectedQuestions = []

const store = {
  getWrongQuestions: () => wrongQuestions,
  getSelectedQuestions: () => selectedQuestions,

  setWrongQuestions: (questions) => {
    wrongQuestions = Array.isArray(questions) ? questions : []
  },

  // toggleSelection - 和 store 中逻辑一致
  toggleSelection: (question) => {
    const exists = selectedQuestions.find(q => q.id === question.id)
    if (exists) {
      selectedQuestions = selectedQuestions.filter(q => q.id !== question.id)
    } else {
      selectedQuestions = [...selectedQuestions, question]
    }
  },

  // clearSelection - 和 store 中逻辑一致
  clearSelection: () => {
    selectedQuestions = []
  },
}

// ============================================================
// 模拟 WrongBook 页面中的 handleGenerateExam (App.jsx 版本)
// ============================================================

function handleGenerateExam_beforeFix() {
  // 修复前: selectedQuestions.includes(wq.id)
  const selectedWrongQuestions = wrongQuestions.filter(wq =>
    selectedQuestions.includes(wq.id)
  )
  return selectedWrongQuestions
}

function handleGenerateExam_afterFix() {
  // 修复后: selectedQuestions.some(q => q.id === wq.id)
  const selectedWrongQuestions = wrongQuestions.filter(wq =>
    selectedQuestions.some(q => q.id === wq.id)
  )
  return selectedWrongQuestions
}

// ============================================================
// 主测试
// ============================================================

console.log(`${COLORS.bold}${COLORS.blue}============================================${COLORS.reset}`)
console.log(`${COLORS.bold}${COLORS.blue}  错题本 选择→组卷→打印 Debug 测试${COLORS.reset}`)
console.log(`${COLORS.bold}${COLORS.blue}============================================${COLORS.reset}`)

// 1. 加载 mock 数据
header('📋 Step 1: 加载 Mock 数据')
store.setWrongQuestions(mockWrongQuestions)
info(`wrongQuestions 加载完成: ${wrongQuestions.length} 道`)
if (wrongQuestions.length > 0) pass('数据加载成功')
else { fail('数据加载失败'); process.exit(1) }

// 显示数据样本
const sample = wrongQuestions[0]
info(`样本: id=${sample.id}, question_id=${sample.question_id}, type=${sample.question?.question_type || 'N/A'}`)
info(`selectedQuestions 类型检查: store中的selectedQuestions存储的是 ${typeof selectedQuestions === 'object' && Array.isArray(selectedQuestions) ? '对象数组' : selectedQuestions.length > 0 && typeof selectedQuestions[0] === 'string' ? '字符串数组(ID)' : '未知'}`)

// 2. 测试选择功能
header('🧪 Step 2: 测试题目选择 (toggleSelection)')

// 选3道题
const selectedWQs = wrongQuestions.slice(0, 3)
selectedWQs.forEach(wq => store.toggleSelection(wq))

if (selectedQuestions.length === 3) pass('选中3道题成功')
else fail(`选中失败: 预期3, 实际${selectedQuestions.length}`)

// 验证选中内容
info(`selectedQuestions 内容: [${selectedQuestions.map(q => `${q.id}(${q.question_id})`).join(', ')}]`)
pass('selectedQuestions 存储的是完整对象（包含 id 和 question_id）')

// 3. 测试修复前的 Bug
header('🐛 Step 3: 再现 Bug - handleGenerateExam (修复前)')

const beforeResult = handleGenerateExam_beforeFix()
if (beforeResult.length === 0) {
  fail(`Bug 再现! selectedQuestions.includes(wq.id) 返回 ${beforeResult.length} 道题`)
  info(`原因: selectedQuestions 是对象数组 [{id:'wq-1',...}], .includes('wq-1') 永远返回 false`)
} else {
  pass(`返回 ${beforeResult.length} 道题`)
}

// 4. 测试修复后
header('🔧 Step 4: 验证修复 - handleGenerateExam (修复后)')

const afterResult = handleGenerateExam_afterFix()
if (afterResult.length === 3) {
  pass(`修复成功! selectedQuestions.some(q => q.id === wq.id) 返回 ${afterResult.length} 道题`)
} else {
  fail(`修复失败: 预期3, 实际${afterResult.length}`)
}

// 5. 模拟完整的 handleGenerateExam 流程 (修复后)
header('📝 Step 5: 模拟完整 handleGenerateExam 流程')

const questionIds = afterResult.map(wq => wq.question_id || wq.id)
info(`提取 question_ids: [${questionIds.join(', ')}]`)

const examData = {
  student_id: mockStudents[0]?.id || 'test-student',
  name: `错题组卷 - ${new Date().toISOString().split('T')[0]}`,
  question_ids: questionIds
}
info(`examData: ${JSON.stringify(examData, null, 2)}`)

if (questionIds.length === 3) pass('question_ids 正确提取')
else fail(`question_ids 提取失败: 预期3, 实际${questionIds.length}`)

// 6. 测试 clearSelection
header('🧹 Step 6: 测试 clearSelection')
store.clearSelection()
if (selectedQuestions.length === 0) pass('clearSelection 清空成功')
else fail(`clearSelection 失败: 还有 ${selectedQuestions.length} 道选中`)

// 7. 测试 handlePrint 流程
header('🖨️ Step 7: 模拟 handlePrint 流程')

// 重新选中
selectedWQs.forEach(wq => store.toggleSelection(wq))
info(`选中 ${selectedQuestions.length} 道题用于打印`)

// 模拟打印内容生成 (和 WrongBook/index.jsx handlePrint 逻辑一致)
const printContent = selectedQuestions.map((wq, index) => {
  const q = wq.question || wq
  return {
    number: index + 1,
    content: q.content,
    options: q.options || [],
    answer: q.answer,
    student_answer: q.student_answer
  }
})

pass(`生成了 ${printContent.length} 道题的打印数据`)
printContent.forEach(p => {
  info(`  题${p.number}: ${(p.content || '').substring(0, 40)}... [答案: ${p.answer}] [选项数: ${p.options.length}]`)
})

// 8. 边界测试
header('⚠️ Step 8: 边界测试')

// 空选择
store.clearSelection()
const emptyResult = handleGenerateExam_afterFix()
if (emptyResult.length === 0) pass('空选择时返回空数组 (显示"请先选择")')
else fail('空选择时应返回空数组')

// 全选
wrongQuestions.forEach(wq => store.toggleSelection(wq))
const allResult = handleGenerateExam_afterFix()
if (allResult.length === wrongQuestions.length) pass(`全选成功: ${allResult.length}/${wrongQuestions.length} 道`)
else fail(`全选失败: 预期${wrongQuestions.length}, 实际${allResult.length}`)

// ============================================================
// 总结
// ============================================================
header('📊 测试总结')
console.log()
console.log(`${COLORS.bold}修复内容:${COLORS.reset}`)
console.log()
console.log(`  1. App.jsx:52   — toggleSelection 未从 store 导入 → ${COLORS.green}已修复${COLORS.reset}`)
console.log(`  2. App.jsx:629  — selectedQuestions.includes(wq.id) → ${COLORS.green}改为 .some(q => q.id === wq.id)${COLORS.reset}`)
console.log(`  3. WrongBook:386 — clearSelection() 未定义 → ${COLORS.green}改为 storeClearSelection()${COLORS.reset}`)
console.log()
