// 回归锁（2026-10-19 负责人指示）：看门狗探测节奏改为「高峰快探 / 低峰稀疏 / 拉起后加速确认」。
//
// 旧版行为 = 固定 15s setInterval（scripts/dev/keep_local_services.mjs，从未入库 ⇒ 无法 git show 反查，
// 按纪律用「内联合成旧策略」做反向自检：旧固定节奏在低峰也返回 15s，与新策略结果可区分，
// 若有人把节奏改回常数，本文件的低峰断言必然判红）。
// 结构锁读取 keep_local_services.mjs 源码文本，锁住「确实接上了新节奏函数、拆掉了固定 setInterval」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DEFAULT_OFFPEAK_INTERVAL_MS,
  DEFAULT_PEAK_INTERVAL_MS,
  DEFAULT_PEAK_WINDOWS_SPEC,
  isPeak,
  parseWindows,
  pickIntervalMs,
} from '../scripts/dev/watchdogCadence.mjs'

const WD_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dev', 'keep_local_services.mjs'),
  'utf8'
)

test('parseWindows：默认规格解析正确，1-5 展开为周一~周五', () => {
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  assert.ok(Array.isArray(w) && w.length === 1)
  assert.deepEqual([...w[0].days].sort(), [1, 2, 3, 4, 5])
  assert.equal(w[0].startMin, 15 * 60)
  assert.equal(w[0].endMin, 21 * 60 + 30)
})

test('parseWindows：多窗口与非法输入', () => {
  const w = parseWindows('1-5 15:00-21:30;0,6 09:00-12:00')
  assert.ok(Array.isArray(w) && w.length === 2)
  assert.deepEqual([...w[1].days].sort(), [0, 6])
  // 全部非法形态必须返回 null（不得抛异常）
  for (const bad of ['', '   ', '1-5', '1-5 25:00-26:00', '1-5 21:30-15:00', '9 15:00-21:30', '1-5 abc']) {
    assert.equal(parseWindows(bad), null, `非法规格应返回 null: ${JSON.stringify(bad)}`)
  }
  assert.equal(parseWindows(undefined), null)
})

test('isPeak：边界判定（结束分钟开区间；周末默认非高峰）', () => {
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  // 2026-10-19 是周一；用本地时间构造，机器时区即北京
  assert.equal(isPeak(new Date(2026, 9, 19, 16, 0), w), true, '周一 16:00 → 高峰')
  assert.equal(isPeak(new Date(2026, 9, 19, 15, 0), w), true, '周一 15:00 整 → 高峰')
  assert.equal(isPeak(new Date(2026, 9, 19, 14, 59), w), false, '周一 14:59 → 低峰')
  assert.equal(isPeak(new Date(2026, 9, 19, 21, 29), w), true, '周一 21:29 → 高峰')
  assert.equal(isPeak(new Date(2026, 9, 19, 21, 30), w), false, '周一 21:30 整 → 低峰（结束开区间）')
  assert.equal(isPeak(new Date(2026, 9, 24, 18, 0), w), false, '周六 18:00 → 默认非高峰')
  assert.equal(isPeak(new Date(2026, 9, 25, 18, 0), w), false, '周日 18:00 → 默认非高峰')
  assert.equal(isPeak(new Date(2026, 9, 20, 3, 0), w), false, '周二凌晨 → 低峰')
})

test('pickIntervalMs：高峰 15s / 低峰 600s / 拉起加速期覆盖低峰', () => {
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  const peakNow = new Date(2026, 9, 19, 18, 0) // 周一 18:00（绝对峰值段）
  const offPeakNow = new Date(2026, 9, 19, 3, 0) // 周一 03:00
  assert.equal(
    pickIntervalMs({ now: peakNow, windows: w, peakMs: DEFAULT_PEAK_INTERVAL_MS, offPeakMs: DEFAULT_OFFPEAK_INTERVAL_MS }),
    15_000,
    '高峰 → 15s'
  )
  assert.equal(
    pickIntervalMs({ now: offPeakNow, windows: w, peakMs: DEFAULT_PEAK_INTERVAL_MS, offPeakMs: DEFAULT_OFFPEAK_INTERVAL_MS }),
    600_000,
    '低峰 → 600s'
  )
  assert.equal(
    pickIntervalMs({
      now: offPeakNow,
      windows: w,
      peakMs: DEFAULT_PEAK_INTERVAL_MS,
      offPeakMs: DEFAULT_OFFPEAK_INTERVAL_MS,
      accelerateUntil: offPeakNow.getTime() + 60_000,
    }),
    15_000,
    '低峰但刚拉起（加速期内）→ 15s 快速确认恢复'
  )
  assert.equal(
    pickIntervalMs({
      now: offPeakNow,
      windows: w,
      peakMs: DEFAULT_PEAK_INTERVAL_MS,
      offPeakMs: DEFAULT_OFFPEAK_INTERVAL_MS,
      accelerateUntil: offPeakNow.getTime() - 60_000,
    }),
    600_000,
    '加速期已过 → 回落低峰节奏'
  )
})

