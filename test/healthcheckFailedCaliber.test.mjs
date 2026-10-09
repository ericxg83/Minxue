// 回归测试（第 249 轮）：体检那盏「批改失败任务」的灯，不许把「没看到新的失败」说成「没有失败」
//
// 缺陷（实测，不是推理，2026-10-09 取生产数）：
//   1. `scripts/healthcheck.mjs` 合格那一支写死一句「没有批改失败，也没有没看的新作业」。
//   2. 而 `/api/tasks/summary` 的 `failedTasks` 只数 `status='failed' AND notification_read_at IS NULL`
//      （`server/index.js:733-737` 的 failed_detail 子查询硬带未读条件）。
//   3. 生产 tasks 表实测确实有一条 status='failed' 的作业：
//      `35b35c33…`「新闵学校"成长·桥"练习 数学堂堂清01」、created 2026-09-02T09:53:31Z、
//      retry_count=3、last_error `invalid input syntax for type json`、
//      notification_read_at 2026-09-02T10:47:41Z（**已经点开过**）、
//      describeAutoRetry → { willRetry:false, state:'gave-up', reason:'超出 7 天自动恢复窗口' }。
//      ⇒ 因为被点开过，failedTasks 恒 0 ⇒ 体检、铃铛**一次都没提醒过这份作业**，
//      而它会一直卡在那儿：不会自己重判，也没有任何一处定时清掉它。
//   4. ⇒ 一句「没有批改失败」把「没盯到」说成了「没有」，正是 r221 那一族假绿：
//      看着在盯失败，实际漏的就是失败本身。
//
// 本锁：**真跑脚本**（假后端按真接口契约出数），逐条断言「合格那句话说的是哪一种」；
//   末尾用**修复前**的基线快照（8492df9）跑同一场景做**反向自检** —— 旧版必须把那句假话印出来，
//   证明这个洞真的存在过，不是我编的。
// ⛔ 基线钉死到 8492df9（本轮动手前那一版），不能用 HEAD：本轮一提交 HEAD 就变新代码
//   ⇒ 反向自检永远空转（r214 教训）。
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
const BASELINE = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-8492df9.mjs')

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成假通过 ──────
// ⛔ 常量必须真的被下面用上 —— 声明了不用的常量会让这条锁退化成「什么都没判」（r220 踩过）。
const LAMP = '批改失败任务'
/** 旧文案那句假话（反向自检里**必须**出现）。 */
const OLD_FALSE_CLAIM = '没有批改失败'
/** 新文案（正向断言）。 */
const NEW_SAYS_SCOPE = '没看到新的批改失败'
const NEW_SAYS_LIMIT = '只看'
const NEW_SAYS_WHERE = '作业列表'
/** 真·失败判红那条（行为保持，不许顺手改没）。 */
const REAL_FAIL_TEXT = '3 份作业批改失败'

/** 假后端：契约与真接口同构（r220 教训：假后端照抄错误读法会把错误契约固化）。 */
function buildFakeApi(summary) {
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
    if (req.url === '/api/tasks/summary') return send({ success: true, summary })
    if (req.url === '/api/queue/stats') {
      return send({ success: true, stats: { waiting: 0, active: 0, failed: 0, available: true } })
    }
    res.writeHead(404).end('{}')
  })
  return server
}

function startFakeApi(summary) {
  const server = buildFakeApi(summary)
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}

/** ⛔ 必须**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环，请求根本到不了假后端。 */
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

/** 抽「批改失败任务」那一行的（状态, 详情）。状态符号后的空格数不固定（✅ 一个 / ⚠️ 两个）。 */
function itemOf(stdout) {
  const line = (stdout || '').split('\n')
    .find((l) => l.startsWith('✅ ' + LAMP) || l.startsWith('⚠️  ' + LAMP) || l.startsWith('❌ ' + LAMP))
  if (!line) return null
  return {
    status: line.startsWith('✅') ? 'ok' : line.startsWith('⚠️') ? 'warn' : 'bad',
    line,
    detail: line.slice(line.indexOf('：') + 1)
  }
}

/** 一份「什么都没有」的 summary（契约抄真接口 `GET /api/tasks/summary`）。 */
const CLEAN_SUMMARY = {
  pendingReview: 0,
  failedTasks: 0,
  inProgressCount: 0,
  todayNewWrongQuestions: 0,
  totalNotifications: 0,
  pendingTasks: [],
  recentTasks: []
}

