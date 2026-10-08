#!/usr/bin/env node
/**
 * 敏学系统一键体检（只读，不改任何东西）
 *
 * 用途：负责人不想读日志、不想翻数据库时，跑一条命令就知道"系统现在还好吗"。
 * 所有输出用大白话，红色标注的才是需要处理的。
 *
 * 用法：
 *   node scripts/healthcheck.mjs                     # 查本机后端 4000
 *   node scripts/healthcheck.mjs --api https://xxx   # 改查生产
 *   node scripts/healthcheck.mjs --json              # 机器可读（给别的程序用）
 *   node scripts/healthcheck.mjs --log tmp/health.jsonl   # 追加一行采样，用于事后分析
 *
 * 设计约束（勿破坏）：
 *   1) **全程只读**：只发 GET、只跑 SELECT，不写库、不入队、不改配置。
 *   2) 不打印任何密钥、密码、连接串。
 *   3) 某一项失败不能中断整体体检——每项各自 try/catch，坏的显示"查不了"而不是崩。
 */

import path from 'node:path'

import { resolveDiskState } from './healthDiskState.mjs'

const argv = process.argv.slice(2)
const JSON_ONLY = argv.includes('--json')
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const API = argOf('--api', 'http://127.0.0.1:4000').replace(/\/+$/, '')
// --log <文件>：把本次结果追加成一行 JSON，用于**持续采样**。
// 2026-10-04 教训：单次观测不足以支撑因果结论（曾把一次部署重启误判成实例休眠），
// 判断"到底什么时候慢"必须靠一段时间的连续数据。
const LOG = argOf('--log', '')
const isProd = !API.includes('127.0.0.1') && !API.includes('localhost')

const C = { ok: '✅', warn: '⚠️ ', bad: '❌', info: 'ℹ️ ' }
const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  if (!JSON_ONLY) console.log(`${status === 'ok' ? C.ok : status === 'warn' ? C.warn : C.bad} ${name}：${detail}`)
}

// ── 1. 后端在不在 ────────────────────────────────────────────────────────
let health = null
try {
  const t0 = Date.now()
  const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(15000) })
  const j = await r.json()
  health = { ...j, rt: Date.now() - t0 }
  const up = typeof health.uptimeSec === 'number' ? Math.round(health.uptimeSec / 60) : null
  record('后端在线', 'ok', `已运行 ${up === null ? '?' : up} 分钟，响应 ${health.rt}ms`)
} catch (e) {
  record('后端在线', 'bad', `连不上（${e.message}）。本地跑 ${API} 启动；线上请看 Render 后台日志`)
}

// ── 2. 响应速度（本地/内网正常 <0.3s；国内访问美国服务器约 0.7~1.3s，属正常）──
if (health) {
  try {
    const t0 = Date.now()
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(20000) })
    const recheckMs = Date.now() - t0
    // ⛔ 2026-10-06 r218 实测抓到的漏判：**第一次**调用（含冷连接/冷启动）最慢，
    // 旧版只拿第二次的耗时去判 —— 结果同一行体检里「后端在线」报 2211ms（很慢），
    // 「接口速度」却用复查的 335ms 判 ok，结论照旧「一切正常」。
    // 冷启动慢是老师最该知道的（发布后头几分钟打不开），却被判据漏掉。
    // ⇒ 判据取两次里**最慢的一次**，并把两个数字都印出来，别让人猜。
    const firstMs = health.rt
    const ms = Math.max(firstMs, recheckMs)
    const limit = isProd ? 2000 : 500
    record('接口速度', ms <= limit ? 'ok' : 'warn',
      `${ms}ms${ms > limit ? `（超过 ${limit}ms，${isProd ? '多为网络往返，可稍后再试或让服务器换到离国内更近的机房' : '本地偏慢，查连接池'}）` : '（正常）'}` +
      `｜首次 ${firstMs}ms${recheckMs === firstMs ? '' : ` / 复查 ${recheckMs}ms`}`)
  } catch (e) {
    record('接口速度', 'warn', `测不了：${e.message}`)
  }
}

// ── 3. 数据能不能读到（读得到 = 数据库正常）──────────────────────────────
let students = null
if (health) {
  try {
    const t0 = Date.now()
    const r = await fetch(`${API}/api/students`, { signal: AbortSignal.timeout(20000) })
    const j = await r.json()
    students = j.students || []
    record('数据库可读', students.length ? 'ok' : 'warn',
      `读到 ${students.length} 名学生，用时 ${Date.now() - t0}ms`)
  } catch (e) {
    record('数据库可读', 'bad', `读不到：${e.message}`)
  }
}

