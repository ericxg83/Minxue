/**
 * zeroTypoAuditService.js — 试卷「零错字」自动审计（2026-11-09 松江一模事故沉淀）
 *
 * 负责人死规定：**一模卷零错字，一次都不可以**。
 * 线上双模型闸（paperBankService.crossCheckPageOcr）看的是整页 2382×3368 的图，
 * 供应商会先降采样，字母级细节就丢了 —— 同一份松江卷：
 *   · 线上闸（整页图）查出 15 处，且终裁 Gemini 502 时连这 15 处都作废；
 *   · 本审计（单题 4x 裁片 + 三厂商盲抄）查出 37 处（含 3 处表格数字、2 处中文错字）。
 *
 * ⛔ 为什么必须自动跑：手动跑 = 依赖人记得 = 一定会漏。审计随解析自动入队，
 *    不通过就一直在卷子头上挂着「待核对」。
 *
 * 判据（与 scripts/ops/zero_typo_audit.mjs 完全同一套，⛔ 不许两套口径）：
 *   1. **词元级比对**：数字（36/60/1.5）、字母串（ADC/BAC）、数学符号各算一个词元。
 *      逐字符 LCS 会把「36→60」拆成「删 3 / 留 6 / 插 0」而漏掉。
 *   2. **裁片而非整页**：用 resource_questions.bbox 从 4x 高清页切单题，
 *      bbox 只覆盖正文行 ⇒ parent_stem 另按「上一组底 → 首个小问顶」切一条带子。
 *   3. **三厂商盲抄**：Gemini / Qwen-flash / Qwen-max，互不可见，两轮问法。
 *   4. **两票以上才改**：≥2 个通道抄出同一个替换、无人支持库里原值、且通道间无分歧，
 *      才允许自动改字；其余一律列「待核对」给老师对照原卷。
 *   5. **闭环复核**：改完换一套问法再跑一遍，残余的多通道差异才算没清零。
 *
 * 成本：每卷约「抄录目标数 × 3 通道 × 2 轮」次视觉调用（松江 6 页 33 题 ≈ 234 次）。
 * 开关：ZERO_TYPO_AUDIT=0 关闭自动审计；ZERO_TYPO_AUDIT_GAP_MS 调整目标间隔（默认 200ms）。
 */
import fs from 'fs'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { query } from '../config/neon.js'
import { callVisionCompletion } from '../config/ai.js'

const TMP_DIR = fileURLToPath(new URL('../../.audit_tmp/', import.meta.url))

// 三通道 = 三个**不同厂商**的强视觉模型（同厂两档只能交叉确认，不能算两个独立证人）
const CHANNELS = [
  { key: 'gemini-3.5', chain: [{ vendor: 'HuihuiyunGemini', model: 'gemini-3.5-flash' }] },
  { key: 'qwen3.8', chain: [{ vendor: 'Bailian', model: 'qwen3.8-flash', extraBody: { enable_thinking: false } }] },
  { key: 'qwen3.8-max', chain: [{ vendor: 'Bailian', model: 'qwen3.8-max', extraBody: { enable_thinking: false } }] },
]

// 两套问法：第二套只用于闭环复核，避免「同一个提示词自证清白」
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

const PROMPT_VERSION = 'v3'
const CROP_PAD = 12
const TARGET_GAP_MS = Math.max(0, Number(process.env.ZERO_TYPO_AUDIT_GAP_MS ?? 200) || 0)
const AUTO_ENABLED = String(process.env.ZERO_TYPO_AUDIT ?? '1') !== '0'
const MAX_ATTEMPTS = 2
const MIN_OK_RATIO = 0.6 // 通道成功率低于此值 ⇒ 本轮不可信，退避重跑一次

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 是否允许自动审计（路由/启动恢复共用同一个判据）。 */
export function zeroTypoAuditEnabled() {
  return AUTO_ENABLED
}

// ── 队列：进程内串行，避免 N 份卷子同时打供应商配额 ──────────────────────
const pending = new Map() // resourceId -> job
const activeIds = new Set()
let tail = Promise.resolve()

/**
 * 把一份卷子排进零错字审计队列。
 * @param {object} o
 * @param {string} o.resourceId
 * @param {number[]|null} [o.pages] 只审计这些页（追加批次只审新页）；null = 整卷
 * @param {string} [o.reason] auto / manual / resume
 */
