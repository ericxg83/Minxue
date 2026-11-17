/**
 * 回归锁：好题甄选 → 试题篮的形状归一化（2026-11-17）
 *
 * 防的坑：两类来源的甄选题（错题 / 试卷题）喂进试卷题库篮子时，
 * 字段形状不一致导致「卷面丢选项丢图且不报错」（同 r145 铁律 12 的归一化坑）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { curatedItemToBasketInput } from '../src/workbench/utils/curatedExport.js'
import { createBasketItem, groupBasket } from '../src/utils/paperBasket.js'

const CURATED_ID = 'aaaaaaaa-1111-2222-3333-444444444444'

test('错题来源：题干/选项/答案/配图/标签全部搬入 basket，不丢字段', () => {
  const curated = {
    id: CURATED_ID,
    sourceType: 'question',
    questionType: 'choice',
    content: '下列说法正确的是',
    parentStem: '',
    options: ['A 选项', 'B 选项', 'C 选项', 'D 选项'],
    answer: 'B',
    analysis: '解析文本',
    imageUrl: 'https://cdn.example.com/q.png',
    resourceName: '',
    difficulty: 4,
    tags: ['高难', '典型'],
  }
  const basket = createBasketItem(curatedItemToBasketInput(curated))
  assert.equal(basket.id, CURATED_ID)
  assert.equal(basket.question_type, 'choice')
  assert.equal(basket.content, '下列说法正确的是')
  assert.deepEqual(basket.options, ['A 选项', 'B 选项', 'C 选项', 'D 选项'])
  assert.equal(basket.answer, 'B')
  assert.equal(basket.analysis, '解析文本')
  assert.equal(basket.image_url, 'https://cdn.example.com/q.png')
  assert.equal(basket.resource_name, '错题甄选')   // 来源缺省名
  assert.equal(basket.difficulty, 4)
  assert.deepEqual(basket.tags, ['高难', '典型'])
  assert.equal(basket.score, 4)                     // 选择题默认分
})

test('试卷题来源：保留原卷名用于讲义分组，缺答案不臆造', () => {
  const curated = {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    sourceType: 'resource_question',
    questionType: 'answer',
    content: '求证：某结论',
    parentStem: '已知条件',
    options: [],
    answer: '',
    imageUrl: 'https://cdn.example.com/r.png',
    resourceName: '2026 上海嘉定 一模',
    difficulty: null,
    tags: [],
  }
  const basket = createBasketItem(curatedItemToBasketInput(curated))
  assert.equal(basket.resource_name, '2026 上海嘉定 一模')
  assert.equal(basket.parent_stem, '已知条件')
  assert.equal(basket.answer, null)                 // 空答案归 null，不写空串
  assert.equal(basket.image_url, 'https://cdn.example.com/r.png')
  assert.equal(basket.score, 10)                    // 解答题默认分
})

test('两类来源混进同一篮子后，groupBasket 不丢题、题型分块正确', () => {
  const items = [
    createBasketItem(curatedItemToBasketInput({ id: 'a', sourceType: 'question', questionType: 'choice', content: 'Q1', options: ['x'], tags: [] })),
    createBasketItem(curatedItemToBasketInput({ id: 'b', sourceType: 'resource_question', questionType: 'answer', content: 'Q2', resourceName: '嘉定一模', tags: [] })),
    createBasketItem(curatedItemToBasketInput({ id: 'c', sourceType: 'question', questionType: 'fill', content: 'Q3', tags: ['易错'] })),
  ]
  const blocks = groupBasket(items)
  const totalItems = blocks.reduce((n, b) => n + b.groups.reduce((m, g) => m + g.items.length, 0), 0)
  assert.equal(totalItems, 3, '三道题都必须在卷面里，一道不能丢')
})
