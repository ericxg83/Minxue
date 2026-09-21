/**
 * 几何配图「资产行 + 重绘入队」编排（两条批改管线共享）
 *
 * ── 为什么单独成模块（2026-09-21 白板 5 例事故）──
 *
 * 几何重绘的入口是 `question_assets` 里 `asset_type='geometry_image' AND tikz_status='pending'`
 * 的行（`geometryWorker` 的批量扫描 + `pendingTaskRecovery` 都只扫这一条）。
 * `processTask`（日常批改）在 Step 6 建这些行；**`processWorkbookGrading`（练习册）没有** ——
 * 它 2026-09-21 才补上配图裁剪（`utils/geometryCrop.js`），但没补"建资产行"这一步。
 * 结果：练习册的引图题**永远进不了重绘队列**，前端只能显示带学生手写、带邻题文字的原始裁片。
 * 实测（2026-09-21）：当日 27 张配图里 **18 张无资产行，全部来自练习册卷**（第04周 ×2 + 九上上海作业答案），
 * 老师原话「没有重绘过的课件，不是很标准」「什么时候会重绘？是时间没到吗」——
 * **不是时间问题，是根本没入队。**
 *
 * 两条管线做的是同一件事，所以编排收在本模块（与 `utils/geometryCrop.js` 同一处理方式，
 * 避免第二次"抄两份必然漂移"）。
 *
 * ── 入参契约 ──
 *
 * @param {Array}    params.questions      本次 OCR 出的全部题目（含 id / content / parent_stem / options /
 *                                         geometry_image_url / image_type / image_bbox / page_number）
 * @param {Function} params.pageImageOf    页码 → 该页原图 URL（写 asset.original_image_url 用）
 * @param {string}   [params.fallbackImageUrl] 取不到页图时的兜底 URL
 * @param {string}   params.studentId      学生 UUID
 * @param {Function} [params.log]
 * @param {Function} [params.warn]
 * @returns {Promise<{created:number, pending:Array<{assetId:string, questionId:string}>}>}
 *          `pending` 交给调用方在**判题终定后**决定入队还是降级（只重绘判错/空答的题）。
 *
 * ⚠️ 本模块**只建行、不入队**。入队时机由调用方掌握（判题终定后才入队，避免给判对的题白烧额度）。
 *
 * @module utils/geometryAssetQueue
 */

import { createQuestionAsset, updateQuestionDenormalizedSvg } from '../services/neonService.js'
import { renderGeometrySvg } from './geometrySvg.js'
import { buildFunctionGraphSvg } from './functionGraph/index.js'
import { publishCleanGeometryUrl } from './geom/cleanGeometryUrl.js'
import { checkFigureReference, FIGURE_GATE_MESSAGE } from './geometryFigureGate.js'

/**
 * 给「有配图的题」建 question_assets 行，并把需要视觉重绘的收集成 pending 列表。
 *
 * 入队前先过**配图引用闸门**（`checkFigureReference`）。闸门不过的三种情形：
 *   number_line      —— 数轴题，点线渲染器画出来是一条无意义线段
 *   function_graph   —— 函数图象/抛物线题，点线渲染器画不出曲线
 *   no_figure_reference —— 题干根本没提图，模型会照着题干文字编一张幻觉图
 * 函数图象题先走**确定性通道**：抛物线表达式本来就写在题干里，纯文本解析 + 服务端采样即可出图，
 * 零视觉调用。出图 → `tikz_status='completed'` 当场入库、不入队；出不了 → `'none'`（前端回退裁剪原图）。
 */
