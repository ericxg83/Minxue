// 回归测试（提案 ㊮ 落地，2026-10-07 r235 修）：「代码版本」这项压根没比过，却报合格
//
// 缺陷（r234 实测坐实，不是推理）—— 体检第 7 项「代码版本」要判断线上有没有换代码，
// **得两边都有号才能比**：线上 `/api/health` 回了 `commit`（sha）、本机 HEAD 却读不出来时，
// 旧写法 `behind = comparable && local && local !== short` 里 `local` 为 null ⇒ `behind` 恒假
// ⇒ 印 `✅ 代码版本：线上 commit 5a6eb5a`（判合格）。
// 看着这一项在盯，其实**一次都没比过** —— r221 立的「字段没真读到必须明说」只堵住了
// 线上那一半（接口没回 commit），本机这一半是它的漏网。
// 实测：把脚本复制到没有 .git 的目录跑生产，输出的就是上面那句 ✅（r234 取证）。
// 体检的 warn/bad 会记进 tmp/health.jsonl ⇒ 这类假绿一次告警都不会出（假绿家族）。
//
// 修法：`comparable && local === null` ⇒ 走专门的提醒，说清「读不出你本地这一版 + 把脚本放回
// 仓库再跑」；线上号和启动时刻照旧印。⛔ 措辞不甩「git 目录结构」这类词，只说后果 + 下一步
// （r198 教训：夸大的告警比没告警更糟；负责人不看技术词）。
//
// 本锁做法：**真起假后端 + 真跑脚本**（不读源码猜）。关键手法是把整个 `scripts/` 拷到
// 系统临时目录（脚本有相对导入 `./healthDiskState.mjs`，单拷一个文件会模块解析失败；
// 而拷整目录后 root 就是那个临时目录 ⇒ 天然"没有 .git" ⇒ 精确地造出本机读不到版本号的场景）。
// ⛔ 假后端跑在测试进程里，必须**异步 spawn**（spawnSync 锁死事件循环，r218 实测踩过）。
//
// 末尾反向自检**基线钉死 `362acc2`**（本轮动手前的提交）：同一"没 .git"场景下，旧版必须
// 印 ✅ 判合格 —— 证明这个洞真实存在过，不是我编的。
// ⛔ 不能用 HEAD 当基线：本轮一提交 HEAD 就变新代码，反向自检会永远空转（r214/r221 教训）。
// ⛔ 反向自检禁止 spawnSync 调 git（Windows 稳定 EBUSY）⇒ 用 shell `git show` 导出到 `scripts/_r235_*`。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts', 'healthcheck.mjs')
const BASELINE_COMMIT = '362acc2'   // 本轮动手前的提交（r235）
const OLD_SCRIPT = resolve(ROOT, 'scripts', '_r235_old_healthcheck.mjs')

const SELF_PROBE = '代码版本'
// ⛔ 判据自己的关键词（r198/r229 同款元判据：判据写错字会造出假通过）
const SELF_LITERAL_NO_VERSION = '读不出你本地跑的是哪一版'
const SELF_LITERAL_MISSING = '这一项等于没盯'

/**
 * 假后端。契约照抄真接口 /api/health（curl 实测过；r220 教训：假后端照抄错误读法会把错误
 * 契约固化，队列那个洞就是因为假后端先写错才一直没被发现）。
 */
function buildFakeApi({ commit = 'aaaaaaa', bootAt = '2026-10-07T09:01:00.000Z' } = {}) {
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
        commit,
        bootAt,
        disk: { path: '/tmp', freeMb: 900, totalMb: 1024 }
      })
    }
    if (req.url === '/api/students') return send({ success: true, students: [{ id: '1', name: '学生A' }] })
    if (req.url === '/api/tasks/summary') return send({ success: true, summary: { pendingTasks: [], failedTasks: 0 } })
    if (req.url === '/api/queue/stats') return send({ success: true, stats: { waiting: 0, active: 0, failed: 0, available: true } })
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

/** ⛔ 必须异步 spawn：spawnSync 会锁死事件循环，请求到不了假后端（r218 实测） */
function runHealthcheck(scriptPath, port) {
  return new Promise((done, reject) => {
    const p = spawn(process.execPath, [scriptPath, '--api', `http://127.0.0.1:${port}`], { cwd: ROOT })
    let stdout = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.on('error', reject)
    p.on('close', (code) => done({ code, stdout }))
  })
}

/** 抽某一项的（状态, 行, 详情）。⛔ 状态符号后面的空格数不固定（✅ 一个、⚠️ 两个）。 */
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

/**
 * 造一个「没有 .git 的脚本目录」—— 整份 scripts/ 拷到系统临时目录。
 * 脚本按 `dirname(script)/..` 定位仓库根 ⇒ 那个临时目录就是"仓库根"，天然没 .git
 * ⇒ readLocalHeadShort() 会返回 null，精确地复现本机读不到版本号的场景。
 */
function makeGitlessProbeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'minxue-r235-'))
  cpSync(resolve(ROOT, 'scripts'), dir, { recursive: true })
  return dir
}

