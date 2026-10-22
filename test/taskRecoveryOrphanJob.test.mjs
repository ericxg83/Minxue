/**
 * 「僵尸 job 被判成在跑 ⇒ 谁都不动」的回归锁（2026-10-22）
 *
 * 事故：本地 6 个作业从 10-21 19:20 起全部卡「批改中」，最久超过一天。
 * 其中 4 个的 BullMQ job 因为持锁进程被关机/重启带走，永久停在 `active`：
 *   · `scanProcessingStuck` 只看「队列里有没有这个 taskId」⇒ 逐个打印「已在队列中」跳过；
 *   · BullMQ 自己的 stalled 回收又要等 lockDuration + stalledInterval 两段。
 *   两套自愈互相以为对方会处理，结果谁都不动，任务无限期挂着。
 *   同一时期 `PENDING_TASK_SCAN_INTERVAL=3600000`（60 分钟），一次漏投就要等一小时才重试。
 *
 * 修法：
 *   ① `splitInFlightJobs()` 用 `bull:<queue>:<id>:lock` 的 PTTL 判活 —— 锁没了就是孤儿，
 *      并从 active 列表里摘掉（否则锁过期后被 BullMQ 再投一次，两个 job 并行删建题目表，
 *      前端看到「0/33 又变 0/33」反复归零）；
 *   ② 扫描间隔钳到 ≤5 分钟，环境里配多大都不再放大恢复延迟。
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { splitInFlightJobs } from '../server/pendingTaskRecovery.js'

const SRC = readFileSync(new URL('../server/pendingTaskRecovery.js', import.meta.url), 'utf8')

/** 假 queue：只提供 splitInFlightJobs 用到的 name / client；pttl 由 lockTtl 映射决定 */
function fakeQueue(lockTtl, { clientFails = false } = {}) {
  return {
    name: 'task-processing',
    client: clientFails
      ? Promise.reject(new Error('no connection'))
      : Promise.resolve({
          pttl: async (key) => (key in lockTtl ? lockTtl[key] : -2),
        }),
  }
}

const job = (id, taskId, state) => ({
  id,
  data: { taskId },
  getState: async () => state,
})

test('active 且锁还在 → 算在跑；active 但锁已过期 → 算孤儿', async () => {
  const jobs = [
    job('1', 'alive-task', 'active'),
    job('2', 'orphan-task', 'active'),
    job('3', 'queued-task', 'waiting'),
    job('4', 'delayed-task', 'delayed'),
  ]
  const { live, orphans } = await splitInFlightJobs(
    fakeQueue({ 'bull:task-processing:1:lock': 120000, 'bull:task-processing:2:lock': -2 }),
    jobs
  )
  assert.deepEqual([...live].sort(), ['alive-task', 'delayed-task', 'queued-task'])
  assert.deepEqual(orphans.map((j) => j.id), ['2'], '锁过期的 active job 必须交给调用方摘掉')
})

test('非 active 态不看锁（waiting/delayed 本身就是合法在途）', async () => {
  const { live, orphans } = await splitInFlightJobs(fakeQueue({}), [job('9', 't9', 'waiting')])
  assert.equal(live.has('t9'), true)
  assert.equal(orphans.length, 0)
})

test('拿不到 queue.client 时保守放行：active 一律算在跑（宁可不摘，不乱摘）', async () => {
  const { live, orphans } = await splitInFlightJobs(
    fakeQueue({}, { clientFails: true }),
    [job('1', 't1', 'active')]
  )
  assert.equal(live.has('t1'), true)
  assert.equal(orphans.length, 0)
})

test('没有 taskId 的 job 不参与判定（几何/TikZ 队列混入也不炸）', async () => {
  const { live, orphans } = await splitInFlightJobs(fakeQueue({}), [
    { id: '7', data: {}, getState: async () => 'active' },
    null,
  ])
  assert.equal(live.size, 0)
  assert.equal(orphans.length, 0)
})

test('stuck 扫描必须走锁判活，且摘掉僵尸 job 后才重投', () => {
  const stuck = SRC.slice(SRC.indexOf('async scanProcessingStuck()'))
  const body = stuck.slice(0, stuck.indexOf('async scanPendingTasks()'))
  assert.match(body, /splitInFlightJobs\(queue, inFlightJobs\)/, 'stuck 扫描必须用锁判活')
  assert.doesNotMatch(
    body,
    /collectInFlightTaskIds\(inFlightJobs\)/,
    '⛔ 退回「队列里有就算在跑」会让孤儿任务永远跳过'
  )
  assert.match(body, /orphanJob\.remove\(\)/, '僵尸 job 必须先摘掉再重投，否则会并行跑两份')
})

test('扫描间隔钳到 ≤5 分钟（环境配 60 分钟也不放大恢复延迟）', () => {
  assert.match(SRC, /MAX_SCAN_INTERVAL_MS\s*=\s*5 \* 60 \* 1000/)
  assert.match(SRC, /Math\.min\(\s*parseInt\(process\.env\.PENDING_TASK_SCAN_INTERVAL\)/)
})

test('冷启动回填必须给批改让位（不与批改抢 AI 配额）', () => {
  const idjs = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(idjs, /async function backfillYieldDelayMs\(\)/, '缺少让位判据实现')
  assert.match(
    idjs,
    /status IN \('processing', 'pending'\)/,
    '让位判据必须是「有没有非终态任务」，不是别的口径'
  )
  assert.match(
    idjs,
    /const delayMs = await backfillYieldDelayMs\(\)/,
    '回填链的下一批延迟必须经过让位判据（写死 15000 会把事故原样复活）'
  )
  const tail = idjs.slice(idjs.indexOf('const delayMs = await backfillYieldDelayMs()'))
  assert.match(tail.slice(0, 600), /setTimeout\([\s\S]*?delayMs\)/, '定时器要真的用上这个延迟')
})
