// 读画分离构造管线（2026-09-27 晚）：视觉模型"画图时写不对图中数字"的能力缺口，
// 用「人核转录 + 确定性渲染」绕过 —— 标注清单由人工对照原卷核实后写死在配方里，
// 图形本体用解析式采样/图元构造，数学自检不过即拒绝出图。
//
// 配方一 9b409c35：二次函数图像（虚线网格 x∈[-2,4]、y∈[-1,6]，
//   抛物线过 (-1,0)、(4,0)，顶点 (1.5,6.25) → y=-x²+3x+4，标注由原卷转录）。
// 配方二 2d0554b8：抛物线拱桥（母题干"拱顶离水面4米、水面宽8米"，O 在左拱脚，
//   y=-x²/4+2x，尺寸标注 4m/8m，虚线引线）。
//
// 用法：node scripts/construct-labeled-figures-0927.mjs           # 出预览
//       node scripts/construct-labeled-figures-0927.mjs --apply   # 落库+发布URL
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'fs'
import sharp from 'sharp'
import { renderGeometrySvg } from '../utils/geometrySvg.js'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null
const r2 = (n) => Math.round(n * 1000) / 1000

// ── 自检工具 ──
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
function assertCurve(f, samples, points, name) {
  for (const [x, y] of points) {
    const v = f(x)
    if (!near(v, y, 1e-9)) { console.error(`⛔ ${name}: 曲线自检失败 f(${x})=${v} ≠ ${y}`); process.exit(1) }
  }
}

// ── 配方一 9b409c35：y = -x²+3x+4，虚线网格 x∈[-2,4]、y∈[-1,6] ──
const f1 = (x) => -x * x + 3 * x + 4
assertCurve(f1, null, [[-1, 0], [4, 0], [1.5, 6.25], [0, 4], [3, 4]], '9b409c35')
const curve1 = []
for (let x = -1.25; x <= 4.25; x += 0.05) { const y = f1(x); if (y >= -1.1) curve1.push([r2(x), r2(y)]) }
const V = (x, y, text) => ({ x, y, text, verified: true })
const xTicks = [-2, -1, 1, 2, 3, 4]
const s1 = {
  figure_type: 'function',
  grid: { x: -2, y: -1, unit: 1, cols: 6, rows: 7 },
  coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true },
  points: [{ label: 'O', x: 0, y: 0 }],
  curves: [{ points: curve1 }],
  labels: [
    ...[-2, -1, 1, 2, 3, 4].map(t => V(t, -0.35, String(t))),
    ...[-1, 1, 2, 3, 4, 5, 6].map(t => V(-0.38, t, String(t))),
    V(1, -1.7, '第2题图'),
  ],
}

// ── 配方二 2d0554b8：拱桥 y = -x²/4 + 2x（O 在左拱脚，拱顶(4,4)，右脚(8,0)）──
const f2 = (x) => -x * x / 4 + 2 * x
assertCurve(f2, null, [[0, 0], [8, 0], [4, 4]], '2d0554b8')
const curve2 = []
for (let x = 0; x <= 8; x += 0.05) curve2.push([r2(x), r2(f2(x))])
const s2 = {
  figure_type: 'function',
  coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true },
  // `_` 前缀 = 渲染器辅助点约定：参与线段几何，不画圆点不出字母
  points: [
    { label: 'O', x: 0, y: 0 },
    { label: '_G1', x: 4, y: 0 },
    { label: '_G2', x: 4, y: 4 },
    { label: '_W1', x: 0, y: -0.7 },
    { label: '_W2', x: 8, y: -0.7 },
  ],
  curves: [{ points: curve2 }],
  segments: [
    { from: '_G1', to: '_G2', style: 'dashed' },  // 拱顶 4m 引线
    { from: '_W1', to: '_W2', style: 'dashed' },  // 水面宽 8m 引线
  ],
  labels: [
    V(4.35, 2, '4m'),
    V(4, -1.05, '8m'),
  ],
}

