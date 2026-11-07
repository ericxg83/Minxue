/**
 * clipSourceDetect.js — 从截图里自动读出「网址 + 时间卡点」填来源（2026-11-07 三轮）
 *
 * 负责人需求：「我截图的时候，故意把网址和时间卡点都截图到，他自己帮我填写好？」
 * 即老师不再手填来源：截图里带上浏览器地址栏（URL）和播放器进度条（12:35 / 45:20），
 * 系统读完直接写进 clipSources / clipNotes 两个 map。
 *
 * ── 三条硬纪律 ──
 * 1. **手填优先**：老师填过的不覆盖，识别结果只填空缺（mergeClipSources 是唯一实现）。
 * 2. **只在有空缺时才调视觉**：两张都手填了就一次模型都不烧。默认开启，
 *    PAPER_CLIP_AUTO_SOURCE=0 可整条关掉。
 * 3. **fail closed**：题目里大量出现 `BD:CD = 1:2`、`AE = 2/3 AD` 这类比例，
 *    纯正则扫全文必把它们当时间。所以由视觉模型按**位置**（地址栏 / 进度条）判断，
 *    服务端再做格式闸：秒必须两位、URL 必须完整 http(s) + 合法域名。
 *    读不清 / 不确定 / 格式不对 ⇒ 宁可不填，不给错链接。
 *
 * ⛔ 不复用 parsePageToQuestions 的 OCR：那个 prompt 明确只抄题目，
 *    把「顺便读地址栏」塞进去会同时毁掉两件事（questionBoxMeasure 文件头同型教训：
 *    短调用只做一件事才准）。也不塞进 extractClipFigure 的框选调用，同理。
 */

import sharp from 'sharp'
import { callVisionCompletion, GENERAL_OCR_VENDOR_CHAIN } from '../config/ai.js'

/** 读小字不能压太狠：地址栏字号常 12~14px，缩到 1000px 会糊掉（量版面才用 1000） */
const DETECT_MAX_WIDTH = 1800
/** 默认开启；设 0 可整条关闭（省视觉额度） */
export const CLIP_AUTO_SOURCE_ENABLED = process.env.PAPER_CLIP_AUTO_SOURCE !== '0'

export const CLIP_SOURCE_PROMPT = `你是截图信息提取器。老师为了记住题目出处，截图时**故意**把浏览器地址栏和视频播放器进度条一起截了进来。

请只从这两个位置读取信息：
- 【浏览器地址栏】里的完整网址 → url
- 【视频播放器进度条】上的**当前播放时间** → timestamp（形如 12:35 或 1:02:35）
  ⚠️ 进度条常写成「12:35 / 45:20」，只取斜杠**前面**那个当前时间，不要取总时长。

只输出 JSON，不要解释：
{"url":"","timestamp":"","title":""}

规则：
- url 必须逐字照抄，含 https:// 或 http:// 前缀；看不清、被截断、地址栏没截进来 ⇒ 留空字符串。
- timestamp 只认播放器进度条 / 时间浮层上的时间。**绝对不要**从题目正文里取数字：
  题目里的「BD:CD = 1:2」「AE = 2/3 AD」「12:35 上课」都不是播放时间。
  看不清或没有进度条 ⇒ 留空字符串。
- title 是页面标题 / 视频标题 / 老师名等能说明出处的短文字（可留空）。
- 画面里既没有地址栏也没有进度条 ⇒ 输出 {"url":"","timestamp":"","title":""}。`

/** URL 格式闸：完整 http(s) + 域名带点 + 不含空白/中文（防把水印、题目文字当链接） */
const URL_RE = /^https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[^\s\u4e00-\u9fff]*)?$/i
/** 时间闸：秒必须两位（1:2 这类题目比例进不来），支持 12:35 / 1:02:35 */
const TIME_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}$/

/**
 * 解析 + 校验模型输出（纯函数，便于回归测试）。
 * @returns {{url:string, note:string}|null} 没有任何可信信息时返回 null
 */
