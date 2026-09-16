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

// 缺陷 5（2026-09-15 用户截图）：科学记数法 `5×10²`（=500）与 `500` 判不等。
// 题：地球到太阳 1.5×10⁸ km、光速 3×10⁸ m/s，求光行时间 —— 学生答 `5×10²`，参考 `500`。
// prepareMathExpr 两处缺口，缺一个都判不对：
//   ① 上标归一正则的基底只认「字母 / 右括号」（`x²` 能转），**数字基底漏了**：
//      `10²` 里的 `²` 原样保留 → new Function 抛 SyntaxError → 数学等价分支恒 false；
//   ② 函数内没有 `×/÷` → `*//` 归一（该归一只在 normalizeAnswer 里，而它不在下游）。
// 实测后果：这道题同批 4 份卷子判等全部判错。
test('scientific notation is equivalent to its decimal value', () => {
  // 学生手写形态 5×10²
  assert.deepEqual(judgeAnswer('5×10²', '500', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('5×10²', '500', 'fill'), { isCorrect: true, unrecognized: false })
  // OCR 另一种写法 5×10^2
  assert.deepEqual(judgeAnswer('5×10^2', '500', 'answer'), { isCorrect: true, unrecognized: false })
  // 反方向：参考侧是科学记数法、学生侧是十进制值（负指数必须包成 **(-4)，否则 JS 语法错误）
  assert.deepEqual(judgeAnswer('-0.00036', '-3.6×10⁻⁴', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('0.00036', '3.6×10⁻⁴', 'fill'), { isCorrect: true, unrecognized: false })
  // 既有能力不得回退
  assert.deepEqual(judgeAnswer('5*10^2', '500', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('x²', 'x^2', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('(x+3)²', '(x+3)^2', 'fill'), { isCorrect: true, unrecognized: false })

  // 不得放水：指数不同 / 数值不同 一律仍判错
  assert.deepEqual(judgeAnswer('5×10³', '500', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('5×10²', '5000', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('6×10²', '500', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('2×10⁻³', '0.02', 'fill'), { isCorrect: false, unrecognized: false })
})

// 缺陷 6（2026-09-15 用户截图）：学生答 'y = -2 + bx + c'（含未定义变量 bx）被判对，
// 且对任意参考答案都成立（实测 'bx + c' vs '随便什么文字' 也判对）。
// 根因：isMathEquivalent 的 evaluatedCount++ 在 fn1()/fn2() 调用之前自增——
// 表达式语法合法但引用未定义标识符时，new Function 构造成功、计数 +1、调用抛
// ReferenceError 进 catch；10 个测试点全部如此 → evaluatedCount=10 → return true。
// 修复：只有双侧都成功求出有限数值才算有效测试点。该通道放行的判定只会 true→false
// （保守判错交人工），不存在反向放水。
test('math equivalence must not pass un-evaluable student expressions', () => {
  const ref = 'y=-1/2x²+2x+5/2'
  // 报障原案例：学生答案含未定义变量 bx，与参考完全不等值
  assert.deepEqual(judgeAnswer('y = -2 + bx + c', ref, 'answer'), { isCorrect: false, unrecognized: false })
  // 放水面的极端形态：含未定义变量的答案对任何参考都不再无条件判等
  assert.deepEqual(judgeAnswer('bx + c', '随便什么文字', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('bx + c', 'y=999', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('b + 3', '5', 'fill'), { isCorrect: false, unrecognized: false })

  // 不得误伤：可求值的正确等价写法必须照常判对
  assert.deepEqual(judgeAnswer('y = -1/2x² + 2x + 5/2', ref, 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('y = -1/2x^2 + 2x + 5/2', ref, 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('y = -(1/2)x^2 + 2x + 5/2', ref, 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('2a + 3a', '5a', 'fill'), { isCorrect: true, unrecognized: false })

  // 除零等未定义运算：测试点被跳过，但只要还有可求值点就正常比较
  assert.deepEqual(judgeAnswer('1/0', '1', 'fill'), { isCorrect: false, unrecognized: false })
})

// 缺陷 7（2026-09-16 用户截图）：学生答 -1/4√15、参考答案 -√15/4（同一道二次根式化简），
// 数学等价却被判错。**两层根因叠加，缺一层都修不好**：
//   ① prepareMathExpr 用 `\{([^{}]*)\}` 取 LaTeX 参数 ⇒ 参数里只要嵌套一层花括号就整个
//      匹配不上：`\frac{\sqrt{15}}{4}`、`\frac{3\sqrt{2}}{4}`、`x^{2}` 全部残留反斜杠 →
//      new Function 抛 SyntaxError → 数学等价分支恒为 false；
//   ② 参考答案字段存的是答案册整段推导「解：原式=…=-√15/4」，
//      sanitizeReferenceAnswer 只认「解析/因为/所以」这类词，不认链式等式。
// 另有一个同源的隐蔽缺口：JS 规定一元运算符不能直接做幂运算的左操作数，
//   `-x**2`、`-((15))**0.5/4` 都是 SyntaxError —— `-√15/4` 展开后正是这个形态，
//   `-x²` 这类含负号的幂答案也全中招（同样让数学等价求不出值）。
// 修复：expandLatexCommands 递归解析花括号配对 + wrapUnaryPowerExpr 给「一元符号+幂」
//   加括号 + sanitizeReferenceAnswer 增加链式等式末段通道。
// 全库对照（1126 题）：false→true 5 条且全部真阳性，true→false 0 条，零放水。
test('nested LaTeX fractions/roots, unary-minus powers and chained-equation references', () => {
  // —— 报障原案例（真实库数据：0e1d4de7 q19）——
  const chainRef = '解：原式=\\sqrt{15}-\\frac{3}{2}\\sqrt{15}+\\frac{1}{4}\\sqrt{15}=-\\frac{\\sqrt{15}}{4}.'
  assert.deepEqual(judgeAnswer('= -1/4√15', chainRef, 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(
    judgeAnswer('=√15-(6/4√15-1/4√15)\n=√15-5/4√15\n=-1/4√15', chainRef, 'answer'),
    { isCorrect: true, unrecognized: false }
  )

  // —— 嵌套参数的 LaTeX 等价写法（此前一律判错）——
  assert.deepEqual(judgeAnswer('-\\frac{1}{4}\\sqrt{15}', '-\\frac{\\sqrt{15}}{4}', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('\\frac{1}{2}\\sqrt{\\frac{1}{12}}', '\\frac{\\sqrt{3}}{12}', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('\\frac{3}{4}\\sqrt{2}', '\\frac{3\\sqrt{2}}{4}', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('\\frac{2\\sqrt{3}}{3}', '\\frac{2}{\\sqrt{3}}', 'answer'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('\\frac{1}{4}\\sqrt{15}', '\\frac{\\sqrt{15}}{4}', 'answer'), { isCorrect: true, unrecognized: false })
  // TeX 单字符参数简写 \frac14
  assert.deepEqual(judgeAnswer('-\\frac14\\sqrt{15}', '-\\frac{\\sqrt{15}}{4}', 'answer'), { isCorrect: true, unrecognized: false })
  // LaTeX 幂与乘号：x^{2}、5\times10^{2}
  assert.deepEqual(judgeAnswer('\\frac{1}{2}x^{2}+2x+\\frac{5}{2}', '0.5x^2+2x+2.5', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('5\\times10^{2}', '500', 'answer'), { isCorrect: true, unrecognized: false })
  // \left \right 只是定界符尺寸标记
  assert.deepEqual(judgeAnswer('\\left(\\frac{1}{2}\\right)^{2}', '\\frac{1}{4}', 'fill'), { isCorrect: true, unrecognized: false })
  // 一元负号 + 幂（JS 语法错误形态）
  assert.deepEqual(judgeAnswer('-x²', '-x^2', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('-\\sqrt{2}', '-2^{0.5}', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('-\\frac{1}{3}(x+3)^2', '-1/3(x+3)²', 'fill'), { isCorrect: true, unrecognized: false })

  // —— 混合数语义不得被破坏：2\frac{1}{3} 是真混合数 7/3，不是 2×(1/3) ——
  assert.deepEqual(judgeAnswer('2\\frac{1}{3}', '7/3', 'fill'), { isCorrect: true, unrecognized: false })
  assert.deepEqual(judgeAnswer('2\\frac{1}{3}', '2/3', 'fill'), { isCorrect: false, unrecognized: false })

  // —— 不得放水：真不等仍判错 ——
  assert.deepEqual(judgeAnswer('-\\frac{1}{4}\\sqrt{15}', '-\\frac{\\sqrt{15}}{2}', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('-\\frac{1}{4}\\sqrt{15}', '\\frac{\\sqrt{15}}{4}', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('\\sqrt{15}', '\\frac{\\sqrt{60}}{4}', 'answer'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('-x²', 'x^2', 'fill'), { isCorrect: false, unrecognized: false })
  assert.deepEqual(judgeAnswer('5\\times10^{2}', '5000', 'answer'), { isCorrect: false, unrecognized: false })
})

// 链式等式截断通道的五道闸门（2026-09-16 落地；全库回测 14 命中 / 4 翻转 / 零放水）。
// 第②道闸门「首段必须是叙述前缀」是回测中补的：没有它，普通方程 `y=x^2+2x=0`
// 会被截成末段 `0`，学生写个 `0` 就被放行 —— 属于典型放水形态。
test('sanitizeReferenceAnswer truncates chained equations to their final segment', () => {
  // 命中：答案册整段推导，首段是「解：原式」这类叙述前缀，末段是纯数学答案
  assert.equal(
    sanitizeReferenceAnswer('解：原式=\\sqrt{15}-\\frac{3}{2}\\sqrt{15}+\\frac{1}{4}\\sqrt{15}=-\\frac{\\sqrt{15}}{4}.'),
    '-\\frac{\\sqrt{15}}{4}'
  )
  assert.equal(sanitizeReferenceAnswer('解：原式=3+4=7'), '7')

  // 闸门①：只有 2 段（普通方程，不是推导链）不截断
  assert.equal(sanitizeReferenceAnswer('y=x^2+2x'), 'y=x^2+2x')
  // 闸门②：首段是纯数学式（普通方程）不截断，否则末段会被当成答案放水
  assert.equal(sanitizeReferenceAnswer('y=x^2+2x=0'), 'y=x^2+2x=0')
  // 闸门③：末段含中文不截断
  assert.equal(sanitizeReferenceAnswer('解：原式=3+4=等于7'), '解：原式=3+4=等于7')
  // 闸门④：倒数第二段含中文（夹叙夹议的假链）不截断
  assert.equal(sanitizeReferenceAnswer('解：原式=甲是3=7'), '解：原式=甲是3=7')
  // 闸门⑤：末段过长（不像答案本体）不截断
  const longTail = '解：原式=1+1=' + '1+'.repeat(20) + '1'
  assert.equal(sanitizeReferenceAnswer(longTail), longTail)

  // 既有能力不得回退：解析标记截断照旧
  assert.equal(sanitizeReferenceAnswer('-1/4 解析：设直线 AB 与 y 轴交于点 D，如图'), '-1/4')
  assert.equal(sanitizeReferenceAnswer('y = -1/3(x + 3)²'), 'y = -1/3(x + 3)²')
})
