// 回归锁（2026-10-19，负责人批准的「修熔断卡死」）：锁 RedisManager 熔断自愈回探行为。
//
// 背景：markQuotaExhausted 一旦标记实例，旧代码只等每月 1 号 resetQuotaExhausted 解除，
// 健康检查只 ping 未熔断实例、绝不回探 ⇒ Upstash 免费额度月中恢复时（2026-10-19 实测
// backup_1 曾上午被熔断、2.5h 后实际恢复）实例也无法归队，队列带病停摆到月底。
//
// 反向自检说明：旧版 redisManager 无 probeMarkedInstances/probeInstance/startBreakerProbe
// 方法 ⇒ 本文件用例会直接 TypeError 判红；旧版也无 healthTickMs/shouldRunHealthCheck
//（旧心跳 = REDIS_HEALTH_CHECK_MS 固定间隔全天均匀，2026-10-19 14:24 负责人指令改为高峰分化）。
// 非空锁。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RedisManager } from '../server/redisManager.js'

// 独立实例不碰单例：pool/quotaExhaustedSet/回调均手工构造，探针一律打桩，绝不真连 Redis。

test('熔断自愈：回探成功 ⇒ 解除该实例熔断并触发 onQuotaRecovered', async () => {
  const m = new RedisManager()
  m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://fake-primary', priority: 1 }]
  m.quotaExhaustedSet.add('upstash_primary')

  let probeCalls = 0
  m.probeInstance = async (item) => {
    probeCalls++
    assert.equal(item.id, 'upstash_primary')
    return true // 真实数据命令通过 = 额度已恢复
  }
  const recoveredIds = []
  m.onQuotaRecovered = (id) => recoveredIds.push(id)

  const out = await m.probeMarkedInstances()

  assert.equal(out, 'upstash_primary', '应返回本轮被解除熔断的实例 id')
  assert.equal(probeCalls, 1)
  assert.equal(m.quotaExhaustedSet.has('upstash_primary'), false, '熔断标记应已解除')
  assert.deepEqual(recoveredIds, ['upstash_primary'], 'onQuotaRecovered 应被触发一次')
})

test('反向自检：回探失败（仍在超额）⇒ 熔断保持、回调不触发', async () => {
  const m = new RedisManager()
  m.pool = [{ id: 'upstash_backup_1', type: 'URL', url: 'redis://fake-backup', priority: 2 }]
  m.quotaExhaustedSet.add('upstash_backup_1')

  m.probeInstance = async () => false // 仍在超额
  let recovered = 0
  m.onQuotaRecovered = () => recovered++

  const out = await m.probeMarkedInstances()

  assert.equal(out, null)
  assert.equal(m.quotaExhaustedSet.has('upstash_backup_1'), true, '仍在超额 ⇒ 熔断必须保持')
  assert.equal(recovered, 0, '未恢复 ⇒ 不得触发 onQuotaRecovered')
})

test('轮转回探：多实例被熔断时按池顺序每轮探一个（不并发全探）', async () => {
  const m = new RedisManager()
  m.pool = [
    { id: 'a', type: 'URL', url: 'redis://fake-a', priority: 1 },
    { id: 'b', type: 'URL', url: 'redis://fake-b', priority: 2 }
  ]
  m.quotaExhaustedSet.add('a')
  m.quotaExhaustedSet.add('b')

  const order = []
  m.probeInstance = async (item) => {
    order.push(item.id)
    return false
  }

  await m.probeMarkedInstances()
  await m.probeMarkedInstances()
  await m.probeMarkedInstances()

  assert.deepEqual(order, ['a', 'b', 'a'], '三轮回探应按 a→b→a 轮转')
})

test('无被熔断实例时回探为空操作', async () => {
  const m = new RedisManager()
  m.pool = [{ id: 'x', type: 'URL', url: 'redis://fake-x', priority: 1 }]
  let probeCalls = 0
  m.probeInstance = async () => {
    probeCalls++
    return true
  }
  const out = await m.probeMarkedInstances()
  assert.equal(out, null)
  assert.equal(probeCalls, 0, '没有熔断实例 ⇒ 不应发出任何探针命令')
})

