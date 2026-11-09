/**
 * 试卷题库「零错字」硬校验（2026-11-09 松江一模事故沉淀）。
 *
 * 用途：对任意一份已解析的试卷资源做**逐题盲抄复核**，找出并修正字母/数字/汉字错字。
 * 与线上双模型闸的区别：闸看整页图（2382×3368 被供应商降采样），本脚本看**单题 4x 裁片**，
 * 并用三个不同厂商的模型各抄一遍，只在「两通道以上一致且无人支持原值」时才改库。
 *
 * 实战数据（2026-11-09 松江一模）：线上闸只查出 15 处，本脚本 6 次读图查出 37 处。
 * 因此一模卷在验收前必须跑本脚本，且 --verify 必须 0 处多通道差异。
 *
 * 设计要点（与 v1 的差别）：
 *   1. **词元对齐**：数字（36/60/1.5）、字母串（ADC/BAC）、数学符号各算一个词元。
 *      v1 用逐字符 LCS 时，"36→60" 会被拆成「删 3 / 留 6 / 插 0」，两端都不完整而被丢掉。
 *   2. **题干成组裁片**：小问共享的 parent_stem 不在任何一行的 bbox 里，
 *      按「上一组底 → 首个小问顶」单独切一条带去抄，避免题干永远没人校验。
 *   3. **三厂商盲抄**：Gemini / Qwen-flash / Qwen-max，互不可见。
 *   4. **差异再确认**：只有 ≥2 个通道同时抄出同一个替换、且无通道支持库里原值，才允许改库。
 *   5. **闭环验证**：改完再用**换一套问法**的第二次盲抄复核，残余差异全部列出。
 *
 * 用法：
 *   node _zero_typo_v2.mjs --pages=3            # 检查（阶段一）
 *   node _zero_typo_v2.mjs --apply              # 应用三通道共识修正
 *   node _zero_typo_v2.mjs --verify             # 换问法复核（阶段二）
 *   node _zero_typo_v2.mjs --no-cache           # 重新调用（会重新计费）
 */
import { fileURLToPath } from 'url'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../../server/.env', import.meta.url)) })
import sharp from 'sharp'
import { getPool } from '../../server/config/neon.js'
import { callVisionCompletion } from '../../server/config/ai.js'

const resArg = process.argv.find(a => a.startsWith('--resource='))
const RES_ID = resArg ? resArg.split('=')[1] : ''
if (!RES_ID) {
  console.error('用法: node scripts/ops/zero_typo_audit.mjs --resource=<资源id> [--pages=1,2] [--apply] [--verify] [--no-cache]')
  process.exit(2)
}
const RES_TAG = RES_ID.slice(0, 8)
const APPLY = process.argv.includes('--apply')
const VERIFY = process.argv.includes('--verify')
const NO_CACHE = process.argv.includes('--no-cache')
const pagesArg = process.argv.find(a => a.startsWith('--pages='))
const ONLY_PAGES = pagesArg ? pagesArg.split('=')[1].split(',').map(Number).filter(Boolean) : null
const PHASE = VERIFY ? 't2' : 't1'
const TMP = fileURLToPath(new URL('../../.audit_tmp/', import.meta.url))
fs.mkdirSync(TMP, { recursive: true })
const CACHE_FILE = TMP + `zero_typo_cache_${RES_TAG}_${PHASE}.json`
const BACKUP_FILE = TMP + `zero_typo_backup_${RES_TAG}.json`
const REPORT_FILE = TMP + `zero_typo_${RES_TAG}_${PHASE}_report.json`

// 三通道：Gemini（Google 系）+ Qwen 两档（同厂不同模型，用于交叉确认）
const CHANNELS = [
  { key: 'gemini-3.5', chain: [{ vendor: 'HuihuiyunGemini', model: 'gemini-3.5-flash' }] },
  { key: 'qwen3.8', chain: [{ vendor: 'Bailian', model: 'qwen3.8-flash', extraBody: { enable_thinking: false } }] },
  { key: 'qwen3.8-max', chain: [{ vendor: 'Bailian', model: 'qwen3.8-max', extraBody: { enable_thinking: false } }] },
]

