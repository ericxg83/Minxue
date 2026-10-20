// 回归锁（2026-10-20 r317）：锁「Render 疯狂重连」修复的三条语义。
//
// 背景（负责人 2026-10-20 指令「A 你必须改，马上改」）：
//   Render 免费层 sleep/wake 频繁冷启动 ⇒ 每次冷启动触发一轮 BullMQ 拆建风暴：
//     init() 给池里每个实例建连接 → getAvailableClient() 用 PING 判活
//     → 但 Upstash 超额后 PING 仍回 PONG（连接级探活对配额天然失明）
//     → 必然选中已烧穿的库 → 真实业务命令报错 → markQuotaExhausted
//     → onQuotaExhausted → queue.js rebuildQueue → teardown 拆 3 Queue + 3 Worker 再重建
//     → 下一个库若也烧穿再来一轮 ⇒ N 个坏库 = N 轮风暴。
//   实证：烧穿库节点 total_connections_received=3050，健康新库仅 42。
//
// 本文件锁的三条语义：
//   ① 选实例用「真实数据命令」判活，不用 PING（probeQuotaAlive 必须存在且
//      能区分「配额耗尽」与「网络抖动」——后者绝不能标记熔断＝误伤）。
//   ② 熔断标记落盘 + 跨进程恢复（冷启动直接跳过已知烧穿的库 ⇒ 风暴从 N 轮降到 0）。
//   ③ 选实例阶段的熔断**不得**触发 onQuotaExhausted 回调
//      （否则 initQueue 重入 ⇒ 双建队列 + 连接泄漏，比原问题更糟）。
//
// 反向自检说明（旧版必须判红）：
//   旧版 redisManager 无 probeQuotaAlive / persistQuotaExhausted /
//   loadPersistedQuotaExhausted / markQuotaExhausted 的 notify 选项
//   ⇒ 本文件多个用例直接 TypeError / assert 失败判红；非空锁。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RedisManager } from '../server/redisManager.js'

// ── 探针 key 必须与生产实现一致（真实数据命令，不是 PING）
const PROBE_KEY = '__redis_breaker_selfheal_probe__'

function makeClient({ getImpl, pingImpl } = {}) {
  return {
    get: getImpl || (async () => null),
    ping: pingImpl || (async () => 'PONG'),
    on() {},
    disconnect() {},
    quit() {},
  }
}

