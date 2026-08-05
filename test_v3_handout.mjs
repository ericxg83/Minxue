// V3 教学讲义生成逻辑测试（纯函数 + docx 打包）
// 用假数据构建讲义 paper，验证页面/表格/例题结构，并真正用 docx 打包生成 blob

import { buildHandoutPaper, adviceFor } from './src/utils/teachingHandoutCore.js'
import { Document, Packer } from 'docx'

const assert = (cond, label) => {
  if (cond) console.log(`  ✅ ${label}`)
  else { console.error(`  ❌ ${label}`); process.exitCode = 1 }
}

console.log('== 1. 错因建议文案 ==')
assert(adviceFor('计算错误') === '回归运算法则，强调竖式对齐与进位退位，做限时口算/笔算训练', '计算错误 → 有具体建议')
assert(adviceFor('不会分析').includes('分步'), '不会分析 → 有具体建议')
assert(adviceFor('某种未知名') === '回归知识点讲解，结合典型例题强化训练', '未知错因 → 兜底建议')
assert(adviceFor('') === '回归知识点讲解，结合典型例题强化训练', '空错因 → 兜底建议')

console.log('== 2. 构造假数据并构建讲义 ==')
const diagnosis = [
  { subject: '数学', tag: '分数乘法', blankCount: 4, wrongCount: 12, studentCount: 6, blankRatio: 25 },
  { subject: '数学', tag: '一元一次方程', blankCount: 0, wrongCount: 9, studentCount: 4, blankRatio: 0 },
]
const details = {
  '分数乘法': {
    tag: '分数乘法', totalWrong: 12,
    errorDist: [
      { errorType: '计算错误', count: 5, ratio: 42 },
      { errorType: '未标注', count: 7, ratio: 58 }
    ],
    students: [{ name: '张三', grade: '六年级', blankCount: 2, wrongCount: 4 }],
    sampleQuestions: [
      { content: '计算 3/4 × 5/6 = ?', correctAnswer: '5/8', studentAnswer: '3/8', isBlank: false, errorType: '计算错误', errorReason: '分子分母交叉相乘', studentName: '张三' },
      { content: '计算 7/8 × 2/3 = ?', correctAnswer: '7/12', studentAnswer: '', isBlank: true, errorType: null, errorReason: null, studentName: '李四' }
    ]
  },
  '一元一次方程': {
    tag: '一元一次方程', totalWrong: 9,
    errorDist: [{ errorType: '不会分析', count: 9, ratio: 100 }],
    students: [{ name: '王五', grade: '六年级', blankCount: 0, wrongCount: 9 }],
    sampleQuestions: [
      { content: '解方程 2x + 5 = 17', correctAnswer: 'x=6', studentAnswer: 'x=11', isBlank: false, errorType: '不会分析', errorReason: '移项未变号', studentName: '王五' }
    ]
  }
}

const paper = buildHandoutPaper({ diagnosis, details, periodText: '第32周 08/03 ~ 08/09', maxItems: 10 })

assert(paper.name === '周学习诊断教学讲义', '讲义名称')
assert(paper.pages.length === diagnosis.length + 1, `页数 = 封面 + ${diagnosis.length} 个知识点（实际 ${paper.pages.length}）`)

// 封面页
const cover = paper.pages[0]
const coverTypes = cover.layoutBlocks.map(b => b.type)
assert(coverTypes.includes('table'), '封面含概览表')
assert(cover.layoutBlocks.find(b => b.type === 'table').rows.length === diagnosis.length + 1, '概览表行数 = 表头 + 知识点数')
assert(coverTypes.includes('section'), '封面含"重点知识点"章节')

// 知识点页
const page1 = paper.pages[1]
const p1Types = page1.layoutBlocks.map(b => b.type)
assert(p1Types.includes('section'), '知识点页含章节标题')
assert(p1Types.includes('question'), '知识点页含例题（question 区块）')
const qBlocks = page1.layoutBlocks.filter(b => b.type === 'question')
assert(qBlocks.length === details['分数乘法'].sampleQuestions.length, `例题数量正确（${qBlocks.length} 道）`)
const p1Table = page1.layoutBlocks.find(b => b.type === 'table')
assert(p1Table.rows[0].includes('讲什么'), '错因表含"讲什么"列')
assert(p1Table.rows.length === details['分数乘法'].errorDist.length + 1, '错因表行数 = 表头 + 错因项数')

// 空题例题有"当堂"提示
const texts = page1.layoutBlocks.filter(b => b.type === 'text').map(b => b.content).join('')
assert(texts.includes('当堂请学生口述思路'), '空题例题含课堂提醒')

// 全部 page 都有 name 占位
assert(paper.pages.every(p => Array.isArray(p.layoutBlocks)), '所有页都有 layoutBlocks')

console.log('== 3. docx 打包能力（docx 库可用性） ==')
const doc = new Document({
  sections: [{ children: [{ text: 'test' }] }],
})
const blob = await Packer.toBlob(doc)
assert(blob && blob.size > 0, `docx 库打包成功，blob ${(blob.size / 1024).toFixed(1)} KB`)

console.log('\n🎉 V3 教学讲义生成逻辑测试完成')
process.exit(process.exitCode || 0)
