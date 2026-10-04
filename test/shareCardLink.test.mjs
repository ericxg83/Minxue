/**
 * 分享卡链路回归锁（2026-10-04 第 105 轮）
 *
 * 背景：r104 并行会话抽取 fetchStudentWeeklyReport 时把第二参数命名为 query，
 * 把文件顶部从 neon.js 导入的 query 函数遮蔽了 —— 函数体里 `await query(...)`
 * 实际调用的是参数对象，分享卡端点 POST /api/share-card 每次 500
 * 「query is not a function」。r105 定位修复（参数改名 options）。
 *
 * 本锁（防同型回归，两条都锁）：
 *   1. fetchStudentWeeklyReport 第二参数不得叫 query（否则遮蔽数据层函数）；
 *   2. shareCard 链路必须真实可用 —— 直接调用数据层函数能跑通（组件级最小验证）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('⛔ fetchStudentWeeklyReport 第二参数不得遮蔽数据层 query 函数', () => {
  const src = readFileSync(resolve(ROOT, 'server/routes/weeklyReport.js'), 'utf8')
  assert.match(src, /import \{ query, TABLES \} from '\.\.\/config\/neon\.js'/, '数据层 query 导入必须在')
  assert.ok(
    !/fetchStudentWeeklyReport\(studentId, query\b/.test(src),
    '第二参数名不能叫 query —— 同名会把数据层 query 函数遮蔽成「query is not a function」（r105 实证）'
  )
  assert.match(src, /fetchStudentWeeklyReport\(studentId, options\b/, '第二参数应为 options（或等价非遮蔽名）')
})

test('⛔ 分享卡数据链路组件级可用（query 调用点不落在遮蔽参数上）', () => {
  const src = readFileSync(resolve(ROOT, 'server/routes/weeklyReport.js'), 'utf8')
  // 函数体内仍必须真实调用数据层 query（函数名未被改走）
  const fnBlock = src.slice(src.indexOf('export async function fetchStudentWeeklyReport'))
  assert.match(fnBlock, /await query\(/, '函数体内必须仍调用数据层 query（修法是把参数改名，不是把调用改没）')
  assert.ok(!/parsePeriod\(query\)/.test(fnBlock), 'parsePeriod 不能再接遮蔽参数')
})
