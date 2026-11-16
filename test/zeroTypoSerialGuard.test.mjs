/**
 * 零错字审计「串行替换」回归锁（2026-11-16 徐汇 q24(2-2) 事故）
 *
 * 卷面：「(2) 将抛物线向上**平移**，…① 如果 AD 恰好**平分∠CAE**，求平移之后的抛物线的表达式；」
 * 审计 plan：dbPart「移」→ modelPart「分∠CAE」（片段取自上一小问 ①）
 * 落库后：「(2) 将抛物线向上**平分∠CAE**」——改错，比不改更坏。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSerialModelPart, isResultFarFromExpect } from '../server/services/zeroTypoAuditService.js'

const OTHER = '(2) 将抛物线向上平移，设点D的对应点为点E…① 如果AD恰好平分∠CAE，求平移之后的抛物线的表达式；'

test('★ 极短锚点被塞进别处片段 ⇒ 判串行（徐汇 q24(2-2) 事故原样）', () => {
  assert.equal(
    isSerialModelPart({ dbPart: '移', modelPart: '分∠CAE', otherRowText: OTHER }),
    true
  )
})

test('⛔ 极短锚点但片段是本行独有的 ⇒ 放行（正常的单字错字修正）', () => {
  assert.equal(
    isSerialModelPart({ dbPart: '移', modelPart: '分∠CAF', otherRowText: OTHER }),
    false
  )
})

test('⛔ 长锚点局部替换 ⇒ 不判串行（合法修正大多是长锚点）', () => {
  assert.equal(
    isSerialModelPart({ dbPart: '对应点为点E', modelPart: '对应点为 E', otherRowText: OTHER }),
    false
  )
})

test('★ 结果与期望文本长度差过大 ⇒ 判偏差（片段错位的兜底）', () => {
  const expect = '(2) 将抛物线向上平移，设点 D 的对应点为点 E，射线 BE 交线段 AD 于点 F.\n② 如果 △DEF 与 △ABD 相似，求平移的距离.'
  assert.equal(isResultFarFromExpect(expect, expect), false, '完全一致不得判红')
  assert.equal(
    isResultFarFromExpect(expect, expect.replace('将抛物线向上平移，设点 D 的对应点为点 E，射线 BE 交线段 AD 于点 F.', '将抛物线向设点D，设点D的对应点为点E')),
    true,
    '锚点整体错位（少了半句又重复一段）必须判红'
  )
})
