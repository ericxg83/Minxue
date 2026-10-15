/**
 * 回归测试：英语语篇页组聚合 classifyEnglishPage / stitchPageBuffers（worker.js，T5 两遍法）
 *
 * 场景来自负责人实际拍照习惯：文章与选项表分离拍摄、文章跨页。
 * 判据红线：数学页与自足英语页必须零影响（'non-english' / 'self-sufficient'）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { classifyEnglishPage, stitchPageBuffers, selectEnglishMergePages, ENGLISH_STITCH_MAX_PAGES } from '../server/worker.js'

const enStemQ = (n, opts) => ({
  question_number: n, subject: '英语', question_type: 'choice',
  content: `Sentence with __${n}__ inside the passage.`,
  parent_stem: 'Have you ever __1__ of upcycling? Many ideas __2__ the past.',
  options: opts || ['hear', 'heard', 'hears'], answer: 'B',
})
const enPlainChoice = (n) => ({
  question_number: n, subject: '英语', question_type: 'choice',
  content: 'Which of the following is correct according to the passage above?',
  options: ['option one here', 'option two here', 'option three here'], answer: 'A',
})
const mathQ = { question_number: 1, subject: '数学', question_type: 'fill', content: '计算 √12 × √(1/3)', options: [], answer: null }

test('数学页与空页 → non-english（零影响）', () => {
  assert.equal(classifyEnglishPage([mathQ, mathQ]), 'non-english')
  assert.equal(classifyEnglishPage([]), 'non-english')
})

test('同页自足语篇（文章+选项表一起拍）→ self-sufficient', () => {
  assert.equal(classifyEnglishPage([enStemQ(1), enStemQ(2), enStemQ(3)]), 'self-sufficient')
})

test('文章页（有挖空但 options 全空，选项表在另一页）→ pending', () => {
  const qs = [enStemQ(1, []), enStemQ(2, []), enStemQ(3, [])]
  assert.equal(classifyEnglishPage(qs), 'pending')
})

test('老考法单句选择题页（无挖空、题干像样、选项齐）→ self-sufficient', () => {
  assert.equal(classifyEnglishPage([enPlainChoice(1), enPlainChoice(2)]), 'self-sufficient')
})

test('疑似选项表页被乱拆（无挖空、content 超短）→ pending', () => {
  const junk = [1, 2, 3, 4].map(n => ({
    question_number: n, subject: '英语', question_type: 'choice',
    content: 'heard', options: ['hear', 'heard', 'hears'], answer: null,
  }))
  assert.equal(classifyEnglishPage(junk), 'pending')
})

test('整页表格被认成一道题（无挖空、无 options、content 密集选项标记）→ pending', () => {
  const table = [{
    question_number: 1, subject: '英语', question_type: 'answer',
    content: 'A. hear B. heard C. hears A. for B. like C. as A. are making B. make C. have made',
    options: [], answer: null,
  }]
  assert.equal(classifyEnglishPage(table), 'pending')
})

test('混合页（英语+数学同页）按英语题分类', () => {
  const qs = [enStemQ(1, []), mathQ]
  assert.equal(classifyEnglishPage(qs), 'pending')
})

test('stitchPageBuffers：两页 buffer 拼接尺寸正确、单页原样返回', async () => {
  const mk = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer()
  const a = await mk(400, 300, { r: 255, g: 0, b: 0 })
  const b = await mk(300, 200, { r: 0, g: 255, b: 0 })
  const single = await stitchPageBuffers([a])
  const metaSingle = await sharp(single).metadata()
  assert.equal(metaSingle.width, 400)
  assert.equal(metaSingle.height, 300)

  const stitched = await stitchPageBuffers([a, b])
  const meta = await sharp(stitched).metadata()
  assert.equal(meta.width, 400)
  assert.equal(meta.height, 300 + 200 + 24) // gap=24

  await assert.rejects(() => stitchPageBuffers([]))
})

test('每批最多 6 页（ENGLISH_STITCH_MAX_PAGES，覆盖一篇语篇的页数上限）', () => {
  assert.equal(ENGLISH_STITCH_MAX_PAGES, 6)
})

test('4 页连续跨页：带选项表的末页不被判"自足"掉队（负责人实拍推演）', () => {
  // 第 1-3 页：有挖空缺选项（pending）；第 4 页：有挖空且选项齐全（self-sufficient）
  const page1 = { pageNumber: 1, pageQuestions: [enStemQ(1, []), enStemQ(2, [])] }
  const page2 = { pageNumber: 2, pageQuestions: [enStemQ(3, []), enStemQ(4, [])] }
  const page3 = { pageNumber: 3, pageQuestions: [enStemQ(5, []), enStemQ(6, [])] }
  const page4 = { pageNumber: 4, pageQuestions: [enStemQ(7), enStemQ(8)] } // options 齐全
  const selected = selectEnglishMergePages([page1, page2, page3, page4])
  assert.deepEqual(selected.map(p => p.pageNumber), [1, 2, 3, 4], '四页必须全部进入合并组，末页不得掉队')
})

test('无挂起页时（全部自足）不触发合并', () => {
  const pages = [
    { pageNumber: 1, pageQuestions: [enStemQ(1), enStemQ(2)] },
    { pageNumber: 2, pageQuestions: [enPlainChoice(1), enPlainChoice(2)] },
  ]
  assert.deepEqual(selectEnglishMergePages(pages), [])
})

test('挂起 + 无挖空自足页混合：只并挖空页，单句选择页不并入', () => {
  const pages = [
    { pageNumber: 1, pageQuestions: [enStemQ(1, [])] },          // pending
    { pageNumber: 2, pageQuestions: [enPlainChoice(1)] },        // 自足，无挖空
    { pageNumber: 3, pageQuestions: [enStemQ(2)] },              // 自足，有挖空
  ]
  const selected = selectEnglishMergePages(pages)
  assert.deepEqual(selected.map(p => p.pageNumber), [1, 3])
})
