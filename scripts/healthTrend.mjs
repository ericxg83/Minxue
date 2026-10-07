#!/usr/bin/env node
/**
 * 体检趋势（只读，只看采样文件，不联网、不写文件）
 *
 * 为什么要有这个（提案 ㊱）：`scripts/healthcheck.mjs --log tmp/health.jsonl`
 * 从 r218 起每次体检都往里追加一行，但**全仓零消费方** —— 采样攒了几十条，
 * 从来没人看过。于是 r233 那套「拿采样当裁判」的结论（磁盘 18 次告警全在 r198 之前、
 * 接口速度只亮过 1 次 = 真冷启动）只有写分析的那一轮自己知道，下一轮又得重新翻一遍。
 *
 * 这个脚本把「最近这一段是变好了还是变差了」用大白话讲出来，回答两件事：
 *   ① 哪几盏灯**最近一直亮** ⇒ 多半是真问题，值得管；
 *   ② 哪几盏灯**以前亮过、后来不亮了** ⇒ 说明那次修是对的，不是瞎亮的灯。
 *
 * 用法：
 *   node scripts/healthTrend.mjs            # 看最近 20 条
 *   node scripts/healthTrend.mjs --n 50     # 看最近 50 条
 *   node scripts/healthTrend.mjs --file 别的路径
 *   node scripts/healthTrend.mjs --json     # 机器可读
 *
 * 设计约束（勿破坏）：
 *   1) **只读**：只 process 已有的采样文件，不发请求、不写文件、不碰数据库。
 *   2) 读不到就说读不到（文件不存在 / 一行都没有 / 全是坏行），**不许静默判"一切正常"**。
 *   3) 文案只讲后果和下一步，不甩字段名。
 */

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const JSON_ONLY = argv.includes('--json')
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const repoRoot = path.resolve(path.dirname(path.resolve(process.argv[1])), '..')
const FILE = argOf('--file', path.join(repoRoot, 'tmp', 'health.jsonl'))
const N = Number.parseInt(argOf('--n', '20'), 10)
const WINDOW = Number.isFinite(N) && N > 0 ? N : 20

const C = { ok: '✅', warn: '⚠️ ', bad: '❌', info: 'ℹ️ ' }

