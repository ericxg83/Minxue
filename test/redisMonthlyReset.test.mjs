// 回归锁（2026-10-20 r320）：月初额度重置必须让三个库重新可用。
//
// 背景：负责人 2026-10-20 指出「三个库都是月初清零，11 月 1 日应该能合计用 150 万」。
// 代码侧要保证两件事，否则重置了也用不上：
//   ① 每月 1 号（00:01 定时器 + 冷启动兜底）必须解除熔断；
//   ② 解除后必须**回写磁盘**——否则本月的熔断标记还留在文件里，
//      1 号当天再冷启动一次就被读回来，白跳过一个刚恢复的健康库。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RedisManager } from '../server/redisManager.js'

function withStateFile(fn) {
  const tmp = path.join(os.tmpdir(), `minxue-r320-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  const saved = process.env.REDIS_QUOTA_STATE_FILE
  process.env.REDIS_QUOTA_STATE_FILE = tmp
  try {
    return fn(tmp)
  } finally {
    if (saved === undefined) delete process.env.REDIS_QUOTA_STATE_FILE
    else process.env.REDIS_QUOTA_STATE_FILE = saved
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

test('① 11 月 1 日：熔断全部解除、回写磁盘、退避清空', () => {
  withStateFile(() => {
    const m = new RedisManager()
    m.pool = [
      { id: 'upstash_primary', type: 'URL', url: 'redis://a', priority: 1 },
      { id: 'upstash_backup_1', type: 'URL', url: 'redis://b', priority: 2 },
    ]
    m.quotaExhaustedSet.add('upstash_primary')
    m.quotaExhaustedSet.add('upstash_backup_1')
    m.recordConnectFailure('upstash_primary')
    m.persistQuotaExhausted()

    m.ensureResetAfterMonthlyBoundary(new Date('2026-11-01T00:05:00+08:00'))

    assert.equal(m.quotaExhaustedSet.size, 0, '1 号必须解除所有熔断（否则 3 个库合起来也用不上）')
    assert.equal(m.isInConnectBackoff('upstash_primary'), false, '退避必须一并清空')

    const saved = JSON.parse(fs.readFileSync(process.env.REDIS_QUOTA_STATE_FILE, 'utf8'))
    assert.deepEqual(saved.ids, [], '磁盘上的本月标记必须一起清掉（否则 1 号再冷启动又读回来）')
  })
})

test('② 非 1 号：熔断保持粘性，不得解除', () => {
  withStateFile(() => {
    const m = new RedisManager()
    m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://a', priority: 1 }]
    m.quotaExhaustedSet.add('upstash_primary')

    m.ensureResetAfterMonthlyBoundary(new Date('2026-11-02T10:00:00+08:00'))
    assert.equal(m.quotaExhaustedSet.has('upstash_primary'), true, '月中绝不能解除（会退回带病选库）')
  })
})

test('③ 同月幂等：1 号多次冷启动只清一次', () => {
  withStateFile(() => {
    const m = new RedisManager()
    m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://a', priority: 1 }]
    m.quotaExhaustedSet.add('upstash_primary')

    const nov1 = new Date('2026-11-01T00:05:00+08:00')
    m.ensureResetAfterMonthlyBoundary(nov1)
    m.quotaExhaustedSet.add('upstash_primary') // 模拟 1 号当天又踩到一个烧穿的库
    m.ensureResetAfterMonthlyBoundary(nov1)
    assert.equal(m.quotaExhaustedSet.has('upstash_primary'), true, '同月第二次不得再清（否则月初反复清标记＝反复重撞死库）')
  })
})

test('④ 定时器路径：resetQuotaExhausted() 必须同时落盘', () => {
  withStateFile(() => {
    const m = new RedisManager()
    m.pool = [{ id: 'upstash_primary', type: 'URL', url: 'redis://a', priority: 1 }]
    m.quotaExhaustedSet.add('upstash_primary')
    m.persistQuotaExhausted()

    m.resetQuotaExhausted()
    assert.equal(m.quotaExhaustedSet.size, 0)
    const saved = JSON.parse(fs.readFileSync(process.env.REDIS_QUOTA_STATE_FILE, 'utf8'))
    assert.deepEqual(saved.ids, [], '00:01 定时器解除后必须回写，否则冷启动会误恢复')
  })
})
