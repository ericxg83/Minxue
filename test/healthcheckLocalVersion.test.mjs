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
//
// ── 2026-10-08 r242（提案 r241-①）把这条反向自检从「可能永远跳过」改成「每次都真验」──
// 上面那条 `git show` 导出的基线探针 `_r235_old_healthcheck.mjs` **早就不在磁盘上了**
// ⇒ `existsSync` 为假 ⇒ 那条测试一直 `t.skip`。⛔ skip 会被当成"验过"（r215 教训），
// 连续好几轮这条反向自检其实是空转的（假绿家族：门禁看着在，其实没在）。
// 改法：**不依赖 git 导出** —— 拿当前脚本做字符串手术，把 r235 新加的那道本机守卫换回旧写法
// （`behind = comparable && local && local !== short`，local 为 null 时恒假），
// 于是探针永远能造出来、永远能真判红。⛔ 手术必须被自证（见元判据），否则源码一重构就静默失效。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts', 'healthcheck.mjs')
const BASELINE_COMMIT = '362acc2'   // 反向自检的历史基线提交（r235 动手前）。⛔ r242：只作记录，
// ⛔ 不作为判据 —— 声明了却没人用的判据是自欺（r221 教训），那条自证断言已删。

const SELF_PROBE = '代码版本'
// ⛔ 判据自己的关键词（r198/r229 同款元判据：判据写错字会造出假通过）
const SELF_LITERAL_NO_VERSION = '读不出你本地跑的是哪一版'
const SELF_LITERAL_MISSING = '这一项等于没盯'

// ── 反向自检的"手术刀"（r242）：把新加的那道本机守卫换回 r235 之前的旧写法 ──
// 起点：新写法引入的那道守卫。源码里**必须**还是它，否则说明这段被重构过了、手术要重做。
const NEW_LOCAL_GUARD = 'if (comparable && local === null) {'
// 终点锚：`if` 收尾 + 外层 `else` 收尾两行。⛔ r242 自己踩：这行必须**只到 else 收尾**为止 ——
// 多带一个 `  } catch` 就会把 try 的收尾一起切掉 ⇒ 脚本语法断掉、stdout 全空，
// 而断言只会说「没输出这一项」，看不出是脚本没跑起来。
const SURGERY_TAIL = '      }\n    }\n'
// 旧写法（逐字抄自 `git show 362acc2:scripts/healthcheck.mjs` 的 :238-241 行）：
// local 为 null 时 `comparable && local && local !== short` 恒假 ⇒ behind 恒假 ⇒ 印 ✅ 判合格。
const OLD_BEHIND_EXPR = "const behind = comparable && local && local !== short"
const OLD_RECORD_LINE = "record('代码版本', behind ? 'warn' : 'ok',"
const OLD_TAIL = '    }\n'

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
  // ⛔ r241 踩坑：`fs.cpSync(srcDir, 还不存在的 dest, {recursive:true})` 是把 **src 的内容倒进 dest**，
  //    不是 dest/<src名>/ —— 实测拷完 `dir/scripts/` 根本不存在，`dir/` 里直接躺着 healthcheck.mjs。
  //    ⇒ 脚本的 `..` 会跑到临时目录的**上一级**，相对导入全歪（本轮第一次跑全量单测就是红在这：
  //      healthcheck 新版 import `../server/utils/cjkFontState.js`，解析成 Temp/server/utils，模块找不到）。
  //    ⇒ 要造出「脚本在 <root>/scripts/ 下」的仓库布局，必须先 mkdir 出子目录再拷。
  mkdirSync(resolve(dir, 'scripts'), { recursive: true })
  cpSync(resolve(ROOT, 'scripts'), resolve(dir, 'scripts'), { recursive: true })
  // ⛔ 同一条理由：healthcheck 现在还 import `../server/utils/cjkFontState.js`（字体那盏灯的判定
  //    只有这一个出处；scripts/ 复用 server/utils 早有先例 —— backupKit.mjs / nightlyAudit.mjs
  //    import '../server/utils/period.js'）。server/utils 一并按同样层级拷过去。
  //    ⇒ 摆法和仓库一致 ⇒ root = 这个临时目录 ⇒ 照样没有 .git ⇒ 场景一点没变。
  cpSync(resolve(ROOT, 'server', 'utils'), resolve(dir, 'server', 'utils'), { recursive: true })
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
  // ⛔ r242 新增：反向自检的手术刀本身也要能被验（r221 教训：声明了不用的判据 = 假自证）。
  //    ① 体检脚本里确实还有那道新守卫（手术的起点还在）；
  //    ② 测试文件里确实写着旧写法（手术的终点是 r235 之前的真实写法，不是我编的）。
  assert.ok(src.includes(NEW_LOCAL_GUARD),
    `体检脚本里找不到新守卫「${NEW_LOCAL_GUARD}」⇒ 这段被重构过，反向自检的手术范围要跟着重做`)
  assert.ok(src.includes(SURGERY_TAIL), `体检脚本里找不到手术终点锚「${JSON.stringify(SURGERY_TAIL)}」`)
  assert.ok(s.includes(OLD_BEHIND_EXPR), `本文件里没有旧写法「${OLD_BEHIND_EXPR}」⇒ 手术目标都不在`)
  assert.ok(s.includes(OLD_RECORD_LINE), `本文件里没有旧写法那句 record（${OLD_RECORD_LINE}）⇒ 手术目标不在`)
})