const PROMPT_A = [
  '你是中考数学一模卷的逐字抄录员。图中是试卷上一道题的**高清裁片**（可能含相邻题残行、配图）。',
  '把题目印刷文字原样抄成一行纯文本。保留 ∠ △ √ ° ∥ ⊥ ∽ 等数学符号，上下标用 ² ³ 表示。',
  '⛔ 不要解题、不要用数学关系推测、不要补全条件、不要修正标点、不要翻译。',
  '⛔ 看不清的单个字符写 ?，不要凭上下文猜。',
  '只输出 JSON：{"text":"..."}',
].join('\n')

const PROMPT_B = [
  '这是中考一模数学卷的一道题。请作为校对员，把图中印刷的每一个字符**逐字**转写出来。',
  '要求：按原文顺序（题号行 → 题干 → 小问），符号照原样（∠△√°∥⊥∽），分数写成 a/b。',
  '⛔ 严禁根据数学逻辑修改任何字母或数字：卷面写的是什么就抄什么，哪怕你觉得它不对。',
  '⛔ 拿不准的字符用 ? 代替。',
  '输出 JSON：{"text":"..."}',
].join('\n')

let cache = {}
if (!NO_CACHE && fs.existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch { cache = {} }
}
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1), 'utf8')
const ck = (id, ch) => `${id}|${ch}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function parseJsonLoose(text) {
  const s = String(text || '')
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch { /* next */ } }
  try { return JSON.parse(s) } catch { return null }
}

const SUPER = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', 'n': 'ⁿ' }
function normalizeMath(src) {
  let t = String(src ?? '').replace(/\r/g, '').replace(/\$+/g, '').replace(/\\[()\[\]]/g, '')
  for (let i = 0; i < 6; i++) {
    const next = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    if (next === t) break
    t = next
  }
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)').replace(/\\sqrt\s*([A-Za-z0-9])/g, '√$1')
  const cmds = {
    angle: '∠', triangle: '△', cdot: '·', times: '×', div: '÷', pm: '±',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
    circ: '°', degree: '°', parallel: '∥', perp: '⊥', because: '∵', therefore: '∴',
    alpha: 'α', beta: 'β', gamma: 'γ', theta: 'θ', pi: 'π', sim: '∽', backsim: '∽',
    text: '', mathrm: '', left: '', right: '', displaystyle: '', quad: '', qquad: '',
  }
  t = t.replace(/\\([A-Za-z]+)/g, (m, name) => (name in cmds ? cmds[name] : ''))
  t = t.replace(/\\[,;:! ]/g, '')
  t = t.replace(/\^\s*\{?\s*([0-9n])\s*\}?/g, (m, d) => SUPER[d] || d)
  t = t.replace(/\^\s*\{?\s*-\s*1\s*\}?/g, '⁻¹')
  t = t.replace(/_\s*\{?\s*([0-9A-Za-z])\s*\}?/g, '$1').replace(/_/g, '')
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  t = t.replace(/[，、]/g, ',').replace(/。/g, '.').replace(/；/g, ';')
  t = t.replace(/[：]/g, ':').replace(/[（]/g, '(').replace(/[）]/g, ')')
  t = t.replace(/[－−–—﹣]/g, '-').replace(/[＋]/g, '+').replace(/[＝]/g, '=')
  t = t.replace(/[×✕✖]/g, '×').replace(/[÷]/g, '÷').replace(/[·•∙・]/g, '·')
  t = t.replace(/[△Δ▲]/g, '△').replace(/[∽∼]/g, '∽')
  t = t.replace(/[“”"'‘’]/g, '')
  // Unicode 上下标 → ASCII（2026-11-09 松江 q3 实测：库里 y₁、模型抄 y1，
  // 不统一会让词元对齐整体错位，进而把「₁」误报成「与→1」这类假差异）
  const SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, c => SUP_MAP[c] || c)
  t = t.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x2050)) // U+2080 → '0'(0x30)
  return t.replace(/\s+/g, '')
}

/** 词元：数字（含小数）| 字母串 | 数学符号 | 单个其他字符 */
const TOKEN_RE = /[0-9]+(?:\.[0-9]+)?|[A-Za-z]+|[∠△√°±≤≥≠∽∥⊥·×÷∵∴]|[\s\S]/gu
const tokenize = (s) => (s.match(TOKEN_RE) || [])
const SENSITIVE = /[A-Za-z0-9∠△√°±≤≥≠∽∥⊥·×÷\u4e00-\u9fff]/
/** 去掉两端「非敏感字符」（标点/括号），只保留会改变题意的部分，
 *  否则「8√5,」→「60.」这种会被当成整段替换、把逗号一起改掉。 */
function trimSensitive(s) {
  const chars = [...String(s || '')]
  let a = 0; let b = chars.length
  while (a < b && !SENSITIVE.test(chars[a])) a++
  while (b > a && !SENSITIVE.test(chars[b - 1])) b--
  return chars.slice(a, b).join('')
}

/** 词元级 LCS diff */
function diffTokens(dbText, modelText) {
  const a = tokenize(dbText)
  const b = tokenize(modelText)
  const n = a.length; const m = b.length
  if (!n || !m) return []
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0; let j = 0; let cur = null
  const flush = () => {
    if (!cur) return
    out.push({
      dbPart: cur.dbPart, modelPart: cur.modelPart,
      before: a.slice(Math.max(0, cur.at - 9), cur.at).join(''),
      after: a.slice(cur.at + cur.dbTokens, cur.at + cur.dbTokens + 9).join(''),
      at: cur.at, dbTokens: cur.dbTokens,
    })
    cur = null
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) { flush(); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) {
      cur = cur || { dbPart: '', modelPart: '', at: i, dbTokens: 0 }
      cur.dbPart += a[i]; cur.dbTokens += 1; i++
    } else {
      cur = cur || { dbPart: '', modelPart: '', at: i, dbTokens: 0 }
      cur.modelPart += b[j]; j++
    }
  }
  while (i < n) { cur = cur || { dbPart: '', modelPart: '', at: i, dbTokens: 0 }; cur.dbPart += a[i]; cur.dbTokens += 1; i++ }
  while (j < m) { cur = cur || { dbPart: '', modelPart: '', at: i, dbTokens: 0 }; cur.modelPart += b[j]; j++ }
  flush()
  return out.filter(h => (h.dbPart || h.modelPart) && (h.dbPart + h.modelPart).length <= 30)
}

// ── 数据 ────────────────────────────────────────────────────────────────
const pool = getPool()
const { rows: resRows } = await pool.query(`SELECT name, metadata FROM resources WHERE id=$1`, [RES_ID])
const resource = resRows[0]
const dbRows = (await pool.query(
  `SELECT id, page_no, question_no, sub_no, content, parent_stem, options, bbox, page_image_url
     FROM resource_questions WHERE resource_id=$1 ORDER BY page_no, question_no, sub_no`, [RES_ID])).rows

/** 目标 = 每一行（正文）+ 每个小题组的题干带（parent_stem） */
const targets = []
const byPage = new Map()
for (const r of dbRows) {
  if (!byPage.has(r.page_no)) byPage.set(r.page_no, [])
  byPage.get(r.page_no).push(r)
}
for (const [pageNo, list] of byPage) {
  if (ONLY_PAGES && !ONLY_PAGES.includes(pageNo)) continue
  for (const r of list) {
    targets.push({
      kind: 'row', page: pageNo, rowIds: [r.id], question_no: r.question_no, sub_no: r.sub_no,
      label: `${r.question_no}${r.sub_no ? `(${r.sub_no})` : ''}`,
      expect: r.content || '', field: 'content', bbox: r.bbox, page_image_url: r.page_image_url,
    })
  }
  // 题干带：同 question_no 且有 parent_stem
  const groups = new Map()
  for (const r of list) {
    if (!r.parent_stem) continue
    if (!groups.has(r.question_no)) groups.set(r.question_no, [])
    groups.get(r.question_no).push(r)
  }
  const questionNos = [...new Set(list.map(r => r.question_no))].sort((a, b) => a - b)
  for (const [qno, list2] of groups) {
    const firstY = Math.min(...list2.map(r => r.bbox?.y ?? 1000))
    const prevQ = questionNos.filter(n => n < qno).pop()
    let prevBottom = 0
    if (prevQ != null) {
      const prevRows = list.filter(r => r.question_no === prevQ && r.bbox)
      if (prevRows.length) prevBottom = Math.max(...prevRows.map(r => r.bbox.y + r.bbox.height))
    }
    const top = Math.max(prevBottom + 1, firstY - 75)
    targets.push({
      kind: 'stem', page: pageNo, rowIds: list2.map(r => r.id), question_no: qno, sub_no: '',
      label: `${qno}(题干)`, expect: list2[0].parent_stem, field: 'parent_stem',
      bbox: { x: 55, y: top, width: 900, height: Math.max(20, firstY + 6 - top) },
      page_image_url: list2[0].page_image_url,
    })
  }
}
targets.sort((a, b) => a.page - b.page || a.question_no - b.question_no || (a.kind === 'stem' ? -1 : 1))

console.log(`[zero-typo] phase=${PHASE} ${resource.name}：${dbRows.length} 行，${targets.length} 个抄录目标，apply=${APPLY}`)

const pageBuf = new Map()
async function pageImage(pageNo, url) {
  if (pageBuf.has(pageNo)) return pageBuf.get(pageNo)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`整页图下载失败 HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const meta = await sharp(buf).metadata()
  const entry = { buf, width: meta.width, height: meta.height }
  pageBuf.set(pageNo, entry)
  return entry
}

