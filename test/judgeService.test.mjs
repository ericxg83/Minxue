import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, normalizeChoiceAnswer, normalizeQuestionType, stripAnswerScaffolding } from '../server/services/judgeService.js'

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

// 答案脚手架剥离：只吃行首闭集词，绝不误伤句中同形词或纯叙述答案
test('stripAnswerScaffolding removes only leading narrative shells', () => {
  const CN = (s) => s
  // 行首闭集词 + 冒号/为/是
  assert.equal(stripAnswerScaffolding(CN('答案为 512/125')), '512/125')
  assert.equal(stripAnswerScaffolding(CN('答：512/125')), '512/125')
  assert.equal(stripAnswerScaffolding(CN('解：x = 3')), 'x = 3')
  assert.equal(stripAnswerScaffolding(CN('正确答案是 D')), 'D')
  assert.equal(stripAnswerScaffolding(CN('结果为') + `3${SQRT}2`), `3${SQRT}2`)
  // 裸引导词 + 数学字符
  assert.equal(stripAnswerScaffolding(CN('为 512/125')), '512/125')
  assert.equal(stripAnswerScaffolding(CN('即 ') + `${SQRT}6/2`), `${SQRT}6/2`)
  // 句中同形词绝不动："底角的余弦值等于 3/4 或 1/3" 整体是真答案
  assert.equal(stripAnswerScaffolding(CN('底角的余弦值等于 3/4 或 1/3')), CN('底角的余弦值等于 3/4 或 1/3'))
  // 纯叙述答案（剥完不含数学内容）原样返回，不被削成半句
  assert.equal(stripAnswerScaffolding(CN('答案是对的')), CN('答案是对的'))
  assert.equal(stripAnswerScaffolding(CN('为难')), CN('为难'))
  // 无前缀答案不动
  assert.equal(stripAnswerScaffolding(`3${SQRT}2`), `3${SQRT}2`)
  assert.equal(stripAnswerScaffolding('D'), 'D')
  assert.equal(stripAnswerScaffolding(''), '')
})

// 2026-09-02 用户截图：填空题"用 > < = 填空"两个空
// 参考答案 AI 解析成 "(1) =; (2) <"，学生写 "=, <"。
// 序号壳不剥掉 → 逐项比对变成 "=" vs "(1) =" 永不等，符号无数字给兜底，整题判错。
test('multi-blank compare-symbol answers strip sequence labels', () => {
  // 主路径：参考答案带 (N) 序号壳 + 学生裸符号
  assert.deepEqual(
    judgeAnswer('=, <', '(1) =; (2) <', 'fill'),
    { isCorrect: true, unrecognized: false })
  // 学生用空格分隔也能命中（splitBySpace 路径）
  assert.deepEqual(
    judgeAnswer('= <', '(1) =; (2) <', 'fill'),
    { isCorrect: true, unrecognized: false })
  // 全角括号也支持
  assert.deepEqual(
    judgeAnswer('=, <', '（1）=;（2）<', 'fill'),
    { isCorrect: true, unrecognized: false })
  // 一空答错仍要判错（不要宽松兜底）
  assert.deepEqual(
    judgeAnswer('=, >', '(1) =; (2) <', 'fill'),
    { isCorrect: false, unrecognized: false })
  // 单空填错也判错
  assert.deepEqual(
    judgeAnswer('=, =', '(1) =; (2) <', 'fill'),
    { isCorrect: false, unrecognized: false })
})

// 2026-09-02 用户截图：解答题"列点作答"型
// 学生答案 "当x=0时, y=3; 当x=-1时, y=0"，参考 "3, 0"。
// 之前 splitAnswers 按 ,; 切成 4 段、参考 2 段、段数不等跳过；
// extractAndCompare 把 x=0/y=3/x=-1/y=0 全数字抽出得 [-1,0,0,3] vs [0,3]，
// -1 多出来 + 集合不对等 → 整题判错。
test('solve-by-points answer matches reference value list', () => {
  // 主路径：键值叙述 vs 裸数字列表
  assert.deepEqual(
    judgeAnswer('当x=0时, y=3; 当x=-1时, y=0', '3, 0', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 紧凑写法（无"当""时"，逗号分隔）
  assert.deepEqual(
    judgeAnswer('x=0, y=3; x=-1, y=0', '3, 0', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 两边都是键值叙述，按顺序比对
  assert.deepEqual(
    judgeAnswer('当x=0时, y=3; 当x=-1时, y=0', '当x=0时, y=3; 当x=-1时, y=0', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 一组答错仍判错（不要宽松兜底）
  assert.deepEqual(
    judgeAnswer('当x=0时, y=4; 当x=-1时, y=0', '3, 0', 'answer'),
    { isCorrect: false, unrecognized: false })
})