test('元判据自证：探针词与关键文案都还在源码里（防判据自己写错字，r198/r229/r221）', () => {
  const s = readFileSync(import.meta.filename, 'utf8')
  assert.ok(s.includes(SELF_LITERAL_NO_VERSION), `判据常量「${SELF_LITERAL_NO_VERSION}」不在本文件里`)
  assert.ok(s.includes(BASELINE_COMMIT), `反向自检基线提交 ${BASELINE_COMMIT} 不在本文件里`)
  // ⛔ 再回头验一遍**被盯的脚本本身**：文案被改了而判据还在，锁就变成空转（r198/r229 同款）
  const src = readFileSync(SCRIPT, 'utf8')
  assert.ok(src.includes(SELF_LITERAL_NO_VERSION),
    `体检脚本里没有「${SELF_LITERAL_NO_VERSION}」⇒ 判据盯的东西早被改掉了，这条锁是空转`)
  assert.ok(src.includes(SELF_LITERAL_MISSING), `体检脚本里没有「${SELF_LITERAL_MISSING}」`)
})

test('本机读不出版本号（脚本旁边没有 git 信息）⇒ 明说没在盯，不许悄悄判合格', async () => {
  const probeDir = makeGitlessProbeDir()
  const { server, port } = await startFakeApi({ commit: '0deadbe' })
  try {
    const { stdout, code } = await runHealthcheck(resolve(probeDir, 'healthcheck.mjs'), port)
    assert.equal(code, 0, `体检非正常退出：${stdout}`)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项：${stdout.slice(0, 300)}`)
    // ⛔ 洞就在这：旧版这个场景会印 ✅ 判合格
    assert.equal(item.status, 'warn', `本机版本号读不出来却判合格（假绿）：${item.line}`)
    assert.ok(item.detail.includes(SELF_LITERAL_NO_VERSION),
      `没说清「读不出你本地跑的是哪一版」：${item.line}`)
    assert.ok(item.detail.includes(SELF_LITERAL_MISSING),
      `没说清「这一项等于没盯」：${item.line}`)
    // 必须给下一步（负责人照着做就行，别让他猜）
    assert.ok(item.detail.includes('放回仓库'), `没给出下一步「把脚本放回仓库」：${item.line}`)
    // 线上那一半的信息不能丢
    assert.ok(item.detail.includes('0deadbe'), `没照实印线上版本号：${item.line}`)
  } finally {
    server.close()
    rmSync(probeDir, { recursive: true, force: true })
  }
})

test('对照（脚本在仓库里、本机读得到版本号）⇒ 不报"读不出本地版"，更不许天天黄灯', async () => {
  // ⛔ r198 教训：这条是防"恒定黄灯淹掉真告警"的对照 —— 正常场景下这条提醒根本不该出现
  const { server, port } = await startFakeApi({ commit: '0000000' })
  try {
    const { stdout } = await runHealthcheck(SCRIPT, port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.ok(!item.detail.includes(SELF_LITERAL_NO_VERSION),
      `仓库里跑得好好的，却报「读不出你本地跑的是哪一版」⇒ 这盏灯天天亮会把真告警淹掉：${item.line}`)
  } finally {
    server.close()
  }
})

// ── 反向自检：基线 362acc2（本轮动手前）在同样场景下必须判合格 = 洞是真的 ──
test(`反向自检：基线 ${BASELINE_COMMIT} 的旧脚本在"没 .git"场景会印 ✅ 判合格（假绿坐实）`, async (t) => {
  if (!existsSync(OLD_SCRIPT)) {
    // ⛔ 探针不在就显式 skip，不是静默 return（r215 教训：没验过的锁被当成通过）
    t.skip(`基线探针 ${OLD_SCRIPT} 不在（导出命令：git show ${BASELINE_COMMIT}:scripts/healthcheck.mjs > scripts/_r235_old_healthcheck.mjs）`)
    return
  }
  const probeDir = makeGitlessProbeDir()
  try {
    // 把旧脚本顶替到探针目录的 healthcheck.mjs 上（相对导入还在，模块解析照常）
    writeFileSync(resolve(probeDir, 'healthcheck.mjs'), readFileSync(OLD_SCRIPT))
    const { server, port } = await startFakeApi({ commit: '0deadbe' })
    try {
      const { stdout } = await runHealthcheck(resolve(probeDir, 'healthcheck.mjs'), port)
      const item = itemOf(stdout, SELF_PROBE)
      assert.ok(item, `旧版没输出「${SELF_PROBE}」这一项`)
      assert.equal(item.status, 'ok',
        `旧版（基线 ${BASELINE_COMMIT}）在这个场景居然判黄了 ⇒ 说明这个洞早就被修过，反向自检空转：${item.line}`)
      assert.ok(!item.detail.includes(SELF_LITERAL_NO_VERSION),
        `旧版已经在说「${SELF_LITERAL_NO_VERSION}」：${item.line}`)
    } finally {
      server.close()
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
})
