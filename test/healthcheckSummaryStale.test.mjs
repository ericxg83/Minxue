// 回归测试（r250）：体检不许把「数据库读不通时回吐的旧数字」当成现在的值报出来
//
// 缺陷（实测，不是推理）：`/api/tasks/summary` 在数据库读不通时会**降级把上一次成功读到的
//   缓存原样返回**，并在响应里打 `_stale`（`server/index.js:836`，那行注释原文就写着
//   「前端可据 _stale 提示用户数据可能延迟」）。但 2026-10-09 全仓实测：
//   `src/`、`server/`、`scripts/`、`test/` 里**没有任何一处读 `_stale`** ⇒
//   老师的铃铛数字、PC 工作台的待复核数、体检里这句「N 份作业已经批完了」，
//   全是上一次成功读到的旧数字，却被当成刚发生的事报。
//
//   为什么比 r221「字段没读到」更险：字段没回时至少一眼能看出「这一项没盯」；
//   而**旧值的样子跟真值一模一样**，任何只看数字的消费方都分不出来 ——
//   体检只报数不给出处，老师就会照着旧数字去点、去等、去判断。
//
// 本锁的做法（沿用 healthcheckUnreadTasks 那套）：**真跑脚本**（假后端按真接口契约出数），
//   逐条断言「说的是哪件事」；末尾用**修复前**的基线快照跑同一场景做**反向自检** ——
//   旧版同场景不许出现这句出处说明，证明这个洞是真的存在过，不是我编的。
// ⛔ 基线走 test/fixtures/ 随仓库入库（r242），不用「跑完即删」的探针 —— 那会让自检一直 skip，
//   而 skip 会被当成"验过"（r215 教训）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stageBaselineScript } from './baselineScriptKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
const BASELINE = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-beforer250.mjs')

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成假通过 ──────
// ⛔ 常量必须真的被下面用上 —— 声明了不用的常量会把这条锁退化成「声明了两个变量」（r220 踩过）
const PROBE_ITEM = '批改失败任务'
const STALE_WORD = '数据库刚才读不通'
const STALE_OLD_WORD = '旧数字'
const STALE_NO_TIME_WORD = '接口没说是什么时候存的'
const FRESH_MUST_NOT_SAY = STALE_WORD
const FRESH_MUST_SAY = '已经批完了'
const STALE_AT_AGE_TEXT = '7 分钟前'
const STALE_AT_FIELD = '_staleAt'

// ── 元判据 2（服务端侧）：降级分支必须**同时**给 `_stale` 和 `_staleAt` ──────────────────
// ⛔ 只给「这是旧的」不给「旧了多久」，跟 r245-①（灯亮了却不记触发值）同款 —— 听的人没法判断
//    该不该信。这条源码锁就是防止哪天有人把 `_staleAt` 顺手删掉，让服务端退回「只说旧」。
const STALE_FLAG_LITERAL = '_stale:'
const STALE_AT_LITERAL = '_staleAt'

function serverSource() {
  return readFileSync(resolve(ROOT, 'server', 'index.js'), 'utf8')
}

/**
 * 取 `/api/tasks/summary` 那个「降级返回旧缓存」的响应区间。
 * ⛔ 别用「全文找两个字面量再比距离」：两处注释里本来就有 `_stale` / `_staleAt` 这几个字，
 *    那样测出来的是「注释在不在」，不是「降级响应给没给」（本轮第一版就栽在这，判出假绿）。
 *    ⇒ 直接定位到那个 if 块，只看它自己那一段。
 */
function degradedBranchSource() {
  const src = serverSource()
  const start = src.indexOf('if (summaryCache.data)')
  assert.ok(start > 0, 'server/index.js 里找不到 /api/tasks/summary 的降级分支 ⇒ 这条自证是空转')
  return src.slice(start, start + 700)
}

// ── 假后端 ─────────────────────────────────────────────────────────────────
/** 一份「干净」的 summary（契约抄自真接口 `server/index.js:713-824`）。 */
function fakeSummary({ unread = 0, failed = 0 } = {}) {
  return {
    pendingReview: unread,
    pendingReviewPapers: unread,
    failedTasks: failed,
    todayNewWrongQuestions: 0,
    totalNotifications: unread + failed,
    inProgressCount: 0,
    pendingTasks: []
  }
}

