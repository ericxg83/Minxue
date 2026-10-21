/**
 * 试卷题库「组卷」回归锁（2026-10-21）
 *
 * 对应产品评审：2026-10-21《试卷题库自助组卷》—— 负责人拍板按 P0 改。
 *
 * ── 锁的四条红线 ──
 *   ① 组卷产物是**教学素材**，不是学习事实：不得写 generated_exams / 不得进判题链路；
 *   ② 组卷**必须**重新编号（1..N）—— 与讲义「保留原卷题号」方向相反，两套版式不得互相套用；
 *   ③ 同一道大题的多个小问（20(1)/20(2)）共用公共题干，收成题组只印一次题干、只占一个题号；
 *   ④ 出卷版式不得复用 buildPaperBody / buildRetryPaperOrder / RETRY_PAPER_BLOCKS
 *      （那套带判题编号同构约束，题库题没有学生/作答，塞进去会把编号体系打乱）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  PAPER_BASKET_BLOCKS,
  normalizeBasketType,
  defaultScoreForType,
  normalizeScore,
  createBasketItem,
  addBasketItem,
  removeBasketItem,
  setBasketItemScore,
  moveBasketItem,
  isInBasket,
  groupBasket,
  basketSummary,
  composePaperTotals,
  composePaperFilename,
} from '../src/utils/paperBasket.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const q = (over = {}) => ({
  id: over.id || 'id-' + Math.random().toString(36).slice(2, 8),
  resource_id: over.resource_id || 'res-1',
  question_no: over.question_no ?? 1,
  sub_no: over.sub_no ?? '',
  question_type: over.question_type || 'answer',
  content: over.content || '题干',
  parent_stem: over.parent_stem || null,
  options: over.options || [],
  answer: over.answer ?? null,
  ...over,
})

// ─────────────────────────────────────────────────────────────
// ① 题型与分值
// ─────────────────────────────────────────────────────────────

test('题型归一到四个大题；未知值归解答题（与采集管线同口径）', () => {
  assert.equal(normalizeBasketType('choice'), 'choice')
  assert.equal(normalizeBasketType('FILL'), 'fill')
  assert.equal(normalizeBasketType('judge'), 'judge')
  assert.equal(normalizeBasketType(''), 'answer')
  assert.equal(normalizeBasketType('multi'), 'answer')
})

test('默认分值按题型取（选择/填空/判断 4 分，解答 10 分），可逐题覆盖', () => {
  assert.equal(defaultScoreForType('choice'), 4)
  assert.equal(defaultScoreForType('answer'), 10)
  assert.equal(normalizeScore('', 'choice'), 4, '空值回落默认分')
  assert.equal(normalizeScore(-5, 'answer'), 10, '负数回落默认分')
  assert.equal(normalizeScore(2.5, 'fill'), 2.5, '允许半分')
  assert.equal(normalizeScore(3, 'choice'), 3, '老师改过分要保留')
})

test('大题为 选择→填空→判断→解答 的卷面顺序', () => {
  assert.deepEqual(PAPER_BASKET_BLOCKS.map(b => b.key), ['choice', 'fill', 'judge', 'answer'])
})

// ─────────────────────────────────────────────────────────────
// ② 篮子增删改排
// ─────────────────────────────────────────────────────────────

test('加入幂等：同一道题不会被加两次', () => {
  const a = q({ id: 'x' })
  const list = addBasketItem([], a)
  const again = addBasketItem(list, a)
  assert.equal(again.length, 1)
  assert.ok(isInBasket(again, 'x'))
  assert.equal(isInBasket(again, 'nope'), false)
})

test('加入时按题型给默认分，移除后不再出现', () => {
  let list = addBasketItem([], q({ id: 'a', question_type: 'choice' }))
  list = addBasketItem(list, q({ id: 'b', question_type: 'answer' }))
  assert.equal(list[0].score, 4)
  assert.equal(list[1].score, 10)
  list = removeBasketItem(list, 'a')
  assert.deepEqual(list.map(i => i.id), ['b'])
})

test('改分只认篮子里的题；改不存在的 id 不改动数组（不得静默插空题）', () => {
  const list = addBasketItem([], q({ id: 'a', question_type: 'answer' }))
  const after = setBasketItemScore(list, 'a', 12)
  assert.equal(after[0].score, 12)
  const ghost = setBasketItemScore(list, 'ghost', 99)
  assert.equal(ghost.length, 1)
  assert.deepEqual(ghost.map(i => i.id), ['a'])
})

test('排序只在同一题型内移动（卷面按大题归位，跨题型拖动视觉上等于没动）', () => {
  let list = []
  list = addBasketItem(list, q({ id: 'c1', question_type: 'choice', question_no: 1 }))
  list = addBasketItem(list, q({ id: 'a1', question_type: 'answer', question_no: 19 }))
  list = addBasketItem(list, q({ id: 'c2', question_type: 'choice', question_no: 2 }))
  // c2 上移 → 与同题型前一位 c1 交换（a1 是别的题型，不参与排序）
  const moved = moveBasketItem(list, 'c2', -1)
  assert.deepEqual(moved.map(i => i.id), ['c2', 'c1', 'a1'])
  assert.deepEqual(moved.filter(i => i.question_type === 'choice').map(i => i.id), ['c2', 'c1'],
    '选择题大题里的顺序必须真的变成 c2 在前')
  // a1 上移 → 前面没有同题型题，原样返回
  assert.deepEqual(moveBasketItem(list, 'a1', -1).map(i => i.id), ['c1', 'a1', 'c2'])
  // 到顶再上移不越界
  assert.deepEqual(moveBasketItem(moved, 'c1', -1).map(i => i.id), ['c1', 'c2', 'a1'])
})

test('createBasketItem 只搬字段，不推断答案（空答案必须留空）', () => {
  const empty = createBasketItem({ id: 'z', content: '题', answer: '   ', question_type: 'fill' })
  assert.equal(empty.answer, null, '空白答案不得当成有效答案')
  const withAns = createBasketItem({ id: 'y', content: '题', answer: 'B', answer_source: 'printed' })
  assert.equal(withAns.answer, 'B')
  assert.equal(withAns.answer_source, 'printed')
})

// ─────────────────────────────────────────────────────────────
// ③ 分大题 + 重新编号 + 题组
// ─────────────────────────────────────────────────────────────

test('★ 按题型分大题并重新编号 1..N（组卷是新卷，不用原卷题号）', () => {
  let list = []
  list = addBasketItem(list, q({ id: 'a', question_type: 'answer', question_no: 24 }))
  list = addBasketItem(list, q({ id: 'b', question_type: 'choice', question_no: 3 }))
  list = addBasketItem(list, q({ id: 'c', question_type: 'fill', question_no: 9 }))

  const blocks = groupBasket(list)
  assert.deepEqual(blocks.map(b => b.key), ['choice', 'fill', 'answer'], '大题顺序固定')
  assert.equal(blocks[0].groups[0].items[0].sub_label, '1', '选择题排第一号，与它原卷是第 3 题无关')
  assert.equal(blocks[1].groups[0].items[0].sub_label, '2')
  assert.equal(blocks[2].groups[0].items[0].sub_label, '3')
  assert.equal(blocks[0].score, 4)
  assert.equal(blocks[2].score, 10)
})

test('★ 同大题的两个小问收成题组：公共题干只出现一次，只占一个题号', () => {
  const stem = '二次函数…对应关系如下表所示。'
  let list = []
  list = addBasketItem(list, q({ id: 's1', resource_id: 'r', question_no: 20, sub_no: '1', question_type: 'answer', parent_stem: stem, content: '求解析式' }))
  list = addBasketItem(list, q({ id: 's2', resource_id: 'r', question_no: 20, sub_no: '2', question_type: 'answer', parent_stem: stem, content: '求面积' }))

  const blocks = groupBasket(list)
  assert.equal(blocks.length, 1)
  const g = blocks[0].groups[0]
  assert.equal(blocks[0].groups.length, 1, '两问只占一个题组')
  assert.equal(g.parent_stem, stem)
  assert.deepEqual(g.items.map(i => i.sub_label), ['1(1)', '1(2)'])
  assert.equal(blocks[0].count, 2, '题量按小问计')
  assert.equal(blocks[0].score, 20, '总分按小问累加')
})

test('只选一个小问时按单题编号（不出现 1(1) 这种孤零零的小问号）', () => {
  const list = addBasketItem([], q({ id: 's1', question_no: 20, sub_no: '1', parent_stem: '公共题干' }))
  assert.equal(groupBasket(list)[0].groups[0].items[0].sub_label, '1')
})

test('不同题号 / 不同卷即使相邻也不合组（身份 = resource_id + question_no）', () => {
  const stem = '公共题干'
  const list = [
    createBasketItem(q({ id: 'a', resource_id: 'r1', question_no: 20, parent_stem: stem })),
    createBasketItem(q({ id: 'b', resource_id: 'r2', question_no: 20, parent_stem: stem })),
    createBasketItem(q({ id: 'c', resource_id: 'r1', question_no: 21, parent_stem: stem })),
  ]
  const blocks = groupBasket(list)
  assert.equal(blocks[0].groups.length, 3)
  assert.deepEqual(blocks[0].groups.map(g => g.items[0].sub_label), ['1', '2', '3'])
})

test('没有 parent_stem 的题永不合组', () => {
  const list = [
    createBasketItem(q({ id: 'a', question_no: 20 })),
    createBasketItem(q({ id: 'b', question_no: 20 })),
  ]
  assert.equal(groupBasket(list)[0].groups.length, 2)
})

test('空篮子 → 空大题数组、总分 0', () => {
  assert.deepEqual(groupBasket([]), [])
  assert.deepEqual(groupBasket(null), [])
  assert.deepEqual(composePaperTotals([]), { questionCount: 0, blockCount: 0, totalScore: 0 })
})

// ─────────────────────────────────────────────────────────────
// ④ 概况与文件名
// ─────────────────────────────────────────────────────────────

test('篮子概况：题量/总分/题型分布/缺答案数', () => {
  const list = [
    createBasketItem(q({ id: 'a', question_type: 'choice' }), 4),
    createBasketItem(q({ id: 'b', question_type: 'answer', answer: 'x=1' }), 10),
  ]
  const s = basketSummary(list)
  assert.equal(s.count, 2)
  assert.equal(s.totalScore, 14)
  assert.equal(s.byType.choice.count, 1)
  assert.equal(s.byType.answer.score, 10)
  assert.equal(s.missingAnswer, 1, '缺答案数要显式给出（教师卷那题会印「未录入」）')
})

test('文件名带题量与日期；空标题回落「组卷」', () => {
  assert.equal(composePaperFilename('周末练习', 20, '2026-10-21'), '周末练习_20题_2026-10-21')
  assert.equal(composePaperFilename('', 0, ''), '组卷')
})

// ─────────────────────────────────────────────────────────────
// ⑤ 版式方向：三套卷面不得互相套用
// ─────────────────────────────────────────────────────────────

const COMPOSE = 'src/utils/composePaperPdf.js'
const HANDOUT = 'src/utils/handoutPdf.js'

test('★ 组卷版式不得复用重练卷分块/排卷（那套带判题编号同构约束）', () => {
  const s = stripComments(read(COMPOSE))
  const bad = []
  if (/buildPaperBody/.test(s)) bad.push('不得调用 buildPaperBody')
  if (/buildRetryPaperOrder/.test(s)) bad.push('不得调用 buildRetryPaperOrder')
  if (/RETRY_PAPER_BLOCKS/.test(s)) bad.push('不得引用 RETRY_PAPER_BLOCKS')
  assert.deepEqual(bad, [])
})

test('★ 组卷必须重新编号（用 sub_label），讲义必须保留原卷题号（用 question_no）', () => {
  const compose = stripComments(read(COMPOSE))
  assert.ok(/it\.sub_label|item\.sub_label/.test(compose), '组卷题号必须取篮子生成的 sub_label')
  assert.ok(!/q\.question_no/.test(compose), '组卷不得直接印原卷题号')

  const handout = stripComments(read(HANDOUT))
  assert.ok(/q\.question_no/.test(handout), '讲义必须保留原卷题号')
})

test('★ 组卷落点是 PDF，不写任何库（教学素材，不是学习事实）', () => {
  const s = stripComments(read(COMPOSE))
  assert.ok(!/generated_exams/.test(s), '组卷不得碰 generated_exams（只允许来自 wrong_questions）')
  assert.ok(!/resource_questions/.test(s), '版式层不得写库')
  const basket = stripComments(read('src/utils/paperBasket.js'))
  assert.ok(!/generated_exams/.test(basket), '篮子不得碰 generated_exams')
})

test('反向自检：把重练卷版式塞进组卷必须判红', () => {
  const broken = "import { buildRetryPaperOrder } from './retryPaperOrder'\nconst o = buildRetryPaperOrder(qs)"
  assert.ok(/buildRetryPaperOrder/.test(broken))
  const broken2 = "const label = `${q.question_no}.`"
  assert.ok(!/sub_label/.test(broken2))
})

// ─────────────────────────────────────────────────────────────
// ⑥ 卷面细节（2026-10-21 视觉自检发现的两处）
// ─────────────────────────────────────────────────────────────

test('★ 选项必须行内渲染（纯公式选项用 renderContent 会变成居中大块，A/B/C/D 散架）', () => {
  const s = stripComments(read(COMPOSE))
  assert.ok(/renderContentInline\(opt\)/.test(s), '选项必须走 renderContentInline')
  assert.ok(!/renderContent\(opt\)/.test(s), '不得用 renderContent 渲染选项')
  // 答案同理：纯公式答案印成居中块很难读
  assert.ok(/renderContentInline\(it\.answer\)/.test(s), '答案必须走 renderContentInline')
})

test('★ 填空题只在原文没有空线时才补横线（否则上下两道空，学生不知道写哪）', () => {
  const s = stripComments(read(COMPOSE))
  assert.ok(/hasBlankMark/.test(s), '必须有「原文是否已带空线」的判据')
  assert.ok(/_\{2,\}/.test(s), '判据要认连续下划线')
  assert.ok(/\\\\underline/.test(s), '判据要认 \\underline（题库 OCR 的写法）')
  assert.ok(/!hasBlankMark/.test(s), '只有在没空线时才补 fill-line')
})
