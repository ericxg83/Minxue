/**
 * 配额哨兵回归测试（2026-09-30，与模块同批入库）。
 * 覆盖：初始态、记录、同供应商 since 不刷新、TTL 惰性过期、显式清除、磁盘持久化。
 * 通过 QUOTA_SENTINEL_STATE_FILE 把状态文件隔离到临时目录，不污染 server/ 工作区。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-sentinel-'))
process.env.QUOTA_SENTINEL_STATE_FILE = path.join(tmpDir, 'state.json')

const { recordDegraded, clearDegraded, snapshot } = await import('../server/services/quotaSentinel.js')

test('初始状态：无降级事件 → ok=true', () => {
  const snap = snapshot()
  assert.equal(snap.ok, true)
  assert.deepEqual(snap.degraded, [])
})

test('recordDegraded → ok=false，事件字段完整', () => {
  const snap = recordDegraded('Neon', { kind: 'quota', detail: 'code=53000 exceeded' })
  assert.equal(snap.ok, false)
  assert.equal(snap.degraded.length, 1)
  assert.equal(snap.degraded[0].supplier, 'neon') // 供应商名归一化为小写
  assert.equal(snap.degraded[0].kind, 'quota')
  assert.match(snap.degraded[0].detail, /53000/)
  assert.equal(typeof snap.degraded[0].minutes, 'number')
})

test('同一供应商重复记录 → 保留最初 since，不刷新计时', () => {
  const first = snapshot().degraded.find(e => e.supplier === 'neon')
  recordDegraded('neon', { detail: 'again' })
  const after = snapshot().degraded.find(e => e.supplier === 'neon')
  assert.equal(after.since, first.since, 'since 被刷新会导致横幅永远不消失')
})

test('超过 6 小时 TTL → 惰性过期，ok 自动恢复 true', () => {
  recordDegraded('modelscope', { kind: 'throttled', detail: '429' })
  assert.equal(snapshot().ok, false)
  const later = snapshot({ now: Date.now() + 7 * 60 * 60 * 1000 })
  assert.equal(later.ok, true, 'TTL 过期后应自动恢复')
})

test('clearDegraded → 立即恢复 ok=true', () => {
  recordDegraded('upstash_redis', {})
  assert.equal(snapshot().ok, false)
  const snap = clearDegraded('upstash_redis')
  assert.equal(snap.ok, true)
})

test('clearDegraded 对不存在的事件是零 IO no-op（它挂在 AI 成功高频路径上）', () => {
  const file = process.env.QUOTA_SENTINEL_STATE_FILE
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  clearDegraded('never-degraded-supplier')
  const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  assert.equal(after, before, '无事件时不得触发 persist 写盘')
})

test('状态持久化到磁盘（重启后横幅不丢的前提）', () => {
  recordDegraded('neon', { detail: 'persist-check' })
  const raw = JSON.parse(fs.readFileSync(process.env.QUOTA_SENTINEL_STATE_FILE, 'utf8'))
  assert.ok(raw.events.neon, '状态文件中应有 neon 事件')
  assert.match(raw.events.neon.detail, /persist-check/)
})