// ── 配方三 fe7f2bc4：数轴 a < -√3 < 0 < b < √3（原卷系扫描旋转的竖放数轴，按标准横轴重绘）──
// 转录自重裁后裁片：a 在 -√3 左侧约 0.9 单位、b 在 0 右侧约 0.9 单位（位置只需相对序，不影响化简）。
const S3 = 1.7320508
const s3 = {
  figure_type: 'function',
  coordinate_system: { exists: true, origin: '0', x_axis: true, y_axis: false },
  points: [
    { label: '0', x: 0, y: 0 },
    { label: 'a', x: -S3 - 0.9, y: 0 },
    { label: 'b', x: 0.9, y: 0 },
    { label: '_t1', x: -S3, y: -0.14 },
    { label: '_t2', x: -S3, y: 0.14 },
    { label: '_t3', x: 0, y: -0.14 },
    { label: '_t4', x: 0, y: 0.14 },
    { label: '_t5', x: S3, y: -0.14 },
    { label: '_t6', x: S3, y: 0.14 },
  ],
  segments: [
    { from: '_t1', to: '_t2' }, { from: '_t3', to: '_t4' }, { from: '_t5', to: '_t6' },
  ],
  labels: [
    V(-S3, -0.42, '-√3'), V(S3, -0.42, '√3'),
    // 0 不放这里：cs.origin='0' 的原点分支已出字，再放会重复（实测双 0）
  ],
}

// ── 配方四 4bb93a21：A 系纸嵌套折叠图（外框 A₃，逐次对折得 A₄..A₈）──
// 全部折线与标签位置已用裁片 5 个标签的像素坐标反推验证吻合；裁片右侧/底部被切掉的
// 边界由「A系纸长宽比恒为√2 + 逐次对折」唯一确定，不是猜。
{
  const W = 6 * Math.SQRT2, H = 6
  // 自检：所有 A 型纸长宽比 = √2（题干"长宽之比是定值"）
  const ratio = (w, h) => Math.max(w, h) / Math.min(w, h)
  const regions = {
    A4: [W / 2, H], A5: [W / 4, H / 2], A6: [W / 4, H / 2], A7: [W / 4, H / 4], A8: [W / 8, H / 4],
  }
  for (const [k, [w, h]] of Object.entries(regions)) {
    if (!near(ratio(w, h), Math.SQRT2, 1e-9)) { console.error(`⛔ 4bb93a21: ${k} 长宽比 ${r2(ratio(w, h))} ≠ √2`); process.exit(1) }
  }
  const aux = (label, x, y) => ({ label, x: r2(x), y: r2(y) })
  var s4 = {
    figure_type: 'geometry',
    points: [
      aux('_c1', 0, 0), aux('_c2', W, 0), aux('_c3', W, H), aux('_c4', 0, H),
      aux('_f1', W / 2, 0), aux('_f2', W / 2, H),             // A₃→A₄ 竖折线
      aux('_f3', 0, H / 2), aux('_f4', W / 2, H / 2),         // A₄→A₅ 横折线
      aux('_f5', W / 4, H / 2), aux('_f6', W / 4, H),         // A₄→A₆ 竖折线
      aux('_f7', 0, 3 * H / 4), aux('_f8', W / 4, 3 * H / 4), // A₄→A₇ 横折线
      aux('_f9', W / 8, 3 * H / 4), aux('_f10', W / 8, H),    // A₄→A₈ 竖折线
    ],
    segments: [
      { from: '_c1', to: '_c2' }, { from: '_c2', to: '_c3' }, { from: '_c3', to: '_c4' }, { from: '_c4', to: '_c1' },
      { from: '_f1', to: '_f2' }, { from: '_f3', to: '_f4' }, { from: '_f5', to: '_f6' },
      { from: '_f7', to: '_f8' }, { from: '_f9', to: '_f10' },
    ],
    labels: [
      V(3 * W / 4, H / 2, 'A₄'), V(W / 4, H / 4, 'A₅'), V(3 * W / 8, 3 * H / 4, 'A₆'),
      V(W / 8, 5 * H / 8, 'A₇'), V(3 * W / 16, 7 * H / 8, 'A₈'),
    ],
  }
}

// ── 配方五 d6bdb7e3：与 fe7f2bc4 同题（数轴 a<-√3<0<b<√3），裁片曾错裁成学生手写，
//   已 relocate 重裁为正确数轴（模型框人工目检 + --no-refine 落库），复用配方三结构 ──
const s5 = JSON.parse(JSON.stringify(s3))

