// 回归测试（r250）：体检的告警不许「替你下结论」，也不许「给你做不到的建议」
//
// 背景（实测，不是推理）：体检脚本里有五处文案在**单次观测上直接下了因果结论**，或**推荐了一个
//   负责人根本做不了的动作**。真机复现（2026-10-09 09:0x，生产 + 66 条采样）：
//   ① 队列那盏灯「队列服务连不上（多半是 Redis 掉了）：……**建议重启后端**」——
//      而 `server/redisManager.js:129-131` 的 ioredis 是 `maxRetriesPerRequest: null`（重试不限次数）
//      + `reconnectOnError: () => true`（:207 注释明写 auto-reconnect 由 ioredis 处理），
//      `server/queue.js:102` 的队列客户端正是拿它 ⇒ **Redis 掉了后端会自己连回来，重启根本不解决**，
//      白等一趟还打断正在跑的批改（r248 刚修掉的那条「照提示重启打断了 5 份批改」，同坑第二处）。
//   ② `missingFieldDetail` 那句「多半是接口结构变了」—— 本周 66 条采样里「代码版本」连续 20 条亮
//      （线上一直没换代码），而本周每一次「字段没回」的真实成因恰恰是**线上还没重启到新代码**，
//      常见成因被指反了。
//   ③ 接口速度「多为网络往返，可稍后再试或让服务器换到离国内更近的机房」——
//      「多为网络往返」是拿单次观测下的因果（红线性），「换机房」在 Render 上根本不是她的操作项；
//      ⛔ 给一个做不到的建议比不给更糟（r198）。
//   ④ 队列积压「可能是 AI 额度紧张导致重试堆积」、⑤ `noLocalVersionDetail`「多半是被复制到别处跑了」
//      —— 同样都是一个成因定终身。
//
// 本锁的做法：**真跑脚本**（假后端按真接口契约出数），逐条断言「有没有替人下结论 / 有没有给错建议」；
//   末尾用**修复前**的基线快照（8492df9）跑同一场景做**反向自检** —— 旧版必须把那几句错话印出来，
//   证明这个洞是真的存在过，不是我编的。
// ⛔ 基线钉死到 8492df9（本轮动手前 fitness 脚本的最后一版），不能用 HEAD：本轮一提交 HEAD 就变新代码
//    ⇒ 反向自检永远空转（r214 教训）。
// ⛔ 基线走 test/fixtures/ 随仓库入库（r242），不用「跑完即删」的探针 —— 那会让自检一直 skip，
//   而 skip 会被当成"验过"（r215 教训）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { stageBaselineScript } from './baselineScriptKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
const BASELINE = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-8492df9.mjs')

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成假通过 ──────
// ⛔ 常量必须真的被下面用上 —— 声明了不用的常量会让这条锁退化成「声明了两个变量」（r220 踩过）。
const LAMP_QUEUE = '任务队列'
const LAMP_SPEED = '接口速度'
const LAMP_TASKS = '批改失败任务'
// 旧错话（反向自检里**必须**出现，说明这个洞真实存在过）
const OLD_RESTART_ADVICE = '建议重启后端'
const OLD_SINGLE_CAUSE_FIELD = '多半是接口结构变了'
const OLD_SINGLE_CAUSE_QUEUE = '可能是 AI 额度紧张导致重试堆积'
const OLD_UNDOABLE_SPEED = '离国内更近的机房'
// 新文案（正向断言）
const NEW_SELF_HEAL = '会自己连回去'
const NEW_NO_RESTART = '不用重启'
const NEW_SECOND_CAUSE = '接口改过'
const NEW_SPEED_RECHECK = '再跑一次体检'
const NEW_QUEUE_AUTO = '队列会自己往下排'

/**
 * 抽某一行（状态, 详情）。状态符号后面的空格数不固定（✅ 一个 / ⚠️ 两个），两边都试。
 */
function itemOf(stdout, lamp) {
  const line = (stdout || '').split('\n')
    .find((l) => l.startsWith('✅ ' + lamp) || l.startsWith('⚠️  ' + lamp) || l.startsWith('❌ ' + lamp))
  if (!line) return null
  return {
    status: line.startsWith('✅') ? 'ok' : line.startsWith('⚠️') ? 'warn' : 'bad',
    line,
    detail: line.slice(line.indexOf('：') + 1)
  }
}

/**
 * 假后端：契约与真接口同构（r220 教训：假后端照抄错误读法会把错误契约固化）。
 * ⚠️ `host='0.0.0.0'` 是故意的 —— 第 3 条用例要用**局域网 IP** 当 --api（脚本只有非本机
 *   地址才走线上那套文案），绑在 127.0.0.1 上那个地址连不到。
 */
