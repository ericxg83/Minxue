/**
 * 白板激光笔「无拖尾」回归锁（2026-10-04 第 93 轮）
 *
 * 背景：负责人 2026-10-04 明确要求 ——
 *   「白板内的激光笔的样式要改一下，改成"无拖尾激光笔，抬起笔消失的那种样子"。」
 *   旧实现是「红点 + 220ms 按点龄衰减的拖尾线段」，抬手后拖尾还会拖一小段才收干净。
 *
 * 本轮把它改成：只维护「当前那一个点」，抬手直接清空光点层（没有淡出、没有残影）。
 *
 * ⛔ 本文件最要紧的两条：
 *   ① **无拖尾** —— drawLaser 不得再画折线、不得遍历历史点，旧的 laserTrail /
 *      LASER_TRAIL_MS / LASER_MAX_POINTS 一个都不能回来；
 *   ② **抬手立刻消失** —— endLaser 必须同步丢点 + 立即重绘清空（任何「让最后一点
 *      自然过期」的写法都会重新变成残影）。
 *
 * ⛔ 第三条是自引入起就没变过的纪律：**激光笔绝不进笔迹数据结构**。
 *   导出板书 PNG 只读 localStrokes，「导出图不含光点」因此是天然成立的 ——
 *   不需要在导出侧加过滤，但前提是激光笔代码一行都不碰 localStrokes。
 *
 * 反向自检：_r93_lock_selfcheck.mjs 会把本文件的判据套到 HEAD 旧版上，必须判红。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const SRC = read('src/workbench/components/DrawingCanvas.vue')

/** 去注释（空格替换，保留换行与列偏移）：每处删除都留了历史说明注释，注释文本含被删标识符 */
export function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

/** 提取顶层 `function name(...) {...}` 的函数体（花括号配对，容忍嵌套） */
export function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  const open = src.indexOf('{', i)
  if (open < 0) return ''
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open + 1, j) }
  }
  return ''
}

const CODE = stripComments(SRC)

test('激光笔：旧的「按点龄衰减拖尾」实现已彻底删除', () => {
  assert.ok(!/\blaserTrail\b/.test(CODE), '不应再有 laserTrail 数组（旧拖尾的点缓冲）')
  assert.ok(!/\bLASER_TRAIL_MS\b/.test(CODE), '不应再有 LASER_TRAIL_MS（旧拖尾存活时长）')
  assert.ok(!/\bLASER_MAX_POINTS\b/.test(CODE), '不应再有 LASER_MAX_POINTS（旧拖尾点数上限）')

  const body = fnBody(CODE, 'drawLaser')
  assert.ok(body.length > 0, 'drawLaser 应存在')
  assert.ok(!/lineTo|moveTo/.test(body), 'drawLaser 不应画折线 —— 折线就是拖尾')
  assert.ok(!/\bfor\s*\(/.test(body), 'drawLaser 不应遍历历史点')
})

test('激光笔：抬手立刻消失（endLaser 同步清空光点层）', () => {
  const body = fnBody(CODE, 'endLaser')
  assert.ok(body.length > 0, 'endLaser 应存在')
  assert.match(body, /laserPoint\s*=\s*null/, 'endLaser 必须丢掉当前点')
  assert.match(body, /drawLaser\s*\(\s*\)/, 'endLaser 必须立即重绘 —— 这一步才是「抬手即消」')
  assert.match(body, /cancelAnimationFrame/, 'endLaser 必须取消待执行的 rAF，否则下一帧又画回来')
})

test('激光笔：只维护「当前那一个点」', () => {
  assert.match(CODE, /let\s+laserPoint\s*=\s*null/, 'laserPoint 单点状态应存在')
  const push = fnBody(CODE, 'pushLaserPoint')
  assert.ok(push.length > 0, 'pushLaserPoint 应存在')
  assert.match(push, /laserPoint\s*=\s*\{/, 'pushLaserPoint 应覆盖式写入单点')
  assert.ok(!/\.push\s*\(/.test(push), 'pushLaserPoint 不应往数组里累积点')
})

test('激光笔：绝不进笔迹数据结构（导出板书 PNG 天然不含光点）', () => {
  for (const fn of ['startLaser', 'pushLaserPoint', 'drawLaser', 'endLaser']) {
    const body = fnBody(CODE, fn)
    assert.ok(body.length > 0, `${fn} 应存在`)
    assert.ok(!/localStrokes/.test(body), `${fn} 不应触碰 localStrokes`)
    assert.ok(!/startStroke|appendLivePoint|finishStroke/.test(body), `${fn} 不应走书写链路`)
  }
  const exp = fnBody(CODE, 'exportPng')
  assert.ok(exp.length > 0, 'exportPng 应存在')
  assert.match(exp, /localStrokes\.value/, '导出板书图只读 localStrokes')
  assert.ok(!/laserPoint|laserCtx|laserRef/.test(exp), '导出不应读光点层')
})

test('激光笔：光点层是独立 canvas，不吃事件、盖在手写层之上', () => {
  assert.match(SRC, /<canvas ref="laserRef" class="dc-laser"/, '应有独立的光点层 canvas')
  assert.match(SRC, /\.dc-laser\s*\{[^}]*pointer-events:\s*none/, '.dc-laser 必须 pointer-events:none')
  assert.match(SRC, /\.dc-laser\s*\{[^}]*z-index:\s*4/, '.dc-laser 应在手写层（z-index:3）之上')
})

test('激光笔：工具按钮文案写明「无拖尾、抬手即消」', () => {
  const wb = read('src/workbench/views/WeekendBoard.vue')
  assert.match(wb, /激光笔（L）[^"]*无拖尾[^"]*抬手即消/, '按钮 title 应说明无拖尾 / 抬手即消')
})
