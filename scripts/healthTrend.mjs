#!/usr/bin/env node
/**
 * 体检趋势（只读，只看采样文件，不联网、不写文件）
 *
 * 为什么要有这个（提案 ㊱）：`scripts/healthcheck.mjs --log tmp/health.jsonl`
 * 从 r218 起每次体检都往里追加一行，但**全仓零消费方** —— 采样攒了几十条，
 * 从来没人看过。于是 r233 那套「拿采样当裁判」的结论（磁盘 18 次告警全在 r198 之前、
 * 接口速度只亮过 1 次 = 真冷启动）只有写分析的那一轮自己知道，下一轮又得重新翻一遍。
 *
 * 这个脚本把「最近这一段是变好了还是变差了」用大白话讲出来，回答四件事：
 *   ① 哪几盏灯**最近一直亮** ⇒ 多半是真问题，值得管；
 *   ② 哪几盏灯**以前亮过、后来不亮了** ⇒ 说明那次修是对的，不是瞎亮的灯；
 *   ③ 每次体检**到底盯了几项** —— 某项压根没跑，和某项全绿，在日志里长得一模一样（r246-①）；
 *   ④ 这些采样**是在看哪台机器** —— 本机和线上混成一条趋势会把两码事算成一件事（r247-①）。
 *
 * 用法：
 *   node scripts/healthTrend.mjs            # 看最近 20 条
 *   node scripts/healthTrend.mjs --n 50     # 看最近 50 条
 *   node scripts/healthTrend.mjs --file 别的路径
 *   node scripts/healthTrend.mjs --json     # 机器可读
 *
 * ⚠️ 这个文件里**有两拨人写**（2026-10-07 r239 实测）：
 *   ① `scripts/healthcheck.mjs` —— 后端体检，行形如 `{t,api,upMin,rtMs,bad:[灯名],warn:[灯名]}`；
 *   ② `scripts/frontendHealth.mjs` —— 前端体检（白屏/模块链），它的 `--log` 默认值**也是这个
 *      文件**，行形如 `{t,base,modulesOk,bad:[{url,status,verdict}…],dom,status}`。
 *   ⛔ 两行结构完全不同：前端那一路 `bad` 装的是**对象**（坏掉的模块），不是灯名字符串。
 *      旧版把它们一起摊平当灯名 ⇒ Map 的键成了对象，输出行名印成 `[object Object]`，
 *      而且被算进「有几条要处理（红色）」，**真红被垃圾行冲淡、看不出是哪盏灯**。
 *      实测：6 条带坏模块的前端采样 ⇒ 6 行 `[object Object]` + 顶部「6 次需要处理（红色）」。
 *    ⇒ 从 r239 起两路都打 `kind`，这里按 kind 分两节各自讲人话。
 *
 * 设计约束（勿破坏）：
 *   1) **只读**：只 process 已有的采样文件，不发请求、不写文件、不碰数据库。
 *   2) 读不到就说读不到（文件不存在 / 一行都没有 / 全是坏行 / 只有一拨人写的 / 某台机器没采到），
 *      **不许静默判"一切正常"**。
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

/**
 * 采样分两拨（r239）：两路写入方往同一个文件追加，行结构不同，必须分开看。
 * ⛔ r239 之前只有 healthcheck.mjs 写这个 ⇒ **没打 kind 的旧行一律算后端体检**，
 *    这样已有的几十条采样照样能用（不该因为加了个字段就整批变成"读不出来"）。
 */
const KIND_FRONTEND = 'frontend'
const kindOf = (o) => (o && o.kind === KIND_FRONTEND ? KIND_FRONTEND : 'backend')

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
  const shaped = o && typeof o === 'object' && ('t' in o || 'bad' in o || 'warn' in o || 'kind' in o)
  if (shaped) samples.push(o)
  else badLines++
}

// 两拨写入方分开排（r239）。旧采样没 kind ⇒ kindOf 归 backend，照样能用。
const backendSamples = samples.filter((s) => kindOf(s) === 'backend')
const frontendSamples = samples.filter((s) => kindOf(s) === KIND_FRONTEND)

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

// ⛔ 趋势只能看后端体检那一路：前端体检的行结构不同，混进来会把窗口算歪（r239）。
//    一段采样里**一条后端体检都没有** ⇒ 这等于没盯，绝不能说「没有红色」。
const backendGap = backendSamples.length === 0

