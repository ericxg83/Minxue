/**
 * 白板激光笔「笔迹式激光 + 抬手 1 秒渐隐」回归锁（2026-10-04 深夜，第 97 轮）
 *
 * 背景：负责人 2026-10-04 深夜新裁决（推翻同日上午的「无拖尾、抬手即消」）——
 *   「白板中的激光笔，我要的是那种激光的样子，像笔一样可以写，但是一秒后抬起就消失的那种，
 *    如果一秒内抬起不受影响，依然可以写出字（比如可以画框也有抬起但不消失）」
 *
 * 行为规格：
 *   ① 激光像笔一样「写」—— 指针移动留下连续笔迹（折线），不是单点；
 *   ② 每一笔抬手后开始 1 秒渐隐（LASER_FADE_MS = 1000），到时整笔移除；
 *   ③ 一秒内的连续多笔互不影响 —— 各笔独立倒计时，写字/画框过程中前面笔迹不提前消失；
 *   ④ 正在书写的笔不参与倒计时（fadeStart == null 期间 alpha 恒为 1）。
 *
 * ⛔ 不变的纪律：激光笔绝不进 startStroke/appendLivePoint/finishStroke，绝不写
 *   localStrokes —— 导出板书 PNG 只读 localStrokes，「导出图不含激光笔迹」天然成立。
 *
 * 反向自检：本文件导出 collectFailures(SRC, WB_SRC)；_r97_lock_selfcheck.mjs 把它套在
 * r93 版（无拖尾实现）上必须判红 —— 证明锁非空。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 去注释（空格替换，保留换行与列偏移）：注释文本里会提到被锁/被删的标识符 */
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

/** 提取 onBeforeUnmount(() => { ... }) 的回调体（到 cancelWheelPan() 为止的既有结构） */
function unmountBody(src) {
  const i = src.indexOf('onBeforeUnmount(() => {')
  if (i < 0) return ''
  const end = src.indexOf('cancelWheelPan()', i)
  return end < 0 ? '' : src.slice(i, end)
}

/**
 * 全部判据。返回 [{ name, msg }]；空数组 = 全过。
 * 单独导出供 _r97_lock_selfcheck.mjs 在 r93 旧版上复用（旧版必须判红）。
 */
