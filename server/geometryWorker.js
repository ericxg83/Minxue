/**
 * 几何图重建异步 Worker — 由 BullMQ 'geometry-reconstruction' 队列调用。
 *
 * 职责：
 *   扫描 pending 状态的 geometry 资产 →
 *   调用 Vision API 识别几何结构 →
 *   服务端渲染干净 SVG →
 *   更新状态为 completed / failed
 *
 * 与主流程（worker.js）解耦：上传+裁剪完成后立即结束，
 * 本 Worker 异步完成耗时的 Vision API 调用和 SVG 渲染。
 *
 * 重试策略：
 *   第 1 次失败 → 5 分钟后重试（pending）
 *   第 2 次失败 → 30 分钟后重试
 *   第 3 次失败 → 2 小时后重试
 *   超过 3 次 → 保持 failed，等待人工重新触发
 */

import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import axios from 'axios'
import { query, TABLES } from './config/neon.js'
import { callVisionCompletion, buildGeometryReconstructionPrompt } from './config/ai.js'
import { parseGeometryStructure, renderGeometrySvg, isEmptyStructure, isRawEmptyStructure, hasDerivedPoints } from './utils/geometrySvg.js'
import { validateGeometryLabels } from './utils/geometryLabelValidator.js'
import { validateStructureAgainstContent } from './utils/geometryContentGate.js'
import { computeGeometryConsistency } from './utils/geom/consistency.js'
import { correctGeometryFigure } from './utils/geom/correctedRender.js'
import {
  updateGeometryReconstructionStatus,
  updateQuestionDenormalizedSvg
} from './services/neonService.js'

// ── 重试间隔（毫秒） ──
const RETRY_DELAYS = [
  5 * 60 * 1000,   // 第 1 次失败 → 5 分钟
  30 * 60 * 1000,  // 第 2 次失败 → 30 分钟
  2 * 60 * 60 * 1000 // 第 3 次失败 → 2 小时
]
const MAX_RETRIES = RETRY_DELAYS.length // 3

// ── 辅助 ──

async function downloadImageBuffer(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    return Buffer.from(resp.data)
  } catch (error) {
    console.error(`   ⚠️ [几何Worker] 图片下载失败: ${error.message}`)
    return null
  }
}

/**
 * 几何重建核心：原始裁剪图 → Vision API 识别结构 → 服务端渲染干净 SVG
 *
 * @returns {Promise<{ok:true,svg:string,structure:object}|{ok:false,reason:string,retriable:boolean}>}
 *   reason 决定后续处置：no_figure / derived_deferred 是确定性结论（标 none，不重试）；
 *   parse_fail / unrenderable 是模型没遵守格式（重试有意义，不能永久锁死）。
 */
