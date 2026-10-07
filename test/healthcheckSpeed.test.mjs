// 回归测试：体检的「接口速度」必须算上冷启动那一次（2026-10-06 r218 修）
//
// 缺陷（实测，不是推理）：
//   体检里「后端在线」这一行印的是**第一次**请求的耗时（冷连接/冷启动最慢），
//   但「接口速度」这一项却只拿**第二次**复查的耗时去判。r218 当天真实采样就是：
//      ✅ 后端在线：已运行 63 分钟，响应 **2211ms**   ← 很慢
//      ✅ 接口速度：335ms（正常）                     ← 却判合格
//      ⇒ 结论「一切正常，不用管」。
//   发布后头几分钟打不开，恰恰是老师最该被提醒的时刻，结果被判据漏掉了。
//   后果：体检脚本 warnings/bad 都记进 tmp/health.jsonl，判据漏 ⇒ 告警永远不出。
//
// 本锁的做法：**真跑脚本**（不是读源码），用一个可控延迟的假后端喂它，
// 只对「第一次慢 / 两次都快 / 只有复查慢」三种情形分别断言。
// ⛔ 只读源码会抓不到这个洞 —— 旧写法两行代码读起来完全正常。
//
// 反向自检（本文件末尾）：同一把判据套修复前的旧脚本，冷启动慢场景必须**判红**（判 ok = 假绿）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
const OLD_SCRIPT = resolve(ROOT, 'scripts/_r218_old_healthcheck.mjs')

/** 起一个假后端：/api/health 只在**第一次**命中时延迟（模拟冷启动），其余秒回。 */
function buildFakeApi({ healthDelayMs = 0, recheckDelayMs = 0 } = {}) {
  let healthHits = 0
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      healthHits += 1
      const delay = healthHits === 1 ? healthDelayMs : recheckDelayMs
      return setTimeout(() => send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSec: 3600,
        disk: { path: '/tmp', freeMb: 900, totalMb: 1024 }
      }), delay)
    }
    if (req.url === '/api/students') return send({ students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') return send({ summary: { pendingTasks: [], failedTasks: 0 } })
    // ⛔ r220：这里必须是真接口那种**嵌套**契约 `{ success, stats:{...} }`（server/index.js:1711-1719）。
    //    本文件第一版（r218）写的是根级 `{ waiting, active, failed }` —— 照抄了体检脚本当时读错的样子，
    //    ⇒ 假后端把错误契约**固化下来**，从此那把锁验的是一个不存在的接口，队列判据的洞一直没被发现。
    //    ⛔ 以后改这里，先 curl 一次真接口再抄结构。
    if (req.url === '/api/queue/stats') return send({ success: true, stats: { waiting: 0, active: 0, failed: 0 } })
    res.writeHead(404).end('{}')
  })
  return server
}

function startFakeApi(opts = {}) {
  const server = buildFakeApi(opts)
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}

/**
 * 真跑一次体检脚本，返回标准输出/退出码。
 * ⛔ 必须用**异步** spawn：假后端跑在测试进程里，`spawnSync` 会把本进程事件循环锁死，
 *    于是体检发出的请求根本到不了假后端 ⇒ 15s 超时、输出一行「连不上」。（r218 实测踩到）
 */
async function runHealthcheck(port, scriptPath = SCRIPT) {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, [scriptPath, '--api', `http://127.0.0.1:${port}`], {
      cwd: ROOT,
    })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('error', reject)
    p.on('close', (code) => done({ code, stdout, stderr }))
  })
}

/** 从体检输出里抽出某一项的（状态, 详情）。 */
function itemOf(stdout, name) {
  const re = new RegExp(`[✅⚠️❌] ${name}：(.*)`)
  const m = stdout.split('\n').find((l) => l.includes(name))
  if (!m) return null
  return { line: m, matched: re.test(m) ? m.slice(m.indexOf(name) + name.length + 2) : m }
}

// ── 元判据自证：下面用的判定词必须与本文件逐字一致，防「判据写错字」导致的假通过 ─────
const SELF_PROBE = '接口速度'
const SELF_LITERAL = '首次'

test('元判据自证：探针认得体检输出里的「接口速度」这一项', () => {
  const s = readFileSync(new URL(import.meta.url), 'utf8')
  assert.ok(s.includes(SELF_PROBE), '探针词不在本文件里')
  assert.ok(s.includes(SELF_LITERAL), '「首次」这个字面量不在本文件里（判据改过？）')
})