export async function registerGeometryAssets({
  questions,
  pageImageOf = () => null,
  fallbackImageUrl = null,
  studentId,
  log = console.log,
  warn = console.warn,
} = {}) {
  const list = Array.isArray(questions) ? questions : []
  const pending = []
  const geometryQuestions = list.filter((q) => q && q.geometry_image_url)
  if (geometryQuestions.length === 0) return { created: 0, pending }

  const results = await Promise.allSettled(geometryQuestions.map(async (q) => {
    const imageType = q.image_type || 'geometry'
    const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
    const sourcePageUrl = pageImageOf(q.page_number) || fallbackImageUrl

    let tikzStatus = imageType === 'geometry' ? 'pending' : 'none'
    let tikzCode = null
    let tikzJson = null
    let assetError = null

    if (tikzStatus === 'pending') {
      const figureGate = checkFigureReference(q.content, q.parent_stem)
      if (!figureGate.ok) {
        let built = null
        if (figureGate.reason === 'function_graph') {
          try {
            built = buildFunctionGraphSvg(q.parent_stem, q.content, renderGeometrySvg)
          } catch (e) {
            warn(`   ⚠️ [函数图象] 第 ${q.question_number} 题确定性渲染异常: ${e.message}`)
          }
        }
        if (built) {
          tikzStatus = 'completed'
          tikzCode = built.svg
          tikzJson = built.structure
          // 反范式字段与 geometryWorker 成功路径保持一致，前端按 display_image_type 取图
          await updateQuestionDenormalizedSvg(q.id, built.svg)
          // 同步发布图片 URL：周末课件配图读的是 clean_geometry_image_url
          // （lib/weekendHandout.js resolveFigure），只有 SVG 源码它读不到。
          try {
            const pub = await publishCleanGeometryUrl({ questionId: q.id, svg: built.svg, studentId })
            if (!pub.ok) {
              warn(`   [函数图象] 第 ${q.question_number} 题配图 URL 未发布（${pub.reason}），课件回退原题裁片`)
            }
          } catch (e) {
            warn(`   [函数图象] 第 ${q.question_number} 题配图 URL 发布异常: ${e.message}`)
          }
          log(`   [函数图象] 第 ${q.question_number} 题走确定性通道出图（${built.spec.expression}${built.spec.approximate ? '，陡缓为示意' : ''}），零视觉调用`)
        } else {
          tikzStatus = 'none'
          assetError = FIGURE_GATE_MESSAGE[figureGate.reason] || figureGate.reason
          log(`   [几何图] 第 ${q.question_number} 题不进重画队列（${figureGate.reason}），回退裁剪原图`)
        }
      }
    }

    const created = await createQuestionAsset({
      question_id: q.id,
      asset_type: imageType === 'chart' ? 'chart_image' : 'geometry_image',
      original_image_url: sourcePageUrl || null,
      cropped_image_url: q.geometry_image_url,
      bbox: imageBbox,
      tikz_status: tikzStatus,
      tikz_code: tikzCode,
      tikz_json: tikzJson,
      last_error: assetError,
    })
    if (tikzStatus === 'pending' && created?.id) {
      pending.push({ assetId: created.id, questionId: q.id })
    }
    return true
  }))

  const created = results.filter((r) => r.status === 'fulfilled').length
  const rejected = results.filter((r) => r.status === 'rejected')
  if (rejected.length) {
    warn(`   ⚠️ [question_assets] ${rejected.length} 条资源记录写入失败: ${rejected[0].reason?.message || rejected[0].reason}`)
  }
  log(`   ✅ [question_assets] 已保存 ${created} 条资源记录（其中 geometry 类型标记为 tikz_status=pending）`)
  return { created, pending }
}

/**
 * 判题终定后的收口：只让**会进错题本的题**（判错 / 空答）留在重绘队列，其余降级 none。
 *
 * ⚠️ 降级这一步不能省：`tikz_status='pending'` 的资产会被 `pendingTaskRecovery` 在 30 分钟后
 * 捞起重绘 —— 等于"判对的题也花钱"。这是 2026-09-20 的 P0 结论，两管线同口径。
 *
 * @param {Array}    pending   `registerGeometryAssets` 的返回值
 * @param {Function} isWrong   (questionId) => boolean
 * @param {Function} demote    async (assetIds: string[]) => void  降级实现（调用方注入，避免本模块依赖 query）
 * @param {Function} [log]
 * @returns {Promise<string[]>} 需要入队的 assetId 列表
 */
export async function settleGeometryQueue(pending, isWrong, demote, log = console.log) {
  const list = Array.isArray(pending) ? pending : []
  if (list.length === 0) return []
  const toRedraw = list.filter((p) => isWrong(p.questionId))
  const toSkip = list.filter((p) => !isWrong(p.questionId))
  if (toSkip.length > 0) await demote(toSkip.map((p) => p.assetId))
  log(`   ℹ️ [几何重绘] ${toSkip.length} 个判对/未判定资产降级 none（不重绘），${toRedraw.length} 个待重绘`)
  return toRedraw.map((p) => p.assetId)
}