async function reconstructGeometrySvg(imageBuffer, questionId, content, options) {
  const shortId = (questionId || '').substring(0, 8)
  const base64 = imageBuffer.toString('base64')
  const dataURL = `data:image/png;base64,${base64}`

  const result = await callVisionCompletion({
    imageDataURL: dataURL,
    systemPrompt: buildGeometryReconstructionPrompt(),
    userText: '请识别这张几何图中的纯几何结构（点/线/圆/标注），只输出结构化 JSON。',
    temperature: 0.1,
    maxTokens: 3072
  })

  const structure = parseGeometryStructure(result.content)
  if (!structure) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 未能解析出几何结构 JSON`)
    return { ok: false, reason: 'parse_fail', retriable: true }
  }
  if (isRawEmptyStructure(structure)) {
    console.log(`   [几何Worker] ${shortId}: 图中无几何结构（数轴/实物/统计图），保留裁剪原图`)
    return { ok: false, reason: 'no_figure', retriable: false }
  }
  if (isEmptyStructure(structure)) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 有元素但顶点缺坐标，渲染不出`)
    return { ok: false, reason: 'unrenderable', retriable: true }
  }

  // 服务端二次整理：把模型 labels 按空间规则拆成 geometry_labels / ignored_labels
  const validated = validateGeometryLabels(structure)
  const nGeo = validated.geometry_labels.length
  const nIgn = validated.ignored_labels.length
  console.log(`   [几何Worker] ${shortId}: 标注二次整理 ${nGeo} 几何 / ${nIgn} 忽略`)

  if (hasDerivedPoints(validated)) {
    console.log(`   [几何Worker] ${shortId}: 含派生点（垂足/中点/线上点），待约束求解器，暂不重绘`)
    return { ok: false, reason: 'derived_deferred', retriable: false }
  }

  // 题干交叉核对：模型画出的边/点在题干/选项里找不到出处，或折叠派生点缺失 → 拒绝入库。
  // 这是独立证据校验，不依赖模型自我验证。选项里的字母引用也算合法出处
  // （选择题题干"如图X, [条件1], [条件2]" 几乎不直接引用图上字母）。
  if (content || (Array.isArray(options) && options.length > 0)) {
    const gate = validateStructureAgainstContent(validated, content, options)
    if (!gate.ok) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 题干核对未过 → ${gate.reasons.join('；')}`)
      return { ok: false, reason: 'content_mismatch', retriable: false, detail: gate.reasons }
    }
  }

  const svg = renderGeometrySvg(validated)
  if (!svg) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 结构渲染 SVG 失败`)
    return { ok: false, reason: 'unrenderable', retriable: true }
  }
  return { ok: true, svg, structure: validated }
}

/**
 * 处理单个几何资产的异步重建
 *
 * @param {Object} asset - { id, question_id, cropped_image_url, retry_count }
 * @returns {Promise<boolean>} 是否成功
 */
