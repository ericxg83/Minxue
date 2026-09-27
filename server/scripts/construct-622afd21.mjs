// 622afd21 确定性构造（2026-09-27）：题干完全定死的图，视觉模型 7 轮 parse_fail，
// 直接用解析几何解出全部坐标，走项目渲染器出图。数学校验：NK = 120/17 与标准答案一致。
//
// 坐标系（数学坐标，y 向上）：A(0,13) 左上、B(0,0) 左下、C(13,0) 右下、D(13,13) 右上。
//   AB=13；BF=5 → AF=√(13²-5²)=12；B 到直线 AE 距离 13e/√(e²+169)=5 → e=65/12。
//   F = AE 上距 A 12 的点 = (60/13, 25/13)；K = D 到 AE 的垂足 = (25/13, 109/13)；
//   H = C 到 DK 的垂足 = (109/13, 144/13)；G = BF 延长线 ∩ CH = (1872/169, 780/169)；
//   M = 圆(F, FA=12) ∩ AD = (120/13, 13)；N = FM ∩ DK = (1865/221, 2453/221)。
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import fs from 'fs'
import sharp from 'sharp'
import { renderGeometrySvg } from '../utils/geometrySvg.js'

const APPLY = process.argv.includes('--apply')
const r2 = (n) => Math.round(n * 10000) / 10000

// ── 精确坐标（分数） ──
const P = {
  A: [0, 13],
  B: [0, 0],
  C: [13, 0],
  D: [13, 13],
  E: [65 / 12, 0],
  F: [60 / 13, 25 / 13],
  G: [1872 / 169, 780 / 169],
  H: [109 / 13, 144 / 13],
  K: [25 / 13, 109 / 13],
  M: [120 / 13, 13],
  N: [1865 / 221, 2453 / 221],
}
// 数学自检：BF=5、AF=12、NK=120/17
const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
const checks = {
  AB: d(P.A, P.B), BF: d(P.B, P.F), AF: d(P.A, P.F),
  NK: d(P.N, P.K), FM: d(P.F, P.M), FA: d(P.F, P.A),
}
console.log('自检:', Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, r2(v)])))
if (Math.abs(checks.BF - 5) > 1e-9 || Math.abs(checks.AF - 12) > 1e-9 || Math.abs(checks.NK - 120 / 17) > 1e-9) {
  console.error('⛔ 数学自检未过，拒绝出图'); process.exit(1)
}

const pt = ([x, y]) => ({ x: r2(x), y: r2(y) })
const structure = {
  points: Object.entries(P).map(([label, xy]) => ({ label, ...pt(xy) })),
  segments: [
    { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
    { from: 'A', to: 'E' },   // AE（F、K 在其上）
    { from: 'B', to: 'G' },   // BF 及其延长线（F 在其上，G 为延长线交点）
    { from: 'D', to: 'K' },   // DK（N、H 在其上）
    { from: 'C', to: 'H' },   // CH（G 在其上）
    { from: 'F', to: 'M' },   // FM（N 在其上）
  ],
  arcs: [{ center: 'F', from: 'M', to: 'A' }], // 以 F 为圆心 FA 为半径的弧，M→A 逆时针扫上方短弧
  rightAngles: [
    { vertex: 'F', from: 'B', to: 'A' },  // BF⊥AE
    { vertex: 'K', from: 'D', to: 'E' },  // DK⊥AE
    { vertex: 'H', from: 'C', to: 'D' },  // CH⊥DK
  ],
  // 弧顶（y≈13.92）高于方框，渲染器 bbox 不含弧，用空文本 label 撑包围盒防裁切
  labels: [{ x: r2(P.F[0]), y: 13.95, text: '' }],
}

const svg = renderGeometrySvg(structure)
if (!svg) { console.error('⛔ 渲染失败'); process.exit(1) }
fs.writeFileSync('scripts/logs/construct-622afd21.svg', svg)
await sharp(Buffer.from(svg), { density: 144 }).resize({ width: 700 }).flatten({ background: '#ffffff' })
  .png().toFile('scripts/logs/construct-622afd21.png')
console.log('预览: scripts/logs/construct-622afd21.png（未写库）')
if (!APPLY) process.exit(0)

// ── 落库（镜像 worker 成功路径） ──
const { query } = await import('../config/neon.js')
const { publishCleanGeometryUrl } = await import('../utils/geom/cleanGeometryUrl.js')
const QID = '622afd21-6c3d-4283-83b8-199749ada64c'
await query(`UPDATE questions SET clean_geometry_svg = $2, updated_at = NOW() WHERE id = $1`, [QID, svg])
await query(`UPDATE question_assets SET clean_geometry_svg = $2, tikz_code = $2, tikz_status = 'completed',
    last_error = NULL, processed_at = NOW(), updated_at = NOW()
  WHERE question_id = $1 AND asset_type = 'geometry_image'`, [QID, svg])
console.log('DB: clean_geometry_svg + tikz_code 已写入，tikz_status=completed')
const pub = await publishCleanGeometryUrl({ questionId: QID, svg })
console.log('发布 URL:', pub.ok ? pub.url : `失败 ${pub.reason}`)
process.exit(0)