// ── 配方六 40bb33a0：A₀ 嵌套折叠图（relocate 重裁后人工目检：外框 + 7 条逐次对折线，
//   右半 A₂、左列嵌套 A₃..A₈、A₀ 标注在外框底边折脚下、最左上小矩形无标签）──
{
  const W = 6 * Math.SQRT2, H = 6
  // 自检：对折链上每个区域长宽比都是 √2（题干"长宽之比是定值"）
  const ratio = (w, h) => Math.max(w, h) / Math.min(w, h)
  const regions6 = {
    A2: [W / 2, H], A3: [W / 2, H / 2], A4: [W / 4, H / 2],
    A5: [W / 4, H / 4], A6: [W / 8, H / 4], A7: [W / 8, H / 8], A8: [W / 16, H / 8],
  }
  for (const [k, [w, h]] of Object.entries(regions6)) {
    if (!near(ratio(w, h), Math.SQRT2, 1e-9)) { console.error(`⛔ 40bb33a0: ${k} 长宽比 ${r2(ratio(w, h))} ≠ √2`); process.exit(1) }
  }
  const aux = (label, x, y) => ({ label, x: r2(x), y: r2(y) })
  var s6 = {
    figure_type: 'geometry',
    points: [
      aux('_c1', 0, 0), aux('_c2', W, 0), aux('_c3', W, H), aux('_c4', 0, H),
      aux('_f1', W / 2, 0), aux('_f2', W / 2, H),                 // A₀→A₂ 竖折线（右半 A₂）
      aux('_f3', 0, H / 2), aux('_f4', W / 2, H / 2),             // A₃ 横折线
      aux('_f5', W / 4, H / 2), aux('_f6', W / 4, H),             // A₄ 竖折线
      aux('_f7', 0, 3 * H / 4), aux('_f8', W / 4, 3 * H / 4),     // A₅ 横折线
      aux('_f9', W / 8, 3 * H / 4), aux('_f10', W / 8, H),        // A₆ 竖折线
      aux('_f11', 0, 7 * H / 8), aux('_f12', W / 8, 7 * H / 8),   // A₇ 横折线
      aux('_f13', W / 16, 7 * H / 8), aux('_f14', W / 16, H),     // A₈ 竖折线
    ],
    segments: [
      { from: '_c1', to: '_c2' }, { from: '_c2', to: '_c3' }, { from: '_c3', to: '_c4' }, { from: '_c4', to: '_c1' },
      { from: '_f1', to: '_f2' }, { from: '_f3', to: '_f4' }, { from: '_f5', to: '_f6' },
      { from: '_f7', to: '_f8' }, { from: '_f9', to: '_f10' }, { from: '_f11', to: '_f12' },
      { from: '_f13', to: '_f14' },
    ],
    labels: [
      V(3 * W / 4, H / 2, 'A₂'), V(W / 4, H / 4, 'A₃'), V(3 * W / 8, 3 * H / 4, 'A₄'),
      V(W / 8, 5 * H / 8, 'A₅'), V(3 * W / 16, 7 * H / 8, 'A₆'), V(W / 16, 13 * H / 16, 'A₇'),
      V(3 * W / 32, 15 * H / 16, 'A₈'), V(W / 2, -0.32, 'A₀'),
    ],
  }
}

// ── 配方七 033d6738：羊圈示意图（矩形 ABCD，AD 靠墙：墙线带斜杠阴影且两端延伸；
//   底边 BC 上 E、F 两点，中间标「出口」）──
{
  const W = 13, H = 7
  const aux = (label, x, y) => ({ label, x: r2(x), y: r2(y) })
  const hatchPts = []
  const hatchSegs = []
  for (let i = 0; i < 12; i++) {
    const x = r2(-0.9 + i * (W + 1.8) / 11)
    hatchPts.push(aux(`_h${i}a`, x, H), aux(`_h${i}b`, x - 0.45, H + 0.55))
    hatchSegs.push({ from: `_h${i}a`, to: `_h${i}b` })
  }
  var s7 = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: H }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: W, y: 0 }, { label: 'D', x: W, y: H },
      { label: 'E', x: 7.4, y: 0 }, { label: 'F', x: 9.4, y: 0 },
      ...hatchPts,
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
      ...hatchSegs,
    ],
    labels: [ V(8.4, 0.55, '出口') ],
  }
}


