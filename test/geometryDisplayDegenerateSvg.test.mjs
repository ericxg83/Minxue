import test from 'node:test'
import assert from 'node:assert/strict'
import { getGeometryDisplayUrl, isDegenerateGeometrySvg } from '../src/utils/geometryDisplay.js'

// SVG 样本取自库内真实数据（questions.clean_geometry_svg），不要改写成合成内容 ——
// 判据的价值就在于能不能顶住渲染器真实产物的形态。

// ed15adea 第11题：只有 A、B 两个顶点圆点 + 一条**空的**线段组，一条线都没有。
// 批改中心按优先级 1 内联渲染它 → 老师看到一张几乎空白的图（第58题现象的成因之一）。
const DEGENERATE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">'
  + '<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>'
  + '<g stroke="#111111" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"></g>'
  + '<g fill="#111111"><circle cx="220.12" cy="36" r="2.4"/><circle cx="179.88" cy="264" r="2.4"/></g>'
  + '<g fill="#111111" font-family="Times New Roman, serif" font-size="16" font-style="italic">'
  + '<text x="222.9" y="25.24" text-anchor="middle">A</text>'
  + '<text x="177.1" y="284.76" text-anchor="middle">B</text></g>'
  + '<g fill="#111111" font-family="Times New Roman, serif" font-size="14"></g></svg>'

// ad1dfe28：正常产物（三条线段 + 顶点圆点 + 标注）
const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">'
  + '<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>'
  + '<g stroke="#111111" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">'
  + '<line x1="36" y1="68" x2="364" y2="232"/><line x1="36" y1="68" x2="364" y2="68"/>'
  + '<line x1="138.5" y1="141.8" x2="282" y2="68"/></g>'
  + '<g fill="#111111"><circle cx="36" cy="68" r="2.4"/><circle cx="364" cy="232" r="2.4"/></g>'
  + '<g fill="#111111" font-family="Times New Roman, serif" font-size="16" font-style="italic">'
  + '<text x="20.43" y="69.31" text-anchor="end">O</text></g></svg>'

test('画残的 SVG（只有顶点圆点、无线段）判为残图', () => {
  assert.equal(isDegenerateGeometrySvg(DEGENERATE), true)
})

test('正常 SVG 不判残图', () => {
  assert.equal(isDegenerateGeometrySvg(GOOD), false)
})

test('path / polyline / polygon / ellipse 也算有效图元（渲染器将来换写法不误杀）', () => {
  for (const el of ['<path d="M0 0L10 10"/>', '<polyline points="0,0 1,1"/>',
    '<polygon points="0,0 1,1 2,0"/>', '<ellipse cx="1" cy="1" rx="9" ry="9"/>']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${el}</svg>`
    assert.equal(isDegenerateGeometrySvg(svg), false, el)
  }
})

test('大圆（r>=12）算有效图元——为将来用 <circle> 画圆题留后门', () => {
  assert.equal(isDegenerateGeometrySvg('<svg><circle cx="1" cy="1" r="60"/></svg>'), false)
  // 顶点小圆点不算
  assert.equal(isDegenerateGeometrySvg('<svg><circle cx="1" cy="1" r="2.4"/></svg>'), true)
})

test('非 SVG 输入不判残图（空值/URL/TikZ 代码走各自分支）', () => {
  assert.equal(isDegenerateGeometrySvg(null), false)
  assert.equal(isDegenerateGeometrySvg(''), false)
  assert.equal(isDegenerateGeometrySvg('https://x/y.png'), false)
  assert.equal(isDegenerateGeometrySvg('\\begin{tikzpicture}'), false)
})

test('取图跳过残图 SVG，回退到裁剪原图（第58题：批改中心曾显示几乎空白的图）', () => {
  const r = getGeometryDisplayUrl({
    clean_geometry_svg: DEGENERATE,
    clean_geometry_image_url: null,
    geometry_image_url: 'https://oss/crop.png',
  })
  assert.equal(r.type, 'raw')
  assert.equal(r.url, 'https://oss/crop.png')
})

test('取图仍优先用正常 SVG（不得因为新增闸门把好图降级）', () => {
  const r = getGeometryDisplayUrl({
    clean_geometry_svg: GOOD,
    geometry_image_url: 'https://oss/crop.png',
  })
  assert.equal(r.type, 'svg_code')
  assert.equal(r.url, GOOD)
})

test('残图且无任何回退 → none，不返回空白图', () => {
  const r = getGeometryDisplayUrl({ clean_geometry_svg: DEGENERATE })
  assert.equal(r.type, 'none')
  assert.equal(r.url, null)
})

test('老师手动覆盖的配图优先级最高，不受残图闸影响', () => {
  const r = getGeometryDisplayUrl({
    geometry_manual_override: true,
    geometry_image_url: 'https://oss/manual.png',
    clean_geometry_svg: GOOD,
  })
  assert.equal(r.type, 'raw')
  assert.equal(r.url, 'https://oss/manual.png')
})
