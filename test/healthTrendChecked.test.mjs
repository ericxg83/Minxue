// 回归测试（r246-① + r247-①）：体检采样「这次盯了几项 / 亮的时候说了什么」+ 趋势按机器分组
//
// 背景（实测，不是推理）：
//   ① r246 用仓库外的假后端真跑 healthcheck，实锤「某项压根没执行」和「某项全绿」
//      在采样日志里**逐字相同** —— 后端连不上时整趟体检只跑 1 项，采样照样是
//      `{"bad":["后端在线"]}`，跟「盯满 8 项、7 绿 1 红」长得一模一样，事后分不出来。
//   ② r247 发现 `scripts/healthTrend.mjs` 从头没读过采样行的 `api` ⇒ 本机 + 线上
//      混成一条趋势：实测现网 60 条里已混进 1 条本机行，本机 5 条磁盘黄灯被讲成
//      「线上最近连续 5 条在亮」（线上一条没亮），「1300 分钟 → 23 分钟」其实是两台机器。
//      ⛔ `healthcheck.mjs` 的 `--api` 默认值就是本机，谁不带 --api 跑一次写进同一个文件，
//      这条趋势立刻变脏且毫无提示。
//
// 本锁的做法（沿用 r221/r233/r239 纪律）：
//   1) **真跑脚本**（合成采样喂进去，不碰仓库里那份真实采样）；
//   2) ⛔ **反向自检必须能判红**：同一份合成采样喂给「改动前的基线脚本」
//      （`test/fixtures/healthTrend-baseline-49a7339.mjs`，r242-① 的 fixtures 落地做法）
//      ⇒ 新判据那条必须红、基线那条必须绿；只数条数不算数，要看颜色；
//   3) 元判据：先断言新文案真的在脚本里（防判据写错字 ⇒ 假通过，r198/r237/r239 同款）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runNodeScript } from '../server/utils/localSpawn.js'

const ROOT = resolve(import.meta.dirname, '..')
const NEW_SCRIPT = resolve(ROOT, 'scripts/healthTrend.mjs')
// ⛔ 基线必须随仓库入库（r242-①）：早先那几轮把反向自检探针写成「跑完即删」，
//    探针不在盘上 ⇒ 对应用例永远 t.skip，而 skip 会被当成验过（r215 教训）。
const BASE_SCRIPT = resolve(ROOT, 'test/fixtures/healthTrend-baseline-49a7339.mjs')
const NEW_SRC = readFileSync(NEW_SCRIPT, 'utf8')
const BASE_SRC = readFileSync(BASE_SCRIPT, 'utf8')

/** 真跑脚本（只读文件，不联网）。⛔ 起子进程必须走 nodeRunKit（本机 spawnSync + stdin 管道必 EBUSY） */
function run(script, args) {
  const r = runNodeScript([script, ...args])
  assert.equal(r.status, 0, `${script} 退出码应为 0（纯查看），实际 ${r.status}：${r.stderr}`)
  return r.stdout
}
function runNew(args) { return run(NEW_SCRIPT, args) }
/** 喂基线脚本：拿「改动前那份真脚本」跑同一份数据。 */
function runBase(args) { return run(BASE_SCRIPT, args) }

/** 造一份合成采样（全部指向线上）。 */
function buildFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'htrend-'))
  const file = join(dir, 'health.jsonl')
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return file
}

const NAMES = ['后端在线', '接口速度', '数据库可读', '批改失败任务', '任务队列', '服务器磁盘', '代码版本', '家长卡片中文字']
const at = (i, hour = 1) => new Date(Date.UTC(2026, 9, 8, hour, i * 6)).toISOString()
/** 一条「盯满 8 项、全绿」的线上采样（i 从 0 起）。 */
const full = (i, opts = {}) => ({
  t: at(i),
  kind: 'backend',
  api: 'https://minxue-api.onrender.com',
  checked: 8,
  checkedNames: NAMES,
  lit: {},
  upMin: 600 + i,
  rtMs: 900,
  bad: [],
  warn: [],
  ...opts,
})
/** 一条「后端压根没连上」的采样：整趟体检只跑了「后端在线」1 项，其余 7 项压根没执行。 */
const onlyBackendDown = (i) => full(i, {
  checked: 1,
  checkedNames: ['后端在线'],
  lit: { '后端在线': '连不上（fetch failed）。本地跑 127.0.0.1:4000 启动' },
  bad: ['后端在线'],
  upMin: null,
})

