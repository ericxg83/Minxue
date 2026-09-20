/**
 * DSL 通道离线目检（零视觉调用）。
 *
 * 用手写的 DSL 覆盖几类**生产上真实卡住的构造**（折叠/垂足/外接圆/角平分线/阴影/重心），
 * 渲染成 PNG 网格，肉眼确认图形正确、标注齐全。
 *
 * 用法：node server/scripts/dslDemo.mjs
 * 产出：server/scripts/logs/geom-dsl/demo.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { buildStructureFromDsl } from '../utils/geom/dsl/index.js'
import { renderDslToSvg } from '../utils/geom/dsl/render.js'
import { validateStructureAgainstContent } from '../utils/geometryContentGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'logs/geom-dsl')
mkdirSync(OUT, { recursive: true })

const cases = [
  {
    name: '① 折叠：沿 AC 折叠，B 落在 B′',
    content: '如图，在△ABC中，将△ABC沿AC折叠，点B落在点B′处，连接AB′。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> C
point : 40 60 -> B
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
mirror : B CA -> B′
segment : A B′ -> AB′
`
  },
  {
    name: '② 垂足：CD⊥AB 于 D',
    content: '如图，在△ABC中，CD⊥AB于点D。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> B
point : 30 70 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
foot : C AB -> D
segment : C D -> CD
right_angle : A D C -> rD
`
  },
  {
    name: '③ 外接圆 + 中点：△ABC 内接于 ⊙O，D 是 BC 中点',
    content: '如图，△ABC内接于⊙O，D是边BC的中点，连接OD。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> B
point : 20 70 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
circumcircle : A B C -> c_O
circumcenter : A B C -> O
midpoint : B C -> D
segment : O D -> OD
`
  },
  {
    name: '④ 角平分线：AD 平分 ∠BAC 交 BC 于 D',
    content: '如图，在△ABC中，AD是∠BAC的平分线，交BC于点D。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> B
point : 20 70 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
angular_bisector : B A C -> bis
intersect : bis BC -> D
segment : A D -> AD
`
  },
  {
    name: '⑤ 阴影：∠ACB=90°，求阴影部分面积',
    content: '如图，在△ABC中，∠ACB=90°，求阴影部分面积。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> B
point : 30 45.8258 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
right_angle : A C B -> rC
shade : A B C -> sh
angle_mark : A B C -> aB
label : "α" 20 18 -> L1
`
  },
  {
    name: '⑥ 重心 + 中线：G 是重心，AG 延长交 BC 于 M',
    content: '如图，在△ABC中，点G是△ABC的重心，连接AG并延长交BC于点M。',
    dsl: `
point : 0 0 -> A
point : 100 0 -> B
point : 20 70 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
centroid : A B C -> G
line : A G -> l_AG
intersect : l_AG BC -> M
segment : A M -> AM
`
  }
]

const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

const COLS = 3
const CW = 400, CH = 400
const rows = Math.ceil(cases.length / COLS)
const W = COLS * CW + 20, H = rows * CH + 20

let parts = ''
let failed = 0
for (let i = 0; i < cases.length; i++) {
  const c = cases[i]
  const built = buildStructureFromDsl(c.dsl)
  const col = i % COLS
  const row = Math.floor(i / COLS)
  const x = 10 + col * CW
  const y = 10 + row * CH

  parts += `<g transform="translate(${x},${y})">`
  parts += `<rect x="0" y="0" width="${CW - 10}" height="${CH - 10}" fill="white" stroke="#ddd"/>`
  parts += `<text x="10" y="20" font-family="sans-serif" font-size="13" fill="#111">${c.name}</text>`

  if (!built.ok) {
    failed++
    parts += `<text x="10" y="60" font-family="monospace" font-size="11" fill="#c00">DSL 执行失败：</text>`
    built.errors.slice(0, 6).forEach((e, k) => {
      parts += `<text x="10" y="${80 + k * 14}" font-family="monospace" font-size="10" fill="#c00">L${e.line} ${e.message}</text>`
    })
  } else {
    const svg = renderDslToSvg(built.structure)
    const gate = validateStructureAgainstContent(built.structure, c.content)
    if (!svg) { failed++; parts += `<text x="10" y="60" font-size="12" fill="#c00">渲染失败</text>` }
    else {
      parts += `<g transform="translate(10,30) scale(0.62)">${inner(svg)}</g>`
      const st = built.stats
      parts += `<text x="10" y="${CH - 40}" font-family="monospace" font-size="10" fill="#0a7">`
        + `${st.points}点 ${st.segments}段 ${st.circles}圆 derived=${st.derived}</text>`
      parts += `<text x="10" y="${CH - 24}" font-family="monospace" font-size="10" fill="${gate.ok ? '#0a7' : '#c00'}">`
        + `内容闸门: ${gate.ok ? 'PASS' : 'REJECT ' + (gate.reasons || []).join('；').slice(0, 70)}</text>`
    }
  }
  parts += `</g>`
}

const big = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fafafa"/>${parts}</svg>`
const png = await sharp(Buffer.from(big)).png().toBuffer()
const outPath = resolve(OUT, 'demo.png')
writeFileSync(outPath, png)
console.log(`已生成: ${outPath}  (${W}x${H}, ${png.length} 字节)`)
console.log(failed === 0 ? '全部用例执行通过' : `${failed} 个用例失败`)
