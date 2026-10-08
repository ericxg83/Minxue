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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stageBaselineScript } from './baselineScriptKit.mjs'

/**
 * 反向自检探针（⛔ 不能 spawnSync 调 git，Windows 上EBUSY，r220 前的既有套路）：
 *   git show HEAD:scripts/healthcheck.mjs > scripts/_r220_old_healthcheck.mjs
 * 探针文件被 .gitignore 的 `_*` 排除 ⇒ 不进版本库，但本机留着就能一直验。
 * 探针没就位时本条 **skip 而不是 return 通过**（return 会把没验证的锁当成通过，r215 教训）；
 * skip 在测试输出里是明晃晃的一条，看得出「这次没验」。
 */

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
// ⛔ r242：基线快照随仓库入库（test/fixtures/healthcheck-baseline-25b4386-parent.mjs = 25b4386~1），
//    不再「由 shell 从 HEAD 导出、跑完即删」—— 那次导出的文件早被删了，这条自检一直 t.skip，
//    而 skip 会被当成"验过"（r215 教训）⇒ 那枚队列假绿灯因此一直没人发现。
//    ⛔ 也不存 `_` 前缀：eslint 的 `**/_*` 会整段忽略它，还会被下轮巡检当一次性产物删掉。
const OLD_SCRIPT = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-25b4386-parent.mjs')

const ITEM = '任务队列'

// ── r243 反向自检的「手术刀」：把真话措辞手术回旧版那句假安慰（⛔ 不调 git，不依赖基线文件）──
/** 真话措辞（体检脚本里的唯一实现） */
const FAILED_HONEST_TAIL = '（这几个不会自己重判、也不会自己消掉，会一直留在这个数里）'
/**
 * ⛔ 手术锚点必须是**整行 ternary**，光换尾巴不够（r243 实测踩到）：
 *    新措辞 = `、判不出来且不会再重试的 ${f} 个` + 尾巴，
 *    只把尾巴换成旧那句的话，前缀「、判不出来且不会再重试的 7 个」还留着
 *    ⇒ 换完的输出**同时**含新措辞和「会定期清理」，反向自检打红的是前缀那一句，
 *    看着像「手术无效」，其实根本原因是**锚点选短了**，白白再绕一轮。
 */
const NEW_FAILED_TERNARY_LINE = '      ? `、判不出来且不会再重试的 ${f} 个` + FAILED_HONEST_TAIL'
/** 旧措辞：换上去之后，上面那几条断言必须立刻判红 —— 那才是这个洞真实存在过的证据 */
const OLD_FAILED_TERNARY_LINE = '      ? `、历史上失败 ${f} 个（失败数会定期清理，看趋势不看绝对值）`'

/**
 * 造一份「旧措辞」的体检脚本。
 * ⛔ 替换片段用常量承载（含反引号 / `${f}`），不手工往长字面量里塞 —— 一塞就拼错，而断言看不出来。
 */
function buildOldQuadrantText() {
  const src = readFileSync(SCRIPT, 'utf8')
  // ⛔ 先自证锚点还在：措辞被改过的话，这条反向自检就是跟空气打（永远判红，看不出是锁坏了还是洞还在）
  assert.ok(src.includes(NEW_FAILED_TERNARY_LINE), `手术锚点不在体检脚本里 ⇒ 措辞被改过，这条锁是空转`)
  const out = src.replace(NEW_FAILED_TERNARY_LINE, OLD_FAILED_TERNARY_LINE)
  assert.ok(out !== src, '手术后的脚本与原文一模一样 ⇒ 手术根本没生效，这条反向自检是假验')
  assert.ok(out.includes(OLD_FAILED_TERNARY_LINE), '旧措辞没换进去 ⇒ 反向自检验了个假目标')
  assert.ok(!out.includes(NEW_FAILED_TERNARY_LINE), '锚点只换掉一半（新措辞还留着）⇒ 换完的输出不是旧版')
  return out
}

