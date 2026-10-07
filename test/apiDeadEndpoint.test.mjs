/**
 * test/apiDeadEndpoint.test.mjs —— 「后端新暴露的 API，必须有调用方，或者登记为什么没有」（r219）
 *
 * 门禁盯的是什么：后端挂出去的每一条路由，要么有前端/脚本在调，要么在 `apiDeadEndpoints.json`
 * 里登记了决定。**新增一条没人调的后端路由而忘了登记 ⇒ 本锁判红，且点名是哪条。**
 *
 * 为什么它属于「假绿家族」：没人调用的代码**永远不会报错**，所以读代码、跑测试、看告警
 * 都拦不住它无声腐烂（提案 19 的备份脚本、r217 的 nightlyAudit、本轮的重练卷导出，
 * 三枚是同一个病）。只有把「端点」和「调用方」两边同时扫一遍才看得见。
 *
 * 反向自检（实测，非推理）：
 *   - 合成坏样本：在临时树里新加一条零调用方的后端路由 ⇒ 本锁必须判红并点名那条。
 *   - 合成坏样本：把登记册的 reason 删空 ⇒ 必须判红。
 *   - 合成坏样本：登记册里留一条仓库里根本不存在的端点（stale）⇒ 必须判红。
 *   - 元判据自证：先断言「探针里的判据字面量与本测试文件逐字一致」，再跑，防判据写错字的假通过。
 *   - r234：语料必须**去注释** —— 注释里提到端点路径不算「有人调」（假绿家族第九枚）。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  scanServerEndpoints,
  buildCallerCorpus,
  stripComments,
  isReferenced,
  findUnreferencedEndpoints,
  classifyDead,
  auditRegistry
} from './apiCallerAuditKit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REGISTRY_PATH = path.join(__dirname, 'apiDeadEndpoints.json')

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))

/** ⛔ 元判据自证：探针引用的判据必须与本文件逐字一致，否则下面的「绿」不可信 */
const SELF_PROBE = {
  scanFn: 'scanServerEndpoints',
  corpusFn: 'buildCallerCorpus',
  stripFn: 'stripComments',
  unreferencedFn: 'findUnreferencedEndpoints',
  classifyFn: 'classifyDead',
  auditFn: 'auditRegistry',
  registryFile: 'apiDeadEndpoints.json'
}
const testSrc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
for (const [k, v] of Object.entries(SELF_PROBE)) {
  assert.ok(
    testSrc.includes(SELF_PROBE[k]),
    `元判据自证失败：本文件里找不到 ${k} 对应的字面量 ${JSON.stringify(v)}（判据写错字的假通过）`
  )
}

// ── 1. 真的能扫出端点（扫描失效 = 假绿，必须判红）──────────────────────────
const endpoints = scanServerEndpoints(ROOT)
assert.ok(endpoints.length >= 40, `后端端点扫描结果异常：只扫到 ${endpoints.length} 条（期望 ≥40）`)
assert.ok(
  endpoints.includes('GET /api/health'),
  `扫描失效：没扫到已知端点 GET /api/health（扫到 ${endpoints.length} 条）`
)

// ── 2. 调用方语料必须真的非空（空语料会让所有端点都判成死端点）─────────────
const corpus = buildCallerCorpus(ROOT)
assert.ok(corpus.length > 200000, `调用方语料异常小：${corpus.length} 字节（语料没扫到，门禁会全红）`)
assert.ok(corpus.includes('/api/health'), '语料里找不到 /api/health ⇒ 语料没扫到 src/，判定不可信')

// ── 3. 已知被调的端点必须判「有调用方」─────────────────────────────────────
// 这四个是老师天天在用的主链路，判成死端点说明匹配逻辑坏了。
const MUST_HAVE_CALLER = [
  'GET /api/health',
  'GET /api/students',
  'POST /api/tasks/notifications/read',
  'GET /api/weekly-report'
]
for (const r of MUST_HAVE_CALLER) {
  assert.ok(endpoints.includes(r), `扫描结果里没有已知端点 ${r}`)
  assert.equal(isReferenced(corpus, r), true, `${r} 明明有人调，却被判成零调用方 ⇒ 匹配逻辑坏了（假绿）`)
}

// ── 4. 主链路：所有死端点（业务类）都必须已在登记册里 ───────────────────────
const dead = findUnreferencedEndpoints(ROOT)
const { business, ops } = classifyDead(dead)
// 光打印不判红：运维类死端点是允许的，本锁不拦（数量只作观测，防止哪天暴涨没人看）
console.log(`      · 死端点共 ${dead.length} 条（运维 ${ops.length} / 业务 ${business.length}）`)

const { missing, stale, badReason } = auditRegistry(business, registry)
assert.deepEqual(missing, [], `以下业务端点零调用方且未登记决定：${missing.join(' | ')}`)
assert.deepEqual(stale, [], `登记册里有仓库里根本不存在的端点（登记过期）：${stale.join(' | ')}`)
assert.deepEqual(badReason, [], `登记册里以下条目的 reason 太短/缺失，等于没登记：${badReason.join(' | ')}`)

// ── 5. 本轮实测的真实死端点必须都在扫描结果里（防止扫描悄悄失灵）───────────
// 它们是本轮取证的依据；若哪天这些端点真被删/真被接线，本条会红 ⇒ 提醒同步更新登记册。
const MEASURED_DEAD = [
  'POST /api/wrong-questions/export-retry-pdf',
  'POST /api/wrong-questions/figure-relocate',
  'POST /api/questions/batch-update-tags',
  'GET /api/teaching/error-types',
  'GET /api/teaching-question-types/hot-kp',
  'GET /api/teaching-question-types/candidates',
  'GET /api/weakness/class'
]
for (const r of MEASURED_DEAD) {
  assert.ok(dead.includes(r), `本轮实测的死端点 ${r} 现在扫不出来了（要么被删、要么被接线，需同步更新登记册）`)
}