// ══ r247-①：后端那一路再按「在看哪台机器」分组 ══════════════════════════════
// 实测现网 60 条里已经混了 1 条本机行（127.0.0.1:4000），而旧版从头没读过 `api` 字段 ⇒
// 「查本机」和「查线上」算成同一条趋势：本机 5 条磁盘黄灯被讲成「线上最近连续 5 条在亮」（线上一条没亮），
// 「连续 1300 分钟 → 23 分钟，中途重启过一次」其实是**两台机器**。
// ⛔ ⛔ 关键：healthcheck.mjs 的 `--api` **默认值就是本机**，谁不带 --api 跑一次写进同一个文件，
//    这条趋势立刻变脏而且一点提示都没有。旧版 `--api` 默认本机（127.0.0.1:4000）。
//    ⇒ 这里只分组、不丢行（旧行没 api ⇒ 归「没记目标」，照样能用）。
const stripTrailingSlash = (s) => String(s || '').replace(/\/+$/, '')
const NO_TARGET = '__no_target__'
const groupKeysOf = (list) => {
  const m = new Map()
  for (const s of list) {
    const key = stripTrailingSlash(s.api) || NO_TARGET
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(s)
  }
  return m
}
const isLocalTarget = (key) => key !== NO_TARGET && (key.includes('127.0.0.1') || key.includes('localhost'))
/** 机器名说人话：不是本机就只印域名，别甩一长串 URL 给负责人。 */
// ⛔ r248（r249-③）：旧文案把「没记目标」直接说成「多半是别人不带 --api 跑的那次」——
//   那是个写死的推论（r198：夸大的告警/推断比没告警更糟）。实测老格式行是脚本自己 r239 之前
//   写的采样，不一定是谁误跑 ⇒ 只陈述「看不出查的是哪台机器」，让负责人自己判断要不要管。
const targetLabel = (key) => (key === NO_TARGET
  ? '目标没记（旧格式采样，看不出查的是哪台机器）'
  : isLocalTarget(key) ? `本机（${key}）` : `线上（${key}）`)

const groupKeys = groupKeysOf(backendSamples)

/** 逐项统计（r239 那套判据保持原样，只是从「全体」换成「这一组」）。 */
function collect(items) {
  const map = new Map()
  items.forEach((s, idx) => {
    for (const name of [...(s.bad || []), ...(s.warn || [])]) {
      // ⛔ 硬门：只收字符串。前端体检的 bad 装的是「坏掉的模块」对象，
      //    拿它当灯名 ⇒ Map 键成了对象 ⇒ 输出印 [object Object]（r239 实测就是这个现象）。
      if (typeof name !== 'string') continue
      if (!map.has(name)) map.set(name, [])
      map.get(name).push(idx)
    }
  })
  return map
}
/** 最长连续出现段（按传入那个数组的下标算）。 */
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

/**
 * 一组采样 → 逐项结论。
 * `list` 是这一组的全部（含更早的），`win` 是这一组最近 WINDOW 条。
 */
function buildView(list, win) {
  const winMap = collect(win)
  const allMap = collect(list)
  const names = [...allMap.keys()].sort((a, b) => (winMap.get(b)?.length || 0) - (winMap.get(a)?.length || 0))

  const items = names.map((name) => {
    const idxAll = allMap.get(name)
    const idxWin = winMap.get(name) || []
    const olderHits = idxAll.length - idxWin.length
    const alwaysLit = idxWin.length === win.length && win.length >= 3
    // 「已经好了」：更早亮过不少、最近一段一条都不亮。要 olderHits>=2 才敢这么说，
    // 1 次样本说明不了「修好了」（r198：不许凭单次观测下结论）。
    const settled = olderHits >= 2 && idxWin.length === 0
    const lastSample = list[idxAll[idxAll.length - 1]]
    const firstSample = list[idxAll[0]]
    // ⛔ r245-①：只记灯名的话，事后只知「亮过」，不知道当时到底什么情形
    //    （57 条采样 44 次亮灯，无一带数字）。这里取这组里最近一次亮的那句人话。
    let lastLitDetail = null
    for (const s of [...win].reverse()) {
      const d = s.lit && s.lit[name]
      if (typeof d === 'string' && d) { lastLitDetail = d; break }
    }
    return {
      name,
      total: idxAll.length,
      inWindow: idxWin.length,
      windowSize: win.length,
      olderHits,
      longestRun: longestRun(idxWin),
      alwaysLit,
      settled,
      firstAt: firstSample.t || null,
      lastAt: lastSample.t || null,
      lastDetail: lastSample.bad && lastSample.bad.includes(name) ? 'bad' : 'warn',
      lastLitDetail,
    }
  })

  // ⛔ 只数**灯名字符串**：前端体检那一路 `bad` 是「坏模块」对象，数它们会把红色条数虚高
  //    （实测一条带 1 个坏模块的前端采样就被算成 1 次红色）。
  const badCount = win.reduce((n, s) => n + (s.bad || []).filter((x) => typeof x === 'string').length, 0)
  return { items, badCount }
}

