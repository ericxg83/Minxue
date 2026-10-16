/**
 * 英语 III/IV 拆题答案口径回归锁（2026-10-16）
 *
 * 背景（真卷 6AU3 Exercise 4 实测事故）：
 *   III 选词填空 / IV 词形填空拆题后，每空一道、共享同一篇短文（parent_stem）。
 *   ① 答案引擎输入拼了 parent_stem ⇒ 引擎按**整篇**作答，把 5 个答案并列返回，
 *      被原样写进该篇每一行：answer="surprise，pieces，added，Finally，tasty"。
 *      后果：判等层永远对不上 ⇒ 整篇堆积「需人工」。
 *   ② III 的词框没被 OCR 捕获（提示词写 options=[]）⇒ 学生写字母 A/E/F/B、
 *      参考答案是单词，形态不一致必然判错。
 *
 * 本锁锁三件事：
 *   1) wordBoxLetterToWord：词框字母 → 单词的归一边界（不越界、不猜、不动单词本身）
 *   2) english_kind 必须透传到答案阶段（否则上面两条判据全部失效）
 *   3) 提示词不得再对 III 写 options=[]（词框必须捕获）
 *
 * 反向自检：判据本身能被验红（见文末 reverse checks）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  wordBoxLetterToWord,
  isEnglishSingleBlankKind,
  ENGLISH_SINGLE_BLANK_KINDS,
} from '../server/worker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const workerSrc = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')
const aiSrc = readFileSync(resolve(ROOT, 'server/config/ai.js'), 'utf8')

// 真实卷 III 词框：A. presents B. rocket C. glass D. hot E. basketball F. taste
const BOX = ['presents', 'rocket', 'glass', 'hot', 'basketball', 'taste']

test('单空题型判据：只有 III/IV 进单空口径', () => {
  assert.equal(isEnglishSingleBlankKind({ english_kind: 'word_bank' }), true)
  assert.equal(isEnglishSingleBlankKind({ english_kind: 'word_form' }), true)
  // 不得把其它题型误伤进单空口径（II 选择/ V 句型转换仍走「拼 parent_stem」原口径）
  assert.equal(isEnglishSingleBlankKind({ english_kind: 'choice_passage' }), false)
  assert.equal(isEnglishSingleBlankKind({ english_kind: 'sentence_transform' }), false)
  assert.equal(isEnglishSingleBlankKind({}), false)
  assert.deepEqual([...ENGLISH_SINGLE_BLANK_KINDS].sort(), ['word_bank', 'word_form'])
})

test('III 词框字母 → 单词：正常映射', () => {
  // 真卷实测：学生写 "E"，答案 basketball
  assert.equal(wordBoxLetterToWord('E', BOX), 'basketball')
  assert.equal(wordBoxLetterToWord('A', BOX), 'presents')
  assert.equal(wordBoxLetterToWord('D', BOX), 'hot')
  // 小写 / 带括号 / 带空格都应命中
  assert.equal(wordBoxLetterToWord('e', BOX), 'basketball')
  assert.equal(wordBoxLetterToWord('(E)', BOX), 'basketball')
  assert.equal(wordBoxLetterToWord(' E ', BOX), 'basketball')
})

test('III 答案侧字母归一：引擎回字母是合法形态，不得判为非法（2026-10-16 回归）', () => {
  // 事故：III 落成 choice 后答案引擎按选择题习惯回 "B"，
  // 而闸只认「单词」⇒ 正确答案被误杀成需人工（实测 2/5 题因此空答案）。
  // 修复：落库前用同一个 wordBoxLetterToWord 把答案字母也归一成词。
  assert.match(workerSrc, /const normalizeEnglishBlankAnswer/)
  // 归一必须发生在**闸判定之前**（否则闸看到的仍是字母）
  assert.match(
    workerSrc,
    /checkEnglishSingleBlankAnswer\(q, normalizeEnglishBlankAnswer\(q, finalAnswer\)\)/
  )
  // OCR 阶段同样归一
  assert.match(workerSrc, /\[III词框\] 参考答案字母归一/)
})

test('III 词框归一：越界/多字母/已写单词 一律不动（不猜）', () => {
  // 下标越界：词框只有 6 项，"H" 无对应项
  assert.equal(wordBoxLetterToWord('H', BOX), 'H')
  // 多字母（可能是别的大题的选择题答案）不动
  assert.equal(wordBoxLetterToWord('AB', BOX), 'AB')
  // 学生已经直接写了单词 → 原样（这是最常见形态，不能被改坏）
  assert.equal(wordBoxLetterToWord('basketball', BOX), 'basketball')
  // 空值 / 无词框
  assert.equal(wordBoxLetterToWord('', BOX), '')
  assert.equal(wordBoxLetterToWord('E', []), 'E')
  assert.equal(wordBoxLetterToWord('E', null), 'E')
})

test('english_kind 必须透传到答案阶段（判据前提）', () => {
  // 落库对象里必须带 english_kind，且明确注释「不落库」
  assert.match(workerSrc, /english_kind:\s*q\.english_kind \|\| null/)
  assert.match(workerSrc, /不落库/)
})

test('单空题不喂 parent_stem：III/IV 走 content-only 口径', () => {
  // 存在「单空 ⇒ 只用 content」的三元分支
  assert.match(workerSrc, /isEnglishSingleBlank\s*\n?\s*\?\s*\n?\s*\[q\.content\]/)
  // 且必须下达「只答本空」指令
  assert.match(workerSrc, /singleBlankDirective/)
  assert.match(workerSrc, /只给出这\*\*一个\*\*空/)
})

test('多空答案拒收闸：主链路 + 缓存链路 + OCR 链路三处都在', () => {
  assert.match(workerSrc, /const checkEnglishSingleBlankAnswer/)
  // 主链路
  assert.match(workerSrc, /const singleBlankViolation = checkEnglishSingleBlankAnswer/)
  // 缓存链路（历史脏缓存不得复用）
  assert.match(workerSrc, /const cacheSingleBlankViolation = checkEnglishSingleBlankAnswer/)
  // OCR 阶段（模型直接吐整篇并列答案时置空）
  assert.match(workerSrc, /\[英语单空闸\] 丢弃整篇并列答案/)
  // 拒收策略是「转人工」而不是猜一个词
  assert.match(workerSrc, /await rejectEnglishSingleBlankAnswer/)
  assert.match(workerSrc, /转人工复核/)
})

test('III 词框必须捕获：提示词不得再对 III 写 options=[]', () => {
  const iiiBlock = aiSrc.slice(aiSrc.indexOf('III 选词填空'), aiSrc.indexOf('IV 词形填空'))
  assert.ok(iiiBlock.length > 0, '未能定位 III 选词填空规则块')
  // 词框必须逐字写进 options
  assert.match(iiiBlock, /options/)
  assert.match(iiiBlock, /词框必须逐字写进 options/)
  // 旧的错误口径（options=[] + 「不要按空拆成选项数组」）必须已移除
  assert.doesNotMatch(iiiBlock, /options=\[\]/)
  assert.doesNotMatch(iiiBlock, /不要按空拆成选项数组/)
  // III 落为 choice（可渲染成独立选择题）
  assert.match(iiiBlock, /question_type="choice"/)
})

test('IV 答案必须是单空单词（禁止并列多词）', () => {
  const ivBlock = aiSrc.slice(aiSrc.indexOf('IV 词形填空'), aiSrc.indexOf('3. 必跳过'))
  assert.ok(ivBlock.length > 0, '未能定位 IV 词形填空规则块')
  assert.match(ivBlock, /仅该空/)
  assert.match(ivBlock, /绝不可把同一短文其它空的答案一起输出/)
})

// ── 反向自检：判据本身要能被验红（否则锁可能空转）──────────────────────────
test('反向自检：把缺陷写法喂给同一门禁必须被拒', () => {
  // ① 词框归一越界不设防（options[idx] 直接取，越界返回 undefined）
  const brokenNoBounds = (value, options) => {
    const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(String(value).toUpperCase())
    return options[idx]
  }
  // 同一组判据（合法边界：越界字母必须原样返回）
  assert.equal(brokenNoBounds('H', BOX), undefined, '缺陷样本前提不成立：应越界取到 undefined')
  assert.equal(wordBoxLetterToWord('H', BOX), 'H', '正式实现应把越界字母原样返回')

  // ② 提示词退回 options=[]（上一轮的缺陷口径）→ 必须被门禁拒绝
  const gate = (prompt) => {
    const block = prompt.slice(prompt.indexOf('III 选词填空'), prompt.indexOf('IV 词形填空'))
    assert.doesNotMatch(block, /options=\[\]/)
    assert.match(block, /词框必须逐字写进 options/)
    return block
  }
  const brokenPrompt = 'III 选词填空：english_kind="word_bank"，question_type="fill"，options=[]，answer=该空应填的词。\nIV 词形填空占位'
  assert.throws(() => gate(brokenPrompt), /options=\[\]/, '缺陷写法未被拒：门禁空转了')
  // 正样本必须能过
  const good = (() => {
    const s = aiSrc
    return s.slice(s.indexOf('III 选词填空'), s.indexOf('IV 词形填空'))
  })()
  assert.match(good, /词框必须逐字写进 options/)
})
