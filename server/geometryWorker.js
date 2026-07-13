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
import { parseGeometryStructure, renderGeometrySvg, isEmptyStructure } from './utils/geometrySvg.js'
import { validateGeometryLabels } from './utils/geometryLabelValidator.js'
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
 */
async function reconstructGeometrySvg(imageBuffer, questionId) {
  const shortId = (questionId || '').substring(0, 8)
  try {
    const base64 = imageBuffer.toString('base64')
    const dataURL = `data:image/png;base64,${base64}`

    const result = await callVisionCompletion({
      imageDataURL: dataURL,
      systemPrompt: buildGeometryReconstructionPrompt(),
      userText: '请识别这张几何图中的纯几何结构（点/线/圆/标注），只输出结构化 JSON。',
      temperature: 0.1,
      maxTokens: 2048
    })

    const structure = parseGeometryStructure(result.content)
    if (!structure) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 未能解析出几何结构 JSON`)
      return null
    }
    if (isEmptyStructure(structure)) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 未识别到有效几何结构（空）`)
      return null
    }

    // 服务端二次整理：把模型 labels 按空间规则拆成 geometry_labels / ignored_labels
    const validated = validateGeometryLabels(structure)
    const nGeo = validated.geometry_labels.length
    const nIgn = validated.ignored_labels.length
    console.log(`   [几何Worker] ${shortId}: 标注二次整理 ${nGeo} 几何 / ${nIgn} 忽略`)

    const svg = renderGeometrySvg(validated)
    if (!svg) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 结构渲染 SVG 失败`)
      return null
    }
    return { svg, structure: validated }
  } catch (error) {
    console.error(`   ⚠️ [几何Worker] ${shortId} 失败:`, error.message)
    throw error // 由调用方处理重试逻辑
  }
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
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 无图片 URL，标记失败`)
    await handleFailure(asset, '无图片 URL')
    return false
  }

  const rawBuffer = await downloadImageBuffer(imageUrl)
  if (!rawBuffer) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 下载失败，标记失败`)
    await handleFailure(asset, '图片下载失败')
    return false
  }

  // 3. Vision API 识别几何结构 → 服务端渲染干净 SVG
  let svg, structure
  try {
    const result = await reconstructGeometrySvg(rawBuffer, asset.question_id)
    if (!result) {
      // 结构解析失败（非 API 异常）→ 算失败但不重试（结构数据本身有问题）
      await handleFailure(asset, '无法识别有效几何结构')
      return false
    }
    svg = result.svg
    structure = result.structure
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
      processed_at: new Date().toISOString()
    })

    // 5. 反范式写入 questions 表（clean_geometry_svg + display_image_type）
    await updateQuestionDenormalizedSvg(asset.question_id, svg)

    console.log(`   ✅ [几何Worker] ${shortId}: 重建成功，数据已入库`)
    return true
  } catch (error) {
    console.error(`   ⚠️ [几何Worker] ${shortId}: 入库失败:`, error.message)
    await handleFailure(asset, `入库失败: ${error.message}`)
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
    // 超过最大重试次数，保持 failed 等待人工处理
    await updateGeometryReconstructionStatus(asset.id, {
      tikz_status: 'failed',
      retry_count: currentRetry,
      last_error: `已超过最大重试次数 (${MAX_RETRIES})，最后一次错误: ${errorMessage}`,
      processed_at: new Date().toISOString()
    })
    console.warn(`   [几何Worker] ${shortId}: 已超过最大重试次数 (${MAX_RETRIES})，保持 failed 状态，等待人工重新触发`)
  }
}

/**
 * 处理不可重试的失败（如无效图片、无结构数据）
 */
async function handleFailure(asset, errorMessage) {
  await updateGeometryReconstructionStatus(asset.id, {
    tikz_status: 'failed',
    last_error: errorMessage,
    retry_count: asset.retry_count || 0,
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
              q.geometry_image_url
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
              q.geometry_image_url, q.image_type
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