async function cropDataUrl(page, bbox) {
  if (!bbox) return null
  const px = (v, total) => Math.round(v / 1000 * total)
  let left = px(bbox.x, page.width) - 12
  let top = px(bbox.y, page.height) - 12
  let width = px(bbox.width, page.width) + 24
  let height = px(bbox.height, page.height) + 24
  left = Math.max(0, left); top = Math.max(0, top)
  width = Math.min(page.width - left, Math.max(60, width))
  height = Math.min(page.height - top, Math.max(40, height))
  const out = await sharp(page.buf).extract({ left, top, width, height }).jpeg({ quality: 95 }).toBuffer()
  return 'data:image/jpeg;base64,' + out.toString('base64')
}

async function callChannel(ch, imageDataURL, systemPrompt, userText, maxTokens = 1800) {
  const out = await callVisionCompletion({
    imageDataURL, systemPrompt, userText, temperature: 0.02, maxTokens,
    vendorChain: ch.chain, noBackup: true, timeout: 120000,
  })
  return String(out.content || '')
}

async function transcribeTarget(t) {
  const page = await pageImage(t.page, t.page_image_url)
  const dataUrl = await cropDataUrl(page, t.bbox)
  if (!dataUrl) return []
  const system = VERIFY ? PROMPT_B : PROMPT_A
  const ask = VERIFY
    ? `逐字转写这道题（第 ${t.label} 题）。只输出 JSON。`
    : `抄录第 ${t.label} 题的印刷文字。只输出 JSON。`
  const results = await Promise.all(CHANNELS.map(async (ch) => {
    const key = ck(`${t.kind}:${t.page}:${t.label}`, ch.key)
    if (!NO_CACHE && cache[key] != null) return { channel: ch.key, text: cache[key] }
    try {
      const raw = await callChannel(ch, dataUrl, system, ask)
      const obj = parseJsonLoose(raw)
      const text = obj?.text != null ? String(obj.text) : String(raw).trim()
      cache[key] = text; saveCache()
      return { channel: ch.key, text }
    } catch (e) {
      console.warn(`  ✗ ${t.page}/${t.label} ${ch.key}: ${String(e?.message || e).slice(0, 110)}`)
      return { channel: ch.key, text: null }
    }
  }))
  return results
}