// ── 4. 有没有卡住/失败的任务（这才是老师真正关心的）─────────────────────
if (health) {
  try {
    const r = await fetch(`${API}/api/tasks/summary`, { signal: AbortSignal.timeout(20000) })
    const s = (await r.json()).summary || {}
    const stuck = (s.pendingTasks || []).length
    const failed = s.failedTasks || 0
    if (failed > 0) {
      record('批改失败任务', 'bad', `${failed} 份作业批改失败，需在 App 里点重试`)
    } else if (stuck > 0) {
      record('批改失败任务', 'warn', `${stuck} 份作业卡在处理中，等一会儿再看；持续卡住就重启后端`)
    } else {
      record('批改失败任务', 'ok', '没有失败也没有卡住的任务')
    }
  } catch (e) {
    record('批改失败任务', 'warn', `查不了：${e.message}`)
  }
}

// ── 5. 队列积压（偶尔堆积正常，持续堆积要管）─────────────────────────────
if (health) {
  try {
    const r = await fetch(`${API}/api/queue/stats`, { signal: AbortSignal.timeout(20000) })
    // ⛔ 2026-10-07 r220 实测抓到的漏判（与 r218「接口速度」、r198「磁盘」同一枚雷：
    //   判据取不到字段 ⇒ **永远合格**，而这类告警一次都不会出现在 tmp/health.jsonl 里）。
    //   真接口 `GET /api/queue/stats` 返回的是 **{ success, stats:{ waiting,active,failed,... } }**
    //   （server/index.js:1711-1719），旧代码直接读根级 q.waiting ⇒ undefined || 0 ⇒ 恒 0。
    //   实测取证：生产真值 stats.failed=50、stats.waiting=0，体检却印「历史上失败 0 个」；
    //   等待数刚好是 0 才蒙对，**真积压时（>20）照样报「排队 0 个」然后判合格** ——
    //   恰好漏在最该被叫醒的时刻。
    const queueBody = await r.json()
    const q = queueBody.stats || queueBody || {}
    const w = q.waiting || 0
    const a = q.active || 0
    const f = q.failed || 0
    // ⚠️ failed 只印不判：本机实测 historical failed=~50，一旦加判就天天黄灯，
    //    会重演 r198「恒定黄灯淹掉真告警」。要看趋势看绝对值，靠人工看这行数字即可。
    // ⚠️ 至于 available：Redis 掉线时 waiting/active 可能还是 0，那就等于没盯，必须单独叫醒。
    if (q.available === false) record('任务队列', 'warn', '队列服务连不上（多半是 Redis 掉了）：作业堆在进程里进不了队列，这张表会一直显示 0，建议重启后端')
    else if (w > 20) record('任务队列', 'warn', `排队 ${w} 个（积压偏多，可能是 AI 额度紧张导致重试堆积）`)
    else record('任务队列', 'ok', `排队 ${w} 个、进行中 ${a} 个、历史上失败 ${f} 个（失败数会定期清理，看趋势不看绝对值）`)
  } catch (e) {
    record('任务队列', 'warn', `查不了：${e.message}`)
  }
}

// ── 6. 服务器磁盘会不会满（图片存服务器上，这是最容易忽略的坑）───────────
// r198：/api/health 会回 disk（实测剩余 MB），所以**真能报出数字就不该再挂着「读不到」的黄灯**——
// 恒定亮着的黄灯会把「批改失败 / 队列积压」这些真告警一起淹掉。判据收敛到 healthDiskState.mjs。
if (health) {
  const diskState = resolveDiskState(health.disk)
  record('服务器磁盘', diskState.status, diskState.detail)
}

// ── 追加采样日志（一行一条，便于事后按时间窗口分析）────────────────────
if (LOG) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    api: API,
    upMin: health && typeof health.uptimeSec === 'number' ? Math.round(health.uptimeSec / 60) : null,
    rtMs: health ? health.rt : null,
    bad: results.filter((r) => r.status === 'bad').map((r) => r.name),
    warn: results.filter((r) => r.status === 'warn').map((r) => r.name),
  })
  try {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(path.dirname(LOG), { recursive: true })
    appendFileSync(LOG, line + '\n', 'utf8')
    if (!JSON_ONLY) console.log(`\n${C.info} 已记到 ${LOG}`)
  } catch (e) {
    console.error(`${C.warn} 写日志失败（不影响体检结果）：${e.message}`)
  }
}

if (JSON_ONLY) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), api: API, results }, null, 2))
} else {
  const bad = results.filter((r) => r.status === 'bad').length
  const warn = results.filter((r) => r.status === 'warn').length
  console.log('\n' + '─'.repeat(56))
  if (bad === 0 && warn === 0) console.log('结论：一切正常，不用管。')
  else if (bad === 0) console.log(`结论：没有致命问题，但有 ${warn} 项想提醒你（黄色）。`)
  else console.log(`结论：${bad} 项需要处理（红色），建议先看红色那几条。`)
  console.log('─'.repeat(56))
}
process.exitCode = results.some((r) => r.status === 'bad') ? 1 : 0
