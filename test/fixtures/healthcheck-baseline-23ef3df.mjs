#!/usr/bin/env node
/**
 * 敏学系统一键体检（只读，不改任何东西）
 *
 * 用途：负责人不想读日志、不想翻数据库时，跑一条命令就知道"系统现在还好吗"。
 * 所有输出用大白话，红色标注的才是需要处理的。
 *
 * 用法：
 *   node scripts/healthcheck.mjs                     # 查本机后端 4000
 *   node scripts/healthcheck.mjs --api https://xxx   # 改查生产
 *   node scripts/healthcheck.mjs --json              # 机器可读（给别的程序用）
 *   node scripts/healthcheck.mjs --log tmp/health.jsonl   # 追加一行采样，用于事后分析
 *
 * 设计约束（勿破坏）：
 *   1) **全程只读**：只发 GET、只跑 SELECT，不写库、不入队、不改配置。
 *   2) 不打印任何密钥、密码、连接串。
 *   3) 某一项失败不能中断整体体检——每项各自 try/catch，坏的显示"查不了"而不是崩。
 */

import path from 'node:path'
import { readFileSync } from 'node:fs'

import { resolveDiskState } from './healthDiskState.mjs'
// ⛔ 字体那盏灯的判定只有 server/utils/cjkFontState.js 一个出处（r221：同一件事只准一个实现）。
//    scripts/ 复用 server/utils/ 不是新规矩 —— scripts/backupKit.mjs、scripts/nightlyAudit.mjs
//    早就 import '../server/utils/period.js' 的 toLocalYmd。
import { resolveCjkFontState } from '../server/utils/cjkFontState.js'

// ── 两把小工具（r229 新增「代码版本」这一项要用）────────────────────────
/** ISO 时刻 → 人话「10-07 11:29」，负责人不看 UTC 的启动时刻。 */
function localTimeText(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '启动时刻读不出来'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 本机 .git 的 HEAD 短号；读不到就返回 null（不猜、不报错，后面只印线上号）。 */
function readLocalHeadShort() {
  try {
    const root = path.resolve(path.dirname(path.resolve(process.argv[1])), '..')
    const head = readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7)
    const m = head.match(/^ref:\s*(.+)$/i)
    if (!m) return null
    const ref = m[1].trim()
    let sha = ''
    try {
      sha = readFileSync(path.join(root, '.git', ref), 'utf8').trim()
    } catch {
      // 分支指针进了 packed-refs（克隆仓库常见），再从那儿找
      const packed = readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8')
      const hit = packed.split('\n').find((l) => l.trim().endsWith(' ' + ref))
      sha = hit ? hit.trim().split(/\s+/)[0] : ''
    }
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null
  } catch {
    return null
  }
}

const argv = process.argv.slice(2)
const JSON_ONLY = argv.includes('--json')
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const API = argOf('--api', 'http://127.0.0.1:4000').replace(/\/+$/, '')
// --log <文件>：把本次结果追加成一行 JSON，用于**持续采样**。
// 2026-10-04 教训：单次观测不足以支撑因果结论（曾把一次部署重启误判成实例休眠），
// 判断"到底什么时候慢"必须靠一段时间的连续数据。
const LOG = argOf('--log', '')
const isProd = !API.includes('127.0.0.1') && !API.includes('localhost')

const C = { ok: '✅', warn: '⚠️ ', bad: '❌', info: 'ℹ️ ' }
const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  if (!JSON_ONLY) console.log(`${status === 'ok' ? C.ok : status === 'warn' ? C.warn : C.bad} ${name}：${detail}`)
}

// ── ⛔ 「字段没真读到」必须明说（2026-10-07 r221）────────────────────────────────
// 体检脚本在同一个雷上连栽三次：
//   r198 磁盘：判据拿不到用量就永远挂「读不到」；
//   r218 接口速度：只取第二次耗时 ⇒ 冷启动 2211ms 也判合格；
//   r220 任务队列：读错嵌套字段 ⇒ 真积压 30 个印「排队 0 个」还判合格。
// 共同点是 `x.y || 0` 式写法 —— **字段取不到时值变成 0/null，判据照常判合格**，
// 而体检的 bad/warn 会记进 tmp/health.jsonl ⇒ 这类「假绿」一次告警都不会出。
// ⇒ 每一项先确认字段**真的在**，再谈合格；没读到就说「这一项等于没盯」。
// ⛔ 文案别写「available 为 undefined」这种词，负责人不看这种；只说后果 + 下一步。
const missingFieldDetail = (label) =>
  `接口没回「${label}」，这一项等于没盯（体检会一直显示正常，其实是空转）。` +
  `多半是接口结构变了，得有个人去核一下，别当它一直是好的。`