// ── 主循环 ──────────────────────────────────────────────────────────────
const findings = []
const residuals = []
const numericFlags = []
const stats = { targets: 0, okChannels: 0, failed: 0 }

for (const t of targets) {
  stats.targets += 1
  const results = await transcribeTarget(t)
  const ok = results.filter(r => r.text)
  stats.okChannels += ok.length
  const dbNorm = normalizeMath(t.expect)
  if (!dbNorm) continue
  const perChannel = []
  for (const r of ok) {
    const modelNorm = normalizeMath(r.text)
    if (!modelNorm) continue
    for (const h of diffTokens(dbNorm, modelNorm)) {
      const dbPart = trimSensitive(h.dbPart)
      const modelPart = trimSensitive(h.modelPart)
      const hasBoth = dbPart && modelPart
      const isMissing = dbPart && !modelPart && !h.modelPart
      if (!hasBoth && !isMissing) continue              // 纯新增/纯标点差异不算错
      if (!dbPart) continue
      if (isMissing && dbPart.length > 12) continue    // 大段缺失通常是裁片边界，不当错字
      perChannel.push({ channel: r.channel, ...h, dbPart, modelPart, isMissing })
    }
  }
  const clusters = []
  for (const h of perChannel) {
    const sig = `${h.before}|${h.dbPart}|${h.isMissing ? 'M' : 'S'}`
    let c = clusters.find(x => x.sig === sig)
    if (!c) {
      c = { sig, dbPart: h.dbPart, modelPart: h.modelPart, before: h.before, after: h.after,
            isMissing: h.isMissing, votes: new Set() }
      clusters.push(c)
    }
    // 同一处若不同通道给出不同替换，记下来，交给人工
    if (c.modelPart !== h.modelPart) c.conflictParts = [...(c.conflictParts || []), h.modelPart]
    c.votes.add(h.channel)
  }
  const totalChannels = ok.length
  // 数字清单比对（格式无关）：表格/多行里的数值最容易被对齐算法吃掉，
  // 只要某个通道抄出的数字集合与库里不同，就单独记一条供人工看。
  if (VERIFY) {
    const numsOf = (s) => (String(s).match(/[0-9]+(?:\.[0-9]+)?/g) || []).sort().join(',')
    const dbNums = numsOf(dbNorm)
    for (const r of ok) {
      const modelNums = numsOf(normalizeMath(r.text))
      if (dbNums !== modelNums) {
        numericFlags.push({
          page: t.page, question_no: t.question_no, sub_no: t.sub_no, kind: t.kind,
          channel: r.channel, dbNums, modelNums, expect: t.expect, text: r.text,
        })
      }
    }
  }
  for (const c of clusters) {
    const item = {
      page: t.page, question_no: t.question_no, sub_no: t.sub_no, kind: t.kind,
      rowIds: t.rowIds, field: t.field,
      dbPart: c.dbPart, modelPart: c.modelPart, before: c.before, after: c.after,
      isMissing: c.isMissing, conflictParts: c.conflictParts || [],
      votes: [...c.votes], totalChannels, expect: t.expect,
    }
    if (VERIFY) residuals.push(item)
    else findings.push(item)
  }
}

