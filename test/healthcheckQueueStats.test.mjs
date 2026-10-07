// 回归测试：体检的「任务队列」必须读到 /api/queue/stats 的嵌套 stats（2026-10-07 r220 修）
//
// 缺陷（实测，不是推理）：
//   真接口 `GET /api/queue/stats`（server/index.js:1711-1719）返回 **{ success, stats:{...} }**，
//   而体检脚本 read 的是根级 q.waiting / q.active / q.failed ⇒ undefined || 0 ⇒ 三个数恒为 0。
//   取证（生产）：真值 stats.failed=50、stats.waiting=0，体检却印「历史上失败 0 个」。
//   等待数恰好是 0 才蒙对 —— **一旦真积压（>20）或队列服务掉线，照样印 0 并判合格**。
//   后果与 r218「接口速度」、r198「磁盘」同源：healthcheck 的 bad/warn 会记进 tmp/health.jsonl，
//   ⇒ 判据取不到字段 = 这类告警一次都不会出（「假绿」家族再添一枚）。
//
// 本锁的做法：**真跑脚本**（假后端喂真实嵌套契约），对「真积压 / 平时数字 / 队列掉线」三种情形分别断言，
// 并留出反向自检位置（套修复前的旧脚本，同样的积压场景必须判红）。
// ⛔ 只读源码抓不到这个洞 —— 旧写法 `q.waiting` 读起来完全像正常代码。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * 反向自检探针（⛔ 不能 spawnSync 调 git，Windows 上EBUSY，r220 前的既有套路）：
 *   git show HEAD:scripts/healthcheck.mjs > scripts/_r220_old_healthcheck.mjs
 * 探针文件被 .gitignore 的 `_*` 排除 ⇒ 不进版本库，但本机留着就能一直验。
 * 探针没就位时本条 **skip 而不是 return 通过**（return 会把没验证的锁当成通过，r215 教训）；
 * skip 在测试输出里是明晃晃的一条，看得出「这次没验」。
 */

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
const OLD_SCRIPT = resolve(ROOT, 'scripts/_r220_old_healthcheck.mjs') // 由 shell 从 HEAD 导出，跑完即删

const ITEM = '任务队列'

/**
 * 起一个假后端。/api/queue/stats 的返回结构与**真接口保持一致**的根键 `stats`
 * （r220 教训：假后端照抄体检脚本的错误读法，会把错误契约固化下来，谁也测不出来）。
 */
function buildFakeApi({ queue = { waiting: 0, active: 0, failed: 0, available: true } } = {}) {
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      return send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSec: 3600,
        disk: { path: '/tmp', freeMb: 900, totalMb: 1024 }
      })
    }
    if (req.url === '/api/students') return send({ students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') return send({ summary: { pendingTasks: [], failedTasks: 0 } })
    if (req.url === '/api/queue/stats') return send({ success: true, stats: queue })
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
 * 真跑一次体检脚本。
 * ⛔ 必须用**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环，
 *    请求根本到不了假后端（r218 实测踩到，表现是 15s 超时 + 一行「连不上」）。
 */
function runHealthcheck(port, scriptPath = SCRIPT) {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, [scriptPath, '--api', `http://127.0.0.1:${port}`], { cwd: ROOT })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('error', reject)
    p.on('close', (code) => done({ code, stdout, stderr }))
  })
}

/** 抽某一项的（状态, 详情）。⛔ 状态符号后面跟的空格数不固定（✅ 一个、⚠️ 两个），两边都试。 */
function queueItem(stdout) {
  const line = stdout.split('\n')
    .find((l) => l.startsWith('✅ ' + ITEM) || l.startsWith('⚠️  ' + ITEM) || l.startsWith('❌ ' + ITEM))
  if (!line) return null
  const status = line.startsWith('✅') ? 'ok' : line.startsWith('⚠️') ? 'warn' : 'bad'
  return { status, line, detail: line.slice(line.indexOf('：') + 1) }
}

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成的假通过 ─────
const SELF_PROBE = '任务队列'
const SELF_LITERAL = '排队'

