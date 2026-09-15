// 回归测试：课时标题"答案尾巴"守卫 + 期中/期末测试识别
// 事故背景（2026-09-15 八上数学_上海作业 56 页）：
//   qwen3.8-max 解析出的「9. 2或12」等答案行满足 LESSON_LINE_RE 的"编号+中文开头"形态，
//   被误判成课时标题 → 12 个伪单元（9.2/14.0/13.4/14.42…），~142 条答案错挂，
//   并顶替掉「期末测试(一)/(二)」等真实单元标题；isSectionHeader 又缺"期末测试"关键词，
//   书尾两套期末测试整卷漏识别。三道修复全部锁死在本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUnitHeader, isSectionHeader } from '../server/services/answerParseService.js'

test('含"或"的答案行不得被当成课时标题（伪单元 9.2/14.0/13.4/14.42 实测样本）', () => {
  for (const line of ['9. 2或12', '14. 0或1或√2', '13. 4或√119/2', '10. 1或-3', '17. 2或-2a', '9.2或12', '14.0或1或√2']) {
    assert.equal(parseUnitHeader(line), null, `「${line}」是答案行，不是单元标题`)
  }
})

test('以计量单位开头/无章节名的答案行不得当成课时标题（伪单元 6.12/9.5/8.5/13.30/11.13 实测样本）', () => {
  for (const line of ['6. 12厘米和4厘米', '9. 5元', '8. 5或10', '13. 30或15', '11. 13或√119', '9.5元', '6.12厘米和4厘米']) {
    assert.equal(parseUnitHeader(line), null, `「${line}」是答案行，不是单元标题`)
  }
})

test('真课时标题不受守卫影响（回归）', () => {
  for (const [line, key] of [
    ['19.1(1) 算术平方根', '19.1(1)'],
    ['19.1(1)算术平方根', '19.1(1)'],
    ['21.1一元二次方程', '21.1'],
    ['20.1(1)二次根式及其性质(1)', '20.1(1)'],
    ['22.3(3)勾股定理(3)', '22.3(3)'],
  ]) {
    const parsed = parseUnitHeader(line)
    assert.ok(parsed, `「${line}」应被识别为课时标题`)
    assert.equal(parsed.unit_key, key, `「${line}」的 unit_key 应为 ${key}`)
  }
})

test('期中/期末测试必须被识别为章节标题（期末测试(一)/(二) 整卷漏识别事故）', () => {
  for (const line of ['期末测试(一)', '期末测试(二)', '期中测试(一)', '期末测试卷', '期中卷']) {
    assert.equal(isSectionHeader(line), true, `「${line}」应被识别为章节标题`)
  }
})

test('第X章测试回归：既有识别路径不受影响', () => {
  for (const line of ['第22章测试(一)', '第19章测试(二)', '第十九章 单元测试卷']) {
    assert.equal(isSectionHeader(line), true, `「${line}」应被识别为章节标题`)
  }
})