async function processSingleAsset(asset) {
  const shortId = (asset.question_id || '').substring(0, 8)
  console.log(`\n[几何Worker] ${shortId}: 开始处理 (assetId=${asset.id?.substring(0, 8)})`)

  // 1. 标记为 processing
  try {
    await updateGeometryReconstructionStatus(asset.id, {
      tikz_status: 'processing',
      processed_at: new Date().toISOString()
    })
  } catch (e) {
    console.error(`   ⚠️ [几何Worker] ${shortId}: 更新状态为 processing 失败:`, e.message)
  }

  // 2. 下载裁剪好的几何图
  const imageUrl = asset.cropped_image_url || asset.geometry_image_url
  if (!imageUrl) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 无配图 URL，标记 none`)
    await markNotReconstructable(asset, 'no_figure')
    return false
  }

  const rawBuffer = await downloadImageBuffer(imageUrl)
  if (!rawBuffer) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 下载失败，稍后重试`)
    await handleRetry(asset, '图片下载失败')
    return false
  }

  // 题干文本 + 选项：题干交叉核对闸门的独立证据源。
  // 选择题的字母引用几乎全在选项里，必须一起传入闸门，否则标准几何图会被误判"凭空多画"。
  let content = asset.content
  let options = asset.options
  if (content == null || options == null) {
    try {
      const { rows } = await query(
        `SELECT content, options FROM ${TABLES.QUESTIONS} WHERE id = $1 LIMIT 1`,
        [asset.question_id]
      )
      content = rows[0]?.content ?? ''
      options = rows[0]?.options ?? []
    } catch (e) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 题干/选项读取失败，跳过交叉核对:`, e.message)
      content = content ?? ''
      options = options ?? []
    }
  }

  // 3. Vision API 识别几何结构 → 服务端渲染干净 SVG
  let svg, structure
  try {
    const result = await reconstructGeometrySvg(rawBuffer, asset.question_id, content, options)
    if (!result.ok) {
      if (result.retriable) {
        // 模型没遵守输出格式：重试有意义，绝不能锁死成永久 failed
        await handleRetry(asset, `结构不可渲染: ${result.reason}`)
      } else {
        // 确定性结论：这题没有可重画的图，或题干核对未过 → 退回裁剪原图
        await markNotReconstructable(asset, result.reason, result.detail?.join('；'))
      }
      return false
    }
    svg = result.svg
    structure = result.structure

    // [P4 影子模式] 几何自洽性审计：抽取约束→求解→闸门，仅产出审计字段，绝不阻断重建
    try {
      structure.consistency = computeGeometryConsistency(structure, content)
    } catch (consistencyErr) {
      console.warn(`   [几何Worker] ${shortId}: 自洽性审计异常（已忽略，不影响重建）:`, consistencyErr?.message)
      structure.consistency = { skipped: true, reason: 'audit_error' }
    }

    // [P5 回灌修正渲染] 用求解后一致坐标重渲修正图；安全闸门不过则保留原图，交人工复核
    const rawSvg = svg
    try {
      const corrected = correctGeometryFigure(structure, content)
      if (corrected.ok) {
        structure.solved = { ...corrected.solved, svg: corrected.svg }
        structure.raw_svg = rawSvg
        svg = corrected.svg
        console.log(`   [几何Worker] ${shortId}: 已回灌修正渲染（displacement=${corrected.solved.displacement}）`)
      } else {
        structure.solved = { skipped: true, reason: corrected.reason }
        console.log(`   [几何Worker] ${shortId}: 未回灌修正渲染（${corrected.reason}），保留原图`)
      }
    } catch (corrErr) {
      console.warn(`   [几何Worker] ${shortId}: 修正渲染异常（保留原图）:`, corrErr?.message)
      structure.solved = { skipped: true, reason: 'correct_error' }
    }

    const nP = structure.points.length
    const nS = structure.segments.length
    const nC = structure.circles.length
    console.log(
      `   [几何Worker] ${shortId}: 识别到 ${nP} 点 / ${nS} 线 / ${nC} 圆，SVG ${svg.length} 字符`
    )
  } catch (error) {
    // API 异常 → 按重试策略处理
    console.error(`   ⚠️ [几何Worker] ${shortId}: Vision API 调用异常:`, error.message)
    await handleRetry(asset, error.message)
    return false
  }

  // 4. 成功 → 入库
  try {
    await updateGeometryReconstructionStatus(asset.id, {
      tikz_status: 'completed',
      tikz_json: structure,
      tikz_code: svg,    // SVG 源码存入 tikz_code 字段（兼容旧字段名）
      last_error: '',    // 清空历史错误，避免成功记录仍带着旧的失败原因
      processed_at: new Date().toISOString()
    })

    // 5. 反范式写入 questions 表（clean_geometry_svg + display_image_type）
    await updateQuestionDenormalizedSvg(asset.question_id, svg)

    console.log(`   ✅ [几何Worker] ${shortId}: 重建成功，数据已入库`)
    return true
  } catch (error) {
    console.error(`   ⚠️ [几何Worker] ${shortId}: 入库失败:`, error.message)
    await handleRetry(asset, `入库失败: ${error.message}`)
    return false
  }
}

/**
 * 处理重试逻辑：更新 retry_count，根据失败次数决定是否安排重试
 */
async function handleRetry(asset, errorMessage) {
  const currentRetry = (asset.retry_count || 0) + 1
  const shortId = (asset.question_id || '').substring(0, 8)

  console.log(`   [几何Worker] ${shortId}: 第 ${currentRetry} 次失败`)

  if (currentRetry <= MAX_RETRIES) {
    // 更新失败状态 + 递增 retry_count
    await updateGeometryReconstructionStatus(asset.id, {
      tikz_status: 'failed',
      retry_count: currentRetry,
      last_error: errorMessage,
      processed_at: new Date().toISOString()
    })
    console.log(`   [几何Worker] ${shortId}: 已标记失败，将在 ${RETRY_DELAYS[currentRetry - 1] / 60000} 分钟后自动重试`)
  } else {
    // 超过最大重试次数：放弃 Vision 重建,标 none 让前端回退裁剪原图。
    // 长期兜底：避免 failed 状态无限期挂着,24h watchdog 会再次强制收尾。
    await updateGeometryReconstructionStatus(asset.id, {
      tikz_status: 'none',
      retry_count: currentRetry,
      last_error: `Vision 重建超过最大重试 (${MAX_RETRIES}),已回退裁剪原图。最后一次错误: ${errorMessage}`,
      processed_at: new Date().toISOString()
    })
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 超过最大重试 (${MAX_RETRIES}),放弃 Vision,前端回退裁剪原图`)
  }
}

