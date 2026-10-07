// 回归测试（提案 ㊱）：体检采样 `tmp/health.jsonl` 从「只写不读」变成「能看趋势」
//
// 背景（实测，不是推理）：r218 起每次体检都往 `tmp/health.jsonl` 追加一行，但**全仓零消费方** ——
// 攒了 40+ 条从来没人看过，r233「拿采样当裁判」的结论只有写分析那一轮自己知道。
// 于是提案 ㊱ 落地成 `scripts/healthTrend.mjs`，把「最近这段是变好还是变差了」讲成人话。
//
// 本锁的做法（沿用 r221/r233 纪律）：
//   1) **真跑脚本**（用临时采样文件喂进去，不碰仓库里那份真实采样）；
//   2) ⛔ 判「已经好了」的措辞必须有方向性 —— 同一份数据把「后三条改成亮着」就必须**不再**说
//      「那次修是对」，否则这句话成了永远成立的空话（r215「元判据本身也要能被验红」同款）；
//   3) 元判据：先断言文案字面量真的在脚本里（防判据写错字 ⇒ 假通过，r198/r237 同款）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts/healthTrend.mjs')
const SRC = (await import('node:fs')).readFileSync(SCRIPT, 'utf8')

/** 真跑脚本（只读文件，不联网），返回 stdout。 */
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, `healthTrend 退出码应为 0（纯查看），实际 ${r.status}：${r.stderr}`)
  return r.stdout
}

/** 造一份合成采样：n 条，每条的 warn 由 decide(i) 决定。 */
function buildFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'healthtrend-'))
  const file = join(dir, 'health.jsonl')
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return file
}

const base = (i) => ({
  t: new Date(Date.UTC(2026, 9, 7, 4, 0) + i * 30 * 60 * 1000).toISOString(),
  api: 'https://minxue-api.onrender.com',
  upMin: 600 + i,
  rtMs: 900,
  bad: [],
  warn: [],
})

// ── 元判据：先证明「我在锁的那两句话，脚本里真的有」 ──────────────────────
// ⛔ 这是防假通过的第一道：断言的文案若被顺手改掉，下面所有颜色断言都会失去意义。
test('元判据：被锁的两句人话确实写在脚本里（改文案必须同步改这里）', () => {
  assert.ok(SRC.includes('那次修是对的'), '脚本里应有「那次修是对的」这句（判定「修完不再亮」）')
  assert.ok(SRC.includes('条条都亮'), '脚本里应有「条条都亮」这句（判定「一直没解决」）')
  assert.ok(SRC.includes('别当这段时间是正常的'), '脚本在全坏行时必须明说不许当成正常')
  assert.ok(SRC.includes('这个文件还不存在'), '脚本在采样文件缺失时必须明说，不许静默')
})

// ── 采样文件不存在：明说，不静默 ──────────────────────────────────────────
test('采样文件不存在时明说，而且不许说成「一切正常」', () => {
  const out = run(['--file', join(mkdtempSync(join(tmpdir(), 'healthtrend-missing-')), 'nope.jsonl')])
  assert.ok(out.includes('这个文件还不存在'), '应明说文件不存在')
  assert.ok(out.includes('healthcheck.mjs'), '应告诉他怎么把采样造出来')
  assert.ok(!out.includes('一切正常'), '文件都没了不能输出「一切正常」')
})