function buildFakeApi(body, { healthDelayMs = 0 } = {}) {
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      return new Promise((ok) => {
        setTimeout(() => {
          // ⛔ 只让这一条慢：`health.rt`（第一次请求耗时）才是「接口速度」的判据输入。
          send({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptimeSec: 3600,
            disk: { path: 'C:/tmp', freeMb: 900, totalMb: 1024 }
          })
          ok()
        }, healthDelayMs)
      })
    }
    if (req.url === '/api/students') return send({ success: true, students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') return send({ success: true, summary: body.summary })
    if (req.url === '/api/queue/stats') return send({ success: true, stats: body.stats })
    res.writeHead(404).end('{}')
  })
  return server
}

function startFakeApi(body, opts) {
  const server = buildFakeApi(body, opts)
  return new Promise((ok) => {
    server.listen(0, '0.0.0.0', () => ok({ server, port: server.address().port }))
  })
}

/**
 * 真跑一次体检脚本。
 * ⛔ 必须**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环，
 *    请求根本到不了假后端（r218 实测踩到，表现是超时 + 一行「连不上」）。
 */
function runHealthcheck(api, scriptPath = SCRIPT) {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, [scriptPath, '--api', api], { cwd: ROOT })
    let stdout = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stdout += d })
    p.on('error', reject)
    p.on('close', () => done(stdout))
  })
}

/** 本机局域网 IPv4（给「线上那套文案」用；脚本按地址判 isProd）。 */
function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

// ── 1. Redis 掉线：不许再劝「重启后端」（照做会打断批改），要说清会自己连回来 ──────────
test('队列服务连不上 ⇒ 不许建议重启后端（照做会打断批改），要说清后端会自己连回去', async () => {
  const body = {
    summary: { pendingReview: 0, failedTasks: 0, inProgressCount: 0, pendingTasks: [] },
    // ⛔ 契约抄真接口 `server/index.js:1711-1719`：`available:false` 与 waiting/active/failed 同级。
    stats: { waiting: 0, active: 0, failed: 0, available: false }
  }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(`http://127.0.0.1:${port}`)
    const item = itemOf(stdout, LAMP_QUEUE)
    assert.ok(item, `体检没输出「${LAMP_QUEUE}」这一项`)
    assert.equal(item.status, 'warn', `队列连不上却没提醒：${item.line}`)
    // ⛔ r248 刚修掉过一个同款：那次是「作业没卡住却劝你重启」。这里换个口子再犯一次，是环环相扣的坑。
    assert.doesNotMatch(item.detail, new RegExp(OLD_RESTART_ADVICE),
      `还在劝「${OLD_RESTART_ADVICE}」（${item.detail}）—— Redis 掉了后端会自己连回来，重启不解决还打断批改`)
    assert.match(item.detail, new RegExp(NEW_SELF_HEAL),
      `没说清「会自己连回去」（${item.detail}）—— 老师会以为得有人去修`)
    assert.match(item.detail, new RegExp(NEW_NO_RESTART),
      `没明说「${NEW_NO_RESTART}」（${item.detail}）—— 老师照样可能去重启生产后端`)
    // 真卡住时要能查：得给一个她做得到的下一步
    assert.match(item.detail, /内存/, `没给「去查内存/连接数」这种做得到的下一步（${item.detail}）`)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})

// ── 2. 字段没回：不许只安一个成因，两种可能都要点到 ──────────────────────────────
test('接口没回字段 ⇒ 不许只说「接口结构变了」，要同时点到「还没重启到新版」', async () => {
  // summary 整层不回 ⇒ 走 missingFieldDetail（r221 那条「这一项等于没盯」）
  const body = { summary: undefined, stats: { waiting: 0, active: 0, failed: 0, available: true } }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(`http://127.0.0.1:${port}`)
    const item = itemOf(stdout, LAMP_TASKS)
    assert.ok(item, `体检没输出「${LAMP_TASKS}」这一项`)
    assert.equal(item.status, 'warn', `字段没回却没提醒：${item.line}`)
    assert.doesNotMatch(item.detail, new RegExp(OLD_SINGLE_CAUSE_FIELD),
      `还只安一个成因「${OLD_SINGLE_CAUSE_FIELD}」（${item.detail}）—— 本周实测这类最常见成因恰恰是线上没换代码`)
    assert.match(item.detail, /还没重启到新版/,
      `没说「多半是还没重启到新版」（${item.detail}）—— 本周 66 条采样里这才是常见成因`)
    assert.match(item.detail, new RegExp(NEW_SECOND_CAUSE),
      `只说一种可能，没把另一种也点到（${item.detail}）—— 单一成因的下判断不可靠`)
    assert.match(item.detail, /Render/, `没指出先去哪看一眼（${item.detail}）—— 不给动手顺序就还是空转`)
  } finally {
    server.close()
  }
})

