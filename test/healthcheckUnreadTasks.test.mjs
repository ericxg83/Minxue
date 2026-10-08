// 回归测试（r248 / r249-①）：体检不许把「已经批完、老师还没点开的作业」说成「作业卡住了」
//
// 缺陷（实测，不是推理）：`scripts/healthcheck.mjs` 把 `/api/tasks/summary` 的 `pendingTasks`
//   当成「卡在处理中」的份数，并劝「持续卡住就重启后端」。
//   真身是 `server/index.js:723` 那句 SQL —— `status=DONE AND deleted_at IS NULL
//   AND notification_read_at IS NULL`，也就是**已经批完、老师还没点开看**的作业（最多 5 份）。
//   2026-10-08 20:5x 实测生产：failedTasks=0、inProgressCount=0（**一份都没在跑**），
//   只有 5 份已批完未读，体检照样印「5 份作业卡在处理中……持续卡住就重启后端」。
//   老师照提示重启生产后端，会打断那几条真正在跑的批改；正确动作是去 App 点开看新批完的作业。
//
//   连带：`inProgressCount`（真正的「在批改」计数，`server/index.js:736`）体检一次都没读。
//
// 本锁的做法：**真跑脚本**（假后端按真接口契约出数），逐条断言「说的是哪件事」；
//   末尾用**修复前**的基线快照跑同一场景做**反向自检** —— 旧版必须印那句错话，
//   证明这个洞是真的存在过，不是我编的。
// ⛔ 基线钉死到 23ef3df（本轮动手前那个提交），不能用 HEAD：本轮一提交 HEAD 就变新代码
//    ⇒ 反向自检永远空转（r214 教训）。
// ⛔ 基线走 test/fixtures/ 随仓库入库（r242），不用「跑完即删」的探针 —— 那会让自检一直 skip，
//   而 skip 会被当成"验过"（r215 教训）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { stageBaselineScript } from './baselineScriptKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
const BASELINE = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-23ef3df.mjs')

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成假通过 ──────
// ⛔ 常量必须真的被下面用上 —— 声明了不用的常量会让这条锁退化成「声明了两个变量」（r220 踩过）。
const PROBE_ITEM = '批改失败任务'
const MUST_SAY = '已经批完了'
const MUST_SAY_2 = '还没点开看'
const MUST_NOT_SAY = '卡在处理中'
// ⛔ 禁的是「劝你重启」这句话本身，不是「重启」这两个字 —— 新文案得明说「不用重启后端」，
//    把「重启后端」整个词禁掉会把自己写的那句「不用重启后端」判红（r237/r241 同款：
//    写「禁止出现某词」的判据前，先检查自己的文案里有没有那个词）。
const MUST_NOT_SAY_2 = '持续卡住'
const MUST_NOT_SAY_3 = '等一会儿再看'

/** 造一份「N 份已批完、老师还没看」的 summary（契约抄自真接口 `server/index.js:713-806`）。 */
function fakeSummary({ unread = 0, failed = 0, inProgress = 0, omit = [] } = {}) {
  const summary = {
    pendingReview: unread,
    failedTasks: failed,
    inProgressCount: inProgress,
    todayNewWrongQuestions: 0,
    totalNotifications: unread + failed,
    // ⛔ `pendingTasks` 是真接口里**最多 5 份**的清单，不是总数：报数用 pendingReview，
    //   这份清单只用来算「最早那一份是多久之前批的」。createdAt 是唯一能算时间差的字段。
    pendingTasks: Array.from({ length: unread }, (_, i) => ({
      id: `t${i + 1}`,
      studentId: '1',
      originalName: '数学作业',
      status: 'done',
      createdAt: new Date(Date.now() - (i + 1) * 20 * 60000).toISOString(),
      notificationReadAt: null,
      studentName: `学生${i + 1}`,
      questionCount: 10,
      wrongCount: 2,
      emptyCount: 0,
      pendingCount: 0
    }))
  }
  for (const g of omit) delete summary[g]
  return summary
}

/** 假后端：契约与真接口同构（r220 教训：假后端照抄错误读法会把错误契约固化）。 */
function buildFakeApi(body) {
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
        disk: { path: 'C:/tmp', freeMb: 900, totalMb: 1024 }
      })
    }
    if (req.url === '/api/students') return send({ success: true, students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') return send({ success: true, summary: body.summary })
    if (req.url === '/api/queue/stats') {
      return send({ success: true, stats: { waiting: 0, active: 0, failed: 0, available: true } })
    }
    res.writeHead(404).end('{}')
  })
  return server
}