/**
 * 把任意脚本源码 stage 成能独立跑的临时目录。
 * ⛔ 相对依赖必须一起带（r241 踩过）：现在 healthcheck 除了 `./healthDiskState.mjs`，
 * 还 import `../server/utils/cjkFontState.js` —— 只拷一个文件会 MODULE_NOT_FOUND，
 * 表现和「旧脚本没输出这一项」一模一样，看不出真病因。
 */
function stageScriptVariant(sourceText) {
  const dir = mkdtempSync(join(tmpdir(), 'minxue-r243-'))
  // ⛔ 布局必须和仓库一致：`scripts/healthcheck.mjs` 在 `<dir>/scripts/` 下 ——
  //    脚本里 `../server/utils/cjkFontState.js` 是按 `dirname(script)/..` 解析的，
  //    直接把文件平铺在 `<dir>/` 会让 `..` 跳到 Temp 上一级 ⇒ MODULE_NOT_FOUND（r241/r243 实测）。
  mkdirSync(resolve(dir, 'scripts'), { recursive: true })
  cpSync(resolve(ROOT, 'scripts', 'healthDiskState.mjs'), resolve(dir, 'scripts', 'healthDiskState.mjs'))
  mkdirSync(resolve(dir, 'server', 'utils'), { recursive: true })
  cpSync(resolve(ROOT, 'server', 'utils'), resolve(dir, 'server', 'utils'), { recursive: true })
  writeFileSync(resolve(dir, 'scripts', 'healthcheck.mjs'), sourceText)
  return {
    scriptPath: resolve(dir, 'scripts', 'healthcheck.mjs'),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

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
test('平时队列空闲 ⇒ 判合格，并且失败那条必须印真值、不许再拿「会定期清理」哄人', async () => {
  const { server, port } = await startFakeApi({ queue: { waiting: 0, active: 0, failed: 7, available: true } })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = queueItem(stdout)
    assert.ok(item, `体检没输出「${ITEM}」这一项`)
    assert.equal(item.status, 'ok', `平时被测成告警：${item.line}`)
    assert.match(item.detail, /判不出来且不会再重试的 7 个/,
      `数字丢了（${item.detail}）—— 旧版因为读不到 stats 会印成 0 个`)
    // ⛔ 假话必须消失：这 7 个系统既不会重判也不会消掉（全仓没有任何清理 failed 任务的实现），
    //    说「会定期清理」就是哄人（r198：夸大的提示比没提示更糟）。
    assert.ok(!item.detail.includes('会定期清理'), `还在说会自己清理（${item.detail}）`)
    assert.ok(!item.detail.includes('看趋势不看绝对值'),
      `「看趋势不看绝对值」这句话在这一行兑现不了（${item.detail}），趋势要去跑 healthTrend.mjs`)
    assert.ok(item.detail.includes('不会自己重判'), `没说清不会自己重判（${item.detail}）`)
    assert.ok(item.detail.includes('不会自己消掉'), `没说清不会自己消掉（${item.detail}）`)
  } finally {
    server.close()
  }
})

// ⛔ r243 反向自检（不调 git、不依赖基线文件 —— r242 定下的规矩）：
//    把上面那句真话**手术回旧措辞**（换上「（失败数会定期清理，看趋势不看绝对值）」），
//    同一场景必须立刻判红 ⇒ 证明这几条断言咬得住，不是摆设。
test('反向自检：换回旧措辞（会说「会定期清理」）⇒ 上面那几条必须判红', async () => {
  const { server, port } = await startFakeApi({ queue: { waiting: 0, active: 0, failed: 7, available: true } })
  let staged = null
  try {
    staged = stageScriptVariant(buildOldQuadrantText())
    const { stdout } = await runHealthcheck(port, staged.scriptPath)
    const item = queueItem(stdout)
    // ⛔ 先自证：旧措辞真换上去了、真话真没了。否则下面几条是在跟空气打（空转判绿）
    assert.ok(item, '旧措辞那版没输出「任务队列」这一项')
    assert.match(item.detail, /历史上失败 7 个（失败数会定期清理，看趋势不看绝对值）/,
      `没换回旧措辞（${item.detail}）⇒ 手术无效，这条反向自检是空转`)
    assert.ok(!item.detail.includes('不会自己重判'), '旧措辞居然也在说真话 ⇒ 手术没生效')
    // ⛔ 再逐条对账：新版那三条断言，每一条都会被旧措辞打红（不是数红条数，是看颜色）
    assert.ok(!/判不出来且不会再重试的 7 个/.test(item.detail),
      `旧措辞版居然也印了新措辞（${item.detail}）⇒ 第 2 条锁不住`)
    assert.ok(item.detail.includes('看趋势不看绝对值'),
      '旧措辞必须还带着「看趋势不看绝对值」，这样才证明上面那条也是被它打红的，而不是被别的话打红')
  } finally {
    if (staged) staged.cleanup()
    server.close()
  }
})

// ⛔ 元判据自证（r198/r229 同款）：判据自己写错字会造成假通过 ⇒ 先自证手术刀的两端都还在。
test('元判据自证：新措辞在脚本里、旧措辞在本文件里、替换片段唯一', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  const s = readFileSync(import.meta.filename, 'utf8')
  assert.ok(src.includes(FAILED_HONEST_TAIL),
    `体检脚本里没有真话括号「${FAILED_HONEST_TAIL}」⇒ 判据盯的东西被改掉了，这条锁是空转`)
  assert.ok(src.includes('${failedText}'), '体检脚本那句 record 没在用 failedText ⇒ 措辞接不上去')
  assert.ok(s.includes('FAILED_HONEST_TAIL'), '本文件里没有手术起点常量 ⇒ 手术目标不在')
  assert.ok(s.includes(NEW_FAILED_TERNARY_LINE), '本文件里没有新的真话措辞（手术起点）⇒ 手术目标不在')
  assert.ok(s.includes(OLD_FAILED_TERNARY_LINE), '本文件里没有旧的假话措辞（手术终点）⇒ 手术目标不在')
  assert.equal(src.split(NEW_FAILED_TERNARY_LINE).length - 1, 1,
    `手术锚点在体检脚本里出现了不止一次 ⇒ replace 只能换第一处，手术会换错位置`)
  assert.equal(src.split(FAILED_HONEST_TAIL).length - 1, 1,
    `真话括号在体检脚本里出现了不止一次 ⇒ replace 只能换第一处，手术会换错位置`)
  assert.equal(src.split(FAILED_HONEST_TAIL).length - 1, 1,
    `真话括号在体检脚本里出现了不止一次 ⇒ replace 只能换第一处，手术会换错位置`)
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
test('反向自检：修复前的旧脚本在「积压 30 个」场景下判合格且印 0 个（洞确实存在）', async () => {
  // ⛔ 基线钉死到具体提交（r221 教训）：HEAD 随提交漂移 ⇒ 导出的「旧脚本」其实是新代码，反向自检假红。
  // ⛔ r242：基线随仓库入库，每次真跑、不再 skip（此前因探针被删一直空转）。
  const { server, port } = await startFakeApi({ queue: { waiting: 30, active: 0, failed: 0, available: true } })
  let stdout = ''
  const staged = stageBaselineScript(OLD_SCRIPT)
  try {
    stdout = (await runHealthcheck(port, staged.scriptPath)).stdout
  } finally {
    staged.cleanup()
    server.close()
  }
  const item = queueItem(stdout)
  assert.ok(item, '旧脚本没输出「任务队列」')
  // ⛔ 下面这两条就是「旧洞」：读不到 stats ⇒ 印 0 个 ⇒ 还判合格。
  assert.match(item.detail, /排队 0 个/,
    `旧脚本竟然印出了 30 个（${item.detail}）⇒ 反向自检失效，这条测守不住判据`)
  assert.equal(item.status, 'ok', `旧脚本竟然也判提醒（${item.line}）⇒ 反向自检失效`)
})
