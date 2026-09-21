// 回归测试：答案册解析器必须认出「非课时单元」标题
//
// 事故背景（2026-09-21《八上精练与拓展》44 页纯扫描答案册，worksheet 83cf0c4b）：
//   管理端弹出 21 处「题号连续性异常」告警。核查发现这本答案册的单元不止「课时」，
//   还有节末《习题 X.Y》、章末《单元练习X》、校历《期中练习》《期末练习》共 16 处，
//   而 isSectionHeader 的关键词表里只有「单元测试/综合练习/单元卷/期中测试/期末测试」，
//   **一个都不认** → 这 16 行标题被整行吞掉（还会被"续行归并"吸进上一条答案）→
//   其下答案全部继承给上一个课时单元 → 同单元同题号 UPSERT 互相覆盖：
//     PDF 上 20.2(4) 只有 1~14 题（第 1 题 = B），
//     库里 20.2(4) 存了 1~25 题、第 1 题 = D（实为《单元练习二十》第 1 题）。
//   老师批改时整卷参考答案张冠李戴；单元题号同时窜到 25/39/43（伪题号）。
//
// 同时暴露第二个缺陷：第 18 题的答案行「18. 1与1（答案不唯一）」，
//   因 LESSON_CODE_RE 容忍"编号内夹空白"被读成课时编号 `18.1`，
//   尾巴「与1（答案不唯一）」有 6 个汉字、绕过了 looksLikeAnswerTail，
//   造出伪单元 `18.1` 并吞掉其后《期中练习》17~24 题与《期末练习》全卷。
//
// 本测试锁定：① 16 处非课时标题必须独立成单元；② 伪标题 18.1 必须被拒且该行落回答案；
//   ③ 放宽后不得误伤真课时标题（尤其「24.2(1) 与圆有关的位置关系」这类以"与"开头的章节名）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUnitHeader, isSectionHeader, parseAnswerText, splitInlineAnswers } from '../server/services/answerParseService.js'

// ── ① 16 处非课时单元标题（本册 OCR 实证形态，逐字照抄）──
test('节末《习题 X.Y》必须被识别为独立单元（含范围号与破折号形态）', () => {
  const cases = [
    '习题 19.1', '习题 19.2', '习题 20.1', '习题 20.2',
    '习题 21.1-21.2', '习题 21.3—21.4', '习题 21.5',
    '习题 22.1', '习题 22.2', '习题 22.3',
  ]
  for (const c of cases) {
    assert.equal(isSectionHeader(c), true, `「${c}」应被识别为章节标题`)
    const r = parseUnitHeader(c)
    assert.ok(r && r.unit_key, `「${c}」应解析出 unit_key`)
    assert.equal(r.unit_key, c.replace(/[\s　]+/g, ''), `「${c}」的 unit_key 应为去空白形态`)
  }
})

test('章末《单元练习X》必须被识别为独立单元', () => {
  for (const c of ['单元练习十九', '单元练习二十', '单元练习二十一', '单元练习二十二']) {
    assert.equal(isSectionHeader(c), true, `「${c}」应被识别为章节标题`)
    assert.equal(parseUnitHeader(c)?.unit_key, c)
  }
})

test('《期中练习》《期末练习》必须被识别为独立单元', () => {
  for (const c of ['期中练习', '期末练习', '期中练习(一)', '期末练习(二)']) {
    assert.equal(isSectionHeader(c), true, `「${c}」应被识别为章节标题`)
    assert.ok(parseUnitHeader(c)?.unit_key, `「${c}」应解析出 unit_key`)
  }
})

// ── ② 第二个缺陷：伪课时号 18.1 / 22.0 ──
test('「18. 1与1（答案不唯一）」是题 18 的答案，绝不能被读成课时 18.1', () => {
  const line = '18. 1与1（答案不唯一）'
  assert.equal(parseUnitHeader(line), null, '该行是答案行，不是课时标题')
})

test('「22. 0. 提示：…」是题 22 的答案，绝不能被读成课时 22.0', () => {
  const line = '22. 0. 提示：原方程可化为 2|x+1|+a=3|x+1|，即 |x+1|=a.'
  assert.equal(parseUnitHeader(line), null, '该行是答案行，不是课时标题')
})

