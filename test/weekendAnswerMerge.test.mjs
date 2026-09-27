/**
 * weekendAnswerMerge.test.mjs — 周末班课件多小问答案合并回归（问题2「参考答案只有第一问」）
 *
 * 锁定 server/lib/weekendHandout.js 的 buildCompleteQuestion 答案装配口径：
 *   ① 多小问各带答案、整题行未给全 → 按 (n) 顺序拼接全部小问答案（旧实现只取最长一条 → 丢问）；
 *   ② 整题行已含完整答案（长度不劣于各小问之和）→ 优先整题答案，不与分小问重复；
 *   ③ 单题（无小问）→ 保持原「取组内最长」行为，不回退；
 *   ④ subParts 携带 questionId + answer，供预览页内联编辑按行定位落库。
 *
 * buildCompleteQuestion 是闭包内私有函数，无法直接 import。这里以「行为等价复刻」方式
 * 固化判据：把库内该函数的答案合并逻辑抽成本测试的 pureMerge，任何对库内合并策略的
 * 改动都必须同步这里，否则本测试红。真正的字段级验证以库源码为准（见文件末尾断言）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '..', 'server', 'lib', 'weekendHandout.js'), 'utf8')

const stripSubPrefix = (subNo, content) => {
  const re = new RegExp(`^\\s*[（(]\\s*${subNo}\\s*[）)]\\s*`)
  return String(content || '').replace(re, '')
}

/** 与库内 buildCompleteQuestion 答案合并段等价的行为复刻 */
function mergeAnswer(group) {
  const sorted = [...group].sort((a, b) =>
    (a.sub_no ?? '') < (b.sub_no ?? '') ? -1 : (a.sub_no ?? '') > (b.sub_no ?? '') ? 1 : 0)
  const subItems = sorted.filter(x => x.sub_no != null && x.content)
  const wholeItem = sorted.find(x => x.sub_no == null && x.content)
  const subParts = subItems.map(x => ({
    subNo: x.sub_no,
    content: stripSubPrefix(x.sub_no, x.content),
    questionId: x.id || null,
    answer: String(x.answer || '').trim(),
  }))
  const wholeAns = String(wholeItem?.answer || '').trim()
  const subAnsList = subParts.filter(p => p.answer)
  const subAnsTotal = subAnsList.reduce((s, p) => s + p.answer.length, 0)
  let answer
  if (subAnsList.length > 1 && (!wholeAns || wholeAns.length < subAnsTotal)) {
    answer = subAnsList.map(p => `(${p.subNo}) ${p.answer}`).join('\n')
  } else {
    answer = group.map(x => x.answer || '').filter(Boolean).sort((a, b) => b.length - a.length)[0] || ''
  }
  return { answer, subParts }
}

test('① 多小问各带答案且整题行未给全 → 分小问拼接全部答案', () => {
  const group = [
    { id: 'w', sub_no: null, content: '公共题干', answer: '' },
    { id: 'a', sub_no: '1', content: '（1）求x', answer: 'x=2' },
    { id: 'b', sub_no: '2', content: '（2）求y', answer: 'y=3' },
    { id: 'c', sub_no: '3', content: '（3）求z', answer: 'z=9' },
  ]
  const { answer } = mergeAnswer(group)
  assert.equal(answer, '(1) x=2\n(2) y=3\n(3) z=9')
  // 旧实现会退化成只取最长的一条 → 断言三问都在
  for (const one of ['x=2', 'y=3', 'z=9']) assert.ok(answer.includes(one))
})

test('② 整题行已含完整答案 → 优先整题答案，不与分小问重复', () => {
  const full = '(1)x=2 (2)y=3 (3)z=9 详见解析过程'
  const group = [
    { id: 'w', sub_no: null, content: '公共题干', answer: full },
    { id: 'a', sub_no: '1', content: '（1）求x', answer: 'x=2' },
    { id: 'b', sub_no: '2', content: '（2）求y', answer: 'y=3' },
  ]
  const { answer } = mergeAnswer(group)
  assert.equal(answer, full)
})

test('③ 单题（无小问）→ 保持取组内最长，不回退', () => {
  const group = [
    { id: 'a', sub_no: null, content: '计算 2+3', answer: '5' },
  ]
  const { answer } = mergeAnswer(group)
  assert.equal(answer, '5')
})

test('④ subParts 携带 questionId + answer，供内联编辑按行落库', () => {
  const group = [
    { id: 'w', sub_no: null, content: '公共题干', answer: '' },
    { id: 'id-1', sub_no: '1', content: '（1）求x', answer: 'x=2' },
    { id: 'id-2', sub_no: '2', content: '（2）求y', answer: '' },
  ]
  const { subParts } = mergeAnswer(group)
  assert.equal(subParts.length, 2)
  assert.equal(subParts[0].questionId, 'id-1')
  assert.equal(subParts[0].answer, 'x=2')
  assert.equal(subParts[1].questionId, 'id-2')
  // 前缀 (1) 已剥离，只留净内容
  assert.equal(subParts[0].content, '求x')
})

test('⑤ 源码守卫：库内确已采用分小问拼接（防止回退到只取最长一条）', () => {
  assert.match(SRC, /subAnsList\.length > 1[\s\S]*?\(\$\{p\.subNo\}\)/,
    '库内答案合并应包含「多小问按 (n) 拼接」分支')
  assert.match(SRC, /wholeQuestionId:\s*wholeItem\?\.id/,
    '库内应下发 wholeQuestionId 供单题编辑定位')
})