/** 假后端：契约与真接口同构（r220 教训：假后端照抄错误读法会把错误契约固化）。 */
function buildFakeApi(summary, { stale = false, staleAt = null, omitStaleAt = false } = {}) {
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      return send({
        status: 'ok',
        uptimeSec: 3600,
        commit: 'abcdef1',
        bootAt: new Date().toISOString(),
        cjkFont: 'ok',
        disk: { path: 'C:/tmp', freeMb: 900, totalMb: 1024 }
      })
    }
    if (req.url === '/api/students') return send({ success: true, students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') {
      const body = { success: true, summary }
      if (stale) {
        body._stale = true
        if (!omitStaleAt) body[STALE_AT_FIELD] = staleAt
      }
      return send(body)
    }
    if (req.url === '/api/queue/stats') {
      return send({ success: true, stats: { waiting: 0, active: 0, failed: 0, available: true } })
    }
    res.writeHead(404).end('{}')
  })
  return server
}

function startFakeApi(summary, opts) {
  const server = buildFakeApi(summary, opts)
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}

/**
 * 真跑一次体检脚本。
 * ⛔ 必须**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环，
 *    请求根本到不了假后端（r218 实测踩到，表现是超时 + 一行「连不上」）。
 */
function runHealthcheck(port, scriptPath = SCRIPT) {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, [scriptPath, '--api', `http://127.0.0.1:${port}`], { cwd: ROOT })
    let stdout = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stdout += d })
    p.on('error', reject)
    p.on('close', () => done(stdout))
  })
}

/** 抽「批改失败任务」那一行的（状态, 详情）。状态符号后面的空格数不固定（✅ 一个 / ⚠️ 两个）。 */
function itemOf(stdout) {
  const line = (stdout || '').split('\n')
    .find((l) => l.startsWith('✅ ' + PROBE_ITEM) || l.startsWith('⚠️  ' + PROBE_ITEM) || l.startsWith('❌ ' + PROBE_ITEM))
  if (!line) return null
  return {
    status: line.startsWith('✅') ? 'ok' : line.startsWith('⚠️') ? 'warn' : 'bad',
    line,
    detail: line.slice(line.indexOf('：') + 1)
  }
}

const STALE_AT_ISO = () => new Date(Date.now() - 7 * 60000).toISOString()

// ── 元判据自证 ─────────────────────────────────────────────────────────────
test('源码自证：/api/tasks/summary 的降级分支同时给出「是旧数据」和「旧于何时」两个信号', () => {
  const branch = degradedBranchSource()
  assert.ok(branch.includes(STALE_FLAG_LITERAL), `降级分支里没有 ${STALE_FLAG_LITERAL} —— 旧数据标记没了`)
  assert.ok(branch.includes(STALE_AT_LITERAL),
    `降级分支只有「${STALE_FLAG_LITERAL}」、没有 ${STALE_AT_LITERAL} —— ` +
    `只说「这是旧的」不说旧了多久，跟 r245-①（灯亮了却不记触发值）同一毛病`)
})

test('元判据自证：探针认得体检输出里的「批改失败任务」这一项和那三种状态', () => {
  assert.ok(itemOf(`✅ ${PROBE_ITEM}：x`), '探针没认出「✅ 批改失败任务：」')
  assert.equal(itemOf(`⚠️  ${PROBE_ITEM}：x`).status, 'warn')
  assert.equal(itemOf(`❌ ${PROBE_ITEM}：x`).status, 'bad')
  assert.ok(itemOf(`✅ ${PROBE_ITEM}：${FRESH_MUST_SAY}`).detail.includes(FRESH_MUST_SAY))
})

// ── 1. 数据是新的 ⇒ 不许平白无故提「数据库读不通」──────────────────────────
test('数据是刚读的 ⇒ 照旧报数，不许凭空多一句「数据库读不通」', async () => {
  const { server, port } = await startFakeApi(fakeSummary({ unread: 2 }))
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    // ⛔ 方向别写反：新鲜数据这条要的是「不许出现」，跟反向自检那条「旧版必须出现」是反的
    //    （r239 同款：把方向写反会让自检自己变成假绿）。
    assert.doesNotMatch(item.detail, new RegExp(FRESH_MUST_NOT_SAY),
      `数据是新的却报「${FRESH_MUST_NOT_SAY}」（${item.detail}）—— 会变成天天瞎亮的灯（r198）`)
    assert.match(item.detail, /2 份作业已经批完了/, `份数没照旧报出来（${item.detail}）`)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})

