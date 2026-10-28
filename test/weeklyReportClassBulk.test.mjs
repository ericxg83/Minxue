/**
 * 全班周报 N×4 → 4 条批量 GROUP BY 回归锁（r342-P-A，2026-10-28）
 *
 * 背景：GET /api/weekly-report 全班概览原是「对每个学生串行跑 4 条查询」
 * （tasks / questions / wrong / status），N×4=84 条（N≈21），连接池 max=10
 * 下峰值 21 并发排队；且随学生数线性放大。r342-P-A 把它折叠为 4 条
 * `GROUP BY student_id` 批量查询 + JS 组装，行为不变（字段名逐字一致、
 * partialFailure / stats:null 失败语义保留）。
 *
 * 本锁判据（源码结构不变量）：
 *   1) 全班 GET / 路由含 ≥4 条 `GROUP BY student_id` 批量查询；
 *   2) 保留 splitMasteryStates 调用；
 *   3) 保留全班一次自愈 healPeriodCompletenessQuietly(null,…)；
 *   4) 保留 partialFailure 字段；
 *   5) 旧 N×4 模式已消除（studentRows.map(async (student)) + WHERE student_id = $1 同时出现）。
 * 反向自检：合成一份「仍 N×4」的坏树，判据必须判红（防空锁，不依赖 git 状态）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectClassBulk(root) {
  const fails = []
  const p = join(root, 'server/routes/weeklyReport.js')
  if (!existsSync(p)) { fails.push('weeklyReport.js 不存在'); return fails }
  const src = readFileSync(p, 'utf8')

  // 判据 1：4 条 GROUP BY student_id 批量查询
  const gcount = (src.match(/GROUP BY student_id/g) || []).length
  if (gcount < 4) fails.push(`全班周报缺批量 GROUP BY student_id（应≥4，实际 ${gcount}）`)

  // 判据 2：保留 splitMasteryStates 调用
  if (!src.includes('splitMasteryStates(')) fails.push('weeklyReport: 缺 splitMasteryStates 调用')

  // 判据 3：保留全班一次自愈
  if (!src.includes('healPeriodCompletenessQuietly(null')) {
    fails.push('weeklyReport: 缺全班一次自愈 healPeriodCompletenessQuietly(null')
  }

  // 判据 4：保留 partialFailure 字段
  if (!src.includes('partialFailure')) fails.push('weeklyReport: 缺 partialFailure 字段')

  // 判据 5：旧 N×4 模式已消除（per-student 循环 + student_id=$1）
  const stillNx4 = /studentRows\.map\(async \(student\)/.test(src) && /WHERE student_id = \$1/.test(src)
  if (stillNx4) fails.push('weeklyReport: 仍存在 N×4 per-student 循环（studentRows.map(async)+WHERE student_id=$1）')

  return fails
}

test('⛔ 全班周报 N×4 已折叠为 4 条批量 GROUP BY（当前树必须零违规）', () => {
  const fails = collectClassBulk(ROOT)
  assert.deepEqual(fails, [], `\n发现 ${fails.length} 处违规：\n` + fails.map(f => `  - ${f}`).join('\n'))
})

test('锁健全性：判据套合成 N×4 坏树必须判红（防空锁，不依赖 git 状态）', () => {
  const base = join(tmpdir(), `_r342_bulk_bad_${process.pid}`)
  try {
    const put = (rel, content) => {
      const p = join(base, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    put('server/routes/weeklyReport.js',
      `router.get('/', async (req, res) => {
         const { rows: studentRows } = await query('SELECT id, name FROM students')
         const reports = await Promise.all(studentRows.map(async (student) => {
           const { rows: taskRows } = await query('SELECT COUNT(*) FROM tasks WHERE student_id = $1', [student.id])
           const { rows: qRows } = await query('SELECT COUNT(*) FROM questions WHERE student_id = $1', [student.id])
           const { rows: wRows } = await query('SELECT COUNT(*) FROM wrong_questions WHERE student_id = $1', [student.id])
           const { rows: sRows } = await query('SELECT lifecycle_status, COUNT(*) FROM wrong_questions WHERE student_id = $1 GROUP BY lifecycle_status', [student.id])
           splitMasteryStates(sRows)
           healPeriodCompletenessQuietly(null, a, b, 'x')
           return { student, stats: {}, partialFailure: null }
         }))
         res.json({ success: true, reports })
       })`)
    const probe = collectClassBulk(base)
    // 坏树触发：判据1（<4 GROUP BY）+ 判据5（N×4 仍在）= 至少 2 条
    assert.ok(probe.length >= 2, `判据套合成 N×4 坏树应判红 ≥2，实际 ${probe.length} —— 锁可能是空锁`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
