/**
 * 函数图象通道：把典型样例渲染成 PNG 拼版，供人工目检。
 * 离线、零数据库、零视觉调用（对标 geometryPrimitivesDemo.mjs）。
 *
 * 用法：node server/scripts/functionGraphDemo.mjs
 * 产出：server/scripts/logs/function-graph/check-parabolas.png
 */
import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { buildFunctionGraphSvg } from '../utils/functionGraph/index.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'logs/function-graph')

// [标题, parent_stem, content, 期望出图]
const CASES = [
  ['A 数值一般式 y=x²-2x-3', '', '已知二次函数y=x²-2x-3. (2)在平面直角坐标系xOy中,画出二次函数y=x²-2x-3的图像;', true],
  ['B 顶点式 y=½(x-2)²+4', '', '如图，将函数 y=½(x-2)²+4 的图像沿 y 轴向上平移得到一个新函数的图像', true],
  ['C 顶点(1,4)+过C(0,3) 反推', '', '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；', true],
  ['D 对称轴+过点 解 a', '', '已知抛物线 y=x²+bx+c 的对称轴为直线 x=2，且经过点 A(0,-3)', true],
  ['E 两交点+截距-4 解 a', '', '如图，已知抛物线 y=ax²+bx-4 与 x 轴分别交于点 A(2,0)、B(-4,0)，与 y 轴交于点 C，点 Q 是抛物线上一点。 (1)求抛物线的表达式；', true],
  ['F 符号+条件a<0 代表元', '', '如图，抛物线 y=ax²+bx+c(a<0) 的顶点坐标为(1,4)，则 ac 的值为', true],
  ['G 开口向下数值式', '', '已知二次函数 y=-2x²+4x+1，画出它的图像', true],
  ['H 无实根（顶点在x轴上方）', '', '已知二次函数 y=x²-2x+5，画出它的图像', true],
  ['I 顶点式+过点 解 a', '', '如图，抛物线 y=a(x-1)²+4 与 x 轴交于点 A、B，已知点 A 的坐标为(-1,0)。 (1)求该抛物线的表达式；', true],
  ['J 数轴题 → 拒绝', '', '实数a、b在数轴上的对应点如图所示，则|a-b|-|b+a|=____.', false],
  ['K 开口未知 → 拒绝', '', '如图，关于 x 的二次函数 y=ax²+bx+c 的图像与直线 y=3 相交于点 A(0,3)，对称轴为直线 x=2', false],
  ['L 题干有三角形 → 纯度闸拦下', '', '如图，抛物线 y=2(x-2)² 与平行于 x 轴的直线交于点 A、B，抛物线顶点为 C，△ABC 为等边三角形，求 △ABC 的面积', false],
]

const items = []
let unexpected = 0
for (const [name, stem, content, expect] of CASES) {
  const built = buildFunctionGraphSvg(stem, content, renderGeometrySvg)
  const ok = !!built === expect
  if (!ok) unexpected++
  if (!built) {
    console.log(`${ok ? '✅' : '❌'} ${name} → 未出图（${expect ? '但期望出图！' : '符合预期'}）`)
    continue
  }
  items.push({ name, svg: built.svg, spec: built.spec })
  console.log(`${ok ? '✅' : '❌'} ${name}  a=${built.spec.a} 开口=${built.spec.opens} 顶点=(${built.spec.vertex.x},${built.spec.vertex.y}) 来源=${built.spec.solvedFrom}${built.spec.approximate ? ' [代表元]' : ''}`)
}
if (unexpected > 0) console.log(`\n⚠️  ${unexpected} 条与预期不符`)

// 拼版：把每个 400×300 的图嵌进一张大 SVG（嵌套 <g> 平移），一次性栅格化
const COLS = 2
const CW = 400, CH = 300, PAD = 10, TITLE = 24
const rows = Math.ceil(items.length / COLS)
const W = COLS * (CW + PAD) + PAD
const H = rows * (CH + TITLE + PAD) + PAD

const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

let body = ''
items.forEach((it, i) => {
  const r = Math.floor(i / COLS)
  const c = i % COLS
  const x = PAD + c * (CW + PAD)
  const y = PAD + r * (CH + TITLE + PAD)
  body += `<text x="${x}" y="${y + 16}" font-family="sans-serif" font-size="14" fill="#111">${esc(it.name)}</text>`
  body += `<g transform="translate(${x},${y + TITLE})"><rect x="0" y="0" width="${CW}" height="${CH}" fill="#ffffff" stroke="#ddd"/>${inner(it.svg)}</g>`
})

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`

await fs.mkdir(OUT, { recursive: true })
const out = resolve(OUT, 'check-parabolas.png')
await sharp(Buffer.from(sheet)).png().toFile(out)
console.log(`\n📄 目检图：${out}`)