// ── 2. 主场景：降级返回的旧数字 ⇒ 必须说清「这是旧数字、旧了多久」，并降级成要看一眼 ──
test('数据库读不通、接口回吐旧数字 ⇒ 必须说清「这是旧数字、旧于何时」，并降级成要看一眼', async () => {
  const { server, port } = await startFakeApi(fakeSummary({ unread: 2 }), { stale: true, staleAt: STALE_AT_ISO() })
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'warn', `旧数字没被标成要看一眼（${item.line}）—— 看着跟真值一模一样，最容易被当真`)
    assert.match(item.detail, new RegExp(STALE_WORD),
      `接口明说数据是旧的，体检却照旧当新的报（${item.detail}）—— 这正是全仓零消费方那个洞`)
    assert.match(item.detail, new RegExp(STALE_OLD_WORD), `没说清这是「${STALE_OLD_WORD}」（${item.detail}）`)
    assert.match(item.detail, new RegExp(STALE_AT_AGE_TEXT),
      `只说「旧数字」没说旧了多久（${item.detail}）—— 听的人没法判断该不该信（r245-①）`)
    // 但同时**不许把数字藏起来**：只说旧、不给数，等于这一项白报
    assert.match(item.detail, /2 份作业已经批完了/, `把旧数字也一起藏了（${item.detail}）—— 那就等于没盯`)
  } finally {
    server.close()
  }
})

// ── 3. 只给 `_stale`、不给时刻 ⇒ 得照实说「接口没说什么时候存的」，不许生吞 ──
test('接口只打「旧」却不给存于何时 ⇒ 照实说读不出来，不许含糊带过', async () => {
  const { server, port } = await startFakeApi(fakeSummary({ unread: 0 }), { stale: true, omitStaleAt: true })
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'warn', '只看不打时刻也算旧数据，同样得标成要看一眼')
    assert.match(item.detail, new RegExp(STALE_WORD), `没点明数据是旧的（${item.detail}）`)
    assert.match(item.detail, new RegExp(STALE_NO_TIME_WORD),
      `接口没给存于何时，却没照实说（${item.detail}）—— 猜一个时间等于编数据`)
  } finally {
    server.close()
  }
})

// ── 4. 旧数字里真有批改失败 ⇒ 仍是红色，不被降级成黄灯 ──────────────────────
test('旧数字里带着批改失败 ⇒ 仍须判红（只是补一句它是旧数据），不许把致命的降级成要看看', async () => {
  const { server, port } = await startFakeApi(fakeSummary({ failed: 3 }), { stale: true, staleAt: STALE_AT_ISO() })
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'bad', `真有 3 份批改失败，却因数据是旧的被降级（${item.line}）`)
    assert.match(item.detail, /3 份作业批改失败/)
    assert.match(item.detail, new RegExp(STALE_WORD), `是旧数据却没说是旧的（${item.detail}）`)
  } finally {
    server.close()
  }
})

// ── 5. 反向自检：套**修复前**的基线脚本，同场景不许出现这句出处说明 ───────────
test('反向自检（r250）：修复前的基线脚本把旧数字当新的报，一句出处都不提', async () => {
  const { server, port } = await startFakeApi(fakeSummary({ unread: 2 }), { stale: true, staleAt: STALE_AT_ISO() })
  const staged = stageBaselineScript(BASELINE)
  let stdout = ''
  try {
    stdout = await runHealthcheck(port, staged.scriptPath)
  } finally {
    staged.cleanup()
    server.close()
  }
  const item = itemOf(stdout)
  assert.ok(item, `基线脚本没输出「${PROBE_ITEM}」这一项 ⇒ 探针没起来，这条反检验的是空的`)
  assert.equal(item.status, 'warn', `基线脚本把有未读作业的场景又判成了别的（${item.line}）⇒ 场景对不上`)
  assert.ok(item.detail.includes(FRESH_MUST_SAY),
    `基线脚本没印「${FRESH_MUST_SAY}」（${item.detail}）⇒ 场景对不上，验的不是同一个洞`)
  // ⛔ 方向：反向自检里**旧版必须不含**这句出处说明，写成反的会变成「旧版越新越绿」
  assert.doesNotMatch(item.detail, new RegExp(STALE_WORD),
    `基线脚本竟然说了「${STALE_WORD}」（${item.detail}）⇒ 反向自检失效，这个洞可能早被别人修了`)
})