test('端到端：伪课时号不得吞掉《单元练习二十一》的第 22~25 题', () => {
  const { answers } = parseAnswerText([
    '单元练习二十一',
    '21. (1) $m \\leqslant \\frac{11}{5}$. (2) -2.',
    '22. 0. 提示：原方程可化为 $2|x+1|+a=3|x+1|$，即 $|x+1|=a$.',
    '23. (1) $\\frac{3}{2}; -\\frac{1}{2}$.',
    '24. (1) 第二季度生产量的增长率为 20%',
    '25. (1) $2t$; $8-t$',
    '第 22 章 直角三角形',
    '22.1(1) 直角三角形的性质',
    '1. C 2. B 3. C',
  ].join('\n'))
  assert.ok(!answers.some(a => String(a.unit_key).startsWith('22.0')), '绝不能出现伪单元 22.0')
  const u21 = answers.filter(a => a.unit_key === '单元练习二十一').map(a => String(a.question_no))
  for (const q of ['21', '22', '23', '24', '25']) {
    assert.ok(u21.includes(q), `《单元练习二十一》必须含第 ${q} 题，实际：${u21.join(',')}`)
  }
  assert.equal(answers.find(a => a.unit_key === '22.1(1)' && String(a.question_no) === '1')?.answer, 'C')
})

// ── ②.b 行内拆分：答案册版式「答案. 提示：解析」──
test('splitInlineAnswers：「NN. 提示：…」里的 NN 是答案，不是题号', () => {
  // 三处实测形态：拆错会产生伪题号 15 / 43 / 39 / 42，并吞掉真答案
  const cases = [
    ['13. 15. 提示：$a^2+b^2+c^2-ab-bc-ac$', '13'],
    ['13. (1) 43. 提示：$a, b$ 是方程 $x^2+15x+5=0$ 的两个根', '13'],
    ['10. 39. 提示：连接CE，易得CE=BE', '10'],
  ]
  for (const [line, wantFirst] of cases) {
    const parts = splitInlineAnswers(line)
    assert.equal(parts.length, 1, `「${line}」不得被拆开，实际拆成 ${parts.length} 段：${JSON.stringify(parts)}`)
    assert.equal(parts[0].match(/^(\d+)/)[1], wantFirst)
  }
})

test('splitInlineAnswers：正常行内多题仍必须拆开（回归）', () => {
  assert.deepEqual(splitInlineAnswers('1. B. 2. C. 3. D.'), ['1. B.', '2. C.', '3. D.'])
  assert.deepEqual(splitInlineAnswers('13. D 14. C 15. C 16. B'), ['13. D', '14. C', '15. C', '16. B'])
})

test('端到端：「18. 1与1（答案不唯一）」必须落回「题号 18 的答案」', () => {
  const { answers } = parseAnswerText([
    '期中练习',
    '17. 1234/909',
    '18. 1与1（答案不唯一）',
    '19. (1) 40√10',
  ].join('\n'))
  assert.equal(answers.length, 3, '三行答案各成一条')
  assert.ok(!answers.some(a => a.unit_key === '18.1'), '绝不能出现伪单元 18.1')
  for (const a of answers) assert.equal(a.unit_key, '期中练习', '三题都应归属《期中练习》')
  const q18 = answers.find(a => String(a.question_no) === '18')
  assert.ok(q18, '题号 18 必须存在')
  assert.match(q18.answer, /1与1/, '题 18 的答案应是「1与1（答案不唯一）」')
})

// ── ③ 端到端复现本次事故：20.2(4) / 习题20.2 / 单元练习二十 三层必须各归各位 ──
test('端到端：三层单元叠加时答案不得跨单元覆盖（20.2(4) 第1题必须是 B，不是 D）', () => {
  // 逐字取自 PDF p9/p10 的真实 OCR 片段（此处只留前几题做最小复现）
  const text = [
    '20.2(4) 二次根式的运算(4)',
    '1. B. 2. C. 3. D.',
    '4. $\\frac{2\\sqrt{3}+3\\sqrt{2}}{6}$; $3\\sqrt{2}-2\\sqrt{3}$.',
    '9. $\\sqrt{5}$. 提示：$a + 2 + \\frac{1}{a} = 3 + 2 = 5$.',
    '14. -1.',
    '',
    '习题 20.2',
    '1. B. 2. D. 3. D.',
    '4. $10\\sqrt{2} + 2\\sqrt{3}$.',
    '14. $\\frac{2}{5}\\sqrt{6}$.',
    '',
    '单元练习二十',
    '1. D. 2. C. 3. B. 4. C. 5. B. 6. A.',
    '7. $4-\\sqrt{15}$; $4+\\sqrt{15}$.',
  ].join('\n')

  const { answers } = parseAnswerText(text)
  const keys = new Set(answers.map(a => a.unit_key))
  for (const k of ['20.2(4)', '习题20.2', '单元练习二十']) {
    assert.ok(keys.has(k), `必须独立出单元「${k}」，实际：${[...keys].join(' / ')}`)
  }
  const q1 = (k) => answers.find(a => a.unit_key === k && String(a.question_no) === '1')?.answer
  // 形态说明：本册紧凑排版是「1. B. 2. C. 3. D.」一行，经 splitInlineAnswers 拆开后
  // 答案文本保留尾部句点（库内实测 20.2(4) q1 = "D."），故用 /^B\.?$/ 断言。
  assert.match(q1('20.2(4)'), /^B\.?$/, '20.2(4) 第1题必须是 B（事故时被覆盖成 D.）')
  assert.match(q1('习题20.2'), /^B\.?$/)
  assert.match(q1('单元练习二十'), /^D\.?$/, '单元练习二十 第1题是 D —— 事故时它覆盖了 20.2(4)')
  // 三层各 14/14/7 题，题号从 1 重新开始，不得互相并吞
  const maxOf = (k) => Math.max(...answers.filter(a => a.unit_key === k).map(a => Number(a.question_no)))
  assert.equal(maxOf('20.2(4)'), 14, '20.2(4) 最大题号应为 14（PDF 上就是 1~14）')
  assert.equal(maxOf('习题20.2'), 14)
})

