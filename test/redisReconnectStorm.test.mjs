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

// ─────────────────────────────────────────────────────────────────────────────
// r318（2026-10-20）：连接失败退避 + 失败连接必须断开。
//
// 病因（实测复现，server/_diag_leakproof.mjs）：
//   createClient 失败只 return null，从不 disconnect 那个 ioredis 客户端；
//   它却按 retryStrategy 在后台继续重试 ⇒ 每失败一次就多一个「幽灵重连源」。
//   叠加「每个健康检查 tick 都重连一次死库（高峰 60s/次、永不停止）」
//   ⇒ 重连次数随运行时长线性增长，直到进程重启（Render sleep）才归零，然后重来。
//   本地复现：3 次失败调用 ⇒ 后台重连事件 2→5→10，7 秒后累计 32 次。
// ─────────────────────────────────────────────────────────────────────────────

test('④ 连接失败必须指数退避：首退 15s，梯度翻倍，上限 15 分钟', () => {
  const m = new RedisManager()
  assert.equal(typeof m.recordConnectFailure, 'function', 'recordConnectFailure 必须存在（旧版无 ⇒ 判红）')

  const delays = []
  for (let i = 0; i < 8; i++) {
    m.recordConnectFailure('upstash_primary')
    const st = m._connectBackoff.get('upstash_primary')
    delays.push(Math.round((st.nextAt - Date.now()) / 1000))
  }
  assert.equal(delays[0], 15, '首次退避 15s（不能一上来就 15 分钟：一次网络抖动要能快速回来）')
  assert.equal(delays[1], 30)
  assert.equal(delays[2], 60)
  assert.equal(delays[6], 900, '第 7 次起封顶 900s')
  assert.equal(delays[7], 900, '上限后不再增长（否则等于永久拉黑）')
  assert.equal(m._connectBackoff.get('upstash_primary').failures, 8, '连续失败次数必须累计')
})

test('④ 退避窗口内 isInConnectBackoff=true，过期后=false', () => {
  const m = new RedisManager()
  m.recordConnectFailure('upstash_primary')
  assert.equal(m.isInConnectBackoff('upstash_primary'), true, '刚失败必须处于退避窗口')
  assert.equal(m.isInConnectBackoff('upstash_backup_2'), false, '没失败过的实例不该被冷落')

  // 把窗口推到过去：模拟退避到期
  const st = m._connectBackoff.get('upstash_primary')
  st.nextAt = Date.now() - 1
  assert.equal(m.isInConnectBackoff('upstash_primary'), false, '退避到期必须允许重试')
})

test('④ 退避中的实例在选池时被跳过，且完全不发起连接', async () => {
  const m = new RedisManager()
  m.pool = [
    { id: 'upstash_primary', type: 'URL', url: 'redis://dead', priority: 1 },
    { id: 'upstash_backup_1', type: 'URL', url: 'redis://live', priority: 2 },
  ]
  m.recordConnectFailure('upstash_primary') // 主库连不上，进入退避

  let reconnectAttempts = 0
  m.createClient = async () => { reconnectAttempts++; return null }

  const healthy = makeClient()
  m.clients.set('upstash_backup_1', healthy)

  const got = await m.getAvailableClient()
  assert.equal(got, healthy, '应选中健康 backup')
  assert.equal(reconnectAttempts, 0, '退避中的实例绝不能再被重连（旧行为：每个 tick 撞一次 = 疯狂重连）')
})

test('④ 熔断解除同时清空退避（自愈回探成功后要能立刻归队）', () => {
  const m = new RedisManager()
  m.recordConnectFailure('upstash_primary')
  assert.equal(m.isInConnectBackoff('upstash_primary'), true)

  m.resetQuotaExhausted('upstash_primary')
  assert.equal(m.isInConnectBackoff('upstash_primary'), false, '解除熔断必须同时解除退避')
})

test('④ 结构性锚点：createClient 失败分支必须 disconnect + 设置连接超时/keepAlive', () => {
  // 反向自检用：R318_TARGET_SRC 指向旧版文件时，本用例必须判红（否则是空锁）。
  const target = process.env.R318_TARGET_SRC || '../server/redisManager.js'
  const src = fs.readFileSync(new URL(target, import.meta.url), 'utf8')
  const start = src.indexOf('async createClient(')
  assert.ok(start > 0, '必须能找到 createClient')
  const body = src.slice(start, src.indexOf('\n  async probeWithTimeout', start))
  assert.ok(body.includes('client?.disconnect()'), '失败连接必须断开（否则 ioredis 后台无限重试＝幽灵重连源）')
  assert.ok(body.includes('connectTimeout'), '必须设置连接超时（否则死库把冷启动拖住几十秒）')
  assert.ok(body.includes('keepAlive'), '必须开 TCP keepAlive（高峰保活，负责人 2026-10-20 要求）')
  assert.ok(body.includes('recordConnectFailure'), '失败必须记入退避表（否则每个 tick 重撞死库）')
})
