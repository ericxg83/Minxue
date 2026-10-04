/**
 * 回归锁（2026-10-04，第 108 轮）：复核工作台「exclude（删除本题）不显示撤销提示」。
 *
 * 缺陷：handleReview 对所有判定（含 exclude）都设置 store.undoHint → 撤销 snackbar
 * 出现且按钮可点（canUndo 只看栈长度），但 exclude 后题目已被 splice 出 allQuestions，
 * undoLastReview 的 find 恒 undefined 无法恢复 —— 按钮可点但无效（设计上删除不可挽回，
 * 由二次确认弹窗兜底，见 QuestionDetailPanel.vue L1391-1395 注释）。
 *
 * 修复约定（源码级断言）：
 *   ① handleReview 内 undoHint 赋值必须被 `result !== 'exclude'` 守卫包裹；
 *   ② 不允许出现「无条件 store.undoHint = { ... }」形态（旧版）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const PANEL = path.resolve(import.meta.dirname, '../src/workbench/components/review/QuestionDetailPanel.vue')
const src = fs.readFileSync(PANEL, 'utf8')

test('exclude 判定不得设置 undoHint（撤销对已删除题无效，勿显示可点但无效的按钮）', () => {
  const fnIdx = src.indexOf('const handleReview = async (result) =>')
  assert.ok(fnIdx >= 0, '未找到 handleReview')
  // handleReview 从函数头到 undoHint 赋值约 100 行，切片取 6000 字符保证覆盖
  const seg = src.slice(fnIdx, fnIdx + 6000)

  // 守卫必须存在：undoHint 赋值在 result !== 'exclude' 分支内
  assert.ok(/if \(result !== 'exclude'\) \{/.test(seg), 'undoHint 赋值必须被 exclude 守卫包裹')
  assert.ok(/store\.undoHint = \{ text: resultText\[result\], questionId: question\.id \}/.test(seg), 'undoHint 赋值逻辑仍须存在（correct/wrong 仍可撤销）')

  // 反向自检锚：旧版是无条件赋值（不在任何条件块内）
  // 在守卫所在行之前，若有裸赋值（不在 if 内）则判红
  const guardIdx = seg.indexOf("if (result !== 'exclude')")
  assert.ok(guardIdx >= 0, '守卫未找到')
  const beforeGuard = seg.slice(0, guardIdx)
  assert.ok(!/store\.undoHint = \{/.test(beforeGuard), '守卫之前不得有裸 undoHint 赋值（旧版形态）')
})

test('exclude 撤销提示文案仍存在（删除按钮点击路径未被破坏）', () => {
  assert.ok(src.includes("exclude: '已删除本题'"), 'exclude 文案须保留（handleReview 内 resultText）')
  assert.ok(src.includes("judgeClick('exclude', $event)"), 'exclude 按钮点击路径须保留')
})