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

import { downloadImageBufferNoProxy } from './utils/noProxyHttp.js'
import { query, TABLES } from './config/neon.js'
import { callVisionCompletion, buildGeometryReconstructionPrompt } from './config/ai.js'
// 限流/过载安全网：429（配额窗口）与 503（上游高负载）是常态噪声，不该消耗
// handleRetry 的 3 次预算 —— 否则本来能重绘的题会被永久标 tikz_status='none'。
// 见 server/utils/aiProviderRetry.js 头部说明与实测依据（Google 免费档 5 RPM，需跨整分钟窗退避）。
import { withProviderRetry } from './utils/aiProviderRetry.js'
import { parseGeometryStructure, renderGeometrySvg, isEmptyStructure, isRawEmptyStructure, hasDerivedPoints } from './utils/geometrySvg.js'
import { correctDslByVision } from './utils/geom/dsl/reactLoop.js'
import { validateGeometryLabels } from './utils/geometryLabelValidator.js'
import { validateStructureAgainstContent, detectNonGeometryFigure } from './utils/geometryContentGate.js'
import { computeGeometryConsistency } from './utils/geom/consistency.js'
import { correctGeometryFigure } from './utils/geom/correctedRender.js'
import { canPublishDerivedFigure } from './utils/geom/derivedCoverage.js'
// 函数图象确定性通道：零视觉调用，出图即入库，不消耗模型额度
import { buildFunctionGraphSvg } from './utils/functionGraph/index.js'
// SVG → 图片 URL 发布通道：让重画产物对周末课件（读 clean_geometry_image_url）可见
import { publishCleanGeometryUrl } from './utils/geom/cleanGeometryUrl.js'
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

// ── 几何重绘专用视觉通道（2026-09-19）─────────────────────────────────────────
// **当前默认关闭**：几何重绘继续走原有降级链（魔搭 → 辉辉云 …）。
//
// 为什么不启用原生 Gemini：Google 免费档配额是「按项目 × 按模型 × 按天」，
// gemini-3.8-flash 实测只有 **20 次/天**（另有 5 RPM）。DSL 闭环每图约 2.5 次视觉调用
// → 每天最多 ~8 张图，105 张存量回填要 ~13 天。稳态量 4–20 张/天，覆盖不了。
// （能力本身没问题：同一模型经辉辉云跑基准 19/20 = 95%，直连实测也能出图。）
//
// 想启用这条通道时，两个开关都要打开：
//   1) GEMINI_DIRECT_ENABLED=1   （ai.js：点亮 Gemini 直连通道）
//   2) GEOMETRY_VISION_VENDOR=GoogleGeminiDirect （本文件：把该通道置顶到几何链路）
// 关闭：GEOMETRY_VISION_VENDOR=off（或 none/0/false），或不设置（默认即为关闭）。
const GEOMETRY_VISION_VENDOR = (() => {
  const raw = process.env.GEOMETRY_VISION_VENDOR
  if (raw === undefined) return null                     // 未设置 → 不指定（走原降级链）
  const v = String(raw).trim()
  return /^(?:off|none|0|false)$/i.test(v) ? null : (v || null)
})()

// ── 辅助 ──

/**
 * 重画成功后的收尾：把 SVG 发布成图片 URL，回写 clean_geometry_image_url。
 *
 * 为什么必须做：周末课件的配图取数走 `clean_geometry_image_url`（见
 * lib/weekendHandout.js resolveFigure），而重画只写 `clean_geometry_svg`。
 * 不做这一步，重画产物对课件不可见（实测 15 题有 SVG、0 题有 URL）。
 *
 * 失败**不上抛**：SVG 本身对错题本/重练卷/PDF 导出仍有效（那些走
 * display_image_type），发布失败最多让课件回退原题裁片，不该把成功的重画判成失败。
 */
async function publishCleanUrlFor(questionId, svg, shortId) {
  try {
    const r = await publishCleanGeometryUrl({ questionId, svg })
    if (r.ok) {
      console.log(
        `   [几何Worker] ${shortId}: 已发布干净配图 URL（${r.width}x${r.height}, ${(r.bytes / 1024).toFixed(1)}KB）`
      )
    } else {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 干净配图未发布（${r.reason}），课件将回退原题裁片`)
    }
    return r
  } catch (e) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 干净配图发布异常: ${e?.message}`)
    return { ok: false, reason: `throw:${e?.message}` }
  }
}