// ── 元判据：先证明「我锁的那些话，新脚本里有、基线里没有」 ──────────────────
// ⛔ 这是防假通过的第一道：文案若被顺手改掉，下面所有颜色断言都会失去意义；
//    反过来，基线里没有这些话才说明「反向自检真的能判红」，而不是判据本来就恒真。
test('元判据：新加的三句人话在新脚本里，且不在改动前的基线里（防判据写错字/基线放错）', () => {
  for (const s of [
    '这次盯了几项', // 盯满时说这一句
    '这次只盯了', // 只盯了一部分时说这一句
    '下面按机器分开讲', // 多机器混采样时必须点明
  ]) {
    assert.ok(NEW_SRC.includes(s), `新脚本里应有这句（改文案要同步改这里）：${s}`)
    assert.ok(!BASE_SRC.includes(s), `基线（改动前）里不应有「${s}」—— 有就说明基线抄错了，反向自检会假绿`)
  }
  // ⛔ 元判据自己也要能被验：断言用的字面量必须真的被上面的分支用到，
  //    写成「声明了没用」就成了 r220 那款的假自证。
  assert.match(NEW_SRC, /这次只盯了 \$\{/)
  assert.match(NEW_SRC, /这次盯了几项：/)
})

test('元判据：两处新判据的执行路径都在（盯项缺口 / 多机器分组）', () => {
  assert.match(NEW_SRC, /shortCount/)
  assert.match(NEW_SRC, /lastLitDetail/)
  assert.match(NEW_SRC, /const groups =/)
  // ⛔ 基线的判据形状必须跟新脚本不同，否则「旧版判红」这条根本不成立
  assert.ok(!BASE_SRC.includes('shortCount'))
  assert.ok(!BASE_SRC.includes('lastLitDetail'))
})

// ── ② 这次到底盯了几项（r246-①）─────────────────────────────────────────
test('最新一次只盯了 1 项：必须点名少了哪几项，且不许当成整体正常', () => {
  const file = buildFile([full(0), full(1), full(2), onlyBackendDown(3)])
  try {
    const out = runNew(['--file', file, '--n', '4'])
    assert.ok(out.includes('这次只盯了 1 项'), '只跑了 1 项时必须明说，光记灯名是看不出来的')
    assert.ok(out.includes('少了 7 项'), '应报出少了几项')
    // ⛔ 必须点名是哪几项，不然负责人还是不知道该去核哪一项
    for (const n of ['家长卡片中文字', '代码版本', '任务队列']) {
      assert.ok(out.includes(n), `应点名漏掉的那一项：${n}`)
    }
    assert.ok(!out.includes('8 项全跑了'), '只盯 1 项时不许说「全跑了」')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('★反向自检：同一份采样喂「改动前的基线脚本」—— 它必须一条都不报（洞是真的）', () => {
  const file = buildFile([full(0), full(1), full(2), onlyBackendDown(3)])
  try {
    const oldOut = runBase(['--file', file, '--n', '4'])
    assert.ok(!oldOut.includes('这次只盯了'), '旧版压根不知道「这次盯了几项」这一回事')
    assert.ok(!oldOut.includes('没盯全'), '旧版也不会提「没盯全」')
    // ⛔ 旧版唯一能说的是有红：「1 次需要处理（红色）」，但那说的是**结果**，
    //    不是「这次其实只查了一项」—— 正是 r246 说的两个日志逐字相同。
    const nowOut = runNew(['--file', file, '--n', '4'])
    assert.ok(nowOut.includes('这次只盯了 1 项'), '新版在同一份数据上必须能报出来（旧版报不出 ⇒ 洞是真的）')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('方向性：最新一次盯满 8 项时，不许再说「只盯了」（判据不能恒真）', () => {
  const file = buildFile([full(0), full(1), full(2), full(3)])
  try {
    const out = runNew(['--file', file, '--n', '4'])
    assert.ok(out.includes('8 项全跑了'), '盯满时应照实说盯了 8 项')
    assert.ok(!out.includes('这次只盯了'), '全跑完还说「只盯了」就是恒真的空话')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('盯满但窗口里前面有几次没盯全：必须补一句，不许被「最近一次全跑了」盖掉', () => {
  const short = onlyBackendDown(3)
  const file = buildFile([full(0), full(1), short, full(3)])
  try {
    const out = runNew(['--file', file, '--n', '4'])
    assert.ok(out.includes('8 项全跑了'), '最后一次是真的盯满了，要照实说')
    assert.ok(out.includes('有 1 次没盯全'), '但前面那次要单独点出来，否则「没盯全」永远看不见')
    assert.ok(out.includes('只跑了 1 项'), '应把最少那次的项数报出来')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

// ── ③ 亮的时候到底说了什么（r245-①）──────────────────────────────────────
test('亮的时候那句人话要印出来；没记的话不许编（r245-①）', () => {
  const withDetail = buildFile([
    full(0, { warn: ['服务器磁盘'], lit: { '服务器磁盘': '还剩 210MB，离用光不远了' } }),
    full(1),
  ])
  try {
    const out = runNew(['--file', withDetail, '--n', '2'])
    assert.ok(out.includes('还剩 210MB，离用光不远了'), '亮的时候那句原话要能回看，否则只知道「亮过」')
  } finally {
    rmSync(join(withDetail, '..'), { recursive: true, force: true })
  }
  const noDetail = buildFile([
    full(0, { warn: ['服务器磁盘'] }), // 老格式：只有灯名，没有那一刻的话
    full(1),
  ])
  try {
    const out = runNew(['--file', noDetail, '--n', '2'])
    assert.ok(out.includes('服务器磁盘'), '灯名照旧要报')
    assert.ok(!out.includes('亮的时候那句是'), '没记那一句就不许硬编一句出来（r198：夸大的提示比没提示更糟）')
    assert.ok(runBase(['--file', noDetail, '--n', '2']).includes('服务器磁盘'), '基线本来就会印灯名，这条不是新行为')
  } finally {
    rmSync(join(noDetail, '..'), { recursive: true, force: true })
  }
})

// ── ④ 本机 / 线上混在一份采样里（r247-①）─────────────────────────────────
test('本机和线上混在一个文件：必须按机器分开讲，本机那几次不许算成线上在连着亮', () => {
  // 线上 15 条全绿、本机 5 条磁盘黄灯（就是 r247 实测的那个混合样本的形状）
  const lines = []
  for (let i = 0; i < 15; i++) lines.push(full(i, { upMin: 600 + i }))
  for (let k = 0; k < 5; k++) {
    lines.push({
      t: at(k, 2),
      kind: 'backend',
      api: 'http://127.0.0.1:4000',
      checked: 8,
      checkedNames: NAMES,
      lit: { '服务器磁盘': '本机还剩 190MB' },
      upMin: 40 + k,
      rtMs: 120,
      bad: [],
      warn: ['服务器磁盘'],
    })
  }
  const file = buildFile(lines)
  try {
    const out = runNew(['--file', file, '--n', '20'])
    // 必须点明有几台机器
    assert.ok(out.includes('混着 2 台机器'), '多机器采样必须明说，否则趋势是假的（r247-①）')
    assert.ok(out.includes('本机（http://127.0.0.1:4000）'), '本机那一路要单独成节')
    assert.ok(out.includes('线上（https://minxue-api.onrender.com）'), '线上那一路要单独成节')
    // ⛔ 本机 5 条不能算进线上的窗口 ⇒ 线上那一段根本不该出现「服务器磁盘」这一项
    const prodSection = out.split('本机（http://127.0.0.1:4000）')[0]
    assert.ok(!prodSection.includes('服务器磁盘'),
      '线上那一路一条都没亮，却报出「服务器磁盘」= 把本机的灯算到线上头上了')
    // 本机那一路按它自己的窗口（5 条）讲
    assert.ok(out.includes('服务器磁盘：最近 5/5 条'), '本机那 5 条按它自己的 5 条窗口算，不是 20 条')
    // ⛔ 方向性：旧版会把本机 5 条塞进「最近 20 条」 ⇒ 印出 5/20
    const oldOut = runBase(['--file', file, '--n', '20'])
    assert.ok(oldOut.includes('最近 5/20 条'), '旧版确实把本机混进 20 条窗口（这条锁住混合这个事实）')
    assert.ok(!out.includes('最近 5/20 条'), '新版绝不能再印 5/20 —— 那正是混合的证据')
    // uptime 也不能跨机器拼：本机 40~44 分钟、线上 600~614 分钟
    assert.ok(!out.includes('600 分钟 → 44 分钟'), '两台机器的连续运行时间不许拼成一条')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('方向性：只有一台机器时不许乱提「混着 2 台机器」（判据必须挑得准）', () => {
  const file = buildFile(Array.from({ length: 6 }, (_, i) => full(i)))
  try {
    const out = runNew(['--file', file, '--n', '6'])
    assert.ok(!out.includes('混着 2 台机器'), '一台机器的采样不该硬说混了两台')
    assert.ok(out.includes('后端体检 6 条'), '单机时标题照旧把条数报出来')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

// ── ⑤ 老格式采样：明说不认这个字段，但不许判成红 ──────────────────────────
// ⛔ r221 纪律：字段真的返回 0 不算没读到；这块采样只是比新字段更早，
//    ⇒ 照旧能用、照旧能看灯，只是说一句「这批读不出盯了几项」，别天天挂黄灯（r198）。
test('老格式采样（没有「盯了几项」）：明说读不出，但照旧看灯、不许判红', () => {
  const file = buildFile([
    { t: at(0), kind: 'backend', api: 'https://minxue-api.onrender.com', upMin: 600, rtMs: 900, bad: [], warn: ['服务器磁盘'] },
    { t: at(1), kind: 'backend', api: 'https://minxue-api.onrender.com', upMin: 601, rtMs: 900, bad: [], warn: [] },
  ])
  try {
    const out = runNew(['--file', file, '--n', '2'])
    assert.ok(out.includes('老格式'), '老采样要明说「这批读不出盯了几项」，不许悄悄当它是 0')
    assert.ok(out.includes('服务器磁盘'), '老采样照样能看灯，别整批废掉')
    assert.ok(!out.includes('这次只盯了'), '老采样不许被判成「只盯了 N 项」')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

// ── ⑥ --json 里新字段真读到 ──────────────────────────────────────────────
test('--json 里「盯了几项 / 少了哪几项 / 按机器分组」真读到（不是空壳）', () => {
  const file = buildFile([full(0), full(1), onlyBackendDown(2)])
  try {
    const j = JSON.parse(runNew(['--file', file, '--n', '3', '--json']))
    assert.equal(j.groups.length, 1)
    assert.equal(j.groups[0].key, 'https://minxue-api.onrender.com')
    assert.equal(j.groups[0].targetIsLocal, false)
    assert.equal(j.groups[0].checked.known, true)
    assert.equal(j.groups[0].checked.checked, 1)
    assert.equal(j.groups[0].checked.maxInWindow, 8)
    assert.equal(j.groups[0].checked.shortCount, 1)
    assert.equal(j.groups[0].checked.minInWindow, 1)
    assert.ok(j.groups[0].checked.missingNames.length >= 1, '应列出漏掉的项名')
    const item = j.items.find((x) => x.name === '后端在线')
    assert.ok(item.lastLitDetail, '分项里要带上「亮的时候那句话」')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})