export function queueZeroTypoAudit({ resourceId, pages = null, reason = 'auto', logger = console, attempts = 0 } = {}) {
  if (!resourceId) return { queued: false, reason: 'missing-resource' }
  if (!AUTO_ENABLED) return { queued: false, reason: 'disabled' }
  if (activeIds.has(resourceId)) return { queued: false, reason: 'running' }

  const exist = pending.get(resourceId)
  if (exist) {
    // 同一份卷子连排两次：整卷优先，页列表取并集（⛔ 不能后到覆盖先到，否则会漏页）
    if (pages == null) exist.pages = null
    else if (exist.pages) exist.pages = [...new Set([...exist.pages, ...pages])].sort((a, b) => a - b)
    return { queued: true, deduped: true }
  }

  const job = { resourceId, pages, reason, logger, attempts }
  pending.set(resourceId, job)
  writeAuditMeta(resourceId, { status: 'queued', reason, pages }).catch(() => {})
  tail = tail.then(() => drain(job)).catch(() => {})
  return { queued: true }
}

async function drain(job) {
  const cur = pending.get(job.resourceId)
  if (!cur) return
  pending.delete(job.resourceId)
  if (activeIds.has(job.resourceId)) return
  activeIds.add(job.resourceId)
  try {
    await runZeroTypoAudit(cur)
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300)
    job.logger?.error?.(`[zeroTypo] ${job.resourceId} 审计失败: ${msg}`)
    await writeAuditMeta(job.resourceId, {
      status: 'failed', error: msg, phase: null, finishedAt: new Date().toISOString(),
    }).catch(() => {})
    // 通道抖动（不是内容问题）⇒ 退避重跑一次；内容层面的失败不重跑，避免白烧钱
    if (e?.unstable && cur.attempts + 1 < MAX_ATTEMPTS) {
      const next = { ...cur, attempts: cur.attempts + 1, reason: 'retry' }
      job.logger?.warn?.(`[zeroTypo] 通道不稳定，90s 后重跑一次（${next.attempts + 1}/${MAX_ATTEMPTS}）`)
      setTimeout(() => {
        pending.set(next.resourceId, next)
        tail = tail.then(() => drain(next)).catch(() => {})
      }, 90_000).unref?.()
    }
  } finally {
    activeIds.delete(job.resourceId)
  }
}

