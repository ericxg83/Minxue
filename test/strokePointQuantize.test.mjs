/**
 * 板书笔迹点量化的回归锁（2026-10-03 第 87 轮）
 *
 * 缺陷背景：笔迹点存的是 PointerEvent 的全精度浮点（单点 ~49 字符），
 * 一题写 50 笔 ≈ 145 KB，而板书按题目永久存在 localStorage 且全仓没有清理逻辑
 * ⇒ 5MB 配额迟早写满，写满后 saveStrokes 的 catch 把失败静默吞掉，老师的板书无声消失。
 *
 * 本锁钉三件事：
 *   1. 量化确实把体积降下来（不是只改了注释）；
 *   2. 量化幅度在感知阈值内（0.01 板面 px，最坏 0.04 屏幕 px）；
 *   3. 接线没被改回去 —— DrawingCanvas#pointFromEvent 必须调 quantizeStrokePoint
 *      （⛔ 只在落盘时量化是错的：内存与落盘不是同一份，撤销重做/导出会画出不同的线）。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { quantizeStrokePoint, quantizeStrokes, STROKE_COORD_DECIMALS } from '../src/workbench/utils/strokePoint.js'

const CANVAS_SRC = readFileSync(
  new URL('../src/workbench/components/DrawingCanvas.vue', import.meta.url), 'utf8')
const BOARD_SRC = readFileSync(
  new URL('../src/workbench/views/WeekendBoard.vue', import.meta.url), 'utf8')

test('量化到 2 位小数：坐标与压感都降精度，不产生新字段', () => {
  assert.equal(STROKE_COORD_DECIMALS, 2)
  const raw = { x: 123.456789, y: 456.789012, p: 0.484375 }
  const q = quantizeStrokePoint(raw)
  assert.equal(q.x, 123.46)
  assert.equal(q.y, 456.79)
  assert.equal(q.p, 0.48)
  assert.deepEqual(Object.keys(q).sort(), ['p', 'x', 'y'], '不得引入新字段（老数据要能原样读回）')
})

test('量化不改结构：整数坐标、负坐标（平移后）都原样保留语义', () => {
  assert.deepEqual(quantizeStrokePoint({ x: 120, y: 120, p: 0.5 }), { x: 120, y: 120, p: 0.5 })
  const neg = quantizeStrokePoint({ x: -12.3456, y: -0.004, p: 1 })
  assert.equal(neg.x, -12.35)
  assert.equal(neg.y, -0)
})

test('压感缺失时不得被量化成 NaN（不是所有指针都报压感）', () => {
  const q = quantizeStrokePoint({ x: 1.234, y: 5.678 })
  assert.equal(q.p, undefined)
  assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y))
})

test('量化幅度在感知阈值内：最坏 0.04 屏幕 px（dpr 2 × zoom 4）', () => {
  const maxBoardErr = 0.5 / 10 ** STROKE_COORD_DECIMALS // 四舍五入最大误差
  const worstScreenPx = maxBoardErr * 2 * 4 // dpr 上限 2、纸面缩放上限 4
  assert.ok(worstScreenPx <= 0.05, `最坏屏幕误差 ${worstScreenPx}px 过大`)
})

test('体积确实降下来：单点 JSON 至少省 40%', () => {
  // 合成样本取真实量级：坐标是 double 全精度（页面位置几乎总带小数），
  // 实测（_r87_stroke_size.mjs，鼠标真书写 1220 点）量化前平均 48.7 字符/点。
  const samples = Array.from({ length: 200 }, (_, i) => ({
    x: 118.3728495612 + i * 3.141592653589793,
    y: 240.9182736455 + i * 1.4142135623730951,
    p: 0.4296875 + (i % 7) * 0.01,
  }))
  const rawBytes = JSON.stringify(samples).length
  const qBytes = JSON.stringify(samples.map(quantizeStrokePoint)).length
  const saved = 1 - qBytes / rawBytes
  assert.ok(saved >= 0.4, `只省了 ${(saved * 100).toFixed(1)}%，预期 ≥40%`)

  // 真正的判据是「单点占多少字符」：量化后三位整数坐标 = `{"x":746.57,"y":522.74,"p":0.43}` = 32 字符
  const charsPerPoint = qBytes / samples.length + 1 // +1 = 数组分隔逗号
  assert.ok(charsPerPoint <= 34, `量化后单点仍占 ${charsPerPoint.toFixed(1)} 字符`)
  // 折算「一题 50 笔 × 每笔 61 点」（两个数都取自浏览器实测）
  const afterKB = charsPerPoint * 61 * 50 / 1024
  const beforeKB = (rawBytes / samples.length + 1) * 61 * 50 / 1024
  assert.ok(afterKB < beforeKB * 0.62,
    `一题 ${beforeKB.toFixed(0)}KB → ${afterKB.toFixed(0)}KB，降幅不足`)
})

test('quantizeStrokes 整组量化且不改原数组', () => {
  const strokes = [{ tool: 'pen', color: '#E11D48', size: 3, points: [{ x: 1.23456, y: 2.34567, p: 0.5 }] }]
  const out = quantizeStrokes(strokes)
  assert.equal(out[0].tool, 'pen', '工具/颜色/粗细必须原样保留')
  assert.deepEqual(out[0].points[0], { x: 1.23, y: 2.35, p: 0.5 })
  assert.equal(strokes[0].points[0].x, 1.23456, '不得原地修改入参')
  assert.deepEqual(quantizeStrokes(null), [])
})

// ── 接线锁（源码级）：量化必须在「点进入笔迹的那一刻」发生 ──
test('接线锁：DrawingCanvas#pointFromEvent 必须量化（不能只在落盘时量化）', () => {
  const i = CANVAS_SRC.indexOf('function pointFromEvent')
  assert.ok(i >= 0, '找不到 pointFromEvent')
  const body = CANVAS_SRC.slice(i, i + 900)
  assert.ok(body.includes('quantizeStrokePoint('),
    'pointFromEvent 必须调用 quantizeStrokePoint —— 只在 saveStrokes 里量化会让内存与落盘不是同一份，撤销重做/导出画出不同的线')
  assert.ok(/import\s*\{[^}]*quantizeStrokePoint[^}]*\}\s*from\s*['"][^'"]*strokePoint/.test(CANVAS_SRC),
    'DrawingCanvas 必须从 utils/strokePoint 具名导入 quantizeStrokePoint')
})

test('接线锁：存量老数据读回时也要量化，且旧键迁移成功后才删旧键', () => {
  assert.ok(BOARD_SRC.includes('quantizeStrokes(JSON.parse(raw))'),
    'loadStrokes 必须量化存量笔迹（老数据是全精度浮点）')
  const i = BOARD_SRC.indexOf('function loadStrokes')
  const body = BOARD_SRC.slice(i, i + 1600)
  const setIdx = body.indexOf('localStorage.setItem(key, migrated)')
  const rmIdx = body.indexOf('localStorage.removeItem(legacy)')
  assert.ok(setIdx >= 0 && rmIdx > setIdx,
    '必须先 setItem 新键成功、再删旧键；顺序反了会在配额满时把板书删掉')
  assert.ok(body.includes('quantizeStrokes(JSON.parse(legacyRaw))'),
    '迁移时应先量化再落新键 —— 否则磁盘上会留一份全精度胖副本')
})

test('接线锁：落盘失败必须让老师看得见（不得再静默 catch）', () => {
  const i = BOARD_SRC.indexOf('function saveStrokes')
  const body = BOARD_SRC.slice(i, i + 1400)
  assert.ok(!/catch\s*\{\s*\/\*\s*存储满或隐私模式忽略\s*\*\/\s*\}/.test(body),
    '旧的静默 catch 必须已删除 —— 配额写满时板书会无声消失')
  assert.ok(body.includes('showHint('), '写不进去必须给页内提示（原生全屏下 ElMessage 看不见）')
})
