// 练习册答案解析 + 章节匹配 单元验证
import { parseAnswerText, splitInlineAnswers, normalizeSectionName } from '../services/answerParseService.js'

let pass = 0, fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n  expect: ${e}\n  actual: ${a}`) }
}

// ── splitInlineAnswers ──
eq(splitInlineAnswers('13. D 14. C 15. C 16. B 17. B'),
   ['13. D', '14. C', '15. C', '16. B', '17. B'], '行内选择题拆分')

eq(splitInlineAnswers('19. 2 因素；20. 1/10'),
   ['19. 2 因素', '20. 1/10'], '分号拆分')

eq(splitInlineAnswers('18. (1) 18.360 (2) 125.625 (3) 1.210 (4) 2.120'),
   ['18. (1) 18.360 (2) 125.625 (3) 1.210 (4) 2.120'], '小数不误拆')

eq(splitInlineAnswers('25. 3.5元 26. 14'),
   ['25. 3.5元', '26. 14'], '小数+单位后接下一题')

eq(splitInlineAnswers('1. 2017 2019 2. 0 0,1,2,3,4 3. 0 5'),
   ['1. 2017 2019', '2. 0 0,1,2,3,4', '3. 0 5'], '单空格多题拆分')

eq(splitInlineAnswers('9. 13 15 17 10. 7,14,21,42 11. 170 12. 9 350'),
   ['9. 13 15 17', '10. 7,14,21,42', '11. 170', '12. 9 350'], '数字答案接题号')

eq(splitInlineAnswers('22. 小杰最先到达 23. 7/20 24. 1/8, 2/3'),
   ['22. 小杰最先到达', '23. 7/20', '24. 1/8, 2/3'], '中文答案接题号')

eq(splitInlineAnswers('4. 14 2310'),
   ['4. 14 2310'], '大数字不被当题号（跳跃>30）')

eq(splitInlineAnswers('10. 7和13 11. 99=3×3×11 12. 44'),
   ['10. 7和13', '11. 99=3×3×11', '12. 44'], '含乘号表达式')

eq(splitInlineAnswers('5. 1,2,3,4,6,8,12,24 6. 12'),
   ['5. 1,2,3,4,6,8,12,24', '6. 12'], '逗号序列不误拆')

// 题号必须递增：答案里的 "3." 不是下一题
eq(splitInlineAnswers('8. 3 7 13 3(答案不唯一) 9. 25 74'),
   ['8. 3 7 13 3(答案不唯一)', '9. 25 74'], '递增校验')

// ── parseAnswerText ──
const text1 = `第一章阶段练1
1. 2017 2019 2. 0 3. 0 5
13. D 14. C 15. C 16. B 17. B
第一章阶段练2
1. 1 2 4
13. B 14. C 15. B 16. B 17. C`
const r1 = parseAnswerText(text1, [])
const s1 = r1.answers.filter(a => a.section === '第一章阶段练1')
const s2 = r1.answers.filter(a => a.section === '第一章阶段练2')
eq(s1.length, 8, '章节1条目数')
eq(s2.length, 6, '章节2条目数')
eq(s1.find(a => a.question_no === 13)?.answer, 'D', '章节1第13题=D')
eq(s1.find(a => a.question_no === 13)?.answer_type, 'choice', '章节1第13题为choice')
eq(s2.find(a => a.question_no === 13)?.answer, 'B', '章节2第13题=B')
eq(r1.lastSection, '第一章阶段练2', 'lastSection 传出')

// 跨页章节延续
const page2 = `18. 120=2×2×2×3×5
19. 略`
const r2 = parseAnswerText(page2, [], r1.lastSection)
eq(r2.answers[0].section, '第一章阶段练2', '跨页章节延续')

// 判断题
const r3 = parseAnswerText('13. ×\n14. √\n15. ×', [])
eq(r3.answers.map(a => a.answer_type), ['judge', 'judge', 'judge'], '判断题类型')
eq(r3.answers.map(a => a.answer), ['×', '√', '×'], '判断题答案')

// 章节名归一化
eq(normalizeSectionName('第一章阶段练 3'), '第一章阶段练3', '章节空格归一化')
eq(normalizeSectionName('第二章评价测试卷：说明文字'), '第二章评价测试卷', '冒号截断')

// 连续选择题
const r4 = parseAnswerText('13-17 ABCDB', [])
eq(r4.answers.length, 5, '连续选择题条数')
eq(r4.answers[4].answer, 'B', '连续选择题末位')

// ── pickAnswerSection（worker 章节匹配）──
const { pickAnswerSection } = await import('../worker.js').catch(() => ({}))
if (pickAnswerSection) {
  const bySection = new Map([
    ['第一章阶段练1', new Map([[1, { answer: '2017 2019', answer_type: 'answer' }], [13, { answer: 'D', answer_type: 'choice' }], [14, { answer: 'C', answer_type: 'choice' }]])],
    ['第一章阶段练3', new Map([[1, { answer: '63', answer_type: 'answer' }], [13, { answer: 'A', answer_type: 'choice' }], [14, { answer: 'A', answer_type: 'choice' }]])],
  ])
  eq(pickAnswerSection(bySection, '第一章阶段练 3', [{ question_number: 1 }]), '第一章阶段练3', '标题匹配（含空格归一）')
  eq(pickAnswerSection(bySection, '第一章 阶段练1', [{ question_number: 13 }]), '第一章阶段练1', '标题匹配2')
  eq(pickAnswerSection(bySection, null, [{ question_number: 1 }, { question_number: 13, question_type: 'choice' }, { question_number: 14, question_type: 'choice' }]), '第一章阶段练1', '无标题时按覆盖率打分取首个')
  eq(pickAnswerSection(bySection, null, [{ question_number: 88 }, { question_number: 99 }]), null, '覆盖率过低返回null')
} else {
  console.log('（跳过 pickAnswerSection：worker.js 需要环境依赖）')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
