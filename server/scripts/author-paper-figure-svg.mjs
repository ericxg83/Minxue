/**
 * 手工矢量出图（2026-11-03）
 *
 * 背景：试卷题库的坐标图 / 纯几何小图交给 AI 重绘会丢刻度、丢 l1/l2/l3、把抛物线画成
 * V 形（见 .workbuddy/memory/topics/geometry-redraw.md）。这批图直接按解析式 / 图形关系
 * 生成 SVG：确定性、零 AI 成本、任意放大都锐利。
 *
 * 产物 key 固定为 paper-bank/vec/{resourceId}/{questionNo}.svg ——
 * routes/paperBank.js 的 attachVecUrls 按这个 key HEAD 探测后附 vec_url，
 * 工作台（PaperBankWorkbench）与讲解版（lecturePdf）都是 vec_url 优先。
 *
 * 用法：
 *   node server/scripts/author-paper-figure-svg.mjs --q=3,7,15,18,24          # 只写本地 _vec-out/
 *   node server/scripts/author-paper-figure-svg.mjs --q=24 --upload          # 上传 OSS（幂等覆盖）
 *
 * ⚠️ 未在 figures 里登记的题号会直接跳过；新增图请按同样方式写确定性的 path/line。
 */
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })
import { uploadBufferToKey } from '../services/ossService.js'
import { mkdirSync, writeFileSync } from 'fs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => {
  const hit = args.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const QLIST = argOf('q', '3,7,15,18,24').split(',').map(s => s.trim()).filter(Boolean)