test('① 探活必须用真实数据命令：超额实例判死；PING 仍 PONG 也不放过', async () => {
  const m = new RedisManager()
  assert.equal(typeof m.probeQuotaAlive, 'function', 'probeQuotaAlive 必须存在（旧版无 ⇒ 判红）')

  // 关键场景：PING 正常返回 PONG，但真实数据命令报配额错
  const burned = makeClient({
    getImpl: async () => { throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500003') },
    pingImpl: async () => 'PONG',
  })
  const r1 = await m.probeQuotaAlive(burned)
  assert.equal(r1.alive, false, '超额实例必须判为不可用（哪怕 PING 回 PONG）')
  assert.equal(r1.quota, true, '必须识别出是「配额耗尽」而非普通网络错误')

  // 健康实例
  const healthy = makeClient()
  const r2 = await m.probeQuotaAlive(healthy)
  assert.equal(r2.alive, true)
  assert.equal(r2.quota, false)

  // ⛔ 网络抖动绝不能被当成配额耗尽（否则一次抖动就永久踢掉健康实例＝误伤）
  const flaky = makeClient({
    getImpl: async () => { throw new Error('read ECONNRESET') },
  })
  const r3 = await m.probeQuotaAlive(flaky)
  assert.equal(r3.alive, false)
  assert.equal(r3.quota, false, 'ECONNRESET 属网络抖动，不能判成配额耗尽')
})

test('① 探活确实发的是 GET 真实数据命令（不是 PING）', async () => {
  const m = new RedisManager()
  const seen = []
  const client = makeClient({
    getImpl: async (k) => { seen.push(['get', k]); return null },
    pingImpl: async () => { seen.push(['ping']); return 'PONG' },
  })
  await m.probeQuotaAlive(client)
  assert.deepEqual(seen, [['get', PROBE_KEY]], '探活必须且只能发一条 GET 真实数据命令')
})

test('③ 选实例阶段的熔断不得触发 onQuotaExhausted（防 initQueue 重入双建队列）', async () => {
  const m = new RedisManager()
  let notified = 0
  m.onQuotaExhausted = () => { notified++ }

  // 模拟 getAvailableClient 的选实例期：_inSelection > 0
  m._inSelection = 1
  m.markQuotaExhausted('upstash_primary', 'quota exhausted', { notify: true })
  m._inSelection = 0
  assert.equal(notified, 0, '选实例期间即使 notify=true 也不得触发重建回调')

  // 非选实例期（运行期 Worker 报错）必须正常通知
  m.markQuotaExhausted('upstash_backup_1', 'quota exhausted', { notify: true })
  assert.equal(notified, 1, '运行期熔断必须触发 onQuotaExhausted（否则队列不会切库）')
})

test('③ markQuotaExhausted 的 notify:false 显式抑制通知', async () => {
  const m = new RedisManager()
  let notified = 0
  m.onQuotaExhausted = () => { notified++ }
  m.markQuotaExhausted('upstash_primary', 'x', { notify: false })
  assert.equal(notified, 0)
  assert.equal(m.quotaExhaustedSet.has('upstash_primary'), true, '仍须记录熔断（后续 getAvailableClient 要跳过它）')
})

test('② 熔断标记落盘 + 跨进程恢复：冷启动直接跳过已知烧穿的库', () => {
  const tmp = path.join(os.tmpdir(), `minxue-r317-${process.pid}-${Date.now()}.json`)
  const savedFile = process.env.REDIS_QUOTA_STATE_FILE
  process.env.REDIS_QUOTA_STATE_FILE = tmp
  try {
    // 进程 A：标记 primary 烧穿 → 落盘
    const a = new RedisManager()
    a.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://x', priority: 1 }]
    a.markQuotaExhausted('upstash_primary', 'quota exhausted', { notify: false })
    assert.ok(fs.existsSync(tmp), '熔断标记必须落盘（旧版无 persistQuotaExhausted ⇒ 判红）')

    // 进程 B（模拟 Render 冷启动的新进程）：应恢复标记 ⇒ 直接跳过该库
    const b = new RedisManager()
    b.pool = [
      { id: 'upstash_primary', type: 'URL', url: 'redis://x', priority: 1 },
      { id: 'upstash_backup_1', type: 'URL', url: 'redis://y', priority: 2 },
    ]
    assert.equal(typeof b.loadPersistedQuotaExhausted, 'function', 'loadPersistedQuotaExhausted 必须存在（旧版无 ⇒ 判红）')
    b.loadPersistedQuotaExhausted()
    assert.equal(b.quotaExhaustedSet.has('upstash_primary'), true, '冷启动必须记得哪个库烧穿过（否则又从头踩起）')
    assert.equal(b.quotaExhaustedSet.has('upstash_backup_1'), false, '没烧穿的不该被标记')
  } finally {
    if (savedFile === undefined) delete process.env.REDIS_QUOTA_STATE_FILE
    else process.env.REDIS_QUOTA_STATE_FILE = savedFile
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

test('② 跨月的历史标记必须丢弃（Upstash 额度按自然月重置）', () => {
  const tmp = path.join(os.tmpdir(), `minxue-r317-stale-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(tmp, JSON.stringify({ ids: ['upstash_primary'], month: '2026-8' }), 'utf8')
  const savedFile = process.env.REDIS_QUOTA_STATE_FILE
  process.env.REDIS_QUOTA_STATE_FILE = tmp
  try {
    const m = new RedisManager()
    m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://x', priority: 1 }]
    m.loadPersistedQuotaExhausted()
    assert.equal(m.quotaExhaustedSet.has('upstash_primary'), false, '跨月标记必须丢弃（额度已重置，白跳过健康实例是错的）')
  } finally {
    if (savedFile === undefined) delete process.env.REDIS_QUOTA_STATE_FILE
    else process.env.REDIS_QUOTA_STATE_FILE = savedFile
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

test('② 落盘内容只记实例 id，不含任何 URL/密码', () => {
  const tmp = path.join(os.tmpdir(), `minxue-r317-sec-${process.pid}-${Date.now()}.json`)
  const savedFile = process.env.REDIS_QUOTA_STATE_FILE
  process.env.REDIS_QUOTA_STATE_FILE = tmp
  try {
    const m = new RedisManager()
    m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'rediss://default:SECRET@host:6379', priority: 1 }]
    m.markQuotaExhausted('upstash_primary', 'quota exhausted', { notify: false })
    const content = fs.readFileSync(tmp, 'utf8')
    assert.ok(!content.includes('SECRET'), '状态文件绝不能含凭据')
    assert.ok(!content.includes('host'), '状态文件绝不能含实例 URL')
  } finally {
    if (savedFile === undefined) delete process.env.REDIS_QUOTA_STATE_FILE
    else process.env.REDIS_QUOTA_STATE_FILE = savedFile
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

test('③ getAvailableClient 必须跳过已熔断实例并选到健康实例', async () => {
  const m = new RedisManager()
  m.pool = [
    { id: 'upstash_primary', type: 'URL', url: 'redis://x', priority: 1 },
    { id: 'upstash_backup_1', type: 'URL', url: 'redis://y', priority: 2 },
  ]
  m.quotaExhaustedSet.add('upstash_primary')

  const healthy = makeClient()
  m.clients.set('upstash_backup_1', healthy)

  const got = await m.getAvailableClient()
  assert.equal(got, healthy, '应跳过已熔断的 primary，选中健康 backup')
  assert.equal(m.currentIndex, 1)
})

test('③ getAvailableClient 选实例期不触发 onQuotaExhausted（端到端）', async () => {
  const m = new RedisManager()
  let notified = 0
  m.onQuotaExhausted = () => { notified++ }
  m.pool = [
    { id: 'upstash_primary', type: 'URL', url: 'redis://x', priority: 1 },
    { id: 'upstash_backup_1', type: 'URL', url: 'redis://y', priority: 2 },
  ]
  // primary 的 client 存在但真实命令报配额错（模拟烧穿库）
  m.clients.set('upstash_primary', makeClient({
    getImpl: async () => { throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500003') },
  }))
  const healthy = makeClient()
  m.clients.set('upstash_backup_1', healthy)

  const got = await m.getAvailableClient()
  assert.equal(got, healthy, '应跳过烧穿的 primary')
  assert.equal(notified, 0, '选实例期绝不能触发重建回调（会双建队列）')
  assert.equal(m.quotaExhaustedSet.has('upstash_primary'), true, '但必须记录熔断（让后续调用继续跳过它）')
})