// ── 配方八 dc357206：4×3 格点三等分作图题（A(1,3)、B(0,0)、C(4,1)，
//   作图痕迹 = 网格对角线 y=x-1/x-2/x-3，与 BC 交点即三等分点 E(4/3,1/3)、F(8/3,2/3)）──
{
  const aux = (label, x, y) => ({ label, x: r2(x), y: r2(y) })
  const E = [4 / 3, 1 / 3], F = [8 / 3, 2 / 3]
  // 自检：E、F 三等分 BC
  const seg = (p, q) => [q[0] - p[0], q[1] - p[1]]
  const s1v = seg([0, 0], E), s2v = seg(E, F), s3v = seg(F, [4, 1])
  if (!near(s1v[0], s2v[0]) || !near(s1v[1], s2v[1]) || !near(s2v[0], s3v[0]) || !near(s2v[1], s3v[1])) {
    console.error('⛔ dc357206: E/F 非三等分点'); process.exit(1)
  }
  var s8 = {
    figure_type: 'geometry',
    grid: { x: 0, y: 0, unit: 1, cols: 4, rows: 3 },
    points: [
      { label: 'A', x: 1, y: 3 }, { label: 'B', x: 0, y: 0 }, { label: 'C', x: 4, y: 1 },
      { label: 'E', x: r2(E[0]), y: r2(E[1]) }, { label: 'F', x: r2(F[0]), y: r2(F[1]) },
      aux('_d1a', 1, 0), aux('_d1b', 2, 1),
      aux('_d2a', 2, 0), aux('_d2b', 3, 1),
      aux('_d3a', 3, 0), aux('_d3b', 4, 1),
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
      { from: '_d1a', to: '_d1b' }, { from: '_d2a', to: '_d2b' }, { from: '_d3a', to: '_d3b' },
    ],
    labels: [],
  }
}
// ── 配方九：多面板格点相似三角形选择题（第3题，4 道同文重复收录共用此配方）──
// 题图 △ABC：B(0,0)、C(4,0)、A(1,1)，边 {√2,√10,4}；
// 选项 A {√5,√5,4}、B {√5,3,2√5}、C {2,2√5,4√2}、D {√10,√13,√17}。
// 自检：仅 C 与题图相似（放大 2 倍），A/B/D 必须不相似 —— 转录自洽闸。
// 交叉验证：cceab838 原卷上的学生手写边长标注（2√5/3/√5、2√5/4√2/2）与转录逐边吻合。
{
  const aux = (label, x, y) => ({ label, x: r2(x), y: r2(y) })
  const panelGrid = (x0) => {
    const pts = [], segs = []
    for (let k = 0; k <= 4; k++) {
      pts.push(aux(`_g${x0}v${k}a`, x0 + k, 0), aux(`_g${x0}v${k}b`, x0 + k, 4))
      segs.push({ from: `_g${x0}v${k}a`, to: `_g${x0}v${k}b` })
      pts.push(aux(`_g${x0}h${k}a`, x0, k), aux(`_g${x0}h${k}b`, x0 + 4, k))
      segs.push({ from: `_g${x0}h${k}a`, to: `_g${x0}h${k}b` })
    }
    return { pts, segs }
  }
  const tri = (x0, verts) => {
    const pts = verts.map((v, i) => aux(`_t${x0}_${i}`, x0 + v[0], v[1]))
    const segs = [0, 1, 2].map(i => ({ from: `_t${x0}_${i}`, to: `_t${x0}_${(i + 1) % 3}` }))
    return { pts, segs }
  }
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const sideSet = (verts) => [0, 1, 2].map(i => dist(verts[i], verts[(i + 1) % 3])).sort((a, b) => a - b)
  const similar = (s, t) => { const k = t[0] / s[0]; return t.every((v, i) => near(v, s[i] * k, 1e-9)) }

  const T = [[1, 1], [0, 0], [4, 0]]
  const OPTS = {
    A: [[3, 2], [4, 4], [4, 0]],
    B: [[2, 4], [0, 0], [2, 1]],
    C: [[0, 4], [2, 0], [4, 0]],
    D: [[0, 3], [4, 4], [3, 1]],
  }
  const tS = sideSet(T)
  if (!similar(tS, sideSet(OPTS.C).map(v => v / 2))) { console.error('⛔ 多面板: 选项 C 与题图不相似，转录有误'); process.exit(1) }
  for (const k of ['A', 'B', 'D']) {
    if (similar(tS, sideSet(OPTS[k]))) { console.error(`⛔ 多面板: 选项 ${k} 意外相似，转录存疑`); process.exit(1) }
  }

  const pts = [], segs = [], labels = []
  // 题图
  const g0 = panelGrid(0)
  pts.push(...g0.pts); segs.push(...g0.segs)
  const t0 = tri(0, T)
  pts.push(...t0.pts); segs.push(...t0.segs)
  labels.push(V(1, 1.28, 'A'), V(-0.3, -0.18, 'B'), V(4.32, -0.18, 'C'))
  // 选项
  const offsets = { A: 6, B: 12, C: 18, D: 24 }
  for (const k of ['A', 'B', 'C', 'D']) {
    const x0 = offsets[k]
    const g = panelGrid(x0)
    pts.push(...g.pts); segs.push(...g.segs)
    const t = tri(x0, OPTS[k])
    pts.push(...t.pts); segs.push(...t.segs)
    labels.push(V(x0 + 2, -0.62, k + '.'))
  }
  var s9 = { figure_type: 'geometry', points: pts, segments: segs, labels }
}
const JOBS = [
  { qid: '9b409c35-1248-4d25-9fbe-56d8e799b50c', tag: '9b409c35', structure: s1 },
  { qid: '2d0554b8-9c5a-484f-b2c4-042eb2ed275d', tag: '2d0554b8', structure: s2 },
  { qid: 'fe7f2bc4-3ef7-4c3c-9725-41695c924312', tag: 'fe7f2bc4', structure: s3 },
  { qid: '4bb93a21-d12b-4a07-aeea-8f4a05064d6c', tag: '4bb93a21', structure: s4 },
  { qid: 'd6bdb7e3-39f3-482b-b366-b0455fb6797b', tag: 'd6bdb7e3', structure: s5 },
  { qid: '40bb33a0-3825-48d8-aac5-97526dd7d034', tag: '40bb33a0', structure: s6 },
  { qid: '033d6738-8835-4899-bb3e-d95d6617727b', tag: '033d6738', structure: s7 },
  { qid: 'dc357206-c5cf-4abd-9b69-c2517490542b', tag: 'dc357206', structure: s8 },
  { qid: '7e185d42-4453-46b9-9f2f-15f1fcf75308', tag: '7e185d42', structure: s9 },
  { qid: '1db136a7-1cc7-4204-afbb-1217f264ac9a', tag: '1db136a7', structure: s9 },
  { qid: '325fd250-82ee-4ec9-9d36-4e6166be9fc6', tag: '325fd250', structure: s9 },
  { qid: 'cceab838-3be4-4441-9858-b88ae68b72c8', tag: 'cceab838', structure: s9 },
]