// ── 6. 反向自检：合成坏样本，每条都必须判红 ─────────────────────────────────

/**
 * 造一棵只含必要目录的临时树，模拟「新加了一条没人调的后端路由」。
 * ⛔ 固定路径、用完**不删**：本机 safe-delete shim 会拦 rmSync 删目录
 * （r198 踩过），测试进程里删不掉会直接崩；`tmp/` 已 gitignore，留着无害。
 */
const FAKE_TREE = path.join(ROOT, 'tmp/_r219_deadep')
function makeFakeTree(indexJs, appJsx) {
  fs.mkdirSync(path.join(FAKE_TREE, 'server/routes'), { recursive: true })
  fs.mkdirSync(path.join(FAKE_TREE, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(FAKE_TREE, 'server/routes/fakeRouter.js'),
    `export default {}\nrouter.post('/api/r219/fake-new-endpoint', async () => {})\n`
  )
  fs.writeFileSync(path.join(FAKE_TREE, 'src/App.jsx'), appJsx)
  fs.writeFileSync(path.join(FAKE_TREE, 'server/index.js'), indexJs)
  return FAKE_TREE
}

// 6a. 新加零调用方业务端点 ⇒ 必红，且点名
{
  const dir = makeFakeTree(`app.get('/api/health', (_q, s) => s.json({}))\n`, `apiRequest('/api/health')\n`)
  const found = findUnreferencedEndpoints(dir)
  const { business } = classifyDead(found)
  assert.ok(
    business.includes('POST /api/r219/fake-new-endpoint'),
    `反向自检失效：新加的零调用方端点没被判红（扫到 ${business.length} 条业务死端点）`
  )
  const { missing } = auditRegistry(business, { endpoints: {} })
  assert.deepEqual(missing, ['POST /api/r219/fake-new-endpoint'], '反向自检：missing 必须逐字点名那条新端点')
}

// 6b. 前端确实调过 ⇒ 必须判「有调用方」（防扫描把正常端点误判成死端点）
{
  const dir = makeFakeTree(
    `app.get('/api/health', (_q, s) => s.json({}))\napp.post('/api/r219/called', (_q, s) => s.json({}))\n`,
    `apiRequest('/api/health')\ncall('/api/r219/called')\n`
  )
  const found = findUnreferencedEndpoints(dir)
  assert.ok(
    !found.includes('POST /api/r219/called'),
    '反向自检失效：前端明明调了 /api/r219/called，却判成零调用方（会造出假红）'
  )
}

// 6c. 登记册 reason 被清空 ⇒ 必红
{
  const bad = { endpoints: { 'POST /api/r219/fake-new-endpoint': { reason: '太短' } } }
  const { badReason } = auditRegistry(['POST /api/r219/fake-new-endpoint'], bad)
  assert.deepEqual(badReason, ['POST /api/r219/fake-new-endpoint'], '反向自检失效：reason 太短竟然判绿')
}

// 6d. 登记册留了一条仓库里不存在的端点（stale）⇒ 必红
{
  const { stale } = auditRegistry([], { endpoints: { 'POST /api/r219/gone-forever': { reason: '这条确实已经没人用了' } } })
  assert.deepEqual(stale, ['POST /api/r219/gone-forever'], '反向自检失效：stale 未判红')
}

// ── 7. r234：注释不算调用方（假绿家族第九枚：判据取错了语料）──────────────────
// 语料原来是**原始全文** ⇒ 一条 `// 旧接口 /api/x 已废弃` 就能把零调用方的新端点洗成
// 「有人调」，门禁于是假绿。去注释后注释不再顶替调用方；真调用照旧判「有人调」。
{
  const route = 'POST /api/r234/comment-only'
  const commentOnly = '// 已下线：POST /api/r234/comment-only，改走别的通道\nconst a = 1\n'
  const realCall = `apiRequest('/api/r234/comment-only')\n`

  // ① 旧口径（不去注释）会把注释里的路径当调用方 —— 这正是洞
  assert.equal(
    isReferenced(commentOnly, route), true,
    '反向自检失效：旧口径对「只有注释提到」的路径应当判「有人调」（这正是被堵的缺陷）'
  )
  // ② 新口径（去注释）必须判「零调用方」
  assert.equal(
    isReferenced(stripComments(commentOnly), route), false,
    '反向自检失效：去注释后仍把注释当调用方 ⇒ 门禁假绿'
  )
  // ③ 去注释不许误伤真调用（否则会造出假红）
  assert.equal(
    isReferenced(stripComments(realCall), route), true,
    '反向自检失效：真调用被去注释误伤成零调用方（假红）'
  )
  // ④ 去注释不许碰字符串里的 `//`（URL 等）
  assert.ok(
    stripComments(`const u = 'https://example.com/x'\n`).includes('https://example.com/x'),
    '反向自检失效：去注释把字符串里的 https:// 也剥了（会误伤真调用）'
  )
  // ⑤ 无注释的源码逐字不变（去注释是恒等变换的一部分）
  assert.equal(stripComments(realCall), realCall, '反向自检失效：无注释源码被改动了')
  // ⑥ 块注释同样要剥
  assert.ok(
    !stripComments(`/* 说明：POST /api/r234/comment-only */\nconst b = 2\n`).includes('/api/r234/comment-only'),
    '反向自检失效：块注释里的路径没被剥掉'
  )
}

console.log(`      · 死端点门禁：扫描 ${endpoints.length} 条端点，业务死端点 ${business.length} 条全部已登记`)
