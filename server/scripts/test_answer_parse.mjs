// 练习册答案解析 + 章节匹配 单元验证
import { parseAnswerText, splitInlineAnswers, normalizeSectionName, parseUnitHeader, splitSubAnswers } from '../services/answerParseService.js'

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
// 迁移 032 后：section = 大题组（如"一、填空题"）；unit_key/unit_title = 章节/练习单元。
// 旧测试断言"section===章节名"已不再适用，下面改用 unit_title。
const text1 = `第一章阶段练1
1. 2017 2019 2. 0 3. 0 5
13. D 14. C 15. C 16. B 17. B
第一章阶段练2
1. 1 2 4
13. B 14. C 15. B 16. B 17. C`
const r1 = parseAnswerText(text1, [])
const s1 = r1.answers.filter(a => a.unit_title === '第一章阶段练1')
const s2 = r1.answers.filter(a => a.unit_title === '第一章阶段练2')
eq(s1.length, 8, '章节1条目数（按 unit_title）')
eq(s2.length, 6, '章节2条目数（按 unit_title）')
eq(s1.find(a => a.question_no === 13)?.answer, 'D', '章节1第13题=D')
eq(s1.find(a => a.question_no === 13)?.answer_type, 'choice', '章节1第13题为choice')
eq(s2.find(a => a.question_no === 13)?.answer, 'B', '章节2第13题=B')
eq(r1.lastSection, '第一章阶段练2', 'lastSection 传出')

// 跨页章节延续（用 lastState 跨页传递，承载 {unit, group}）
const page2 = `18. 120=2×2×2×3×5
19. 略`
const r2 = parseAnswerText(page2, [], r1.lastState)
eq(r2.answers[0].unit_title, '第一章阶段练2', '跨页章节延续（用 lastState）')

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

// ── pickAnswerUnit（worker 单元匹配）──
// 新签名：3D Map<unitKey, Map<sectionKey, Map<`qNo|sub`, row>>> + pageTitle + questions → unitKey | null
// 旧 pickAnswerSection 仍存在但仅返回 null，业务已切到 pickAnswerUnit
const { pickAnswerUnit, pickAnswerSection } = await import('../worker.js').catch(() => ({}))
if (pickAnswerUnit) {
  // 构造 3D 测试数据
  const byUnit = new Map([
    ['unit-A', new Map([
      ['一、填空题', new Map([
        ['1|', { answer: '2017 2019', answer_type: 'answer', unit_title: '堂堂练①19.1(1)算术平方根', unit_key: '堂堂练1|19.1(1)' }],
        ['13|', { answer: 'D', answer_type: 'choice', unit_title: '堂堂练①19.1(1)算术平方根', unit_key: '堂堂练1|19.1(1)' }],
        ['14|', { answer: 'C', answer_type: 'choice', unit_title: '堂堂练①19.1(1)算术平方根', unit_key: '堂堂练1|19.1(1)' }],
      ])],
    ])],
    ['unit-B', new Map([
      ['一、填空题', new Map([
        ['1|', { answer: '63', answer_type: 'answer', unit_title: '堂堂练②19.1(2)平方根', unit_key: '堂堂练2|19.1(2)' }],
        ['13|', { answer: 'A', answer_type: 'choice', unit_title: '堂堂练②19.1(2)平方根', unit_key: '堂堂练2|19.1(2)' }],
        ['14|', { answer: 'A', answer_type: 'choice', unit_title: '堂堂练②19.1(2)平方根', unit_key: '堂堂练2|19.1(2)' }],
      ])],
    ])],
  ])
  // 关键：两个单元都含"一、填空题 第 1 题"，但答案不同
  // 旧版本会因 section 同名互相覆盖，新版本按 unit 区分
  eq(pickAnswerUnit(byUnit, '堂堂练②  19.1(2) 平方根', [{ question_number: 1 }, { question_number: 13 }]),
     'unit-B', '按单元标题精确匹配 → 选 unit-B')
  eq(pickAnswerUnit(byUnit, '堂堂练① 19.1(1) 算术平方根', [{ question_number: 1 }, { question_number: 13 }]),
     'unit-A', '按单元标题精确匹配 → 选 unit-A')
  // 覆盖率门槛 60%：3 个题号只有 1 个命中 → 应返回 null
  eq(pickAnswerUnit(byUnit, null, [{ question_number: 1 }, { question_number: 88 }, { question_number: 99 }]),
     null, '覆盖率过低返回 null')
  // 唯一单元：直接用
  eq(pickAnswerUnit(new Map([['only', byUnit.get('unit-A')]]), null, [{ question_number: 1 }]),
     'only', '唯一单元直接命中')
  // 旧 API 已弃用，恒返回 null
  eq(typeof pickAnswerSection, 'function', 'pickAnswerSection 仍导出（兼容旧 import）')
} else {
  console.log('（跳过 pickAnswerUnit：worker.js 需要环境依赖）')
}

