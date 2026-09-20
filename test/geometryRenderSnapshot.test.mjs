import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(fs.readFileSync(resolve(ROOT, p), 'utf8'))
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

const fixture = readJson('e2e/fixtures/geometry-golden.json')
const baseline = readJson('test/fixtures/geometry-v1-snapshot.json')
const withStructure = fixture.items.filter(i => i.structure)

// 出版级改造要重写渲染器与坐标求解，但重构过程中的每一步都必须证明"没有顺手改坏
// 已经画对的图"。这里锁住库内全部存量结构的 v1 渲染输出，逐字节比对。
//
// 2026-09-19 快照更新（**有意的**）：顶点标注摆位从「只朝远离质心方向偏移」升级为
// 「候选方向打分择优」（新增避让线段/其它文字/其它点/画布边界，见 server/utils/geom/labelPlace.js），
// 起因是老师反馈"字母压到线上"。更新前已用 HEAD 版渲染器逐样本核验：
// **几何线条部分（剔除全部 <text> 后）与旧版逐字节完全一致**，9 个样本的文字数量也未变，
// 差异只出现在 `<text>` 的 x/y/text-anchor 上。改动只影响标注位置，不影响图形本身。
//
// 2026-09-19 二次更新（**有意的**）：标注摆位二修——「压线」判据只罚横跨线段本体、
// 不罚贴着自己顶点（端点）；偏好方向从「远离质心」换成「外角平分线」（vertexPref）；
// 并新增直角坐标系落轴点/原点摆位（resolveCoordAxisLabels）。起因是老师反馈
// "A 点应该是在 x 轴上、0 代表原点应是两轴交点，目前全部偏移"与"正方形的 C、D 两顶点摆得不对称"。
// 本次更新前的核验方式与上次不同（这次不再有可用的旧渲染器副本），改用**更强的机械判据**：
// 逐样本比对 `resolveAxisLabels(s)` 与 `resolveNumberAxisLabels(s)` —— 轴系判据一旦变化就会
// 带动圆点吸附（=几何变化），实测 9/9 完全相等 ⇒ 圆点与线条不可能变，差异只可能在 `<text>`。
// 为了让这条判据以后**可机械复核**，基线起新增 `geomSha256`（剔除全部 `<text>` 后的哈希）：
// 以后更新快照时，若 `geomSha256` 变了，就是动了图形本身，必须逐张肉眼核，不能直接改基线。
//
// 2026-09-19 三次更新（**有意的**）：标注摆位三修——直角扇区（外角平分线为 45° 斜向）
// 一律量化到正上/正下，起因是老师第二次反馈"正方形 C、D 的位置依旧很奇怪"（原卷上两字母
// 都正对顶点，斜插会横移一个文字宽度）。本次更新同样逐样本核验：**9/9 样本的 `geomSha256`
// 与上一版完全一致**，只有 3b05e732、a6d65c96 两个样本的 `<text>` x/y 变化。
// 注意：本次同时新增了「辅助点密采样折线 → 曲线」的兜底（server/utils/geom/structure.js
// `mergeSampledCurveChains`），但黄金集 9 个样本都没有这种折线，故几何哈希不受影响。
const stripText = (svg) => (svg || '').replace(/<text\b[^>]*>[^<]*<\/text>/g, '')

test('存量结构的 v1 渲染输出逐字节不变', () => {
  assert.ok(withStructure.length > 0, '黄金集里应有带结构的样本')
  for (const item of withStructure) {
    const svg = renderGeometrySvg(item.structure)
    const base = baseline[item.shortId]
    assert.ok(base, `缺少 ${item.shortId} 的基线快照`)
    assert.equal(svg?.length ?? 0, base.length, `${item.shortId} 渲染长度变了`)
    assert.equal(sha(svg || ''), base.sha256, `${item.shortId} 渲染内容变了`)
  }
})

// 几何图元（线条/圆弧/曲线/圆点）必须逐字节不变——标注挪位可以有意更新基线，
// 图形本身挪位一律视为改坏，必须逐张肉眼核过再决定。
test('存量结构的几何图元逐字节不变（剔除全部文字标注）', () => {
  for (const item of withStructure) {
    const base = baseline[item.shortId]
    assert.ok(base?.geomSha256, `缺少 ${item.shortId} 的几何基线（请重跑基线生成）`)
    assert.equal(
      sha(stripText(renderGeometrySvg(item.structure))),
      base.geomSha256,
      `${item.shortId} 的几何图元变了——不是标注挪位，是图形被改坏了`
    )
  }
})

test('TikZ 渲染器与 SVG 渲染器共用同一份结构规范化', () => {
  for (const item of withStructure) {
    const tikz = renderGeometryTikZ(item.structure)
    assert.ok(tikz?.startsWith('\\begin{tikzpicture}'), `${item.shortId} 应产出 tikzpicture`)
  }
})

test('TikZ 路径同样过滤手写数字标注', () => {
  // 历史上 geometryTikZ.js 自带一份 normalizeStructure 但漏了符号过滤，
  // 于是学生手写的已知条件与答案会被抄进 TikZ，伪装成题设。
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 },
      { label: 'B', x: 10, y: 0 },
      { label: 'C', x: 5, y: 8 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
    labels: [
      { text: '6cm', x: 5, y: -1 },
      { text: '√18', x: 8, y: 4 },
      { text: '30°', x: 1, y: 1 },
      { text: 'α', x: 5, y: 6 }
    ]
  }
  const tikz = renderGeometryTikZ(structure)
  for (const junk of ['6cm', '18', '30']) {
    assert.ok(!tikz.includes(junk), `手写标注 ${junk} 不应进入 TikZ`)
  }
  assert.ok(tikz.includes('α'), '符号型角名应保留')
})

test('points[].name 别名在两个渲染器里都能识别', () => {
  const structure = {
    figure_type: 'geometry',
    points: [{ name: 'P', x: 0, y: 0 }, { name: 'Q', x: 6, y: 0 }],
    segments: [{ from: 'P', to: 'Q' }]
  }
  assert.ok(renderGeometrySvg(structure)?.includes('>P<'))
  assert.ok(renderGeometryTikZ(structure)?.includes('$P$'))
})
