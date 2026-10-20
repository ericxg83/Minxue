// 回归锁（2026-10-20 r319）：Render 保活只在「高峰窗口」内打点。
//
// 背景（负责人 2026-10-20 指示）：
//   「如果这个疯狂重连是有目的的（倘若是之前我要求的），那你可以在我使用的高峰期间
//     让他保持不要断。」
// ⇒ 保活从「7×24 无脑打」改成「高峰窗口内打 + 窗口外一个请求都不发」。
//   窗口口径必须复用 server/lib/peakWindows.mjs（铁律：同一件事只准一个实现），
//   默认 `1-5 15:00-21:30`（北京时间，来自生产 tasks.created_at 60 天分布实测）。
//
// ⚠️ 为什么窗口外必须真的不发请求：Render 免费层的「睡觉」是被动的（15 分钟无入站）。
//   若保活 7×24 打，实例永不睡 ⇒ Render 时长白烧、冷启动风暴被掩盖成常态；
//   若只在高峰打，睡觉变成我们主动选的策略，窗口外 0 成本。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { shouldPingNow, runScheduled, PREWARM_MIN, PEAK_WINDOWS } from '../workers/keepalive/src/index.js'

// 北京时间 = UTC+8；2026-10-20 是周二（下面直接写 UTC 时刻，注释里标北京时间）

test('① 高峰窗口内（周二 15:00–21:30 北京时间）必须保活', () => {
  assert.equal(shouldPingNow(new Date('2026-10-20T07:00:00Z')), true, '15:00 整 = 高峰起点')
  assert.equal(shouldPingNow(new Date('2026-10-20T10:00:00Z')), true, '18:00 = 绝对峰值')
  assert.equal(shouldPingNow(new Date('2026-10-20T13:29:00Z')), true, '21:29 仍在窗口内')
})

test('② 窗口开始前 10 分钟预热，提前量之外的窗口外一律不打', () => {
  assert.equal(PREWARM_MIN, 10)
  assert.equal(shouldPingNow(new Date('2026-10-20T06:50:00Z')), true, '14:50 预热（15:00 一到就是热的）')
  assert.equal(shouldPingNow(new Date('2026-10-20T06:45:00Z')), false, '14:45 还没到预热线')
  assert.equal(shouldPingNow(new Date('2026-10-20T13:35:00Z')), false, '21:35 已散场，让实例睡')
})

test('③ 非高峰日（周六/周日）默认不保活', () => {
  // 2026-10-24 周六 16:00 北京时间 = 08:00Z
  assert.equal(shouldPingNow(new Date('2026-10-24T08:00:00Z')), false)
  // 2026-10-25 周日 16:00 北京时间
  assert.equal(shouldPingNow(new Date('2026-10-25T08:00:00Z')), false)
})

test('④ 时区无关：判据只看绝对时刻，不看机器时区', () => {
  const same = new Date('2026-10-20T07:00:00Z')
  assert.equal(shouldPingNow(same, PEAK_WINDOWS, 480), true, '+8 偏移下是 15:00')
  assert.equal(shouldPingNow(same, PEAK_WINDOWS, 0), false, '按 UTC 钟面算是 07:00，不在窗口内')
})

test('⑤ 窗口外 runScheduled 必须一个请求都不发', async () => {
  let calls = 0
  const res = await runScheduled({
    now: new Date('2026-10-20T15:00:00Z'), // 23:00 北京时间
    fetchImpl: async () => { calls++; return new Response('{}', { status: 200 }) }
  })
  assert.equal(calls, 0, '窗口外绝不能打 Render（否则等于 7×24 保活，白烧时长）')
  assert.equal(res.skipped, true)
  assert.equal(res.reason, 'off-peak')
})

test('⑥ 窗口内 runScheduled 打一次并回显实例状态', async () => {
  let calls = 0
  const res = await runScheduled({
    now: new Date('2026-10-20T10:00:00Z'), // 18:00 北京时间
    fetchImpl: async () => {
      calls++
      return new Response(JSON.stringify({ status: 'ok', bootAt: 'x', uptimeSec: 12 }), { status: 200 })
    }
  })
  assert.equal(calls, 1)
  assert.equal(res.ok, true)
  assert.equal(res.instance.uptimeSec, 12, '必须回显 uptimeSec 便于确认实例是否一直醒着')
})

test('⑦ 结构性锚点：窗口判定必须复用 peakWindows，不得在 Worker 里另写一份', () => {
  const src = fs.readFileSync(new URL('../workers/keepalive/src/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from '../../../server/lib/peakWindows.mjs'"), '必须 import 共享实现')
  assert.ok(src.includes('isPeak('), '必须用共享 isPeak 判定')
  // 另写一份的典型痕迹：自己算 getUTCDay / getUTCHours
  assert.ok(!src.includes('getUTCDay'), '不得在 Worker 里重实现星期计算')
  assert.ok(!src.includes('getUTCHours'), '不得在 Worker 里重实现小时计算')
})

test('⑧ peakWindows 必须能在 Worker 运行时求值（无 process 全局）', () => {
  // Workers 运行时没有 `process`，模块顶层裸访问 process.env 会在求值阶段抛
  // ReferenceError ⇒ cron 静默全失效。这里锁源码写法（Node 侧无法真的删掉 process 再 import）。
  const src = fs.readFileSync(new URL('../server/lib/peakWindows.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes("typeof process === 'undefined'"), 'DEFAULT_TZ_OFFSET_MIN 必须用 typeof process 守卫')
})