// ── parseUnitHeader（练习单元识别）──
eq(parseUnitHeader('堂堂练① 19.1(1) 算术平方根'),
   { unit_key: '堂堂练1|19.1(1)', unit_title: '堂堂练①19.1(1)算术平方根', lesson_code: '19.1(1)', ordinal: 1 }, '堂堂练+圈序号+课时编号')
eq(parseUnitHeader('堂堂练⑩ 21.2(3) 一般的一元二次方程的解法')?.unit_key, '堂堂练10|21.2(3)', '圈序号⑩=10')
eq(parseUnitHeader('19.1(1) 算术平方根'),
   { unit_key: '19.1(1)', unit_title: '19.1(1)算术平方根', lesson_code: '19.1(1)', ordinal: null }, '纯课时编号行（不被 /^\\d/ 早退吃掉）')
eq(parseUnitHeader('第十九章实数')?.unit_key, '第十九章实数', '章级标题仍是单元')
eq(parseUnitHeader('第3课时 二次根式的加减')?.unit_key, '第3课时', '第N课时')
// 不能误判成单元的答案行
eq(parseUnitHeader('1. 2017 2019'), null, '普通答案行不误判')
eq(parseUnitHeader('19. 1/10'), null, '带小数答案不误判')
eq(parseUnitHeader('18. (1) 18.360 (2) 125.625'), null, '多空答案行不误判')
eq(parseUnitHeader('二、选择题'), null, '大题标题不算单元')

// ── splitSubAnswers（子题拆分）──
eq(splitSubAnswers('(1)7/2 (2)4/3 (3)0.9 (4)0.8'),
   [{ sub_no: '1', answer: '7/2' }, { sub_no: '2', answer: '4/3' }, { sub_no: '3', answer: '0.9' }, { sub_no: '4', answer: '0.8' }], '四空拆分')
eq(splitSubAnswers('(1)√ (2)×'), [{ sub_no: '1', answer: '√' }, { sub_no: '2', answer: '×' }], '判断题子题')
eq(splitSubAnswers('(x+1)(x-2)'), null, '因式分解不误拆')
eq(splitSubAnswers('7/2'), null, '单答案不拆')
eq(splitSubAnswers('原式=2(1)+3'), null, '括号不在行首不拆')

// 子题拆分接入 parseAnswerText
const r5 = parseAnswerText('堂堂练① 19.1(1) 算术平方根\n2.(1)7/2 (2)4/3 (3)0.9 (4)0.8', [])
eq(r5.answers.length, 4, '多空题落成 4 条')
eq(r5.answers.map(a => a.sub_no), ['1', '2', '3', '4'], 'sub_no 依次为 1..4')
eq(r5.answers.every(a => a.question_no === 2), true, '同属第 2 题')
eq(r5.answers[0].unit_key, '堂堂练1|19.1(1)', '子题带上单元键')
eq(r5.answers[0].lesson_code, '19.1(1)', '子题带上课时编号')

// 单元跨页延续
const r6 = parseAnswerText('1. A\n2. B', [], r5.lastUnit)
eq(r6.answers[0].unit_key, '堂堂练1|19.1(1)', '跨页单元延续')

// 同名题号在不同单元不再互相覆盖
const r7 = parseAnswerText('堂堂练① 19.1(1) 算术平方根\n1. A\n堂堂练② 19.1(2) 平方根\n1. B', [])
eq(r7.answers.length, 2, '两单元同题号并存')
eq(r7.answers.map(a => a.unit_key), ['堂堂练1|19.1(1)', '堂堂练2|19.1(2)'], '单元键区分')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