const UPLOAD = args.includes('--upload')
const RID = argOf('resource', 'bc7a2153-6c85-42a4-9e90-c83d36ad9121') // 2026 上海嘉定 一模
const OUT = fileURLToPath(new URL('./_vec-out/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const FONT = 'font-family="Times New Roman, Times, serif" font-style="italic"'

// ── q3：y = x² − 1，开口向上，顶点在 y 轴原点下方，过 x 轴 ±1 ──
function fig3() {
  const sx = (x) => 240 + x * 55
  const sy = (y) => 360 - (y + 1.6) * 55
  const f = (x) => x * x - 1
  let d = ''
  for (let x = -2.32; x <= 2.3201; x += 0.02) d += (d ? ' L' : 'M') + sx(x).toFixed(2) + ' ' + sy(f(x)).toFixed(2)
  const tick = (x1, y1, x2, y2) => `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#111" stroke-width="1.6"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 420" width="480" height="420">
<rect width="480" height="420" fill="#fff"/>
<g stroke="#111111" fill="none" stroke-linecap="round">
  <line x1="90" y1="${sy(0).toFixed(2)}" x2="400" y2="${sy(0).toFixed(2)}" stroke-width="2.2"/>
  <line x1="${sx(0).toFixed(2)}" y1="392" x2="${sx(0).toFixed(2)}" y2="30" stroke-width="2.2"/>
  <path d="${d}" stroke-width="2.4"/>
</g>
${tick(sx(-1), sy(0) - 6, sx(-1), sy(0) + 6)}${tick(sx(1), sy(0) - 6, sx(1), sy(0) + 6)}
${tick(sx(0) - 6, sy(-1), sx(0) + 6, sy(-1))}${tick(sx(0) - 6, sy(1), sx(0) + 6, sy(1))}
${tick(sx(0) - 6, sy(2), sx(0) + 6, sy(2))}${tick(sx(0) - 6, sy(3), sx(0) + 6, sy(3))}
<polygon points="400,${sy(0).toFixed(2)} 386,${(sy(0) - 7).toFixed(2)} 386,${(sy(0) + 7).toFixed(2)}" fill="#111"/>
<polygon points="${sx(0).toFixed(2)},30 ${(sx(0) - 7).toFixed(2)},44 ${(sx(0) + 7).toFixed(2)},44" fill="#111"/>
<g ${FONT} font-size="25" fill="#111">
  <text x="${(sx(0) + 22).toFixed(2)}" y="${(sy(0) + 28).toFixed(2)}">O</text>
  <text x="${(sx(-1) - 6).toFixed(2)}" y="${(sy(0) + 30).toFixed(2)}" text-anchor="middle">-1</text>
  <text x="${(sx(1) + 4).toFixed(2)}" y="${(sy(0) + 30).toFixed(2)}" text-anchor="middle">1</text>
  <text x="412" y="${(sy(0) + 10).toFixed(2)}">x</text>
  <text x="${(sx(0) + 14).toFixed(2)}" y="40">y</text>
</g>
</svg>`
}

// ── q7：三条平行线 l1/l2/l3 + 两条截线 m/n，交点 A..F ──
function fig7() {
  const l1 = 90, l2 = 190, l3 = 330
  const mX = (y) => 150 - 30 * ((y - 20) / 360)
  const nX = (y) => 230 + 190 * ((y - 20) / 360)
  const A = [mX(l1), l1], B = [mX(l2), l2], C = [mX(l3), l3]
  const D = [nX(l1), l1], E = [nX(l2), l2], F = [nX(l3), l3]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 400" width="520" height="400">
<rect width="520" height="400" fill="#fff"/>
<g stroke="#111111" stroke-width="2.2" fill="none" stroke-linecap="round">
  <line x1="20" y1="${l1}" x2="480" y2="${l1}"/><line x1="20" y1="${l2}" x2="480" y2="${l2}"/><line x1="20" y1="${l3}" x2="470" y2="${l3}"/>
  <line x1="150" y1="20" x2="120" y2="380"/><line x1="230" y1="20" x2="420" y2="380"/>
</g>
<g ${FONT} font-size="25" fill="#111">
  <text x="${A[0] - 26}" y="${A[1] + 34}" text-anchor="middle">A</text>
  <text x="${B[0] - 28}" y="${B[1] + 34}" text-anchor="middle">B</text>
  <text x="${C[0] - 26}" y="${C[1] + 34}" text-anchor="middle">C</text>
  <text x="${D[0] + 24}" y="${D[1] + 34}" text-anchor="middle">D</text>
  <text x="${E[0] + 24}" y="${E[1] + 34}" text-anchor="middle">E</text>
  <text x="${F[0] + 22}" y="${F[1] + 34}" text-anchor="middle">F</text>
  <text x="142" y="20" text-anchor="middle">m</text><text x="242" y="20" text-anchor="middle">n</text>
  <text x="490" y="${l1 + 9}">l<tspan dy="7" font-size="16">1</tspan></text>
  <text x="490" y="${l2 + 9}">l<tspan dy="7" font-size="16">2</tspan></text>
  <text x="480" y="${l3 + 9}">l<tspan dy="7" font-size="16">3</tspan></text>
</g>
</svg>`
}

// ── q15：P/A 水平线 + Q 在下 + 竖线 + P 处指北箭头 + A 处角标 ──
function fig15() {
  const P = [90, 80], A = [450, 80], Q = [300, 260], M = [300, 80]
  const r = 40
  const ang = Math.atan2(Q[1] - A[1], Q[0] - A[0])
  const ax = A[0] + r * Math.cos(ang), ay = A[1] + r * Math.sin(ang)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300" width="520" height="300">
<rect width="520" height="300" fill="#fff"/>
<g stroke="#111111" stroke-width="2.2" fill="none" stroke-linecap="round">
  <line x1="${P[0]}" y1="${P[1]}" x2="${A[0]}" y2="${A[1]}"/>
  <line x1="${P[0]}" y1="${P[1]}" x2="${Q[0]}" y2="${Q[1]}"/>
  <line x1="${A[0]}" y1="${A[1]}" x2="${Q[0]}" y2="${Q[1]}"/>
  <line x1="${M[0]}" y1="${M[1]}" x2="${Q[0]}" y2="${Q[1]}"/>
  <path d="M ${A[0] - r} ${A[1]} A ${r} ${r} 0 0 0 ${ax.toFixed(2)} ${ay.toFixed(2)}" stroke-width="1.8"/>
  <line x1="${P[0]}" y1="132" x2="${P[0]}" y2="24" stroke-width="1.8" stroke-dasharray="9 7"/>
  <line x1="66" y1="24" x2="${P[0]}" y2="24" stroke-width="1.8"/>
</g>
<polygon points="${P[0]},18 ${P[0] - 7},32 ${P[0] + 7},32" fill="#111"/>
<g ${FONT} font-size="26" fill="#111">
  <text x="${P[0] - 26}" y="${P[1] + 32}" text-anchor="middle">P</text>
  <text x="${A[0] + 16}" y="${A[1] + 10}" text-anchor="middle">A</text>
  <text x="${Q[0]}" y="${Q[1] + 34}" text-anchor="middle">Q</text>
</g>
</svg>`
}

// ── q18：Rt△，B 在上、C 在左下（直角）、A 在右下 ──
function fig18() {
  const B = [70, 30], C = [70, 340], A = [290, 340], s = 24
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 390" width="340" height="390">
<rect width="340" height="390" fill="#fff"/>
<g stroke="#111111" stroke-width="2.4" fill="none" stroke-linecap="round">
  <path d="M ${B[0]} ${B[1]} L ${C[0]} ${C[1]} L ${A[0]} ${A[1]} Z"/>
  <path d="M ${C[0] + s} ${C[1]} L ${C[0] + s} ${C[1] - s} L ${C[0]} ${C[1] - s}" stroke-width="1.8"/>
</g>
<g ${FONT} font-size="26" fill="#111">
  <text x="${B[0] - 4}" y="${B[1] - 12}" text-anchor="middle">B</text>
  <text x="${C[0] - 20}" y="${C[1] + 30}" text-anchor="middle">C</text>
  <text x="${A[0] + 6}" y="${A[1] + 30}" text-anchor="middle">A</text>
</g>
</svg>`
}

// ── q24：y = −x² + 2x + 3，A(−1,0) B(0,3) C(3,0) D(1,4)，虚线对称轴 x=1，连 AB/BC ──
function fig24() {
  const sx = (x) => 45 + (x + 1.9) * 62.5
  const sy = (y) => 440 - (y + 1.3) * 62.5
  const f = (x) => -x * x + 2 * x + 3
  let d = ''
  for (let x = -1.62; x <= 3.6201; x += 0.03) d += (d ? ' L' : 'M') + sx(x).toFixed(2) + ' ' + sy(f(x)).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 480" width="520" height="480">
<rect width="520" height="480" fill="#ffffff"/>
<g stroke="#111111" fill="none" stroke-linecap="round">
  <line x1="50" y1="${sy(0).toFixed(2)}" x2="470" y2="${sy(0).toFixed(2)}" stroke-width="2.2"/>
  <line x1="${sx(0).toFixed(2)}" y1="440" x2="${sx(0).toFixed(2)}" y2="30" stroke-width="2.2"/>
  <path d="${d}" stroke-width="2.4"/>
  <line x1="${sx(-1).toFixed(2)}" y1="${sy(0).toFixed(2)}" x2="${sx(0).toFixed(2)}" y2="${sy(3).toFixed(2)}" stroke-width="2"/>
  <line x1="${sx(0).toFixed(2)}" y1="${sy(3).toFixed(2)}" x2="${sx(3).toFixed(2)}" y2="${sy(0).toFixed(2)}" stroke-width="2"/>
  <line x1="${sx(1).toFixed(2)}" y1="${sy(0).toFixed(2)}" x2="${sx(1).toFixed(2)}" y2="${sy(4).toFixed(2)}" stroke-width="1.6" stroke-dasharray="9 7"/>
</g>
<polygon points="470,${sy(0).toFixed(2)} 456,${(sy(0) - 7).toFixed(2)} 456,${(sy(0) + 7).toFixed(2)}" fill="#111111"/>
<polygon points="${sx(0).toFixed(2)},30 ${(sx(0) - 7).toFixed(2)},44 ${(sx(0) + 7).toFixed(2)},44" fill="#111111"/>
<g fill="#111111">
  <circle cx="${sx(-1).toFixed(2)}" cy="${sy(0).toFixed(2)}" r="3.6"/>
  <circle cx="${sx(0).toFixed(2)}" cy="${sy(3).toFixed(2)}" r="3.6"/>
  <circle cx="${sx(3).toFixed(2)}" cy="${sy(0).toFixed(2)}" r="3.6"/>
  <circle cx="${sx(1).toFixed(2)}" cy="${sy(4).toFixed(2)}" r="3.6"/>
  <circle cx="${sx(0).toFixed(2)}" cy="${sy(0).toFixed(2)}" r="3.2"/>
</g>
<g ${FONT} font-size="25" fill="#111111">
  <text x="${(sx(-1) - 4).toFixed(2)}" y="${(sy(0) + 30).toFixed(2)}" text-anchor="middle">A</text>
  <text x="${(sx(0) - 22).toFixed(2)}" y="${(sy(3) - 6).toFixed(2)}" text-anchor="middle">B</text>
  <text x="${(sx(3) + 4).toFixed(2)}" y="${(sy(0) + 30).toFixed(2)}" text-anchor="middle">C</text>
  <text x="${(sx(1) + 24).toFixed(2)}" y="${(sy(4) - 4).toFixed(2)}" text-anchor="middle">D</text>
  <text x="${(sx(0) - 22).toFixed(2)}" y="${(sy(0) + 30).toFixed(2)}" text-anchor="middle">O</text>
</g>
<g ${FONT} font-size="23" fill="#111111">
  <text x="${sx(4.6).toFixed(2)}" y="${(sy(0) + 34).toFixed(2)}" text-anchor="middle">x</text>
  <text x="${(sx(0) + 26).toFixed(2)}" y="44" text-anchor="middle">y</text>
</g>
</svg>`
}

const figures = { 3: fig3, 7: fig7, 15: fig15, 18: fig18, 24: fig24 }

let n = 0
for (const q of QLIST) {
  const fn = figures[q]
  if (!fn) { console.log(`[跳] q${q} 未登记`); continue }
  const svg = fn()
  const buf = Buffer.from(svg, 'utf8')
  writeFileSync(`${OUT}q${q}.svg`, buf)
  if (UPLOAD) {
    const key = `paper-bank/vec/${RID}/${q}.svg`
    const url = await uploadBufferToKey(buf, key, 'image/svg+xml')
    console.log(`[传] q${q} ${buf.length}B -> ${url.slice(-42)}`)
  } else {
    console.log(`[写] q${q} ${buf.length}B -> ${OUT}q${q}.svg`)
  }
  n++
}
console.log(`完成 ${n} 张${UPLOAD ? '（已上传）' : '（本地，未上传）'}`)
process.exit(0)
