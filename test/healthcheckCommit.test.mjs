// 回归测试（㊼ 的可观测性一侧）：体检必须把「线上跑的是哪一版代码」说出来（2026-10-07 r229 修）
//
// 缺陷（实测，不是推理）—— `/api/health` 一直回 commit / bootAt 两个字段
// （curl 实测生产：commit=5a6eb5a、bootAt=2026-10-06T15:29:23.693Z），
// 可体检脚本从来不印 ⇒ **「我刚推的新代码到底上没上线」只能人肉 curl 才知道**。
// 代价已经在账上：r220 / r221 / r222 / r224 / r225 / r226 / r227 / r228 八轮都写了
// 「线上 commit 没变、代码没上线」，全靠人工跑一次 curl 才发现，没人会天天手敲。
// 本轮实测（r229）：线上落后 31 个提交、12 小时零重启。
//
// 修法：新增第 7 项「代码版本」——照实印线上版本号 + 启动时刻，
// 并在线上比本地旧时明确说「这段新代码没上线，去 Render 面板手动部署」。
// 沿用 r221 的口径：字段没真读到就要明说，不许悄悄判合格。
//
// 本锁的做法：**真起假后端、真跑脚本**（不读源码猜），逐条断言颜色与文案；
// 末尾拿 r228 提交 `9809c30` 的旧脚本跑同样场景做**反向自检** —— 旧版必须根本没有这一项，
// 证明这个洞真实存在过，不是我编的。
// ⛔ 反向自检基线**钉死到具体提交**，不能用 HEAD：本轮改完 HEAD 就变新代码，
//    拿 HEAD 当「旧版」会让反向自检永远空转（r214 教训）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthcheck.mjs')
// ⛔ r242：基线快照改为**随仓库提交的测试资产**（test/fixtures/healthcheck-baseline-*.mjs），
//    不再用 `git show 9809c30:... > scripts/_r229_old_healthcheck.mjs` 现导、跑完即删。
//    那个做法的后果已经发生：探针文件早就被删了 ⇒ 这条反向自检一直 `t.skip`，
//    而 skip 会被当成"验过"（r215 教训）⇒ 连续多轮空转（假绿家族）。
//    ⛔ 也**不能**用 `_` 前缀存：eslint 的 `**/_*` 会整段忽略它，还会被下轮巡检当成
//    "一次性排障产物"顺手删掉 ⇒ 又回到 skip。所以这里用正经的 fixtures 目录。
const OLD_SCRIPT = resolve(ROOT, 'test', 'fixtures', 'healthcheck-baseline-9809c30.mjs')
const BASELINE_COMMIT = '9809c30'

const SELF_PROBE = '代码版本'
const SELF_LITERAL = '没上线'

/** 本机 HEAD 短号（与体检脚本里那个工具同口径，测试这边也自己读一遍，不复用） */
function localHeadShort() {
  try {
    const head = readFileSync(resolve(ROOT, '.git', 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7)
    const m = head.match(/^ref:\s*(.+)$/i)
    if (!m) return null
    return readFileSync(resolve(ROOT, '.git', m[1].trim()), 'utf8').trim().slice(0, 7)
  } catch {
    return null
  }
}

/**
 * 假后端。契约照抄真接口 /api/health（curl 实测过，r220 教训：
 * 假后端照抄错误读法会把错误契约固化，队列那个洞就是因为假后端先写错才一直没被发现）。
 */
function buildFakeApi({ commit = 'aaaaaaa', bootAt = null, omitCommit = false } = {}) {
  const server = createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/api/health') {
      const body = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSec: 3600,
        disk: { path: '/tmp', freeMb: 900, totalMb: 1024 }
      }
      if (!omitCommit) body.commit = commit
      if (bootAt) body.bootAt = bootAt
      return send(body)
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

/** ⛔ 必须**异步** spawn：假后端跑在测试进程里，spawnSync 会锁死事件循环（r218 实测踩过） */
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

/** 抽某一项的（状态, 行, 详情）。⛔ 状态符号后面空格数不固定（✅ 一个、⚠️ 两个）。 */
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

test(`元判据自证：探针词与关键文案都还在（防判据自己写错字，r198/r229）`, () => {
  const s = readFileSync(import.meta.filename, 'utf8')
  assert.ok(s.includes(SELF_PROBE), `探针词「${SELF_PROBE}」不在本文件里`)
  assert.ok(s.includes(SELF_LITERAL), `关键文案「${SELF_LITERAL}」不在本文件里（判据改过？）`)
  assert.ok(s.includes(BASELINE_COMMIT), `反向自检基线提交 ${BASELINE_COMMIT} 不在本文件里`)
})

test('线上比本地旧 ⇒ 判黄并点名「没上线」和两边的版本号', async () => {
  const local = localHeadShort()
  assert.ok(local, `本机读不到 HEAD 短号，这条测试就白跑了（基线 ${BASELINE_COMMIT}）`)
  const { server, port } = await startFakeApi({ commit: '0deadbe', bootAt: '2026-10-06T15:29:23.693Z' })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.equal(item.status, 'warn', `线上比本地旧却没判黄：${item.line}`)
    assert.ok(item.detail.includes(SELF_LITERAL), `没说清「${SELF_LITERAL}」：${item.line}`)
    // ⛔ 必须两边号都印出来，只印一个等于还得回去翻 git log
    assert.ok(item.detail.includes('0deadbe'), `没印线上版本号：${item.line}`)
    assert.ok(item.detail.includes(local), `没印本地版本号（${local}）：${item.line}`)
    // 启动时刻让人能核对「这版代码是什么时候起来的」
    assert.ok(/\d{2}-\d{2} \d{2}:\d{2}/.test(item.detail), `没印启动时刻：${item.line}`)
  } finally {
    server.close()
  }
})

