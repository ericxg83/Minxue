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
