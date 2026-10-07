// 回归测试（㊺）：体检每一项「字段没真读到」时必须明说，不许悄悄判合格（2026-10-07 r221 修）
//
// 缺陷（实测，不是推理）—— 体检脚本同一个雷连栽三次：
//   r198 磁盘：判据拿不到用量 ⇒ 永远挂一句「读不到」（真正的病，但每次都黄）；
//   r218 接口速度：只取第二次耗时 ⇒ 冷启动 2211ms 判合格；
//   r220 任务队列：读错嵌套字段 ⇒ 真积压 30 个印「排队 0 个」还判合格。
// 共同点：`x.y || 0` 式写法 —— **字段取不到时值变成 0/null，判据照常判合格**。
// 体检的 bad/warn 会记进 tmp/health.jsonl ⇒ 这种「假绿」一次告警都不会出现在采样里。
//
// 本轮的做法：把「字段没回」和「字段真的是 0」当两件事分开判，统一说人话
// （「这一项等于没盯，体检会一直显示正常其实是空转」），而不是印一句听不出毛病的话。
//
// 本锁的做法：**真跑脚本**（假后端故意漏字段），逐项断言；
// 末尾用 r220 的旧脚本（commit 25b4386）跑同样场景做**反向自检** —— 旧版必须判合格，
// 证明这个洞是真的存在过，不是我编的。
// ⛔ 只读源码抓不到这个洞 —— 旧写法 `q.waiting || 0` 读起来完全像正常代码。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
// ⛔ 反向自检基线锁定 **r220 那次提交**，不能用 HEAD：本轮改完 HEAD 就变成新代码了，
//    拿 HEAD 当「旧版」会让反向自检永远空转（r214 教训）。
// 探针文件由 shell 导出（本机保留，.gitignore 的 `_*` 兜住，不进版本库），
// 换机器/清过临时树时它会不在 ⇒ 那条**显式 skip 而不是静默 return**（r215 教训），
// 免得「没验过的锁」被当成通过。
const OLD_SCRIPT = resolve(ROOT, 'scripts/_r221_old_healthcheck.mjs')

/**
 * 起一个「会故意漏字段」的假后端。
 * 契约与真接口同构（curl 实测过，r220 教训：假后端照抄错误读法会把错误契约固化）：
 *   /api/health        → { status, timestamp, uptimeSec, disk:{path,freeMb,totalMb} }
 *   /api/students      → { students:[...] }
 *   /api/tasks/summary → { success, summary:{ pendingTasks:[], failedTasks:0 } }
 *   /api/queue/stats   → { success, stats:{ waiting,active,failed,available } }
 */
function buildFakeApi({ omit = [] } = {}) {
  const gone = (k) => omit.includes(k)
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      const body = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        disk: { path: '/tmp', freeMb: 900, totalMb: 1024 }
      }
      if (!gone('uptimeSec')) body.uptimeSec = 3600
      return send(body)
    }
    if (req.url === '/api/students') {
      if (gone('students')) return send({ success: true })
      return send({ success: true, students: [{ id: '1', name: '学生A' }] })
    }
    if (req.url === '/api/tasks/summary') {
      if (gone('summary')) return send({ success: true })
      return send({ success: true, summary: { pendingTasks: [], failedTasks: 0 } })
    }
    if (req.url === '/api/queue/stats') {
      // 真接口只有一层 stats，这里**整层都不给**来模拟「接口结构变了」
      if (gone('queueStats')) return send({ success: true })
      return send({ success: true, stats: { waiting: 0, active: 0, failed: 0, available: true } })
    }
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
 * ⛔ 必须**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环，
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

/** 抽某一项的（状态, 行, 详情）。⛔ 状态符号后面跟的空格数不固定（✅ 一个、⚠️ 两个），两边都试。 */
function itemOf(stdout, name) {
  const line = stdout.split('\n')
    .find((l) => l.startsWith('✅ ' + name) || l.startsWith('⚠️  ' + name) || l.startsWith('❌ ' + name))
  if (!line) return null
  return {
    status: line.startsWith('✅') ? 'ok' : line.startsWith('⚠️') ? 'warn' : 'bad',
    line,
    detail: line.slice(line.indexOf('：') + 1)
  }
}

// ── 元判据自证：下面用的判定词必须在本文件里逐字存在，防「判据写错字」造成的假通过 ─────
// ⛔ 常量必须真的被下面用上 —— 声明了不用的常量会让这条锁退化成「声明了两个变量」的假自证（r220 踩过）。
const SELF_PROBE = '任务队列'
const SELF_LITERAL = '排队'
const SELF_MISSING = '等于没盯'

test('元判据自证：探针认得体检输出里的「任务队列」这一项', () => {
  const s = itemOf(`✅ ${SELF_PROBE}：${SELF_LITERAL} 3 个`, SELF_PROBE)
  assert.ok(s, `探针没认出「✅ ${SELF_PROBE}：」这行，判定词或状态符号改过？`)
  assert.equal(s.detail, `${SELF_LITERAL} 3 个`)
  assert.equal(itemOf(`⚠️  ${SELF_PROBE}：${SELF_LITERAL} 9 个`, SELF_PROBE).status, 'warn')
  assert.equal(itemOf(`❌ ${SELF_PROBE}：${SELF_LITERAL} 9 个`, SELF_PROBE).status, 'bad')
  // 新文案必须真的带「等于没盯」这五个字，否则「说人话」这条不成立了
  assert.ok(itemOf(`⚠️  ${SELF_PROBE}：接口没回「${SELF_LITERAL}数量」，这一项${SELF_MISSING}`, SELF_PROBE).detail.includes(SELF_MISSING),
    '「等于没盯」这五个字没进文案，说明改版时把提示语换掉了')
})

