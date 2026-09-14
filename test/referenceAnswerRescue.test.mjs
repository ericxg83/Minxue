// 回归测试：参考答案「救援」（把模型自述残句还原成可用答案）
//
// 样本全部取自生产 question_cache 实测（2026-09-14 错题再测-0911 全库审计，
// 客观题里 14 条叙述型答案）。救援只在答案已经是叙述型时出手：
// 拿不到干净值就返回 null，由调用方清空并转人工 —— 绝不用半截句子冒充答案。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rescueReferenceAnswer } from '../server/utils/referenceAnswerRescue.js'

test('① 解析里有文末答案标记 → 用解析值（错题再测-0911 #5）', () => {
  const analysis = '√10 确实是无理数，所以 10 也应该包括在内。\n所以正确答案应包含10。\n最终答案：2,3,5,6,7,8,10。'
  assert.equal(rescueReferenceAnswer('应包含10', analysis), '2,3,5,6,7,8,10')
})

test('① 剥掉残留脚手架（`应为 C` / `应为①、④、⑤`）', () => {
  assert.equal(rescueReferenceAnswer('应为 C', '……最终答案为：应为 C。'), 'C')
  assert.equal(rescueReferenceAnswer('应为①、④、⑤', '……最终答案：应为①、④、⑤。'), '①、④、⑤')
  assert.equal(
    rescueReferenceAnswer('应为“五,五,-4a⁵+a³b-a²+3ab²+3”', '……最终答案：五,五,-4a⁵+a³b-a²+3ab²+3'),
    '五,五,-4a⁵+a³b-a²+3ab²+3'
  )
})

test('② 残句末尾「…是 X」→ 取 X', () => {
  assert.equal(rescueReferenceAnswer('125，所以 125 的立方根是 5', '没有任何标记的解析'), '5')
  assert.equal(rescueReferenceAnswer('27，所以 27 的立方根是 3', ''), '3')
  assert.equal(
    rescueReferenceAnswer('20，能被5整除，所以满足条件的最小三位数是100', ''),
    '100'
  )
  assert.equal(
    rescueReferenceAnswer('3能被3整除，所以能被2、3整除的最小两位数是12', ''),
    '12'
  )
})

test('③ 残句头部截断 → 取前半段', () => {
  assert.equal(
    rescueReferenceAnswer('写作0.31818...（或标准循环小数记法0.3\\overline{18}），但按题目要求只需写出小数形式', ''),
    '0.31818...'
  )
  assert.equal(
    rescueReferenceAnswer('y = 100 - 20x（因为10√2约等于14.14，所以10√2x约等于141.4）', ''),
    'y = 100 - 20x'
  )
  assert.equal(
    rescueReferenceAnswer("'<,>,>'，说明题目中图像顶点应在 y 轴左侧（x < 0）", ''),
    '<,>,>',
    '剥掉引用引号，与判等层的归一口径一致'
  )
})

test('救不回来 → null（调用方清空并转人工），不许拿半截句子冒充答案', () => {
  assert.equal(
    rescueReferenceAnswer('8^(1/4)，选项中没有，因此无法唯一确定，答案应为待人工补充', ''),
    null,
    '「选项中没有/无法唯一确定」是模型自己在说这题有问题，必须转人工'
  )
  assert.equal(
    rescueReferenceAnswer('-9，则可能是题目有其他隐含条件或理解偏差', ''),
    null,
    '模型自己都在猜（「可能是题目有其他隐含条件」）→ 转人工，不拿猜测值顶上'
  )
  assert.equal(rescueReferenceAnswer('应包含10', '解析里也没有答案标记，纯叙述。'), null)
  assert.equal(rescueReferenceAnswer('应为这些', ''), null)
  assert.equal(
    rescueReferenceAnswer('……因此 y₂ 是负数，该结论不成立', ''),
    null,
    '末尾「是负数」不得被当成答案'
  )
})

test('正常答案一律原样返回（救援不碰好答案）', () => {
  for (const good of ['√6+2', '281/90', '2,3,5,6,7,8,10', 'C', '>', '正确']) {
    assert.equal(rescueReferenceAnswer(good, '随便一段解析'), good)
  }
  assert.equal(rescueReferenceAnswer('', ''), null)
  assert.equal(rescueReferenceAnswer(null, null), null)
})