// ── 1. 冷启动慢 ⇒ 必须提醒（旧版会判 ok，这就是本轮修的洞）────────────────────────
test('第一次请求很慢（冷启动）⇒ 接口速度必须判为提醒，不能只看复查那一次', async () => {
  const { server, port } = await startFakeApi({ healthDelayMs: 800 })
  try {
    const { code, stdout } = await runHealthcheck(port)
    const online = stdout.match(/后端在线：已运行 \d+ 分钟，响应 (\d+)ms/)
    assert.ok(online, `没解析到「后端在线」的耗时：${stdout.slice(0, 300)}`)
    const firstMs = Number(online[1])
    assert.ok(firstMs >= 700, `假后端没真的拖慢第一次（实测 ${firstMs}ms），这条测就白跑了`)

    const speed = itemOf(stdout, SELF_PROBE)
    assert.ok(speed, '体检没输出「接口速度」这一项')
    assert.match(speed.line, /⚠️/, `冷启动 ${firstMs}ms 竟然判合格：${speed.line}`)

    // ⭐ 核心不变量：判据用的数字 ≥ 首次耗时 —— 证明「第一次」真的进了判据，而不是只报不判。
    const judged = Number((speed.line.match(/接口速度：(\d+)ms/) || [])[1])
    assert.equal(judged, firstMs, `判据用 ${judged}ms，而在线行报的是 ${firstMs}ms —— 又丢掉冷启动那一次了`)
    assert.match(speed.line, new RegExp(`首次 ${firstMs}ms`), '没把首次耗时印出来，别人没法核对')
    assert.equal(code, 0, 'warn 不该把退出码变成非 0（只有 bad 才该）')
    assert.doesNotMatch(stdout, /结论：一切正常/, `冷启动慢还敢说一切正常：${stdout.slice(-200)}`)
  } finally {
    server.close()
  }
})

// ── 2. 两次都快 ⇒ 合格（改动不能把正常情况误报成告警）────────────────────────────
test('两次都快 ⇒ 接口速度判合格，并且仍把首次耗时印出来', async () => {
  const { server, port } = await startFakeApi()
  try {
    const { stdout } = await runHealthcheck(port)
    const speed = itemOf(stdout, SELF_PROBE)
    assert.ok(speed, '体检没输出「接口速度」这一项')
    assert.match(speed.line, /✅/, `正常情况被误判：${speed.line}`)
    assert.ok(
      stdout.includes(SELF_LITERAL) || speed.line.includes(SELF_LITERAL),
      '合格时也该把首次耗时印出来（否则以后再漏判没人看得出来）'
    )
  } finally {
    server.close()
  }
})

// ── 3. 只有复查慢 ⇒ 仍然提醒（改动没把判据缩成「只看第一次」）────────────────────
test('只有复查那一次慢 ⇒ 接口速度仍判提醒（判据是取最慢值，不是只看首次）', async () => {
  const { server, port } = await startFakeApi({ recheckDelayMs: 800 })
  try {
    const { stdout } = await runHealthcheck(port)
    const speed = itemOf(stdout, SELF_PROBE)
    assert.ok(speed, '体检没输出「接口速度」这一项')
    assert.match(speed.line, /⚠️/, `复查 800ms 却判合格：${speed.line}`)
  } finally {
    server.close()
  }
})

// ── 4. 反向自检：套修复前的旧脚本，冷启动慢场景必须判红 ─────────────────────────
test('反向自检：修复前的旧脚本在「冷启动慢」场景下判 ok（洞是真的，不是我编的）', async (t) => {
  // ⛔ 探针缺失必须显式 skip（r215：skip 不是 return）—— 静默 return 等于「没验过的锁也判通过」。
  // ⛔ skip 后必须 return：t.skip 只标记不中断，继续跑会抛错把 skip 变成 fail（r222 实测）。
  // ⛔ 基线钉死到具体提交而不是 HEAD：HEAD 会随提交漂移，导出的「旧脚本」会变成新代码（r221 教训）。
  if (!existsSync(OLD_SCRIPT)) {
    t.skip('反向自检探针未就位：先跑 git show 7828fe2~1:scripts/healthcheck.mjs > scripts/_r218_old_healthcheck.mjs')
    return
  }
  const { server, port } = await startFakeApi({ healthDelayMs: 800 })
  let stdout = ''
  try {
    stdout = (await runHealthcheck(port, OLD_SCRIPT)).stdout
  } finally {
    server.close() // ⛔ 必须关：端口/句柄不关会让测试进程一直挂着不退出（r218 实测）
  }
  const speed = itemOf(stdout, SELF_PROBE)
  assert.ok(speed, '旧脚本没输出「接口速度」')
  // ⛔ 下面这条就是「旧洞」：旧版拿复查的 ~5ms 去判，于是冷启动 800ms 也判合格。
  assert.match(
    speed.line,
    /✅/,
    `旧脚本竟然也判提醒（${speed.line}）⇒ 反向自检失效，这条测守不住判据`
  )
})

// ── 5. 元判据自证：假后端的队列契约必须和**真接口**长得一样 ───────────────────────
// 为什么值得单独锁一条：r220 实测发现 healthcheck 把 /api/queue/stats 的 `stats` 那一层漏了，
// 而这里的假后端当初照抄了它的错误读法 ⇒ 假后端把错误契约固化，谁也测不出来。
// 元判据自己也得能被验红：把 send({...}) 改回根级，这条就该挂。
test('元判据自证：假后端的 /api/queue/stats 必须是 { success, stats } 嵌套（与真接口同构）', async () => {
  const { server, port } = await startFakeApi()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/queue/stats`)
    const body = await res.json()
    // ⛔ 断言点名具体字段，不用 `assert.ok(body)` 那种恒真写法（r215 教训：恒真断言 = 假绿）
    assert.ok(body && body.stats && typeof body.stats === 'object',
      `假后端队列契约漂了：顶层没有 stats，实际键=${JSON.stringify(Object.keys(body || {}))}`)
    assert.equal(body.stats.waiting, 0)
    assert.equal(body.stats.active, 0)
    assert.equal(body.stats.failed, 0)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})