test('端到端：漏识别标题行不得被"续行归并"吸进上一条答案', () => {
  // 实测污染：p41 的「期末练习」标题行被并进了上一条答案，
  // 库里出现 answer 尾巴挂着「期末练习」字样的脏行。
  const { answers } = parseAnswerText([
    '期中练习',
    '1. C',
    '期末练习',
    '1. D 2. A 3. D',
  ].join('\n'))
  assert.ok(!answers.some(a => /期末练习/.test(String(a.answer))), '标题行不得出现在任何答案文本里')
  const fk = answers.filter(a => a.unit_key === '期末练习').map(a => String(a.question_no))
  assert.deepEqual(fk, ['1', '2', '3'], '《期末练习》1~3 题必须归到自己单元')
})

// ── ④ 放宽后的误伤防护 ──
test('放宽非课时标题识别后，真课时标题一律不受影响（回归）', () => {
  for (const [line, key] of [
    ['19.1(1) 算术平方根', '19.1(1)'],
    ['19.1(1)算术平方根', '19.1(1)'],
    ['21.1一元二次方程', '21.1'],
    ['20.2(4) 二次根式的运算(4)', '20.2(4)'],
    // 「与」开头的章名绝不能被新守卫误伤（初中数学真实章节名）
    ['24.2(1) 与圆有关的位置关系', '24.2(1)'],
    ['27. 2(3) 形如 y=a(x+m)² 的二次函数的图像与性质', '27.2(3)'],
  ]) {
    const r = parseUnitHeader(line)
    assert.ok(r, `「${line}」应被识别为课时标题`)
    assert.equal(r.unit_key, key, `「${line}」的 unit_key 应为 ${key}`)
  }
})

