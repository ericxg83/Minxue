/**
 * 老师复核改判错题后，补触发几何配图重绘（P1，2026-09-20）。
 *
 * 背景：P0 起几何重绘只在「批改判题终定」时对 is_correct===false / blank 的题入队；
 *       AI 初判对、老师复核改判错的题，批改时资产被降级为 none（不重绘），
 *       错题本里只能显示增强原裁片。本函数在老师改判错（finalizeRejudgeResult
 *       路径 / review_edit 路径）时把对应资产复活为 pending 并重新入队。
 *
 * 幂等设计：
 *   - 无 geometry_image_url（非几何题）→ 直接返回，不打扰
 *   - 无 question_assets 资产行 → 返回（不新造资产，留待其它链路）
 *   - 资产是 completed（此前已重绘成功）→ 返回，不重复花钱
 *   - 资产是 pending（已复活待重绘/正在队列中）→ 返回，避免同一资产重复入队
 *   - 其余（none / failed / processing）→ 置 pending + 入队
 *     · none     = P0 判对/未判定被降级，老师改判错后复活
 *     · failed   = 之前重绘失败，改判错后值得再试一次
 *     · processing = 正在处理，置 pending 等 worker 完成后自然回落
 *
 * 队列获取用动态 import：worker.js ↔ queue.js 存在循环依赖，本文件被 index.js
 * 复用，保持与 worker.js 一致的动态 import 约定，避免启动期初始化顺序问题。
 */
import { query, TABLES } from '../config/neon.js'

/**
 * @param {string} questionId
 * @param {object} [opts]
 * @param {object} [opts.logger] 自定义 logger（默认 console）
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export const requeueGeometryRedrawOnRejudgeWrong = async (questionId, opts = {}) => {
  const logger = opts.logger || console
  if (!questionId) return { ok: false, reason: 'no-question-id' }
  const tag = String(questionId).slice(0, 8)
  try {
    // 1. 题目必须有几何原图
    const { rows: qRows } = await query(
      `SELECT id, geometry_image_url FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [questionId]
    )
    const q = qRows[0]
    if (!q || !q.geometry_image_url) return { ok: false, reason: 'no-geometry-image' }

    // 2. 找几何资产行（geometry_image 类型）
    const { rows: assetRows } = await query(
      `SELECT id, tikz_status FROM ${TABLES.QUESTION_ASSETS}
       WHERE question_id = $1 AND asset_type = 'geometry_image'
       ORDER BY created_at DESC LIMIT 1`,
      [questionId]
    )
    const asset = assetRows[0]
    if (!asset) return { ok: false, reason: 'no-asset-row' }

    // 3. 已重绘成功 → 幂等跳过
    if (asset.tikz_status === 'completed') return { ok: true, reason: 'already-completed' }
    // 4. 已在队列/待处理 → 幂等跳过（避免 review_edit 与 rejudge 双入口重复入队）
    if (asset.tikz_status === 'pending') return { ok: true, reason: 'already-pending' }

    // 5. 复活为 pending 并立即入队（none=被 P0 降级 / failed=值得重试 / processing=重置）
    await query(
      `UPDATE ${TABLES.QUESTION_ASSETS} SET tikz_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [asset.id]
    )
    const { getGeometryQueue } = await import('../queue.js')
    const geometryQueue = await getGeometryQueue()
    if (!geometryQueue) {
      logger.warn(`[几何重绘·改判错] ${tag} 队列不可用，资产已复活 pending 等恢复扫描兜底`)
      return { ok: true, reason: 'queue-unavailable-but-pending' }
    }
    await geometryQueue.add('reconstruct', { assetId: asset.id, source: 'teacher-rejudge-wrong' }, { attempts: 1 })
    logger.log(`[几何重绘·改判错] ${tag} 已复活资产并入队重绘（asset=${String(asset.id).slice(0, 8)}, prev=${asset.tikz_status})`)
    return { ok: true, reason: 'requeued' }
  } catch (e) {
    // 复核改判是老师的主操作，重绘只是锦上添花：失败只告警，绝不阻塞改判返回。
    logger.warn(`[几何重绘·改判错] ${tag} 异常: ${e.message.slice(0, 100)}`)
    return { ok: false, reason: 'error', message: e.message }
  }
}
