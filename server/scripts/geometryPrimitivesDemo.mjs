/**
 * 阶段 1 图元能力可视对照页（离线，零视觉调用、零库写入）。
 *
 * 用几道教材常见版式演示渲染器新增的三类能力：阴影多边形填充、圆弧、角标记。
 * 每张图同时给出 SVG 渲染结果、TikZ 渲染结果与输入结构 JSON，便于人工目检与回归对照。
 *
 * 用法：node server/scripts/geometryPrimitivesDemo.mjs [--out <dir>]
 */

import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { renderGeometryTikZ } from '../utils/geometryTikZ.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const args = process.argv.slice(2)
const i = args.indexOf('--out')
const OUT_DIR = resolve(ROOT, i >= 0 && args[i + 1] ? args[i + 1] : 'server/scripts/logs/geometry-primitives')

const CASES = [
  {
    title: '阴影部分面积（长方形 + 对角线，阴影三角形）',
    note: '新增能力：polygons 浅灰填充。每条边都必须在 segments 里（AB/BC/CA），否则不上色——样例 2 演示不闭合的情形。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'A', x: 0, y: 0 }, { label: 'B', x: 60, y: 0 },
        { label: 'C', x: 60, y: 40 }, { label: 'D', x: 0, y: 40 }
      ],
      segments: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
        { from: 'C', to: 'D' }, { from: 'D', to: 'A' },
        { from: 'A', to: 'C' }
      ],
      polygons: [{ points: ['A', 'B', 'C'], fill: true }]
    }
  },
  {
    title: '边不闭合的多边形 → 不上色（严格判据演示）',
    note: '同样声明了 fill:true，但 CA 这条边没写进 segments，说明"这个区域"没经过内容闸门核对 → 拒绝上色。宁可少画一层灰底，也不给未经验证的区域上色。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'A', x: 0, y: 0 }, { label: 'B', x: 60, y: 0 },
        { label: 'C', x: 60, y: 40 }, { label: 'D', x: 0, y: 40 }
      ],
      segments: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
        { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
      ],
      polygons: [{ points: ['A', 'B', 'C'], fill: true }]
    }
  },
  {
    title: '扇形（圆弧 + 两条半径）',
    note: '新增能力：arcs 圆弧。数学坐标下从 from 逆时针扫到 to，渲染器负责翻转 y 并判定优弧。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'O', x: 0, y: 0 },
        { label: 'A', x: 40, y: 0 },
        { label: 'B', x: 0, y: 40 }
      ],
      segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
      arcs: [{ center: 'O', from: 'A', to: 'B' }]
    }
  },
  {
    title: '优弧（扫角 > 180°）',
    note: '新增能力：large-arc-flag 判定。从 A（0°）逆时针到 B（270°）= 270°，必须走优弧。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'O', x: 0, y: 0 },
        { label: 'A', x: 40, y: 0 },
        { label: 'B', x: 0, y: -40 }
      ],
      segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
      arcs: [{ center: 'O', from: 'A', to: 'B' }]
    }
  },
  {
    title: '角标记（∠A 小弧线）',
    note: '新增能力：angleMarks 顶点小圆弧，半径固定 14px，与图形尺度无关。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'A', x: 0, y: 0 }, { label: 'B', x: 50, y: 0 }, { label: 'C', x: 20, y: 35 }
      ],
      segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
      angleMarks: [
        { vertex: 'A', from: 'B', to: 'C' },
        { vertex: 'B', from: 'C', to: 'A' }
      ]
    }
  },
  {
    title: '坐标系里的四边形（含填充）',
    note: '新增能力与既有坐标轴能力叠加：坐标轴 + 多边形填充 + 角标记。',
    structure: {
      figure_type: 'geometry_with_coords',
      points: [
        { label: 'O', x: 0, y: 0, type: 'origin' },
        { label: 'A', x: 30, y: 0 }, { label: 'B', x: 40, y: 30 },
        { label: 'C', x: 10, y: 40 }, { label: 'D', x: -15, y: 20 }
      ],
      segments: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
        { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
      ],
      polygons: [{ points: ['A', 'B', 'C', 'D'], fill: true }],
      angleMarks: [{ vertex: 'A', from: 'D', to: 'B' }],
      coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true }
    }
  },
  {
    title: '直角标记（既有能力，回归对照）',
    note: '既有能力对照：rightAngles 直角小方块。确认新增图元没有破坏原有渲染。',
    structure: {
      figure_type: 'geometry',
      points: [
        { label: 'A', x: 0, y: 0 }, { label: 'B', x: 50, y: 0 }, { label: 'C', x: 0, y: 35 }
      ],
      segments: [
        { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }
      ],
      rightAngles: [{ vertex: 'A', from: 'B', to: 'C' }]
    }
  }
]

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cards = CASES.map((c, idx) => {
  const svg = renderGeometrySvg(c.structure)
  const tikz = renderGeometryTikZ(c.structure)
  return `
  <section class="card">
    <h2>${idx + 1}. ${esc(c.title)}</h2>
    <p class="note">${esc(c.note)}</p>
    <div class="row">
      <div class="pane">
        <div class="label">SVG 渲染（生产用）</div>
        <div class="svgbox">${svg || '<em>渲染失败</em>'}</div>
      </div>
      <div class="pane">
        <div class="label">输入结构 JSON</div>
        <pre>${esc(JSON.stringify(c.structure, null, 2))}</pre>
      </div>
    </div>
    <details>
      <summary>TikZ 代码</summary>
      <pre>${esc(tikz || '（无）')}</pre>
    </details>
  </section>`
}).join('\n')

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>几何图元能力对照 · 阶段 1</title>
<style>
  body { margin:0; padding:24px; background:#f5f5f3; color:#2c2c2a;
         font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; font-size:14px; line-height:1.6; }
  h1 { font-size:18px; font-weight:500; margin:0 0 4px; }
  .sub { color:#5f5e5a; margin:0 0 24px; font-size:13px; }
  .card { background:#fff; border:1px solid rgba(0,0,0,.1); border-radius:12px; padding:20px; margin-bottom:16px; }
  h2 { font-size:15px; font-weight:500; margin:0 0 6px; }
  .note { color:#5f5e5a; font-size:13px; margin:0 0 14px; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .pane { min-width:0; }
  .label { font-size:12px; color:#5f5e5a; margin-bottom:6px; }
  .svgbox { background:#fff; border:1px solid rgba(0,0,0,.08); border-radius:8px; padding:8px; }
  .svgbox svg { display:block; width:100%; height:auto; }
  pre { background:#f1efe8; border-radius:8px; padding:12px; overflow:auto;
        font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; margin:0; max-height:340px; }
  details { margin-top:14px; }
  summary { cursor:pointer; font-size:12px; color:#5f5e5a; }
  @media (max-width:820px) { .row { grid-template-columns:1fr; } }
</style>
</head>
<body>
  <h1>几何图元能力对照 · 阶段 1</h1>
  <p class="sub">新增三类能力：阴影多边形填充（polygons）、圆弧（arcs）、角标记（angleMarks）。
     最后一张为既有能力回归对照。全部离线渲染，零视觉调用。</p>
  ${cards}
</body>
</html>`

await fs.mkdir(OUT_DIR, { recursive: true })
const outFile = resolve(OUT_DIR, 'index.html')
await fs.writeFile(outFile, html, 'utf8')

const withPoly = CASES.filter(c => renderGeometrySvg(c.structure)?.includes('#d9d9d9')).length
const withPath = CASES.filter(c => renderGeometrySvg(c.structure)?.includes('<path')).length
console.log(`✅ 对照页已生成：${outFile}`)
console.log(`   共 ${CASES.length} 个样例，其中 ${withPoly} 个含填充多边形、${withPath} 个含弧线`)