// ── 1. 元判据自证：探针认得这一行，也认得「旧假话 / 新说法」两种措辞 ──────────────────
test('元判据自证：用词在本文件里逐字存在，且探针能把「合格/提醒」两态分清', () => {
  assert.ok(OLD_FALSE_CLAIM.length >= 5 && NEW_SAYS_SCOPE.length >= 5)
  assert.ok(itemOf(`✅ ${LAMP}：${NEW_SAYS_SCOPE}`), '探针没认出「✅ 批改失败任务：」这行')
  assert.equal(itemOf(`✅ ${LAMP}：x`).status, 'ok')
  assert.equal(itemOf(`⚠️  ${LAMP}：x`).status, 'warn')
  assert.equal(itemOf(`❌ ${LAMP}：x`).status, 'bad')
})

// ── 2. 什么都没有 ⇒ 判合格，但**不许再说「没有批改失败」**────────────────────────
test('没有新失败也没有没看的新作业 ⇒ 判合格，但不许把「没盯到」说成「没有失败」', async () => {
  const { server, port } = await startFakeApi(CLEAN_SUMMARY)
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${LAMP}」这一项`)
    assert.equal(item.status, 'ok', `真什么都没有却报警：${item.line}`)
    // ⛔ 方向：禁的是那句绝对断言「没有批改失败」；新文案「没看到新的批改失败」不含这五个字，
    //    所以下面这条禁词不会把自己写的那句判红（r237/r241 同款坑，改文案前先核对）。
    assert.doesNotMatch(item.detail, new RegExp(OLD_FALSE_CLAIM),
      `还在说「${OLD_FALSE_CLAIM}」（${item.detail}）—— 那一条早被点开过的失败作业，体检与铃铛都看不见它`)
    assert.match(item.detail, new RegExp(NEW_SAYS_SCOPE),
      `没说清「${NEW_SAYS_SCOPE}」（${item.detail}）—— 合格只是「没看到新的」，不是「没有」`)
    // 还得交代这一项到底看着什么，别让人以为它盯了全部失败
    assert.match(item.detail, new RegExp(NEW_SAYS_LIMIT), `没交代这一项的口径（${item.detail}）`)
    // 以及一直没批成的那份上哪儿翻 —— 只说「看不出来」不给去处，等于没用（r198）
    assert.match(item.detail, new RegExp(NEW_SAYS_WHERE),
      `没说「${NEW_SAYS_WHERE}」这种能去翻一翻的去处（${item.detail}）`)
    assert.match(item.detail, /不会自己重判/, `没说清那几份不会自己重判（${item.detail}）—— 不然老师会等它自己好`)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})

// ── 3. 行为保持：真有批改失败 ⇒ 照旧判红、照旧报份数（修复只动「合格」那一支）──────
test('真有批改失败的作业 ⇒ 仍须判红色并报份数（行为保持）', async () => {
  const summary = { ...CLEAN_SUMMARY, pendingReview: 0, failedTasks: 3, totalNotifications: 3 }
  const { server, port } = await startFakeApi(summary)
  try {
    const stdout = await runHealthcheck(port)
    const item = itemOf(stdout)
    assert.ok(item, `体检没输出「${LAMP}」这一项`)
    assert.equal(item.status, 'bad', `有作业批改失败却没判红：${item.line}`)
    assert.match(item.detail, new RegExp(REAL_FAIL_TEXT), `份数没印出来（${item.detail}）`)
  } finally {
    server.close()
  }
})

// ── 4. 反向自检：套**修复前**的基线脚本，同场景必须印那句假话（洞真实存在）───────────
test('反向自检（第 249 轮）：修复前的基线脚本把「没盯到」印成「没有批改失败」', async () => {
  const { server, port } = await startFakeApi(CLEAN_SUMMARY)
  const staged = stageBaselineScript(BASELINE)
  let stdout = ''
  try {
    stdout = await runHealthcheck(port, staged.scriptPath)
  } finally {
    staged.cleanup()
    server.close()
  }
  const item = itemOf(stdout)
  assert.ok(item, `基线脚本没输出「${LAMP}」这一项 ⇒ 探针没起来，这条反检验的是空的`)
  assert.match(item.detail, new RegExp(OLD_FALSE_CLAIM),
    `基线脚本没印「${OLD_FALSE_CLAIM}」（${item.detail}）⇒ 反向自检失效，这个洞可能早被别人修了`)
  assert.doesNotMatch(item.detail, new RegExp(NEW_SAYS_SCOPE),
    `基线脚本竟然说了「${NEW_SAYS_SCOPE}」（${item.detail}）⇒ 自检场景对不上，验的不是同一个洞`)
})

// ── 5. 基线自证：那份快照里**必须还留着**旧措辞（基线被人换掉时这条会红，防假绿）─────
test('基线快照自证：fixtures 里那份旧脚本仍含那句旧文案（否则第 4 条会空转）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(BASELINE, 'utf8')
  assert.ok(src.includes(OLD_FALSE_CLAIM),
    `基线快照里没有「${OLD_FALSE_CLAIM}」⇒ 那份快照已经不是修复前的版本，第 4 条反向自检会变成假绿`)
})