/** 进程重启后把「排队中 / 跑一半」的审计接回来（否则卷子会永远停在 running）。 */
export async function resumeInterruptedAudits({ logger = console } = {}) {
  if (!AUTO_ENABLED) return { resumed: 0 }
  try {
    const { rows } = await query(
      `SELECT id,
              metadata->'zeroTypoAudit'->>'status' AS status,
              metadata->'zeroTypoAudit'->>'at' AS at
         FROM resources
        WHERE resource_type = 'exam'
          AND metadata->'zeroTypoAudit'->>'status' IN ('queued','running')
          -- 只接回「12 小时内、且已经 3 分钟没动静」的：避免把另一个进程
          -- （比如运维正在跑的 CLI）正在进行的审计再排一遍，白烧一份钱。
          AND COALESCE(metadata->'zeroTypoAudit'->>'at', '') > $1
          AND COALESCE(metadata->'zeroTypoAudit'->>'at', '') < $2
        ORDER BY COALESCE(metadata->'zeroTypoAudit'->>'at', '') ASC
        LIMIT 20`,
      [
        new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      ]
    )
    for (const r of rows) queueZeroTypoAudit({ resourceId: r.id, reason: 'resume', logger })
    if (rows.length) logger.log?.(`[zeroTypo] 启动恢复：${rows.length} 份卷子的审计重新入队`)
    // 超过 12 小时还停在 queued/running 的，不再假装还在跑：标 failed，
    // 否则界面会永远显示「校验中」，老师等一个永远不会有的结果。
    const stale = await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata,'{}'::jsonb)
               || jsonb_build_object('zeroTypoAudit',
                    COALESCE(metadata->'zeroTypoAudit','{}'::jsonb)
                    || jsonb_build_object('status','failed','phase',NULL,
                         'error','进程重启前未完成，且已超过 12 小时未更新，需重新触发',
                         'finishedAt', to_jsonb($2::text)))
        WHERE resource_type = 'exam'
          AND metadata->'zeroTypoAudit'->>'status' IN ('queued','running')
          AND COALESCE(metadata->'zeroTypoAudit'->>'at', '') < $1
        RETURNING id`,
      [new Date(Date.now() - 12 * 3600 * 1000).toISOString(), new Date().toISOString()]
    )
    if (stale.rowCount) logger.warn?.(`[zeroTypo] ${stale.rowCount} 份卷子的审计标记为失败（超 12 小时无进展）`)
    return { resumed: rows.length, stale: stale.rowCount || 0 }
  } catch (e) {
    logger.warn?.(`[zeroTypo] 启动恢复失败（不影响服务）: ${e.message}`)
    return { resumed: 0, error: e.message }
  }
}

// ── 文本归一化 / 词元比对 ────────────────────────────────────────────────

const SUPER = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ' }

export function normalizeMath(src) {
  let t = String(src ?? '').replace(/\r/g, '').replace(/\$+/g, '').replace(/\\[()[\]]/g, '')
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
  // Unicode 上下标 → ASCII（松江 q3 实测：库里 y₁、模型抄 y1，不统一会让词元对齐整体错位）
  const SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, c => SUP_MAP[c] || c)
  t = t.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x2050)) // U+2080 → '0'(0x30)
  return t.replace(/\s+/g, '')
}

/** 词元：数字（含小数）| 字母串 | 数学符号 | 单个其他字符 */
const TOKEN_RE = /[0-9]+(?:\.[0-9]+)?|[A-Za-z]+|[∠△√°±≤≥≠∽∥⊥·×÷∵∴]|[\s\S]/gu
const tokenize = (s) => (s.match(TOKEN_RE) || [])
const SENSITIVE = /[A-Za-z0-9∠△√°±≤≥≠∽∥⊥·×÷\u4e00-\u9fff]/

function trimSensitive(s) {
  const chars = [...String(s || '')]
  let a = 0
  let b = chars.length
  while (a < b && !SENSITIVE.test(chars[a])) a++
  while (b > a && !SENSITIVE.test(chars[b - 1])) b--
  return chars.slice(a, b).join('')
}

/** 词元级 LCS diff */
export function diffTokens(dbText, modelText) {
  const a = tokenize(dbText)
  const b = tokenize(modelText)
  const n = a.length
  const m = b.length
  if (!n || !m) return []
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  let cur = null
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
    if (a[i] === b[j]) { flush(); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) {
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

/** 数字多重集差：返回 db 里有、抄本里没读到的数字（表格数值错位最常表现为这个） */
function numberGap(dbNorm, modelNorm) {
  const parse = (s) => (String(s).match(/[0-9]+(?:\.[0-9]+)?/g) || [])
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())
  const db = parse(dbNorm)
  const md = parse(modelNorm)
  const dbMap = count(db)
  const modelMap = count(md)
  const missing = []
  for (const [n, c] of dbMap) {
    const got = modelMap.get(n) || 0
    for (let k = got; k < c; k++) missing.push(n)
  }
  const extra = []
  for (const [n, c] of modelMap) {
    const had = dbMap.get(n) || 0
    for (let k = had; k < c; k++) extra.push(n)
  }
  return { missing, extra }
}

// ── 裁片 / 调用 ─────────────────────────────────────────────────────────

async function loadQuestionRows(resourceId) {
  const { rows } = await query(
    `SELECT id, page_no, question_no, sub_no, content, parent_stem, options, bbox, page_image_url
       FROM resource_questions
      WHERE resource_id = $1
      ORDER BY page_no, question_no, sub_no`,
    [resourceId]
  )
  return rows
}

/** 抄录目标 = 每一行正文 + 每个小题组的题干带（parent_stem 不在任何一行的 bbox 里）。 */
export function buildTargets(dbRows, pages = null) {
  const allowed = Array.isArray(pages) && pages.length ? new Set(pages.map(Number)) : null
  const targets = []
  const byPage = new Map()
  for (const r of dbRows) {
    if (!byPage.has(r.page_no)) byPage.set(r.page_no, [])
    byPage.get(r.page_no).push(r)
  }
  for (const [pageNo, list] of byPage) {
    if (allowed && !allowed.has(Number(pageNo))) continue
    for (const r of list) {
      if (!r.bbox || !r.page_image_url) continue
      targets.push({
        kind: 'row', page: pageNo, rowIds: [r.id], question_no: r.question_no, sub_no: r.sub_no,
        label: `${r.question_no}${r.sub_no ? `(${r.sub_no})` : ''}`,
        expect: r.content || '', field: 'content', bbox: r.bbox, page_image_url: r.page_image_url,
      })
    }
    const groups = new Map()
    for (const r of list) {
      if (!r.parent_stem || !r.page_image_url) continue
      if (!groups.has(r.question_no)) groups.set(r.question_no, [])
      groups.get(r.question_no).push(r)
    }
    const questionNos = [...new Set(list.map(r => r.question_no))].sort((a, b) => a - b)
    for (const [qno, group] of groups) {
      const firstY = Math.min(...group.map(r => r.bbox?.y ?? 1000))
      const prevQ = questionNos.filter(n => n < qno).pop()
      let prevBottom = 0
      if (prevQ != null) {
        const prevRows = list.filter(r => r.question_no === prevQ && r.bbox)
        if (prevRows.length) prevBottom = Math.max(...prevRows.map(r => r.bbox.y + r.bbox.height))
      }
      const top = Math.max(prevBottom + 1, firstY - 75)
      targets.push({
        kind: 'stem', page: pageNo, rowIds: group.map(r => r.id), question_no: qno, sub_no: '',
        label: `${qno}(题干)`, expect: group[0].parent_stem, field: 'parent_stem',
        bbox: { x: 55, y: top, width: 900, height: Math.max(20, firstY + 6 - top) },
        page_image_url: group[0].page_image_url,
      })
    }
  }
  targets.sort((a, b) => a.page - b.page || a.question_no - b.question_no || (a.kind === 'stem' ? -1 : 1))
  return targets
}

async function pageImage(pageBuf, pageNo, url) {
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
  let left = px(bbox.x, page.width) - CROP_PAD
  let top = px(bbox.y, page.height) - CROP_PAD
  let width = px(bbox.width, page.width) + CROP_PAD * 2
  let height = px(bbox.height, page.height) + CROP_PAD * 2
  left = Math.max(0, left)
  top = Math.max(0, top)
  width = Math.min(page.width - left, Math.max(60, width))
  height = Math.min(page.height - top, Math.max(40, height))
  const out = await sharp(page.buf).extract({ left, top, width, height }).jpeg({ quality: 95 }).toBuffer()
  return 'data:image/jpeg;base64,' + out.toString('base64')
}

function parseJsonLoose(text) {
  const s = String(text || '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)) } catch { /* 继续尝试整串 */ }
  }
  try { return JSON.parse(s) } catch { return null }
}

async function callChannel(channel, imageDataURL, systemPrompt, userText) {
  const out = await callVisionCompletion({
    imageDataURL, systemPrompt, userText, temperature: 0.02, maxTokens: 1800,
    vendorChain: channel.chain, noBackup: true, timeout: 120000,
  })
  return String(out.content || '')
}

/** 单目标 × 三通道；单通道失败重试一次（少一个证人就凑不够两票）。 */
async function transcribeTarget({ target, phase, pageBuf, cache, noCache, saveCache, logger }) {
  let page
  try {
    page = await pageImage(pageBuf, target.page, target.page_image_url)
  } catch (e) {
    // 单页图挂掉不能把整卷审计作废：这一页记 0 个通道成功，
    // 通道成功率闸会兜底（成功率过低 ⇒ 判不稳定、退避重跑），不会拿空结果去改库。
    logger.warn?.(`[zeroTypo] 第 ${target.page} 页整页图拉取失败: ${String(e?.message || e).slice(0, 120)}`)
    return CHANNELS.map(c => ({ channel: c.key, text: null }))
  }
  const dataUrl = await cropDataUrl(page, target.bbox)
  if (!dataUrl) return []
  const verify = phase === 't2'
  const system = verify ? PROMPT_B : PROMPT_A
  const ask = verify
    ? `逐字转写这道题（第 ${target.label} 题）。只输出 JSON。`
    : `抄录第 ${target.label} 题的印刷文字。只输出 JSON。`

  return Promise.all(CHANNELS.map(async (channel) => {
    const vendor = channel.chain[0].vendor
    const key = `${PROMPT_VERSION}|${target.kind}:${target.page}:${target.label}|${channel.key}|${phase}`
    if (!noCache && cache[key] != null) return { channel: channel.key, vendor, text: cache[key] }
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const raw = await callChannel(channel, dataUrl, system, ask)
        const obj = parseJsonLoose(raw)
        const text = obj?.text != null ? String(obj.text) : String(raw).trim()
        cache[key] = text
        saveCache()
        return { channel: channel.key, vendor, text }
      } catch (e) {
        if (attempt === 0) { await sleep(1200); continue }
        logger.warn?.(`[zeroTypo] ✗ p${target.page}/${target.label} ${channel.key}: ${String(e?.message || e).slice(0, 120)}`)
        return { channel: channel.key, vendor, text: null }
      }
    }
    return { channel: channel.key, vendor, text: null }
  }))
}

// ── 单轮：盲抄 + 聚合 ───────────────────────────────────────────────────

async function runPhase({ targets, phase, pageBuf, cache, noCache, saveCache, logger }) {
  const stats = { targets: targets.length, channelCalls: targets.length * CHANNELS.length, ok: 0, failed: 0 }
  const items = []
  const numericFlags = []
  const verify = phase === 't2'

  for (const t of targets) {
    const results = await transcribeTarget({ target: t, phase, pageBuf, cache, noCache, saveCache, logger })
    const ok = results.filter(r => r.text)
    stats.ok += ok.length
    stats.failed += results.length - ok.length
    if (TARGET_GAP_MS) await sleep(TARGET_GAP_MS)

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
        if (!hasBoth && !isMissing) continue // 纯新增（裁片含邻题/模型多写）不算错
        if (!dbPart) continue
        if (isMissing && dbPart.length > 12) continue // 大段缺失通常是裁片边界
        perChannel.push({ channel: r.channel, vendor: r.vendor, ...h, dbPart, modelPart, isMissing })
      }
    }

    const clusters = []
    for (const h of perChannel) {
      const sig = `${h.before}|${h.dbPart}|${h.isMissing ? 'M' : 'S'}`
      let c = clusters.find(x => x.sig === sig)
      if (!c) {
        c = {
          sig, dbPart: h.dbPart, modelPart: h.modelPart, before: h.before, after: h.after,
          isMissing: h.isMissing, votes: new Set(), vendorVotes: new Set(),
        }
        clusters.push(c)
      }
      // 同一处不同通道给出不同替换 ⇒ 记下来交人工，绝不自动改
      if (c.modelPart !== h.modelPart) c.conflictParts = [...(c.conflictParts || []), h.modelPart]
      c.votes.add(h.channel)
      if (h.vendor) c.vendorVotes.add(h.vendor)
    }
    for (const c of clusters) {
      items.push({
        page: t.page, question_no: t.question_no, sub_no: t.sub_no, kind: t.kind,
        rowIds: t.rowIds, field: t.field,
        dbPart: c.dbPart, modelPart: c.modelPart, before: c.before, after: c.after,
        isMissing: c.isMissing, conflictParts: c.conflictParts || [],
        votes: [...c.votes], vendorVotes: [...c.vendorVotes], totalChannels: ok.length, expect: t.expect,
      })
    }

    // 数字清单比对（格式无关）：表格/多行数值最容易被词元对齐吃掉。
    // 只报「库里有、抄本里没读到」的数字（多出来的通常是裁片带进了邻题，不作数）。
    if (verify) {
      for (const r of ok) {
        const { missing, extra } = numberGap(dbNorm, normalizeMath(r.text))
        if (!missing.length) continue
        numericFlags.push({
          page: t.page, question_no: t.question_no, sub_no: t.sub_no, kind: t.kind,
          channel: r.channel, missing, extra, expect: t.expect,
        })
      }
    }
  }
  saveCache(true)
  return { items, numericFlags, stats }
}

// ── 应用修正（只改两票以上、无分歧、且能唯一定位的那几处）────────────────

const locate = (text, dbPart, before, after) => {
  const norm = (s) => normalizeMath(s)
  const candidates = []
  let from = 0
  while (true) {
    const i = text.indexOf(dbPart, from)
    if (i < 0) break
    const ctxBefore = norm(text.slice(Math.max(0, i - 40), i))
    const ctxAfter = norm(text.slice(i + dbPart.length, i + dbPart.length + 40))
    let score = 0
    for (let k = 1; k <= Math.min(before.length, ctxBefore.length); k++) {
      if (ctxBefore.slice(-k) === before.slice(-k)) score = k
      else break
    }
    let score2 = 0
    for (let k = 1; k <= Math.min(after.length, ctxAfter.length); k++) {
      if (ctxAfter.slice(0, k) === after.slice(0, k)) score2 = k
      else break
    }
    candidates.push({ i, score: score + score2 })
    from = i + 1
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (candidates.length > 1 && candidates[1].score === best.score) return null // 位置无法区分 ⇒ 不猜
  return best.i
}

async function applyConfirmedFixes({ resourceId, dbRows, confirmed, logger }) {
  const tag = String(resourceId).slice(0, 8)
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  let backupFile = null
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true })
    backupFile = `${TMP_DIR}zero_typo_backup_${tag}_${stamp}.json`
    fs.writeFileSync(backupFile, JSON.stringify({
      at: new Date().toISOString(), resourceId,
      rowsBefore: dbRows.map(r => ({
        id: r.id, page_no: r.page_no, question_no: r.question_no,
        sub_no: r.sub_no, content: r.content, parent_stem: r.parent_stem,
      })),
      plans: confirmed,
    }, null, 2), 'utf8')
  } catch (e) {
    logger.warn?.(`[zeroTypo] 备份写入失败（继续，但无回滚凭据）: ${e.message}`)
  }

  const plans = new Map() // `${rowId}|${field}` -> { rowId, field, beforeText, edits:[{at,len,rep}] }
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
  for (const plan of plans.values()) {
    const edits = [...plan.edits].sort((a, b) => b.at - a.at)
    let next = plan.beforeText
    for (const e of edits) next = next.slice(0, e.at) + e.rep + next.slice(e.at + e.len)
    if (next === plan.beforeText) continue
    // 乐观锁：老师此刻正在改题就放弃，绝不覆盖人工编辑
    const upd = await query(
      `UPDATE resource_questions SET ${plan.field} = $2 WHERE id = $1 AND ${plan.field} = $3 RETURNING id`,
      [plan.rowId, next, plan.beforeText]
    )
    if (upd.rowCount) applied += edits.length
    else logger.warn?.(`[zeroTypo] 行 ${String(plan.rowId).slice(0, 8)} 已被改动，跳过（转人工）`)
  }
  return { applied, manual, backupFile }
}

// ── 元数据落库：状态 + 待核对清单 ───────────────────────────────────────

async function writeAuditMeta(resourceId, patch) {
  await query(
    `UPDATE resources
        SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('zeroTypoAudit',
                  COALESCE(metadata->'zeroTypoAudit', '{}'::jsonb) || $2::jsonb)
      WHERE id = $1`,
    [resourceId, JSON.stringify({ ...patch, at: new Date().toISOString() })]
  )
}

const reviewKey = (it) => `${it.page_no}|${it.question_no}|${it.sub_no || ''}|${it.field || 'content'}|${it.check_text || it.ocr_text}`

function anchorAlive(item, row) {
  if (!row) return false
  const field = item.field || 'content'
  const anchor = String(item.check_text || item.ocr_text || '')
  if (!anchor) return false
  const cur = field === 'options' ? (row.options || []) : (row[field] ?? '')
  if (Array.isArray(cur)) return cur.some(x => String(x).includes(anchor))
  return String(cur).includes(anchor)
}

/**
 * 待核对清单只留「锚点还在库里」的条目：
 * 审计已改掉的那几处，页面级闸留下的旧条目必须一起消失（否则会永远挂着早已修好的告警）。
 * 同时把审计自己仍存疑的条目并进来（同一处只留一条，按 page|题号|小问|字段|库里文本 去重）。
 */
async function reconcileReviewList({ resourceId, auditItems, logger }) {
  const { rows } = await query(`SELECT metadata FROM resources WHERE id=$1`, [resourceId])
  const meta = rows[0]?.metadata && typeof rows[0].metadata === 'object' ? rows[0].metadata : {}
  const prev = Array.isArray(meta.ocrReview) ? meta.ocrReview : []
  const dbRows = await loadQuestionRows(resourceId)
  const index = new Map(dbRows.map(r => [`${r.page_no}|${r.question_no}|${r.sub_no || ''}`, r]))

  const kept = prev.filter(it => anchorAlive(it, index.get(`${it.page_no}|${it.question_no}|${it.sub_no || ''}`)))
  const seen = new Set(kept.map(reviewKey))
  const added = []
  for (const it of auditItems) {
    const key = reviewKey(it)
    if (seen.has(key)) continue
    const row = index.get(`${it.page_no}|${it.question_no}|${it.sub_no || ''}`)
    if (!anchorAlive(it, row)) continue
    seen.add(key)
    added.push(it)
  }
  const list = [...kept, ...added]

  const prevSummary = meta.ocrReviewSummary && typeof meta.ocrReviewSummary === 'object' ? meta.ocrReviewSummary : {}
  try {
    await query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('ocrReview', $2::jsonb, 'ocrReviewSummary', $3::jsonb)
        WHERE id = $1`,
      [
        resourceId,
        JSON.stringify(list.slice(-300)),
        JSON.stringify({ ...prevSummary, reviewCount: list.length }),
      ]
    )
  } catch (e) {
    logger.warn?.(`[zeroTypo] 待核对清单回写失败: ${e.message}`)
  }
  return list.length
}

