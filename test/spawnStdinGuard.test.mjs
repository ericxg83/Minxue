/**
 * 回归锁：本机「同步起子进程 + stdin 管道 = EBUSY」这条约束，不许再被踩第二次。
 *
 * 背景（2026-10-07 实测，不是推理）：本机沙箱拦 CreateProcessW，同步接口 + 子进程 stdin 走管道时必失败
 * （EBUSY / errno -4082 / status=null）。修之前它造成的静默失效：
 *   · 单测 14 条常红（healthTrend 11 + auditStoreContractWorks 3），被当成「代码回归」查了几轮
 *   · scripts/patrol daemon 的自动提交静默不执行、patrol.mjs 非 silent 分支全废
 *   · scripts/loopGuard 远端检查恒返回「无网络」
 *   · scripts/dev/keep_backend 的僵尸清理成死代码（listeners() 恒空 ⇒ 端口被占时会再拉一个后端）
 *   · scripts/pruneDeadDeclarations 恒「未产出报告」退出 1
 * 唯一实现已收敛到 server/utils/localSpawn.js（scripts/ 与 test/ 共用）。
 *
 * 三道锁：
 *   ① test/*.test.mjs 不许裸写 spawnSync / execSync / execFileSync（必须走 localSpawn）
 *   ② scripts/ 与 server/ 里同步起子进程必须显式给出**本机可用**的 stdio（默认=管道 ⇒ 必败）
 *   ③ 共享入口真跑得起来（写了没验等于没写），且显式管道会被归一化
 * ⛔ 锁里**不**断言「裸写一定失败」—— 那条在别的机器上不成立，会把锁变成机器专属。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNodeScript } from '../server/utils/localSpawn.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** 同步起子进程的三个接口：只要子进程 stdin 是管道，本机必败 */
const SYNC_SPAWN_RE = /\b(?:spawnSync|execSync|execFileSync)\s*\(/
/** 本机用不了的 stdio 形状（全是「stdin 走管道」的写法） */
const STDIO_PIPE_RE = /stdio\s*:\s*(?:'pipe'|"pipe"|\[\s*['"]pipe['"])/

/** 粗略去注释：锁只该盯代码，不该因为「注释里提了一句」判红（本锁第一版就自伤过） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
}

/** 递归收集目录下的 .mjs/.js（跳过 node_modules 与 _ 开头的临时探针） */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p, out); continue }
    if (!/\.(?:mjs|js)$/.test(e.name) || e.name.startsWith('_')) continue
    out.push(p)
  }
  return out
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')

test('① test/*.test.mjs 不许裸写同步起子进程的接口（必须走 localSpawn）', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs'))
  assert.ok(files.length > 100, `扫描本身要能扫到测试文件（实际 ${files.length} 个）—— 扫不到时的绿色是假绿`)
  const bad = []
  for (const f of files) {
    const raw = readFileSync(join(HERE, f), 'utf8')
    const code = stripComments(raw)
    assert.ok(code.length > raw.length * 0.4, `${f} 去注释把代码也吃掉了（锁本身失效，不许判绿）`)
    if (SYNC_SPAWN_RE.test(code)) bad.push(f)
  }
  assert.deepEqual(
    bad,
    [],
    `这些测试裸写了同步起子进程的接口（本机 spawnSync/execSync + stdin 管道必 EBUSY，会常红成假回归）：\n  ${bad.join('\n  ')}\n改用 server/utils/localSpawn.js 的 runNodeScript([脚本, ...参数], 选项)`
  )
})

/** 唯一实现自己：全仓唯一允许直接调 spawnSync 的地方（它就是那层兼容，别处一律不许） */
const IMPL = 'server/utils/localSpawn.js'

test('② scripts/ 与 server/：同步起子进程必须显式给出本机可用的 stdio', () => {
  const files = [...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'server'))]
  assert.ok(files.length > 50, `扫描本身要能扫到文件（实际 ${files.length} 个）—— 扫不到时的绿色是假绿`)
  const bad = []
  for (const f of files) {
    if (!statSync(f).isFile()) continue
    if (rel(f) === IMPL) continue // 实现本体自己就是那个兼容层
    const code = stripComments(readFileSync(f, 'utf8'))
    const re = new RegExp(SYNC_SPAWN_RE.source, 'g')
    let m
    while ((m = re.exec(code)) !== null) {
      const call = code.slice(m.index, m.index + 500)
      if (STDIO_PIPE_RE.test(call)) {
        bad.push(`${rel(f)} → stdio 用了管道（本机必 EBUSY）`)
      } else if (!/stdio/.test(call)) {
        bad.push(`${rel(f)} → 没给 stdio（默认走管道 ⇒ 本机必 EBUSY）`)
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    `这些调用在本机起不来子进程（静默失效：状态会是 null，看着像「跑完没输出」）：\n  ${bad.join('\n  ')}\n改法：import { spawnLocal } from '<相对路径>/server/utils/localSpawn.js' 后用它；\n或至少显式写 stdio: ['ignore', 'pipe', 'pipe']（原因见该文件头注释）`
  )
})

test('③ 共享入口真能跑：跑一次 node 拿到 stdout 且退 0（写了没验等于没写）', () => {
  const r = runNodeScript(['-e', 'process.stdout.write("入口可用")'])
  assert.equal(r.status, 0, `runNodeScript 应能起来子进程并退 0，实际 status=${r.status} error=${r.error && r.error.code}`)
  assert.match(String(r.stdout), /入口可用/, 'stdout 要真拿到（管道读不回来就是白跑）')
})

test('④ 负面自检：显式传管道 stdio 也会被归一化；喂 stdin 本机不通只允许是 EBUSY', () => {
  // (a) 调用方显式传管道 stdio：也要被改回 ignore，否则照样 EBUSY
  const r = runNodeScript(['-e', 'process.stdout.write("ok")'], { stdio: ['pipe', 'pipe', 'pipe'] })
  assert.equal(r.status, 0, `显式管道 stdin 应被归一化，实际 status=${r.status} error=${r.error && r.error.code}`)
  assert.match(String(r.stdout), /ok/)

  // (b) 真要喂 input 时保留管道 —— ⛔ 本机连这条路也不通（EBUSY），所以测试别依赖 input：
  //     能跑通就校验内容；跑不通必须是 EBUSY（别的错误码才是真错）。没有拦截的机器上走前半支。
  const r2 = runNodeScript(['-e', 'process.stdin.on("data",d=>process.stdout.write("收到:"+d))'], { input: '你好' })
  if (r2.status === 0) {
    assert.match(String(r2.stdout), /收到:你好/, 'input 喂进去了就必须真读到')
  } else {
    assert.equal(r2.error && r2.error.code, 'EBUSY', `喂 stdin 失败只允许是本机的 EBUSY 拦截，实际 ${r2.error && r2.error.code}`)
  }
})