test('pickIntervalMs：服务未全健康（pendingRecovery）时低峰也快探 —— 2026-10-28 冷启动白等 10 分钟修复', () => {
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  const offPeakNow = new Date(2026, 9, 19, 3, 0)
  assert.equal(
    pickIntervalMs({ now: offPeakNow, windows: w, peakMs: 15_000, offPeakMs: 600_000, pendingRecovery: true }),
    15_000,
    '低峰但服务未全健康 → 15s 快探（600s 稀疏只适用于「两端都在跑」的稳态）'
  )
  assert.equal(
    pickIntervalMs({ now: offPeakNow, windows: w, peakMs: 15_000, offPeakMs: 600_000, pendingRecovery: false }),
    600_000,
    '低峰且全健康 → 保持 600s（不得回退成常数 15s）'
  )
  // 加速期优先级高于 pendingRecovery（二者都给 15s，只验证不互相踩）
  assert.equal(
    pickIntervalMs({
      now: offPeakNow,
      windows: w,
      peakMs: 15_000,
      offPeakMs: 600_000,
      accelerateUntil: offPeakNow.getTime() + 60_000,
      pendingRecovery: false,
    }),
    15_000,
    '加速期内仍 → 15s（原有行为不回归）'
  )
})

test('反向自检：旧固定节奏（合成样本）在低峰与新策略结果可区分 ⇒ 回退常数 15s 必判红', () => {
  const oldPolicyFixed15s = () => 15_000 // 旧版：固定 15s，不看时间
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  const offPeakNow = new Date(2026, 9, 19, 3, 0)
  assert.equal(oldPolicyFixed15s(), 15_000)
  assert.equal(
    pickIntervalMs({ now: offPeakNow, windows: w, peakMs: 15_000, offPeakMs: 600_000 }),
    600_000,
    '同一低峰时刻：新策略 600s ≠ 旧策略 15s ⇒ 若有人回退成常数 15s，本断言判红'
  )
})

test('时区无关性：isPeak 按「UTC 毫秒 + 固定偏移」判定（Render 是 UTC 机器，不得依赖本机钟面）', () => {
  const w = parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)
  // 用绝对时刻构造（ISO 带 Z），任何时区机器上结果一致：
  assert.equal(isPeak(new Date('2026-10-19T08:30:00Z'), w), true, 'UTC 08:30 = 北京周一 16:30 → 高峰')
  assert.equal(isPeak(new Date('2026-10-19T02:00:00Z'), w), false, 'UTC 02:00 = 北京周一 10:00 → 低峰')
  // 跨日：UTC 周日 19:00 = 北京周一 03:00 → 按北京钟面判为低峰（不得因 UTC 钟面落周日而误判）
  assert.equal(isPeak(new Date('2026-10-18T19:00:00Z'), w), false, 'UTC 周日 19:00 = 北京周一 03:00 → 低峰')
  assert.equal(isPeak(new Date('2026-10-23T13:29:00Z'), w), true, 'UTC 13:29 = 北京周五 21:29 → 高峰')
  assert.equal(isPeak(new Date('2026-10-23T13:30:00Z'), w), false, 'UTC 13:30 = 北京周五 21:30 整 → 低峰（开区间）')
})

test('结构锁：keep_local_services.mjs 已接入动态节奏并拆除固定 setInterval', () => {
  assert.ok(WD_SRC.includes('pickIntervalMs('), '主循环必须调用 pickIntervalMs')
  assert.ok(WD_SRC.includes('isPeak(now, PEAK_WINDOWS)'), '主循环必须用 isPeak 判高峰')
  assert.ok(WD_SRC.includes('accelerateUntil = Date.now()'), '拉起后必须设置加速确认期')
  assert.ok(WD_SRC.includes('WATCHDOG_PEAK_WINDOWS'), '必须支持窗口 env 覆盖')
  assert.ok(WD_SRC.includes('parseWindows(process.env.WATCHDOG_PEAK_WINDOWS) ?? parseWindows(DEFAULT_PEAK_WINDOWS_SPEC)'), 'env 非法时必须回退默认窗口')
  assert.ok(!/setInterval\(tick,\s*INTERVAL_MS\)/.test(WD_SRC), '旧版固定 setInterval(tick, INTERVAL_MS) 必须已拆除')
})

test('结构锁（2026-10-28 冷启动体验修复）：直开工作台 + 未全健康快探 + 自启跳首跳冷却', () => {
  assert.ok(
    WD_SRC.includes("const OPEN_URL = 'http://127.0.0.1:3000/workbench'"),
    '浏览器必须直开 PC 工作台 /workbench（dev 中间件 serve workbench.html），不得落移动端首页'
  )
  assert.ok(WD_SRC.includes('pendingRecovery: !allHealthy'), 'tick 必须把「未全健康」传给 pickIntervalMs（低峰冷启动不得睡 600s）')
  assert.ok(WD_SRC.includes('MINXUE_AUTOSTART'), '必须识别自启链 env（首跳端口空闲立即拉起，不等 90s 冷却）')
  assert.ok(WD_SRC.includes('initialSpawnedAt()'), '自启链的初始 spawnedAt 必须前移一个冷却期')
})
