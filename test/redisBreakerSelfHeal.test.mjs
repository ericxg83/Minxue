// 回归锁（2026-10-19，负责人批准的「修熔断卡死」）：锁 RedisManager 熔断自愈回探行为。
//
// 背景：markQuotaExhausted 一旦标记实例，旧代码只等每月 1 号 resetQuotaExhausted 解除，
// 健康检查只 ping 未熔断实例、绝不回探 ⇒ Upstash 免费额度月中恢复时（2026-10-19 实测
// backup_1 曾上午被熔断、2.5h 后实际恢复）实例也无法归队，队列带病停摆到月底。
//
// 反向自检说明：旧版 redisManager 无 probeMarkedInstances/probeInstance/startBreakerProbe
// 方法 ⇒ 本文件用例会直接 TypeError 判红；healthCheckIntervalMs 旧版硬编码 60000 ⇒
// 断言默认 300000 的用例同样判红。非空锁。
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

test('降频配置：心跳默认 300s（旧版 60s）+ 环境变量可覆盖；回探默认 15min', () => {
  const saved = process.env.REDIS_HEALTH_CHECK_MS
  delete process.env.REDIS_HEALTH_CHECK_MS
  try {
    const m1 = new RedisManager()
    assert.equal(m1.healthCheckIntervalMs, 300000, '默认心跳必须降为 300s（降 Upstash 烧速）')
    assert.equal(m1.breakerProbeIntervalMs, 900000, '回探默认 15 分钟')

    process.env.REDIS_HEALTH_CHECK_MS = '123456'
    const m2 = new RedisManager()
    assert.equal(m2.healthCheckIntervalMs, 123456, 'REDIS_HEALTH_CHECK_MS 应可覆盖默认值')
    assert.equal(m2.breakerProbeIntervalMs, 900000, '未设 REDIS_BREAKER_PROBE_MS 时回探仍为默认')
  } finally {
    if (saved === undefined) delete process.env.REDIS_HEALTH_CHECK_MS
    else process.env.REDIS_HEALTH_CHECK_MS = saved
  }
})

test('结构性锚点：自愈方法族必须存在（旧版无此方法族，本文件整体判红）', () => {
  const m = new RedisManager()
  assert.equal(typeof m.probeMarkedInstances, 'function')
  assert.equal(typeof m.probeInstance, 'function')
  assert.equal(typeof m.startBreakerProbe, 'function')
  assert.equal(typeof m.stopBreakerProbe, 'function')
})