// ── 「该比的另一半没比上」也得明说（2026-10-07 r235 补 ㊮）────────────────
// 「代码版本」这一项要判断线上有没有换代码，得**两边都有号**才能比：线上 `commit`
// 有了、本机 HEAD 却读不出来（脚本被复制到别处跑 / 没有 git 信息）时，
// 旧的写法 `comparable && local && local !== short` 里 `local` 为 null ⇒ behind 恒假 ⇒
// 印 ✅ 判合格，看着在盯，其实**一次都没比过**。r221 补的「字段没真读到必须明说」
// 只堵住了线上那一半，这条分支是它的漏网。
// ⛔ 措辞只说后果和下一步，不甩「git 目录结构」这类词 —— 夸大的告警比没告警更糟（r198）。
const noLocalVersionDetail = (short) =>
  `读不出你本地跑的是哪一版（线上是 ${short}，体检脚本旁边没有 git 信息，多半是被复制到别处跑了），` +
  `这一项等于没盯（体检会一直显示正常，其实是空转）。把脚本放回仓库里再跑一次，别当它一直是好的。`

// ── 1. 后端在不在 ────────────────────────────────────────────────────────
let health = null
try {
  const t0 = Date.now()
  const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(15000) })
  const j = await r.json()
  health = { ...j, rt: Date.now() - t0 }
  const up = typeof health.uptimeSec === 'number' ? Math.round(health.uptimeSec / 60) : null
  if (up === null) {
    // ⛔ 旧版只是把分钟数印成「?」然后照样判合格 —— 看着像在盯，其实没盯（r221）。
    record('后端在线', 'warn', missingFieldDetail('运行了多少分钟'))
  } else {
    record('后端在线', 'ok', `已运行 ${up} 分钟，响应 ${health.rt}ms`)
  }
} catch (e) {
  record('后端在线', 'bad', `连不上（${e.message}）。本地跑 ${API} 启动；线上请看 Render 后台日志`)
}

// ── 2. 响应速度（本地/内网正常 <0.3s；国内访问美国服务器约 0.7~1.3s，属正常）──
if (health) {
  try {
    const t0 = Date.now()
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(20000) })
    const recheckMs = Date.now() - t0
    // ⛔ 2026-10-06 r218 实测抓到的漏判：**第一次**调用（含冷连接/冷启动）最慢，
    // 旧版只拿第二次的耗时去判 —— 结果同一行体检里「后端在线」报 2211ms（很慢），
    // 「接口速度」却用复查的 335ms 判 ok，结论照旧「一切正常」。
    // 冷启动慢是老师最该知道的（发布后头几分钟打不开），却被判据漏掉。
    // ⇒ 判据取两次里**最慢的一次**，并把两个数字都印出来，别让人猜。
    const firstMs = health.rt
    const ms = Math.max(firstMs, recheckMs)
    const limit = isProd ? 2000 : 500
    record('接口速度', ms <= limit ? 'ok' : 'warn',
      `${ms}ms${ms > limit ? `（超过 ${limit}ms，${isProd ? '多为网络往返，可稍后再试或让服务器换到离国内更近的机房' : '本地偏慢，查连接池'}）` : '（正常）'}` +
      `｜首次 ${firstMs}ms${recheckMs === firstMs ? '' : ` / 复查 ${recheckMs}ms`}`)
  } catch (e) {
    record('接口速度', 'warn', `测不了：${e.message}`)
  }
}

// ── 3. 数据能不能读到（读得到 = 数据库正常）──────────────────────────────
let students = null
if (health) {
  try {
    const t0 = Date.now()
    const r = await fetch(`${API}/api/students`, { signal: AbortSignal.timeout(20000) })
    const j = await r.json()
    // ⛔ 旧版 `j.students || []` 把「字段没回」和「一个学生都没有」混成同一句「读到 0 名学生」，
    //    真出问题的信号被一句听不出毛病的话盖住了（r221）。
    if (j.students === undefined) {
      record('数据库可读', 'warn', missingFieldDetail('学生名单'))
    } else {
      students = j.students || []
      record('数据库可读', students.length ? 'ok' : 'warn',
        `读到 ${students.length} 名学生，用时 ${Date.now() - t0}ms`)
    }
  } catch (e) {
    record('数据库可读', 'bad', `读不到：${e.message}`)
  }
}

