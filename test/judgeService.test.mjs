import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer, normalizeChoiceAnswer, normalizeQuestionType, stripAnswerScaffolding, sanitizeReferenceAnswer } from '../server/services/judgeService.js'

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

// 2026-09-11 用户截图：两道最小公倍数解答题被误判为错。
// 共同根因：判题不认识"答:……是N"最终结论句式——
//   · 题#11 OCR 把题干数字"4、8和16"混进答案字段，数字集合兜底因学生
//     多出 4、8 而比对失败（参考 "16"，学生结论"最小公倍数是16"）；
//   · 短除法两小问含大量过程数字，收窄只取最后一个"="/"答:"后内容，
//     只能捞出 126，与参考 "90,126" 2 段对不上。
test('answer-statement (答:) final results match reference', () => {
  // 案例1：题干数字混入 + "答:最小公倍数是16"
  assert.deepEqual(
    judgeAnswer('解: 答: 最小公倍数是16\n4、8和16', '16', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 案例2：短除法两小问，过程数字 + 两个"答:"句
  const shortDivision = '解: 2|18 30\n 3|9 15\n 3 5\n 2×3×3×5=90\n答:最小公倍数是90' +
    '\n解: 3|42 63\n 7|14 21\n 2 3\n 3×7×2×3=126\n答:42和63最小公倍数是126'
  assert.deepEqual(
    judgeAnswer(shortDivision, '90,126', 'answer'),
    { isCorrect: true, unrecognized: false })
  // 真答错必须仍判错：结论值与参考不等
  assert.deepEqual(
    judgeAnswer('解: 答: 最小公倍数是48\n4、8和16', '16', 'answer'),
    { isCorrect: false, unrecognized: false })
  const wrongSecond = shortDivision.replace('是126', '是128')
  assert.deepEqual(
    judgeAnswer(wrongSecond, '90,126', 'answer'),
    { isCorrect: false, unrecognized: false })
  // 只答一小问（结果序列段数不足）不判对
  assert.deepEqual(
    judgeAnswer('解: 2|18 30\n答:最小公倍数是90', '90,126', 'answer'),
    { isCorrect: false, unrecognized: false })
})

// ─────────────────────────────────────────────────────────────
// 判等层加固（2026-09-12）：用人工复核结论做基准回测定位出的 4 类纯匹配缺陷。
// 基准：近 30 天 180 道人工复核题，假错 96 → 74，假对不增，一致率 24% → 36%。
// 每组都同时锁「应判对」与「不得放水」两侧。
// ─────────────────────────────────────────────────────────────

// 缺陷 1：normalizeAnswer 的尾部标点剥离会把 '>' '<' '=' 吃成空串。
// "用 > < = 填空"是常见题型，学生与标准逐字相同却判不出（实测 7 例）。
test('pure comparison-symbol answers survive punctuation strip', () => {
  assert.deepEqual(judgeAnswer('>', '>', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('>', '＞', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('=', '“=”', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('<', '<', 'fill'), { isCorrect: true, unrecognized: false })
  // 不得放水：符号不同仍判错
  assert.deepEqual(judgeAnswer('>', '<', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('=', '>', 'fill'), { isCorrect: false, unrecognized: false })
  // 纯标点不是答案（归一化后两侧都空，不得判对）
  assert.deepEqual(judgeAnswer('。', '。', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer(',', ',', 'fill'), { isCorrect: false, unrecognized: false })
})

// 缺陷 2：isMathEquivalent 内部不认识 \frac / \sqrt，表达式含 '\' 让 new Function
// 抛 SyntaxError → 整个数学等价分支恒为 false（实测 9 例）。
test('math equivalence understands LaTeX fractions and roots', () => {
  assert.deepEqual(
    judgeAnswer('y = -\\frac{1}{3}(x + 3)^2', 'y = -1/3(x + 3)²', 'fill'),
    { isCorrect: true, unrecognized: false })
  assert.deepEqual(
    judgeAnswer('y = -\\frac{1}{3}x^2 + 3', 'y = -1/3x² + 3', 'fill'),
    { isCorrect: true, unrecognized: false })
  assert.deepEqual(
    judgeAnswer('\\sqrt{2}', '√2', 'fill'),
    { isCorrect: true, unrecognized: false })
  // 不得放水
  assert.deepEqual(
    judgeAnswer('y = -\\frac{1}{3}(x + 3)^2', 'y = -1/3(x - 3)²', 'fill'),
    { isCorrect: false, unrecognized: false })
  // 带整数前缀的 \frac 是真混合数（2又1/3 = 7/3），不得被算成 2×(1/3)
  assert.deepEqual(judgeAnswer('2\\frac{1}{3}', '7/3', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('2\\frac{1}{3}', '2/3', 'fill'), { isCorrect: false, unrecognized: false })
})

// 缺陷 3：U+2212 排版减号未归一 → 归一化后两侧仍带不同字符，
// isMathEquivalent 又因非法运算符抛错（实测 5 例）。
test('U+2212 minus sign and dash variants are normalized', () => {
  assert.deepEqual(judgeAnswer('−1/2', '-1/2', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('x=−3', 'x=-3', 'fill'), { isCorrect: true, unrecognized: false })
  // 不得放水（用不含数字的表达式，避开下面记录的既有"数字集合吞符号"通道）
  assert.deepEqual(judgeAnswer('−a + b', 'a + b', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('-2−√6或2+√6', '2', 'fill'), { isCorrect: false, unrecognized: false })
})

// 缺陷 4：列举型答案只差分隔符（"1.2.3.4.6.12" vs "1、2、3、4、6、12"、
// "①④⑤" vs "应为①、④、⑤"）。只在两侧 ≥3 段且每段都是纯整数/带圈数字时生效。
test('enumerated answers differing only in separators', () => {
  assert.deepEqual(judgeAnswer('1.2.3.4.6.12', '1、2、3、4、6、12', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('9.18.27.36', '9, 18, 27, 36', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('①④⑤', '①,④,⑤', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('①, ④, ⑤', '应为①、④、⑤', 'fill'), { isCorrect: true, unrecognized: false })
  // 不得放水：元素不同 / 段数不同 / 只有两段（"3.5" 与 "3,5" 语义不同）
  assert.deepEqual(judgeAnswer('1.2.3.4.6.12', '1、2、3、4、6、18', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('①④⑤', '①④⑥', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('3.5', '3,5', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('16', '1、2、3、4、6、12', 'fill'), { isCorrect: false, unrecognized: false })
})

// 答案层：答案库把「答案 + 解析」粘成一串（'-1/4 解析：设直线 AB…'），
// 整串逐串比对必然判错。sanitizeReferenceAnswer 在第一个解析标记处截断，
// 四道闸门保证不把正常长答案切坏、也不让纯叙述残句变成"答案"。
// 实测覆盖面：998 题里 11 条会被截断，收益上限 2 条，与老师结论 0 冲突（安全但收益小）。
test('sanitizeReferenceAnswer truncates at first explanation marker', () => {
  assert.equal(
    sanitizeReferenceAnswer('-1/4 解析：设直线 AB 与 y 轴交于点 D，如图，则 D(0,-3)。∵'),
    '-1/4')
  assert.equal(
    sanitizeReferenceAnswer('-1 或 -6 解析：∵二次函数 y=-(x+h)² 的图像开口向下'),
    '-1 或 -6')
  assert.equal(
    sanitizeReferenceAnswer('B 解析：∵抛物线 y₁=-(x-a)² 经过点 A(c,m)，∴m=-(c-a)²'),
    'B')
  // 无解析标记 → 原样返回
  assert.equal(sanitizeReferenceAnswer('y = -1/3(x + 3)²'), 'y = -1/3(x + 3)²')
  assert.equal(sanitizeReferenceAnswer(''), '')
  // 标记在开头 → 不截（片段为空）
  assert.equal(sanitizeReferenceAnswer('解析：见课本第 12 页'), '解析：见课本第 12 页')
  // 片段超过 20 字符 → 不截，避免把正常长答案切坏
  const longHead = '这是一个长度明显超过二十个字符的答案片段内容描述文字 解析：说明如下'
  assert.equal(sanitizeReferenceAnswer(longHead), longHead)
  // 纯叙述残句不含数学字符 → 不成其为答案
  assert.equal(
    sanitizeReferenceAnswer('不对，因为274不能被4整除，而每个小组折的纸鹤数量相同'),
    '不对，因为274不能被4整除，而每个小组折的纸鹤数量相同')
})

test('reference truncation only adds correct verdicts, never loosens a wrong one', () => {
  const ref = '-1/4 解析：设直线 AB 与 y 轴交于点 D，如图，则 D(0,-3)。∵'
  assert.deepEqual(judgeAnswer('-1/4', ref, 'answer'), { isCorrect: true, unrecognized: false })
  // 学生答错时截断通道不得把他判对。
  // 注意：不要用 '1/4' 做对照——'1/4' 与 '-1/4' 会被 extractAndCompare 的
  // "数字集合兜底"判成相等（该兜底会丢负号，是既有缺陷，与本次改动无关）。
  assert.deepEqual(judgeAnswer('3/4', ref, 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('-1/3', ref, 'answer'), { isCorrect: false, unrecognized: false })
})