/** 把审计条目转成页面级闸同款结构，前端复用同一个弹窗（⛔ 不做第二个待核对界面）。 */
function toReviewItem(it, total) {
  if (it.numeric) {
    return {
      page_no: it.page, question_no: it.question_no, sub_no: it.sub_no,
      field: 'content',
      // 展示用全量缺口；定位用第一个数（reconcile 的锚点必须真的在库文本里）
      ocr_text: it.missing.join('、'),
      check_text: it.missing[0],
      suggested_text: it.extra.length ? it.extra.join('、') : '（抄本没读到这些数字）',
      arbiter_text: null, source: 'zero-typo',
      reason: `${it.channels.length} 个模型没在卷面上读到这些数字，表格/多行数值需对照原卷`,
    }
  }
  const cross = (it.vendorVotes || []).length >= 2
  const who = it.votes.length >= 2 ? `${it.votes.length}/${total} 个模型` : `仅 ${it.votes[0] || '?'} 一个模型`
  const why = it.isMissing
    ? `${who}在卷面上没读到「${it.dbPart}」，需对照原卷`
    : cross
      ? `${who}一致读作「${it.modelPart}」，但闭环复核仍存在，需对照原卷`
      : `${who}一致读作「${it.modelPart}」，但没有第二家厂商确认，未自动改`
  return {
    page_no: it.page, question_no: it.question_no, sub_no: it.sub_no,
    field: it.field, ocr_text: it.dbPart,
    suggested_text: it.isMissing ? '（卷面上没有这几个字符）' : it.modelPart,
    arbiter_text: null, source: 'zero-typo',
    reason: why,
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────

function cachePath(resourceId, phase) {
  return `${TMP_DIR}zero_typo_cache_${String(resourceId).slice(0, 8)}_${PROMPT_VERSION}_${phase}.json`
}

function loadCache(resourceId, phase, noCache) {
  if (noCache) return {}
  try { return JSON.parse(fs.readFileSync(cachePath(resourceId, phase), 'utf8')) } catch { return {} }
}

function makeSaver(resourceId, phase, cache, noCache) {
  if (noCache) return () => {}
  try { fs.mkdirSync(TMP_DIR, { recursive: true }) } catch { return () => {} }
  let n = 0
  // 每 10 次落一次盘：目标是 100+ 次调用，逐次写文件会把磁盘 IO 变成瓶颈
  return (force = false) => {
    n += 1
    if (!force && n % 10 !== 0) return
    try { fs.writeFileSync(cachePath(resourceId, phase), JSON.stringify(cache, null, 1), 'utf8') } catch { /* 缓存写失败不影响结果 */ }
  }
}

/**
 * 对一份卷子跑零错字审计（可被路由/CLI 直接调用）。
 * @returns {Promise<object>} 审计摘要
 */
async function runZeroTypoAuditInner({
  resourceId, pages = null, apply = true, verify = true, noCache = true,
  logger = console, reason = 'auto',
} = {}) {
  if (!resourceId) throw new Error('缺少 resourceId')
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  const { rows: resRows } = await query(`SELECT name, metadata FROM resources WHERE id=$1`, [resourceId])
  if (!resRows.length) throw new Error('试卷资源不存在')
  const resourceName = resRows[0].name
  const prevMeta = resRows[0].metadata && typeof resRows[0].metadata === 'object' ? resRows[0].metadata : {}
  const prevAudit = prevMeta.zeroTypoAudit && typeof prevMeta.zeroTypoAudit === 'object' ? prevMeta.zeroTypoAudit : {}

  await writeAuditMeta(resourceId, {
    status: 'running', phase: 't1', reason, startedAt, error: null,
    promptVersion: PROMPT_VERSION, pages: pages || null,
  })

  let dbRows = await loadQuestionRows(resourceId)
  if (!dbRows.length) {
    await writeAuditMeta(resourceId, {
      status: 'passed', phase: null, finishedAt: new Date().toISOString(),
      targets: 0, fixed: 0, residualCount: 0, reviewCount: 0, elapsedMs: Date.now() - t0,
    })
    return { status: 'passed', targets: 0, fixed: 0, residualCount: 0 }
  }

  const pageBuf = new Map()
  const logger2 = logger

  // ① 第一轮盲抄
  let targets = buildTargets(dbRows, pages)
  const cache1 = loadCache(resourceId, 't1', noCache)
  const t1 = await runPhase({
    targets, phase: 't1', pageBuf, cache: cache1, noCache,
    saveCache: makeSaver(resourceId, 't1', cache1, noCache), logger: logger2,
  })

  // 自动改库的准入：两票一致 + **跨厂商** + 总通道≥2 + 通道间无分歧。
  // ⛔ 同厂两档（qwen-flash / qwen-max）同时读错是有相关性的，不能当成两个独立证人；
  //    它们的一致只足以「提醒人看」，不足以自动改卷面。
  const isMultiVote = (f) => !f.isMissing && f.votes.length >= 2 && f.totalChannels >= 2 && !f.conflictParts?.length
  const isCrossVendor = (f) => isMultiVote(f) && f.vendorVotes.length >= 2

  const multi = t1.items.filter(isCrossVendor)
  const confirmed = apply ? multi : []
  const suspect1 = t1.items.filter(f => !confirmed.includes(f) && !f.isMissing && f.votes.length >= 1)

  let fixed = 0
  let manual = []
  let backupFile = null
  if (confirmed.length) {
    const res = await applyConfirmedFixes({ resourceId, dbRows, confirmed, logger: logger2 })
    fixed = res.applied
    manual = res.manual
    backupFile = res.backupFile
    logger2.log?.(`[zeroTypo] ${resourceName}: 三模型共识 ${confirmed.length} 处，已改库 ${fixed} 处`)
    if (fixed || manual.length) {
      // 改完必须重新读库：第二轮比对的是**改后**文本，否则会把已修处再报一遍
      dbRows = await loadQuestionRows(resourceId)
    }
  }

  // ② 闭环复核（换一套问法）
  let t2 = null
  let residual = []
  let numericReview = []
  if (verify) {
    await writeAuditMeta(resourceId, { status: 'running', phase: 't2' }).catch(() => {})
    targets = buildTargets(dbRows, pages)
    const cache2 = loadCache(resourceId, 't2', noCache)
    t2 = await runPhase({
      targets, phase: 't2', pageBuf, cache: cache2, noCache,
      saveCache: makeSaver(resourceId, 't2', cache2, noCache), logger: logger2,
    })
    // 闭环残余：只要是「两票一致 / 无分歧」就算没清零，不管是不是同厂商 ——
    // 同厂商两票说明这两档都这么读，虽然没有第二家确认也绝不能当「已校」放过。
    residual = t2.items.filter(isMultiVote)

    // 数字缺口：≥2 个通道都说「库里某个数在卷面上没有」才进待核对（单通道多半是裁片边界）
    const byTarget = new Map()
    for (const f of t2.numericFlags || []) {
      const key = `${f.page}|${f.question_no}|${f.sub_no || ''}|${[...f.missing].sort().join(',')}`
      if (!byTarget.has(key)) byTarget.set(key, { ...f, channels: new Set() })
      byTarget.get(key).channels.add(f.channel)
    }
    numericReview = [...byTarget.values()].filter(x => x.channels.size >= 2)
      .map(x => ({ ...x, channels: [...x.channels] }))
  }

  // ③ 通道稳定性：成功率太低说明是配额/网络问题，结论不可信
  const allStats = [t1.stats, t2?.stats].filter(Boolean)
  const calls = allStats.reduce((n, s) => n + s.channelCalls, 0)
  const okCount = allStats.reduce((n, s) => n + s.ok, 0)
  if (calls && okCount / calls < MIN_OK_RATIO) {
    const err = new Error(`视觉通道成功率过低（${okCount}/${calls}），本轮结论不可信`)
    err.unstable = true
    throw err
  }

  // ④ 待核对清单：清掉已修好的旧条目 + 并入审计仍存疑的条目
  const reviewItems = [
    ...residual.map(it => toReviewItem(it, it.totalChannels)),
    ...numericReview.map(it => toReviewItem({ ...it, numeric: true }, 0)),
    ...manual.map(it => toReviewItem(it, it.totalChannels)),
    ...(verify ? [] : suspect1.map(it => toReviewItem(it, it.totalChannels))),
  ]
  const reviewCount = await reconcileReviewList({ resourceId, auditItems: reviewItems, logger: logger2 })

  // 定位失败（两票一致但库里找不到唯一位置）也算没清零：必须进待核对，不能报「已校」。
  // 页面级闸留下的老条目若仍对不上（reviewCount>0），同样不算通过。
  //
  // ⚠ 「整卷已校」必须真的覆盖了卷内**所有页**：追加批次只审新页，
  //   若这份卷前面几页从没审过（老卷），只凭本批通过就报 passed 是假绿。
  const allPages = new Set(dbRows.map(r => r.page_no))
  // 老记录（自动审计上线前手工跑的那批）没有 auditedPages，但它的 status=passed
  // 就代表整卷已过；不认这个默认会把「已校」错误降级成「抽查」。
  const prevAuditedPages = prevAudit.status === 'passed' && prevAudit.fullCoverage !== false
    ? new Set(allPages)
    : new Set(Array.isArray(prevAudit.auditedPages) ? prevAudit.auditedPages.map(Number) : [])
  const auditedPages = pages == null
    ? new Set(allPages)
    : new Set([...prevAuditedPages, ...pages.map(Number)])
  const fullCoverage = [...allPages].every(p => auditedPages.has(Number(p)))

  const clean = !residual.length && !numericReview.length && !manual.length && reviewCount === 0
  const status = !verify ? 'checked' : (!clean ? 'needs_review' : (fullCoverage ? 'passed' : 'checked'))

  const summary = {
    status, phase: null, reason,
    finishedAt: new Date().toISOString(),
    targets: t1.stats.targets,
    channelCalls: calls,
    channelOk: okCount,
    fixed,
    appliedCandidates: confirmed.length,
    manualCount: manual.length,
    residualCount: residual.length,
    numericCount: numericReview.length,
    reviewCount,
    rounds: verify ? 2 : 1,
    pages: pages || null,
    auditedPages: [...auditedPages].sort((a, b) => a - b),
    fullCoverage,
    elapsedMs: Date.now() - t0,
    backupFile,
    promptVersion: PROMPT_VERSION,
    error: null,
  }
  await writeAuditMeta(resourceId, summary)

  logger2.log?.(
    `[zeroTypo] ${resourceName}: ${status}（目标 ${summary.targets}，通道 ${okCount}/${calls}，` +
    `修正 ${fixed}，残余 ${residual.length}，待核对 ${reviewCount}，${Math.round(summary.elapsedMs / 1000)}s）`
  )
  return summary
}

/**
 * 对一份卷子跑零错字审计（路由/CLI 共用入口）。
 * 失败也必须把 status 写成 failed —— 否则界面会永远停在「校验中」，而且没人知道为什么。
 */
export async function runZeroTypoAudit(options = {}) {
  try {
    return await runZeroTypoAuditInner(options)
  } catch (e) {
    if (options.resourceId) {
      await writeAuditMeta(options.resourceId, {
        status: 'failed', phase: null, finishedAt: new Date().toISOString(),
        error: String(e?.message || e).slice(0, 300), reason: options.reason || 'auto',
      }).catch(() => {})
    }
    throw e
  }
}