// ── 4. 有没有卡住/失败的任务（这才是老师真正关心的）─────────────────────
if (health) {
  try {
    const r = await fetch(`${API}/api/tasks/summary`, { signal: AbortSignal.timeout(20000) })
    const s = (await r.json()).summary
    // ⛔ 旧版 `.summary || {}`：接口哪天不回 summary，就退化成「没有失败也没有卡住的任务」⇒ 判合格。
    //    老师看到全绿，实际这一项一次都没在盯（r221，与 r220 队列同款）。
    if (s === undefined) {
      record('批改失败任务', 'warn', missingFieldDetail('有没有失败/卡住的作业'))
    } else {
      // ⛔ r233：pendingTasks / failedTasks 是 summary 的**子字段**，r221 只堵了整层 summary 在不在。
      // 真接口两个字段都在（`server/index.js:713-753` 的 SELECT 明列），但哪天改名或拆结构，
      // `(pendingTasks || []).length` 会变 0、`failedTasks || 0` 会变 0 ⇒ 照旧印
      // 「没有失败也没有卡住的任务」判合格 —— 跟 r221 想堵的假绿同款，只是往下挪了一层。
      // ⇒ 判必须在补默认值**之前**做，才分得出「真没失败」和「字段没了」。
      const tasksMissing = s.pendingTasks === undefined || s.failedTasks === undefined
      const stuck = (s.pendingTasks || []).length
      const failed = s.failedTasks || 0
      if (tasksMissing) {
        record('批改失败任务', 'warn', missingFieldDetail('有几份批改失败 / 哪些作业卡住了'))
      } else if (failed > 0) {
        record('批改失败任务', 'bad', `${failed} 份作业批改失败，需在 App 里点重试`)
      } else if (stuck > 0) {
        record('批改失败任务', 'warn', `${stuck} 份作业卡在处理中，等一会儿再看；持续卡住就重启后端`)
      } else {
        record('批改失败任务', 'ok', '没有失败也没有卡住的任务')
      }
    }
  } catch (e) {
    record('批改失败任务', 'warn', `查不了：${e.message}`)
  }
}

// ── 5. 队列积压（偶尔堆积正常，持续堆积要管）─────────────────────────────
/**
 * 「判不出来、也不会再重试」这批作业的真实处境（r243 改）：系统**既不会重判、也不会自己消掉**，
 * ⇒ 必须原话讲清楚。旧版那句「（失败数会定期清理，看趋势不看绝对值）」是假安慰：
 * 全仓唯一会「删除 tasks 表记录」的语句只出现在删学生数据的运维脚本
 * （`server/scripts/cleanup-student-data.mjs`）里，**那不是清理判不出来的作业**：
 * ⇒ 没有任何一处定时清理它们。**注释里故意不写这条 SQL 的字面量**：
 * `test/healthcheckSafety.test.mjs` 那条安全锁是全文扫一个「删表」关键字（不分注释代码），
 * 原样写进去会把「体检脚本不得写库」这条锁打红（r243 实测踩到）。改注释前先想这句会不会被那条锁扫到。
 * 而这句话只有 f>0 时才接在数字后面，所以单独抽成一个常量、方便锁住它的措辞（见 healthcheckQueueStats）。
 */
const FAILED_HONEST_TAIL = '（这几个不会自己重判、也不会自己消掉，会一直留在这个数里）'