/** ISO 时刻 → 本地「10-07 20:47」；读不出来就说读不出来，不猜。 */
function localTimeText(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '时刻读不出来'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 读采样 ───────────────────────────────────────────────────────────────
let raw
try {
  raw = fs.readFileSync(FILE, 'utf8')
} catch (e) {
  if (!JSON_ONLY) {
    console.log(`${C.info} 这个文件还不存在：${FILE}`)
    console.log('跑一次体检就会有了：')
    console.log('  node scripts/healthcheck.mjs --api https://minxue-api.onrender.com --log tmp/health.jsonl')
  } else {
    console.log(JSON.stringify({ ok: false, reason: 'file-missing', file: FILE }))
  }
  process.exitCode = 0
  process.exit(0)
}

const lines = raw.split('\n').filter((l) => l.trim())
const samples = []
let badLines = 0
for (const line of lines) {
  let o
  try {
    o = JSON.parse(line)
  } catch {
    badLines++
    continue
  }
  // ⛔ 光「能 parse」不算数：一个 `{}` 也是合法 JSON，却什么字段都没有 —— 拿它去算趋势
  //    就是拿空气当结论（r221「字段没真读到就明说」同款）。必须至少带了采样特征的字段。
  const shaped = o && typeof o === 'object' && ('t' in o || 'bad' in o || 'warn' in o)
  if (shaped) samples.push(o)
  else badLines++
}

// ⛔ 采不到一条就绝不说「一切正常」—— 那样这条门禁就退化成永远合格（r221 同款）。
if (samples.length === 0) {
  if (!JSON_ONLY) {
    console.log(`${C.info} 采样文件里有 ${lines.length} 行，但没有一行读得出来（${FILE}）。`)
    console.log('多半是格式变了，得有个人核一下，别当这段时间是正常的。')
  } else {
    console.log(JSON.stringify({ ok: false, reason: 'no-parseable-sample', lines: lines.length, file: FILE }))
  }
  process.exitCode = 0
  process.exit(0)
}

const window_ = samples.slice(-WINDOW)

// ── 逐项统计 ─────────────────────────────────────────────────────────────
/** 把每条的 bad/warn 摊平：{ 项名: [该条的下标...] } */
function collect(items) {
  const map = new Map()
  items.forEach((s, idx) => {
    for (const name of [...(s.bad || []), ...(s.warn || [])]) {
      if (!map.has(name)) map.set(name, [])
      map.get(name).push(idx)
    }
  })
  return map
}
const winMap = collect(window_)
const allMap = collect(samples)

/** 最长连续出现段（按窗口内的下标算）。 */
function longestRun(indices) {
  let best = 0
  let cur = 0
  let prev = -2
  for (const i of indices) {
    cur = i === prev + 1 ? cur + 1 : 1
    prev = i
    if (cur > best) best = cur
  }
  return best
}

const names = [...allMap.keys()].sort((a, b) => (winMap.get(b)?.length || 0) - (winMap.get(a)?.length || 0))

const items = names.map((name) => {
  const idxAll = allMap.get(name)
  const idxWin = winMap.get(name) || []
  const olderHits = idxAll.length - idxWin.length
  const alwaysLit = idxWin.length === window_.length && window_.length >= 3
  // 「已经好了」：更早亮过不少、最近一段一条都不亮。要 olderHits>=2 才敢这么说，
  // 1 次样本说明不了「修好了」（r198：不许凭单次观测下结论）。
  const settled = olderHits >= 2 && idxWin.length === 0
  const lastSample = samples[idxAll[idxAll.length - 1]]
  const firstSample = samples[idxAll[0]]
  return {
    name,
    total: idxAll.length,
    inWindow: idxWin.length,
    windowSize: window_.length,
    olderHits,
    longestRun: longestRun(idxWin),
    alwaysLit,
    settled,
    firstAt: firstSample.t || null,
    lastAt: lastSample.t || null,
    lastDetail: lastSample.bad && lastSample.bad.includes(name) ? 'bad' : 'warn',
  }
})

const badCount = window_.reduce((n, s) => n + (s.bad || []).length, 0)
const last = samples[samples.length - 1]
const first = samples[0]

// ── 输出 ─────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
  console.log(JSON.stringify({
    ok: true,
    file: FILE,
    parsed: samples.length,
    badLines,
    window: window_.length,
    range: { first: first.t || null, last: last.t || null },
    latest: { upMin: last.upMin ?? null, rtMs: last.rtMs ?? null },
    items,
    windowBadCount: badCount,
  }, null, 2))
} else {
  // ⛔ 时间跨度读不出来就明说：拿 `new Date()` 兜底会把「哪段时间」印成当前时刻，
  //    看着像有数，其实没数（r221 同款假绿）。
  const spanText = first.t && last.t
    ? `${localTimeText(first.t)} ~ ${localTimeText(last.t)}`
    : '时间段读不出来'
  const head = `体检趋势（共 ${samples.length} 条采样${badLines ? `，另 ${badLines} 行读不出来` : ''}；${spanText}，只看最近 ${window_.length} 条）`
  console.log(head)
  console.log('─'.repeat(52))

  if (badCount > 0) console.log(`${C.bad} 最近 ${window_.length} 条里有 ${badCount} 次需要处理（红色）`)
  else console.log(`${C.ok} 最近 ${window_.length} 条里没有红色（要处理的）`)

  for (const it of items) {
    const pct = it.inWindow ? `最近 ${it.inWindow}/${it.windowSize} 条` : '最近一条都不亮'
    let tail
    if (it.alwaysLit && it.inWindow > 0) {
      // 天天亮 = 要么这件事一直没解决、要么这盏灯本身坏了。⛔ 绝不替他断定是哪一种 ——
      // r198 教训：写死的推论（比如「多半是灯坏了」）在真实例子上就是误判（实测线上
      // 「代码版本」条条都亮是因为推了没部署，不是灯坏），夸大的提示比没提示更糟。
      tail = `这段时间条条都亮（连续 ${it.longestRun} 条）⇒ 要么这件事一直没解决，要么这盏灯本身坏了；` +
        `两种都得看一眼再信它，别让这盏一直亮的灯挡着真出事的那条`
    } else if (it.settled) {
      tail = `更早亮过 ${it.olderHits} 条、最近一条都不亮 ⇒ 那次修是对的，这盏灯不是瞎亮的`
    } else if (it.inWindow > 0) {
      const recent = it.lastAt ? `最近一次 ${localTimeText(it.lastAt)}` : '最近就在这几条里'
      tail = `亮过 ${it.inWindow} 条（共 ${it.total} 条），${recent}；` +
        (it.longestRun > 1 ? `连续 ${it.longestRun} 条 ⇒ 大概率是同一件事在连着发生` : '零散出现，多半是自愈一次的偶发')
    } else {
      tail = `全 ${samples.length} 条里就没亮过`
    }
    console.log(`${it.inWindow > 0 ? C.warn : C.ok} ${it.name}：${pct} ⇒ ${tail}`)
  }

  const upTrail = samples.map((s) => s.upMin).filter((v) => typeof v === 'number')
  if (upTrail.length >= 2) {
    // ⛔ 只说「涨/落」，不下因果结论 —— 重启的原因有一堆（r218 教训）。
    const drop = upTrail[upTrail.length - 1] < upTrail[0]
    const trend = drop ? '中途回落过（中间重启过一次，正常；要看是不是老重启得看前面几十条）' : '一路在涨（这段时间内没重启过）'
    console.log(`${C.info} 连续运行时间：${upTrail[0]} 分钟 → ${upTrail[upTrail.length - 1]} 分钟，${trend}`)
  }
  const rtTrail = samples.map((s) => s.rtMs).filter((v) => typeof v === 'number')
  if (rtTrail.length >= 2) {
    const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length)
    const win = rtTrail.slice(-WINDOW)
    console.log(`${C.info} 响应速度：最近 ${window_.length} 条平均 ${avg(win)}ms` +
      `（最早 ${rtTrail[0]}ms，最快 ${Math.min(...rtTrail)}ms，最慢 ${Math.max(...rtTrail)}ms）`)
  }

  console.log('─'.repeat(52))
  console.log(`${C.info} 想看更多：node scripts/healthTrend.mjs --n 50`)
}

process.exitCode = 0