const list = VERIFY ? residuals : findings
const confirmed = list.filter(f => !f.isMissing && f.votes.length >= 2 && f.totalChannels >= 2 && !f.conflictParts?.length)
const suspect = list.filter(f => !confirmed.includes(f))

console.log(`\n[zero-typo] 目标 ${stats.targets}，通道成功 ${stats.okChannels}/${stats.targets * CHANNELS.length}`)
console.log(`[zero-typo] ${VERIFY ? '复核残余' : '候选差异'} ${list.length} 处；两通道以上共识 ${confirmed.length} 处，待核 ${suspect.length} 处`)
for (const f of list) {
  const tag = f.votes.length >= 2 ? '✔' : '·'
  console.log(`  ${tag} ${f.kind === 'stem' ? `p${f.page} q${f.question_no}(题干)` : `p${f.page} q${f.question_no}(${f.sub_no || '-'})`} 库「${f.dbPart || '∅'}」→ 抄「${f.modelPart || '∅'}」 [${f.votes.join(',')}/${f.totalChannels}] …${f.before}【${f.dbPart}】${f.after}…`)
}

fs.writeFileSync(REPORT_FILE, JSON.stringify({
  resourceId: RES_ID, resourceName: resource.name, phase: PHASE, at: new Date().toISOString(),
  stats, items: list, numericFlags,
}, null, 2), 'utf8')
console.log(`[zero-typo] 报告 → ${REPORT_FILE}`)
if (VERIFY && numericFlags.length) {
  console.log(`\n[zero-typo] 数字清单不一致 ${numericFlags.length} 条（格式无关，供人工确认表格/多行数值）：`)
  const seen = new Set()
  for (const f of numericFlags) {
    const k = `${f.page}|${f.question_no}|${f.sub_no}|${f.dbNums}|${f.modelNums}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`  p${f.page} q${f.question_no}(${f.sub_no || '-'}) 库[${f.dbNums}] vs 抄[${f.modelNums}] (${f.channel})`)
  }
}

// ── 应用修正 ────────────────────────────────────────────────────────────
if (APPLY && !VERIFY) {
  const norm = (s) => normalizeMath(s)
  const locate = (text, dbPart, before, after) => {
    const candidates = []
    let from = 0
    while (true) {
      const i = text.indexOf(dbPart, from)
      if (i < 0) break
      const ctxBefore = norm(text.slice(Math.max(0, i - 40), i))
      const ctxAfter = norm(text.slice(i + dbPart.length, i + dbPart.length + 40))
      let score = 0
      for (let k = 1; k <= Math.min(before.length, ctxBefore.length); k++) {
        if (ctxBefore.slice(-k) === before.slice(-k)) score = k; else break
      }
      let score2 = 0
      for (let k = 1; k <= Math.min(after.length, ctxAfter.length); k++) {
        if (ctxAfter.slice(0, k) === after.slice(0, k)) score2 = k; else break
      }
      candidates.push({ i, score: score + score2 })
      from = i + 1
    }
    if (!candidates.length) return null
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (candidates.length > 1 && candidates[1].score === best.score) return null // 无法区分位置 ⇒ 不猜
    return best.i
  }

  fs.writeFileSync(BACKUP_FILE, JSON.stringify({
    at: new Date().toISOString(), resourceId: RES_ID,
    rowsBefore: dbRows.map(r => ({ id: r.id, page_no: r.page_no, question_no: r.question_no,
      sub_no: r.sub_no, content: r.content, parent_stem: r.parent_stem })),
    plans: confirmed,
  }, null, 2), 'utf8')
  console.log(`[zero-typo] 备份 → ${BACKUP_FILE}`)

  // 同一行可能有多处修正：先在内存里合并，再一次性 UPDATE（乐观锁用改前原值）
  const plans = new Map() // rowId -> { field, beforeText, edits:[{at,len,rep}] }
  const manual = []
  for (const f of confirmed) {
    let placed = false
    for (const r of dbRows.filter(x => f.rowIds.includes(x.id))) {
      const field = f.field === 'parent_stem' ? 'parent_stem' : 'content'
      const src = field === 'parent_stem' ? (r.parent_stem || '') : (r.content || '')
      const at = locate(src, f.dbPart, f.before, f.after)
      if (at == null) continue
      placed = true
      const key = `${r.id}|${field}`
      if (!plans.has(key)) plans.set(key, { rowId: r.id, field, beforeText: src, edits: [] })
      const plan = plans.get(key)
      if (plan.edits.some(e => at < e.at + e.len && e.at < at + f.dbPart.length)) continue // 重叠折叠
      plan.edits.push({ at, len: f.dbPart.length, rep: f.modelPart })
    }
    if (!placed) manual.push(f)
  }

  let applied = 0
  for (const [key, plan] of plans) {
    const edits = [...plan.edits].sort((a, b) => b.at - a.at)
    let next = plan.beforeText
    for (const e of edits) next = next.slice(0, e.at) + e.rep + next.slice(e.at + e.len)
    if (next === plan.beforeText) continue
    const upd = await pool.query(
      `UPDATE resource_questions SET ${plan.field} = $2 WHERE id = $1 AND ${plan.field} = $3 RETURNING id`,
      [plan.rowId, next, plan.beforeText]
    )
    if (upd.rowCount) { applied += edits.length; console.log(`  ✓ ${key} 应用 ${edits.length} 处`) }
    else console.warn(`  ⛔ ${key} 乐观锁失败（行已被改动），转人工`)
  }
  console.log(`[zero-typo] 已改库 ${applied} 处；定位失败 ${manual.length} 处（转人工）`)
  for (const m of manual) console.log(`  ⚠ p${m.page} q${m.question_no} 库「${m.dbPart}」→「${m.modelPart}」定位失败`)
}

await pool.end()
