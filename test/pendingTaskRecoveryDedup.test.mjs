// 锁死 pendingTaskRecovery 几何兜底扫描的「防重复入队」三要素（2026-09-21 事故沉淀）：
// 当晚队列 260 个 geometry job 里 243 个是重复（兜底扫描入队后无任何标记，资产停在
// pending 期间每 5 分钟重复 add 一轮）。修复后必须同时满足：
//   1) 超时判据用 updated_at（入队成功会刷新），不是 created_at（永不变化 → 每轮都命中）；
//   2) 入队前必须查重（getJobs 收集 waiting/delayed/active 的 assetId）；
//   3) 入队成功后必须 SET updated_at = NOW() 开启 30 分钟静默窗。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'pendingTaskRecovery.js'), 'utf8')

test('兜底扫描的超时判据必须基于 updated_at（入队会刷新），不得回退到 created_at', () => {
  const scanBody = src.slice(src.indexOf('async scanGeometryAssets'), src.indexOf('async scanOverdueGeometry'))
  assert.match(scanBody, /updated_at < NOW\(\) - INTERVAL '30 minutes'/, '超时判据必须是 updated_at')
  assert.doesNotMatch(scanBody, /created_at < NOW\(\) - INTERVAL '30 minutes'/, 'created_at 判据会无限重复入队（2026-09-21 事故）')
})

test('兜底扫描入队前必须按 assetId 查重（web/worker 双进程都跑 recovery）', () => {
  const scanBody = src.slice(src.indexOf('async scanGeometryAssets'), src.indexOf('async scanOverdueGeometry'))
  assert.match(scanBody, /alreadyQueued/, '必须有已入队集合')
  assert.match(scanBody, /alreadyQueued\.has\(asset\.id\)/, 'add 前必须跳过已在队列的资产')
  for (const st of ['waiting', 'delayed', 'active']) {
    assert.match(scanBody, new RegExp(`'${st}'`), `查重必须覆盖 ${st} 状态`)
  }
})

test('入队成功后必须刷新 updated_at 开启 30 分钟静默窗', () => {
  const scanBody = src.slice(src.indexOf('async scanGeometryAssets'), src.indexOf('async scanOverdueGeometry'))
  assert.match(scanBody, /SET updated_at = NOW\(\)/, '入队/跳过后必须刷新 updated_at')
})

test('24h watchdog 入队前同样必须查重', () => {
  const watchdog = src.slice(src.indexOf('async scanOverdueGeometry'))
  assert.match(watchdog, /alreadyQueued/, 'watchdog 必须查重')
  assert.match(watchdog, /alreadyQueued\.has\(a\.id\)/, 'watchdog add 前必须跳过已在队列的资产')
})
