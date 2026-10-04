/**
 * 回归锁（2026-10-04，第 105 轮）：复核工作台「判定写库失败必须回滚+提示」与
 * 「自动完成 300ms 定时器必须有卷身份守卫」。
 *
 * 缺陷（2026-10-04 深审 reviewStore.js 全文发现）：
 *   ① reviewQuestion 乐观置 review_status 后 fire-and-forget 发 PUT，
 *      .catch 只 console.error —— 失败不回滚、无提示（correct/exclude 无失败通道），
 *      老师看到已判定继续批改，完成复核后库里判定仍为 null、错题强入也没发生。
 *      与 2026-09-14「假成功」事故同源的逐题层版本。
 *   ② 最后判定后 setTimeout(() => autoCompleteAndAdvance(), 300) 无守卫：
 *      300ms 内切卷/手动完成 → 新卷被无声自动完成复核并跳走；或同一卷双跑
 *      gradeGeneratedExam（paper 模式执行两次）。
 *
 * 修复约定（源码级断言，与 wrongBookRollbackScope / wrongBookLifecycleRollback 同型）：
 *   ① updateQuestionReviewStatus 的 .catch 内必须回滚 review_status（读 undoStack 栈顶）
 *      并写 saveError（判定保存失败提示）；
 *   ② setTimeout 闭包必须捕获当时那份卷（autoCompleteAndAdvance(task)）；
 *   ③ autoCompleteAndAdvance 开头必须校验 currentTask.value.id !== capturedTask.id
 *      与 capturedTask.status === 'reviewed' 时早退。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const STORE = path.resolve(import.meta.dirname, '../src/workbench/stores/reviewStore.js')
const src = fs.readFileSync(STORE, 'utf8')

test('判定写库失败：catch 内必须回滚 review_status（undoStack 栈顶）并写 saveError', () => {
  const fnIdx = src.indexOf('const reviewQuestion = (questionId, result, metadata')
  assert.ok(fnIdx >= 0, '未找到 reviewQuestion')
  const fnEnd = src.indexOf('// 仅写入 source_type', fnIdx)
  const fnBody = src.slice(fnIdx, fnEnd > 0 ? fnEnd : src.length)

  // catch 不再只是 console.error：必须有回滚 + saveError
  assert.ok(/\.catch\(e => \{/.test(fnBody), 'catch 必须是块语句（有回滚逻辑）')
  assert.ok(/reviewUndoStack\.value\[reviewUndoStack\.value\.length - 1\]/.test(fnBody), '回滚必须读 undoStack 栈顶快照')
  assert.ok(/saveError\.value = \{/.test(fnBody), '失败必须写 saveError（UI 层消费弹错）')
  // 反向自检锚：旧版是 .catch(e => console.error(...)) 单表达式。
  // [2026-10-04 修] 原写法漏了 `m` 标志：没有 `m` 时 `$` 只匹配**整个字符串末尾**，
  // 而 `.catch(e =>` 在函数体中间，正则永远不命中 ⇒ 这条断言在**新旧版上都通过**，
  // 是条空断言（反向自检时才发现）。加 `m` 后旧版才会被判红。
  assert.ok(!/\.catch\(e =>\s*$/m.test(fnBody), '旧版单表达式 catch 已替换')
})

test('自动完成定时器：闭包必须捕获当份卷（防 300ms 内切卷误完成）', () => {
  const fnIdx = src.indexOf('const reviewQuestion = (questionId, result, metadata')
  assert.ok(fnIdx >= 0, '未找到 reviewQuestion')
  // [2026-10-04 修] 原先写死 `fnIdx + 2200`，而目标代码在 reviewQuestion 内约 4700 字符处
  // （函数体随迭代增长），锁自己判红、把产品代码的缺陷误报成「没修」。改成与第 1 例一致的
  // 「先找函数结束锚点再切片」，函数再长也不会失效。
  const fnEnd = src.indexOf('// 仅写入 source_type', fnIdx)
  const seg = src.slice(fnIdx, fnEnd > 0 ? fnEnd : fnIdx + 8000)
  assert.ok(/const task = currentTask\.value/.test(seg), 'setTimeout 前必须捕获当前卷')
  assert.ok(/setTimeout\(\(\) => autoCompleteAndAdvance\(task\), 300\)/.test(seg), '定时器必须把捕获的 task 传入 autoCompleteAndAdvance')
})

test('自动完成守卫：autoCompleteAndAdvance 开头必须校验卷身份与已复核状态', () => {
  const fnIdx = src.indexOf('const autoCompleteAndAdvance = async')
  assert.ok(fnIdx >= 0, '未找到 autoCompleteAndAdvance')
  const seg = src.slice(fnIdx, fnIdx + 600)
  assert.ok(/capturedTask && currentTask\.value\.id !== capturedTask\.id/.test(seg), '切卷必须早退')
  assert.ok(/capturedTask\?\.status === 'reviewed'/.test(seg), '已复核必须早退（防双跑）')
})