test('心跳高峰分化：默认 tick 60s + 低峰 30min；env 可覆盖；门控=高峰必查/低峰抽检', () => {
  const savedPeak = process.env.REDIS_HEALTH_CHECK_PEAK_MS
  const savedOff = process.env.REDIS_HEALTH_CHECK_MS
  const savedWin = process.env.REDIS_PEAK_WINDOWS
  delete process.env.REDIS_HEALTH_CHECK_PEAK_MS
  delete process.env.REDIS_HEALTH_CHECK_MS
  delete process.env.REDIS_PEAK_WINDOWS
  try {
    const m1 = new RedisManager()
    assert.equal(m1.healthTickMs, 60000, '默认 tick = 高峰间隔 60s（2026-10-19 14:24 负责人指令：高峰密集）')
    assert.equal(m1.healthOffPeakIntervalMs, 1800000, '默认低峰间隔 30 分钟（低峰基本不烧额度）')
    assert.equal(m1.breakerProbeIntervalMs, 900000, '回探默认 15 分钟')
    assert.equal(typeof m1.shouldRunHealthCheck, 'function', '门控方法必须存在（旧版无 ⇒ 反向判红）')

    // 门控行为：默认窗 1-5 15:00-21:30（北京时间）
    const peakNow = new Date(2026, 9, 19, 18, 0)   // 周一 18:00 绝对峰值段
    const offNow = new Date(2026, 9, 19, 3, 0)     // 周一凌晨
    assert.equal(m1.shouldRunHealthCheck(peakNow, 1), true, '高峰：任何 tick 都必须检查')
    assert.equal(m1.shouldRunHealthCheck(peakNow, 7), true, '高峰：与 tick 计数无关')
    assert.equal(m1.shouldRunHealthCheck(offNow, 1), false, '低峰第 1 tick：不到抽检间隔 ⇒ 跳过（旧版固定间隔恒查，此处判红区分）')
    assert.equal(m1.shouldRunHealthCheck(offNow, 30), true, '低峰第 30 tick = 30 分钟到点 ⇒ 抽检一次')

    process.env.REDIS_HEALTH_CHECK_PEAK_MS = '30000'
    process.env.REDIS_HEALTH_CHECK_MS = '600000'
    const m2 = new RedisManager()
    assert.equal(m2.healthTickMs, 30000, 'REDIS_HEALTH_CHECK_PEAK_MS 覆盖 tick（高峰间隔）')
    assert.equal(m2.healthOffPeakIntervalMs, 600000, 'REDIS_HEALTH_CHECK_MS 现语义 = 低峰间隔')
    assert.equal(m2.shouldRunHealthCheck(offNow, 20), true, '低峰 600s / tick 30s ⇒ 每 20 tick 抽检')

    process.env.REDIS_PEAK_WINDOWS = '0,6 09:00-12:00'
    const m3 = new RedisManager()
    assert.equal(m3.shouldRunHealthCheck(peakNow, 1), false, '周一 18:00 不在自定义窗口 ⇒ 走低峰节奏')
  } finally {
    if (savedPeak === undefined) delete process.env.REDIS_HEALTH_CHECK_PEAK_MS
    else process.env.REDIS_HEALTH_CHECK_PEAK_MS = savedPeak
    if (savedOff === undefined) delete process.env.REDIS_HEALTH_CHECK_MS
    else process.env.REDIS_HEALTH_CHECK_MS = savedOff
    if (savedWin === undefined) delete process.env.REDIS_PEAK_WINDOWS
    else process.env.REDIS_PEAK_WINDOWS = savedWin
  }
})

test('结构性锚点：自愈方法族必须存在（旧版无此方法族，本文件整体判红）', () => {
  const m = new RedisManager()
  assert.equal(typeof m.probeMarkedInstances, 'function')
  assert.equal(typeof m.probeInstance, 'function')
  assert.equal(typeof m.startBreakerProbe, 'function')
  assert.equal(typeof m.stopBreakerProbe, 'function')
})