/**
 * 「这次到底盯了几项」（r246-①）：
 *   healthcheck 的采样以前只写 bad/warn 两个灯名 ⇒ 「某项压根没执行」和「某项全绿」
 *   在日志里逐字相同。实测后端连不上时只跑了 1 项，采样照样是 `{"bad":["后端在线"]}`。
 * ⛔ 拿 checked 当「红/绿」条件会重演 r198 的恒定黄灯（老格式采样永远没这个字段），
 *    ⇒ 只当事实记录报出来：这次查了几项、比这段时间最多的那次少了几项。
 */
function checkedView(list, win) {
  const withChecked = list.filter((s) => s && typeof s.checked === 'number')
  if (withChecked.length === 0) {
    return { known: false, latest: null, max: null, shortCount: 0, min: null, missing: [] }
  }
  const latest = withChecked[withChecked.length - 1]
  const max = Math.max(...withChecked.map((s) => s.checked))
  const winChecked = win.filter((s) => s && typeof s.checked === 'number')
  const shorts = winChecked.filter((s) => s.checked < max)
  let missing = []
  if (latest.checked < max || shorts.length > 0) {
    const ref = withChecked.reduce((a, b) => (b.checked > a.checked ? b : a))
    // ⛔ 方向：要的是「那次跑过的项里，这次没跑的有哪几个」= 拿参照那次的名单去减，
    //    反过来减（拿这次的名单去减参照那个名单）会得到空数组 ⇒ 一句「少了 0 项」的假话（r245 实测踩到）。
    const refNames = (ref.checkedNames || []).map(String)
    const latestNames = new Set((latest.checkedNames || []).map(String))
    missing = latestNames.size ? refNames.filter((n) => !latestNames.has(n)) : ['（没记名字）']
  }
  return {
    known: true,
    latest,
    max,
    shortCount: shorts.length,
    min: winChecked.length ? Math.min(...winChecked.map((s) => s.checked)) : null,
    missing,
  }
}

// ── 分组视图 ─────────────────────────────────────────────────────────────
const groups = [...groupKeys.entries()].map(([key, list]) => {
  const win = list.slice(-WINDOW)
  return { key, label: targetLabel(key), count: list.length, window: win, ...buildView(list, win), checked: checkedView(list, win) }
}).sort((a, b) => b.count - a.count)

// ⛔ 一拨采样都没有时 first/last 是 null，直接读 .t 会崩（r239 的锁当场抓到这个）。
const last = backendSamples[backendSamples.length - 1] || null
const first = backendSamples[0] || null
const primary = groups[0] || null