// ── 3. 偏慢：不许给「换机房」这种做不到的建议，也不许替网络下因果 ──────────────────
test('线上接口偏慢 ⇒ 不许说「换到离国内更近的机房」，改成「再跑一次看看」', async () => {
  const ip = lanIp()
  assert.ok(ip, '本机解析不到局域网 IPv4 ⇒ 这条用例测不到线上那套文案，环境变了得先修探针')
  const body = {
    summary: { pendingReview: 0, failedTasks: 0, inProgressCount: 0, pendingTasks: [] },
    stats: { waiting: 0, active: 0, failed: 0, available: true }
  }
  // ⛔ 3000ms > 线上阈值 2000ms，让「接口速度」真的进 warn 分支（造不出慢场景这条锁就是空转）。
  const { server, port } = await startFakeApi(body, { healthDelayMs: 3000 })
  try {
    const stdout = await runHealthcheck(`http://${ip}:${port}`)
    const item = itemOf(stdout, LAMP_SPEED)
    assert.ok(item, `体检没输出「${LAMP_SPEED}」这一项`)
    assert.equal(item.status, 'warn', `接口慢却没提醒（${item.line}）—— 这条锁测的是空转`)
    assert.doesNotMatch(item.detail, new RegExp(OLD_UNDOABLE_SPEED),
      `还是「${OLD_UNDOABLE_SPEED}」（${item.detail}）—— 部署在 Render 上，换机房不是她的操作项，这是个做不到的建议（r198）`)
    assert.doesNotMatch(item.detail, /多为网络往返/,
      `还在替网络下因果「多为网络往返」（${item.detail}）—— 单次观测撑不起因果结论`)
    assert.match(item.detail, new RegExp(NEW_SPEED_RECHECK),
      `没给「${NEW_SPEED_RECHECK}」这种做得到的下一步（${item.detail}）`)
  } finally {
    server.close()
  }
})

// ── 4. 队列积压：不许把成因独断成「AI 额度紧张」 ──────────────────────────────
test('队列积压偏多 ⇒ 不许只说「AI 额度紧张」，两种可能都点到并说清不用动手', async () => {
  const body = {
    summary: { pendingReview: 0, failedTasks: 0, inProgressCount: 0, pendingTasks: [] },
    stats: { waiting: 30, active: 0, failed: 0, available: true }
  }
  const { server, port } = await startFakeApi(body)
  try {
    const stdout = await runHealthcheck(`http://127.0.0.1:${port}`)
    const item = itemOf(stdout, LAMP_QUEUE)
    assert.ok(item, `体检没输出「${LAMP_QUEUE}」这一项`)
    assert.equal(item.status, 'warn', `积压 30 个却没提醒：${item.line}`)
    assert.doesNotMatch(item.detail, new RegExp(OLD_SINGLE_CAUSE_QUEUE),
      `还是「${OLD_SINGLE_CAUSE_QUEUE}」一句独断（${item.detail}）—— 积压也可能是那会儿作业本来就多`)
    assert.match(item.detail, new RegExp(NEW_QUEUE_AUTO),
      `没说清「${NEW_QUEUE_AUTO}」（${item.detail}）—— 不然老师会急着去动 AI 额度`)
  } finally {
    server.close()
  }
})

// ── 5. 反向自检：套**修复前**的基线脚本，同场景必须把那几句错话印出来 ──────────────
test('反向自检（r250）：修复前的基线脚本仍在同一场景印「建议重启后端 / 多半是接口结构变了」', async () => {
  const body = {
    summary: undefined,
    stats: { waiting: 30, active: 0, failed: 0, available: false }
  }
  const { server, port } = await startFakeApi(body)
  const staged = stageBaselineScript(BASELINE)
  let stdout = ''
  try {
    stdout = await runHealthcheck(`http://127.0.0.1:${port}`, staged.scriptPath)
  } finally {
    staged.cleanup()
    server.close()
  }
  // ⛔ 方向别写反（r239 同款）：反向自检里**旧版必须含**那几句错话 ——
  //    断言写「基线不许含 X」就会变成「基线越错越绿」，自检自己变成假绿。
  const queue = itemOf(stdout, LAMP_QUEUE)
  assert.ok(queue, `基线脚本没输出「${LAMP_QUEUE}」这一项 ⇒ 探针没起来，这条反检验的是空的`)
  assert.match(queue.detail, new RegExp(OLD_RESTART_ADVICE),
    `基线脚本没印「${OLD_RESTART_ADVICE}」（${queue.detail}）⇒ 反向自检失效，这个洞可能早被别人修了`)
  assert.doesNotMatch(queue.detail, new RegExp(NEW_NO_RESTART),
    `基线脚本竟然说了「${NEW_NO_RESTART}」（${queue.detail}）⇒ 自检场景对不上，验的不是同一个洞`)

  const tasks = itemOf(stdout, LAMP_TASKS)
  assert.ok(tasks, `基线脚本没输出「${LAMP_TASKS}」这一项 ⇒ 探针没起来，这条反检验的是空的`)
  assert.match(tasks.detail, new RegExp(OLD_SINGLE_CAUSE_FIELD),
    `基线脚本没印「${OLD_SINGLE_CAUSE_FIELD}」（${tasks.detail}）⇒ 反向自检失效`)
  assert.doesNotMatch(tasks.detail, /还没重启到新版/,
    `基线脚本竟然说了「还没重启到新版」（${tasks.detail}）⇒ 自检场景对不上，验的不是同一个洞`)
})
