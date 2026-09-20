/**
 * 子题共享母题配图（worker.js inheritSharedStemFigures）
 *
 * 事故（2026-09-17 周末班课件第12题）：几何证明大题被拆成 (1)(2) 两个小问，
 * 公共题干「如图，在△ABC中，D为BC上一点，点P在AD上…」在 parent_stem，
 * 两个小问 content 只有「(1)若D是BC的中点…」「(2)若D是BC上任意一点…」。
 * OCR 整组都没返回 image_type / image_bbox → 没有几何裁图，完整性闸又按
 * parent_stem 判它引图 → 错题本与课件拿到一道没有图的几何题。
 *
 * 这里锁定继承规则与它的边界：只认「同页 + 公共题干逐字相同」，不跨组、不跨页、
 * 不覆盖自带框的题、不给不引图的题塞图。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { inheritSharedStemFigures } from '../server/worker.js'

const STEM = '如图，在△ABC中，D为BC上一点，点P在AD上，过点P作PM//AC交AB于点M，作PN//AB交AC于点N.'
const BBOX = { x: 1244, y: 1681, width: 269, height: 255 }

const sub1 = () => ({ id: 'q1', question_number: 12, sub_no: '1', page_number: 1, parent_stem: STEM, content: '(1)若D是BC的中点，求AM:AB的值;' })
const sub2 = () => ({ id: 'q2', question_number: 12, sub_no: '2', page_number: 1, parent_stem: STEM, content: '(2)若D是BC上任意一点，试证明：AM/AB + AN/AC = AP/AD.' })

test('同组小问共享母题配图框（模型只给了一个小问）', () => {
  const donor = { ...sub1(), image_type: 'geometry', image_bbox: { ...BBOX } }
  const receiver = sub2()
  const inherited = inheritSharedStemFigures([donor, receiver])

  assert.equal(inherited.length, 1)
  assert.equal(inherited[0].id, 'q2')
  assert.deepEqual(receiver.image_bbox, BBOX)
  assert.equal(receiver.image_type, 'geometry')
})

test('整组都没有框时无法继承（需要靠补裁脚本兜底）', () => {
  const a = sub1()
  const b = sub2()
  assert.deepEqual(inheritSharedStemFigures([a, b]), [])
  assert.equal(a.image_bbox, undefined)
  assert.equal(b.image_bbox, undefined)
})

test('自身已有框的小问不被覆盖', () => {
  const donor = { ...sub1(), image_type: 'geometry', image_bbox: { ...BBOX } }
  const own = { ...sub2(), image_type: 'geometry', image_bbox: { x: 1, y: 2, width: 300, height: 300 } }
  const inherited = inheritSharedStemFigures([donor, own])
  assert.deepEqual(inherited, [])
  assert.deepEqual(own.image_bbox, { x: 1, y: 2, width: 300, height: 300 })
})

test('不引图的小问不塞图（公共题干无引图词）', () => {
  const stem = '已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).'
  const donor = { id: 'a', question_number: 5, sub_no: '1', page_number: 1, parent_stem: stem, content: '(1)求 a、b 的值；', image_type: 'geometry', image_bbox: { ...BBOX } }
  const other = { id: 'b', question_number: 5, sub_no: '2', page_number: 1, parent_stem: stem, content: '(2)求抛物线的顶点坐标。' }
  assert.deepEqual(inheritSharedStemFigures([donor, other]), [])
  assert.equal(other.image_bbox, undefined)
})

test('不同页 / 不同公共题干不互相继承', () => {
  const donor = { ...sub1(), image_type: 'geometry', image_bbox: { ...BBOX } }
  const otherPage = { ...sub2(), id: 'q3', page_number: 2 }
  const otherStem = { ...sub2(), id: 'q4', parent_stem: '如图，在正方形ABCD中…' }

  const inherited = inheritSharedStemFigures([donor, otherPage, otherStem])
  assert.deepEqual(inherited, [])
  assert.equal(otherPage.image_bbox, undefined)
  assert.equal(otherStem.image_bbox, undefined)
})

test('parent_stem 为空/只有一题时不动作', () => {
  const solo = { id: 's', question_number: 1, page_number: 1, parent_stem: null, content: '如图，求AB的长', image_type: 'geometry', image_bbox: { ...BBOX } }
  assert.deepEqual(inheritSharedStemFigures([solo]), [])
  assert.deepEqual(inheritSharedStemFigures([]), [])
  assert.deepEqual(inheritSharedStemFigures(null), [])
})

test('image_type=none 的题不作为供体，但可作为接收方', () => {
  const donor = { ...sub1(), image_type: 'none', image_bbox: null }
  const receiver = sub2()
  assert.deepEqual(inheritSharedStemFigures([donor, receiver]), [])
  assert.equal(receiver.image_bbox, undefined)
})

test('继承 geometry_image.bbox 形态的框（兼容旧字段）', () => {
  const donor = { ...sub1(), geometry_image: { has_image: true, bbox: { ...BBOX } } }
  const receiver = sub2()
  const inherited = inheritSharedStemFigures([donor, receiver])
  assert.equal(inherited.length, 1)
  assert.deepEqual(receiver.image_bbox, BBOX)
  assert.equal(receiver.image_type, 'geometry')
  assert.equal(receiver.geometry_image.has_image, true)
})

test('缺 page_number 时用兜底页码归组（同组仍能继承）', () => {
  const donor = { ...sub1(), page_number: undefined, image_type: 'geometry', image_bbox: { ...BBOX } }
  const receiver = { ...sub2(), page_number: undefined }
  const inherited = inheritSharedStemFigures([donor, receiver], 3)
  assert.equal(inherited.length, 1)
  assert.deepEqual(receiver.image_bbox, BBOX)
})

test('三个小问只给一个框时，其余两个都继承同一个框', () => {
  const donor = { ...sub1(), image_type: 'geometry', image_bbox: { ...BBOX } }
  const b = sub2()
  const c = { id: 'q3', question_number: 12, sub_no: '3', page_number: 1, parent_stem: STEM, content: '(3)若 AP:PD=1:2，求 AN:AC 的值。' }
  const inherited = inheritSharedStemFigures([donor, b, c])
  assert.equal(inherited.length, 2)
  assert.deepEqual(b.image_bbox, BBOX)
  assert.deepEqual(c.image_bbox, BBOX)
})