async function downloadImageBuffer(url) {
  try {
    // 统一走 NO_PROXY_DOWNLOAD_OPTS（含 proxy:false）—— OSS 配图是公网 CDN，必须直连。
    // 2026-09-18 事故：开发机注入 HTTP(S)_PROXY 代理环境变量后，axios 默认走内网代理，
    // 该代理把 HTTPS 请求当明文 HTTP 转回 443 → 「400 The plain HTTP request...」，
    // 导致几何 Worker 下载裁片全部失败（curl 直连 200，axios 走代理 400）。
    // 2026-09-22 收敛：原先本文件手写 axios 参数，与 worker.js 等三处各自为政；
    // 现全部改用共享选项，新增下载调用点漏带 proxy:false 会被回归测试拦下。
    return await downloadImageBufferNoProxy(url)
  } catch (error) {
    console.error(`   ⚠️ [几何Worker] 图片下载失败: ${error.message}`)
    return null
  }
}

/**
 * 几何重建核心：原始裁剪图 → Vision API 识别结构 → 服务端渲染干净 SVG
 *
 * @returns {Promise<{ok:true,svg:string,structure:object}|{ok:false,reason:string,retriable:boolean}>}
 *   reason 决定后续处置：no_figure / content_mismatch 是确定性结论（标 none，不重试）；
 *   parse_fail / unrenderable 是模型没遵守格式（重试有意义，不能永久锁死）。
 *   注意：含派生点的结构不再在这里早退——它要交给求解器验证，
 *   由 processSingleAsset 的派生点安全网统一裁决（见该处注释）。
 */