test('线上与本地一致 ⇒ 判绿，但仍要看得见版本号', async () => {
  const local = localHeadShort()
  assert.ok(local, `本机读不到 HEAD 短号`)
  const { server, port } = await startFakeApi({ commit: local, bootAt: '2026-10-07T09:01:00.000Z' })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.equal(item.status, 'ok', `版本一致却判黄：${item.line}`)
    assert.ok(item.detail.includes(local), `没把线上版本号印出来：${item.line}`)
  } finally {
    server.close()
  }
})

test('接口没回版本号 ⇒ 明说这一项没在盯，不许悄悄合格（r221 口径）', async () => {
  const { server, port } = await startFakeApi({ omitCommit: true })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.equal(item.status, 'warn', `字段没回却判合格：${item.line}`)
    assert.ok(item.detail.includes('这一项等于没盯'), `没说清「这一项等于没盯」：${item.line}`)
  } finally {
    server.close()
  }
})

test('本机后端那种 non-sha 占位（实测 commit="local"）⇒ 照实印但不判黄（防恒定黄灯，r198）', async () => {
  const { server, port } = await startFakeApi({ commit: 'local', bootAt: '2026-10-07T09:01:00.000Z' })
  try {
    const { stdout } = await runHealthcheck(port)
    const item = itemOf(stdout, SELF_PROBE)
    assert.ok(item, `体检没输出「${SELF_PROBE}」这一项`)
    assert.equal(item.status, 'ok', `占位版本号被误判成黄灯（天天黄会把真告警淹掉）：${item.line}`)
    assert.ok(item.detail.includes('local'), `没照实印版本号：${item.line}`)
  } finally {
    server.close()
  }
})

// ── 反向自检：旧版（基线提交 9809c30）在「线上比本地旧」的场景下，根本没有这一项 ──
test(`反向自检：r228 旧脚本（基线 ${BASELINE_COMMIT}）压根不报这件事`, async () => {
  // ⛔ r242：基线快照已随仓库入库（test/fixtures/），这条自检每次都真跑 —— 不再 skip
  //    （skip 会被当成"验过"，r215 教训；此前一直 skip 是基线文件被当成一次性产物删掉的后果）。
  const { server, port } = await startFakeApi({ commit: '0deadbe', bootAt: '2026-10-06T15:29:23.693Z' })
  try {
    const { stdout } = await runHealthcheck(port, OLD_SCRIPT)
    const item = itemOf(stdout, SELF_PROBE)
    assert.equal(item, null,
      `旧版（基线 ${BASELINE_COMMIT}）居然也输出了「${SELF_PROBE}」⇒ 反向自检空转，这个洞可能早就被修过了`)
    // 旧版整份体检的结论里也不该有「没上线」这种提醒（否则说明口径早就有了）
    assert.ok(!stdout.includes(SELF_LITERAL), `旧版已经在说「${SELF_LITERAL}」：${stdout.slice(0, 300)}`)
  } finally {
    server.close()
  }
})
