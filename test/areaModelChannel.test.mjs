/**
 * 回归锁：分数面积模型确定性通道（第 76 轮，负责人裁决「把分数标注上去」）。
 *
 * 事故：三张「把正方形看作 1，1/2+1/4(+1/8+1/16)」找规律题（asset
 * 19a2b355 / 21784525 / 073f6f6d）经视觉重绘后只剩空框——渲染器的
 * isSymbolLabel 信任边界把含数字的标注全丢了，图里一格分数都没有。
 * 本通道从题干文本解析分数序列 + 服务端精确切分，零视觉调用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAreaModelSpec, specToAreaModelStructure, buildAreaModelSvg } from '../server/utils/areaModel/index.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'

const STEM1 = '如图①，把正方形看作1，1/2 + 1/4 = 1 - 1/4 = ___;'
const STEM2 = '如图②，把正方形看作1，1/2 + 1/4 + 1/8 = 1 - 1/8 = ___;'
const STEM3 = '如图③，把正方形看作1，1/2 + 1/4 + 1/8 + 1/16 = ___;'

test('解析：三张真实题干必须各自解析出正确的分数序列', () => {
  assert.deepEqual(parseAreaModelSpec(STEM1), { terms: ['1/2', '1/4'], n: 2 })
  assert.deepEqual(parseAreaModelSpec(STEM2), { terms: ['1/2', '1/4', '1/8'], n: 3 })
  assert.deepEqual(parseAreaModelSpec(STEM3), { terms: ['1/2', '1/4', '1/8', '1/16'], n: 4 })
})

test('不猜：序列不等比/缺版式关键词/含其它几何构造一律放弃（返回 null）', () => {
  assert.equal(parseAreaModelSpec('把正方形看作1，1/2 + 1/5 = ___'), null, '分母不是翻倍等比 → 不猜')
  assert.equal(parseAreaModelSpec('把正方形看作1，1/3 + 1/9 = ___'), null, '不是 1/2 起 → 不猜')
  assert.equal(parseAreaModelSpec('把正方形看作1，1/2 = ___'), null, '只有一格不构成切分图')
  assert.equal(parseAreaModelSpec('把圆看作1，1/2 + 1/4 = ___'), null, '不是正方形版式')
  assert.equal(parseAreaModelSpec('把正方形看作1，1/2 + 1/4，连接 AC，作 △ABC'), null, '题干还有别的构造 → 残缺图不如原裁片')
})

test('结构：依次二分的切法与原卷一致（竖切取左、横切取上交替）', () => {
  const s = specToAreaModelStructure(parseAreaModelSpec(STEM3))
  assert.ok(s, '应生成结构')
  assert.equal(s.points.length, 4 * 5, '4 个标注格 + 1 个留白格，各 4 角')
  assert.equal(s.segments.length, 4 * 5, '每格 4 条边')
  assert.deepEqual(s.labels.map(l => l.text), ['1/2', '1/4', '1/8', '1/16'])
  const at = Object.fromEntries(s.labels.map(l => [l.text, l]))
  assert.ok(at['1/2'].x < 50 && at['1/2'].x > 0, '1/2 在左半')
  assert.ok(at['1/4'].x > 50 && at['1/4'].y > 50, '1/4 在右上')
  assert.ok(at['1/8'].x > 50 && at['1/8'].y < 50 && at['1/8'].x < at['1/4'].x, '1/8 在右下区域的左格')
  assert.ok(at['1/16'].x > at['1/8'].x && at['1/16'].y > at['1/8'].y, '1/16 在 1/8 右侧区域的 upper 格')
})

test('出图：SVG 必须真带四个分数标注，且不漏内部辅助点字母', () => {
  const built = buildAreaModelSvg('找规律，完成下列各题：', STEM3, renderGeometrySvg)
  assert.ok(built && built.svg, '应出图')
  for (const term of ['1/2', '1/4', '1/8', '1/16']) {
    assert.ok(built.svg.includes(`>${term}</text>`), `SVG 必须带分数标注 ${term}（这正是事故里丢的东西）`)
  }
  assert.ok(!built.svg.includes('_a'), '内部辅助点字母绝不外泄到图上')
  const lines = (built.svg.match(/<line/g) || []).length
  assert.ok(lines >= 20, `5 个矩形 20 条边都要画出来，实际 ${lines}`)
})

test('出图：SVG 里分数的版面位置与切分一致（1/2 最靠左、1/16 最靠右下）', () => {
  const { svg } = buildAreaModelSvg('', STEM3, renderGeometrySvg)
  const pos = {}
  for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)) {
    if (/^\d+\/\d+$/.test(m[3])) pos[m[3]] = { x: +m[1], y: +m[2] }
  }
  assert.deepEqual(Object.keys(pos).sort(), ['1/16', '1/2', '1/4', '1/8'])
  // SVG 的 y 向下：1/2 居中最高（y 最小之一），1/16 在下方区域
  assert.ok(pos['1/2'].x < pos['1/4'].x, '1/2 在 1/4 左侧')
  assert.ok(pos['1/4'].y < pos['1/8'].y, '1/4 在 1/8 上方')
  assert.ok(pos['1/8'].x < pos['1/16'].x, '1/8 在 1/16 左侧')
})

test('不越界：非本版式的题干一律不出图（视觉通道照旧接管）', () => {
  assert.equal(buildAreaModelSvg('', '如图，在△ABC中，D是AB上一点，DE//BC。', renderGeometrySvg), null)
  assert.equal(buildAreaModelSvg('', '', renderGeometrySvg), null)
  assert.equal(buildAreaModelSvg(null, null, renderGeometrySvg), null)
})