for (const job of JOBS.filter(j => !ONLY || j.tag === ONLY)) {
  const svg = renderGeometrySvg(job.structure)
  if (!svg) { console.error(`⛔ ${job.tag}: 渲染失败`); process.exit(1) }
  fs.writeFileSync(`scripts/logs/construct-${job.tag}.svg`, svg)
  await sharp(Buffer.from(svg), { density: 144 }).resize({ width: 700 }).flatten({ background: '#ffffff' })
    .png().toFile(`scripts/logs/construct-${job.tag}.png`)
  console.log(`✔ ${job.tag} 预览: scripts/logs/construct-${job.tag}.png`)
}
if (!APPLY) { console.log('（dry-run，未写库）'); process.exit(0) }

const { query } = await import('../config/neon.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')
for (const job of JOBS.filter(j => !ONLY || j.tag === ONLY)) {
  const svg = fs.readFileSync(`scripts/logs/construct-${job.tag}.svg`, 'utf8')
  await query(`UPDATE questions SET clean_geometry_svg = $2, updated_at = NOW() WHERE id = $1`, [job.qid, svg])
  await query(`UPDATE question_assets SET clean_geometry_svg = $2, tikz_code = $2, tikz_status = 'completed',
      last_error = NULL, processed_at = NOW(), updated_at = NOW()
    WHERE question_id = $1 AND asset_type = 'geometry_image'`, [job.qid, svg])
  const pub = await publishCleanGeometryUrl({ questionId: job.qid, svg })
  console.log(`${job.tag} 落库完成，URL:`, pub.ok ? pub.url : `失败 ${pub.reason}`)
}
process.exit(0)
