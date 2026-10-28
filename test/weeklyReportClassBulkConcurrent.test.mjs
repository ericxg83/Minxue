/**
 * 全班周报 4 维度「并发取数」回归锁（r351，2026-10-28）
 *
 * 背景：r342 把全班 GET /api/weekly-report 的 N×4 串行查询折叠成 4 条
 * `GROUP BY student_id` 批量查询，但当时这 4 条维度查询仍用 4 个 `await`
 * 串行执行（const taskDim = await fetchDim(...) ×4）。这 4 条查询彼此独立
 * （不同表、同周期参数），且 fetchDim 各自 try/catch 返回 {ok:false}，
 * 串行/并发下「哪些维度成功」结果完全一致 ⇒ 并发零行为变化，仅把 4 次串行
 * DB 往返压成 1 次并发，热路径（工作台全班视图 + 批量 PDF 生成）延迟下降。
 * r351 改为 `const [taskDim, qDim, wrongDim, statusDim] = await Promise.all([...])`。
 *
 * 本锁判据（源码结构不变量）：
 *   1) 全班聚合用 `const [taskDim, qDim, wrongDim, statusDim] = await Promise.all([`
 *      并发取 4 维度（而非 4 条串行 await fetchDim 顺序赋值）；
 *   2) 4 个维度标签（tasks/questions/wrong/status）都在（防误删某一维度）；
 *   3) 旧的串行形态 `const XDim = await fetchDim('LABEL'` 已消除
 *      （防未来有人把并发改回串行，退化成 4×DB 往返）。
 * 反向自检：合成一份「仍串行」的坏树，判据必须判红（防空锁，不依赖 git 状态）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function collectClassBulkConcurrent(root) {
  const fails = []
  const p = join(root, 'server/routes/weeklyReport.js')
  if (!existsSync(p)) { fails.push('weeklyReport.js 不存在'); return fails }
  const src = readFileSync(p, 'utf8')

  // 判据 1：4 维度用 Promise.all 并发取数
  if (!/const \[taskDim, qDim, wrongDim, statusDim\] = await Promise\.all\(\[/.test(src)) {
    fails.push('全班周报 4 维度未用 Promise.all 并发（应 const [..] = await Promise.all([）')
  }

  // 判据 2：4 个维度标签都在（防误删某一维度）
  for (const label of ['tasks', 'questions', 'wrong', 'status']) {
    if (!new RegExp(`fetchDim\\('${label}'`).test(src)) {
      fails.push(`全班周报 缺维度 fetchDim('${label}'`)
    }
  }

  // 判据 3：旧的串行形态已消除（const XDim = await fetchDim('LABEL' 顺序赋值）
  for (const [v, l] of [['taskDim', 'tasks'], ['qDim', 'questions'], ['wrongDim', 'wrong'], ['statusDim', 'status']]) {
    if (new RegExp(`const ${v} = await fetchDim\\('${l}'`).test(src)) {
      fails.push(`全班周报 仍存在串行形态 const ${v} = await fetchDim('${l}'`)
    }
  }

  return fails
}

test('⛔ 全班周报 4 维度并发取数（Promise.all）当前树必须零违规', () => {
  const fails = collectClassBulkConcurrent(ROOT)
  assert.deepEqual(fails, [], `\n发现 ${fails.length} 处违规：\n` + fails.map(f => `  - ${f}`).join('\n'))
})

test('锁健全性：合成串行坏树必须判红（防空锁，不依赖 git 状态）', () => {
  const base = join(tmpdir(), `_r351_concurrent_bad_${process.pid}`)
  try {
    const put = (rel, content) => {
      const p = join(base, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    // 旧串行形态：4 条 const XDim = await fetchDim('LABEL' 顺序赋值，无 Promise.all
    put('server/routes/weeklyReport.js',
      `router.get('/', async (req, res) => {
         const taskDim = await fetchDim('tasks', 'SELECT 1')
         const qDim = await fetchDim('questions', 'SELECT 1')
         const wrongDim = await fetchDim('wrong', 'SELECT 1')
         const statusDim = await fetchDim('status', 'SELECT 1')
         res.json({ success: true })
       })`)
    const probe = collectClassBulkConcurrent(base)
    // 坏树触发：判据1（无 Promise.all）+ 判据3（4 条串行形态）= 至少 5 条
    assert.ok(probe.length >= 1, `判据套合成串行坏树应判红 ≥1，实际 ${probe.length} —— 锁可能是空锁`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