test('放宽后，答案行/大题组行仍不得被当成单元标题（回归）', () => {
  for (const s of [
    '1. C', '2. B', '18. 1与1（答案不唯一）', '9. 2或12', '14. 0或1或√2',
    '6. 12厘米和4厘米', '9. 5元', '一、选择题', '如习题3所示',
    '4. 解：易知抛物线 y=(x-2)² 的顶点 C 的坐标为 (2,0).',
  ]) {
    assert.equal(parseUnitHeader(s), null, `${JSON.stringify(s)} 不应被当成单元标题`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 行内拆分的 4 类误拆（同一本册第二轮排查，2026-09-21 下午）
//
// 第一轮修完「标题漏识别」后，全册告警从 21 处降到 6 处，但库内仍有 10 个单元
// 各缺 1~2 个题号（共 13 个题号消失）。根因全在 splitInlineAnswers：
// 答案册的答案大量是「数字型」，数字本身又常常等于相邻题号，于是被读成题号。
// 每一次误拆都同时造成两件事：真答案丢了 + 造出伪题号（伪题号又会污染上一题答案
// ——拆出的裸「NN.」匹配不上题头正则，被"续行归并"吸进上一条）。
// 全册取证：旧规则接受的行内候选中「不连续」者 19 处、空格后无标点候选 55 处，
// 逐条核对 **0 处合法**；合法紧凑格式（1.A 2.D / 13. D 14. C / 19. 2 因素；20. 1/10）
// 的题号一律连续且带标点。
// ─────────────────────────────────────────────────────────────────────────────

test('行内题号必须连续：「题号. 数字型答案」不得被拆成两个题号', () => {
  // 旧规则只禁止「. 后紧跟数字且跳号」，于是「NN. 数字」被拆开：
  // 拆出的裸 "NN." 匹配不上题头正则 → 续行归并进上一题（污染），数字变成伪题号。
  for (const line of [
    '5. 12 cm.',      // 第 5 题答案 = 12 cm    （旧行为拆出伪题号 12）
    '9. 30.',         // 第 9 题答案 = 30
    '9. 23 或 32.',    // 第 9 题答案 = 23 或 32（旧行为拆出伪题号 32）
    '6. 13 和 15.',    // 第 6 题答案 = 13 和 15
    '7. 25 或 36.',    // 第 7 题答案 = 25 或 36
    '6. 18√7.',
    '8. 15√14.',
    '4. 30.',
    '9. 16.',
    '6. 13.',
    '14. 17.',
  ]) {
    assert.deepEqual(splitInlineAnswers(line), [line], `「${line}」不得被拆开`)
  }
})

test('行内候选必须带答案内容：行尾裸题号是上一题的答案值', () => {
  // 「题号. 数字型答案」的答案恰好等于下一个题号时（8. 9. / 9. 10.），
  // 旧行为把答案拆成裸题号 → 两题一起坏（真答案丢失 + 上一题答案被污染）。
  for (const line of [
    '8. 9.',   // 第 8 题答案 = 9   （p25 习题21.5）
    '9. 10.',  // 第 9 题答案 = 10  （p22 21.5(3)）
    '9. 10.',  // p31 22.2(2)
  ]) {
    assert.deepEqual(splitInlineAnswers(line), [line], `「${line}」不得被拆开`)
  }
  // 行尾但不是答案值的那一段仍要正常拆（回归）
  assert.deepEqual(splitInlineAnswers('1. B. 2. C.'), ['1. B.', '2. C.'])
})

test('无标点候选只能出现在行首或分号后：答案内部的系数/算式不得被当题号', () => {
  // 前瞻字符集含 √ 等数学符号，导致「答案里的数字 + 数学符号」命中原子的候选分支。
  for (const line of [
    '4. 5√2/2',                                    // 答案系数 5（p34 22.3(2) 第 4 题）
    '6. 18√7.',
    '8. 15√14.',
    '20. 2√3',
    '10. 2√2.',
    '19. (1) 40√10',                                // "(1)" 不得被判为候选 1
    '11. (1) √49=7. (2) √(169/196)=13/14.',         // "(1)"/"(2)" 不得被判为候选 1/2
  ]) {
    assert.deepEqual(splitInlineAnswers(line), [line], `「${line}」不得被拆开`)
  }
})

test('子题标记开头的行不得做行内拆分（答案以数字+顿号开头）', () => {
  // 第 25 题的四个小问跨行排版：(1) 单独成行写在「25. (1) …」里，(2)(3)(4) 各自成行。
  // "(2) 1、2、3" 里的 "1、" 旧行为被拆成题号 1 → 造出伪题 1，并触发
  // 「同单元题号重置到 1」告警（全册最后一条告警）。
  const { answers } = parseAnswerText([
    '期中练习',
    '25. (1) 2 : 5',
    '(2) 1、2、3',
    '(3) 3',
    '(4) 255 提示：$((2^2)^4)^2=256$',
    '期末练习',
    '1. D 2. A 3. D',
  ].join('\n'))
  assert.ok(!answers.some(a => String(a.unit_key) === '期中练习' && String(a.question_no) === '1'),
    '绝不能出现伪题 1')
  const subs = answers.filter(a => String(a.unit_key) === '期中练习')
    .sort((a, b) => Number(a.sub_no) - Number(b.sub_no))
  assert.deepEqual(subs.map(a => a.sub_no), ['1', '2', '3', '4'], '第 25 题必须拆成 (1)~(4)')
  assert.equal(subs[1].answer, '1、2、3')
  // 后一个单元照常独立
  assert.deepEqual(
    answers.filter(a => a.unit_key === '期末练习').map(a => String(a.question_no)),
    ['1', '2', '3'],
  )
})

test('OCR 把一条答案折成两行时，裸题号行必须并入上一题（不得丢弃真答案值）', () => {
  // 2026-09-21 实测：PDF p17 印「8. −2√2 ; 1.」，OCR 折成两行「8. $-2\sqrt{2}$;」「1.」。
  // 曾加过"丢弃裸题号行"的守卫，结果第 8 题少了一个解（库内只剩 "-2√2"）。
  // 上游三道守卫已堵死"误拆出裸号"，故裸行只能按续行归并，不能丢。
  const { answers } = parseAnswerText([
    '21.4(1) 一元二次方程的根与系数的关系(1)',
    '7. 3.',
    '8. $-2\\sqrt{2}$;',
    '1.',
    '9. -12.',
  ].join('\n'))
  const q8 = answers.find(a => String(a.question_no) === '8')
  assert.ok(q8, '题号 8 必须存在')
  assert.match(String(q8.answer).replace(/\s+/g, ' '), /-2\\sqrt\{2\}.*1\./, '第 8 题的答案必须含 "; 1."')
  assert.equal(answers.find(a => String(a.question_no) === '9')?.answer, '-12.')
  assert.equal(answers.find(a => String(a.question_no) === '7')?.answer, '3.')
})
