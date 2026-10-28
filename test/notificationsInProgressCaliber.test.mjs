/**
 * 移动端通知面板「批改中」限量 / 计数口径回归锁（2026-10-28，移动端赛道，r348）
 *
 * 守住的既有事实（回归即判红）：
 *   1. 移动端 NotificationsPanel 调用 getInProgressTasks 的限量必须对齐工作台（limit=50，
 *      即函数默认值），不得用 10 截断。否则 >10 个在途批改任务时：
 *        - 移动端下拉只显示前 10 条（PC 铃铛显示 50 条，跨端不一致）；
 *        - 头部「批改中（N）」用被截断的列表长度，与上方统计卡 summary.inProgressCount 矛盾。
 *   2. 头部「批改中（N）」必须显示权威计数 summary.inProgressCount，不得直接显示被 limit
 *      截断的 inProgress.length。统计卡与列表头必须口径一致（铁律：数量守恒）。
 *
 * 反向自检：harness 把当前源码改写成旧写法（limit=50→10、头部用 inProgress.length），
 * 同一把判据必须同时判红，证明探测器非空锁（不依赖 git）。
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const TARGET = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'NotificationsPanel.jsx')

function loadSource() {
  return readFileSync(TARGET, 'utf8')
}

// 判据 1：移动端 fetch 批改中任务须对齐工作台（limit=50），不得用 10 截断
function assertAlignedLimit(src) {
  assert.ok(src.includes('getInProgressTasks(50)'), '移动端须用 getInProgressTasks(50) 对齐工作台（函数默认值）')
  assert.ok(!src.includes('getInProgressTasks(10)'), '移动端不得用 getInProgressTasks(10) 截断下拉列表')
}

// 判据 2：头部「批改中（N）」须显示权威计数 summary.inProgressCount，不得用被截断的列表长度
function assertAuthoritativeHeaderCount(src) {
  assert.ok(src.includes('批改中（{summary'), '头部批改中计数须用 summary.inProgressCount 权威值')
  assert.ok(!/批改中（\{inProgress\.length\}）/.test(src), '头部不得直接用 inProgress.length（被 limit 截断的列表长度）')
}

test('移动端通知面板：批改中 limit 对齐 50 且头部用权威计数', () => {
  const src = loadSource()
  assertAlignedLimit(src)
  assertAuthoritativeHeaderCount(src)
})

test('反向自检：旧写法（limit=10 + 头部用列表长度）必须判红', () => {
  const src = loadSource()
  const mutated = src
    .replace('getInProgressTasks(50)', 'getInProgressTasks(10)')
    .replace('批改中（{summary?.inProgressCount ?? inProgress.length}）', '批改中（{inProgress.length}）')
  const tmp = resolve(dirname(fileURLToPath(import.meta.url)), '_r348_old_notifpanel.jsx')
  writeFileSync(tmp, mutated, 'utf8')
  try {
    const m = readFileSync(tmp, 'utf8')
    let failed = 0
    try { assertAlignedLimit(m) } catch { failed++ }
    try { assertAuthoritativeHeaderCount(m) } catch { failed++ }
    assert.strictEqual(failed, 2, '旧写法应同时击穿两条判据（锁非空）')
  } finally {
    rmSync(tmp, { force: true })
  }
})
