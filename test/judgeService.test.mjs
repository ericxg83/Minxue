import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, normalizeChoiceAnswer, normalizeQuestionType } from '../server/services/judgeService.js'

test('normalizes explicit choice answer variants globally', () => {
  assert.equal(normalizeChoiceAnswer('D'), 'D')
  assert.equal(normalizeChoiceAnswer('(D)'), 'D')
  assert.equal(normalizeChoiceAnswer(String.fromCharCode(0xFF08, 0x9009, 0x20, 0x44, 0xFF09)), 'D')
  assert.equal(normalizeChoiceAnswer(String.fromCharCode(0x7B54, 0x6848, 0x4E3A) + ':d.'), 'D')
  assert.equal(normalizeQuestionType(String.fromCharCode(0x9009, 0x62E9, 0x9898)), 'choice')
  assert.equal(normalizeQuestionType(String.fromCharCode(0x5355, 0x9009, 0x9898)), 'choice')
  assert.equal(normalizeChoiceAnswer('2D'), '')
  assert.equal(normalizeChoiceAnswer('xD'), '')
})

test('does not misjudge a correct option when question type is wrong', () => {
  assert.deepEqual(judgeAnswer('D', 'D', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('(D)', 'D', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(String.fromCharCode(0x9009) + 'D', 'D', 'unknown'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('B', 'D', 'fill'), { isCorrect: false, unrecognized: false })
})

test('keeps existing mathematical equivalence behavior', () => {
  assert.deepEqual(judgeAnswer('1/2', '0.5', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(String.fromCharCode(0x221A) + '4', '2', 'answer'), { isCorrect: true, unrecognized: false })
})

// 学生答案与标准答案逐字符相同却判错的回归：
// narrowToFinalAnswer 只收窄学生侧（取最后一个 "=" 右侧），参考答案不收窄，
// "x = -m ± √n" 被比成 "-m±√n" vs "x=-m±√n"；± 无法数值化，下游兜底也救不回来。
test('identical student and reference answers are always correct', () => {
  const pm = '±'      // ±
  const sqrt = '√'    // √
  const ang = '∠'     // ∠
  const same = `x = -m ${pm} ${sqrt}n`
  assert.deepEqual(judgeAnswer(same, same, 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(`x=-m${pm}${sqrt}n`, same, 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer(`${ang}A=${ang}D`, `${ang}A=${ang}D`, 'fill'), { isCorrect: true, unrecognized: false })
  // 仍要能判错：变量前缀相同、答案本体不同
  assert.deepEqual(judgeAnswer(`x = -m ${pm} ${sqrt}k`, same, 'fill'), { isCorrect: false, unrecognized: false })
  // 归一化后都成空串（学生只写了标点）不能算命中
  const ju = String.fromCharCode(0x3002)  // 。
  const dou = String.fromCharCode(0xFF0C) // ，
  assert.deepEqual(judgeAnswer(ju, dou, 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer(ju, ju, 'fill'), { isCorrect: false, unrecognized: false })
})

const SQRT = '√'
const CN_AND = '和'                    // 和
const CN_COMMA = '，'                  // ，
const BLANK1 = '第一空为'  // 第一空为
const BLANK2 = '第二空为'  // 第二空为

// 二次根式化简题：系数在根号外还是写成分数、两空用"和"还是逗号连接，都是同一个答案
test('multi-blank radical answers survive separator and wording differences', () => {
  assert.deepEqual(
    judgeAnswer(`5${SQRT}3, (5/2)${SQRT}6`, `5${SQRT}3 ${CN_AND} (5${SQRT}6)/2`, 'fill'),
    { isCorrect: true, unrecognized: false })
  assert.deepEqual(
    judgeAnswer(
      `(7/4)${SQRT}(2m), (13/7)${SQRT}(7(a-b))`,
      `${BLANK1} (7${SQRT}(2m))/4${CN_COMMA}${BLANK2} (13${SQRT}(7(a-b)))/7`, 'fill'),
    { isCorrect: true, unrecognized: false })
  // 嵌套括号的根号必须真的参与求值，不能因为解析失败就判错
  assert.deepEqual(
    judgeAnswer(`(13/7)${SQRT}(7(a-b))`, `(13${SQRT}(7(a-b)))/7`, 'fill'),
    { isCorrect: true, unrecognized: false })
  // 其中一空答错，整题仍判错
  assert.deepEqual(
    judgeAnswer(`5${SQRT}3, (5/2)${SQRT}6`, `5${SQRT}3 ${CN_AND} (7${SQRT}6)/2`, 'fill'),
    { isCorrect: false, unrecognized: false })
})

// 比例答案：同一个比的不同写法算对，但比里各项的顺序不能乱
test('ratio answers compare by value, not by digit set', () => {
  assert.deepEqual(judgeAnswer(`${SQRT}6:2`, `${SQRT}3:${SQRT}2`, 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('3:2', '6:4', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('2:3', '3:2', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer(`${SQRT}6:2`, `${SQRT}3:2`, 'fill'), { isCorrect: false, unrecognized: false })
})