// ── 1. 队列整层没了 ⇒ 必须叫醒（旧版印「排队 0 个」还判合格，这就是本轮修的洞）─────
test('队列接口没回数量（结构变了）⇒ 「任务队列」必须判提醒，不能印 0 个说正常', async () => {
  const { server, port } = await startFakeApi({ omit: ['queueStats'] })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.equal(item.status, 'warn', `接口没回数量却判合格：${item.line}`)
    assert.match(item.detail, new RegExp(SELF_MISSING),
      `没说清「这一项等于没盯」（${item.detail}）—— 老师会以为一切正常`)
  } finally {
    server.close() // ⛔ 不关会让测试进程挂住（r218 实测）
  }
})

// ── 2. 任务汇总没了 ⇒ 必须叫醒（旧版会被 `.summary || {}` 吞掉判合格）──────────────
test('任务汇总接口没回数据 ⇒ 「批改失败任务」必须判提醒，不能说「没有失败也没有卡住」', async () => {
  const { server, port } = await startFakeApi({ omit: ['summary'] })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, '批改失败任务')
    assert.ok(item, '体检没输出「批改失败任务」这一项')
    assert.equal(item.status, 'warn', `汇总没回却说一切正常：${item.line}`)
    assert.match(item.detail, new RegExp(SELF_MISSING))
  } finally {
    server.close()
  }
})

// ── 3. 运行分钟数没了 ⇒ 必须叫醒（旧版印「已运行 ? 分钟」照样判合格）────────────────
test('健康检查没回运行分钟数 ⇒ 「后端在线」必须判提醒，不能印一个问号就判合格', async () => {
  const { server, port } = await startFakeApi({ omit: ['uptimeSec'] })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, '后端在线')
    assert.ok(item, '体检没输出「后端在线」这一项')
    assert.equal(item.status, 'warn', `拿不到运行时间却判合格：${item.line}`)
    assert.match(item.detail, new RegExp(SELF_MISSING))
  } finally {
    server.close()
  }
})

// ── 4. 学生名单字段没了 ⇒ 说清是「接口没回」而不是「读到 0 名」────────────────────
test('学生名单字段没回 ⇒ 「数据库可读」判提醒，且文案要说是接口没回、不是名单是空的', async () => {
  const { server, port } = await startFakeApi({ omit: ['students'] })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, '数据库可读')
    assert.ok(item, '体检没输出「数据库可读」这一项')
    assert.equal(item.status, 'warn', `名单没回却判合格：${item.line}`)
    assert.doesNotMatch(item.detail, /读到 0 名学生/,
      `还是那句听不出毛病的话（${item.detail}）—— 明明是接口没回，却说成「读到 0 名」`)
  } finally {
    server.close()
  }
})

// ── 5. 不能误报：字段真的就是 0 ⇒ 必须照旧判合格（r198「恒定黄灯淹掉真告警」）─────
test('字段真的返回 0（不是没回）⇒ 队列/批改这两项必须照旧判合格，不许假报警', async () => {
  const { server, port } = await startFakeApi()
  try {
    const { stdout } = await runHealthcheck(port)
    const queue = itemOf(stdout, SELF_PROBE)
    assert.ok(queue, '体检没输出「任务队列」这一项')
    assert.equal(queue.status, 'ok', `真为 0 却报警：${queue.line}`)
    assert.match(queue.detail, /排队 0 个/)

    const tasks = itemOf(stdout, '批改失败任务')
    assert.ok(tasks, '体检没输出「批改失败任务」这一项')
    assert.equal(tasks.status, 'ok', `真没失败却报警：${tasks.line}`)
  } finally {
    server.close()
  }
})

// ── 6. 反向自检：套 r220 的旧脚本，同样三个漏字段场景必须**判合格**（洞是真的）─────
test('反向自检：r220 的旧脚本在「漏字段」场景下全部判合格（洞确实存在，不是我编的）', async (t) => {
  if (!existsSync(OLD_SCRIPT)) {
    t.skip('反向自检探针未就位：先跑 git show 25b4386:scripts/healthcheck.mjs > scripts/_r221_old_healthcheck.mjs')
  }
  // 三个场景逐条验，逐条点名 —— 只统计「红了几条」会张冠李戴（r213 教训）。
  const scenarios = [
    { omit: ['queueStats'], item: SELF_PROBE, mustMatch: /排队 0 个/ },
    { omit: ['summary'], item: '批改失败任务', mustMatch: /没有失败也没有卡住的任务/ },
    { omit: ['uptimeSec'], item: '后端在线', mustMatch: /已运行 \? 分钟/ }
  ]
  for (const { omit, item, mustMatch } of scenarios) {
    const { server, port } = await startFakeApi({ omit })
    let stdout = ''
    try {
      stdout = (await runHealthcheck(port, OLD_SCRIPT)).stdout
    } finally {
      server.close()
    }
    const got = itemOf(stdout, item)
    assert.ok(got, `旧脚本没输出「${item}」`)
    assert.equal(got.status, 'ok', `旧版「${item}」竟然也判提醒（${got.line}）⇒ 反向自检失效`)
    assert.match(got.detail, mustMatch,
      `旧版「${item}」的场景对不上（${got.detail}）⇒ 这条反向自检验的不是那个洞`)
  }
})