// ── 全是读不出来的行：明说，不静默 ────────────────────────────────────────
test('采样文件里一行都读不出来时明说，不许当成「这段时间是正常的」', () => {
  const file = buildFile([{ oops: 1 }, 'not-json', '{}'])
  try {
    const out = run(['--file', file])
    assert.ok(out.includes('没有一行读得出来'), '应明说读不出来')
    assert.ok(out.includes('别当这段时间是正常的'), '应明说不许当成正常')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

// ── 方向性判据 ⛔ 这是本锁的核心：判据必须能被验红 ────────────────────────
test('某盏灯「以前亮、最近不亮」才说修对了；最近还亮着就绝不能这么说', () => {
  // 场景 A：前 5 条磁盘亮、后 3 条不亮 ⇒ 说「那次修是对的」
  const healed = buildFile(Array.from({ length: 8 }, (_, i) => {
    const s = base(i); if (i < 5) s.warn = ['服务器磁盘']; return s
  }))
  let out
  try {
    // ⛔ 窗口必须开成「只覆盖不亮的那 3 条」，否则后 3 条也算「最近亮过」，
    //    「修好了」这个结论就永远出不来（判自己写错了，不是产品错了）。
    out = run(['--file', healed, '--n', '3'])
  } finally {
    rmSync(join(healed, '..'), { recursive: true, force: true })
  }
  assert.ok(out.includes('那次修是对的'), '场景 A（前亮后灭）应该判定修对了')
  assert.ok(out.includes('更早亮过'), '应报出「更早亮过 N 条」这个数')

  // 场景 B：同样 8 条，但改成**全程都在亮** ⇒ 绝不能再说「修对了」，要说一直没解决
  const stillLit = buildFile(Array.from({ length: 8 }, (_, i) => {
    const s = base(i); s.warn = ['服务器磁盘']; return s
  }))
  try {
    out = run(['--file', stillLit, '--n', '8'])
  } finally {
    rmSync(join(stillLit, '..'), { recursive: true, force: true })
  }
  assert.ok(!out.includes('那次修是对的'), '场景 B（全程还亮着）绝不能说修对了 —— 判据必须有方向，不能是恒真的空话')
  assert.ok(out.includes('条条都亮'), '场景 B 应改判「这段时间条条都亮」')
})

// ── 「修好了」要有下限，一次样本不许下结论 ────────────────────────────────
test('只亮过 1 条不许说「修好了」（单次观测不能下因果结论，r198/r233）', () => {
  const oneHit = buildFile(Array.from({ length: 8 }, (_, i) => {
    const s = base(i); if (i === 0) s.warn = ['服务器磁盘']; return s
  }))
  try {
    const out = run(['--file', oneHit, '--n', '8'])
    assert.ok(!out.includes('那次修是对的'), '只亮过 1 条就说「修好了」是拿单次观测下结论')
  } finally {
    rmSync(join(oneHit, '..'), { recursive: true, force: true })
  }
})

// ── 连续运行时间只说「涨/落」，不许下因果 ─────────────────────────────────
test('连续运行时间回落时只说「中途重启过一次」，不许说为什么', () => {
  const dropped = buildFile(Array.from({ length: 6 }, (_, i) => {
    const s = base(i); s.upMin = i < 3 ? 900 : 120; return s
  }))
  try {
    const out = run(['--file', dropped, '--n', '6'])
    assert.ok(out.includes('回落过'), 'uptime 回落应明说中间重启过')
    assert.ok(!out.includes('因为'), '只说发生了什么，不猜原因（重启原因有一堆，r218 教训）')
  } finally {
    rmSync(join(dropped, '..'), { recursive: true, force: true })
  }
})

// ══ r239 追加：同一个采样文件有**两拨写入方**，必须分得清 ══════════════════
// 背景（实测，不是推理）：`scripts/healthcheck.mjs` 与 `scripts/frontendHealth.mjs`
// 的 `--log` 默认值**都是 tmp/health.jsonl**，但两行结构不同 —— 后端那行 `bad` 装的是
// **灯名字符串**，前端那行 `bad` 装的是**坏掉模块的对象**。旧版把它们一起摊平当灯名 ⇒
// Map 的键成了对象 ⇒ 终端上印出 `[object Object]`，还被算进「几次需要处理（红色）」。
// 实测 6 条带坏模块的前端采样 ⇒ 6 行 `[object Object]` + 顶部「6 次需要处理（红色）」。

/** 造一条前端体检采样（结构照抄 frontendHealth.mjs 真实写入的那一行）。 */
const front = (i, opts = {}) => ({
  kind: 'frontend',
  t: new Date(Date.UTC(2026, 9, 7, 13, 0) + i * 30 * 60 * 1000).toISOString(),
  base: 'http://127.0.0.1:3000',
  entry: '/index.html',
  modulesOk: 53,
  badCount: opts.bad ? opts.bad.length : 0,
  bad: opts.bad || [],
  dom: opts.dom || { blank: false, rootHTMLLen: 900, textLen: 120, consoleErrors: 0, badResp: [] },
  status: opts.status || 'healthy',
  elapsedMs: 1200,
})

test('元判据：r239 新加的三句人话确实写在脚本里（改文案必须同步改这里）', () => {
  for (const s of [
    '前端体检（首页白屏 / 模块链）跑过', // 前端那一路的标题
    '白屏这一项等于没盯', // 没启动浏览器时的结论
    '这段时间一条后端体检的采样都没有', // 只有一拨人写 ⇒ 不许当成正常
    '首页是白屏', // 白屏那层的结论
  ]) {
    assert.ok(SRC.includes(s), `脚本里应有这句（改文案要同步改这里）：${s}`)
  }
  // ⛔ 元判据本身也要能被验：FRONTEND_STATUS_TEXT 的每个状态值都必须真的出现在文案表里，
  //    漏一个就是「有状态没翻译」，输出会直接把英文状态码甩给负责人。
  for (const s of ['healthy', 'dom-not-checked', 'persistent', 'transient-edit']) {
    assert.ok(new RegExp(`['"]?${s}['"]?:`).test(SRC), `FRONTEND_STATUS_TEXT 应含状态 ${s}`)
  }
})

test('两拨写入方混在一个文件里：不许印 [object Object]，前端那一路单独成段', () => {
  const back = Array.from({ length: 6 }, (_, i) => {
    const s = base(i); if (i < 3) s.warn = ['代码版本']; return s
  })
  const mixed = [...back, front(0, { bad: [{ url: 'http://127.0.0.1:3000/assets/a.js', status: 'FETCH_FAIL' }], status: 'persistent' })]
  const file = buildFile(mixed)
  let out
  try {
    out = run(['--file', file, '--n', '6'])
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
  assert.ok(!out.includes('[object Object]'), '旧版在这里会印 [object Object]（详情见 r239 报告）')
  assert.ok(out.includes('前端体检（首页白屏 / 模块链）跑过'), '前端那一路应单独成段')
  assert.ok(out.includes('坏 1 个'), '应报出坏掉的模块数')
  assert.ok(out.includes('assets/a.js（连不上）'), '应报出是哪个模块连不上（说人话，不甩完整 URL）')
  assert.ok(out.includes('前端体检 1 条'), '标题里应把两拨各多少条报出来')
  // 红色条数只数后端那一路的灯名，前端的坏模块不该混进来虚高
  assert.ok(!out.includes('6 次需要处理'), '前端体检的坏模块不该被算成后端体检的红色条数')
})

test('分桶只看 kind：同一份数据去掉 kind 就退回后端那一路（不许靠结构猜）', () => {
  const raw = front(0, { bad: [{ url: 'http://127.0.0.1:3000/assets/a.js', status: 'FETCH_FAIL' }] })
  delete raw.kind // r239 之前写的旧前端行，本来就没有 kind
  const file = buildFile([base(0), raw])
  let out
  try {
    out = run(['--file', file, '--n', '2'])
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
  assert.ok(!out.includes('前端体检（首页白屏 / 模块链）跑过'), '旧行没有 kind，应归后端那一路')
  assert.ok(out.includes('共 2 条采样'), '旧行不能被当成"读不出来的坏行"丢掉')
})

test('只有前端体检、一点后端体检都没有：明说没盯过，不许说「没有红色」', () => {
  const file = buildFile([front(0), front(1)])
  let out
  let jsonOut
  try {
    out = run(['--file', file, '--n', '2'])
    jsonOut = run(['--file', file, '--n', '2', '--json'])
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
  assert.ok(out.includes('这段时间一条后端体检的采样都没有'), '没盯过后端必须明说')
  assert.ok(!out.includes('条里没有红色（要处理的）'), '没盯过就说不出「没有红色」')
  assert.ok(!out.includes('一切正常'), '不查就说正常，是假绿')
  assert.equal(JSON.parse(jsonOut).ok, false, '--json 也要把「没有后端采样」报出来')
  assert.equal(JSON.parse(jsonOut).reason, 'no-backend-sample')
})

test('--json 里前端那一路的字段真读到（坏模块数/首页那层/结论）', () => {
  const file = buildFile([
    base(0),
    front(0, {
      bad: [{ url: 'http://127.0.0.1:3000/assets/a.js', status: 'FETCH_FAIL' }],
      dom: { skipped: true },
      status: 'dom-not-checked',
    }),
  ])
  try {
    const j = JSON.parse(run(['--file', file, '--n', '2', '--json']))
    assert.equal(j.frontendSamples, 1)
    assert.equal(j.frontend.count, 1)
    assert.equal(j.frontend.badCount, 1)
    assert.ok(j.frontend.bad[0].includes('assets/a.js'))
    assert.equal(j.frontend.domLayer, '没启动浏览器（白屏那层等于没盯）')
    assert.equal(j.frontend.verdict, 'dom-not-checked')
    assert.ok(j.frontend.verdictText.includes('等于没盯'))
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

// ── 写入方真的打上 kind（真跑，不靠读源码字面猜）───────────────────────────
test('healthcheck 真跑一遍写出的那一行，必须带 kind:"backend"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'healthtrend-writer-'))
  const log = join(dir, 'health.jsonl')
  try {
    const r = spawnSync(process.execPath,
      [resolve(ROOT, 'scripts/healthcheck.mjs'), '--api', 'http://127.0.0.1:5999', '--log', log],
      { encoding: 'utf8' })
    assert.equal(r.status, 1, `打不通的接口应退出 1（这里故意打死端口），实际 ${r.status}：${r.stderr}`)
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l.trim())
    assert.ok(lines.length >= 1, '打不通也要照样写采样行（否则采样会整段消失）')
    const rec = JSON.parse(lines[lines.length - 1])
    assert.equal(rec.kind, 'backend', '后端体检那一路必须打 kind:"backend"，读的那边才分得清')
    assert.equal(rec.api, 'http://127.0.0.1:5999')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── --json 真能读 ─────────────────────────────────────────────────────────
test('--json 输出能被 JSON.parse，且采样条数/窗口/分项都真读到', () => {
  const file = buildFile(Array.from({ length: 6 }, (_, i) => {
    const s = base(i); if (i < 3) s.warn = ['代码版本']; return s
  }))
  try {
    const out = run(['--file', file, '--n', '6', '--json'])
    const j = JSON.parse(out)
    assert.equal(j.ok, true)
    assert.equal(j.parsed, 6, '应真读到 6 条')
    assert.equal(j.window, 6)
    const code = j.items.find((x) => x.name === '代码版本')
    assert.ok(code, '分项里必须有「代码版本」')
    assert.equal(code.total, 3)
    assert.equal(code.inWindow, 3)
    assert.equal(code.olderHits, 0)
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})