function startFakeApi(body) {
  const server = buildFakeApi(body)
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

/** 抽「批改失败任务」那一行的（状态, 详情）。状态符号后面的空格数不固定（✅ 一个 / ⚠️ 两个），两边都试。 */
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

test('元判据自证：探针认得体检输出里的「批改失败任务」这一项，且认得那两种状态', () => {
  const ok = itemOf(`✅ ${PROBE_ITEM}：${MUST_SAY}x`)
  assert.ok(ok, `探针没认出「✅ ${PROBE_ITEM}：」这行，判定词或状态符号改过？`)
  assert.equal(ok.status, 'ok')
  assert.equal(itemOf(`⚠️  ${PROBE_ITEM}：${MUST_SAY}x`).status, 'warn')
  assert.equal(itemOf(`❌ ${PROBE_ITEM}：${MUST_SAY}x`).status, 'bad')
  // 新文案必须真的带「已经批完了 / 还没点开看」，否则「说人话」这条不成立了
  const d = itemOf(`⚠️  ${PROBE_ITEM}：${MUST_SAY}，你${MUST_SAY_2}`).detail
  assert.ok(d.includes(MUST_SAY) && d.includes(MUST_SAY_2), '新文案没讲清是「批完了还没看」')
})

// ── 1. 有作业批完没看 ⇒ 必须说「批完了还没点开看」，不许说「卡住了、重启后端」──────────
test('有已批完未看的作业 ⇒ 说「批完了还没点开看」+ 多久之前批的，不许说「卡住/重启」', async () => {
  // 5 份 done 未读，每份相差 20 分钟 ⇒ 最早那份是 100 分钟前 ⇒ 文案应含「1 小时 40 分钟前」
  const body = { summary: fakeSummary({ unread: 5, inProgress: 0 }) }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'warn', `有作业批完没看却没提醒：${item.line}`)
    assert.ok(item.detail.includes(MUST_SAY), `没说清是「已经批完」（${item.detail}）`)
    assert.ok(item.detail.includes(MUST_SAY_2), `没说清是「还没点开看」（${item.detail}）`)
    assert.match(item.detail, /5 份作业/, `份数没印出来（${item.detail}）`)
    assert.match(item.detail, /1 小时 40 分钟前/, `最早那一份是多久之前批的没说（${item.detail}）`)
    assert.doesNotMatch(item.detail, new RegExp(MUST_NOT_SAY),
      `还是那句错话「${MUST_NOT_SAY}」（${item.detail}）—— 那批作业是批完了没看，不是卡住`)
    assert.doesNotMatch(item.detail, new RegExp(MUST_NOT_SAY_2),
      `还在劝人「${MUST_NOT_SAY_2}就重启后端」（${item.detail}）—— 照做会打断正在跑的批改`)
    assert.doesNotMatch(item.detail, new RegExp(MUST_NOT_SAY_3),
      `还在劝人「${MUST_NOT_SAY_3}」（${item.detail}）—— 作业早就批完了，等不到也等不该`)
    // 反过来必须明说「不用重启」，让老师别去动生产后端
    assert.match(item.detail, /不用重启后端/, `没明说不用重启后端（${item.detail}）—— 老师可能照旧去重启`)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})

// ── 2. 真有批改失败 ⇒ 照旧判红色（修复只动「未读未看」那一支，不许顺手把失败的也改没）──
test('真有批改失败的作业 ⇒ 仍须判红色并提醒去点重试（行为保持）', async () => {
  const body = { summary: fakeSummary({ unread: 2, failed: 3, inProgress: 0 }) }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'bad', `有作业批改失败却没判红：${item.line}`)
    assert.match(item.detail, /3 份作业批改失败/)
  } finally {
    server.close()
  }
})

// ── 3. 都在 0、但有几份真在批改 ⇒ 说清「那才是真的在跑」─────────────────────────────
test('没有失败也没有没看的新作业，但有几份正在批改 ⇒ 判合格，并说清「正在批改」是正常不是卡住', async () => {
  const body = { summary: fakeSummary({ unread: 0, failed: 0, inProgress: 3 }) }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${PROBE_ITEM}」这一项`)
    assert.equal(item.status, 'ok', `真没失败却报警：${item.line}`)
    assert.match(item.detail, /3 份正在批改/, `「正在批改的份数」是体检之前一次都没读过的一项，得补上（${item.detail}）`)
  } finally {
    server.close()
  }
})

// ── 4. 反向自检：套**修复前**的基线脚本，同场景必须印那句错话（洞确实存在）─────────────
test('反向自检（r249-①）：修复前的基线脚本把「批完没看」报成「卡在处理中/重启后端」', async () => {
  const body = { summary: fakeSummary({ unread: 5, inProgress: 0 }) }
  const { server, port } = await startFakeApi(body)
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
  assert.match(item.detail, new RegExp(MUST_NOT_SAY),
    `基线脚本没印「${MUST_NOT_SAY}」（${item.detail}）⇒ 反向自检失效，这个洞可能早被别人修了`)
  assert.match(item.detail, new RegExp(MUST_NOT_SAY_2),
    `基线脚本没印「${MUST_NOT_SAY_2}就重启后端」（${item.detail}）⇒ 反向自检失效`)
  // ⛔ 这里方向别写反（r239 同款）：反向自检里**旧版必须含**那几句错话 ——
  //    断言写「基线不许含 X」就会变成「基线越错越绿」，自检自己变成假绿。
  assert.match(item.detail, new RegExp(MUST_NOT_SAY_3),
    `基线脚本没印「${MUST_NOT_SAY_3}」（${item.detail}）⇒ 反向自检失效`)
  assert.doesNotMatch(item.detail, new RegExp(MUST_SAY),
    `基线脚本竟然说的是「${MUST_SAY}」（${item.detail}）⇒ 反向自检场景对不上，验的不是同一个洞`)
})