async function reconstructGeometrySvg(imageBuffer, questionId, content, options, parentStem = '') {
  const shortId = (questionId || '').substring(0, 8)
  const base64 = imageBuffer.toString('base64')
  const dataURL = `data:image/png;base64,${base64}`

  const result = await withProviderRetry(
    () => callVisionCompletion({
      imageDataURL: dataURL,
      systemPrompt: buildGeometryReconstructionPrompt(),
      userText: '请识别这张几何图中的纯几何结构（点/线/圆/标注），只输出结构化 JSON。',
      temperature: 0.1,
      maxTokens: 3072,
      preferredVendor: GEOMETRY_VISION_VENDOR
    }),
    { onWait: ({ kind, attempt, waitMs }) => console.warn(`   ⏳ [几何Worker] ${shortId}: 结构识别 ${kind} 第 ${attempt} 次，等待 ${Math.round(waitMs / 1000)}s`) }
  )

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

  // 题干交叉核对：模型画出的边/点在题干/选项里找不到出处，或折叠派生点缺失 → 拒绝入库。
  // 这是独立证据校验，不依赖模型自我验证。选项里的字母引用也算合法出处
  // （选择题题干"如图X, [条件1], [条件2]" 几乎不直接引用图上字母）。
  //
  // ⚠️ 核对文本必须包含 parent_stem（共同题干）。2026-09-18 实测（△ABC 平行线题）：
  // 多小问大题拆行落库后，字母引用（"作PM//AC交AB于点M"等）全在 parent_stem，
  // content 只剩 "(1)若D是BC的中点，且AP:PD=2:1,求AM:AB的值"。若只看 content，
  // 模型画对的 AC/AD/MP/NP 会被误判"题干中无引用" → content_mismatch 永久拒稿，
  // 白板只能显示模糊原图。与完整性判定「引图判定必须含 parent_stem」同一类问题。
  const gateText = [String(parentStem || ''), String(content || '')].join('\n')
  if (gateText.trim() || (Array.isArray(options) && options.length > 0)) {
    const gate = validateStructureAgainstContent(validated, gateText, options)
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

  // 题干文本 + 选项：题干交叉核对闸门的独立证据源。
  // 选择题的字母引用几乎全在选项里，必须一起传入闸门，否则标准几何图会被误判"凭空多画"。
  let content = asset.content
  let options = asset.options
  if (content == null || options == null) {
    try {
      const { rows } = await query(
        `SELECT content, parent_stem, options FROM ${TABLES.QUESTIONS} WHERE id = $1 LIMIT 1`,
        [asset.question_id]
      )
      content = rows[0]?.content ?? ''
      options = rows[0]?.options ?? []
      if (asset.parent_stem == null) asset.parent_stem = rows[0]?.parent_stem ?? ''
    } catch (e) {
      console.warn(`   ⚠️ [几何Worker] ${shortId}: 题干/选项读取失败，跳过交叉核对:`, e.message)
      content = content ?? ''
      options = options ?? []
    }
  }

  // ── 兄弟小问文本并入闸门比对（2026-09-25）──
  // 一张完整配图被复制挂到大题的每个小问行（同 task_id + 同 question_number），但闸门
  // 默认只比对「parent_stem + 当前小问」→ 原图里为「其它小问」画的点线被误判「多画/题干
  // 无引用」而回退（实测 09-24 批 34 张 content_mismatch 里 23 张是这种拆行小问）。
  // 把同题兄弟小问的题干与选项一并纳入出处：只有整道大题（含所有小问）都没提的字母，
  // 才算模型幻觉。放宽的是「出处来源」，不放宽点线几何一致性校验本身。
  let gateParentStem = asset.parent_stem || ''
  try {
    const { rows: sib } = await query(
      `SELECT q2.content, q2.options FROM ${TABLES.QUESTIONS} q2
         JOIN ${TABLES.QUESTIONS} q1 ON q1.id = $1
        WHERE q2.deleted_at IS NULL
          AND q2.id <> $1
          AND q1.task_id IS NOT NULL AND q2.task_id = q1.task_id
          AND q1.question_number IS NOT NULL AND q2.question_number = q1.question_number`,
      [asset.question_id]
    )
    if (sib.length > 0) {
      const sibText = sib.map(s => {
        const opt = Array.isArray(s.options) ? s.options.join(' ') : (s.options || '')
        return `${s.content || ''} ${opt}`
      }).join('\n')
      gateParentStem = [gateParentStem, sibText].filter(Boolean).join('\n')
    }
  } catch (e) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 兄弟小问文本读取失败（仅用本行题干比对）:`, e.message)
  }

  // 2.4 内容闸门：流程图 / 数值转换器 / 输入输出表格类配图**不适用几何重绘**
  //     （图内是中文说明文字或分数数值表格；DSL 的 label 通道有意只放行数学符号，
  //      以免手写答案被当成题设文字画进图里）。命中就直接保留原图，且省下模型额度。
  //     同理"多子图/多面板"（图1+图2、图甲+图乙、四选项函数图象）：DSL 只有一个画布，
  //     重绘必然只画其中一个（实测 845802c9 只画了图1、图2 整块丢失）。
  const nonGeom = detectNonGeometryFigure(content)
  if (nonGeom.skip) {
    console.log(`   ⏭ [几何Worker] ${shortId}: ${nonGeom.reason} → 保留原图，不重绘`)
    // ⚠️ 必须同时作废**历史上已发布**的干净图：判据是后来才加的，旧产物不会自己消失，
    //    否则前端照旧显示那张（错的/残缺的）重绘图 —— 2026-09-21 第 90 题空框流程图即此因。
    try {
      await retractPublishedCleanFigure(asset.question_id, nonGeom.reason)
    } catch (e) {
      console.error(`   ⚠️ [几何Worker] ${shortId}: 作废旧重绘产物失败:`, e.message)
    }
    await markNotReconstructable(asset, 'non_geometry_figure', nonGeom.kind)
    return false
  }

  // 2.5 函数图象通道：确定性骨架 + 视觉标注补全（V2，2026-09-18）。
  //     旧版：纯文本正则解析（零视觉）——"读字不读图"，题干没写坐标的字母
  //     （"与x轴交于A、B"的 A/B、"点D(m,n)是抛物线上一点"的 D）被静默丢弃，
  //     用户的感受是"图上少了字母"。打补丁（xInterceptLabels/symbolicCurveLabels）
  //     总可能漏句式。
  //     新版：确定性通道先算数学精确骨架（抛物线/顶点/根/截距），
  //     **再用视觉模型看原图**识别图上所有字母标注 → 数学坐标映射 → 合并 →
  //     「原图||重画」闭环确认 OK 才入库。字母不再丢。
  //     视觉识别失败时降级为纯确定性骨架（不阻断入库，宁可少标不标错）。
  try {
    const built = buildFunctionGraphSvg(asset.parent_stem, content, renderGeometrySvg)
    if (built) {
      let finalStructure = built.structure
      let finalSvg = built.svg
      let annotate = null

      // 视觉补标注：看原图识别全部字母（若图可下载 + 视觉可用）
      try {
        const rawBuffer2 = await downloadImageBuffer(imageUrl)
        if (rawBuffer2) {
          const { identifyVisionLabels, mergeVisionLabels, verifyFunctionGraphByVision } =
            await import('./utils/functionGraph/visionAnnotate.js')
          const imageDataURL = `data:image/png;base64,${rawBuffer2.toString('base64')}`
          const callVision = async ({ systemPrompt, userText, imageDataURL: img }) => {
            const r = await withProviderRetry(
              () => callVisionCompletion({ imageDataURL: img, systemPrompt, userText, temperature: 0.1, maxTokens: 2048, preferredVendor: GEOMETRY_VISION_VENDOR }),
              { onWait: ({ kind, attempt, waitMs }) => console.warn(`   ⏳ [几何Worker] ${shortId}: 函数图象视觉补标注 ${kind} 第 ${attempt} 次，等待 ${Math.round(waitMs / 1000)}s`) }
            )
            return r.content
          }
          const vision = await identifyVisionLabels({ imageDataURL, callVision })
          if (vision.length > 0) {
            const merged = mergeVisionLabels(built.structure, vision, built.spec, [asset.parent_stem, content].join(' '))
            if (merged.points.length > built.structure.points.length) {
              finalStructure = merged
              finalSvg = renderGeometrySvg(merged)
              // 闭环确认：原图和重画并排给模型看
              const verify = await verifyFunctionGraphByVision({
                originalImageDataUrl: imageDataURL,
                renderSvg: finalSvg,
                content: [asset.parent_stem, content].join(' '),
                labels: merged.points.map(p => p.label),
                callVision
              })
              console.log(
                `   [几何Worker] ${shortId}: 函数图象视觉补标注 ${built.structure.points.length}→${merged.points.length} 点，闭环=${verify.ok ? 'OK' : verify.reason}`
              )
              annotate = { vision: vision.length, merged: merged.points.length - built.structure.points.length, verified: verify.ok }
              if (!verify.ok) {
                // 闭环未过（可能字母缺失）：继续用合并版但记录（曲线本身确定性可靠）
                console.warn(`   [几何Worker] ${shortId}: 函数图象闭环未确认（${verify.reason}），按确定性骨架+标注入库`)
              }
            }
          }
        }
      } catch (annotateErr) {
        console.warn(`   ⚠️ [几何Worker] ${shortId}: 函数图象视觉补标注失败（降级为确定性骨架）:`, annotateErr.message)
      }

      await updateGeometryReconstructionStatus(asset.id, {
        tikz_status: 'completed',
        tikz_json: { ...finalStructure, _annotate: annotate },
        tikz_code: finalSvg,
        last_error: '',
        processed_at: new Date().toISOString()
      })
      await updateQuestionDenormalizedSvg(asset.question_id, finalSvg)
      await publishCleanUrlFor(asset.question_id, finalSvg, shortId)
      console.log(
        `   ✅ [几何Worker] ${shortId}: 函数图象通道出图（${built.spec.expression}${annotate ? ' + 视觉标注' : '，纯确定性'}）`
      )
      return true
    }
  } catch (e) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 函数图象通道异常（继续走视觉重画）:`, e.message)
  }

  // 3. Vision API 识别几何结构 → 服务端渲染干净 SVG
  const rawBuffer = await downloadImageBuffer(imageUrl)
  if (!rawBuffer) {
    console.warn(`   ⚠️ [几何Worker] ${shortId}: 下载失败，稍后重试`)
    await handleRetry(asset, '图片下载失败')
    return false
  }

  let svg, structure
  try {
    const result = await reconstructGeometrySvg(rawBuffer, asset.question_id, content, options, gateParentStem)
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

    // 3.6 DSL ReAct 通道（视觉闭环自修正）
    //
    // 当 JSON 通道的结构有明显缺陷（元素漏画/多画、关键点位置严重偏移）时，
    // 改用构造式 DSL：模型只输出构造命令（point/midpoint/foot/intersect…），
    // 坐标由执行器精确计算；渲染后再给模型看，形成视觉闭环自修正。
    //
    // 优势：
    //   - 派生点（垂足/中点/交点）位置绝对精确（执行器算的），不依赖模型目测
    //   - 视觉验证轮能捕获"点/线漏画"或"多画"（JSON 通道无此能力）
    //   - 模型在验证轮可以重新构造，不受首轮猜测锚定
    //
    // 启用条件：
    //   1. ⭐ 默认强制（2026-09-18 用户拍板）：所有几何题必须走 DSL 构造式通道 +
    //      视觉闭环。旧 JSON 通道（模型目测坐标 → 一次渲染 → 入库）没有
    //      "画完对原图"的校验，产物形态与原图严重不一致（用户实测截图实锤：
    //      平行线被规范化成等距水平线、截线倒八字），已不再作为出图通道。
    //   2. GEOMETRY_FORCE_DSL=0 可显式关闭（仅测试/诊断用）。
    //
    // 注意：JSON 通道仍先执行一轮（reconstructGeometrySvg），它产出的 structure
    // 可作为 DSL 的**语义参考**（校验闸门复用），但最终入库的 SVG 必须是 DSL 产出的。
    // 若 JSON 通道直接判定 no_figure / content_mismatch（确定性结论），不进入 DSL。
    const forceDsl = process.env.GEOMETRY_FORCE_DSL !== '0'
    const hasDerived = hasDerivedPoints(structure)
    const correctionFailed = hasDerived && structure.solved?.skipped
    const shouldTryDsl = forceDsl || correctionFailed

    if (shouldTryDsl) {
      console.log(
        `   [几何Worker] ${shortId}: 尝试 DSL 通道（${forceDsl ? '强制启用' : '求解器修正失败'}）`
      )
      try {
        // ⚠️ 2026-09-18 修复两处致命接线错误（此前 DSL 闭环在生产从未真正跑通，
        // 所有图都走了 JSON 目测通道 → 形态与原图不一致，用户实测截图实锤）：
        //   1. correctDslByVision 期望 originalImageDataUrl（data URL 字符串），
        //      此前误传 imageBuffer（Buffer）→ 原图从未进入对照图；
        //   2. callVision 回调收到的是 { imageDataURL, userText, systemPrompt }，
        //      此前解构 { imageBuffer } → undefined.toString() 必抛 TypeError。
        const dslResult = await correctDslByVision({
          content: [asset.parent_stem, content].filter(Boolean).join('\n'),
          originalImageDataUrl: `data:image/png;base64,${rawBuffer.toString('base64')}`,
          dsl: null, // 从零生成
          callVision: async ({ imageDataURL, userText, systemPrompt }) => {
            if (!imageDataURL) throw new Error('视觉闭环未收到对照图（imageDataURL 为空）')
            // ⚠️ 限流/过载必须在这层吸收掉：DSL 闭环一轮失败会直接上抛到 handleRetry，
            //    消耗 3 次预算后永久标 'none'（静默回退裁剪原图）。429 是常态噪声，不是"不可重绘"。
            const visionRes = await withProviderRetry(
              () => callVisionCompletion({
                imageDataURL,
                systemPrompt,
                userText,
                temperature: 0.1,
                maxTokens: 3072,
                preferredVendor: GEOMETRY_VISION_VENDOR
              }),
              { onWait: ({ kind, attempt, waitMs }) => console.warn(`   ⏳ [几何Worker] ${shortId}: DSL 视觉 ${kind} 第 ${attempt} 次，等待 ${Math.round(waitMs / 1000)}s`) }
            )
            return visionRes.content
          },
          maxRounds: 3
        })

        if (dslResult.ok) {
          // ⚠️ 2026-09-18：必须直接用 correctDslByVision 返回的 structure——
          // 它已经过 normalizeStructure，且是模型**看过渲染对照图后确认 OK** 的那一版。
          // 此前这里误用 executeDsl(dslResult.dsl) 二次执行拿到**未 normalize** 的
          // 原始结构，导致后续 correctGeometryFigure / structure.points.length
          // 崩溃（"Cannot read properties of undefined (reading 'length')"），
          // 而且 SVG 也可能与"被确认的那版"不一致。闭环验证过的结构才是真值。
          const dslStructure = dslResult.structure
          if (dslStructure && Array.isArray(dslStructure.points) && dslStructure.points.length > 0) {
            structure = dslStructure
            // 重新渲染 SVG：必须与 structure 同源才保证内容闸门/入库用同一张图
            const dslSvg = renderGeometrySvg(structure)
            if (dslSvg) {
              svg = dslSvg
              structure.dsl_source = dslResult.dsl
              structure.dsl_rounds = dslResult.rounds
              // 弱 OK（2026-09-19）：模型卡住但执行合法+过内容闸门时降级成功，
              // 落标记供前端可回退（与 manual_override 同思路）
              if (dslResult.weakOk) structure.dsl_weak_ok = true
              console.log(
                `   [几何Worker] ${shortId}: DSL 通道成功（${dslResult.rounds} 轮${dslResult.weakOk ? '，弱OK降级' : ''}，${structure.points.length} 点 / ${(structure.segments || []).length} 线）`
              )
            } else {
              console.warn(`   ⚠️ [几何Worker] ${shortId}: DSL 结构渲染 SVG 失败，按强制 DSL 规则重试`)
              await handleRetry(asset, 'DSL 强制通道渲染失败')
              return false
            }
          } else {
            // 闭环说 OK 但结构不可用（防御）：不拿目测 JSON 结构凑数，重试
            console.warn(`   ⚠️ [几何Worker] ${shortId}: DSL 闭环 OK 但结构为空，按强制 DSL 规则重试`)
            await handleRetry(asset, 'DSL 闭环 OK 但结构为空')
            return false
          }
        } else {
          // ⭐ 2026-09-18 用户拍板：DSL 闭环未通过时**不得回退到 JSON 目测图**。
          // 但也不一票否决成永久 none —— 模型对同一张图的输出有随机波动
          // （temperature 0.1 下偶发 dsl_unchanged / 未按格式回 OK），单独重跑
          // 常能成功。走 handleRetry（failed + 定时重试），让 watchdog 自动捞起。
          console.log(`   [几何Worker] ${shortId}: DSL 通道未通过（${dslResult.reason}），按强制 DSL 规则重试`)
          await handleRetry(asset, `DSL 强制通道未通过: ${dslResult.reason}`)
          return false
        }
      } catch (dslErr) {
        console.warn(`   ⚠️ [几何Worker] ${shortId}: DSL 通道异常（${dslErr.message}），按强制 DSL 规则重试`)
        await handleRetry(asset, `DSL 强制通道异常: ${dslErr.message}`)
        return false
      }
    }

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

  // 3.5 派生点安全网（放宽旧早退闸后的补偿）
  //
  // 原实现对含派生点（垂足/中点/交点）的结构一律早退 derived_deferred。那道闸是
  // 约束求解器接入之前的临时保护，代价却很大：早退发生在视觉调用**之后**，
  // 额度已经花掉，结果却被整条丢弃。
  //
  // 求解器现已接入，放宽为「求解器验证通过才入库」。但**收敛 ≠ 图可信**——
  // 求解只保证满足「已抽取」的约束；题干某条构造关系若被漏抽，派生点会退化成
  // 自由点，停在模型目测的位置上（实测偏差可达 11px / 400px 画布），
  // 入库等于把一张与题干矛盾的图当干净图展示给学生。
  //
  // 因此两道都必须过：
  //   a. 回灌修正成功（求解收敛 + 残差闸门通过 + 非退化）
  //   b. 每个派生点都被已抽取的约束「确定」（自由度亏损 ≥ 2，见 derivedCoverage.js）
  // 缺任一 → 仍标 none 回退裁剪原图。原图永远是正确的，宁可少显示也不显示错图。
  //
  // ⭐ 2026-09-18 DSL 通道豁免：structure.dsl_source 存在（DSL 闭环成功，模型看过
  // 「原图 || 重绘」对照图且确认 OK）时**跳过本闸**。理由：
  //   1. DSL 通道里派生点（交点/垂足/中点）由执行器用构造命令数学求解，坐标绝对精确，
  //      不是模型目测 —— 本闸防的"退化自由点"在 DSL 通道不存在。
  //   2. 已经有两道更强的验证：执行器保证几何关系、模型目检对照图保证与原图一致，
  //      再叠加「题干文本约束抽取」的第三道闸只会误杀（实测平行线截线题被
  //      solver:no_constraints 拦下，而 DSL 结构 hasDerivedPoints=false、5 线 9 标全对）。
  //   3. 该闸是基于题干正则抽取约束设计的，对 DSL 执行的构造关系天然"漏抽"。
  if (hasDerivedPoints(structure) && !structure.dsl_source) {
    const decision = canPublishDerivedFigure(structure, content, structure.solved)

    if (!decision.ok) {
      console.log(`   [几何Worker] ${shortId}: 派生点未通过安全网（${decision.reason}），回退裁剪原图`)
      await markNotReconstructable(asset, 'derived_deferred', decision.reason)
      return false
    }

    console.log(
      `   [几何Worker] ${shortId}: 派生点 ${decision.points.map(p => p.label).join('/')} 已由求解器确定并回灌`
    )
    structure.derived_readiness = {
      points: decision.points,
      nConstraints: decision.nConstraints,
      dropped: decision.dropped
    }
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

    // 6. 发布图片 URL（clean_geometry_image_url）—— 周末课件取图读的正是这一列
    await publishCleanUrlFor(asset.question_id, svg, shortId)

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
  derived_deferred: '含派生点（垂足/中点/交点），求解器未能确定其位置，回退裁剪原图',
  content_mismatch: '重绘结构与题干引用不符（多画/漏画），回退裁剪原图',
  non_geometry_figure: '图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片'
}

/**
 * 作废**历史上已发布**的干净图产物，让前端彻底回退到原卷裁片。
 *
 * 为什么必须有这一步（2026-09-21 老师报障第 90 题）：判据是**后来才加的**，而已经上线的
 * 重绘图不会自己消失。worker 这次判出「不该重绘」后只写了 tikz_status/last_error，
 * `clean_geometry_svg` / `clean_geometry_image_url` 原样留着 ⇒ 前端（白板读
 * `clean_geometry_image_url`、PC 复核页读 `clean_geometry_svg`）**照旧显示那张错的图**。
 * 实测 `3f6abe05`：流程图框内的中文说明文字全被吃掉，线上只剩一个空框。
 *
 * ⚠️ 不能复用 `updateQuestionAssetCleanData` —— 它的 SQL 是 `COALESCE($2, col)`，
 * 传 null 等于"不改"，清不掉。必须裸 SQL。
 */
async function retractPublishedCleanFigure(questionId, reason, label = NOT_RECONSTRUCTABLE.non_geometry_figure) {
  if (!questionId) return
  const detail = String(reason || '').replace(/\s+/g, ' ').slice(0, 200)
  const relErr = `${label}（已作废旧重绘产物）: ${detail}`
  await query(
    `UPDATE ${TABLES.QUESTION_ASSETS}
        SET clean_geometry_svg = NULL,
            geometry_structure_json = NULL,
            tikz_code = NULL,
            tikz_json = NULL,
            last_error = $2,
            updated_at = NOW()
      WHERE question_id = $1`,
    [questionId, relErr]
  )
  await query(
    `UPDATE ${TABLES.QUESTIONS}
        SET clean_geometry_svg = NULL,
            clean_geometry_image_url = NULL,
            tikz_svg_url = NULL,
            display_image_type = 'raw',
            updated_at = NOW()
      WHERE id = $1`,
    [questionId]
  )
}

async function markNotReconstructable(asset, reason, detail) {
  // ⚠️ 2026-09-21 beda2c3d：结构闸拒稿时必须**同时作废历史上已发布的干净图**。
  // 否则「这次重绘被闸门拒 + 旧的错图仍在线」并存 —— 前端（白板/复核页）读
  // clean_geometry_image_url，老师看到的还是那张错图。与"不该重绘"路径
  // （retractPublishedCleanFigure）是同一个道理；且重绘被重新触发通常意味着
  // 裁片已刷新，旧产物本就过期。宁可回退展示原卷裁片，也不留错图。
  if (asset?.question_id) {
    const label = NOT_RECONSTRUCTABLE[reason] || reason
    await retractPublishedCleanFigure(asset.question_id, detail, label)
  }
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
              q.content, q.parent_stem, q.options
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
              q.content, q.parent_stem, q.options
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