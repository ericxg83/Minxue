// 回归测试：答案册「章级测试卷」标题必须被识别，且（一）/（二）不得并成同一单元
//
// 事故背景（2026-09-16 八上数学_上海作业 56 页）：
//   答案册印刷 161 页（PDF p5）末尾是「第19章测试(一)」的答案（1~11、12~25…），
//   印刷 162 页（PDF p6）开头是它的续题（26、27），随后是「第 19 章测试 (二)」标题
//   + 测试(二) 的 1~25 题答案。
//   OCR 把该标题输出为「第 19 章测试 (二)」（第/数字/章 之间带空白），而旧正则
//   `/^第[一二三四五六七八九十\d]+[章节单元部分篇]/` **不容忍空白** → 整行不是单元标题，
//   被当噪声丢弃 → 测试(二) 的 1~25 题全部**继承上一个单元 第19章测试(一)**，
//   并按题号 UPSERT **覆盖**了测试(一) 的真实答案。
//
//   后果（陈昊煜 0e1d4de7 / 朱思诺 cc7a292b / 赵安迪 2521ad56 三份「第19章测试(一)」卷）：
//   参考答案栏给出的全是测试(二) 的值 —— 卷面「0.23̇ 化分数」的答案显示成「2π 或 -2π」，
//   「√25 的算术平方根」显示成「2-√5」，22 题里 15 题被判错，老师要逐题手工核对。
//
// 本测试锁定三件事：
//   ① 「第 N 章 XX（一/二）」带空白形态必须被识别，并归一到无空白 key；
//   ② 全角括号与半角括号必须落到同一 key（否则同一单元裂成两半，答案各存一部分）；
//   ③ 端到端：测试(一)/(二) 相邻时，答案必须各归各的，绝不允许继承+覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUnitHeader, isSectionHeader, parseAnswerText, normalizeSectionName } from '../server/services/answerParseService.js'

test('章级测试标题：带空白形态必须被识别（本次事故的真实形态）', () => {
  const cases = [
    ['第 19 章测试 (二)', '第19章测试(二)'],
    ['第 19 章 测试 (二)', '第19章测试(二)'],
    ['第19章测试 (二)', '第19章测试(二)'],
    ['第 19 章测试(二)', '第19章测试(二)'],
    ['第 19 章测试 (一)', '第19章测试(一)'],
    ['第 20 章测试 (二)', '第20章测试(二)'],
    ['第 21 章测试 (二)', '第21章测试(二)'],
    ['第 22 章测试 (一)', '第22章测试(一)'],
    ['第 19 章 实数', '第19章实数'],
  ]
  for (const [input, expectKey] of cases) {
    assert.equal(isSectionHeader(input), true, `${JSON.stringify(input)} 应被判定为章节标题`)
    assert.equal(parseUnitHeader(input)?.unit_key, expectKey,
      `${JSON.stringify(input)} 必须归一到 ${expectKey}，否则该单元答案会继承上一个单元并覆盖它`)
  }
})

test('全角括号必须与半角括号落到同一 unit_key', () => {
  assert.equal(parseUnitHeader('第20章测试（一）')?.unit_key, '第20章测试(一)')
  assert.equal(parseUnitHeader('第 20 章测试 （二）')?.unit_key, '第20章测试(二)')
  assert.equal(normalizeSectionName('第20章测试（一）'), '第20章测试(一)')
})

test('「测试(一)」与「测试(二)」必须是两个不同单元（防止互相覆盖）', () => {
  const a = parseUnitHeader('第 19 章测试 (一)')?.unit_key
  const b = parseUnitHeader('第 19 章测试 (二)')?.unit_key
  assert.notEqual(a, b, '(一) 与 (二) 若同 key，后写入者会按题号覆盖先写入者')
  assert.equal(a, '第19章测试(一)')
  assert.equal(b, '第19章测试(二)')
})

test('端到端：测试(一) 续题 + 测试(二) 整卷，答案必须各归各的（复现本次事故）', () => {
  // 与 PDF p5 末尾 / p6 完全同构：先 (一) 的 1~11，翻页后 (一) 的 26、27，再 (二) 的 1~3
  const p5 = [
    '19.2(6) 科学记数法',
    '1. D 2. D 3. B',
    '第19章测试(一)',
    '1. A 2. A 3. C',
    '7. \\sqrt{5} 8. 3',
    '9. -1 10. 2.4\\times10^{-6}',
    '11. 5',
  ].join('\n')
  const p6 = [
    '26. 解：原式=1',
    '27. 解：原式=2',
    '第 19 章测试 (二)',
    '1. A 2. C 3. A',
    '7. 2-\\sqrt{5} 8. 3',
    '9. \\sqrt{2}',
  ].join('\n')

  const r5 = parseAnswerText(p5, [], null, 5)
  const r6 = parseAnswerText(p6, [], r5.lastState, 6)
  const one = {}, two = {}
  for (const a of [...r5.answers, ...r6.answers]) {
    if (a.unit_key === '第19章测试(一)') one[`${a.question_no}${a.sub_no || ''}`] = String(a.answer)
    if (a.unit_key === '第19章测试(二)') two[`${a.question_no}${a.sub_no || ''}`] = String(a.answer)
  }

  // 测试(一) 的 7 必须是 √5（不是测试(二) 的 2-√5）；测试(二) 的 9 必须是 √2
  assert.equal(one['7'], '\\sqrt{5}', '测试(一) 第7题答案必须保持 √5，不得被测试(二) 覆盖')
  assert.equal(one['9'], '-1', '测试(一) 第9题答案必须保持 -1，不得被测试(二) 覆盖')
  assert.equal(one['11'], '5', '测试(一) 第11题答案必须保持 5')
  assert.equal(one['26'], '解：原式=1', '翻页后的 26 题仍属测试(一)，必须正确继承')
  assert.equal(one['27'], '解：原式=2', '翻页后的 27 题仍属测试(一)，必须正确继承')
  assert.equal(two['7'], '2-\\sqrt{5}', '测试(二) 第7题必须落在自己的单元')
  assert.equal(two['9'], '\\sqrt{2}', '测试(二) 第9题必须落在自己的单元')
  assert.equal(two['3'], 'A', '测试(二) 第3题必须落在自己的单元')
  // 测试(二) 不得把答案灌进测试(一) 的 1/2/3
  assert.equal(one['2'], 'A', '测试(二) 的 2.C 不得覆盖测试(一) 的 2.A')
  assert.equal(one['3'], 'C', '测试(二) 的 3.A 不得覆盖测试(一) 的 3.C')
  // 测试(一) 不得混入测试(二) 独有题号
  assert.equal(one['25'], undefined, '测试(二) 独有的题号不得出现在测试(一) 名下')
})

test('回归：放宽容忍度后，普通答案行仍不得被当成章节标题', () => {
  const notTitles = [
    '1. C', '2. B', '3. 2, 1', '11. 5', '9. -1 或 -6',
    '第1课时 平方根', // 这是课时单元，由别的分支处理，key 不是章节名
    '一、选择题',
    '19.1(1) 算术平方根',
  ]
  for (const s of notTitles) {
    const r = parseUnitHeader(s)
    if (r) {
      assert.ok(!/^第\s*\d+\s*章/.test(r.unit_key), `${JSON.stringify(s)} 不应被当成章级标题`)
    }
  }
})
