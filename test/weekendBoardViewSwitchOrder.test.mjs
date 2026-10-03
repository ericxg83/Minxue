/**
 * 白板「换可见题单」时笔迹落盘顺序的回归锁（2026-10-03 第 88 轮）
 *
 * 缺陷背景：`saveStrokes()` 是按 `current`（当前题）算 localStorage 键的
 * （`strokesKey = wb_strokes_v2_<anchorKey>`）。而「只看未讲」切换会把
 * `unTaughtOnly` / `viewSnapshot` 换掉，`current` 立刻变成**新题单同下标**的那道题。
 * 原实现把 `saveStrokes()` 写在换题单之后 ⇒ 当前题的板书被写进别人的键里：
 *   ① 串题 —— 那道题会显示别的题的板书；
 *   ② 覆盖 —— 那道题原有的板书被整份盖掉。
 *
 * 实测复现（`_r88_probe.mjs`，6 题 / 第 1 题已讲 / 停在 index 3）：
 *   切换前 `wb_strokes_v2_A4` = 0 笔；切换后 = 3 笔（A3 的板书）。
 *
 * 无 jsdom，所以用「源码级顺序锁」把这条纪律钉死：顺序一旦被改回去，测试立刻红。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const BOARD_SRC = readFileSync(
  new URL('../src/workbench/views/WeekendBoard.vue', import.meta.url), 'utf8')

/** 取出 `function <name>(...) { ... }` 的函数体（按大括号配平；模板串里的 ${} 是配平的） */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `找不到函数 ${name}`)
  const open = src.indexOf('{', start)
  assert.ok(open >= 0, `${name} 缺少函数体`)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`${name} 的函数体大括号不配对`)
}

/** 去掉整行注释，避免注释里出现的 `saveStrokes()` 之类的字面量把计数/顺序判据带偏 */
const codeOf = (body) => body
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')

const countOf = (hay, needle) => hay.split(needle).length - 1

test('接线锁：切换可见题单必须先落盘旧题笔迹，再换 unTaughtOnly/viewSnapshot', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'toggleUnTaughtOnly'))
  const save = body.indexOf('saveStrokes()')
  assert.ok(save >= 0, 'toggleUnTaughtOnly 必须显式 saveStrokes() —— 切题单前要先把旧题板书落盘')

  const armOn = body.indexOf('unTaughtOnly.value = true')
  const snap = body.indexOf('viewSnapshot.value =')
  assert.ok(armOn >= 0 && snap >= 0, '找不到换题单的两处赋值')
  assert.ok(save < armOn,
    '⛔ saveStrokes() 必须在 unTaughtOnly.value = true 之前 —— 换题单后 current 已变成新题单同下标的题，会把板书写进别人的键')
  assert.ok(save < snap,
    '⛔ saveStrokes() 必须在 viewSnapshot.value = 之前（同上：viewQuestions 一换，strokesKey 就跟着变）')

  assert.equal(countOf(body, 'saveStrokes()'), 1,
    'saveStrokes() 只应出现一次且在换题单之前；在换题单之后再补一次仍然会串题')
})

test('接线锁：gotoQuestion 的「先存后切」纪律不得被破坏', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'gotoQuestion'))
  const save = body.indexOf('saveStrokes()')
  const move = body.indexOf('currentIndex.value = i')
  assert.ok(save >= 0 && move >= 0, 'gotoQuestion 缺少 saveStrokes() 或 currentIndex 赋值')
  assert.ok(save < move, 'saveStrokes() 必须先于 currentIndex 变更（否则键按新题算，板书串题）')
})

test('接线锁：onPageHide 必须补一刀落盘（防抖窗口里的最后一笔不能丢）', () => {
  const body = codeOf(extractFn(BOARD_SRC, 'onPageHide'))
  assert.ok(body.includes('saveStrokes()'),
    '⛔ onPageHide 必须 saveStrokes()：onStrokesChange 是 300ms 防抖保存，' +
    '而 onBeforeUnmount 会先 clearTimeout(saveTimer) 再调本函数 —— 不补这一刀，' +
    '「写完字 300ms 内离开白板」的那一笔会永远丢掉')
  assert.ok(body.indexOf('saveStrokes()') < body.indexOf('marks.leaveQuestion('),
    'saveStrokes() 应在结算讲题状态之前（保持与切题路径同一条顺序）')
})

test('顶栏题号总数必须跟可见题单（只看未讲时不能显示被隐藏的题数）', () => {
  assert.ok(BOARD_SRC.includes('第 {{ currentIndex + 1 }} / {{ viewQuestions.length }} 题'),
    '顶栏副标题必须用 viewQuestions.length —— 用 questions.length 时开着「只看未讲」会显示「第 1 / 6 题」而实际只有 5 题可翻')
  assert.ok(!BOARD_SRC.includes('第 {{ currentIndex + 1 }} / {{ questions.length }} 题'),
    '旧的 questions.length 写法必须已删除')
})
