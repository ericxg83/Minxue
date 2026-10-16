/**
 * 英语单空口径「内容兜底 + 题型滤网」回归锁（2026-10-16 晚场）
 *
 * 背景（真卷 6AU3 Exercise 4，任务 884af9e0 实测事故）：
 *   english_kind 标签由 OCR 模型自填，**不可靠**。同一次回归里：
 *     · 4 道 III/IV 题标签丢失/被误贴成 choice_passage ⇒「不喂 parent_stem」
 *       与「多空答案闸」全部静默失效 ⇒ 整篇多答案原样落库（修复前同一病灶复发）；
 *     · I 语音拼写题（题干含 /iːtʃ/ 音标）被贴成 word_form 混进 keep 集；
 *     · VI 阅读理解（开放式 answer 题）被贴成 keep 类混过标签层。
 *   另有一个独立缺陷：createQuestions 的插入对象**没有** is_suspicious 键
 *   ⇒ worker 内存里打的所有复核标记在落库一刻被 DEFAULT FALSE 吞掉。
 *
 * 本锁锁四件事：
 *   1) isEnglishBlankPassageQuestion：不依赖标签的单空内容判据（含边界）
 *   2) isEnglishPhoneticQuestion + filterEnglishExamQuestions：I/VI 内容兜底滤网
 *   3) createQuestions 必须落库 is_suspicious（静默丢字段修复）
 *   4) 三处单空判据（主链路/缓存链路/OCR 链路/L1-c）都必须走「标签 ∨ 内容」并集
 *
 * 夹具全部取自上际事故任务里的**真实行形状**（含题号卷面原文）。
 * 反向自检：把「只认标签」的旧判据喂给同一门禁必须被拒（见文末）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  isEnglishBlankPassageQuestion,
  isEnglishSingleBlankQuestion,
  isEnglishSingleBlankKind,
  isEnglishPhoneticQuestion,
  filterEnglishExamQuestions,
} from '../server/worker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const workerSrc = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
const neonSrc = readFileSync(resolve(ROOT, 'server/services/neonService.js'), 'utf8')

// ── 事故任务 884af9e0 真实行形状 ──
const MICHAEL_STEM = 'Hello, everyone! My name is Michael. Today is my eighth birthday. I get many __1__ from my family. Do you want to have a look? I like playing basketball very much. I have many __2__. The number of my basketballs is the __3__ as my age now. My sister buys a red __4__ for me. I want to be an IT __5__ when I grow up.'
const BIRTHDAY_STEM = "Yesterday was my mother's birthday. I wanted to give her a big __1__ (surprising). I got up early and went to the kitchen. I cut some fruit into small __2__ (piece) and put them on a plate."
const DINNER_STEM = 'My family is preparing a healthy dinner. My mother __1__ the vegetables in the kitchen. She will cut them __2__ to make the salad beautiful.'

// 脏行①：III 题标签被误贴成 choice_passage 且词框没捕到（多答案事故行）
const dirtyIII = {
  subject: '英语', english_kind: 'choice_passage', question_type: 'choice',
  content: 'I get many __1__ from my family.', parent_stem: MICHAEL_STEM, options: []
}
// 脏行②：IV 题标签丢失、词形提示在括号里（多答案事故行）
const dirtyIV = {
  subject: '英语', english_kind: undefined, question_type: 'fill',
  content: 'I wanted to give her a big __1__ (surprising).', parent_stem: BIRTHDAY_STEM, options: []
}
// 正常 II：真选择题，有 per-blank 选项，必须继续喂整篇
const realII = {
  subject: '英语', english_kind: 'choice_passage', question_type: 'choice',
  content: 'My mother __1__ the vegetables in the kitchen.', parent_stem: DINNER_STEM,
  options: ['wash', 'is washing', 'washed']
}
// 正常 V：句型转换无 parent_stem，行为必须零变化
const realV = {
  subject: '英语', english_kind: 'sentence_transform', question_type: 'fill',
  content: 'Yiming: That\'s so sweet! (1) ______ going to cook? (询问对方打算做什么菜)', parent_stem: ''
}
// 干净 III：标签 + 词框都在（走标签路径）
const cleanIII = {
  subject: '英语', english_kind: 'word_bank', question_type: 'choice',
  content: 'The number of my basketballs is the __3__ as my age now.', parent_stem: MICHAEL_STEM,
  options: ['presents', 'worker', 'glass', 'hat', 'basketballs', 'same']
}

test('内容判据：标签丢了/误贴了的 III/IV 也必须进单空口径（事故行）', () => {
  assert.equal(isEnglishBlankPassageQuestion(dirtyIII), true, 'III 误贴 choice_passage + 无词框必须被内容判据兜住')
  assert.equal(isEnglishBlankPassageQuestion(dirtyIV), true, 'IV 标签丢失必须被内容判据兜住')
})

test('内容判据边界：II 真选择题 / V 句型转换 / 数学题 一律不进', () => {
  assert.equal(isEnglishBlankPassageQuestion(realII), false, 'II 有 options，必须继续喂整篇')
  assert.equal(isEnglishBlankPassageQuestion(realV), false, 'V 无 parent_stem')
  assert.equal(isEnglishBlankPassageQuestion({ subject: '数学', content: 'x __1__ = 2', parent_stem: '已知 x>0', options: [] }), false)
  assert.equal(isEnglishBlankPassageQuestion({ subject: '英语', content: '无挖空的一句', parent_stem: '某短文', options: [] }), false)
  // 无编号挖空（V 的 ______ 形态）不算——宁可漏兜，不可误伤
  assert.equal(isEnglishBlankPassageQuestion({ subject: '英语', content: 'with _______', parent_stem: '某短文', options: [] }), false)
})

test('并集判据：标签 ∨ 内容，两条路都覆盖', () => {
  assert.equal(isEnglishSingleBlankQuestion(cleanIII), true, '标签路径')
  assert.equal(isEnglishSingleBlankQuestion(dirtyIII), true, '内容路径（标签误贴）')
  assert.equal(isEnglishSingleBlankQuestion(dirtyIV), true, '内容路径（标签丢失）')
  assert.equal(isEnglishSingleBlankQuestion(realII), false, 'II 两条路都不进')
  assert.equal(isEnglishSingleBlankQuestion(realV), false, 'V 两条路都不进（答案本就是整句，不能按「一个词」治）')
  // 旧判据（只认标签）在事故行上必须失效——证明并集不是空转
  assert.equal(isEnglishSingleBlankKind(dirtyIII), false)
  assert.equal(isEnglishSingleBlankKind(dirtyIV), false)
})

test('I 语音题内容判据：/iːtʃ/ 类音标题干必须识别，且不误伤普通斜杠', () => {
  assert.equal(isEnglishPhoneticQuestion({ content: 'Each student can have a bowl of soup. /iːtʃ/' }), true)
  assert.equal(isEnglishPhoneticQuestion({ content: 'Next, please cut the beef into ______. /piːsɪz/' }), true)
  // 保守边界：以下都不得误判
  assert.equal(isEnglishPhoneticQuestion({ content: 'Choose A and/or B' }), false)
  assert.equal(isEnglishPhoneticQuestion({ content: '2026/10/16' }), false)
  assert.equal(isEnglishPhoneticQuestion({ content: '见 https://example.com/page' }), false)
  assert.equal(isEnglishPhoneticQuestion({ content: '1/2 of the students' }), false)
  assert.equal(isEnglishPhoneticQuestion({ content: '没有斜杠的普通题' }), false)
})

test('题型滤网：keep 类保留，I/VI 内容兜底剔除（事故形态）', () => {
  const qs = [
    cleanIII,
    { subject: '英语', english_kind: 'word_form', question_type: 'fill', content: 'I __3__ (add) some cheese.', parent_stem: BIRTHDAY_STEM, options: [] },
    realV,
    realII,
    // I 语音题被误贴 word_form（事故行）
    { subject: '英语', english_kind: 'word_form', question_type: 'fill', content: 'Each student can have a bowl of soup. /iːtʃ/', parent_stem: '', options: [] },
    // VI 阅读题被贴成 keep 类（事故行）：开放式问句、无挖空
    { subject: '英语', english_kind: 'sentence_transform', question_type: 'answer', content: 'What did Tony get in the mail?', parent_stem: 'Tony got many old birthday cards...', options: [] },
    // 未贴标签的题（标签层兜底）
    { subject: '英语', english_kind: null, question_type: 'fill', content: '???', parent_stem: '', options: [] },
  ]
  const { kept, dropped } = filterEnglishExamQuestions(qs)
  assert.equal(kept.length, 4, `应保留 4 题，实得 ${kept.length}`)
  assert.ok(kept.includes(cleanIII) && kept.includes(realII) && kept.includes(realV))
  assert.equal(dropped['I语音(内容判据)'], 1, 'I 语音题必须被内容兜底剔除')
  assert.equal(dropped['VI阅读(内容判据)'], 1, 'VI 阅读题必须被内容兜底剔除')
  assert.equal(dropped['(无)'], 1, '未贴标签的题照旧由标签层剔除')
})

test('题型滤网边界：answer 型但带编号挖空不剔（防误伤 IV）', () => {
  const qs = [{
    subject: '英语', english_kind: 'word_form', question_type: 'answer',
    content: 'She tasted it and said it was very __5__ (taste).', parent_stem: BIRTHDAY_STEM, options: []
  }]
  const { kept } = filterEnglishExamQuestions(qs)
  assert.equal(kept.length, 1, '模型把 IV 的 question_type 写歪成 answer 时不得误删')
})

test('is_suspicious 必须落库（静默丢字段修复）', () => {
  assert.match(neonSrc, /is_suspicious:\s*q\.is_suspicious === true/, 'createQuestions 插入对象必须带 is_suspicious')
  // INSERT 列由对象键动态生成 ⇒ 键在列才在；顺带锁住动态列构造没被改成硬编码白名单
  assert.match(neonSrc, /const columns = Object\.keys\(questionsWithTime\[0\]\)/)
})

test('三处单空判据都必须走并集（源码级）', () => {
  // 主链路输入口径
  assert.match(workerSrc, /const isEnglishSingleBlank = isEnglishSingleBlankQuestion\(q\)/)
  // 答案闸触发条件
  assert.match(workerSrc, /if \(!isEnglishSingleBlankQuestion\(q\)\) return null/)
  // OCR 阶段多空并列答案丢弃
  assert.match(workerSrc, /if \(isEnglishSingleBlankQuestion\(q\) && \/\[，,、;；\]\/\.test/)
  // L1-c 纯题干重解口径
  assert.match(workerSrc, /const singleBlankKind = isEnglishSingleBlankQuestion\(q\)/)
})

test('III 词框按篇恢复 + 标签修复必须在 OCR 阶段落地（源码级）', () => {
  assert.match(workerSrc, /\[III词框\] 按篇恢复词框/)
  // 只向 word_bank 兄弟题借（II 的 A/B/C 选项绝不是词框）
  assert.match(workerSrc, /q\?\.english_kind === 'word_bank' && Array\.isArray\(q\.options\)/)
  // IV 形态（__3__ (add)）不得借框
  assert.match(workerSrc, /IV 词形填空形态/)
})

// ── 反向自检：旧判据（只认标签）喂同一门禁必须被拒 ──
test('反向自检：只认标签的旧判据在事故行上失效（证明并集必要）', () => {
  // 旧判据 = isEnglishSingleBlankKind，对 dirtyIII/dirtyIV 返回 false
  const oldGate = (q) => isEnglishSingleBlankKind(q)
  assert.equal(oldGate(dirtyIII), false)
  assert.equal(oldGate(dirtyIV), false)
  // 新判据必须两者都兜住
  assert.equal(isEnglishSingleBlankQuestion(dirtyIII), true)
  assert.equal(isEnglishSingleBlankQuestion(dirtyIV), true)
})

test('反向自检：缺陷版音标判据（见斜杠就判）必须误伤普通文本', () => {
  const brokenPhonetic = (content) => String(content).includes('/')
  assert.equal(brokenPhonetic('Choose A and/or B'), true, '缺陷样本前提：and/or 被误判')
  assert.equal(isEnglishPhoneticQuestion({ content: 'Choose A and/or B' }), false, '正式实现不得误伤 and/or')
})

test('反向自检：缺陷版滤网（只有标签层）必须放过 I/VI 事故行', () => {
  const KEEP_KINDS = new Set(['choice_passage', 'word_bank', 'word_form', 'sentence_transform'])
  const brokenFilter = (qs) => qs.filter(q => KEEP_KINDS.has(q?.english_kind || '(无)'))
  const junk = [
    { subject: '英语', english_kind: 'word_form', question_type: 'fill', content: 'Each student can have a bowl of soup. /iːtʃ/' },
    { subject: '英语', english_kind: 'sentence_transform', question_type: 'answer', content: 'What did Tony get in the mail?' },
  ]
  assert.equal(brokenFilter(junk).length, 2, '缺陷样本前提：旧滤网两行都放过')
  assert.equal(filterEnglishExamQuestions(junk).kept.length, 0, '新滤网必须两行都剔除')
})