/**
 * 确定性结论：这张图不需要或暂时不能重绘 → 标 'none'，不重试，前端回退裁剪原图。
 * 与 'failed' 的区别是它不该被 pendingTaskRecovery 反复捞起，也不该显示成错误。
 */
const NOT_RECONSTRUCTABLE = {
  no_figure: '图中无可重绘的几何结构（数轴/实物/统计图）',
  derived_deferred: '含派生点（垂足/中点/线上点），待约束求解器接入',
  content_mismatch: '重绘结构与题干引用不符（多画/漏画），回退裁剪原图'
}

async function markNotReconstructable(asset, reason, detail) {
  await updateGeometryReconstructionStatus(asset.id, {
    tikz_status: 'none',
    last_error: detail ? `${NOT_RECONSTRUCTABLE[reason] || reason}: ${detail}` : (NOT_RECONSTRUCTABLE[reason] || reason),
    processed_at: new Date().toISOString()
  })
}

/**
 * BullMQ Worker 入口 — 由 geometry-reconstruction 队列调用
 *
 * job.data 可包含:
 *   - assetId: 指定处理单个资产（人工重试时使用）
 *   - batch: true 时扫描所有 pending 资产（定时任务使用）
 */
export async function processGeometryReconstruction(job) {
  const { assetId, batch } = job?.data || {}

  if (assetId) {
    // 处理单个指定资产（人工重新触发）
    const { rows } = await query(
      `SELECT a.id, a.question_id, a.cropped_image_url,
              a.retry_count, a.last_error, a.tikz_status,
              q.geometry_image_url,
              q.content, q.options
       FROM ${TABLES.QUESTION_ASSETS} a
       JOIN ${TABLES.QUESTIONS} q ON q.id = a.question_id
       WHERE a.id = $1`,
      [assetId]
    )
    if (rows.length === 0) {
      console.error(`[几何Worker] 未找到资产: ${assetId}`)
      return { success: false, error: '资产未找到' }
    }
    const ok = await processSingleAsset(rows[0])
    return { success: ok, assetId }
  }

  if (batch) {
    // 批量扫描所有 pending 资产
    console.log(`[几何Worker] 开始批量扫描 pending 几何资产...`)
    const { getPendingGeometryAssets } = await import('./services/neonService.js')
    const assets = await getPendingGeometryAssets(20)
    console.log(`[几何Worker] 发现 ${assets.length} 个待处理资产`)

    let ok = 0, fail = 0
    for (const asset of assets) {
      const result = await processSingleAsset(asset)
      if (result) ok++; else fail++
    }
    console.log(`[几何Worker] 批量处理完成: 成功 ${ok} / 失败 ${fail}`)
    return { success: ok > 0, processed: ok + fail, ok, fail }
  }

  // 兼容旧调用方式：从 job.data 读取 questionId
  if (job?.data?.questionId) {
    const { rows } = await query(
      `SELECT a.id, a.question_id, a.cropped_image_url,
              a.retry_count, a.last_error, a.tikz_status,
              q.geometry_image_url, q.image_type,
              q.content, q.options
       FROM ${TABLES.QUESTION_ASSETS} a
       JOIN ${TABLES.QUESTIONS} q ON q.id = a.question_id
       WHERE a.question_id = $1 AND a.asset_type = 'geometry_image'
       ORDER BY a.created_at DESC LIMIT 1`,
      [job.data.questionId]
    )
    if (rows.length === 0) {
      console.error(`[几何Worker] 未找到 questionId=${job.data.questionId} 的资产`)
      return { success: false, error: '资产未找到' }
    }
    const ok = await processSingleAsset(rows[0])
    return { success: ok, questionId: job.data.questionId }
  }

  console.warn('[几何Worker] 未指定 assetId 或 batch 模式，跳过')
  return { success: false, error: '缺少参数' }
}