if (health) {
  try {
    const r = await fetch(`${API}/api/queue/stats`, { signal: AbortSignal.timeout(20000) })
    // ⛔ 2026-10-07 r220 实测抓到的漏判（与 r218「接口速度」、r198「磁盘」同一枚雷：
    //   判据取不到字段 ⇒ **永远合格**，而这类告警一次都不会出现在 tmp/health.jsonl 里）。
    //   真接口 `GET /api/queue/stats` 返回的是 **{ success, stats:{ waiting,active,failed,... } }**
    //   （server/index.js:1711-1719），旧代码直接读根级 q.waiting ⇒ undefined || 0 ⇒ 恒 0。
    //   实测取证：生产真值 stats.failed=50、stats.waiting=0，体检却印「历史上失败 0 个」；
    //   等待数刚好是 0 才蒙对，**真积压时（>20）照样报「排队 0 个」然后判合格** ——
    //   恰好漏在最该被叫醒的时刻。
    const queueBody = await r.json()
    const q = queueBody.stats || queueBody || {}
    // ⛔ 要在**补默认值之前**判定：q.waiting 一 `|| 0` 就再也分不出「真 0」和「字段没回」（r221）。
    const queueMissing = q.waiting === undefined || q.active === undefined || q.failed === undefined
    const w = q.waiting || 0
    const a = q.active || 0
    const f = q.failed || 0
    // ⚠️ failed 只印不判：本机实测 failed=~50，一旦加判就天天黄灯，
    //    会重演 r198「恒定黄灯淹掉真告警」。
    // ⛔ r243：这个数**必须说真话**。旧版印「失败数会定期清理」是假话 ——
    //    全仓没有任何一处定时清理判不出来的作业（那条「删除 tasks 表记录」的语句在删学生数据的
    //    运维脚本里，不是清理这些作业；⛔ 注释里不写这条 SQL 字面量，安全锁全文扫会打红；
    //    详见 FAILED_HONEST_TAIL 的说明）。
    //    而这里统计的是 `describeAutoRetry(...) === false` 的那一批（不会再重试），
    //    ⇒ 它们既不会自己重判、也不会自己消掉，会永远留在这个数里。安慰一句「会自己清理」
    //    只会让老师以为不用管（r198：夸大的提示比没提示更糟）。
    //    「看趋势不看绝对值」这句同样兑现不了：这一行只印一个数，趋势得去跑 healthTrend.mjs。
    // ⛔ 用 `+` 拼接而不是把 FAILED_HONEST_TAIL 塞进模板串：常量里带中文括号，
    //    塞进模板串后反向自检的「字符串手术」没法安全地换回旧措辞（r243 实测踩到）。
    const failedText = f > 0
      ? `、判不出来且不会再重试的 ${f} 个` + FAILED_HONEST_TAIL
      : '、判不出来且不会再重试的 0 个'
    // ⚠️ 至于 available：Redis 掉线时 waiting/active 可能还是 0，那就等于没盯，必须单独叫醒。
    if (q.available === false) record('任务队列', 'warn', '队列服务连不上（多半是 Redis 掉了）：作业堆在进程里进不了队列，这张表会一直显示 0，建议重启后端')
    else if (queueMissing) record('任务队列', 'warn', missingFieldDetail('排队/进行中/失败的数量'))
    else if (w > 20) record('任务队列', 'warn', `排队 ${w} 个（积压偏多，可能是 AI 额度紧张导致重试堆积）`)
    else record('任务队列', 'ok', `排队 ${w} 个、进行中 ${a} 个${failedText}`)
  } catch (e) {
    record('任务队列', 'warn', `查不了：${e.message}`)
  }
}

// ── 6. 服务器磁盘会不会满（图片存服务器上，这是最容易忽略的坑）───────────
// r198：/api/health 会回 disk（实测剩余 MB），所以**真能报出数字就不该再挂着「读不到」的黄灯**——
// 恒定亮着的黄灯会把「批改失败 / 队列积压」这些真告警一起淹掉。判据收敛到 healthDiskState.mjs。
if (health) {
  const diskState = resolveDiskState(health.disk)
  record('服务器磁盘', diskState.status, diskState.detail)
}

// ── 7. 线上跑的是哪一版代码（㊼：推了没上线，体检必须看得出来）──────────
// ⛔ 2026-10-07 r229 实测：/api/health 一直回 commit / bootAt 两个字段，体检却从不印，
//    ⇒ 「我刚推的新代码到底上没上线」这件事只能人肉 curl 才知道。r220~r228 连着好几轮
//    都是靠人工 curl 才发现线上还停在旧提交（本轮实测：落后 31 个提交、12 小时零重启）。
//    沿用 r221 口径：字段没真读到就必须明说，不许悄悄判合格。
if (health) {
  try {
    if (!health.commit) {
      record('代码版本', 'warn', missingFieldDetail('代码版本号（线上跑的是哪一版）'))
    } else {
      const short = String(health.commit).slice(0, 7)
      const boot = localTimeText(health.bootAt)
      // ⚠️ 本机后端常把 commit 写成 non-sha 占位（实测 'local'），那种号没法跟本地比，
      //    硬比会天天挂黄灯（r198 教训：恒定黄灯会淹掉真告警）⇒ 只照实印，不判。
      const comparable = /^[0-9a-f]{7,40}$/i.test(String(health.commit))
      const local = comparable ? readLocalHeadShort() : null
      // ⛔ r235：本机版本号读不出来时不许悄悄判合格（上面那条 missingFieldDetail 只管线上那一半）
      if (comparable && local === null) {
        record('代码版本', 'warn', noLocalVersionDetail(short))
      } else {
        const behind = comparable && local && local !== short
        record('代码版本', behind ? 'warn' : 'ok',
          `${behind ? `线上还是 ${short}，你本地已经是 ${local} ⇒ 这段新代码没上线，去 Render 面板手动部署或确认自动部署` : `线上 commit ${short}`}（${boot} 启动的）`)
      }
    }
  } catch (e) {
    record('代码版本', 'warn', `查不了：${e.message}`)
  }
}