export function collectFailures(SRC, WB_SRC) {
  const fails = []
  const bad = (name, cond, msg) => { if (!cond) fails.push({ name, msg }) }
  const CODE = stripComments(SRC)
  const WB = stripComments(WB_SRC)

  // ① 笔迹式激光：折线绘制 + 每笔点列
  const draw = fnBody(CODE, 'drawLaser')
  const poly = fnBody(CODE, 'drawLaserPolyline')
  bad('laser-ink', draw.length > 0, 'drawLaser 应存在')
  bad('laser-ink', (/lineTo/.test(draw) || (/drawLaserPolyline/.test(draw) && /lineTo/.test(poly))),
    'drawLaser（或其抽出的绘制函数）必须画折线笔迹（激光像笔一样写，不是单点）')
  bad('laser-ink', /LASER_FADE_MS/.test(draw) && /(filter|splice)/.test(draw),
    'drawLaser 必须按 fadeStart 算 alpha 并移除过期笔迹')
  const push = fnBody(CODE, 'pushLaserPoint')
  bad('laser-ink', /pts\.push\(/.test(push), 'pushLaserPoint 必须往当前笔的点列追加（像笔一样累积笔迹）')
  bad('laser-ink', /let\s+laserStrokes\s*=\s*\[\]/.test(CODE), 'laserStrokes 笔迹数组应存在')
  bad('laser-ink', /const\s+LASER_FADE_MS\s*=\s*1000/.test(CODE), 'LASER_FADE_MS 必须 = 1000（负责人指定一秒）')

  // ② 抬手进渐隐：endLaser 记 fadeStart，且**不能**停 rAF / 清空数组（那是旧行为）
  const end = fnBody(CODE, 'endLaser')
  bad('laser-fade', /fadeStart\s*=\s*performance\.now\(\)/.test(end), 'endLaser 必须把 fadeStart 记为抬手时刻')
  bad('laser-fade', !/cancelAnimationFrame/.test(end), 'endLaser 不得停 rAF —— 渐隐动画靠它继续驱动')
  bad('laser-fade', !/laserStrokes\s*=\s*\[\]/.test(end), 'endLaser 不得清空笔迹数组 —— 那是「抬手即消」旧行为')
  const tick = fnBody(CODE, 'tickLaser')
  bad('laser-fade', /requestAnimationFrame\(tickLaser\)/.test(tick), 'tickLaser 必须在仍有笔迹时自续下一帧（渐隐动画）')

  // ③ 多笔互不影响：startLaser 每次新建一笔（不复活旧笔）
  const start = fnBody(CODE, 'startLaser')
  bad('laser-multi', /laserStrokes\.push\(\s*\{\s*pts:\s*\[\]/.test(start), 'startLaser 必须新建一笔（多笔各自独立倒计时）')

  // ④ 绝不进笔迹数据结构（导出板书 PNG 天然不含激光笔迹）
  for (const fn of ['startLaser', 'pushLaserPoint', 'drawLaser', 'endLaser']) {
    const body = fnBody(CODE, fn)
    bad('laser-purity', body.length > 0, `${fn} 应存在`)
    bad('laser-purity', !/localStrokes/.test(body), `${fn} 不应触碰 localStrokes`)
    bad('laser-purity', !/startStroke|appendLivePoint|finishStroke/.test(body), `${fn} 不应走书写链路`)
  }
  const exp = fnBody(CODE, 'exportPng')
  bad('laser-purity', /localStrokes\.value/.test(exp), '导出板书图只读 localStrokes')
  bad('laser-purity', !/laserStrokes|laserCtx|laserRef/.test(exp), '导出不应读激光层')

  // ⑤ 光点层 canvas：独立、不吃事件、盖在手写层上（不变）
  bad('laser-layer', /<canvas ref="laserRef" class="dc-laser"/.test(SRC), '应有独立的激光层 canvas')
  bad('laser-layer', /\.dc-laser\s*\{[^}]*pointer-events:\s*none/.test(SRC), '.dc-laser 必须 pointer-events:none')
  bad('laser-layer', /\.dc-laser\s*\{[^}]*z-index:\s*4/.test(SRC), '.dc-laser 应在手写层（z-index:3）之上')

  // ⑥ 卸载清理（在 onBeforeUnmount 回调体内，声明行不算数）
  bad('laser-cleanup', /laserStrokes\s*=\s*\[\]/.test(unmountBody(CODE)),
    'onBeforeUnmount 必须清空 laserStrokes（防卸载后 rAF 回调触达已死 canvas）')
  bad('laser-cleanup', /cancelAnimationFrame\(laserRaf\)/.test(unmountBody(CODE)),
    'onBeforeUnmount 必须取消激光 rAF')

  // ⑦ 文案
  bad('laser-copy', /激光笔（L）[^"]*1 秒后渐隐/.test(WB), '按钮 title 应说明「像笔一样写、1 秒后渐隐」')
  bad('laser-copy', !/无拖尾|抬手即消/.test(WB), '旧「无拖尾 / 抬手即消」文案应清除（行为已被新裁决推翻）')

  return fails
}

const SRC = read('src/workbench/components/DrawingCanvas.vue')
const WB_SRC = read('src/workbench/views/WeekendBoard.vue')

test('⛔ 激光笔 = 笔迹式激光 + 抬手 1 秒渐隐（全部判据）', () => {
  const failures = collectFailures(SRC, WB_SRC)
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处不符合规格：\n` + failures.map((f) => `  - ${f.msg}`).join('\n')
  )
})

test('锁健全性：判据对空白实现必须报出足够多条（防静默失效/被掏空）', () => {
  const probe = collectFailures('const x = 1', 'const y = 2')
  assert.ok(probe.length >= 15, `判据对空白实现应报出 ≥15 条，实际 ${probe.length} —— 锁可能被掏空`)
})
