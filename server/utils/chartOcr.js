/**
 * 图表资产「逐字转录」（2026-10-27 血压题 −20 误读成 −25 事故沉淀）
 *
 * 背景：chart_image 资产（表格/统计图）的数值**只存在于图片里**——题干文本、
 * 资产表都没有表格的 OCR 文本 ⇒ 答案侧所有文本闸（验算闸 / figureNumberGuard）
 * 对"解析引用了图里根本没有的数"完全失明（验算闸只能验证 `+20-30-25+15+30=+10`
 * 内部自洽，发现不了 −25 不在图里）。
 *
 * 本模块在资产裁剪完成后对裁剪图做一次**逐字转录**（只抄不算），文本落
 * `question_assets.chart_ocr_text`，供答案生成侧交叉核对。
 *
 * 设计约束：
 *   · 供应商链 CHART_OCR_VENDOR_CHAIN 与解题链刻意**异构**（kimi-k3 主 / qwen 兜），
 *     转录方和解题方是不同模型 —— 同一处数字两次误读的概率大幅下降。
 *   · fail-open：转录失败/超时一律静默跳过（chart_ocr_text 留空 ⇒ 该题跳过核对），
 *     绝不因护栏自身的故障拖慢或打断批改主流程。
 *   · 转录是 fire-and-forget（资产建行后异步跑），批改时序上答案生成（10~150s）
 *     远晚于转录完成（秒级），竞态窗口可忽略；guard 侧读不到文本就跳过。
 */

import { downloadImageBufferNoProxy } from './noProxyHttp.js'
import { callVisionCompletion, CHART_OCR_VENDOR_CHAIN } from '../config/ai.js'

const MAX_OCR_TEXT_LENGTH = 800

const CHART_OCR_SYSTEM_PROMPT =
  '你是表格与图表的数字转录员。你的唯一任务是逐字抄写图中可见的文字和数字，' +
  '保持原有的正负号、小数点与顺序。绝对不要计算、不要解题、不要推断、不要补全看不清的内容、' +
  '不要改写任何数字。看不清的格子原样留空。'

const CHART_OCR_USER_PROMPT =
  '请逐字转录这张数学题配图（表格/统计图/示意图）里的全部文字与数字：' +
  '按行输出，同一行的单元格之间用「|」分隔。只输出转录内容本身，不要任何说明。'

/** PNG/JPEG 魔数 → dataURL MIME（裁剪图只可能是这两种） */
function bufferToImageDataUrl(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return `data:image/png;base64,${buf.toString('base64')}`
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

/** 清洗转录输出：剥代码围栏与提示词回显，压空白，截断防膨胀 */
function sanitizeTranscription(text) {
  let out = String(text ?? '')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^(?:好的[，,]?|以下是)?[^:\n]{0,20}[:：]\s*/,'')
    .trim()
  if (out.length > MAX_OCR_TEXT_LENGTH) out = out.slice(0, MAX_OCR_TEXT_LENGTH)
  return out || ''
}

/**
 * 转录一张图表裁剪图。
 * @param {string} imageUrl 裁剪图 URL（question_assets.cropped_image_url）
 * @returns {Promise<{ok: boolean, text: string, reason?: string}>}
 *          fail-open 语义：任何失败都返回 {ok:false}，绝不抛出。
 *          （callVisionCompletion 返回 { content, usedBackup, vendorName, model }）
 */
export async function ocrChartCropImage(imageUrl) {
  try {
    const url = String(imageUrl || '').trim()
    if (!url) return { ok: false, text: '', reason: 'empty_url' }
    const buf = await downloadImageBufferNoProxy(url)
    if (!buf || buf.length === 0) return { ok: false, text: '', reason: 'download_empty' }
    const result = await callVisionCompletion({
      imageDataURL: bufferToImageDataUrl(buf),
      systemPrompt: CHART_OCR_SYSTEM_PROMPT,
      userText: CHART_OCR_USER_PROMPT,
      temperature: 0,
      maxTokens: 1024,
      vendorChain: CHART_OCR_VENDOR_CHAIN,
    })
    const text = sanitizeTranscription(result?.content)
    if (!text) return { ok: false, text: '', reason: 'empty_transcription' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, text: '', reason: e?.message || 'ocr_error' }
  }
}