export function parseDetectedSource(content) {
  const raw = typeof content === 'string' ? content : String(content ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const whole = (fenced ? fenced[1] : raw).match(/\{[\s\S]*\}/)?.[0] || (fenced ? fenced[1] : raw)
  let obj
  try { obj = JSON.parse(whole.trim()) } catch { return null }
  if (!obj || typeof obj !== 'object') return null

  let url = String(obj.url ?? '').trim()
  if (url && !URL_RE.test(url)) url = ''          // 读错/截断/水印 ⇒ 丢弃，绝不写错链接
  url = url.slice(0, 500)

  let ts = String(obj.timestamp ?? '').trim()
  // ⚠️ 顺序不能反：进度条「12:35 / 45:20」模型常整串抄回来，
  //    必须先取斜杠前的当前时间，再过格式闸；否则整串先被判不合法直接清空。
  if (ts && ts.includes('/')) ts = ts.split('/')[0].trim()
  if (ts && !TIME_RE.test(ts)) ts = ''            // 题目里的 1:2、12分35 等一律不收

  // 地址栏 URL 自带 ?t=755 时，把秒补成可读时间点（模型没给 timestamp 也能用）
  if (!ts && url) {
    const m = url.match(/[?&]t=(\d{1,5})(?:s)?(?:&|$)/i)
    if (m) {
      const sec = Number(m[1])
      const mm = Math.floor(sec / 60)
      const ss = String(sec % 60).padStart(2, '0')
      ts = `${mm}:${ss}`
    }
  }

  const title = String(obj.title ?? '').trim().slice(0, 200)
  const note = [ts, title].filter(Boolean).join(' ').trim().slice(0, 500)
  if (!url && !note) return null
  return { url, note }
}

/**
 * 从一张截图里读出来源。失败一律返回 null（不阻塞收题，也不写脏数据）。
 * @returns {Promise<{url:string, note:string}|null>}
 */
export async function detectClipSource(imageBuffer, { logger = console } = {}) {
  if (!CLIP_AUTO_SOURCE_ENABLED) return null
  try {
    const meta = await sharp(imageBuffer).metadata()
    if (!meta.width || meta.width < 300) return null
    const jpeg = await sharp(imageBuffer)
      .resize({ width: DETECT_MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
    const r = await callVisionCompletion({
      imageDataURL: 'data:image/jpeg;base64,' + jpeg.toString('base64'),
      systemPrompt: CLIP_SOURCE_PROMPT,
      userText: '请从这张截图的地址栏和播放器进度条里读出来源信息。',
      temperature: 0.05,
      maxTokens: 512,
      vendorChain: GENERAL_OCR_VENDOR_CHAIN,
    })
    const found = parseDetectedSource(r?.content)
    if (found) logger.info?.(`[clipSource] 自动识别来源 url=${found.url ? '有' : '无'} note=${found.note || '无'}`)
    return found
  } catch (e) {
    logger.warn?.(`[clipSource] 来源自动识别失败（不影响收题）: ${e?.message || e}`)
    return null
  }
}

/**
 * 手填 + 自动识别的**唯一合并实现**：识别结果只填空缺，绝不覆盖老师手填的任一项。
 * 两张图的数组按下标与截图顺序对齐；返回值可直接喂给 clipSources / clipNotes 的构建。
 *
 * @param {Array<string>} manualSources 手填链接数组
 * @param {Array<string>} manualNotes   手填时间点/备注数组
 * @param {Array<{url:string,note:string}|null>} detected 每张截图的识别结果
 * @returns {{sources:Array<string>, notes:Array<string>, autoFilled:number}}
 */
export function mergeClipSources(manualSources = [], manualNotes = [], detected = []) {
  const n = Math.max(manualSources.length, manualNotes.length, detected.length)
  const sources = Array.from({ length: n }, (_, i) => String(manualSources[i] ?? '').trim())
  const notes = Array.from({ length: n }, (_, i) => String(manualNotes[i] ?? '').trim())
  let autoFilled = 0
  for (let i = 0; i < n; i++) {
    const d = detected[i]
    if (!d) continue
    let used = false
    if (!sources[i] && d.url) { sources[i] = String(d.url).trim().slice(0, 500); used = true }
    if (!notes[i] && d.note) { notes[i] = String(d.note).trim().slice(0, 500); used = true }
    if (used) autoFilled += 1
  }
  return { sources, notes, autoFilled }
}
