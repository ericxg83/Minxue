/**
 * 回归锁：tikzGenerator 圆弧 large-arc 标志的角度归一化（P9，2026-10-12）
 *
 * 背景：`src/utils/tikzGenerator.js` 第 5 节 arc 解析里，large-arc 曾用
 * `(endAngle - startAngle) > 180` 判定。当 end < start 且实际弧线**跨过 0° 界线**
 * （TikZ 里 end 自动 +360，如 start=330°, end=190° 实际走 220°）时，差值为负，
 * 永远判成小弧 —— 画出的弧线走错方向/弧度。
 * 修复：弧长归一化到 [0,360) 再判大弧。
 *
 * 判据（源码级 + 行为级双锁）：
 *   - 行为级：tikzToSvg 输出里，330°→190°（220° 大弧）的 path 必须 large-arc=1；
 *     330°→30°（60° 小弧）必须 large-arc=0；
 *   - 源码级：largeArc 判定必须基于归一化 delta（不得再是裸差值比较）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'tikzGenerator.js'), 'utf-8')

// 直接 import 源码模块（tikzToSvg 是纯函数，无 DOM 依赖）
const { tikzToSvg } = await import(pathToFileURL(path.join(ROOT, 'src', 'utils', 'tikzGenerator.js')).href)

/** 从 SVG 里抽出所有 arc path 的 large-arc 标志（A r r 0 <flag> 0 ...） */
function arcFlags(svg) {
  const flags = []
  const re = /A [\d.]+ [\d.]+ 0 ([01]) 0 [\d.]+ [\d.]+/g
  let m
  while ((m = re.exec(svg)) !== null) flags.push(m[1])
  return flags
}

test('arc 跨 0° 大弧（330°→190°，实际 220°）必须 large-arc=1', () => {
  const svg = tikzToSvg(
    '\\begin{tikzpicture}\n\\draw (0,0) arc[start angle=330, end angle=190, radius=1];\n\\end{tikzpicture}',
    false
  )
  assert.ok(svg && svg.includes('<path'), '应生成 path')
  const flags = arcFlags(svg)
  assert.equal(flags.length, 1, `应有一条弧，实际 ${flags.length}`)
  assert.equal(flags[0], '1', '330°→190°（220°）应是大弧（large-arc=1）')
})

test('arc 跨 0° 小弧（330°→30°，实际 60°）必须 large-arc=0', () => {
  const svg = tikzToSvg(
    '\\begin{tikzpicture}\n\\draw (0,0) arc[start angle=330, end angle=30, radius=1];\n\\end{tikzpicture}',
    false
  )
  assert.ok(svg && svg.includes('<path'), '应生成 path')
  const flags = arcFlags(svg)
  assert.equal(flags.length, 1, `应有一条弧，实际 ${flags.length}`)
  assert.equal(flags[0], '0', '330°→30°（60°）应是小弧（large-arc=0）')
})

test('arc 不跨 0° 大弧（30°→240°，210°）必须 large-arc=1', () => {
  const svg = tikzToSvg(
    '\\begin{tikzpicture}\n\\draw (0,0) arc[start angle=30, end angle=240, radius=1];\n\\end{tikzpicture}',
    false
  )
  const flags = arcFlags(svg)
  assert.equal(flags[0], '1', '30°→240°（210°）应是大弧')
})

test('源码级：largeArc 必须基于归一化 delta，不得裸差值比较', () => {
  // 找 arc 分支的 largeArc 赋值行
  const m = SRC.match(/const delta = \(\(\(endAngle - startAngle\) % 360\) \+ 360\) % 360[\s\S]*?const largeArc = delta > 180 \? 1 : 0/)
  assert.ok(m, 'largeArc 必须由归一化 delta 判定')
  assert.ok(!/(?:endAngle - startAngle) > 180/.test(SRC.split('const delta')[0]), 'arc 分支不得残留裸差值比较')
})

// ── 双端闭环（2026-10-12 R26）：后端 geometryTikZ.js arcAngles 保证 end > start（可能 >360°），
//    前端解析器 % 360 归一化必须兼容这类产物，两端自洽不得分叉 ──
test('双端闭环：后端产物 end=550（330→550，跨0°补360大弧）必须 large-arc=1', () => {
  const svg = tikzToSvg(
    '\\begin{tikzpicture}\n\\draw (0,0) arc[start angle=330, end angle=550, radius=1];\n\\end{tikzpicture}',
    false
  )
  assert.ok(svg, '应生成 path')
  assert.equal(arcFlags(svg)[0], '1', '330→550（归一 delta=220°）应是大弧')
})

test('双端闭环：后端产物 end>360 整圈（0→660，实际 300°）必须 large-arc=1', () => {
  const svg = tikzToSvg(
    '\\begin{tikzpicture}\n\\draw (0,0) arc[start angle=0, end angle=660, radius=1];\n\\end{tikzpicture}',
    false
  )
  assert.ok(svg, '应返回 path')
  assert.equal(arcFlags(svg)[0], '1', '0→660（归一后 300°）应是大弧')
})