/**
 * 把当前脚本的「本机守卫」换回 r235 之前的两行旧写法 ⇒ 旧版的**行为**原样复刻。
 * ⛔ 不调 git（Windows spawnSync 稳定 EBUSY）、不读基线文件（探针缺失 = 一直 skip，r241-①）。
 */
function buildOldStyleScript() {
  const src = readFileSync(SCRIPT, 'utf8')
  const i = src.indexOf(NEW_LOCAL_GUARD)
  assert.ok(i > 0, `起点「${NEW_LOCAL_GUARD}」不在体检脚本里`)
  const j = src.indexOf(SURGERY_TAIL, i)
  assert.ok(j > i, `手术终点锚不在「${NEW_LOCAL_GUARD}」之后`)
  const block =
    `      ${OLD_BEHIND_EXPR}\n` +
    `      ${OLD_RECORD_LINE}\n` +
    `        \`\${behind ? \`线上还是 \${short}，你本地已经是 \${local} ⇒ 这段新代码没上线，去 Render 面板手动部署或确认自动部署\` : \`线上 commit \${short}\`}（\${boot} 启动的）\`)\n` +
    OLD_TAIL
  const out = src.slice(0, i) + block + src.slice(j + SURGERY_TAIL.length)
  // ⛔ 自证：手术真改动了东西、旧写法真的进去了、新守卫真的没了 —— 否则这条自检会"空转判红"
  assert.ok(out !== src, '手术后的脚本与原文一模一样 ⇒ 手术根本没生效，这条反向自检是假验')
  assert.ok(out.includes(OLD_BEHIND_EXPR), '旧写法没进手术后的脚本')
  assert.ok(!out.includes(NEW_LOCAL_GUARD), '新守卫没被摘掉 ⇒ 根本没回到旧行为')
  return out
}

test('本机读不出版本号（脚本旁边没有 git 信息）⇒ 明说没在盯，不许悄悄判合格', async () => {
  const probeDir = makeGitlessProbeDir()
  const { server, port } = await startFakeApi({ commit: '0deadbe' })
  try {
    const { stdout, code } = await runHealthcheck(resolve(probeDir, 'scripts', 'healthcheck.mjs'), port)
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

// ── 反向自检：基线 362acc2（r235 动手前）的旧写法在同样场景下必须判合格 = 洞是真的 ──
// ⛔ r242：不再用 `git show` 导出的基线探针 + existsSync ⇒ 探针丢了就一直 skip（假绿）。
//    改成**每次现做**手术（buildOldStyleScript），探针永远造得出来、这条自检永远不会跳过。
test(`反向自检：${BASELINE_COMMIT} 的旧写法在"没 .git"场景会印 ✅ 判合格（假绿坐实）`, async () => {
  const oldSrc = buildOldStyleScript()
  const probeDir = makeGitlessProbeDir()
  try {
    // 把旧写法顶替到探针目录的 healthcheck.mjs 上（相对导入还在，模块解析照常）
    writeFileSync(resolve(probeDir, 'scripts', 'healthcheck.mjs'), oldSrc)
    const { server, port } = await startFakeApi({ commit: '0deadbe' })
    try {
      const { stdout } = await runHealthcheck(resolve(probeDir, 'scripts', 'healthcheck.mjs'), port)
      const item = itemOf(stdout, SELF_PROBE)
      // ⛔ r242：把完整输出打出来 —— 脚本因手术写坏而根本没跑起来时，stdout 是空的，
      //    「没输出这一项」这五个字看不出是哪种坏（第一版就栽在这，靠这行才定位到）。
      assert.ok(item, `旧版没输出「${SELF_PROBE}」这一项，完整输出：${stdout || '(stdout 为空，脚本没跑起来)'}`)
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