test('元判据自证：探针认得体检输出里的「任务队列」这一项', () => {
  // ⛔ 用常量**拼出**样例行，而不是写死一整行字面量：
  //    否则 SELF_PROBE/SELF_LITERAL 就成了没人用的死变量，这条锁退化成「声明了两个常量」的假自证。
  const s = queueItem(`✅ ${SELF_PROBE}：${SELF_LITERAL} 3 个`)
  assert.ok(s, `探针没认出「✅ ${SELF_PROBE}：」这行，判定词或状态符号改过？`)
  assert.equal(s.detail, `${SELF_LITERAL} 3 个`)
  // ⚠️ 状态符号后的空格数**两边都试**（✅ 一空格 / ⚠️ 两空格）—— r218 那把锁就是因为只匹配一空格，
  //    警告行差点整个提取不到。
  assert.equal(queueItem(`⚠️  ${SELF_PROBE}：${SELF_LITERAL} 9 个`).status, 'warn')
  assert.equal(queueItem(`❌ ${SELF_PROBE}：${SELF_LITERAL} 9 个`).status, 'bad')
})

// ── 1. 真积压 ⇒ 必须叫醒（旧版会印 0 个并判合格，这就是本轮修的洞）──────────────────
test('队列真的积压 30 个 ⇒ 「任务队列」必须判提醒，且数字得是 30 不是 0', async () => {
  const { server, port } = await startFakeApi({ queue: { waiting: 30, active: 2, failed: 0, available: true } })
  let item = null
  let code = null
  try {
    const run = await runHealthcheck(port)
    code = run.code
    item = queueItem(run.stdout)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
  assert.ok(item, '体检没输出「任务队列」这一项')
  assert.equal(item.status, 'warn', `积压 30 个却没提醒：${item.line}`)
  assert.match(item.detail, /排队 30 个/,
    `印的数字还是假的（${item.detail}）—— 判据依然读不到 stats 那一层`)
  assert.equal(code, 0, 'warn 不该把退出码变非 0（只有 bad 才该）')
})

// ── 2. 平时 ⇒ 合格，但数字必须是真值（旧版把 failed 印成 0，这条专抓它）────────────
test('平时队列空闲 ⇒ 判合格，并且「历史上失败」那条必须印真值而不是恒 0', async () => {
  const { server, port } = await startFakeApi({ queue: { waiting: 0, active: 0, failed: 7, available: true } })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = queueItem(stdout)
    assert.ok(item, `体检没输出「${ITEM}」这一项`)
    assert.equal(item.status, 'ok', `平时被测成告警：${item.line}`)
    assert.match(item.detail, /历史上失败 7 个/,
      `数字丢了（${item.detail}）—— 旧版因为读不到 stats 会印「历史上失败 0 个」`)
  } finally {
    server.close()
  }
})

// ── 3. 队列服务掉线（available=false）⇒ 必须叫醒 ─────────────────────────────────────
// 为什么单独一条：Redis 掉线时 waiting/active 也可能还是 0，只看数字等于没盯。
test('队列服务连不上（available=false）⇒ 必须判提醒，光看排队数会一直是 0', async () => {
  const { server, port } = await startFakeApi({ queue: { waiting: 0, active: 0, failed: 0, available: false } })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = queueItem(stdout)
    assert.ok(item, `体检没输出「${ITEM}」这一项`)
    assert.equal(item.status, 'warn', `队列服务掉线却没提醒：${item.line}`)
    assert.match(item.detail, /连不上/,
      `没说清为什么提醒（${item.detail}）—— 老师看不懂「available」这种词`)
  } finally {
    server.close()
  }
})

// ── 4. 反向自检：套修复前的旧脚本，同样的积压场景必须判红（洞是真的，不是我编的）───────
test('反向自检：修复前的旧脚本在「积压 30 个」场景下判合格且印 0 个（洞确实存在）', async (t) => {
  if (!existsSync(OLD_SCRIPT)) {
    t.skip(`反向自检探针未就位：先跑 git show HEAD:scripts/healthcheck.mjs > scripts/_r220_old_healthcheck.mjs`)
  }
  const { server, port } = await startFakeApi({ queue: { waiting: 30, active: 0, failed: 0, available: true } })
  let stdout = ''
  try {
    stdout = (await runHealthcheck(port, OLD_SCRIPT)).stdout
  } finally {
    server.close()
  }
  const item = queueItem(stdout)
  assert.ok(item, '旧脚本没输出「任务队列」')
  // ⛔ 下面这两条就是「旧洞」：读不到 stats ⇒ 印 0 个 ⇒ 还判合格。
  assert.match(item.detail, /排队 0 个/,
    `旧脚本竟然印出了 30 个（${item.detail}）⇒ 反向自检失效，这条测守不住判据`)
  assert.equal(item.status, 'ok', `旧脚本竟然也判提醒（${item.line}）⇒ 反向自检失效`)
})
