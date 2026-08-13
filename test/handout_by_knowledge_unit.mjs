// ============================================================
// 按知识点生成讲义 —— 纯逻辑单元测试
// 跑法：node test/handout_by_knowledge_unit.mjs
//
// 不依赖 DB：只测 buildKpMatchWords / mapWrongRowsToSamples 两个纯函数。
// （fetchWrongSamplesForKp / collectKnowledgeSections 依赖 Neon，见联调验收）
// ============================================================

import {
  buildKpMatchWords,
  mapWrongRowsToSamples,
} from '../server/services/handoutByKnowledgeService.js'

let failures = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.log(`  ❌ ${name}\n     期望: ${e}\n     实际: ${a}`)
  }
}

// ── 1) buildKpMatchWords ──
check('匹配词 = name + 同义词（去空去重）',
  buildKpMatchWords({ name: '一元一次方程', synonyms: ['一元一次方程的解法', '等式的性质', ''] }),
  ['一元一次方程', '一元一次方程的解法', '等式的性质'])

check('匹配词过滤 <2 字同义词 & 压缩空白（单字 name 保留）',
  buildKpMatchWords({ name: '圆', synonyms: ['圆周角 定理', '弧', '弦'] }),
  ['圆', '圆周角定理'])

check('无同义词时仅 name',
  buildKpMatchWords({ name: '一元二次方程', synonyms: [] }),
  ['一元二次方程'])

check('空节点返回空数组',
  buildKpMatchWords(null),
  [])

// ── 2) mapWrongRowsToSamples ──
const row = {
  question_id: 'q-1',
  content: '解方程 3x+1=7',
  options: null,
  question_type: 'answer',
  pdf_url: null,
  image_url: 'http://img/1.png',
  student_answer: 'x=2',
  correct_answer: 'x=2',
  is_blank: false,
  error_type: '计算错误',
  error_reason: '移项忘变号',
  student_name: '小明',
}
check('样本字段映射 + imageUrls 过滤空值',
  mapWrongRowsToSamples([row]),
  [{
    questionId: 'q-1',
    content: '解方程 3x+1=7',
    options: null,
    questionType: 'answer',
    imageUrls: ['http://img/1.png'],
    studentAnswer: 'x=2',
    correctAnswer: 'x=2',
    isBlank: false,
    errorType: '计算错误',
    errorReason: '移项忘变号',
    studentName: '小明',
  }])

check('空数组返回空数组', mapWrongRowsToSamples([]), [])

console.log(failures === 0 ? '\n🎉 按知识点生成讲义纯逻辑通过' : `\n💥 ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