// ── 前端体检那一路（r239）：结构跟后端体检不同，单独一节讲人话 ──────────────
// 它的 `bad` 装的是「坏掉的模块」对象、整体结论在 `status` 上 —— 旧版一律当灯名摊平，
// 于是 Map 的键成了对象，终端上印出 `[object Object]`（实测复现过）。
const FRONTEND_STATUS_TEXT = {
  healthy: '首页正常：模块链全 200，首页有内容。',
  'dom-not-checked': '白屏这一项等于没盯：这次没启动浏览器，没验过首页，不算健康。',
  persistent: '有持续性缺陷（刷新都没用），得改代码。',
  'transient-edit': '看着像改代码到一半的中间态，刷新一次再看。',
}
const stripHost = (u) => String(u || '').replace(/^https?:\/\/[^/]+\//, '') || String(u || '')
const domLayerText = (d) => {
  if (!d || d.skipped) return '没启动浏览器（白屏那层等于没盯）'
  if (d.error) return `浏览器那层没跑成（${d.error}）`
  if (typeof d.blank === 'boolean') return d.blank ? '首页是白屏' : '首页有内容'
  return '白屏那层没查（等于没盯）'
}
/** 最近一次前端体检；一次都没跑过就是 null（那就不该凭空编一段出来）。 */
const frontendSummary = frontendSamples.length
  ? (() => {
    const last = frontendSamples[frontendSamples.length - 1]
    const mods = (last.bad || []).map((b) =>
      `${stripHost(b.url)}（${b.status === 'FETCH_FAIL' ? '连不上' : '不是 200'}）`)
    return {
      count: frontendSamples.length,
      lastAt: last.t || null,
      modulesOk: last.modulesOk ?? null,
      badCount: mods.length,
      bad: mods,
      domLayer: domLayerText(last.dom),
      verdict: last.status || null,
      verdictText: FRONTEND_STATUS_TEXT[last.status] || '这次的结论读不出来',
    }
  })()
  : null

/**
 * 一组里「连续运行时间 / 响应速度」的走势（r247-①：按机器算，别把两台机器拼成一条）。
 * 返回 null 表示这条线数据不足（只采过一次 / 字段没回），由调用方说人话。
 */
function trailsOf(list) {
  const upTrail = list.map((s) => s.upMin).filter((v) => typeof v === 'number')
  const rtTrail = list.map((s) => s.rtMs).filter((v) => typeof v === 'number')
  return { upTrail, rtTrail }
}

// ── 输出 ─────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
  console.log(JSON.stringify({
    ok: !backendGap,
    reason: backendGap ? 'no-backend-sample' : undefined,
    file: FILE,
    parsed: samples.length,
    badLines,
    window: primary ? primary.window.length : 0,
    range: { first: first ? first.t || null : null, last: last ? last.t || null : null },
    latest: { upMin: last ? last.upMin ?? null : null, rtMs: last ? last.rtMs ?? null : null },
    groups: groups.map((g) => ({
      key: g.key === NO_TARGET ? null : g.key,
      label: g.label,
      targetIsLocal: isLocalTarget(g.key),
      count: g.count,
      window: g.window.length,
      windowBadCount: g.badCount,
      checked: {
        known: g.checked.known,
        checked: g.checked.latest ? g.checked.latest.checked : null,
        maxInWindow: g.checked.max,
        shortCount: g.checked.shortCount,
        minInWindow: g.checked.min,
        missingNames: g.checked.missing,
      },
      items: g.items,
    })),
    items: groups.flatMap((g) => g.items.map((it) => ({ ...it, target: g.key === NO_TARGET ? null : g.key }))),
    windowBadCount: groups.reduce((n, g) => n + g.badCount, 0),
    backendSamples: backendSamples.length,
    backendGroups: groups.map((g) => ({ key: g.key === NO_TARGET ? null : g.key, count: g.count })),
    frontendSamples: frontendSamples.length,
    frontend: frontendSummary,
  }, null, 2))
} else {
  // ⛔ 时间跨度读不出来就明说：拿 `new Date()` 兜底会把「哪段时间」印成当前时刻，
  //    看着像有数，其实没数（r221 同款假绿）。
  // ⛔ 一拨采样都没有时 first/last 是 null，直接读 .t 会崩（r239 的锁当场抓到这个）。
  const spanText = first && last && first.t && last.t
    ? `${localTimeText(first.t)} ~ ${localTimeText(last.t)}`
    : '时间段读不出来'
  const breakdown = groups.length > 1
    ? groups.map((g) => `${targetLabel(g.key).replace(/（.*/, '')} ${g.count} 条`).join('、')
    : `后端体检 ${backendSamples.length} 条`
  // ⚠️ 用数组拼，别省那几个分号：早先的模板串在某一截为空时印出 `；；`（r245 顺手看的）。
  const headParts = [
    `共 ${samples.length} 条采样${badLines ? `，另 ${badLines} 行读不出来` : ''}`,
    breakdown,
    frontendSamples.length ? `前端体检 ${frontendSamples.length} 条` : '',
    spanText,
    `只看最近 ${primary ? primary.window.length : 0} 条`,
  ].filter((x) => x)
  const head = `体检趋势（${headParts.join('；')}）`
  console.log(head)
  console.log('─'.repeat(52))

  // ⛔ 一条后端体检都没有 ⇒ 这切根本没盯过后端，「没有红色」是说没查，不是说没问题（r221 同款）。
  if (backendGap) {
    console.log(`${C.warn} 这段时间一条后端体检的采样都没有 ⇒ 后端那边等于没盯。`)
    console.log(`${C.warn} 「没有红色」只说明这次没查过，不说明后端这段时间没问题。`)
    console.log(`${C.info} 跑一次就有了：node scripts/healthcheck.mjs --api https://minxue-api.onrender.com --log tmp/health.jsonl`)
  } else if (groups.length > 1) {
    // ⛔ 多机器这条必须有提示：默认不带 --api 跑的就是本机，混进去之后「线上趋势」是假的，
    //    而旧版一句提示都没有（r247-①）。只说发生了什么，不猜是谁跑的。
    console.log(`${C.warn} 这 ${backendSamples.length} 条后端采样里混着 ${groups.length} 台机器：` +
      groups.map((g) => `${g.label} ${g.count} 条`).join('、'))
    console.log(`${C.warn} 下面按机器分开讲 —— 混着看会把本机那几次当成线上在连着出事，也会把两台机器的` +
      `连续运行时间当成同一台的。`)
  }

  for (const g of groups) {
    console.log(`\n${C.info} ${g.label}：${g.count} 条，只看最近 ${g.window.length} 条`)
    if (g.window.length === 0) {
      console.log(`${C.warn} 这段时间这一台一条都没采到，等于没盯。`)
      continue
    }

    // 这次盯了几项（r246-①）
    if (!g.checked.known) {
      console.log(`${C.info} 这批采样没记「这次盯了几项」（老格式），所以只能看出哪几盏灯亮过。`)
    } else {
      const n = g.checked.latest.checked
      const gap = n < g.checked.max
      if (gap) {
        // ⛔ 一整句拼完再打：拆成两行会印出「少了 \n7 项」，断开了就没法回看（r245 实测）。
        console.log(`${C.warn} 这次只盯了 ${n} 项（这段时间最多那次盯了 ${g.checked.max} 项），` +
          `少了 ${g.checked.missing.length} 项：${g.checked.missing.map(String).join('、')}`)
        console.log(`${C.warn}   少跑的这几项这次等于没查 ⇒ 别把它们当成「一直是好的」，` +
          `先看是不是后端没连上把整趟体检带塌了`)
      } else {
        console.log(`${C.ok} 这次盯了几项：${n} 项全跑了`)
      }
      // ⛔ 最近这一次盯全了、但窗口里**前面**有几次没盯全 —— 那几次日志长得跟全绿一样，
      //    不报出来的话「没盯全」这件事还是会被当成没事（r246-① 的原话就是这两行一模一样）。
      if (!gap && g.checked.shortCount > 0) {
        console.log(`${C.warn} 最近 ${g.window.length} 条里有 ${g.checked.shortCount} 次没盯全（最少那次只跑了 ` +
          `${g.checked.min} 项）⇒ 那几次等于只查了一样，别当成这段时间整体都没问题`)
      }
    }

    if (g.badCount > 0) console.log(`${C.bad} 最近 ${g.window.length} 条里有 ${g.badCount} 次需要处理（红色）`)
    else console.log(`${C.ok} 最近 ${g.window.length} 条里没有红色（要处理的）`)

    for (const it of g.items) {
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
        tail = `全 ${g.count} 条里就没亮过`
      }
      const litNote = it.lastLitDetail ? `；亮的时候那句是「${it.lastLitDetail}」` : ''
      console.log(`${it.inWindow > 0 ? C.warn : C.ok} ${it.name}：${pct} ⇒ ${tail}${litNote}`)
    }

    const { upTrail, rtTrail } = trailsOf(g.window)
    if (upTrail.length >= 2) {
      // ⛔ 只说「涨/落」，不下因果结论 —— 重启的原因有一堆（r218 教训）。
      const drop = upTrail[upTrail.length - 1] < upTrail[0]
      const trend = drop ? '中途回落过（中间重启过一次，正常；要看是不是老重启得看前面几十条）' : '一路在涨（这段时间内没重启过）'
      console.log(`${C.info} 连续运行时间：${upTrail[0]} 分钟 → ${upTrail[upTrail.length - 1]} 分钟，${trend}`)
    }
    if (rtTrail.length >= 2) {
      const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length)
      console.log(`${C.info} 响应速度：最近 ${g.window.length} 条平均 ${avg(rtTrail)}ms` +
        `（最早 ${rtTrail[0]}ms，最快 ${Math.min(...rtTrail)}ms，最慢 ${Math.max(...rtTrail)}ms）`)
    }
  }

  if (frontendSummary) {
    const f = frontendSummary
    const at = f.lastAt ? localTimeText(f.lastAt) : '时刻读不出来'
    console.log(`\n${C.info} 前端体检（首页白屏 / 模块链）跑过 ${f.count} 次，最近一次 ${at}：`)
    const mods = f.badCount ? `，坏 ${f.badCount} 个 —— ${f.bad.join('、')}` : ''
    console.log(`${C.info}   · 模块链：${f.modulesOk ?? '?'} 个是 200${mods}`)
    console.log(`${C.info}   · 首页那层：${f.domLayer}`)
    console.log(`${f.verdict === 'healthy' ? C.ok : C.warn}   · 结论：${f.verdictText}`)
  }

  console.log('\n' + '─'.repeat(52))
  console.log(`${C.info} 想看更多：node scripts/healthTrend.mjs --n 50`)
}

process.exitCode = 0
