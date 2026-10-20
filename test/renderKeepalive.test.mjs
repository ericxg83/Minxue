// 回归锁（2026-10-20 r319）：本地看门狗给 Render 保活必须「只在高峰、5 分钟一次、绝不阻塞」。
//
// 为什么锁：保活是双刃剑 —— 7×24 打会把 Render 免费时长白烧、并掩盖冷启动问题；
// 打得太密会让 /api/health 成为新的噪声源；打得太稀（>15 分钟）等于没打。
// 窗口口径复用 server/lib/peakWindows.mjs（周一~周五 15:00–21:30 北京时间）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWindows, DEFAULT_PEAK_WINDOWS_SPEC } from '../server/lib/peakWindows.mjs'
import { createRenderKeepalive, shouldPingRender, PING_EVERY_MS } from '../scripts/dev/renderKeepalive.mjs'

const WINDOWS = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
const PEAK_18 = new Date('2026-10-20T10:00:00Z') // 周二 18:00 北京时间
const OFFPEAK_23 = new Date('2026-10-20T15:00:00Z') // 周二 23:00 北京时间
const flush = () => new Promise(r => setTimeout(r, 0))

test('① 窗口判据：高峰打、窗口外不打', () => {
  assert.equal(shouldPingRender({ now: PEAK_18, windows: WINDOWS }), true)
  assert.equal(shouldPingRender({ now: OFFPEAK_23, windows: WINDOWS }), false)
})

test('② 5 分钟节流：刚打过不再打，过了 5 分钟才打', () => {
  const t0 = PEAK_18.getTime()
  assert.equal(shouldPingRender({ now: new Date(t0), windows: WINDOWS, lastPingAt: t0 - 1000 }), false, '1s 前刚打过')
  assert.equal(shouldPingRender({ now: new Date(t0), windows: WINDOWS, lastPingAt: t0 - PING_EVERY_MS }), true, '满 5 分钟')
  assert.equal(PING_EVERY_MS, 5 * 60_000, '间隔必须 < 15 分钟（Render 休眠阈值）且不浪费请求')
})

test('③ 窗口外 maybePing 一个请求都不发', async () => {
  let calls = 0
  const k = createRenderKeepalive({
    windows: WINDOWS,
    fetchImpl: async () => { calls++; return { json: async () => ({ bootAt: 'b1', uptimeSec: 1 }) } }
  })
  assert.equal(k.maybePing(OFFPEAK_23), false)
  await flush()
  assert.equal(calls, 0)
})

test('④ 高峰内打一次，随后节流不再打', async () => {
  let calls = 0
  const k = createRenderKeepalive({
    windows: WINDOWS,
    fetchImpl: async () => { calls++; return { json: async () => ({ bootAt: 'b1', uptimeSec: 30 }) } }
  })
  assert.equal(k.maybePing(PEAK_18), true)
  await flush()
  assert.equal(calls, 1)

  const soon = new Date(PEAK_18.getTime() + 60_000)
  assert.equal(k.maybePing(soon), false, '1 分钟后不该再打')
  await flush()
  assert.equal(calls, 1)

  const later = new Date(PEAK_18.getTime() + PING_EVERY_MS + 1)
  assert.equal(k.maybePing(later), true, '满 5 分钟必须再打（否则实例会睡）')
})

test('⑤ 单飞：上一发没回来时不叠加请求', async () => {
  let calls = 0
  let release
  const k = createRenderKeepalive({
    windows: WINDOWS,
    fetchImpl: () => { calls++; return new Promise((res) => { release = () => res({ json: async () => ({ bootAt: 'b1' }) }) }) }
  })
  assert.equal(k.maybePing(PEAK_18), true)
  const later = new Date(PEAK_18.getTime() + PING_EVERY_MS + 1)
  assert.equal(k.maybePing(later), false, 'in-flight 期间不得再发')
  release()
  await flush()
  assert.equal(calls, 1)
})

test('⑥ 只在「bootAt 变了」时记冷启动日志（保活失效的唯一实证）', async () => {
  const lines = []
  let boot = 'b1'
  const k = createRenderKeepalive({
    windows: WINDOWS,
    log: async (l) => { lines.push(l) },
    fetchImpl: async () => ({ json: async () => ({ bootAt: boot, uptimeSec: 10 }) })
  })

  k.maybePing(PEAK_18); await flush()
  assert.equal(lines.length, 0, '首次只建立基线，不刷日志')

  k.maybePing(new Date(PEAK_18.getTime() + PING_EVERY_MS + 1)); await flush()
  assert.equal(lines.length, 0, 'bootAt 未变 ⇒ 实例一直醒着，无需噪声')

  boot = 'b2'
  k.maybePing(new Date(PEAK_18.getTime() + PING_EVERY_MS * 2 + 2)); await flush()
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('冷启动'), '必须明确报出冷启动，便于事后确认保活断过')
})

test('⑦ 请求失败只记一行，不影响下一轮', async () => {
  const lines = []
  const k = createRenderKeepalive({
    windows: WINDOWS,
    log: async (l) => { lines.push(l) },
    fetchImpl: async () => { throw new Error('boom') }
  })
  k.maybePing(PEAK_18); await flush()
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('保活失败'))
  assert.equal(k.inFlight, false, '失败后必须解除 in-flight，否则永久停摆')
})

test('⑧ enabled=false 时整体关闭（env RENDER_KEEPALIVE=off）', async () => {
  let calls = 0
  const k = createRenderKeepalive({
    windows: WINDOWS,
    enabled: false,
    fetchImpl: async () => { calls++; return { json: async () => ({}) } }
  })
  assert.equal(k.maybePing(PEAK_18), false)
  await flush()
  assert.equal(calls, 0)
})
