/**
 * 存量「主观题需人工判定」清理的判据锁（2026-10-23）
 *
 * 背景：负责人截图题 #20 —— 学生答 3/4、参考答案 3/4，页面却写「主观题需人工判定」。
 * 清理脚本要批量把这类「其实答对」的行改成判对，因此**判据必须严到不会放水**：
 * 只认「归一化后逐字相等」，绝不使用 judgeAnswer 的等价通道。
 *
 * 反面样本（真库实测，judgeAnswer 当前会误判为等价）：
 *   学生 2x²y√x  vs 参考 2xy²√x   → 数学上不等，仅差变量位置
 *   学生 x₁=2√3+2√2 vs 参考 x₁=(√6-2√3)/3 → 完全不同的根
 * 若用等价通道批量改库，这两类会被判对、从错题本里消失，掌握度被污染。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { triviallyEqual } from '../server/scripts/backfill-stale-subjective-20261023.mjs'

test('逐字相等 + LaTeX 写法差异 → 可判对', () => {
  assert.equal(triviallyEqual('3/4', '3/4'), true)
  assert.equal(triviallyEqual('√10/99', '$\\frac{\\sqrt{10}}{99}$'), true)
  assert.equal(triviallyEqual('x = \\frac{\\sqrt{2}}{2}', '√2/2'), true)
  // 末行是最终取值（前几行是过程）
  assert.equal(triviallyEqual('解：x²-x=0\nx=1', '1'), true)
  assert.equal(triviallyEqual('-a-c+a+c-b=-b', '-b'), true)
})

test('变量位置不同（形似而非相等）→ 不算相同', () => {
  assert.equal(triviallyEqual('2x²y√x', '2xy²√x'), false)
  assert.equal(triviallyEqual('x₁=2√3+2√2；x₂=-2√3+2√2', 'x₁=(√6-2√3)/3, x₂=(√6+2√3)/3'), false)
})

test('参考答案是多值集合 → 学生只写一个不得判对', () => {
  // 参考 x=2 或 x=3，学生只写 x=3：取「最后一个等号右侧」会误命中，必须拦住
  assert.equal(triviallyEqual('x=3', 'x=2或x=3'), false)
  assert.equal(triviallyEqual('x=2或x=3', 'x=2或x=3'), true)
})

test('空答案/长叙述 → 一律不算相同', () => {
  assert.equal(triviallyEqual('', '3/4'), false)
  assert.equal(triviallyEqual('3/4', ''), false)
  const prose = '因为三角形ABC和三角形DEF相似，所以对应边成比例，可以求出这个长度的具体数值大约是三点七五米左右，再根据题意取近似值即可'
  assert.ok(prose.length > 60, '样本必须超过 60 字才算「长叙述」')
  assert.equal(triviallyEqual(prose, prose), false)
})