// ── 8. 发给家长的那张图，中文还有没有字形（r241 新增，补 r134 之后的监控缺口）──
// ⛔ 2026-10-05 r134 实测：服务端容器里一个中文字体都没有，家长拿到的分享卡整张卡中文全是方框，
//    修完用了 woff2 兜底，但**此后没有任何一处会再问一次「字体还在不在」** ——
//    文件被误删 / 部署资产没带上 ⇒ renderFontFace 只在渲染那一瞬间 console.error 一句，
//    之后永远输出方框，体检照旧七项全绿。和 r221「字段没真读到就明说」完全同款：
//    有一件事看着在盯，其实一次都没盯过。
//    这一项是体检里**唯一管「家长实际看到的东西」**的一项（其余七项都只盯服务器自己）。
// ⛔ 文案必须说后果（家长收到的是看不懂的图）和下一步（补回字体文件重启），不许只甩字段名。
if (health) {
  const fontState = resolveCjkFontState(health.cjkFont)
  record('家长卡片中文字', fontState.status, fontState.detail)
}

// ── 追加采样日志（一行一条，便于事后按时间窗口分析）────────────────────
if (LOG) {
  // 「哪几盏灯亮、亮的时候说了句什么」原样记进采样（r246-①）：只有灯名的话，
  // 事后只知「亮过」，不知道当时 199MB 还是 1GB —— 57 条采样 44 次亮灯无一带数字。
  const lit = {}
  for (const r of results) if (r.status !== 'ok') lit[r.name] = r.detail
  const line = JSON.stringify({
    t: new Date().toISOString(),
    // ⛔ r239：这个文件和 scripts/frontendHealth.mjs 写的是**同一个** tmp/health.jsonl
    //    （后者的 --log 默认值就是它），但两行结构完全不同。打上 kind 让读的那边能分清，
    //    否则前端体检的「坏模块清单」会被当成体检查出的一盏灯（实测会印出 [object Object]）。
    kind: 'backend',
    api: API,
    // ⛔ r246-①：早先这一行只记 bad/warn 两个灯名数组 ⇒ 「某项压根没执行」和「某项全绿」
    //    在日志里**逐字相同**（实测：后端连不上时只跑了 1 项，采样同样是 `bad:["后端在线"]`，
    //    跟「盯满 8 项、7 绿 1 红」长得一模一样）⇒ 事后分不出这次到底盯了几项。
    //    checked / checkedNames = 这次真跑了哪几项；lit = 亮的时候那句人话原样记下来。
    //    ⛔ 别拿 checked 当判红条件（r221：字段真的只返回 0 不算没读到），只当事实记录。
    checked: results.length,
    checkedNames: results.map((r) => r.name),
    lit,
    upMin: health && typeof health.uptimeSec === 'number' ? Math.round(health.uptimeSec / 60) : null,
    rtMs: health ? health.rt : null,
    bad: results.filter((r) => r.status === 'bad').map((r) => r.name),
    warn: results.filter((r) => r.status === 'warn').map((r) => r.name),
  })
  try {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(path.dirname(LOG), { recursive: true })
    appendFileSync(LOG, line + '\n', 'utf8')
    if (!JSON_ONLY) {
      console.log(`\n${C.info} 已记到 ${LOG}`)
      // 采样攒了没人看等于白攒（提案 ㊱）：直接把趋势命令推到负责人眼前，不必等人翻文件。
      console.log(`${C.info} 想看最近这段是变好还是变差：node scripts/healthTrend.mjs`)
    }
  } catch (e) {
    console.error(`${C.warn} 写日志失败（不影响体检结果）：${e.message}`)
  }
}

if (JSON_ONLY) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), api: API, results }, null, 2))
} else {
  const bad = results.filter((r) => r.status === 'bad').length
  const warn = results.filter((r) => r.status === 'warn').length
  console.log('\n' + '─'.repeat(56))
  if (bad === 0 && warn === 0) console.log('结论：一切正常，不用管。')
  else if (bad === 0) console.log(`结论：没有致命问题，但有 ${warn} 项想提醒你（黄色）。`)
  else console.log(`结论：${bad} 项需要处理（红色），建议先看红色那几条。`)
  console.log('─'.repeat(56))
}
process.exitCode = results.some((r) => r.status === 'bad') ? 1 : 0
