// ⚠️ 必须是第一个 import：本文件在模块级读 process.env
// （HYBRID_VISION_ENABLED / HYBRID_SECOND_VENDOR / CONFIDENCE_THRESHOLD），
// dotenv 写在模块体里会来不及。详见 loadEnv.js 顶部注释。
import './loadEnv.js'
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 环境变量已由首行 loadEnv.js 加载；此行保留以兼容直接 `node worker.js` 的历史用法。
dotenv.config({ path: resolve(__dirname, '.env') })

import crypto from 'crypto'
import axios from 'axios'
import sharp from 'sharp'
import { TABLES, TASK_STATUS } from './config/neon.js'
import { query } from './config/neon.js'
import { AI_CONFIG, getAIHeaders, buildOCRPrompt, buildAnswerGenerationPrompt, getCurrentTextModel, getCurrentVLModel, rotateTextModel, rotateVLModel, TEXT_MODELS, VL_MODELS, callTextCompletion, callVisionCompletion, callVendorVisionCompletion, callAnswerEngineCompletion, ANSWER_ENGINE, ANSWER_QUALITY, isDegradedAnswerEngine } from './config/ai.js'
import { updateTaskStatus, createQuestions, batchUpdateQuestionTags, addWrongQuestions, createJudgement, updateQuestionAnswer, markAnswerException, markAiAnswerRisk, findCachedQuestionByFingerprint, cacheQuestion, incrementQuestionUseCount, updateQuestionCacheId, createQuestionAsset, updateQuestionDenormalizedSvg, lookupWorksheetAnswer, getWorksheetAnswersBySection, deleteQuestionsByTaskId, bulkLookupResourceAnswers, getResourceAnswersBySection, getResourceById, addSelfContainedWrongQuestion } from './services/neonService.js'
import { uploadImage } from './services/ossService.js'
import { enhanceAndUploadFigure } from './services/figureEnhanceService.js'
// cropAndUploadQuestionRegion 已于 2026-09-21 下线（整题裁片下线），不再 import。
// 函数本体仍保留在 utils/cropAndUpload.js（历史调用方/脚本可能需要），本管线不再调用。
import { refineFigureBoxOnPage } from './utils/figureRegionRefiner.js'
import { generateTextFingerprint, generatePHash, PARSER_VERSION, TEXT_SIMILARITY_THRESHOLD } from './utils/questionFingerprint.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { judgeAnswer, normalizeQuestionType, normalizeChoiceAnswer, extractChoiceLetters, isGradingCommentAnswer, stripAnswerScaffolding, detectUnverifiableReference, detectReferenceMismatch, UNJUDGED_REASONS } from './services/judgeService.js'
import { aiJudgeAnswer, selectJudgeCandidates, AI_JUDGE_ENABLED } from './services/aiJudgeService.js'
import { normalizeSectionName, splitSubAnswers, splitOcrQuestionsBySubNo, isSubRowConsistentWithWhole } from './services/answerParseService.js'
import { classifyQuestionLocally } from './utils/localTagger.js'
import { finalizeGradingBatch } from './services/gradingFinalizer.js'
import { classifyLastError } from './pendingTaskRecovery.js'
import { isValidImageBuffer, checkImageResolution } from './utils/imageValidator.js'
import { formatOptionsForPrompt } from './utils/optionText.js'
import { validateArithmeticAnswer } from './utils/arithmeticAnswerValidator.js'
import { aiParseSelfCheck } from './utils/aiParseSelfCheck.js'

/**
 * 写入侧定位框补测（2026-09-20 方案A）：
 * 主 OCR 的 block_coordinates 是模型照抄 prompt schema 示例后平铺整页的占位框
 * （同一页 8 题 y 等差恒 150），不可信。复核页读取侧已有独立测量兜底
 * （POST /api/questions/task/:id/refine-boxes + tasks.result.refinedBoxes 缓存）；
 * 这里把测量前移到【写入侧】：落库前逐页实测并覆盖 block_coordinates，
 * 让入库数据本身可信 —— 复核页打开即显示，不消耗运行时额度。
 *
 * 约束（产品决策，2026-09-20）：
 *   · **只走免费视觉通道**（measurePageQuestionBoxes 的 freeOnly）—— 不碰付费 key；
 *   · 失败静默保留占位框（读取侧闸门照旧拦截，行为不变），绝不阻断批改主流程；
 *   · 按页一次调用（与读取侧同一算法、同一闸门、重试 1 次）。
 *
 * @param {Array<{id:string, page_number?:number|string}>} questions 落库前的题目对象
 * @param {Map<number,Buffer>} pageBuffers pageNumber → 压缩页图 buffer（1920px）
 */
async function refineStoredBlocks ({ questions, pageBuffers }) {
  if (!Array.isArray(questions) || questions.length === 0) return 0
  const byPage = new Map()
  for (const q of questions) {
    const p = Number(q.page_number || 1)
    if (!byPage.has(p)) byPage.set(p, [])
    byPage.get(p).push(q)
  }
  let updated = 0
  // [2026-09-20] 魔搭耗尽日免费白名单通道质量不稳定（实测返回整页共用一带被闸门拦截）。
  // 连续失败就整体放弃，避免每页空等几十秒走弱通道 —— 反正读取侧会兜底。
  let consecutiveFail = 0
  for (const [page, qs] of byPage) {
    if (consecutiveFail >= 2) {
      console.warn(`   [写入侧框] 连续 ${consecutiveFail} 页补测失败，本次整体放弃（保留占位框，读取侧兜底）`)
      break
    }
    const buf = pageBuffers.get(page)
    if (!buf) continue
    try {
      const { measurePageQuestionBoxes } = await import('./services/questionBoxMeasure.js')
      const { boxes, error } = await measurePageQuestionBoxes({ imageBuffer: buf, questions: qs, freeOnly: true })
      if (error) {
        console.warn(`   [写入侧框] 第 ${page} 页补测失败：${error}（保留占位框，读取侧兜底）`)
        consecutiveFail++
        continue
      }
      let n = 0
      for (const q of qs) {
        const b = boxes[q.id]
        if (b) { q.block_coordinates = b; n++ }
      }
      updated += n
      consecutiveFail = 0
      console.log(`   [写入侧框] 第 ${page} 页补测写回 ${n}/${qs.length} 题${n < qs.length ? `（缺 ${qs.length - n} 题，读取侧兜底）` : ''}`)
    } catch (e) {
      console.warn(`   [写入侧框] 第 ${page} 页补测异常：${e.message}（保留占位框，读取侧兜底）`)
      consecutiveFail++
    }
  }
  return updated
}
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from './utils/aiParseSelfCheck.js'
import { rescueReferenceAnswer } from './utils/referenceAnswerRescue.js'
import { describeReferenceAnswerRisk } from './utils/referenceAnswerSelfCheck.js'
import { voteAnswers, describeConsensus, answersEquivalent } from './utils/answerConsensus.js'
import { coerceAIText } from './utils/aiTextCoerce.js'
import { looksLikeLostParentStem } from './utils/parentStemTrust.js'
import { computeTaskStats } from './utils/taskStats.js'
// 卷面标题 → 任务名的唯一口径（校名页眉剥离）。详见 utils/taskTitle.js 头注释。
import { deriveTaskTitle, isAutoTaskName } from './utils/taskTitle.js'
import { rationalizeAnswer } from './utils/radicalSimplify.js'
import { resolveEffectiveQuestionType, hasFigureReference, checkQuestionCompleteness } from './utils/questionCompleteness.js'
// 配图裁剪编排 + 配图框归属判据（2026-09-21 从本文件抽出，与练习册管线共用同一份实现）。
// 详见 utils/geometryCrop.js / utils/figureBoxTrust.js 头部注释。
import { cropGeometryFigures } from './utils/geometryCrop.js'
// is_complete 反范式列回写：入册前必须把缓存列对齐到 checkQuestionCompleteness 的动态真值。
// 练习册自包含错题走 addSelfContainedWrongQuestion（无此逻辑），故在此显式调用。
import { syncQuestionCompleteness } from './services/questionCompletenessSync.js'
// 几何重画入队闸门：数轴 / 函数图象题渲染器画不出来，题干没提图的题会诱发幻觉图。
// 判据只此一处（server/utils/geometryFigureGate.js），不要在 worker 里另写一份正则。
import { checkFigureReference, FIGURE_GATE_MESSAGE } from './utils/geometryFigureGate.js'
// 函数图象独立渲染通道：抛物线/二次函数的表达式写在题干里，纯文本解析 + 确定性采样，
// 零视觉调用。渲染器只画得出抛物线本体，题干另有三角形/辅助线时它会拒绝出图（回退裁剪原图）。
import { buildFunctionGraphSvg } from './utils/functionGraph/index.js'
import { renderGeometrySvg } from './utils/geometrySvg.js'
// SVG → 图片 URL 发布通道：函数图象走确定性通道当场出图时，也要回写课件读的那一列
import { publishCleanGeometryUrl } from './utils/geom/cleanGeometryUrl.js'
// 重练卷排卷与卷面编号的唯一口径（与打印端 wrongRetryPdfService / 前端 pdfGenerator 同源）。
// 判题必须按【卷面顺序】对位，不能用 generated_exams.question_ids 原序 ——
// 2026-09-13 事故：两套顺序不一致导致 21/25 份重练卷判题整体错位。
import { buildRetryPaperOrder, alignRetryAnswers } from './utils/retryPaperOrder.js'

// ── 多模态切题引擎：几何图处理 ──
// 使用 Sharp 进行裁剪和图像增强（替代浏览器端的 Canvas/OpenCV）

/**
 * 估算图像倾斜角（投影廓线法）。
 * 对灰度像素在 [-maxDeg, +maxDeg] 内逐档旋转，取「行方向投影方差」最大的角度：
 * 线条图水平对齐时，暗像素会集中到少数几行，行投影方差最大。
 * 纯 JS，无 opencv 依赖；仅用于轻度纠偏（±maxDeg 内）。
 *
 * @param {Buffer} grayRaw - 灰度原始像素 (Uint8, 每像素 1 通道)
 * @param {number} w
 * @param {number} h
 * @param {number} maxDeg - 搜索范围（默认 6°）
 * @param {number} step - 搜索步长（默认 0.5°）
 * @returns {number} 建议旋转角度（度）
 */
function estimateSkewAngle(grayRaw, w, h, maxDeg = 6, step = 0.5) {
  const DARK = 160 // 低于此灰度算「暗像素」（线条/笔迹）
  const cx = w / 2, cy = h / 2
  let bestAngle = 0
  let bestScore = -1

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const rowDark = new Float64Array(h)
    const sx = w > 400 ? 2 : 1 // 大图跳采提速
    const sy = h > 400 ? 2 : 1
    for (let y = 0; y < h; y += sy) {
      const dy = y - cy
      for (let x = 0; x < w; x += sx) {
        if (grayRaw[y * w + x] >= DARK) continue
        const dx = x - cx
        const ry = Math.round(cy + dx * sin + dy * cos)
        if (ry >= 0 && ry < h) rowDark[ry] += 1
      }
    }
    let mean = 0
    for (let i = 0; i < h; i++) mean += rowDark[i]
    mean /= h
    let variance = 0
    for (let i = 0; i < h; i++) {
      const d = rowDark[i] - mean
      variance += d * d
    }
    if (variance > bestScore) {
      bestScore = variance
      bestAngle = deg
    }
  }
  return bestAngle
}

/**
 * 估算局部纸张背景（低频亮度场）。
 * 粗网格均值池化（block 平均）+ 最近邻上采样：抹掉细几何线条，
 * 只保留纸面亮度 + 拍摄阴影的大尺度渐变，作为每个像素的"白底"基准。
 * 最近邻 + 均值池化不会像插值那样把阴影极值压向中灰，阴影归一化才准确。
 *
 * @param {Uint8Array} grayRaw 灰度原始像素
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
export function estimatePaperBackground(grayRaw, w, h) {
  const GRID = 32 // 背景网格分辨率（cell 越大越宽容线条，越平滑阴影）
  const cw = Math.ceil(w / GRID)
  const ch = Math.ceil(h / GRID)
  const gw = Math.ceil(w / cw)
  const gh = Math.ceil(h / ch)
  const grid = new Float32Array(gw * gh)
  const cnt = new Int32Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const gy = (y / ch) | 0
    for (let x = 0; x < w; x++) {
      const gx = (x / cw) | 0
      const gi = gy * gw + gx
      grid[gi] += grayRaw[y * w + x]
      cnt[gi] += 1
    }
  }
  const bg = new Uint8Array(w * h)
  const lastGx = gw - 1, lastGy = gh - 1
  for (let y = 0; y < h; y++) {
    const gy = Math.min((y / ch) | 0, lastGy)
    for (let x = 0; x < w; x++) {
      const gx = Math.min((x / cw) | 0, lastGx)
      const gi = gy * gw + gx
      bg[y * w + x] = cnt[gi] ? Math.round(grid[gi] / cnt[gi]) : 255
    }
  }
  return bg
}

/**
 * 去除孤立椒盐噪点（保边）：仅当某像素是 3x3 邻域内的"极端离群点"
 * （与全部 8 个邻居都明显不同）时才视为噪点并替换为邻域中值。
 * 连通的几何线条像素至少与某个邻居同色，不会被判定为离群 → 细线完整保留；
 * 而单点噪点（死点/扫描噪点）因四周皆异色而被抹除。
 * 边缘像素直接拷贝。
 *
 * @param {Uint8Array} src 单通道灰度
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
function removeIsolatedSpecks(src, w, h) {
  const T = 40 // 与邻居差异超过此值才视为离群噪点
  const dst = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dst[i] = src[i]
        continue
      }
      const v = src[i]
      const nb = [
        src[i - w - 1], src[i - w], src[i - w + 1],
        src[i - 1], src[i + 1],
        src[i + w - 1], src[i + w], src[i + w + 1],
      ]
      let mn = 255, mx = 0
      for (let k = 0; k < 9; k++) { if (nb[k] < mn) mn = nb[k]; if (nb[k] > mx) mx = nb[k] }
      if (v < mn - T || v > mx + T) {
        const sorted = nb.slice().sort((p, q) => p - q)
        dst[i] = sorted[4]
      } else {
        dst[i] = v
      }
    }
  }
  return dst
}

/**
 * 几何图像素级净化（无阈值）：阴影归一化 + 软白底映射。
 *
 * 核心：用局部背景亮度归一化，消除整片阴影；再用软映射把线条平滑推向深色
 * （不硬切 0/255），保留抗锯齿边缘 → 教材插图效果，而非纯黑白 mask。
 *
 *   ratio    = gray / bg            // 纸面≈1，线条<1（阴影区 bg 低，纸面仍归一为≈1）
 *   strength = 1 - ratio            // 0=纸面(白)，1=纯黑线条
 *   out      = 255 - strength^γ * depth   // 软映射，线条最暗≈255-depth（保留灰阶，不死黑）
 *
 * @param {Uint8Array} grayRaw 灰度原始像素
 * @param {Uint8Array} bg 局部背景亮度场（同尺寸）
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array} 净化后的灰度像素（背景≈白，线条平滑深色）
 */
function cleanGeometryPixels(grayRaw, bg, w, h) {
  const lineDepth = 235   // 线条最暗约 255-235 = 20（保留灰阶，避免死黑，教材风）
  const gamma = 0.8       // <1：略微加深细线 / 浅铅笔痕，又不至于过黑
  const out = new Uint8Array(grayRaw.length)
  for (let i = 0; i < grayRaw.length; i++) {
    const b = bg[i] || 1
    const ratio = grayRaw[i] / b
    let strength = 1 - ratio
    if (strength < 0) strength = 0
    else if (strength > 1) strength = 1
    out[i] = Math.round(255 - Math.pow(strength, gamma) * lineDepth)
  }
  return out
}

/**
 * 几何配图净化：自适应背景校正 / 去灰底阴影 / 保边去噪 / 白背景 / 轻度纠偏。
 *
 * 处理链（全部基于 sharp，无 opencv，最终输出非二值 mask，接近教材插图）：
 *   1. 灰度化，取出原始像素
 *   2. 自适应背景估计：大幅降采样→上采样，得到局部纸面+阴影的低频亮度场
 *   3. 3x3 中值保边去噪（去椒盐噪点 / 浅笔迹，保留细线）
 *   4. 阴影归一化 + 软白底映射（按局部背景亮度归一化消除整片阴影；
 *      线条平滑推向深色，不硬切 0/255，保留抗锯齿边缘）
 *   5. 投影廓线法估算倾斜角 → 轻度旋转纠偏（白底填充）
 *   6. trim 去掉纠偏后四周多余白边
 *
 * 失败时返回原 buffer，绝不阻断主流程。
 *
 * @param {Buffer} buffer - 已裁剪的配图 PNG buffer
 * @returns {Promise<Buffer>}
 */
async function cleanGeometryCrop(buffer) {
  try {
    // ── 1. 灰度原始像素 ──
    const { data: grayRaw, info } = await sharp(buffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const w = info.width, h = info.height
    if (!w || !h) throw new Error('空图像')

    // ── 2. 自适应背景估计（局部纸面 + 阴影低频场）──
    const bg = await estimatePaperBackground(grayRaw, w, h)

    // ── 3~4. 去孤立噪点 + 阴影归一化 + 软白底映射（无阈值）──
    const denoised = removeIsolatedSpecks(grayRaw, w, h)
    const clean = cleanGeometryPixels(denoised, bg, w, h)

    // ── 5. 估算倾斜角（用净化后的灰度像素）──
    let angle = 0
    try {
      angle = estimateSkewAngle(clean, w, h)
    } catch (e) {
      console.warn(`   ⚠️ [几何图净化] 倾斜估算失败，跳过纠偏: ${e.message}`)
    }

    // ── 5~6. 轻度纠偏（白底填充）+ trim 去白边 ──
    let img = sharp(clean, { raw: { width: w, height: h, channels: 1 } }).png()
    if (Math.abs(angle) >= 0.5) {
      img = img.rotate(angle, { background: '#ffffff' })
      console.log(`   [几何图净化] 纠偏 ${angle.toFixed(1)}°`)
    }
    const out = await img
      .flatten({ background: '#ffffff' })
      .trim({ threshold: 10 })    // 去掉旋转/裁剪残留的四周白边
      .png()
      .toBuffer()

    return out
  } catch (error) {
    console.warn(`   ⚠️ [几何图净化] 失败，使用未净化图继续: ${error.message}`)
    return buffer
  }
}

/**
 * 裁剪几何图并上传到 OSS
 *
 * 模型给的 bbox 只是"大概在这一块"：并排排版的配图行里它会横向压到隔壁题的图，
 * 纵向拖进图注（"第N题图"）和题干文字。所以先用像素分割把框收紧到单张配图
 * （refineFigureBoxOnPage），收紧后不再需要原来那 20% padding —— 那个 padding
 * 正是把图注和隔壁配图一起圈进来的元凶。
 * 收紧失败说明这块根本不是图形（模型把题干当配图了），此时不给配图：
 * 展示一张纯文字的"配图"比不展示更误导人。FIGURE_REFINE=0 可退回旧行为。
 *
 * @param {Buffer} imageBuffer - 原始试卷图片 buffer
 * @param {Object} bbox - {x, y, width, height}
 * @param {string} studentId - 学生ID
 * @returns {Promise<string|null>} OSS URL 或 null
 */
export async function cropAndUploadGeometryImage(imageBuffer, bbox, studentId, questionId) {
  try {
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null

    const imgW = await getImageWidth(imageBuffer)
    const imgH = await getImageHeight(imageBuffer)

    let left, top, width, height
    let refined = null
    if (process.env.FIGURE_REFINE !== '0') {
      try {
        refined = await refineFigureBoxOnPage(imageBuffer, bbox, estimatePaperBackground)
      } catch (e) {
        console.warn(`  ⚠️ [几何图] 区域收紧异常，回退模型框: ${e.message}`)
      }
      if (!refined) {
        console.log(`   ⚠️ [几何图] ${questionId}: 该区域分不出图形（多为把题干/选项当配图），不给配图`)
        return null
      }
    }

    if (refined) {
      // 收紧结果已含 3% 内边距，直接用
      left = refined.x
      top = refined.y
      width = refined.width
      height = refined.height
    } else {
      // 旧行为：按 bbox 尺寸动态计算 20% padding（小图给 Vision 模型留上下文）
      const padX = Math.round(bbox.width * 0.20)
      const padY = Math.round(bbox.height * 0.20)
      left = Math.max(0, bbox.x - padX)
      top = Math.max(0, bbox.y - padY)
      width = Math.min(bbox.x + bbox.width + padX, imgW) - left
      height = Math.min(bbox.y + bbox.height + padY, imgH) - top
    }

    if (width <= 0 || height <= 0) return null

    // ── 2. 输出图片最小尺寸 800px ──
    // 原始 212x223 对 Vision 模型太小 → 按比例放大至短边 >= 800px
    const MIN_SIZE = 800
    let resizeOpts = null
    if (width < MIN_SIZE || height < MIN_SIZE) {
      const scale = Math.max(MIN_SIZE / width, MIN_SIZE / height)
      const newW = Math.round(width * scale)
      const newH = Math.round(height * scale)
      // 避免放大超大图（上限 2400px）
      if (newW <= 2400 && newH <= 2400) {
        resizeOpts = { width: newW, height: newH }
      }
    }

    // ── 3. 裁剪 + 可选放大 ──
    let pipeline = sharp(imageBuffer).extract({ left, top, width, height })
    if (resizeOpts) {
      pipeline = pipeline.resize(resizeOpts.width, resizeOpts.height, { fit: 'fill' })
    }
    let cropped = await pipeline.png().toBuffer()

    // ── 4. 配图净化：去灰底 / 去浅笔迹 / 白背景 / 轻度纠偏 ──
    // 可用 GEOMETRY_CLEAN=0 关闭（回退到未净化裁剪图）。净化失败内部已兜底返回原图。
    if (process.env.GEOMETRY_CLEAN !== '0') {
      cropped = await cleanGeometryCrop(cropped)
    }

    const outMeta = await sharp(cropped).metadata()
    const outW = outMeta.width || (resizeOpts ? resizeOpts.width : width)
    const outH = outMeta.height || (resizeOpts ? resizeOpts.height : height)

    // 上传到 OSS
    const fileName = `geometry_${studentId}_${questionId}.png`
    const ossUrl = await uploadImage(cropped, fileName, studentId)
    console.log(`   [几何图] 裁剪+净化上传成功: ${width}x${height} → ${outW}x${outH} → ${ossUrl}`)
    return ossUrl
  } catch (error) {
    console.error(`  ⚠️ [几何图] 裁剪上传失败:`, error.message)
    return null
  }
}

async function getImageWidth(buffer) {
  const meta = await sharp(buffer).metadata()
  return meta.width
}

async function getImageHeight(buffer) {
  const meta = await sharp(buffer).metadata()
  return meta.height
}

/**
 * 将 Qwen3-VL 返回的【归一化 0-1000】bbox 换算为目标图片的实际像素坐标。
 *
 * ⚠️ 关键：Qwen3-VL 系列 grounding 输出的坐标是相对整张图片的 0-1000 归一化值，
 * 不是绝对像素（官方基准：绝对像素格式得分 0，1000-base 最可靠）。若直接当像素用，
 * 会把页面底部 (y≈750) 的配图裁到中上部 → 张冠李戴裁到邻题。此处统一换算修正。
 *
 * @param {Object} bbox - {x, y, width, height}，取值 0-1000
 * @param {number} imgW - 目标图片实际宽度(px)
 * @param {number} imgH - 目标图片实际高度(px)
 * @returns {Object|null} 像素坐标 {x, y, width, height}
 */
function denormalizeBbox(bbox, imgW, imgH) {
  if (!bbox || typeof bbox !== 'object') return bbox
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const clamp = (v) => Math.max(0, Math.min(1000, n(v)))
  return {
    ...bbox,
    x: Math.round(clamp(bbox.x) / 1000 * imgW),
    y: Math.round(clamp(bbox.y) / 1000 * imgH),
    width: Math.round(clamp(bbox.width) / 1000 * imgW),
    height: Math.round(clamp(bbox.height) / 1000 * imgH),
  }
}

/**
 * 修正坐标字段的「角点形态」——模型把右下角 (x2, y2) 写进了 width/height。
 *
 * 线上实例一（block_coordinates，20 题的解直角三角形练习页）：
 *   #1 {x:70,y:140,width:730,height:210}  #2 {x:70,y:210,…,height:280}  #3 …height:350
 * 每题的 height 恰好等于下一题的 y，说明模型输出的是 [x1,y1,x2,y2]。
 * 按宽高解读，第 5 题的框就从 y=420 一路拉到 910（大半页），前端题号框会把
 * 相邻题目和网格配图一起圈进来。
 *
 * 线上实例二（image_bbox，「复习七 三角形(2)」）：
 *   #10 {x:620,y:25,width:850,height:150} → 按宽高解读 x+width=1470 早已冲出页面，
 *   按角点解读 (620,25)-(850,150) 恰好精准框住右上角的配图。整页配图全部错位，
 *   前端「配图」显示的是隔壁题的选项文字。
 * 同一次输出里 block_coordinates 可能是规范宽高、image_bbox 却是角点形态，
 * 所以每个字段必须【独立】表决，不能靠 block 的结论推断配图框。
 */
const BOX_SEMANTIC_ACCESSORS = [
  ['block_coordinates', (q) => q?.block_coordinates],
  ['text_bbox', (q) => q?.text_bbox],
  ['image_bbox', (q) => q?.image_bbox],
  ['geometry_image.bbox', (q) => q?.geometry_image?.bbox],
]

/**
 * 单组同名坐标框的角点形态判别与换算，返回被换算的框数。
 *
 * 逐框确定性判据：宽高解读下越界（x+width>1000 或 y+height>1000）在归一化 0-1000
 * 坐标系里不可能成立，而角点解读自洽 → 该框必是 [x1,y1,x2,y2]，无需表决。
 *
 * 整页表决：不越界的框两种解读都成立（如 {x:150,y:150,width:850,height:240}），
 * 单看无法判别，只能借同页其它框的形态。必要条件是本页每个框角点解读都自洽，
 * 触发条件是同页出现了确定性越界框，或按 y 排序后多数相邻框满足
 * height_i ≈ y_(i+1)（角点形态的链式指纹）。条件不足就原样保留，避免改坏正常框。
 */
function normalizeBoxGroup(boxes) {
  if (boxes.length === 0) return 0

  const cornerSelfConsistent = ({ x, y, w, h }) => w - x >= 1 && h - y >= 1
  const certain = boxes.filter(b => cornerSelfConsistent(b) && (b.x + b.w > 1000 || b.y + b.h > 1000))

  let targets = certain
  if (boxes.every(cornerSelfConsistent)) {
    const sorted = [...boxes].sort((a, b) => a.y - b.y)
    let chained = 0
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (Math.abs(sorted[i].h - sorted[i + 1].y) <= 2) chained++
    }
    const pairs = sorted.length - 1
    const chainedForm = pairs >= 3 && chained / pairs >= 0.6
    if (certain.length > 0 || chainedForm) targets = boxes
  }

  for (const { box, x, y, w, h } of targets) {
    box.width = w - x
    box.height = h - y
  }
  return targets.length
}

export function normalizeBlockBoxSemantics(questions) {
  const list = Array.isArray(questions) ? questions : []
  for (const [label, get] of BOX_SEMANTIC_ACCESSORS) {
    const boxes = []
    for (const q of list) {
      let box
      try { box = get(q) } catch { continue }
      if (!box || typeof box !== 'object' || Array.isArray(box)) continue
      const x = Number(box.x), y = Number(box.y), w = Number(box.width), h = Number(box.height)
      if (![x, y, w, h].every(Number.isFinite)) continue
      boxes.push({ box, x, y, w, h })
    }
    const fixed = normalizeBoxGroup(boxes)
    if (fixed > 0) {
      console.warn(`   ⚠️ [bbox] 本页 ${fixed}/${boxes.length} 个 ${label} 为角点形态(x2/y2 写进 width/height)，已换算为宽高`)
    }
  }
  return questions
}

/**
 * 配图框归属判据（isDegenerateFigureBox / clampImageBboxToBlock / inheritSharedStemFigures）
 * 已于 2026-09-21 抽到 `server/utils/figureBoxTrust.js`，供日常管线与练习册管线共用。
 *
 * 抽出的动因：练习册批改管线本次补齐配图能力，需要跑**同一套**判据。
 * 算法抄两份必然漂移（本仓已有 parseBbox 抄三份的前车之鉴）。
 * 此处 re-export 仅维持既有 `import { x } from './worker.js'` 调用方不破。
 */
export { isDegenerateFigureBox, clampImageBboxToBlock, inheritSharedStemFigures } from './utils/figureBoxTrust.js'
export { cropGeometryFigures } from './utils/geometryCrop.js'

// AI 密钥校验
const AI_KEY = AI_CONFIG.API_KEY
if (!AI_KEY) {
  console.error('❌❌❌ [AI Config] AI_API_KEY 未设置！AI 识别将无法工作！')
} else {
  const maskedKey = AI_KEY.substring(0, 6) + '...' + AI_KEY.substring(AI_KEY.length - 4)
  console.log(`🔑 [AI Config] API Key 已加载: ${maskedKey}`)
}
console.log(`🤖 [AI Config] Model: ${AI_CONFIG.MODEL}`)
console.log(`🔗 [AI Config] Endpoint: ${AI_CONFIG.ENDPOINT}`)
// 两段式批改：视觉模型只识别卷面，标准答案/解析交给答案引擎。
// 这一行用于线上确认当前生效的组合，出问题先看这里。
console.log(`🧠 [Answer Engine] ${ANSWER_ENGINE.ENABLED
  ? `启用 → ${ANSWER_ENGINE.VENDOR}:${ANSWER_ENGINE.MODEL}（降级链: ${ANSWER_ENGINE.FALLBACK_MODELS.join(' → ')}，超时 ${ANSWER_ENGINE.TIMEOUT_MS}ms，Key冷却 ${Math.round(ANSWER_ENGINE.KEY_COOLDOWN_MS / 3600000)}h）`
  : '已关闭 → 回退通用文本链路（ANSWER_ENGINE_ENABLED=0）'}`)
{
  const _primarySet = !!process.env.SENSENOVA_API_KEY
  const _extra = process.env.ANSWER_ENGINE_KEYS ? process.env.ANSWER_ENGINE_KEYS.split(',').filter(Boolean).length : 0
  console.log(`🔑 [Answer Engine] Key 池: ${_primarySet ? 1 + _extra : _extra} 把（主 ${ANSWER_ENGINE.VENDOR} Key ${_primarySet ? '已配置' : '未配置'}${_extra ? ` + 额外 ${_extra} 把` : ''}）`)
}
console.log(`👁️  [OCR Answer] mode=${process.env.OCR_ANSWER_MODE === 'legacy' ? 'legacy（视觉模型自行解题）' : 'copy_only（只抄卷面印刷答案，不自行解题）'}`)

const TAG_SYNONYM_MAP = {
  '几何-三角形': '三角形',
  '直角三角形-勾股定理': '勾股定理',
  '方程与不等式-一元二次方程': '一元二次方程',
  '函数-二次函数': '二次函数',
  '函数-一次函数': '一次函数',
  '函数-反比例函数': '反比例函数',
  '抛物线': '二次函数',
  '三角函数-正弦定理': '正弦定理',
  '三角函数-余弦定理': '余弦定理',
  '力学-牛顿第一定律': '牛顿第一定律',
  '力学-牛顿第二定律': '牛顿第二定律',
  '力学-牛顿第三定律': '牛顿第三定律',
  '电学-欧姆定律': '欧姆定律',
  '化学-氧化还原反应': '氧化还原反应',
  '化学-酸碱中和': '酸碱中和',
}

const deduplicateTags = (tags) => {
  if (!Array.isArray(tags)) return ['未分类']
  const normalized = tags
    .map(tag => String(tag).trim())
    .filter(tag => tag.length > 0)
    .map(tag => TAG_SYNONYM_MAP[tag] || tag)
  const seen = new Set()
  const unique = []
  for (const tag of normalized) {
    const lower = tag.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      unique.push(tag)
    }
  }
  return unique.length > 0 ? unique : ['未分类']
}

// 坐标类字段：AI 经常把它们写成畸形结构，需要统一修复成 {x,y,width,height} 对象。
const BBOX_KEYS = 'block_coordinates|text_bbox|image_bbox'
const BBOX_NUM = '-?\\d+(?:\\.\\d+)?'
// 值区域允许「标签: 数字」与「裸数字」任意混排，共 4 个数字。
// ⚠️ 必须写成 4 个独立分组：JS 的重复量词只保留最后一次迭代的捕获值。
// 只允许标签/数字/逗号/冒号/引号出现，因此不可能跨越 } 吃到别的字段。
const BBOX_ITEM = `(?:"?[a-zA-Z_]+"?\\s*:\\s*)?(${BBOX_NUM})`
const BBOX_RE = new RegExp(
  `"(${BBOX_KEYS})"\\s*:\\s*([\\{\\[])?\\s*` +
  `${BBOX_ITEM}\\s*,\\s*${BBOX_ITEM}\\s*,\\s*${BBOX_ITEM}\\s*,\\s*${BBOX_ITEM}` +
  `\\s*([\\}\\]])?`,
  'g'
)

/**
 * JSON 自动修复 — 处理 AI 返回的畸形 JSON
 * 常见问题: 未转义反斜杠(\frac → \\frac)、未转义双引号、字符串内换行、
 *           坐标字段被写成裸元组 (60, 200, 650, 27)、半对象 {"x": 60, 200, 650, 27}
 *           或裸大括号 {60, 200, 650, 27}
 */
export function repairAIJson(jsonStr) {
  // 1) 统一修复坐标字段（block_coordinates / text_bbox / image_bbox）的畸形形态：
  //    A 裸元组     "block_coordinates": 60, 200, 650, 27
  //    B 数组       "block_coordinates": [60, 200, 650, 27]
  //    C 半对象     "block_coordinates": {"x": 60, 200, 650, 27}        ← 线上最高频
  //    C2/C3 部分标签 {"x": 60, "y": 200, 650, 27} / {..., "width": 650, 27}
  //    C4 裸大括号  "block_coordinates": {60, 200, 650, 27}
  //    D 正常对象   {"x":60,"y":200,"width":650,"height":27}            ← 幂等，原样归一
  //
  // ⚠️ 括号必须成对处理：开括号缺失时（模式 A），正则会顺带吃掉「外层对象」的闭合括号，
  //    此时必须把它原样吐回去，否则会破坏 JSON 结构。
  let pre = jsonStr.replace(BBOX_RE, (m, key, opener, x, y, w, h, closer) => {
    const normalized = `"${key}": {"x": ${x}, "y": ${y}, "width": ${w}, "height": ${h}}`
    // 有开括号 → 闭括号属于本字段，已被我们自己的 } 取代，不需要吐回。
    // 无开括号 → 吃到的闭括号属于外层结构，必须归还。
    return opener ? normalized : normalized + (closer || '')
  })

  // 逐字符状态机：只在「字符串内部」做修复，避免破坏结构。
  // 处理三类畸形：
  //   1. 非法反斜杠转义（LaTeX 单反斜杠命令，如 \angle \circ \triangle）→ 双写为 \\
  //   2. 字符串内的裸控制字符（真实换行/回车/制表符）→ 转义为 \n \r \t
  //   3. 字符串内未转义的双引号（后面不是 , } ] : 或结尾）→ 转义为 \"
  // 合法的 JSON 转义（\" \\ \/ \b \f \n \r \t \uXXXX）原样保留。
  let out = ''
  let inString = false

  for (let i = 0; i < pre.length; i++) {
    const ch = pre[i]

    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }

    // ── 字符串内部 ──
    if (ch === '\\') {
      const next = pre[i + 1]
      if (next === '"' || next === '\\' || next === '/') {
        out += ch + next // 无歧义的合法转义，保留
        i++
      } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(pre.substr(i + 2, 4))) {
        out += ch // 合法 \uXXXX
      } else if (next !== undefined && 'bfnrt'.includes(next)) {
        // \b \f \n \r \t 与 LaTeX 命令(\frac \theta \nu \rho \beta \triangle...)开头冲突。
        // 判据：转义字母后若还跟字母 → LaTeX 命令，双写反斜杠；否则视为真正的 JSON 转义。
        const after = pre[i + 2]
        if (after !== undefined && /[a-zA-Z]/.test(after)) {
          out += '\\\\' // LaTeX 单反斜杠命令 → 字面反斜杠
        } else {
          out += ch + next // 真正的 \n \t 等
          i++
        }
      } else {
        out += '\\\\' // 其它非法转义(\a \c \s ...) → 字面反斜杠，双写
      }
    } else if (ch === '"') {
      // 判断这个引号是「真正的闭合引号」还是「字符串内的字面引号」
      const rest = pre.slice(i + 1)
      if (/^\s*[,}\]:]/.test(rest) || /^\s*$/.test(rest)) {
        out += ch
        inString = false
      } else {
        out += '\\"' // 字面引号，转义
      }
    } else if (ch === '\n') {
      out += '\\n'
    } else if (ch === '\r') {
      out += '\\r'
    } else if (ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }

  return out
}

/**
 * 截断 JSON 抢救 — AI 响应被 max_tokens 截断时，保住已经收到的完整元素。
 *
 * 旧做法是「补一个引号 + 补齐所有缺失的括号」，但截断点常落在半个键名或半个数字上，
 * 补括号只会得到另一种畸形；即使补成功，最后那道题也是字段残缺的。
 * 这里改为回退到「最后一个完整闭合的嵌套值」之后再收口，
 * 于是 15 道题截断在第 12 道时，前 11 道能正常入库，而不是整页丢掉。
 *
 * 只在括号闭合处切，不在逗号/字符串结束处切 —— 后者可能停在
 * 「有键无值」（{"a":1,"content"）上，反而制造新的畸形。
 * 纯函数，导出供单测。
 */
export function salvageTruncatedJson(jsonStr) {
  const stack = []
  let inString = false
  let escaped = false
  let cutAt = -1          // 安全切点（不含该下标）
  let cutStack = null     // 切点处仍未闭合的容器

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      // 刚闭合了一个嵌套值，且它仍处于某个父容器内 → 这里可以安全收口
      if (stack.length) {
        cutAt = i + 1
        cutStack = [...stack]
      }
    }
  }

  if (cutAt < 0) return null // 一个完整元素都没收到，无从抢救

  let out = jsonStr.slice(0, cutAt).replace(/[\s,]+$/, '')
  for (let i = cutStack.length - 1; i >= 0; i--) {
    out += cutStack[i] === '{' ? '}' : ']'
  }
  return out
}

/**
 * 剥离 AI 回复外层的 markdown 代码围栏。
 *
 * 旧写法 content.match(/```json\n?([\s\S]*?)\n?```/) 要求围栏**成对**出现。
 * 响应被截断时只会有开头的 ```json 而没有收尾的 ```，匹配失败 → 整段原文
 * （含反引号）被丢给 JSON.parse → 报 Unexpected token '`', "```json ...
 * 这种情况 repairAIJson 和 salvageTruncatedJson 都救不了：前者不动结构外的
 * 反引号，后者抢救出来的片段仍带着围栏前缀。
 * 线上实测 30483.jpg 连续 5 次重试都死在这里。
 *
 * 因此改为：成对围栏优先取内容，否则单独剥掉开头/结尾的残缺围栏。
 * 纯函数，导出供单测。
 */
export function stripCodeFence(content) {
  const text = String(content || '').trim()
  const paired = text.match(/```(?:json)?[ \t]*\n?([\s\S]*?)\n?```/)
  let out = paired
    ? paired[1].trim()
    : text
      .replace(/^```(?:json)?[ \t]*\n?/, '')
      .replace(/\n?```[ \t]*$/, '')
      .trim()

  // 前缀寒暄（"好的，识别结果如下："）也要剥掉：从第一个 { 或 [ 开始。
  // 注意只切前缀、不切尾部 —— 截断响应的尾部残缺交给 salvageTruncatedJson 处理，
  // 若在这里贪婪匹配到"最后一个 }"会把已收到的完整题目一起丢掉。
  if (out && !/^[{[]/.test(out)) {
    const firstBrace = out.search(/[{[]/)
    if (firstBrace > 0) out = out.slice(firstBrace).trim()
  }
  return out
}

const deskewImage = async (imageBuffer) => {
  try {
    const metadata = await sharp(imageBuffer).metadata()
    console.log(`   原图信息: ${metadata.width}x${metadata.height}, format=${metadata.format}, orientation=${metadata.orientation || 'none'}`)

    const straightened = await sharp(imageBuffer)
      .rotate()
      .normalize()
      .toBuffer()

    return straightened
  } catch (error) {
    console.error('透视拉直失败，使用原图继续:', error.message)
    return imageBuffer
  }
}

const compressImageBuffer = async (imageBuffer) => {
  try {
    const compressed = await sharp(imageBuffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return compressed
  } catch (error) {
    console.error('图片压缩失败:', error)
    throw new Error('图片压缩失败: ' + error.message)
  }
}

const bufferToBase64 = (buffer) => {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

const downloadImage = async (imageUrl) => {
  try {
    console.log(`   正在下载图片: ${imageUrl.substring(0, 80)}...`)
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    })
    const buf = Buffer.from(response.data)
    console.log(`   图片下载成功: ${buf.length} bytes`)

    // ── 魔数校验：OSS 404 / 403 / 鉴权失败会返回 XML/HTML 错误页（约 3000-4000 bytes），
    //    axios 仍按 2xx/3xx 视为成功，AI 拿去调视觉模型会立即被视觉模型拒掉。
    //    在这里直接拦下，给出明确错误，避免被 AI 误判为"模型问题"反复重试。
    const validation = isValidImageBuffer(buf)
    if (!validation.ok) {
      const head = buf.slice(0, 80).toString('utf8').replace(/[^\x20-\x7E]/g, '?')
      console.error(`   ❌ 下载内容非图片: ${buf.length} bytes, 头80字符="${head}", reason=${validation.reason}`)
      throw new Error(`下载图片失败: 返回内容不是图片（${buf.length} bytes, ${validation.reason}），URL 可能已失效或 OSS 返回了错误页`)
    }

    // ── 分辨率校验：拦截"AI 必失败"的极小图。
    //   3116 bytes 的合法 JPEG 实际像素通常只有 ~80x80，sharp 放大到 1800x1800
    //   并不能"创造"信息（只是把模糊块拉伸），AI 视觉模型（8B/235B/Agnes）看到
    //   后一律说"图片是空白 / Unable to identify"，反复重试只浪费配额 + 刷 429。
    //   在下载层就拦下，给出"请重新上传更清晰的图片"友好提示，
    //   让 NON_RETRYABLE 黑名单把它永久标记为不可重试。
    const resCheck = await checkImageResolution(buf)
    if (!resCheck.ok) {
      const { width, height } = resCheck.resolution || {}
      console.error(`   ❌ 图片分辨率过低: ${width}×${height} < ${resCheck.min}, 文件大小 ${buf.length} bytes`)
      throw new Error(`图片分辨率过低（${width}×${height}），请重新上传更清晰的图片（建议宽度≥1200像素，文件≥100KB）`)
    }

    return buf
  } catch (error) {
    console.error('下载图片失败:', error.message || error)
    throw new Error('下载图片失败: ' + (error.message || '未知错误'))
  }
}

/**
 * Determine the source of the student answer: did the AI find actual
 * handwriting, or did it see a blank line / fill-in placeholder?
 * Returns 'blank' when AI likely saw empty/placeholder, otherwise 'recognized'.
 */
export function determineAnswerSource(rawStudentAnswer) {
  const trimmed = String(rawStudentAnswer || '').trim()
  if (!trimmed || trimmed === '未作答') return 'blank'
  // AI commonly returns "____" for fill-in-blank when it reads the
  // printed blank line instead of actual student handwriting
  const stripped = trimmed.replace(/\s/g, '')
  if (/^_+$/.test(stripped)) return 'blank'
  return 'recognized'
}

/**
 * 批改判定的唯一入口：正误只由「学生答案 vs 参考答案」的确定性比较决定。
 *
 * 卷面上的批改痕迹（红笔勾/叉/半对）不再参与判定，也不再落任何字段：
 *   · 红笔不是教师专属，学生订正同样用红笔，单张照片无法可靠区分笔迹归属；
 *   · 晚托场景下要面对各个学校老师的不同批法，同一个"√"在不同人手里语义不同；
 *   · 卷面痕迹是他人的结论，不是学生的学习事实，把它当判据会污染错题与掌握度。
 * 教师的结论走复核页的「正确 / 错误」按钮（review_status），那是可信的人工入口。
 *
 * 注意：OCR 仍需识别并剔除教师笔迹 —— 那是为了让 student_answer / answer 只包含
 * 学生笔迹与参考答案，属于识别阶段的防污染闸门，与判定无关，不可一并删除。
 */
export function resolveGradingResult({ studentAnswer, answer, questionType }) {
  const judgment = judgeAnswer(studentAnswer, answer, questionType)
  return {
    isCorrect: judgment.isCorrect,
    unjudgedReason: judgment.isCorrect === null
      ? detectUnjudgedReason({ studentAnswer, answer })
      : null
  }
}

/**
 * 判不出来时的原因归类。只在 isCorrect === null 时有意义，纯观测用途。
 *
 * "学生未作答"不在这里出原因 —— 那已经由 answer_source='blank' 表达，
 * 复核页据此显示「未作答」，再叠一条异常原因只会让老师以为系统出错了。
 */
function detectUnjudgedReason({ studentAnswer, answer }) {
  const raw = String(studentAnswer ?? '').trim()
  if (raw === '' || raw === '未作答') return null
  if (String(answer ?? '').trim() === '') return 'no_reference_answer'
  return detectUnverifiableReference(answer)
}

/**
 * 把"判不出来的原因"落库到 questions.answer_exception_reason（复用既有列，不新增字段）。
 *
 * 只处理 is_correct === null 且带原因的题：
 *   · 未作答已由 answer_source='blank' 表达，不在此列；
 *   · 已判出正误的题不写，也不清空既有的答案解析异常（那是另一条链路的观测值）。
 * 失败只记日志：这是观测信息，绝不能反过来打断批改主流程。
 */
const markUnjudgedReasons = async (questions) => {
  const targets = []
  for (const q of questions || []) {
    if (!q?.id || q.is_correct !== null) continue
    const reason = q._unjudged_reason || detectUnjudgedReason({
      studentAnswer: q.student_answer,
      answer: q.answer
    })
    if (reason) targets.push({ q, reason })
  }
  for (const { q, reason } of targets) {
    const reasonText = UNJUDGED_REASONS[reason] || reason
    try {
      await markAnswerException(q.id, reasonText)
      console.log(`  [Unjudged] q=${String(q.id).substring(0, 8)} 判不出 → ${reasonText}`)
    } catch (e) {
      console.error(`  [Unjudged] 原因标注失败 q=${String(q.id).substring(0, 8)}:`, e.message)
    }
  }
  for (const q of questions || []) delete q._unjudged_reason
  return targets.length
}

/**
 * 判题终裁（L3）批量入口：本地规则判不出（is_correct=null）的客观题，并发交给
 * grok-4.5 做等价写法仲裁。选题主口径见 aiJudgeService.selectJudgeCandidates：
 *   学生作答 + 参考答案非空可验证 + choice/fill/judge；解答题/未作答/开放题永不送裁。
 *
 * AI 敢下结论 → 原地改 q.is_correct / q.status / q.confidence（confidence 抬到 0.9，
 * 让错题本的置信度闸放行，避免"判错了却进不了错题本"）；AI 不确定/失败 → 保持原状转人工。
 *
 * persist=true 用于题目已落库的重判链路（每题回写 DB）；落库前链路传 false（默认），
 * 由后续 createQuestions 一并写入。失败只记日志：终裁是增强，绝不打断批改主流程。
 */
const aiJudgeUncertainQuestions = async (questions, { persist = false } = {}) => {
  if (!AI_JUDGE_ENABLED) return 0
  const targets = selectJudgeCandidates(questions)
  if (targets.length === 0) return 0

  console.log(`   [AiJudge] ${targets.length} 道规则判不出的客观题 → grok-4.5 终裁`)
  let judged = 0
  await Promise.allSettled(targets.map(async (q) => {
    try {
      const r = await aiJudgeAnswer({
        questionType: q.question_type,
        studentAnswer: q.student_answer,
        referenceAnswer: q.answer,
      })
      if (r.isCorrect === null) {
        console.log(`   [AiJudge] q=${String(q.id).substring(0, 8)} 终裁不下结论（${r.reason}）→ 维持待人工`)
        return
      }
      q.is_correct = r.isCorrect
      q.status = r.isCorrect ? 'correct' : 'wrong'
      q.confidence = 0.9
      q._ai_judged = true
      delete q._unjudged_reason
      judged += 1
      console.log(`   [AiJudge] q=${String(q.id).substring(0, 8)} 题${q.question_number || ''} → ${r.isCorrect ? '正确' : '错误'}（${r.reason}）`)
      if (persist) {
        await query(
          `UPDATE questions SET is_correct = $1, confidence = $2, updated_at = NOW() WHERE id = $3`,
          [r.isCorrect, 0.9, q.id]
        )
      }
    } catch (e) {
      console.error(`   [AiJudge] q=${String(q.id).substring(0, 8)} 终裁异常 → 维持待人工:`, e.message)
    }
  }))
  console.log(`   [AiJudge] 终裁完成: ${judged}/${targets.length} 题给出结论，其余维持待人工`)
  return judged
}

/**
 * 客观题 + 配图（geometry/chart）→ AI 视觉推理不擅长，建议人工核对参考答案。
 *
 * 与 markUnjudgedReasons 区别：
 *   · markUnjudgedReasons → AI 没给出正误结论（is_correct=null）
 *   · markImageReasoningRisk → AI 给出了正误结论，但参考本身可能不可靠
 *
 * 仅在以下同时满足时触发：
 *   1) 客观题（choice/fill/judge）—— 解答题本来就转人工，不重复提示
 *   2) 配图 image_type 是 'geometry' 或 'chart'  —— 「看图推结论」类
 *   3) AI 已判过（is_correct !== null）  —— 否则落 markUnjudgedReasons 那条链
 *   4) 参考答案非空  —— 无参考是另一回事
 *   5) 学生确实作答  —— 纯未作答不该被这种提示污染
 *
 * 失败只记日志：观测信息，绝不能反过来打断批改主流程。
 */
const IMAGE_RISK_REASON = 'AI 视觉推理不擅长，建议核对参考答案'
const markImageReasoningRisk = async (questions) => {
  const targets = []
  for (const q of questions || []) {
    if (!q?.id) continue
    if (q.is_correct === null || q.is_correct === undefined) continue
    if (!q.answer || !String(q.answer).trim()) continue
    if (q.answer_source === 'blank') continue
    const imageType = String(q.image_type || '').toLowerCase()
    if (imageType !== 'geometry' && imageType !== 'chart') continue
    const qt = String(q.question_type || '').toLowerCase()
    if (!['choice', 'fill', 'judge'].includes(qt)) continue
    targets.push({ q })
  }
  for (const { q } of targets) {
    try {
      await markAiAnswerRisk(q.id, IMAGE_RISK_REASON)
      console.log(`  [ImageRisk] q=${String(q.id).substring(0, 8)} ${q.image_type}/${q.question_type} → ${IMAGE_RISK_REASON}`)
    } catch (e) {
      console.error(`  [ImageRisk] 标注失败 q=${String(q.id).substring(0, 8)}:`, e.message)
    }
  }
  return targets.length
}

// 污染闸（P3）用的保守文本比较：只做「书写形态」归一化（空白 / 括号 / 全角 / 负号），
// 刻意**不做**数学等价归一 —— 2/4 与 1/2、√8 与 2√2 都不算相同。
// 原因：污染判据必须是"一字不差地抄"，放宽到等价会把「学生答对但写法不同」的正常题
// 误判成污染并置空，白白把本来能自动判的题推进人工队列。
export function isSameAnswerText(a, b) {
  const norm = (s) => String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[（）()[\]【】]/g, '')
    .replace(/[−–—ー]/g, '-')
    .replace(/[，、]/g, ',')
    .replace(/[。．]/g, '')
    .trim()
    .toLowerCase()
  const na = norm(a)
  const nb = norm(b)
  return na !== '' && na === nb
}

/**
 * 小问号归一化（与 neonService.createQuestions 的 sub_no 口径保持一致）：
 * AI 可能返回数字 2、字符串 '2' 或 '2 '；统一成去空格字符串，空串/非法值视作无小问。
 */
function normalizeSubNo(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  return s === '' ? null : s
}

// forceModel: 锁定到指定视觉模型。JSON 修复失败时由本函数自己传入下一个模型重试，
//   因为 callVisionCompletion 不传 model 时会按 VL_MODELS 顺序轮询，
//   直接递归重试只会再次命中同一个模型、拿到同样畸形的输出。
const recognizeQuestions = async (imageBase64, taskId, retryCount = 0, forceModel = null, opts = {}) => {
  const prompt = buildOCRPrompt()
  const startTime = Date.now()

  console.log(`   🤖 开始调用 AI 视觉识别 (重试 ${retryCount}/${AI_CONFIG.MAX_RETRIES})...`)
  console.log(`   图片 Base64 长度: ${imageBase64.length} chars`)

  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  try {
    let content
    let usedBackup = false
    let usedVendor = null
    if (opts.prefetchedContent != null) {
      // 双路并发（HYBRID_VISION_ENABLED）合并完结果后，复用本函数做解析 + 闸门 + 落库字段构建，
      // 这里不能再调模型，否则等于白并发一次。
      content = opts.prefetchedContent
      console.log(`   [Hybrid] 使用已合并的识别结果 (${content.length} 字符)，跳过模型调用`)
    } else {
      const activeModel = forceModel || getCurrentVLModel()
      console.log(`   发送请求到: ${AI_CONFIG.ENDPOINT} (model=${activeModel})`)
      // 主 API（ModelScope）→ 配额耗尽(429)时内置回退到备用视觉 API
      const res = await callVisionCompletion({
        imageDataURL: imageUrl,
        systemPrompt: prompt,
        userText: '请识别这张作业图片中的所有题目，并返回JSON格式结果。',
        temperature: 0.3,
        maxTokens: 8192,
        ...(forceModel ? { model: forceModel } : {})
      })
      content = res.content
      usedBackup = res.usedBackup
      usedVendor = res.vendorName || null
    }

    const duration = Date.now() - startTime
    // 打印实际命中的供应商名：否则日志只显示「备用 API」，无法确认新供应商是否真的连上了
    console.log(`   AI 响应耗时: ${duration}ms [供应商=${usedVendor || '未知'}]${usedBackup ? ' (备用)' : ''}`)

    if (!content) throw new Error('AI 返回内容为空')

    console.log(`   AI 原始响应 (前300字): ${content.substring(0, 300)}...`)
    console.log(`   AI 响应总长度: ${content.length} 字符`)

    // 围栏剥离必须容忍"只有开头 ```json、没有收尾 ```"的截断响应，
    // 否则反引号会被当成 JSON 内容，报 Unexpected token '`'（线上 30483 连挂 5 次）
    const jsonStr = stripCodeFence(content)

    let result
    let ocrTruncated = false
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn(`⚠️  AI JSON 解析失败，尝试自动修复...`)
      console.warn(`   原始错误: ${parseError.message}`)

      // ① 先修畸形（坐标半对象、LaTeX 反斜杠、字符串内裸引号/换行）
      const repaired = repairAIJson(jsonStr)
      try {
        result = JSON.parse(repaired)
        console.log(`✅ JSON 自动修复成功！`)
      } catch (repairError) {
        console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
        console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)

        // ② 换模型重试优先于截断抢救。
        // 实测（235B + 本 OCR 提示词，max_tokens=8192）：正常一次响应 11208 字符 /
        // 4601 completion_tokens，finish_reason=stop —— 上限用掉不到 6 成，
        // 所以响应只有 2250 字符就断掉属于偶发（供应商/网络侧），重来一次通常就完整了。
        // 因此绝不能一截断就拿半页结果收工：那会静默丢题。
        // prefetchedContent 模式（双路合并结果）不再换模型重试：
        // 内容是我们自己 JSON.stringify 出来的，重试只会得到同样的结果并白白再打一次模型。
        if (!forceModel && opts.prefetchedContent == null) {
          const nextModel = rotateVLModel()
          if (nextModel) {
            console.warn(`🔄 JSON 修复失败，切换到 ${nextModel} 重试 1 次...`)
            return recognizeQuestions(imageBase64, taskId, retryCount, nextModel)
          }
        }

        // ③ 已经换过模型仍失败 → 抢救已收到的完整题目，避免整页归零
        const salvaged = salvageTruncatedJson(repaired)
        if (salvaged) {
          try {
            result = JSON.parse(salvaged)
            ocrTruncated = true
            console.warn(`⚠️  换模型后仍不可解析，启用截断抢救：末尾不完整题目已丢弃，本页可能缺题`)
          } catch {
            throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
          }
        } else {
          throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
        }
      }
    }

    // 兼容两种返回格式：对象 {"questions": [...]} 或纯数组 [...]
    // 部分模型（如 Qwen3-VL-30B-A3B-Instruct）会直接返回题目数组，而非包裹在 questions 字段里。
    const questionsArray = Array.isArray(result)
      ? result
      : (Array.isArray(result?.questions) ? result.questions : [])
    if (questionsArray.length === 0) {
      console.warn(`⚠️  解析出 0 道题（result 类型: ${Array.isArray(result) ? 'array' : typeof result}，keys: ${result && !Array.isArray(result) ? Object.keys(result).join(',') : 'N/A'}）`)
    }

    normalizeBlockBoxSemantics(questionsArray)

    const questions = questionsArray.map((q, index) => {
      // 模型对多解题会把 student_answer 输出成数组，原样传给 pg 会被序列化成
      // PG 数组字面量 {"x₁ = -1/2","x₂ = 5/2"} 存进 text 列 → 页面乱码 + 判题拿错串比对。
      const rawStudentAnswer = coerceAIText(q.student_answer)
      const answerSource = determineAnswerSource(rawStudentAnswer)
      const aiAnswer = rawStudentAnswer
      const cleanedStudentAnswer = answerSource === 'blank' ? '' : rawStudentAnswer

      // P2 硬闸门：OCR 模型可能把老师红笔批语("计算错误"等)当成标准答案抄进 answer。
      // 这类值不是答案，命中即丢弃置空，交给后续 AI 生成路径从题目本身重解出参考答案。
      let standardAnswer = coerceAIText(q.answer)
      if (isGradingCommentAnswer(standardAnswer, q.question_type)) {
        console.log(`   [P2] 丢弃疑似批改痕迹的OCR答案: "${standardAnswer}" → 转AI重解`)
        standardAnswer = ''
      }

      // P3 污染闸：OCR 模型会把学生手写答案原样抄进 answer 字段。
      // 2026-09-13 实测：魔搭 Qwen3-VL-235B 在 15 题真实作业照上 15/15 命中，
      // 违反 OCR 提示词的「只抄卷面印刷内容」约束。后果极严重 ——
      // judgeAnswer(学生答案, 学生答案) 恒为 true，整卷判对、0 判错（隐形全卷误判）。
      // 判据：归一化后 answer === student_answer 且均非空 → 判为污染并置空，
      // 交给后续缓存 / AI 生成 / 答案库链路重解；都补不上时判题器转人工（安全侧）。
      // 已知代价：卷面确印有参考答案且学生恰好全抄对时会被误置空 → 转人工。
      // 这是刻意选的保守方向：漏判（转人工）远好过全卷假阳性。
      if (standardAnswer && cleanedStudentAnswer
        && isSameAnswerText(standardAnswer, cleanedStudentAnswer)) {
        console.log(`   [P3] 丢弃与学生答案雷同的OCR答案（疑似抄写污染）: "${standardAnswer}" → 转后续答案链路`)
        standardAnswer = ''
      }

      const gradingResult = resolveGradingResult({
        studentAnswer: cleanedStudentAnswer,
        answer: standardAnswer,
        questionType: q.question_type
      })
      const isCorrect = gradingResult.isCorrect
      const status = isCorrect === true ? 'correct' : (isCorrect === false ? 'wrong' : 'pending')

      return {
        id: crypto.randomUUID(),
        task_id: taskId,
        content: coerceAIText(q.content),
        options: q.options || [],
        answer: standardAnswer,
        student_answer: cleanedStudentAnswer,
        ai_answer: aiAnswer,
        answer_source: answerSource,
        is_correct: isCorrect,
        question_type: q.question_type || 'answer',
        subject: q.subject || '数学',
        status: status,
        confidence: q.confidence || 0,
        analysis: coerceAIText(q.analysis),
        block_coordinates: q.block_coordinates || null,
        question_number: q.question_number || null,
        // 多小问大题：OCR schema 必填 sub_no（小问号）与 parent_stem（公共题干原文）。
        // ⚠️ 2026-09-18 血泪：此前这里漏了这两个字段，模型输出被静默丢弃 → 整页拆行后
        //   的小问全部以「无小问号、无公共题干」落库，错题本/白板只显示残句
        //   （如「求证：AD²=AC·BE。」），公共条件彻底丢失。normalizeSubNo /
        //   coerceAIText 与 neonService.createQuestions 的口径保持一致。
        sub_no: normalizeSubNo(q.sub_no),
        parent_stem: coerceAIText(q.parent_stem ?? q.shared_stem) || null,
        text_bbox: q.text_bbox || null,
        image_type: q.image_type || null,
        image_bbox: q.image_bbox || null,
        geometry_image: q.geometry_image || null,
        created_at: new Date().toISOString()
      }
    }) || []

    console.log(`   识别完成: ${questions.length} 道题`)

    // ── 公共题干丢失告警闸（2026-09-20 第19题事故）──────────────────────────
    // 命中说明本次 OCR 极可能把多小问大题的公共题干丢了（多半是降级到了不守 schema 的弱模型）。
    // 只告警不拦截，理由见 looksLikeLostParentStem 注释。
    const lostStemQs = questions.filter(q => looksLikeLostParentStem(q.content, q.parent_stem))
    if (lostStemQs.length) {
      console.warn(`   ⚠️  疑似公共题干丢失 ${lostStemQs.length} 题（${lostStemQs.map(q => `题${q.question_number}`).join('、')}）：`
        + 'content 含多个小问标号但 parent_stem 为空 → 答案引擎会判「缺少条件」、答案留空。'
        + '请核对原卷；若确有公共题干，说明本次识别命中了不守 schema 的弱模型（检查是否发生降级）。')
    }

    // ── 空结果处理：AI 成功但返回 0 题 ──
    // 真实日志里 Qwen3-VL 偶发返回 {"questions": []}（图模糊 / 文档裁切丢内容 / 模型抽风）。
    // 重试一次：若仍为空就切换到下一个 VL 模型再试，最后兜底返回空让上层标"未识别"。
    if (questions.length === 0 && retryCount < AI_CONFIG.MAX_RETRIES && opts.prefetchedContent == null) {
      console.warn(`   ⚠️  本次识别返回 0 道题，准备重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000))
      return recognizeQuestions(imageBase64, taskId, retryCount + 1)
    }
    if (questions.length === 0 && opts.prefetchedContent == null) {
      const nextModel = rotateVLModel()
      if (nextModel) {
        console.warn(`   ⚠️  已达重试上限仍为 0 题，轮换到模型 ${nextModel} 兜底...`)
        return recognizeQuestions(imageBase64, taskId, 0)
      }
      console.error(`   ❌ 所有视觉模型均返回 0 道题`)
    }

    // truncated=true 表示本页是靠截断抢救出来的，可能缺题 —— 上层需记录到任务结果，
    // 否则"少了几道题"对用户是完全静默的。
    // pageTitle：卷面印刷标题，上层用它给任务命名（列表里全是"日常作业"分不清哪份）
    const pageTitle = (!Array.isArray(result) && typeof result?.page_title === 'string')
      ? result.page_title.trim() || null
      : null
    return { success: true, questions, duration, truncated: ocrTruncated, pageTitle }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.response?.data?.message || error.message || '未知错误'
    console.error(`   AI 识别失败: ${errorMessage}`)
    if (error.response) {
      console.error(`   HTTP status: ${error.response.status}`)
      console.error(`   响应体: ${JSON.stringify(error.response.data).substring(0, 300)}`)
    }

    // 配额耗尽 → 此处说明主 API 429 且备用 API 也失败（callVisionCompletion 已尝试回退）。
    // 轮换到下一个 VL 模型供后续任务使用，当前任务返回失败。
    if (error.response?.status === 429) {
      const nextModel = rotateVLModel()
      if (nextModel) {
        console.log(`  模型配额耗尽且备用不可用，下一个任务将使用 ${nextModel}`)
      } else {
        console.error(`  所有视觉模型配额已耗尽，且备用 API 不可用`)
      }
      return {
        success: false,
        error: errorMessage,
        questions: [],
        duration: Date.now() - startTime,
        shouldRetry: false
      }
    }

    // 模型不可用（400/404，或 ModelScope "has no provider supported" / "not found"）
    // → 立即轮换到下一个 VL 模型并在本次任务内重试；轮完所有模型才放弃。
    const status = error.response?.status
    const bodyText = JSON.stringify(error.response?.data || '').toLowerCase()
    const isModelUnavailable =
      (status === 400 || status === 404) &&
      (bodyText.includes('no provider') ||
       bodyText.includes('not found') ||
       bodyText.includes('does not exist') ||
       bodyText.includes('has no provider supported'))

    if (isModelUnavailable) {
      const failedModel = getCurrentVLModel()
      const nextModel = rotateVLModel()
      if (nextModel && nextModel !== failedModel) {
        console.warn(`  ⚠️ 视觉模型 ${failedModel} 当前无可用服务商，切换到 ${nextModel} 并重试...`)
        return recognizeQuestions(imageBase64, taskId, retryCount)
      }
      console.error(`  ❌ 所有视觉模型均无可用服务商，请更新 AI_MODEL / VL_MODELS 配置`)
      return {
        success: false,
        error: `视觉模型不可用: ${errorMessage}`,
        questions: [],
        duration: Date.now() - startTime,
        shouldRetry: false
      }
    }

    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES

    if (shouldRetry) {
      console.log(`   ${retryCount + 1}秒后重试 (${retryCount + 1}/${AI_CONFIG.MAX_RETRIES})...`)
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return recognizeQuestions(imageBase64, taskId, retryCount + 1)
    }

    return {
      success: false,
      error: errorMessage,
      questions: [],
      duration,
      shouldRetry: isNetworkError && retryCount >= AI_CONFIG.MAX_RETRIES
    }
  }
}

// ── 双路并发搭配（HYBRID_VISION_ENABLED=1）──
// 背景（2026-09-13 实测，详见 deliverables/model_hybrid_plan_20260913.md）：
//   魔搭 Qwen3-VL-235B：student_answer 抽得全（15/15）、手写关键符号准，
//     但 answer 字段 15/15 被学生答案污染（→ judgeAnswer 恒 true = 全卷假阳性）、
//     坐标框 0% 严格合规、真图 73–98s。
//   sensenova-6.8-flash-lite：快（40–58s）、严格 JSON 3/3、坐标 15/15 合法、零污染，
//     但漏抽 4/15 学生答案、手写关键符号会丢（Q11 真值 −2√3 → 它输出 2√3）。
//   两者能力正交 → 并发后合并，wall-clock = max(两路) 不增加端到端延迟（实测 80.3s vs 串行 131.6s）。
const HYBRID_VISION_ENABLED = process.env.HYBRID_VISION_ENABLED === '1'
const HYBRID_SECOND_VENDOR = process.env.HYBRID_SECOND_VENDOR || 'Huihuiyun'

// 从模型返回文本解析出结果对象（不落库），用于双路交叉合并。
// 复用生产同款修复链：stripCodeFence → JSON.parse → repairAIJson → salvageTruncatedJson。
function parseResultFromContent(content) {
  if (!content) return null
  const jsonStr = stripCodeFence(content)
  const pick = (r) => (Array.isArray(r) || Array.isArray(r?.questions) ? r : null)
  try { return pick(JSON.parse(jsonStr)) } catch { /* 继续修复 */ }
  let repaired = null
  try {
    repaired = repairAIJson(jsonStr)
    const r = pick(JSON.parse(repaired))
    if (r) return r
  } catch { /* 继续抢救 */ }
  try {
    const salvaged = salvageTruncatedJson(repaired || jsonStr)
    if (!salvaged) return null
    return pick(JSON.parse(salvaged))
  } catch { /* 无法解析 */ }
  return null
}

/**
 * 双路 OCR 结果合并（纯函数，可单测）：以 primary 的结构为主干，用 secondary 补强。
 *   ① 补抽：主干漏抽 student_answer 时用另一路补上（实测补回 4/15）
 *   ② 分歧标记：两路都抽到但不一致 → confidence 归零，走低置信度转人工。
 *      实测这类分歧多为手写关键符号（Q11 真值 −2√3，sensenova 丢负号、魔搭正确），
 *      宁可让人看一眼，也不能默默选一边。
 * 按 question_number 对齐；secondary 中题号缺失/重复的题不参与合并。
 */
export function mergeOcrQuestions(primary, secondary) {
  const secByNo = new Map()
  for (const q of secondary || []) {
    const no = String(q?.question_number ?? '').trim()
    if (no && !secByNo.has(no)) secByNo.set(no, q)
  }
  let filled = 0
  let conflicts = 0
  const conflictDetails = []
  const merged = (primary || []).map((q) => {
    const no = String(q?.question_number ?? '').trim()
    const priStu = String(q?.student_answer ?? '').trim()
    const sec = no ? secByNo.get(no) : null
    const secStu = String(sec?.student_answer ?? '').trim()

    if ((!priStu || priStu === '未作答') && secStu && secStu !== '未作答') {
      filled += 1
      return { ...q, student_answer: secStu }
    }
    if (priStu && secStu && !isSameAnswerText(priStu, secStu)) {
      conflicts += 1
      conflictDetails.push({ question_number: no, primary: priStu, secondary: secStu })
      return { ...q, confidence: 0 }
    }
    return q
  })
  return { merged, filled, conflicts, conflictDetails }
}

// 双路并发识别：魔搭（补抽学生答案）+ 第二供应商（洁净主干），合并后走统一落库链路。
// 任一路失败都不影响另一路 —— 单路结果仍然可用，只是少了交叉补强。
const recognizeQuestionsHybrid = async (imageBase64, taskId) => {
  const startTime = Date.now()
  const prompt = buildOCRPrompt()
  const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
  const userText = '请识别这张作业图片中的所有题目，并返回JSON格式结果。'

  console.log(`   [Hybrid] 双路并发识别：魔搭 + ${HYBRID_SECOND_VENDOR}`)

  // allSettled：一路挂掉不影响另一路。
  // 副路 90s 上限：sensenova 实测 40–58s，留足余量；超时/连不通时 allSettled 捕获后走单路，
  // 且 90s < 魔搭实测 73–98s，不会拖慢整体 wall-clock。
  const [msRun, secRun] = await Promise.allSettled([
    callVisionCompletion({ imageDataURL: imageUrl, systemPrompt: prompt, userText, temperature: 0.3, maxTokens: 8192 }),
    callVendorVisionCompletion({ vendorName: HYBRID_SECOND_VENDOR, systemPrompt: prompt, userText, imageDataURL: imageUrl, temperature: 0.3, maxTokens: 8192, timeout: 90000 }),
  ])

  const msOk = msRun.status === 'fulfilled' && msRun.value?.content
  const secOk = secRun.status === 'fulfilled' && secRun.value?.content
  console.log(`   [Hybrid] 魔搭 ${msOk ? 'OK' : 'FAIL'} / ${HYBRID_SECOND_VENDOR} ${secOk ? 'OK' : 'FAIL'}  wall=${((Date.now() - startTime) / 1000).toFixed(1)}s`)

  const onlyOne = (content) => recognizeQuestions(imageBase64, taskId, 0, null, { prefetchedContent: content })
  if (!msOk && !secOk) {
    console.warn(`   [Hybrid] 两路均失败，回退单路链路（走完整降级链与重试）`)
    return recognizeQuestions(imageBase64, taskId)
  }
  if (msOk && !secOk) return onlyOne(msRun.value.content)
  if (!msOk && secOk) return onlyOne(secRun.value.content)

  const msResult = parseResultFromContent(msRun.value.content)
  const secResult = parseResultFromContent(secRun.value.content)
  const msQ = msResult ? (Array.isArray(msResult) ? msResult : msResult.questions || []) : []
  const secQ = secResult ? (Array.isArray(secResult) ? secResult : secResult.questions || []) : []
  console.log(`   [Hybrid] 题数 魔搭=${msQ.length} / ${HYBRID_SECOND_VENDOR}=${secQ.length}`)

  if (secQ.length === 0) return onlyOne(msRun.value.content)
  if (msQ.length === 0) return onlyOne(secRun.value.content)

  // 主干取题数更全的一路；另一路只用于补抽与分歧检测
  const secIsPrimary = secQ.length >= msQ.length
  const primary = secIsPrimary ? secQ : msQ
  const secondary = secIsPrimary ? msQ : secQ
  const secondaryName = secIsPrimary ? 'modelscope' : HYBRID_SECOND_VENDOR
  const primaryResult = secIsPrimary ? secResult : msResult

  const { merged, filled, conflicts, conflictDetails } = mergeOcrQuestions(primary, secondary)
  for (const c of conflictDetails) {
    console.log(`   [Hybrid] Q${c.question_number} 分歧: 主干="${c.primary}" vs ${secondaryName}="${c.secondary}" → 置信度归零转人工`)
  }

  console.log(`   [Hybrid] 主干=${secIsPrimary ? HYBRID_SECOND_VENDOR : 'modelscope'} 补抽=${filled} 分歧=${conflicts}`)

  const mergedContent = JSON.stringify(
    Array.isArray(primaryResult)
      ? merged
      : { ...primaryResult, questions: merged }
  )
  return recognizeQuestions(imageBase64, taskId, 0, null, { prefetchedContent: mergedContent })
}

// 标签生成已改为本地规则分类（零 LLM / 零 API），治理 429 限流。
// 保留导出签名兼容旧调用方；难度统一 3，留待每日回填任务用 LLM 修正。
export const generateTagsForQuestion = async (questionContent, subject = null) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, tags: ['未分类'], difficulty: null }
  }
  const { tags, difficulty } = classifyQuestionLocally(questionContent, subject)
  return { success: true, tags: deduplicateTags(tags), difficulty }
}

const generateTagsForQuestions = async (questions) => {
  if (!questions || questions.length === 0) return []

  // 纯本地计算，无需 batch / 并发 / 网络
  return questions.map((q) => {
    const content = q.content || ''
    const options = (q.options || []).join('；')
    const fullContent = options ? `${content}\n选项：${options}` : content
    const { tags, difficulty } = classifyQuestionLocally(fullContent, q.subject)
    return { questionId: q.id, tags: deduplicateTags(tags), difficulty }
  })
}

/**
 * Extract the final answer from analysis text.
 * AI sometimes puts wrong/unsimplified value in answer field but analysis text is correct.
 * For choice questions: extracts A/B/C/D letter.
 * For non-choice questions: extracts answer from explicit markers (答案为/答案是/最终答案/正确答案是).
 */
export function extractAnswerFromAnalysis(answer, analysis, options) {
  if (!analysis) return answer

  // ── Choice question patterns (A/B/C/D) ──
  if (options && options.length > 0) {
    // 精确匹配模式（高优先级）
    const precisePatterns = [
      /因此\s*(?:只有|仅)[^.，,]*?正确答案[是为：：]?\s*([A-D])/i,
      /综上所述[^.，,]*?应选\s*([A-D])/i,
      /故选\s*([A-D])\s*(?:项)?[，,.。]?$/m,
      /应选\s*([A-D])\s*选项/i,
    ]

    for (const pattern of precisePatterns) {
      const match = analysis.match(pattern)
      if (match) {
        const extracted = match[1].toUpperCase()
        console.log(`   [AnswerExtraction] 精确匹配: ${extracted}`)
        return extracted
      }
    }

    // 一般匹配模式
    const generalPatterns = [
      /正确答案[是为：：]?\s*([A-D])/i,
      /答案[是为：：]?\s*([A-D])/i,
    ]

    for (const pattern of generalPatterns) {
      const match = analysis.match(pattern)
      if (match) {
        const extracted = match[1].toUpperCase()
        if (extracted !== answer) {
          console.log(`   [AnswerExtraction] 一般匹配: ${extracted} (原: ${answer})`)
          return extracted
        }
      }
    }
  }

  // ── Non-choice / general: extract from explicit answer markers ──
  // 8 条答案标记正则（含 CAP/SEP 模板避小数点误切）与 tail(800) 截断逻辑
  // 都已抽到 utils/aiParseSelfCheck.js 的 extractFinalAnswerFromAnalysis，
  // 这里直接复用，避免两处正则漂移。
  // 行为兼容：原逻辑是"匹配到且与 answer 不同才覆盖"，helper 返回 null 时
  // 走回原 answer，等价于"无标记"分支。
  const extracted = extractFinalAnswerFromAnalysis(analysis)
  if (extracted && extracted !== answer) {
    console.log(`   [AnswerExtraction] 答案标记匹配: ${extracted} (原: ${answer})`)
    return extracted
  }

  return answer
}

function normalizeGeneratedAnswer(question, candidateAnswer) {
  const questionType = normalizeQuestionType(question.question_type, question.options)
  if (questionType !== 'choice') {
    // AI 算到中间形态就收手："圆面积比 3:2 求半径比"给的是 "√3:√2"，
    // 教材要求的最简形式是 "√6:2"。学生写了规范答案反而对不上标准答案，
    // 这个不规范的答案还会沉淀进答案库和讲义。只改写能完整解析且数值自检通过的形态。
    // 注意只作用于 AI 现场生成的答案；答案库/OCR 抄来的印刷答案不经过这里。
    // 先剥掉"答案为""为 …"这类叙述脚手架，再有理化 —— 否则前缀会随答案沉淀进答案库。
    return rationalizeAnswer(stripAnswerScaffolding(candidateAnswer))
  }
  // AI 现场生成的选择题答案常是整句话（"选项 C"、"为选项D"、"sin∠CAB = 3/5，选(B)"）。
  // 严格归一（normalizeChoiceAnswer）对这些返回空串，原样入库就会让"学生选对却判错"，
  // 所以这里用宽松提取，取到字母就只存字母——与答案库里的 "B"/"D" 保持同一形态。
  const candidate = extractChoiceLetters(candidateAnswer)
  return candidate || candidateAnswer
}

/**
 * Generate a single answer for a question via text-only AI call.
 *
 * 2026-09-04 改造：视觉模型（MiniMax / SenseNova 6.8）只负责识别卷面，标准答案与解析
 * 统一由答案引擎（默认 SenseNova 上的 deepseek-v4-pro）基于识别出的题干求解。
 * 依据：12 道复杂题基准 deepseek-v4-pro 12/12 · glm-5.2 9/12 · sensenova-6.8 7/12，
 * 且 DeepSeek token 最省。改造前这里走 callTextCompletion，实际会落到 GMI/MiniMax
 * （GMI_FIRST=1 + TEXT_MODELS 为空），正是计算能力最弱的一环。
 * 回滚：ANSWER_ENGINE_ENABLED=0。
 */

/**
 * 答案是否「可投票」：只有客观题的短答案才有多路比对的意义。
 * 长叙述（主观题、整段解释、含「解得…」的元话语）无法归一化比对，
 * 硬投票只会把噪音变成"分歧"，故直接不投。
 */
function isVotableAnswer(answer) {
  const s = String(answer ?? '').trim()
  if (!s || s.length > 60) return false
  return !isNarrativeAnswer(s)
}

export const generateAnswerForQuestion = async (questionContent, retryCount = 0) => {
  if (!questionContent || !questionContent.trim()) {
    return { success: true, answer: '', analysis: '', source: 'empty-input' }
  }

  const prompt = buildAnswerGenerationPrompt()

  // 一次独立求解：调答案引擎 → 解析 JSON。
  // 多路采样复用同一份实现，保证「首路」与「补采路」走完全相同的 prompt 与解析口径。
  const solveOnce = async () => {
    const { content, provider } = await callAnswerEngineCompletion({
      systemContent: prompt,
      userContent: `请计算以下题目的标准答案：\n\n${questionContent}`,
      temperature: 0.2,
      // 2026-09-21 由 2048 提到 4096：横评（_bench_answer_models_0921）实测
      // deepseek-v4-flash-0731 在「|a|=3,b²=16,ab<0 求 a+b」上思考吃满 2048 上限、
      // 答案被截断成空（out=2048/reasoning=2048）。max_tokens 只是上限，按实际输出计费，
      // 调高不增加成本，但能防住「思考没收敛 → 答案丢失」。
      maxTokens: 4096
    })

    const jsonStr = stripCodeFence(content)

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn(`⚠️  AI JSON 解析失败，尝试自动修复...`)
      console.warn(`   原始错误: ${parseError.message}`)

      // 优先尝试修复截断问题 (Unterminated string / Unexpected end)
      if (parseError.message.includes('Unterminated string') || parseError.message.includes('Unexpected end')) {
        try {
          let truncFixed = jsonStr.replace(/("[^"]*)$/, '$1"')
          const openBraces = (truncFixed.match(/\{/g) || []).length
          const closeBraces = (truncFixed.match(/\}/g) || []).length
          const openBrackets = (truncFixed.match(/\[/g) || []).length
          const closeBrackets = (truncFixed.match(/\]/g) || []).length
          for (let i = 0; i < openBraces - closeBraces; i++) truncFixed += '}'
          for (let i = 0; i < openBrackets - closeBrackets; i++) truncFixed += ']'
          result = JSON.parse(truncFixed)
          console.log(`✅ JSON 截断修复成功！`)
        } catch (truncError) {
          console.warn(`   截断修复失败: ${truncError.message}，尝试 repairAIJson...`)
          const repaired = repairAIJson(jsonStr)
          console.log(`   修复后 JSON (前200字): ${repaired.substring(0, 200)}...`)
          try {
            result = JSON.parse(repaired)
            console.log(`✅ JSON 自动修复成功！`)
          } catch (repairError) {
            console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
            console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)
            throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
          }
        }
      } else {
        const repaired = repairAIJson(jsonStr)
        console.log(`   修复后 JSON (前200字): ${repaired.substring(0, 200)}...`)
        try {
          result = JSON.parse(repaired)
          console.log(`✅ JSON 自动修复成功！`)
        } catch (repairError) {
          console.error(`❌ JSON 自动修复仍然失败: ${repairError.message}`)
          console.error(`   原始 JSON (前500字): ${jsonStr.substring(0, 500)}`)
          throw new Error(`AI 返回的 JSON 格式错误，无法解析。原始错误: ${parseError.message}`)
        }
      }
    }

    return { result, provider }
  }

  try {
    const first = await solveOnce()

    let answer = coerceAIText(first.result.answer)
    let analysis = coerceAIText(first.result.analysis)
    const subject = first.result.subject || null
    const engine = first.provider || 'unknown'

    // ── 多路求解共识（2026-09-21）────────────────────────────────────────────
    // 只在「产出答案的不是主模型」时补采 —— 主模型正常时零额外调用、零额外成本。
    // 依据（server/_probe_answer_stability_0921.mjs 实测）：主供应商 SenseNova 全线
    // rpm 限流后，代码降级到兜底弱模型 Huihuiyun:deepseek-v4-flash，而该模型在
    // **同一道题**上连续 4 次给出 `±5 / ±10 / ±10 / ±10` —— 单次采样等于掷骰子；
    // 对照 Bailian 付费池的 deepseek-v4-pro 同题 3/3 全对。
    // 降级通道才需要投票：多路一致 → 采纳；分歧 → 采纳多数派但必须留痕交人工。
    let consensus = null
    if (ANSWER_QUALITY.CONSENSUS_ENABLED
        && isDegradedAnswerEngine(engine)
        && isVotableAnswer(answer)) {
      const extraCount = Math.max(0, ANSWER_QUALITY.SAMPLES_ON_DEGRADED - 1)
      if (extraCount > 0) {
        // ⚠️ 并发发起 ≠ 并发执行：429 会把全局 AI 信号量压到并发 1，此时三路**串行**，
        //    单题等待从 58–66s 拉到 140–230s（2026-09-21 实测）。这是降级状态下才付的代价，
        //    主模型可用时本分支根本不进。嫌慢用 ANSWER_CONSENSUS=0 关掉。
        const settled = await Promise.allSettled(
          Array.from({ length: extraCount }, () => solveOnce())
        )
        // 每一路连同它的解析一起收好 —— 采纳哪一路的答案，就必须用它那一版的解析。
        // 否则会出现「解析是 A 版、答案是 B 版」这种新的自相矛盾（正是本次事故的形态）。
        const samples = []
        const collect = (r) => {
          const a = coerceAIText(r?.result?.answer)
          if (!a) return
          samples.push({ answer: a, analysis: coerceAIText(r?.result?.analysis) })
        }
        collect(first)
        for (const s of settled) if (s.status === 'fulfilled') collect(s.value)

        consensus = voteAnswers(samples.map(s => s.answer))
        consensus.sampleCount = samples.length
        if (consensus.total >= 2) {
          const tally = consensus.groups.map(g => `${g.answer}×${g.count}`).join(' / ')
          if (consensus.verdict === 'unanimous') {
            console.log(`     多路求解一致（${consensus.total} 路）：${consensus.winner}`)
          } else if (consensus.winner) {
            console.warn(`     多路求解${consensus.verdict === 'majority' ? '多数一致' : '分歧'}（${consensus.total} 路）：${tally} → 采纳 ${consensus.winner}`)
          }
          const winnerSample = samples.find(s => answersEquivalent(s.answer, consensus.winner))
          if (winnerSample) {
            answer = winnerSample.answer
            if (winnerSample.analysis) analysis = winnerSample.analysis
          }
        }
      }
    }

    return {
      success: true,
      answer,
      analysis,
      subject,
      source: 'answer-engine',
      engine,
      consensus
    }
  } catch (error) {
    // 答案引擎内部已按「主模型 → FALLBACK_MODELS → 通用文本链路」逐层降级，
    // 到这里说明整条文本链路都不可用（限流/网络），按原逻辑重试或返回空。
    // 返回空时该题保留 OCR 阶段的答案（若有），没有则转人工复核 —— 不拿猜测值顶上。
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const shouldRetry = isNetworkError && retryCount < AI_CONFIG.MAX_RETRIES
    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return generateAnswerForQuestion(questionContent, retryCount + 1)
    }

    return { success: true, answer: '', analysis: '', source: 'engine-failed', engine: null }
  }
}

/**
 * Check if the AI-generated answer is valid and not abnormal.
 * Returns { isValid: boolean, reason?: string }
 */
export function validateAIAnswer(answer, analysis) {
  if (!answer || answer.trim() === '') {
    return { isValid: false, reason: '答案为空' }
  }
  const trimmed = answer.trim()
  if (trimmed === '待人工补充' || trimmed === '此为主观题，无唯一标准答案' || trimmed === '-') {
    return { isValid: false, reason: 'AI标记需要人工补充' }
  }
  if (analysis && analysis.length < 10 && answer.length > 100) {
    return { isValid: false, reason: '答案过长且解析过短，疑似异常' }
  }
  if (/^[\s_]+$/.test(answer)) {
    return { isValid: false, reason: '答案仅包含空白或下划线' }
  }
  return { isValid: true }
}

/**
 * Save subject to question in DB and update in-memory object.
 * Only updates when current subject is NULL/empty to preserve manual edits.
 */
const saveQuestionSubject = async (q, subject) => {
  if (subject && subject.trim()) {
    q.subject = subject.trim()
    try {
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET subject = $1, updated_at = NOW() WHERE id = $2 AND (subject IS NULL OR subject = '')`,
        [subject.trim(), q.id]
      )
    } catch (err) {
      console.error(`     题目 ${q.id.substring(0, 8)}: 学科更新失败`, err.message)
    }
  }
}

/**
 * Generate reference answers for ALL questions via AI calculation.
 * OCR may confuse student's selected answer with the reference answer,
 * so reference answers should always come from AI calculation based on question content.
 */
const generateMissingAnswers = async (questions, imageBuffer = null, taskId = null) => {
  if (!questions || questions.length === 0) return { updated: 0, total: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }

  const needAnswer = questions.filter(q => true)
  if (needAnswer.length === 0) {
    console.log('   所有题目已有参考答案，跳过生成')
    return { updated: 0, total: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }
  }

  console.log(`   需要生成答案: ${needAnswer.length}/${questions.length} 道题`)

  let phash = null
  if (imageBuffer) {
    try {
      phash = await generatePHash(imageBuffer)
    } catch (err) {
      console.error('   生成感知哈希失败:', err.message)
    }
  }

  // ⚡ 优化：大幅提高并行度。withAiLimit 全局信号量（默认2）已限制 AI 并发数，
  // 因此加大 batch 可让更多题目同时发起指纹查询，消除 for 循环批间等待。
  // 同时移除耗时的 findSimilarQuestion（加载50条+编辑距离计算），直接走 AI 调用。
  const batchSize = Math.min(needAnswer.length, 20)
  let updatedCount = 0
  let emptyCount = 0
  let placeholderCount = 0
  let exceptionCount = 0
  let cacheHitCount = 0
  let cacheMissCount = 0
  // 答案来源观测：记录每题的标准答案实际由谁产出，便于核算准确率与成本。
  // 只记模型/供应商名与计数，不记题目正文、不记 API Key。
  const engineUsage = {}
  const recordEngine = (engine) => {
    if (!engine) return
    engineUsage[engine] = (engineUsage[engine] || 0) + 1
  }

  // 辅助函数：非关键 DB 写入 fire-and-forget，不阻塞主流程
  const fireForget = (fn, label) => {
    fn().catch(err => console.error(`     [fire-forget] ${label}: ${err.message}`))
  }

  const rejectArithmeticMismatch = async (q, analysis, validation) => {
    await updateQuestionAnswer(q.id, '', analysis, true)
    q.answer = ''
    if (analysis) q.analysis = analysis
    exceptionCount++
    await markAnswerException(q.id, validation.reason)
    console.warn(`     题目 ${q.id.substring(0, 8)}: ${validation.reason}，已转人工复核`)
  }

  // 参考答案「叙述型」闸（2026-09-14 错题再测-0911 事故）。
  //
  // 现象：答案引擎的 answer 字段偶尔是元话语——解析里自言自语「所以正确答案应包含10」
  // 被当作答案写进 `questions.answer`，判等层永远对不上（学生答对也判错），
  // 再经 question_cache 题干指纹复用传染给所有同题干的学生。
  // 全库 586 条缓存实测：客观题命中此类 14 条，错题再测-0911 的 `应包含10` 是其一。
  //
  // 口径：客观题（choice/fill/judge）的参考答案必须是可对照的短值。
  //   ① 先尝试 rescueReferenceAnswer 从解析/残句里救回真答案（`应包含10` → `2,3,5,6,7,8,10`）；
  //   ② 救不回来（模型自己都说"选项里没有/待人工"）→ 清空答案 + 转人工，
  //      与 rejectArithmeticMismatch 同一策略：不拿猜测值顶上。
  // 主观题不适用本闸——叙述本身就是答案。
  const isObjectiveForAnswerGate = (q) => !SUBJECTIVE_TYPES.has(String(q?.question_type || '').toLowerCase())

  /** @returns {string|null} 救回后的答案；null = 救不回来（调用方清空转人工） */
  const tryRescueReferenceAnswer = (value, analysis, q) => {
    if (!isObjectiveForAnswerGate(q) || !isNarrativeAnswer(value)) return null
    const rescued = rescueReferenceAnswer(value, analysis)
    if (rescued) {
      console.warn(`     题目 ${q.id.substring(0, 8)}: 参考答案疑似叙述残句，已救回 ${JSON.stringify(String(value).slice(0, 20))} → ${JSON.stringify(rescued.slice(0, 20))}`)
    }
    return rescued
  }

  const rejectNarrativeAnswer = async (q, analysis, value) => {
    await updateQuestionAnswer(q.id, '', analysis, true)
    q.answer = ''
    if (analysis) q.analysis = analysis
    exceptionCount++
    await markAnswerException(q.id, '参考答案不可核对（疑似 AI 自述残句）')
    console.warn(`     题目 ${q.id.substring(0, 8)}: 参考答案疑似叙述残句且救不回来 ${JSON.stringify(String(value).slice(0, 24))}，已清空并转人工复核`)
  }

  // 参考答案「自洽性风险」标注（P0 ③，2026-09-14 错题再测-0911 事故）。
  //
  // 与上面的叙述型闸分工：
  //   · 叙述型闸 → 答案根本不可核对（`应包含10`），**清空 + 转人工**（硬拦）；
  //   · 本闸     → 答案可核对，但解析结论区的算式本身算错、答案正好抄了它的右边
  //                （`a + b = 8 + 3 = 29`），**只标风险不改判定**，由老师定。
  //
  // 为什么只标注不拦：全库 586 条缓存回测，同类判据（"算术自检不通过就拦"）命中 28 条
  // 而只有 1 条是真幻觉，误伤 27 条正确答案（`27 的立方根为 3`、`x³=64 则 x=4`…）。
  // 拦=大面积误伤；标注=老师多看一眼。见 utils/referenceAnswerSelfCheck.js 顶部说明。
  // extraNotes：与「解析结论区算错等式」无关、但同样影响参考答案可信度的证据
  // （多路求解分歧、产出答案的通道发生了降级）。合并成一条写进 ai_answer_risk_reason ——
  // markAiAnswerRisk 是整列覆盖写，分两次调用会互相抹掉，所以必须在这里合并。
  const flagReferenceAnswerRisk = async (q, answer, analysis, extraNotes = []) => {
    const risk = describeReferenceAnswerRisk({ answer, analysis, questionType: q.question_type })
    const text = [risk, ...extraNotes].filter(Boolean).join('；')
    if (!text) return
    await markAiAnswerRisk(q.id, text)   // 内部自带 try/catch，观测信息不打断批改主流程
    console.warn(`     题目 ${q.id.substring(0, 8)}: ${text}`)
  }

  // 参考答案可信度提示：多路分歧 / 通道降级。
  // 缓存命中的题没有 result（答案来自 question_cache，不是本次求解）→ 不产生任何提示。
  const buildAnswerTrustNotes = (result) => {
    if (!result || !result.engine) return []
    const notes = []
    const consensusNote = describeConsensus(result.consensus, { engine: result.engine })
    if (consensusNote) notes.push(consensusNote)
    if (isDegradedAnswerEngine(result.engine)) {
      notes.push(`参考答案由降级通道 ${result.engine} 生成（主模型不可用），建议核对`)
    }
    return notes
  }

  // ⏳ 进度条中间状态：80% 打在这里后会跑这个批次循环，单个 batch 可能耗时分钟级
  // （AI 生成答案 / 缓存回填），期间 result.progress 一直停 80 → 前端"批改中"看着像卡死。
  // 按 batch 完成度把 80→84 拆细，让前端能看到推进。
  // ⚠️ 本函数不持有 job 也没 taskId，只能通过调用方传入的 taskId 走 updateTaskStatus 写库，
  //    绝不能在函数体内引用 job / taskId 的 undefined 全局变量（历史 ReferenceError 根因）。
  const answerTotal = needAnswer.length
  let processedAnswerBatches = 0

  for (let i = 0; i < needAnswer.length; i += batchSize) {
    const batch = needAnswer.slice(i, i + batchSize)
    const promises = batch.map(async (q) => {
      // ⚠️ 2026-09-20 第19题事故：多小问大题的公共条件只存在于 parent_stem
      //   （如「如图，一只蚂蚁从点A沿数轴向右爬行了2个单位长度到达点B，点A表示-√2」），
      //   只喂 q.content 会让答案引擎判「题干缺少条件」→ 前几空留白、界面显示「AI 未判定」。
      //   实测同一道第19题：只喂 content → "待人工补充，待人工补充，-3"（解析明写「缺少关于 m 的条件」）；
      //   拼上 parent_stem → "2-√2，2，-3"，解析完整且与学生答案一致。
      //   拼成完整题干后，答案引擎输入 / validateArithmeticAnswer / 缓存指纹三者口径一致；
      //   无 parent_stem 时（普通单问）结果与原先逐字相同，零回归。
      const content = [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n')
      const options = q.options || []
      const fullContent = options.length > 0 ? `${content}\n选项：${formatOptionsForPrompt(options)}` : content
      const fingerprint = generateTextFingerprint(content, options, q.question_type)

      // 缓存查找
      if (fingerprint) {
        const cached = await findCachedQuestionByFingerprint(fingerprint, PARSER_VERSION)

        if (cached && cached.answer && cached.answer !== '待人工补充' && cached.answer !== '此为主观题，无唯一标准答案') {
          cacheHitCount++
          console.log(`     题目 ${q.id.substring(0, 8)}: ✅ 缓存命中 - 复用AI解析结果`)

          let finalAnswer = extractAnswerFromAnalysis(cached.answer, cached.analysis, q.options)
          finalAnswer = normalizeGeneratedAnswer(q, finalAnswer)
          // 缓存命中的答案也过叙述型闸：历史缓存里就沉了 `应包含10` 这类残句，
          // 直接复用等于把错误一直传染下去。先尝试救回；救不回来则**不复用缓存**，
          // 落到下面重新生成（新答案仍会再过一次闸）。
          const rescuedFromCache = tryRescueReferenceAnswer(finalAnswer, cached.analysis, q)
          if (rescuedFromCache) finalAnswer = rescuedFromCache
          const cacheAnswerStillBad = isObjectiveForAnswerGate(q) && isNarrativeAnswer(finalAnswer)
          if (cacheAnswerStillBad) {
            console.warn(`     题目 ${q.id.substring(0, 8)}: 缓存答案疑似叙述残句且救不回来 ${JSON.stringify(String(finalAnswer).slice(0, 24))}，放弃缓存改用答案引擎`)
          } else {
            const arithmeticValidation = validateArithmeticAnswer(content, finalAnswer)
            if (!arithmeticValidation.isValid) {
              await rejectArithmeticMismatch(q, cached.analysis, arithmeticValidation)
              return
            }
            try {
              await updateQuestionAnswer(q.id, finalAnswer, cached.analysis)
              q.answer = finalAnswer
              if (cached.analysis) q.analysis = cached.analysis
              updatedCount++
              await flagReferenceAnswerRisk(q, finalAnswer, cached.analysis)

              // 非关键写入：fire-and-forget
              if (finalAnswer !== cached.answer) {
                fireForget(() => query(
                  `UPDATE ${TABLES.QUESTION_CACHE} SET answer = $1, updated_at = NOW() WHERE id = $2`,
                  [finalAnswer, cached.id]
                ), `缓存答案同步更新 q=${q.id.substring(0, 8)}`)
              }
              fireForget(() => saveQuestionSubject(q, cached.subject), `学科同步 q=${q.id.substring(0, 8)}`)
              fireForget(() => incrementQuestionUseCount(fingerprint, PARSER_VERSION), `useCount q=${q.id.substring(0, 8)}`)
              q.cache_id = cached.id
              fireForget(() => updateQuestionCacheId(q.id, cached.id), `cacheId q=${q.id.substring(0, 8)}`)
            } catch (err) {
              console.error(`     题目 ${q.id.substring(0, 8)}: 缓存答案写入失败`, err.message)
              exceptionCount++
            }
            return
          }
        } else if (cached) {
          console.log(`     题目 ${q.id.substring(0, 8)}: 缓存命中但答案无效，重新调用AI`)
        }
        // ⚡ 移除了 findSimilarQuestion（逐条编辑距离计算，收益低、开销大），直接走 AI 调用
      }

      cacheMissCount++
      const result = await generateAnswerForQuestion(fullContent)
      recordEngine(result.engine)
      const validation = validateAIAnswer(result.answer, result.analysis)

      if (!validation.isValid) {
        if (result.analysis && result.analysis.trim()) {
          const extractedRaw = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
          // 叙述型残句先救回（`写作0.31818...（或…）` → `0.31818...`）
          const extracted = (isObjectiveForAnswerGate(q) && isNarrativeAnswer(extractedRaw))
            ? tryRescueReferenceAnswer(extractedRaw, result.analysis, q)
            : extractedRaw
          if (extracted && extracted !== '-' && extracted !== result.answer) {
            try {
              const safeExtracted = normalizeGeneratedAnswer(q, extracted)
              await updateQuestionAnswer(q.id, safeExtracted, result.analysis, true)
              q.answer = safeExtracted
              q.analysis = result.analysis
              updatedCount++
              fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
              console.log(`     题目 ${q.id.substring(0, 8)}: 从分析文本提取答案: ${extracted}`)
              return
            } catch (err) {
              console.error(`     题目 ${q.id.substring(0, 8)}: 提取答案写入失败`, err.message)
            }
          }
          // 至少保存分析文本（fire-and-forget）
          fireForget(async () => {
            await query(`UPDATE questions SET analysis = $1, updated_at = NOW() WHERE id = $2`, [result.analysis, q.id])
            await saveQuestionSubject(q, result.subject)
          }, `分析文本保存 q=${q.id.substring(0, 8)}`)
        }
        exceptionCount++
        fireForget(() => markAnswerException(q.id, validation.reason), `异常标记 q=${q.id.substring(0, 8)}`)
        return
      }

      if (result.answer && result.answer !== '待人工补充' && result.answer !== '此为主观题，无唯一标准答案') {
        const oldAnswer = q.answer
        let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
        finalAnswer = normalizeGeneratedAnswer(q, finalAnswer)
        // 叙述型残句：先救回；救不回来才清空转人工
        if (isObjectiveForAnswerGate(q) && isNarrativeAnswer(finalAnswer)) {
          const rescued = tryRescueReferenceAnswer(finalAnswer, result.analysis, q)
          if (rescued) {
            finalAnswer = rescued
          } else {
            await rejectNarrativeAnswer(q, result.analysis, finalAnswer)
            return
          }
        }
        const arithmeticValidation = validateArithmeticAnswer(content, finalAnswer)
        if (!arithmeticValidation.isValid) {
          await rejectArithmeticMismatch(q, result.analysis, arithmeticValidation)
          return
        }
        try {
          await updateQuestionAnswer(q.id, finalAnswer, result.analysis, true)
          q.answer = finalAnswer
          if (result.analysis) q.analysis = result.analysis
          updatedCount++
          console.log(`     题目 ${q.id.substring(0, 8)}: 答案 ${oldAnswer || '(空)'} → ${finalAnswer}`)
          await flagReferenceAnswerRisk(q, finalAnswer, result.analysis, buildAnswerTrustNotes(result))

          // 非关键写入：fire-and-forget
          if (fingerprint) {
            fireForget(async () => {
              const cacheId = await cacheQuestion({
                content: fullContent, options, answer: finalAnswer,
                analysis: result.analysis, question_type: q.question_type,
                subject: q.subject, content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
              if (cacheId) {
                q.cache_id = cacheId
                await updateQuestionCacheId(q.id, cacheId)
              }
            }, `缓存写入 q=${q.id.substring(0, 8)}`)
          }
          fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          fireForget(() => markAnswerException(q.id, '答案写入失败: ' + err.message), `异常标记 q=${q.id.substring(0, 8)}`)
        }
      } else if (result.answer) {
        let finalAnswer = extractAnswerFromAnalysis(result.answer, result.analysis, q.options)
        placeholderCount++
        try {
          await updateQuestionAnswer(q.id, finalAnswer, result.analysis)
          q.answer = finalAnswer
          if (result.analysis) q.analysis = result.analysis
          console.log(`     题目 ${q.id.substring(0, 8)}: ${finalAnswer}`)

          if (fingerprint) {
            fireForget(async () => {
              const cacheId = await cacheQuestion({
                content: fullContent, options, answer: finalAnswer,
                analysis: result.analysis, question_type: q.question_type,
                subject: q.subject, content_type: 'text'
              }, fingerprint, phash, PARSER_VERSION)
              if (cacheId) {
                q.cache_id = cacheId
                await updateQuestionCacheId(q.id, cacheId)
              }
            }, `缓存写入 q=${q.id.substring(0, 8)}`)
          }
          fireForget(() => saveQuestionSubject(q, result.subject), `学科 q=${q.id.substring(0, 8)}`)
        } catch (err) {
          console.error(`     题目 ${q.id.substring(0, 8)}: 答案写入失败`, err.message)
          exceptionCount++
          fireForget(() => markAnswerException(q.id, '答案写入失败: ' + err.message), `异常标记 q=${q.id.substring(0, 8)}`)
        }
      } else {
        emptyCount++
        console.log(`     题目 ${q.id.substring(0, 8)}: AI 无法生成答案（可能需要参考图片）`)
        exceptionCount++
        fireForget(() => markAnswerException(q.id, 'AI无法生成答案'), `异常标记 q=${q.id.substring(0, 8)}`)
      }
    })

    await Promise.allSettled(promises)
    processedAnswerBatches += 1
    if (taskId) {
      const subProgress = answerTotal > 0
        ? 80 + Math.min(4, Math.floor((processedAnswerBatches * batchSize / answerTotal) * 5))
        : 85
      const cappedSub = Math.min(84, subProgress)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: cappedSub }).catch(() => {})
    }
  }

  // 答案来源分布日志：缓存命中的不走模型，未命中的才消耗答案引擎额度。
  console.log(`   [答案来源] 缓存命中 ${cacheHitCount} · 答案引擎生成 ${cacheMissCount} · 异常/未生成 ${exceptionCount}`)
  const engineSummary = Object.entries(engineUsage).map(([name, n]) => `${name}=${n}`).join(', ')
  console.log(`   [答案引擎] ${engineSummary || '本次全部走缓存或未调用'}`)

  return { updated: updatedCount, total: needAnswer.length, empty: emptyCount, placeholder: placeholderCount, exceptions: exceptionCount, cacheHits: cacheHitCount, cacheMisses: cacheMissCount, engineUsage }
}

/**
 * 精简批改管线（错题重练卷）
 *
 * 前置：student 已上传答卷照片，后端已按 generatedExamId 关联 student_id + task_type，
 * 并将该卷题目（含标准答案 / 题型）写入 questions 表。
 *
 * 流程：
 *   1. 下载 + 拉直 + 压缩答卷图片
 *   2. OCR 仅提取每道题的【学生手写答案】（不生成参考答案、不做 AI 作答）
 *   3. 按题号顺序与组卷 question_ids 对齐
 *   4. 对已识别的标准答案做 judgeAnswer → 得到 { isCorrect, confidence }
 *   5. 置信度门禁（>=0.8）且仅客观题可自动判定；低置信度 / 未识别 / 主观题 → 回退人工
 *   6. 全部高置信度 → POST /grade 标记 graded + 推进掌握度；否则整卷保持未批改，
 *      预填结果，老师在「组卷历史」逐题改判后再保存。
 */
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8
// OCR 返回的题型不可信时，回退到题库已存的 question_type
const SUBJECTIVE_TYPES = new Set(['answer', 'essay', 'proof', 'drawing', 'composition'])

// 导出：供离线重跑脚本（_rerun_retry_slim.mjs）绕开共享 Redis 队列直接调用，
// 保证重跑一定走本机修复后的对位逻辑，不被线上旧 worker 抢走。
export const processSlimGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName, generatedExamId } = job.data
  const startTime = Date.now()

  const resolveImageUrl = (raw) => {
    if (typeof raw === 'string') {
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw)
          return parsed.url || parsed.ossPath || ''
        } catch { return raw }
      }
      return raw
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }
  const imageUrl = resolveImageUrl(rawImageUrl)

  const fail = async (msg) => {
    console.error(`💥 [Slim] taskId=${taskId} 失败: ${msg}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: msg, last_error: msg, failedAt: new Date().toISOString() }).catch(() => {})
    throw new Error(msg)
  }

  console.log(`\n🔹 [Slim] 开始精简批改: examId=${generatedExamId}, taskId=${taskId}`)

  try {
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5 })

    // 拉取组卷题目（含存储的标准答案 / 题型 / 题号）
    const examRes = await query(
      `SELECT question_ids FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
      [generatedExamId]
    )
    if (examRes.rows.length === 0) return fail('组卷记录不存在')

    const questionIds = Array.isArray(examRes.rows[0].question_ids)
      ? examRes.rows[0].question_ids
      : (typeof examRes.rows[0].question_ids === 'string'
          ? JSON.parse(examRes.rows[0].question_ids || '[]')
          : [])

    if (questionIds.length === 0) return fail('组卷无题目')

    // 排卷需要 question_number / sub_no / page_number / task_id（题组连排判定）
    const { rows: bankQuestions } = await query(
      `SELECT id, content, answer, analysis, question_type, options,
              question_number, sub_no, page_number, task_id
       FROM ${TABLES.QUESTIONS} WHERE id = ANY($1)`,
      [questionIds]
    )
    // 分块前的相对顺序：与 question_ids 保持一致
    const orderMap = new Map(questionIds.map((id, idx) => [id, idx]))
    const baseOrdered = bankQuestions
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

    // ── 卷面排卷：与打印端同源口径 ──
    // 打印卷按题型分块（一、选择题 → 二、填空题 → 三、解答题），块内保持
    // question_ids 相对顺序，卷面编号 1..N 由此产生。学生是按【卷面编号】作答的，
    // OCR 读到的顺序也是卷面顺序，因此判题必须按 paperOrder 对位 ——
    // 不能拿 question_ids 原序与 OCR 顺序按位置硬对齐（2026-09-13 错位事故根因）。
    const paperOrder = buildRetryPaperOrder(baseOrdered)

    await job.updateProgress(20)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 20 })

    // ── 答卷页图列表 ──
    // [2026-09-13 多页修复] 重练答卷一次上传多页只落 1 行 task（页图在 images JSONB，
    // image_url 仅第 1 页）。旧逻辑只 OCR task.image_url → 第 2 页起的学生答案从未被
    // 识别，卷面按「未作答」处理；若第 2 页有客观题会被误判错（错题再测-0911 实锤：
    // OCR 13 条 / 卷面 17 题，第 14-17 题从未进过识别）。
    // 现在按 images 逐页下载 + OCR，按页序合并后再对位；单页任务行为与从前一致。
    const taskRowRes = await query(
      `SELECT image_url, images FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    ).catch(() => ({ rows: [] }))
    let rawPages = taskRowRes.rows[0]?.images
    if (typeof rawPages === 'string') {
      try { rawPages = JSON.parse(rawPages) } catch { rawPages = null }
    }
    let pageImages
    if (Array.isArray(rawPages) && rawPages.length > 0) {
      pageImages = rawPages.map((img, i) => ({
        pageNumber: Number(img?.page_number) || i + 1,
        imageUrl: resolveImageUrl(img?.image_url) || imageUrl,
      }))
    } else {
      pageImages = imageUrl ? [{ pageNumber: 1, imageUrl }] : []
    }
    if (pageImages.length === 0) return fail('答卷图片缺失（image_url 与 images 均为空）')

    // 逐页：下载 + 拉直 + 压缩 + OCR（仅取学生答案），按页序合并。
    // HYBRID_VISION_ENABLED=1 时走双路并发（魔搭 + 第二供应商）合并识别；
    // 默认关闭，行为与改造前完全一致。
    const ocrQuestions = []
    for (const page of pageImages) {
      let imageBuffer
      try { imageBuffer = await downloadImage(page.imageUrl) }
      catch (e) { return fail(`下载答卷图片失败（第${page.pageNumber}页）: ` + e.message) }

      let straightened
      try { straightened = await deskewImage(imageBuffer) }
      catch { straightened = imageBuffer }
      let compressed
      try { compressed = await compressImageBuffer(straightened) }
      catch (e) { return fail(`图片压缩失败（第${page.pageNumber}页）: ` + e.message) }

      const ocrResult = HYBRID_VISION_ENABLED
        ? await recognizeQuestionsHybrid(bufferToBase64(compressed), taskId)
        : await recognizeQuestions(bufferToBase64(compressed), taskId)
      if (!ocrResult.success) return fail(ocrResult.error || `AI 识别失败（第${page.pageNumber}页）`)

      const pageQs = ocrResult.questions || []
      console.log(`   [Slim] 第${page.pageNumber}页 OCR 识别 ${pageQs.length} 道学生答案`)
      // 每条 OCR 结果带页码：对位明细（retryAlign）据此标注定位框属于哪张答卷图
      for (const oq of pageQs) {
        ocrQuestions.push({ ...oq, _pageNumber: page.pageNumber })
      }
    }
    console.log(`\n🔹 [Slim] ${pageImages.length} 页答卷共 OCR ${ocrQuestions.length} 道学生答案，组卷共 ${paperOrder.length} 题（卷面顺序）`)

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // ── OCR 答案 → 卷面题 对位 ──
    // ① 优先按 OCR 读出的卷面题号（question_number + sub_no）精确匹配卷面编号；
    // ② 题号缺失/未命中时，按卷面顺序依次配给剩余未对位的题（位置兜底）。
    // 这样即便 OCR 漏题、学生跳做，后面的答案也不会整体前移串位。
    const pairs = alignRetryAnswers(paperOrder, ocrQuestions)

    const results = []
    // 对位明细（含答卷图上的定位坐标）：批改页 paper 模式画题框的数据源。
    // 此前 slim 管线把 OCR 坐标整段丢弃，题目行的坐标又属于「原始作业图」，
    // 与重练答卷图不对齐，老师因此看不到任何定位框。
    const alignRecords = []
    let autoCount = 0
    let manualCount = 0
    let orphanOcrCount = 0

    for (const { item, ocr, matchedBy } of pairs) {
      // OCR 多出来的答案（卷面上没有对应的题）：不做判定，避免污染题目行
      if (!item) {
        orphanOcrCount++
        continue
      }
      const stored = item.question
      const studentAnswer = (ocr?.student_answer || '').toString().trim()

      const alignRec = {
        questionId: stored.id,
        label: item.label,
        paperIndex: item.paperIndex,
        matchedBy,
        studentAnswer,
        // 定位框所属答卷页码（旧数据无此字段，前端按第 1 页兼容；
        // matchedBy=none 时 ocr 为空 → null，本来也无框可画）
        pageNumber: ocr?._pageNumber || null,
        text_bbox: ocr?.text_bbox || null,
        image_bbox: ocr?.image_bbox || null,
        block_coordinates: ocr?.block_coordinates || null,
        isCorrect: null,
        confidence: null,
      }
      alignRecords.push(alignRec)

      // ── ① 学生未作答（2026-09-17 P0：提到最前）──────────────────────
      // 终态 blank：不需要参考答案，也不该占老师的待办。
      // 此前这一段排在「主观题」之后，于是**学生根本没写的解答题**落 reason='subjective'
      // 计入 manualCount → 整卷不满足 allAuto → 卷子永远停在待复核、老师被迫进卷点确认。
      // 实测近 45 天 10 份重练答卷 48 道待人工里 17 道（35%）都是这种「空白解答题」。
      // 而且客观题未作答一直走的就是这条 blank 分支 —— P0 只是把这个不对称抹平，
      // blank 的展示与统计口径（未作答终态、不进待办、未作答等同不会）与
      // src/utils/reviewDecision.js 完全一致。
      if (!studentAnswer) {
        results.push({ questionId: stored.id, isCorrect: false, source: 'ocr', confidence: 0, reason: 'blank', studentAnswer: '' })
        alignRec.isCorrect = false
        alignRec.confidence = 0
        autoCount++
        continue
      }

      // ── ② 存储答案为空（OCR 之前未生成）：无法自动判定 ──────────────
      // 各分支都带 studentAnswer：落库时一并回写 questions.student_answer（见下方 UPDATE 循环）。
      if (!stored.answer || !stored.answer.trim()) {
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'no_reference_answer', studentAnswer })
        manualCount++
        continue
      }

      // ── ③ 主观题（解答题/证明题…）：先判等，**只放行「判对」** ────────
      // 2026-09-17 P1（复核减负）：此处原本无条件转人工（reason='subjective'），
      // 等于"有参考答案却没用它判" —— 待人工 48 道里 100% 都出自这一个分支。
      // 现改为先跑一次 judgeAnswer，命中数学等价即自动判对。
      //
      // ⚠️ 只放行 true，判错/判不出仍旧转人工，这个不对称是刻意的：
      //   主观题的参考答案是一整段过程，可能本身有误（AI 现算 / 答案库错位），
      //   而"判对"= 两侧归约后等价，学生确实做对了 ⇒ 代价小；
      //   "判错"若基于错答案 ⇒ 假红叉 + 误入错题本 + 进下一轮重练（一条错答案传染）。
      //   judgeAnswer 内部已对"证明略/见解析/答案不唯一"这类不可核对参考返回 null，
      //   因此这里不需要再叠一层参考形态闸门。
      //   置信度沿用客观题同一门槛：OCR 若没把手写作答读准，宁可交人。
      const qType = (stored.question_type || '').toLowerCase()
      if (SUBJECTIVE_TYPES.has(qType)) {
        const subjectiveJudgment = judgeAnswer(studentAnswer, stored.answer, stored.question_type)
        const subjectiveConfidence = ocr?.confidence != null ? Number(ocr.confidence) : 0
        if (subjectiveJudgment.isCorrect === true && subjectiveConfidence >= CONFIDENCE_THRESHOLD) {
          results.push({ questionId: stored.id, isCorrect: true, source: 'ocr', confidence: subjectiveConfidence, studentAnswer })
          alignRec.isCorrect = true
          alignRec.confidence = subjectiveConfidence
          autoCount++
          continue
        }
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'subjective', studentAnswer })
        manualCount++
        continue
      }

      const judgment = judgeAnswer(studentAnswer, stored.answer, stored.question_type)
      const confidence = ocr?.confidence != null ? Number(ocr.confidence) : 0
      const highConfidence = confidence >= CONFIDENCE_THRESHOLD

      if (!highConfidence) {
        // 低置信度：不自动判定，预填但回退人工确认
        results.push({ questionId: stored.id, isCorrect: null, source: 'manual', reason: 'low_confidence', confidence, studentAnswer })
        alignRec.confidence = confidence
        manualCount++
        continue
      }

      results.push({ questionId: stored.id, isCorrect: judgment.isCorrect, source: 'ocr', confidence, studentAnswer })
      alignRec.isCorrect = judgment.isCorrect
      alignRec.confidence = confidence
      autoCount++
    }

    // 对位质量日志：题号匹配 / 位置兜底 / 未作答 / 孤立答案，便于线上排查「题号对不上」
    const matchedByNumber = alignRecords.filter((r) => r.matchedBy === 'number').length
    const matchedByPosition = alignRecords.filter((r) => r.matchedBy === 'position').length
    const unmatchedPaper = alignRecords.filter((r) => r.matchedBy === 'none').length
    console.log(
      `   [Slim] 卷面对位：卷面 ${paperOrder.length} 题 / OCR ${ocrQuestions.length} 条 → ` +
      `题号匹配 ${matchedByNumber}，位置兜底 ${matchedByPosition}，未作答 ${unmatchedPaper}，孤立答案 ${orphanOcrCount}`
    )
    if (orphanOcrCount > 0) {
      console.warn(`   ⚠️ [Slim] OCR 识别出 ${orphanOcrCount} 条卷面上没有对应题目的答案，已跳过（不参与判定）`)
    }

    // 预填每道题的 is_correct + confidence（供组卷历史查看 / 改判）
    // 2026-09-13：同时回写 questions.student_answer —— 此前只写 is_correct，
    // 批改页「学生答案」展示的仍是这道题进错题本时原作业的旧答案（如卷面答 D 却显示旧答 B），
    // 且人工重判接口按 questions.student_answer 判，旧值会让改判结果错。
    // 对位命中的题一律回写（空串 = 本次未作答），与 is_correct 覆盖语义一致；
    // matchedBy='none' 的题对位记录无答案，同样按未作答回写空串。
    //
    // 2026-09-14 修正 is_correct 的写入语义（错题再测-0911 事故）：
    //   旧实现写 `is_correct = COALESCE($2, is_correct)`——本次判不出的题（主观题 /
    //   缺参考答案 / 低置信度）$2 为 null，COALESCE 就把**原作业的旧判定**留了下来。
    //   而批改页 6 态（src/utils/reviewDecision.js）见 is_correct===false 即显示「AI错误」，
    //   于是「本次根本没判」被显示成「AI错误」，且这批行的 student_answer 已被本次
    //   答卷覆盖 ⇒ 页面上是「新学生答案 + 旧判定」错配。
    //   行的语义是「最新一次批改」：本次没结论就写 null（页面落 6 态 exception/AI未判定），
    //   绝不继承上一次的结论。confidence 仍 COALESCE——它只是 OCR 置信度线索，
    //   缺失时保留旧值可让 6 态落在「AI未判定（有置信度）」，而不是「处理中」。
    //
    // 2026-09-14 修正 answer_source 的写入语义（「明明写了答案却显示未作答」事故）：
    //   旧实现只回写 student_answer/is_correct/confidence，answer_source 留着原作业
    //   批改时的旧值。原作业 OCR 判空过的题带着 answer_source='blank' 进错题本，
    //   重练时学生写了答案、答案也回写了，但旧 blank 标留存 ⇒ 批改页 6 态
    //   （src/utils/reviewDecision.js:74）blank 优先于 is_correct，显示成「未作答」。
    //   与 is_correct 同理，answer_source 也按「行 = 最新一次批改」刷新：
    //   本次答案非空 → recognized，本次真没写 → blank（判空口径与主 OCR 管线
    //   determineAnswerSource 完全同源：空 / '未作答' / 纯下划线）。
    //   blank 时把 student_answer 一并归一为空串，保证「blank ⇔ student_answer 为空」
    //   的展示层不变量成立（与主管线落库行为一致）。
    const prefillFailures = []
    for (const r of results) {
      if (r.isCorrect === null && r.studentAnswer === undefined) continue
      const nextStudentAnswer = r.studentAnswer ?? ''
      const nextAnswerSource = determineAnswerSource(nextStudentAnswer)
      await query(
        `UPDATE ${TABLES.QUESTIONS}
         SET student_answer = $1,
             answer_source = $5,
             is_correct = $2::boolean,
             confidence = COALESCE($3, confidence),
             updated_at = NOW()
         WHERE id = $4`,
        [nextAnswerSource === 'blank' ? '' : nextStudentAnswer, r.isCorrect, r.confidence ?? null, r.questionId, nextAnswerSource]
      ).catch((e) => {
        prefillFailures.push({ questionId: r.questionId, message: e.message })
        console.error(`[Slim] 预填 is_correct/student_answer 失败 q=${r.questionId?.substring(0, 8)}:`, e.message)
      })
    }
    if (prefillFailures.length > 0) {
      // 不静默：本次判定没落库 ⇒ 批改页会显示旧状态（老师会当成"没批改"）或矛盾状态。
      console.error(`   ⚠️ [Slim] ${prefillFailures.length}/${results.length} 题的 is_correct/student_answer 未落库，批改页状态不可信`)
    }

    // 判不出来的题：本管线早就分好了原因（主观题 / 缺参考答案 / 置信度不足），
    // 但此前只留在内存里，老师在复核页只看到"AI未判定"却不知道为什么。
    // 落到 answer_exception_reason（复用既有列），与主 OCR 管线同一套原因词表。
    for (const r of results) {
      if (r.isCorrect !== null || !r.reason) continue
      const reasonText = UNJUDGED_REASONS[r.reason]
      if (!reasonText) continue
      await markAnswerException(r.questionId, reasonText).catch((e) =>
        console.error(`[Slim] 原因标注失败 q=${r.questionId?.substring(0, 8)}:`, e.message)
      )
    }

    await job.updateProgress(90)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

    // ── 结算（2026-09-17 改：与通用作业管线对齐，批完即结算）──────────────
    // 旧实现只在 allAuto（全卷零人工）时才调 /grade ⇒ 一道题转人工就把整卷锁死：
    // exam.status 一直是 ungraded，卷子永远停在「待复核」，家长端也永远出不了结果，
    // 而通用作业管线（worker.js:finalizeGradingBatch）**批改末尾就结算**、不等老师复核。
    //
    // 现在只把「有结论的题」交结算，未判出的题保持 is_correct=null 继续进老师待办：
    //   · 幂等：结算是按 (questionId, settlement_key='generated_exam:{id}:final') 去重的，
    //     重跑/多次调用不会重复推进生命周期；
    //   · 老师之后改判走 PUT /api/questions/:id → finalizeRejudgeResult（**另一把** key），
    //     所以「先结算、后改判」能正常纠正，不会造成假掌握。
    const settledResults = results
      .filter((r) => r.isCorrect !== null)
      .map((r) => ({ questionId: r.questionId, isCorrect: r.isCorrect }))
    const allAuto = manualCount === 0 && autoCount > 0
    if (settledResults.length > 0) {
      const gradePayload = { id: generatedExamId, studentId, results: settledResults }
      // 不能用 .catch() 吞掉：这条调用是「组卷已结算」的唯一落库入口，
      // 失败时若仍打印"已标记 graded"会误导排查（2026-09-14 事故里就是这么掩盖的）。
      try {
        await callGradeEndpoint(gradePayload)
        console.log(
          allAuto
            ? `\n🔹 [Slim] 全自动判定完成：${autoCount} 题，组卷已结算`
            : `\n🔹 [Slim] 部分结算完成：${settledResults.length} 题已出结论（${manualCount} 题待老师确认），组卷已结算`
        )
      } catch (e) {
        console.error(
          `\n🔹 [Slim] 有 ${settledResults.length} 题已判定，但组卷结算失败（卷仍为待复核）:`,
          e.message
        )
      }
    } else {
      // 一道题都没判出来（全主观题/全缺答案）：不结算，等老师逐题改判
      console.log(`\n🔹 [Slim] ${manualCount} 道题全部待人工判定，本卷不结算`)
    }

    await job.updateProgress(100)

    // 统计分桶（2026-09-17 修洞）：旧实现查
    // `questions WHERE task_id = <本答卷任务>` —— 而重练答卷在 questions 表里**没有本卷题行**
    // （题目行是原作业共用行，task_id 指向原作业）⇒ 恒 0 行 ⇒ emptyCount/pendingCount 恒 0，
    // 卡片上的"待处理"因此只能拿整卷题数顶替（GradeCenterWorkbench 旧写法）。
    // 改为按本卷 questionIds 回读刚才预填过的行，再走**同一个** computeTaskStats（四桶口径
    // 与批改页 6 态、PC 列表同源，见 utils/taskStats.js 文件头），不在这里另写一套分桶。
    let correctCount = 0
    let wrongCount = 0
    let emptyCount = 0
    let pendingCount = 0
    try {
      const resultIds = results.map((r) => r.questionId).filter(Boolean)
      const { rows: gradedRows } = resultIds.length
        ? await query(
            `SELECT is_correct, answer_source, review_status, confidence
             FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`,
            [resultIds]
          )
        : { rows: [] }
      const stats = computeTaskStats(gradedRows)
      correctCount = stats.correctCount
      wrongCount = stats.wrongCount
      emptyCount = stats.emptyCount
      pendingCount = stats.pendingCount
    } catch (e) {
      console.error('   [Slim] 统计四桶失败:', e.message)
    }

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: paperOrder.length,
      autoCount,
      manualCount,
      correctCount,
      wrongCount,
      emptyCount,
      pendingCount,
      duration: Date.now() - startTime,
      completedAt: new Date().toISOString(),
      // 重练答卷「题 ↔ 答案 ↔ 定位框」对位明细。tasks.result 是 merge 写入，
      // 追加字段不会影响既有内容（无需改表结构）。
      retryAlign: alignRecords,
      retryAlignMeta: {
        paperCount: paperOrder.length,
        ocrCount: ocrQuestions.length,
        pageCount: pageImages.length,
        matchedByNumber,
        matchedByPosition,
        unmatchedPaper,
        orphanOcrCount,
        // 口径版本：排卷口径若再变，靠它区分历史数据与新数据
        orderVersion: 2,
      },
    })

    return { taskId, examId: generatedExamId, autoCount, manualCount, allAuto }
  } catch (error) {
    const duration = startTime ? Date.now() - startTime : 0
    console.error(`\n💥💥 [Slim] 精简批改失败: taskId=${taskId}, ${error.message}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: error.message, last_error: error.message, failedAt: new Date().toISOString() }).catch(() => {})
    throw error
  }
}

// 调用 /generated-exams/:id/grade（复用组卷批改掌握度进阶逻辑）
const callGradeEndpoint = async ({ id, studentId, results }) => {
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`
  const url = `${base}/api/generated-exams/${id}/grade`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, results })
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

// ── 练习册批改管线 ──
// OCR 只识别题号+学生答案，不从 worksheet 提取参考答案
// 答案从 worksheet_answers 表查找，judgeAnswer 对比判定

/**
 * 选单元（不再选 section）：返回 unitKey，对应"本页 OCR 出的题号应到哪一摞答案里查"。
 *
 * answersByUnit: Map<unitKey, Map<sectionKey, Map<`qNo|subNo`, row>>>，由 getWorksheetAnswersBySection 返回。
 * pageTitle:     OCR 出的本页标题（多半是单元标题，如"堂堂练① 19.1(1) 算术平方根"）。
 * questions:     OCR 出的本页题目 [{question_number, question_type, sub_no?}]
 * pageNumber:    本页在上传图片中的页号（1-based，可选）。提供后，若标题失配可按单元的
 *                answer_page_start~answer_page_end 范围做兜底匹配。
 *
 * 匹配策略：
 *  1) 唯一单元：直接取该单元。
 *  2) 标题归一化后与 unit_title / unit_key 做精确/包含匹配（处理空格、圈序号）。
 *  3) 页码范围兜底：当 1)2) 失配但 pageNumber 在某单元 [start,end] 内，且该单元含本题号，
 *     则取该单元（解决 OCR 抽不到章节标题但题号仍能唯一定位的页）。
 *  4) 兜底按题号覆盖率打分；要求至少 60% 的题号能在该单元下命中（避免错挂）。
 */
// 圈序号 ①..⑳ + 阿拉伯 1..20 双向兼容：OCR 经常把"堂堂练①"识别成"堂堂练1"，
// 反之亦然。此处把两种字符都压成统一的 ASCII 数字后再做"包含/相等"判断，
// "堂堂练①"和"堂堂练1"因此被视作同一单元。最多处理 20，常规练习册不会超过。
const CIRCLED_DIGITS_RE = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g
// 用字符串键而不是裸的圈序号：圈序号不在 JS IdentifierName 允许集中，V8 在某些版本
// 会把 "①:1,②:2,..." 误判为 label 序列并抛 "Invalid or unexpected token"。加引号后稳。
const circledToAsciiMap = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
  '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
}
const normalizeTitleForMatch = (s) => {
  if (!s) return ''
  // 圈序号 → ASCII 数字（"堂堂练①" → "堂堂练1"）
  return String(s)
    .replace(CIRCLED_DIGITS_RE, m => circledToAsciiMap[m] || m)
    // 全角括号 → 半角：OCR 常把印刷体"27.4(1)"读成全角"27.4（1）"，
    // 而答案库 unit_key/unit_title 是半角。不归一化会导致标题/防御1判定失配，
    // 可信标题被当成"OCR 误识别"置空 → 单元匹配失败 → 参考答案空白。
    .replace(/[（）]/g, (p) => (p === '（' ? '(' : ')'))
    .replace(/[\s　]+/g, '') // 空白已经由 normalizeSectionName 压过，此处再兜一次
}

// 内容特征 → 章节关键词：按"特征越具体→匹配越准"排序（命中后立即 return，不继续判）。
// 用于 pageTitle 缺失时根据题目内容（题干 + 学生答案 + 选项）反推章节。
// 关键词命中 unitTitle 或 unitKeyRaw 即视为该章节。
//
// ⚠️ 关键：19 章"实数"包含"平方根/立方根/算术平方根"等概念，绝不能划到 20 章"二次根式"！
// 旧版"二次根式"规则含 "平方根|立方根|根号"，导致 19.1/19.2 章节被误判为 20.x
// （用户截图题 18-20 实为 19.2 实数，被规则误判成"二次根式"，错配到 20.x 系列）。
// "二次根式"严格限定为字面"二次根式"或 √± 形式的多项式根号运算。
const CONTENT_CHAPTER_RULES = [
  { chapter: '一元二次方程', re: /一元二次方程|求根公式|判别式|根与系数|二次三项式/ },
  { chapter: '直角三角形', re: /直角三角形|勾股定理|角平分线/ },
  { chapter: '二次根式', re: /二次根式|根号下|√[a-zA-Z]\s*[+\-×÷]\s*√/ },
  { chapter: '实数', re: /无理数|相反数|绝对值|科学记数法|近似数|平方根|立方根|算术平方根/ },
]
const detectChapterByContent = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) return null
  // 拼所有题目的题干 + 学生答案 + 选项 + question_type 为一个文本
  // （题目内容里通常会带特征字，如"下列各式中正确的是...√4...±√2..."）
  const buf = []
  for (const q of questions) {
    if (q.content) buf.push(String(q.content))
    if (q.student_answer) buf.push(String(q.student_answer))
    if (Array.isArray(q.options)) buf.push(q.options.join(' '))
    if (typeof q.options === 'string') buf.push(q.options)
  }
  const text = buf.join(' ')
  if (!text) return null
  for (const rule of CONTENT_CHAPTER_RULES) {
    if (rule.re.test(text)) return rule.chapter
  }
  return null
}

// 从 pageTitle + questions content 推断 lesson_code（如 "19.2" / "21.2(3)"）
// 用于多试卷单元错位时（如"试卷4|19.2" vs "试卷6"），lesson_code 严格匹配。
// 优先从 pageTitle 中找"试卷N 19.2"模式的 lesson_code，兜底从题干找"19.2 平方根"模式。
// 过滤：排除"1.5"这种科学记数法小数（必须 ≥ 4 字符，如 "19.2" / "21.2(3)"）
const detectLessonCode = (questions, pageTitle) => {
  if (pageTitle && typeof pageTitle === 'string') {
    // 优先匹配带括号的形式如 "19.1(1)" / "21.2(3)"（OCR 标题里常见）
    // 注意：\b 在 '(' 前不成立，所以带括号的模式不能用 \b
    const m1 = pageTitle.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
    if (m1 && m1[1].length >= 4) return m1[1]
    // 兜底：匹配不带括号的形式如 "19.1" / "21.2"
    const m2 = pageTitle.match(/\b(\d{1,2}\.\d{1,2})\b/)
    if (m2 && m2[1].length >= 4) return m2[1]
  }
  // 兜底：从题目 content 找 lesson 模式
  if (Array.isArray(questions) && questions.length > 0) {
    for (const q of questions) {
      if (q.content && typeof q.content === 'string') {
        const m1 = q.content.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
        if (m1 && m1[1].length >= 4) return m1[1]
        const m2 = q.content.match(/\b(\d{1,2}\.\d{1,2})\b/)
        if (m2 && m2[1].length >= 4) return m2[1]
      }
    }
  }
  return null
}

/**
 * 课时编号归一：统一全角括号、去空白，用于与答案库 unit_key 做严格相等比较。
 * 例："27.3（2）" → "27.3(2)"。
 */
function normalizeLessonCode(value) {
  return String(value ?? '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    // 全角句点 → 半角：OCR 把 "27.2(3)" 读成 "27．2(3)" 是常态（与答案册解析事故同源）。
    // 只转 U+FF0E 全角句点，不动中文句号「。」—— 后者一旦变点号会在普通文本里造出假编号。
    .replace(/．/g, '.')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * 从正文小标题里抽「课时编号」（如 "27.3（2）已知图像上三点求二次函数的表达式" → "27.3(2)"）。
 * 抽不到返回 null，调用方落回原有级联。
 * 之所以把编号单独抽出来：同一页上编号与副标题可能互相矛盾（实测 "27.3（2）…三点…"，
 * 而答案库里"三点"属 27.3(1)），此时整串模糊匹配必然打平，只有编号是硬锚点。
 */
const SECTION_LESSON_CODE_RE = /(\d{1,2}\.\d{1,2}(?:[（(]\s*\d+\s*[）)])?)/
function extractLessonCodeFromSectionTitle(sectionTitle) {
  const m = normalizeLessonCode(sectionTitle).match(SECTION_LESSON_CODE_RE)
  return m ? m[1] : null
}

/**
 * 收集一段文本里所有"课时编号"形态的片段（去重）。
 * 形态：`27.3(2)` / `27.2（3）` / `19.1(1)` / `30.1`，全角括号与空白先归一。
 * 只是"候选收集"，不做取舍 —— 取舍交由调用方（要求唯一 + 答案库能唯一命中）。
 */
const LESSON_CODE_SCAN_RE = /(\d{1,2}\s*[.．]\s*\d{1,2}(?:\s*[（(]\s*\d{1,2}\s*[）)])?)/g
// 形态二：编号与课时序号分离 —— 「27.2 二次函数的图像与性质 (2)」
// 卷面/OCR 常把"课时号"与"该课时下的序号"分开印：编号在行首，序号在标题末尾的括号里。
// 只扫连续编号会得到 "27.2"，对不上答案库的 unit_key "27.2(2)" ——
// 实测 2026-09-15：李哲瀚 27.2(2) 卷重跑时 section_title 正是这个形态，导致整页锚定失败、
// 7 道题全部落成"待人工"。
// 限制：中间不得出现其它数字（[^\d(（]），避免把两处无关的数字硬拼成一个编号。
const SPLIT_LESSON_CODE_RE = /(\d{1,2})\s*[.．]\s*(\d{1,2})[^\d(（]{0,24}?[（(]\s*(\d{1,2})\s*[）)]/g
function collectLessonCodes(text) {
  const out = new Set()
  if (!text || typeof text !== 'string') return out
  const norm = normalizeLessonCode(text)
  LESSON_CODE_SCAN_RE.lastIndex = 0
  let m
  while ((m = LESSON_CODE_SCAN_RE.exec(norm)) !== null) out.add(m[1])
  // 分离形态组合成完整编号；它可能与前一条扫出的 "27.2" 共存，
  // 但 "27.2" 不在答案库的 unit_key 集合里，会在 validCodes 过滤时被剔除。
  SPLIT_LESSON_CODE_RE.lastIndex = 0
  while ((m = SPLIT_LESSON_CODE_RE.exec(norm)) !== null) out.add(`${m[1]}.${m[2]}(${m[3]})`)
  return out
}

/**
 * 从"本页所有可得文本"里提炼唯一课时编号。
 *
 * 为什么需要它（2026-09-15 事故）：
 *   workbook 提示词原先【没有】section_title 字段，模型即便读到了正文里的课时标题也无处可填，
 *   `parsed.section_title` 恒为 undefined → 恒 null。于是当页眉印的是书名跑马灯
 *   （「新闵学校"成长·桥"练习 第01周」）时，标题类锚点全空，整页落到
 *   struct-fingerprint / group-fallback 去猜单元；而答案册里同一题号横跨 49 个单元
 *   （题号 4 有 62 条记录、46 个不同答案）→ 猜错就"一份卷没有一道对得上"。
 *
 * 本函数的立场：课时编号是**本页唯一硬锚点**，比任何标题模糊匹配都可靠。
 * 只要它在本页任何地方出现过（页眉、正文小标题、题干、甚至模型的原始响应），
 * 就应该被用上 —— 这些文本都是 OCR 一次调用已经产出的，零额外成本。
 *
 * @param {string[]} sources 本页可得文本
 * @param {Set<string>} [validCodes] 允许的编号集合（答案库现有 unit_key 归一化后的集合）。
 *        传了就只统计这个集合里的编号 —— 这一步很关键：题干里的 "1.5"/"3.14" 这类小数
 *        会被自动排除，不必靠"整数部分≥10"之类的脆弱启发式。
 * @returns {string|null} 过滤后【恰好一个】课时编号时返回它，0 个或多个都返回 null
 */
export function extractUniqueLessonCode(sources, validCodes) {
  const found = new Set()
  for (const s of sources) {
    for (const code of collectLessonCodes(s)) {
      if (validCodes && !validCodes.has(code)) continue
      found.add(code)
    }
  }
  if (found.size !== 1) return null
  return [...found][0]
}

export function pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint, sectionTitle, rawOcrText) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]

  // ── 0-!) 整页课时编号硬锚定（2026-09-15）──
  // 立场：课时编号是本页唯一的**硬锚点**，优先级高于一切标题模糊匹配。
  //
  // 事故背景：workbook 提示词原先没有 section_title 字段 → 该信号恒 null；
  // 页眉又常印书名跑马灯（「新闵学校"成长·桥"练习 第01周」）→ 标题类锚点全空。
  // 于是整页落到 struct-fingerprint / group-fallback 去猜单元。答案册里同一题号横跨
  // 49 个单元（题号 4 有 62 条记录、46 个不同答案）→ 猜错后按题号取答案必然张冠李戴，
  // 实测一份卷 7~10 题判错、且"把对的判成错、把错的判成对"两者同时发生。
  //
  // 这里把本页**所有可得文本**扫一遍找编号（页眉、正文小标题、题干、以及模型原始响应全文）
  // —— 这些文本都是同一次 OCR 已经产出的，零额外成本。
  //
  // 两道硬约束，宁可不用也不误锚：
  //   ① 过滤后（只认答案库确实存在的编号）必须【恰好一个】，出现多个说明本页跨课时，放弃；
  //   ② 该编号必须与答案库某个 unit_key 严格相等且【唯一】，命中多个同样放弃。
  {
    const validCodes = new Set([...answersByUnit.keys()].map(normalizeLessonCode))
    // 来源只用"模型确实读到过的东西"：页眉标题、正文小标题、以及 OCR 原始响应全文。
    // 原始响应里已经包含模型输出的全部文本（含题干），所以不必再单独扫 question.content；
    // 少一路来源就少一份噪声。
    const sources = [pageTitle, sectionTitle, rawOcrText]
    for (const q of Array.isArray(questions) ? questions : []) {
      if (q && typeof q === 'object' && typeof q._lesson_code === 'string') sources.push(q._lesson_code)
    }
    const pageCode = extractUniqueLessonCode(sources, validCodes)
    if (pageCode) {
      const hit = [...answersByUnit.keys()].filter(uk => normalizeLessonCode(uk) === pageCode)
      if (hit.length === 1) {
        console.log(`[pickAnswerUnit] 整页课时编号 "${pageCode}" 严格唯一命中 unit="${hit[0]}"（来源含页眉/正文/OCR 原文）`)
        return hit[0]
      }
      console.warn(`[pickAnswerUnit] 整页课时编号 "${pageCode}" 在答案库命中 ${hit.length} 个 unit，不唯一 → 落回原级联`)
    }
  }

  // ── 0--) 正文小标题里的【课时编号】严格优先（2026-09-12）──
  // 编号（"27.3(2)"）比副标题文字可靠得多。实测该页 OCR 读出
  // "27.3（2）已知图像上三点求二次函数的表达式"，而答案库里"三点"属 27.3(1)、
  // "27.3(2)"的副标题是"两点"——编号与副标题互相矛盾时，任何标题模糊匹配都会在
  // (1)/(2) 之间打平后放弃（实测确认）。此时按编号严格相等定位唯一单元即可。
  // 与既有注释同一立场："lesson_code 严格区分，远胜标题模糊匹配"。
  // 只在【恰好一个】unit 的 key 与编号严格相等时生效，不唯一就落回原级联。
  if (sectionTitle && typeof sectionTitle === 'string') {
    const code = extractLessonCodeFromSectionTitle(sectionTitle)
    if (code) {
      const exact = [...answersByUnit.keys()].filter(uk => normalizeLessonCode(uk) === code)
      if (exact.length === 1) {
        console.log(`[pickAnswerUnit] section_title="${sectionTitle}" 的课时编号 "${code}" 严格唯一命中 unit="${exact[0]}"`)
        return exact[0]
      }
      if (exact.length > 1) {
        console.warn(`[pickAnswerUnit] section_title 的课时编号 "${code}" 命中 ${exact.length} 个 unit，不唯一 → 落回原级联`)
      }
    }
  }

  // ── 0-) 正文单元小标题优先于页眉标题（2026-09-12）──
  // 事故：练习册页眉印的是全书通用的书名跑马灯（"新闵学校"成长·桥"练习 第01周"），
  // OCR 提示词要求 page_title 只读页眉 → 这个值命中不了任何 unit → 整页答案挂空。
  // 实测 3 份卷 32 道题全部 pending，占「老师被强制逐题点击」的 70%。
  // sectionTitle 是 OCR 新增字段：正文里印着的本页课时小标题（"27.4（2）二次函数与一元二次方程（2）"）。
  // ⚠️ 它【只在通过下面「防御 1」同一套自检】时才顶替 pageTitle —— 即它必须能被某个 unit 的
  //    title/key 包含。拿不准就完全不改 pageTitle，退化成"和改动前逐字节一样"的行为。
  //    因此这里补的是"锚点缺失"，不是放宽判据：后续级联（lesson_code / 题号覆盖 / 学生答案反推 /
  //    打平放弃）全部原样生效。
  if (sectionTitle && typeof sectionTitle === 'string' && sectionTitle.trim()) {
    const stNorm = normalizeTitleForMatch(sectionTitle)
    if (stNorm && stNorm.length >= 4) {
      let stTrusted = false
      for (const uk of answersByUnit.keys()) {
        const secMap = answersByUnit.get(uk)
        const sample = secMap ? [...secMap.values()][0]?.values().next()?.value : null
        if (!sample) continue
        const ck = normalizeTitleForMatch(sample.unit_key || uk)
        const ct = normalizeTitleForMatch(sample.unit_title || '')
        const ckHit = ck && (ck.includes(stNorm) || stNorm.includes(ck))
        const ctHit = ct && (ct.includes(stNorm) || stNorm.includes(ct))
        if (ckHit || ctHit) { stTrusted = true; break }
      }
      if (stTrusted) {
        console.log(`[pickAnswerUnit] 正文小标题可信，顶替页眉标题：section_title="${sectionTitle}" (原 page_title="${pageTitle || ''}")`)
        pageTitle = sectionTitle
      } else {
        console.warn(`[pickAnswerUnit] section_title="${sectionTitle}" 不与任何 unit 的 title/key 匹配，不采用（保持用 page_title）`)
      }
    }
  }

  // ── 防御 1：pageTitle 自检 ──
  // OCR 在答卷页经常识别不到「试卷① 19.1 平方根与立方根 基础性测试」这种小标题，
  // 退而把练习册封面/页眉/页脚里的整体名（如「小初衔接」）当成 pageTitle 报上来。
  // 这种 pageTitle 显然是错的，**不应当作页标题匹配候选**，否则会一路匹配失败→60% 兜底
  // → 错挂到题号范围覆盖最广的 unit（实测「小初衔接」练习册里 #14-#22 错挂到 试卷1|19.1）。
  // 判定：pageTitle 命中**所有候选 unit 的 unitTitle / unitKeyRaw 都不包含** pageTitle 的子串，
  // 且 pageTitle 长度 ≥ 3 字符（排除单字误识别），则视为不可信，直接置空 pageTitle。
  let trustedPageTitle = pageTitle
  if (pageTitle && typeof pageTitle === 'string' && pageTitle.length >= 3) {
    const candidates = [...answersByUnit.keys()]
    // 归一化后再做包含判断：OCR 标题里可能带"空白"+"（如"试卷⑨ 20.2 二次根式…"），
    // 而 unit_title 无空白。统一通过 normalizeTitleForMatch 压空白+圈序号→ASCII 后比较，
    // 否则明明能精确匹配到"试卷9|20.2"的标题，会被误判为 OCR 误识别而置空，
    // 退化到学生答案反推而错挂到别的单元。
    const normPageTitle = normalizeTitleForMatch(pageTitle)
    let anyContain = false
    for (const uk of candidates) {
      const secMap = answersByUnit.get(uk)
      if (!secMap) continue
      const sample = [...secMap.values()][0]?.values().next()?.value
      if (!sample) continue
      const ckRaw = sample.unit_key || uk
      const ctRaw = sample.unit_title || ''
      const ck = normalizeTitleForMatch(ckRaw)
      const ct = normalizeTitleForMatch(ctRaw)
      if (ck && (ck.includes(normPageTitle) || ct.includes(normPageTitle) || normPageTitle.includes(ck) || normPageTitle.includes(ct))) {
        anyContain = true
        break
      }
    }
    if (!anyContain) {
      console.warn(`[pickAnswerUnit] pageTitle="${pageTitle}" 不与任何 unit 的 title/key 匹配，视为 OCR 误识别，置空`)
      trustedPageTitle = null
    }
  }

  // 从 3D Map 中抽出每单元的展示键（含 unit_title / unit_key / 页码范围）
  const unitMeta = (unitKey) => {
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return { unitKey, unitTitle: '', unitKeyRaw: '', pageStart: null, pageEnd: null }
    let pageStart = null
    let pageEnd = null
    for (const qMap of secMap.values()) {
      const sample = qMap.values().next().value
      if (sample) {
        if (pageStart == null && sample.answer_page_start != null) pageStart = sample.answer_page_start
        if (pageEnd == null && sample.answer_page_end != null) pageEnd = sample.answer_page_end
        if (pageStart != null && pageEnd != null) break
      }
    }
    if (!secMap.values().next().value) {
      return { unitKey, unitTitle: '', unitKeyRaw: unitKey, pageStart, pageEnd }
    }
    const sample = [...secMap.values()][0].values().next().value
    return {
      unitKey,
      unitTitle: sample.unit_title || '',
      unitKeyRaw: sample.unit_key || unitKey,
      pageStart,
      pageEnd,
    }
  }
  const candidates = [...answersByUnit.keys()].map(unitMeta)

  // 0-pre) 按页面标题区分"试卷"还是"堂堂练/课时练"，避免两类 unit 互相污染。
  //   关键修正：标题含"测试卷"不等于"试卷N"。
  //   "第X章评价测试卷"/"单元测试卷"/"期中测试卷"等是章级/综合测试卷，unit_key 通常不以"试卷"开头；
  //   只有"试卷①/试卷1/试卷一 ..."这种带明确序号的课时测试卷，才过滤到 /^试卷/ 单元。
  //   之前把"第二章评价测试卷"误判为试卷系列，过滤掉真正的"第二章评价测试卷"单元，
  //   导致整页答案错挂到"试卷X"单元（题号同样从1开始，覆盖率>60%即错配）。
  const normPageTitle = normalizeTitleForMatch(trustedPageTitle)
  const hasTanglian = /堂堂练|课时练|练习题/.test(normPageTitle)
  // 明确含"试卷N"（圈数字/阿拉伯/中文数字）才视为课时测试卷
  const hasShijuanNumber = /试卷\s*[0-9①-⑩一二三四五六七八九十]+/.test(normPageTitle)
  // 章级测试卷：第X章...测试卷 / 单元测试卷 / 评价测试卷 / 阶段测试卷 / 综合测试卷
  const isChapterLevelTest = /第[一二三四五六七八九十\d]+[章节单元].*?(测试卷|评价测试|阶段测试|综合测试|综合练习)|单元测试卷|期中测试卷|期末测试卷|月考卷/.test(normPageTitle)

  if (hasTanglian && !hasShijuanNumber) {
    const practiceOnly = candidates.filter(c => /^堂堂练|^课时练/.test(c.unitKeyRaw || c.unitKey || ''))
    if (practiceOnly.length >= 1) {
      candidates.splice(0, candidates.length, ...practiceOnly)
    }
  } else if (hasShijuanNumber && !isChapterLevelTest) {
    // 明确是"试卷N"课时测试卷，且不是章级测试卷标题里恰好含"试卷N"
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  } else if (isChapterLevelTest) {
    // 章级/综合测试卷：优先保留同章节/同类型的单元，不要硬推试卷类
    const chapterMatch = normPageTitle.match(/^(第[一二三四五六七八九十\d]+[章节单元])/)
    if (chapterMatch) {
      const chapterCore = chapterMatch[1]
      const chapterUnits = candidates.filter(c => {
        const ck = c.unitKeyRaw || c.unitKey || ''
        const ct = c.unitTitle || ''
        return new RegExp(`^${chapterCore}`).test(ck) || new RegExp(`^${chapterCore}`).test(ct)
      })
      if (chapterUnits.length >= 1) {
        candidates.splice(0, candidates.length, ...chapterUnits)
      }
    }
    // 否则不强制过滤，保留所有候选给后续评分
  } else if (/^第[一二三四五六七八九十\d]+[章节单元]$/.test(normPageTitle)) {
    // 标题只是 bare 章节核心（如"第二章"/"第十九章"），不要预过滤成试卷类。
    // 这类标题通常指向章级单元；保留所有候选，交给标题核心匹配或题号覆盖率打分。
  } else {
    // 标题不明确或同时含两类：保持旧行为，优先试卷类 unit
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  }

  // 0) lesson_hint 匹配（最精确：lesson_code 来自 OCR 提示词/题目内容推断）
  //    候选 unit 的 lesson_code 是结构化字段（如"19.2"），而"试卷4" vs "试卷6" 错位时，
  //    lesson_code 严格区分（如"19.2" vs null），远胜标题模糊匹配。
  //    优先从 question content 中检测章节码，再与 candidates 匹配。
  //    命中多个 candidates 时，缩窄 candidates 给后续评分；唯一命中才直接 return。
  //    注：candidates 是 const，用 splice 原地缩窄，不能重新赋值。
  const lessonHint = detectLessonCode(questions, trustedPageTitle)
  if (lessonHint) {
    // 从 pageTitle 抽"试卷N"中的 N
    const pagePaperMatch = trustedPageTitle && typeof trustedPageTitle === 'string'
      ? trustedPageTitle.match(/试卷\s*([0-9㊀-㊉①-⑩]+)/)
      : null
    const pagePaperNum = pagePaperMatch
      ? (circledToAsciiMap[pagePaperMatch[1]] || Number(pagePaperMatch[1]))
      : null

    // 收集所有 lesson_code 段严格匹配 lessonHint 的 candidates
    const lessonMatches = []
    for (const c of candidates) {
      const ck = c.unitKeyRaw || ''
      // unitKey 形如 "试卷4|19.2" → 提取 "19.2" 段做严格匹配
      const m = ck.match(/\|(\d+(?:\.\d+)?(?:\(\d+\))?)/)
      if (m && m[1] === lessonHint) {
        lessonMatches.push(c)
      } else if (ck.includes(lessonHint)) {
        // 兜底：unitKeyRaw 任意位置含 lessonHint（如"试卷19"含"19"），
        // 但 lesson_code 段严格匹配的优先（先填入，模糊匹配的追加在后面）
        lessonMatches.push({ ...c, _softMatch: true })
      }
    }

    // 试卷序号锁定：pageTitle 里的"试卷N"必须和 unitKeyRaw 里的"试卷N"一致
    // OCR 把"试卷④"误识别为"试卷①"时，这个 lock 会失败，回退到 lesson_code 兜底
    if (pagePaperNum && lessonMatches.length > 1) {
      const locked = lessonMatches.filter(c => {
        const ck = c.unitKeyRaw || ''
        const m = ck.match(/试卷\s*(\d+)\s*\|/i)
        return m && Number(m[1]) === pagePaperNum
      })
      if (locked.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...locked)
    }

    // 类型关键词锁定（提高性测试/基础性测试）：OCR 不会把这两个词读错
    if (lessonMatches.length > 1 && trustedPageTitle) {
      const normP = normalizeTitleForMatch(trustedPageTitle)
      const hasBasics = /基础性测试/i.test(normP)
      const hasAdvanced = /提高性测试/i.test(normP)
      if (hasBasics || hasAdvanced) {
        const filtered = lessonMatches.filter(c => {
          const ct = normalizeTitleForMatch(c.unitTitle)
          if (hasBasics) return ct.includes('基础性测试')
          if (hasAdvanced) return ct.includes('提高性测试')
          return true
        })
        if (filtered.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...filtered)
      }
    }

    if (lessonMatches.length === 1) return lessonMatches[0].unitKey
    if (lessonMatches.length > 1) {
      // 多个候选命中：先按严格匹配筛（剔除 softMatch），再交给评分阶段
      const strictMatches = lessonMatches.filter(c => !c._softMatch)
      if (strictMatches.length >= 1) {
        candidates.splice(0, candidates.length, ...strictMatches)
      } else {
        candidates.splice(0, candidates.length, ...lessonMatches)
      }
    }
  }

  // 1) 标题匹配：先把 pageTitle 压空白 + 圈序号→ASCII，再做归一化匹配
  //    旧版只压空白，OCR 把"堂堂练①"误识别为"堂堂练1"会直接失配，60% 兜底也撞错单元
  const normTitle = normalizeTitleForMatch(normalizeSectionName(trustedPageTitle))
  if (normTitle) {
    // 1a) 完全相等 / 包含（按更长侧为锚，防"含子串"误中）
    //   两侧同长：直接比；否则要求短侧是长侧的「前缀」或「后缀」之一
    //   杜绝"第十九章 单元测试卷"被"第十九章"单字符错挂（其实同义但置信度应分级）
    for (const c of candidates) {
      const ct = normalizeTitleForMatch(c.unitTitle)
      if (ct && titleMatches(normTitle, ct)) return c.unitKey
    }
    for (const c of candidates) {
      const ck = normalizeTitleForMatch(c.unitKeyRaw)
      if (ck && titleMatches(normTitle, ck)) return c.unitKey
    }

    // 1a+) 章级标题核心匹配：pageTitle="第X章评价测试卷" 可匹配 unitKey/unitTitle="第X章"
    //   答案库中章级单元常只存"第X章"为核心 key，而学生页标题是完整"第X章评价测试卷"，
    //   titleMatches 的长度差限制会拒绝这种包含关系。此处放宽：章级核心前缀相同即命中。
    const chapterCoreMatch = normTitle.match(/^(第[一二三四五六七八九十\d]+[章节单元])/)
    if (chapterCoreMatch) {
      const core = chapterCoreMatch[1]
      // 优先命中非试卷类的章级单元，避免 bare"第十九章"被试卷类 title 截胡
      for (const c of candidates) {
        const ck = normalizeTitleForMatch(c.unitKeyRaw)
        const ct = normalizeTitleForMatch(c.unitTitle)
        const matchCore = ck === core || ct === core || ck.startsWith(core) || ct.startsWith(core)
        if (matchCore && !/^试卷/.test(ck)) return c.unitKey
      }
      for (const c of candidates) {
        const ck = normalizeTitleForMatch(c.unitKeyRaw)
        const ct = normalizeTitleForMatch(c.unitTitle)
        if (ck === core || ct === core || ck.startsWith(core) || ct.startsWith(core)) {
          return c.unitKey
        }
      }
    }
  }

  // 1.5) 内容特征匹配（兜底）——当 pageTitle 缺失/匹配失败且多个章节有相同题号时，
  //   用题目 OCR 文本中的数学特征（√、二次根式等）反推章节。这能解决：
  //     - 页面顶部"二、选择题"等无章节标题的排版，OCR 无法识别 page_title
  //     - 第十九/二十/二十一/二十二章题号都从 1 开始编号，仅靠题号覆盖率会错挂
  //   唯一命中 → 直接采用；多个候选都含 detectedChapter → 缩窄 candidates 给后续打分。
  //   旧版"多个候选命中就跳过"在 chapterHint=null 时会退化为题号覆盖率乱选（user 截图
  //   18-20 题是 19.2 实数，但试卷1|19.1 题号 1-28 也覆盖 18-20，会被错挂）。修复：
  //   缩窄 candidates（而不是跳过）让打分阶段只在 19.2 系列内部选，避免错挂到 19.1。
  //   二次根式规则已修（不再误中"平方根/立方根"），缩窄安全。
  const detectedChapter = detectChapterByContent(questions)
  if (detectedChapter) {
    const titleMatches4 = candidates.filter(c => c.unitTitle && c.unitTitle.includes(detectedChapter))
    if (titleMatches4.length === 1) return titleMatches4[0].unitKey
    const keyMatches4 = candidates.filter(c => c.unitKeyRaw && c.unitKeyRaw.includes(detectedChapter))
    if (keyMatches4.length === 1) return keyMatches4[0].unitKey
    // 多个候选命中：用 detectedChapter 缩窄 candidates（不替换为局部变量，透传下去给打分）
    if (titleMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...titleMatches4)
    } else if (keyMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...keyMatches4)
    }
  }

  // ── 防御 2：pageTitle 不可信时，把 OCR 的 chapterHint 注入到题目"内容特征"通道 ──
  // 触发条件：trustedPageTitle == null（OCR 误识别 pageTitle）+ chapterHint 非空
  // chapterHint 来自 OCR 阶段 AI 看题目内容推断（如"第二十章二次根式"），
  // 它的可靠性比 pageTitle 高得多。当 pageTitle 不可信时，
  // 把 chapterHint 注入到 detectedChapter 通道，让"二次根式/实数/一元二次方程/直角三角形"
  // 关键词直接参与候选缩窄。
  if (!trustedPageTitle && chapterHint && typeof chapterHint === 'string') {
    const hintNorm = chapterHint.replace(/[\s　]+/g, '')
    const CHAPTER_KEYWORDS = [
      { kw: '二次根式', mustInTitle: /二次根式|根号下/ },
      { kw: '一元二次方程', mustInTitle: /一元二次方程/ },
      { kw: '直角三角形', mustInTitle: /直角三角形|勾股|角平分线/ },
      { kw: '实数', mustInTitle: /实数/ },
    ]
    for (const { kw, mustInTitle } of CHAPTER_KEYWORDS) {
      if (hintNorm.includes(kw)) {
        const kwNarrowed = candidates.filter(c => {
          const ct = c.unitTitle || ''
          return mustInTitle.test(ct)
        })
        if (kwNarrowed.length >= 1 && kwNarrowed.length < candidates.length) {
          console.log(`[pickAnswerUnit] pageTitle 不可信 + chapterHint="${chapterHint}" 含"${kw}"，缩窄至 ${kwNarrowed.length} 个候选`)
          candidates.splice(0, candidates.length, ...kwNarrowed)
        }
        break
      }
    }
  }

  // 2) 学生答案反推（按题粒度，逻辑收敛在此处，调用方不再重复）
  //   与下一条"答案覆盖率"的差异：
  //   - 本策略：按题号粒度逐题搜索，最高总相似度胜出（searchUnitByStudentAnswers）
  //   - 答案覆盖率：整页学生答案集合 vs unit 整本标准答案集合的命中率
  //   两者先后执行是冗余安全：任一命中即返回，避免下游错挂
  //   ★ 修复（2026-08-07）：必须限定在已收窄的 candidates 内反推，不能传全库 answersByUnit！
  //   旧代码传 answersByUnit（58 个单元），学生答案反推无视前面标题/章节/lesson_code 收窄，
  //   被题号恰好覆盖的无关单元抢走（实测"二次根式运算"卷第 2 页被 堂堂练24|21.4(2) 抢走，
  //   第 1 页被 试卷3|19.2（实数）抢走）。传入 candidates 后，反推只在这批候选内比较。
  const inferredByAnswers = searchUnitByStudentAnswers(questions || [], answersByUnit, candidates)
  if (inferredByAnswers) {
    console.log(`[pickAnswerUnit] 学生答案反推命中: unit="${inferredByAnswers.unitKey}" hits=${inferredByAnswers.hits} score=${inferredByAnswers.totalScore.toFixed(2)}`)
    return inferredByAnswers.unitKey
  }

  // 3) 答案覆盖率兜底（整页粒度：拿本页学生所有非空答案 vs 候选 unit 整本标准答案）
  //   searchUnitByStudentAnswers 已失败（按题号粒度没匹配上），这里放宽到整页命中率。
  //   与 searchUnitByStudentAnswers 的差异：
  //   - searchUnitByStudentAnswers 是按题号粒度逐题匹配，可能多题命中但都集中在某无关 unit
  //   - 本策略是把整页学生答案作为一个集合，看哪个 unit 的"答案指纹集合"覆盖最广
  //   阈值：≥ 60% 覆盖率 + ≥ 3 道题命中 才采用
  //   题号 < 3 不准走答案覆盖率（学生答案太少容易跨章错挂）
  const studentAnswerList = (questions || []).filter(q => {
    const sa = (q.student_answer || '').toString().trim()
    return sa && q.question_type !== 'choice' && q.question_type !== 'judge'
  })
  // 仅在学生答案有内容时才启用（纯选择题页走不到这里）
  if (studentAnswerList.length >= 3) {
    // 预计算每个 unit 的所有标准答案指纹集合（去重）
    const unitFingerprints = new Map() // unitKey → Set<normalizedAnswer>
    for (const c of candidates) {
      const secMap = answersByUnit.get(c.unitKey)
      if (!secMap) continue
      const fp = new Set()
      for (const qMap of secMap.values()) {
        for (const row of qMap.values()) {
          if (!row || !row.standard_answer) continue
          const sa = String(row.standard_answer).trim()
          if (!sa) continue
          // 归一化：去空白、转小写
          fp.add(sa.replace(/\s+/g, '').toLowerCase())
        }
      }
      unitFingerprints.set(c.unitKey, fp)
    }

    let bestUnit = null
    let bestHits = 0
    let bestTotalScore = 0
    for (const [unitKey, fp] of unitFingerprints) {
      let hits = 0
      let totalScore = 0
      for (const q of studentAnswerList) {
        const sa = (q.student_answer || '').toString().trim().replace(/\s+/g, '').toLowerCase()
        if (!sa) continue
        // 精确匹配
        if (fp.has(sa)) {
          hits++
          totalScore += 1.0
          continue
        }
        // 相似度匹配（最长公共子串 / 编辑距离简化版）
        for (const ref of fp) {
          if (ref === sa) continue // 精确已查
          if (Math.abs(ref.length - sa.length) > Math.max(2, ref.length * 0.3)) continue // 长度差过大跳过
          const sim = stringSimilarity(sa, ref)
          if (sim >= 0.7) {
            hits++
            totalScore += sim
            break
          }
        }
      }
      const coverage = hits / studentAnswerList.length
      if (coverage >= 0.6 && hits >= 3) {
        // 命中率最高优先；并列时取总相似度高
        if (hits > bestHits || (hits === bestHits && totalScore > bestTotalScore)) {
          bestHits = hits
          bestTotalScore = totalScore
          bestUnit = unitKey
        }
      }
    }
    if (bestUnit) {
      console.log(`[pickAnswerUnit] 答案覆盖率兜底命中: unit="${bestUnit}" hits=${bestHits}/${studentAnswerList.length} score=${bestTotalScore.toFixed(2)}`)
      return bestUnit
    }
  } else if (studentAnswerList.length > 0) {
    console.log(`[pickAnswerUnit] 学生答案 < 3 道（${studentAnswerList.length} 道），拒绝答案覆盖率兜底`)
  }

  // 3) 页码范围兜底（依赖答案 PDF 元数据 pageStart/pageEnd，**不是题号覆盖率**）
  //   旧策略在这里还做了"题号覆盖率打分"，但题号覆盖率是纯数字信号，跨章错挂风险高。
  //   此处只保留"页码唯一命中"和"页码范围缩窄 + 答案覆盖率再打分"两种更可靠信号。
  //   标题匹配 + 学生答案反推 + 答案覆盖率都失败时，最后用 pageNumber 反查答案 PDF 位置。
  if (pageNumber != null && Number.isFinite(Number(pageNumber))) {
    const page = Number(pageNumber)
    const inRange = candidates.filter(c =>
      c.pageStart != null && c.pageEnd != null &&
      page >= Number(c.pageStart) && page <= Number(c.pageEnd)
    )
    if (inRange.length === 1) {
      // 唯一区间命中：
      //   - 有学生答案（≥1 道非选择题）→ 答案覆盖率 ≥ 30% 才采用
      //   - 纯选择题页（无学生答案可比对）→ 页码范围兜底直接采用（选择题题号覆盖率已废，
      //     页码唯一命中是唯一可靠信号）
      const candidateAnswers = answersByUnit.get(inRange[0].unitKey)
      if (candidateAnswers) {
        if (studentAnswerList.length === 0) {
          // 纯选择题页：直接采用页码唯一命中
          console.log(`[pickAnswerUnit] 页码范围兜底命中: unit="${inRange[0].unitKey}" pageNumber=${pageNumber}（纯选择题页，无学生答案可比）`)
          return inRange[0].unitKey
        }
        const fp = new Set()
        for (const qMap of candidateAnswers.values()) {
          for (const row of qMap.values()) {
            if (row && row.standard_answer) {
              fp.add(String(row.standard_answer).trim().replace(/\s+/g, '').toLowerCase())
            }
          }
        }
        let hits = 0
        for (const q of studentAnswerList) {
          const sa = (q.student_answer || '').toString().trim().replace(/\s+/g, '').toLowerCase()
          if (!sa) continue
          if (fp.has(sa)) { hits++; continue }
          for (const ref of fp) {
            if (ref === sa) continue
            if (Math.abs(ref.length - sa.length) > Math.max(2, ref.length * 0.3)) continue
            const sim = stringSimilarity(sa, ref)
            if (sim >= 0.7) { hits++; break }
          }
        }
        const coverage = hits / studentAnswerList.length
        if (coverage >= 0.3) {
          console.log(`[pickAnswerUnit] 页码范围兜底命中: unit="${inRange[0].unitKey}" pageNumber=${pageNumber} 答案覆盖率=${(coverage*100).toFixed(0)}%`)
          return inRange[0].unitKey
        }
      }
    }
  }

  // ── 4) 结构指纹兜底（2026-09-13）────────────────────────────────────────
  // 逐页兜底：用本页「题号 + 小题拆分结构」在全库反查单元，实现见
  // inferUnitByStructureFingerprint（含超集校验 / ≥2 道多小题题 / 覆盖率≥70% / 打平即放弃）。
  // 注：单页常只有 1~2 道多小题题，区分度不足会判平放弃 —— 故 processWorkbookGrading 里
  // 另有一道【全任务级】（多页题目合并）的同类兜底，用于兜住整份扫描。
  {
    const fpUnit = inferUnitByStructureFingerprint(answersByUnit, questions)
    if (fpUnit) {
      console.log(`[pickAnswerUnit] 结构指纹兜底命中: unit="${fpUnit}"（页眉无课时号，按题号+小题结构反查）`)
      return fpUnit
    }
  }

  // 5) 都没有命中 → 不强行挂载，让数据走"待审"通道
  return null
}

// ═══════════════════════════════════════════════════════════════
// 两遍扫描 + 双向相邻页继承（2026-08-04）
//
// 背景：答案库批改把"每页单元归属"与"批改"耦合在单遍循环里，
// 且相邻继承只支持"后页继承前页"（prevMatchedUnit）。
// 实测学生常把练习册【从后往前扫描】——卷子的首页（带"第二章评价测试卷"
// 等标题、能被 OCR 识别）在扫描序列【末尾】，而其前面的解答题页没有标题，
// 永远继承不到后面页的单元，导致整页 null。
//
// 修复：先对全部页做一轮独立匹配得到"锚点页"（能可靠定位的页），
// 再从每个锚点向【前后两侧】传播单元，校验相邻页题号确实落在此单元内。
// 这样无论正扫/倒扫，无标题的解答题页都能挂到同一卷子的单元。
//
// 返回：Array<{ pageNumber, unitKey|null }>，按 pageDataList 顺序。
// ═══════════════════════════════════════════════════════════════

/**
 * 计算一组题目在给定 unit 答案库中的覆盖率（0~1）。
 * 覆盖键为 `${question_number}|${sub_no||''}`（与答案库 qKey 结构一致），
 * 保证 sub_no 参与区分，避免"只看题号存在性"导致同号不同小题互相污染。
 */
function coverageOfQuestionsInUnit(questions, secMap) {
  if (!secMap || !questions || questions.length === 0) return 0
  let covered = 0
  for (const q of questions) {
    if (q.question_number == null) continue
    const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
    for (const qMap of secMap.values()) {
      if (qMap.has(qKey)) { covered++; break }
    }
  }
  return covered / questions.length
}

/**
 * 按题号连续性将页面分组为单元组。
 * 策略：对每页独立匹配最可能的单元（按答案覆盖率），按匹配结果分组。
 * 连续匹配同一单元的页归为一组。无法匹配/打平的页独立成组。
 *
 * 修复（2026-08-06）：
 *  - 覆盖率键加入 sub_no（旧版只看 `${qn}|`，同号多单元场景必然全部 1.0 打平）。
 *  - 覆盖率并列最高时【打平即放弃】（unitKey=null），交给后续 pickAnswerUnit 的
 *    标题/学生答案反推等精细层，绝不取 Map 迭代序第一个（旧版恒取 candidates[0]，
 *    是本 bug 的直接执行点）。
 *  - 删除死代码 `ordered[i + 1]?.unitKey`（单趟前向循环里永远读不到下一页，恒 undefined）。
 *
 * 返回 Array<{ pages: pageDataList 子集, unitKey: string|null, tie: string[], minQ, maxQ }>
 */
function _groupByQuestionContinuity(pageDataList, answersByUnit) {
  const ordered = []
  // 先为每页独立匹配最可能的单元
  for (let i = 0; i < pageDataList.length; i++) {
    const pg = pageDataList[i]
    const qnos = (pg.questions || []).map(q => Number(q.question_number)).filter(n => Number.isFinite(n))
    const minQ = qnos.length ? Math.min(...qnos) : Infinity
    const maxQ = qnos.length ? Math.max(...qnos) : -Infinity
    let bestUnit = null
    let bestCov = 0
    let tieCandidates = []
    if (answersByUnit && qnos.length > 0) {
      // 收集所有 coverage 最高的候选单元
      const candidates = []
      for (const [uk, secMap] of answersByUnit) {
        const cov = coverageOfQuestionsInUnit(pg.questions || [], secMap)
        if (cov > bestCov) { bestCov = cov; candidates.length = 0; candidates.push(uk) }
        else if (cov === bestCov && cov > 0) candidates.push(uk)
      }
      // 覆盖率唯一最高才采用；多单元并列（同号多单元场景几乎必然）判定"无法区分"，
      // 打平即放弃，交给后续精细层，绝不取第一个。
      if (candidates.length === 1) bestUnit = candidates[0]
      else if (candidates.length > 1) tieCandidates = candidates
    }
    ordered.push({ pg, minQ, maxQ, unitKey: bestUnit, tie: tieCandidates, idx: i })
  }

  const groups = []
  let curGroup = null
  for (const item of ordered) {
    if (!curGroup || item.unitKey !== curGroup.unitKey || item.unitKey == null) {
      curGroup = { pages: [item.pg], unitKey: item.unitKey, tie: item.tie, minQ: item.minQ, maxQ: item.maxQ }
      groups.push(curGroup)
    } else {
      curGroup.pages.push(item.pg)
      if (item.minQ < curGroup.minQ) curGroup.minQ = item.minQ
      if (item.maxQ > curGroup.maxQ) curGroup.maxQ = item.maxQ
    }
  }
  return groups
}

/**
 * 按题号连续性重建物理页序并分组（2026-08-06）。
 *
 * 背景：倒序扫描场景下（学生从练习册末页往首页拍，如本任务文件名时间戳
 * 420→437 对应物理页 p18→p1），page_number 顺序与练习册物理顺序相反。
 * 用户明确要求"相邻继承应基于卷面印刷页码（拍照时页码一起拍进来），与上传
 * 时间/顺序无关"。OCR 每题的 question_number 就是从卷面印刷体读取的，
 * 因此题号范围 (min_q,max_q) 就是卷面页码的可靠等价物。
 *
 * 策略：
 *  1) 首页锚点 = min_q === 1 的页，其单元归属用 pickAnswerUnit 确认。
 *  2) 每个首页锚点取得所属单元答案库的题号上限 unit_max_q，按上限【降序】
 *     处理首页（题号上限大的单元先锁定：如评价测试卷 30 题，p2(24-27)/p1(28-30)
 *     这类 max_q 超过阶段练 26 题的页只有它能容纳，必须优先归位，否则会被
 *     同范围首页抢走——实测 p4(1-14) 与 p16(1-14) 题号范围完全相同，旧贪心
 *     按上传顺序先处理 p4，错误抢走了属于阶段练2 的 p15/p14/p13）。
 *  3) 从首页贪心延伸：候选 = 未使用 且 min_q === 当前链末 max_q + 1 且
 *     max_q ≤ 单元上限。多候选（同题号竞争，如 p13/p9 都含 Q25-26，纯题号
 *     无法区分归属阶段练2 还是阶段练3）用【学生答案在首页单元内反推】决胜：
 *     候选缩窄到单个单元后，反推远比全库可靠。
 *  4) 链内所有页继承首页单元——这是比逐页学生答案反推强得多的信号
 *     （分数运算单元间学生答案重叠，全库反推不可靠，实测 p13/p14/p15 被
 *     错反推为阶段练1 而非阶段练2）。
 *  5) 无首页可挂的剩余页（如仅拍到某单元的中间页）不强行归链，交回原逻辑。
 *
 * 返回 Map<pageNumber, { unitKey, homePage, chainPages }>；无足够首页锚点时
 * 返回 null（降级走原有逐页匹配 + 双向继承）。
 */
export function _groupByPhysicalContinuity(pageDataList, answersByUnit) {
  if (!pageDataList || pageDataList.length < 2 || !answersByUnit || answersByUnit.size < 2) return null

  // 1. 每页题号范围
  const meta = pageDataList.map(pg => {
    const qnos = (pg.questions || [])
      .map(q => Number(q.question_number))
      .filter(n => Number.isFinite(n))
    return {
      pg,
      pageNumber: pg.pageNumber,
      minQ: qnos.length ? Math.min(...qnos) : Infinity,
      maxQ: qnos.length ? Math.max(...qnos) : -Infinity,
    }
  })

  // 单元答案库题号上限
  const unitMaxQ = (uk) => {
    const secMap = answersByUnit.get(uk)
    if (!secMap) return Infinity
    let m = -Infinity
    for (const qMap of secMap.values()) {
      for (const key of qMap.keys()) {
        const qn = Number(String(key).split('|')[0])
        if (Number.isFinite(qn) && qn > m) m = qn
      }
    }
    return m === -Infinity ? Infinity : m
  }

  // 2. 首页锚点 + 归属 + 单元上限
  const homes = meta.filter(m => m.minQ === 1)
  if (homes.length === 0) return null
  const homeUnits = homes.map(h => {
    const u = pickAnswerUnit(
      answersByUnit,
      h.pg.pageTitle,
      h.pg.questions,
      h.pg.pageNumber,
      h.pg.chapterHint,
      h.pg.sectionTitle,
      h.pg.rawOcrText
    )
    return { h, u, unitMaxQ: u ? unitMaxQ(u) : -Infinity }
  }).filter(x => x.u)
  if (homeUnits.length === 0) return null

  // ★ 修复（2026-08-07）：允许【单首页锚点】启动物理连续链。
  // 旧代码要求 homes.length >= 2，导致「4 页同一张卷、只有第 1 页是首页(min_q=1)」
  // 的任务（如"试卷⑨ 20.2 二次根式的运算 基础性测试"第 1 页 Q1-13，后续页 Q14-25 连续）
  // 整条链被短路 return null，无标题的后续页落入逐页学生答案反推，
  // 在题号都从 1 开始的姊妹单元间（试卷9|20.2 基础 vs 试卷10|20.2 提高）选错，整页答案错挂。
  // 安全前提：单锚点时要求锚点页【带 pageTitle】——OCR 能读到卷首标题即证明这页确实是
  // 单元首页（标题匹配是 pickAnswerUnit 里最强的信号），整条题号连续链继承它是可靠的。
  // 若唯一首页锚点也无标题（仅靠反推命中），仍回退要求 ≥2 锚点，避免单点反推错误传染全链。
  if (homeUnits.length === 1 && !homeUnits[0].h.pg.pageTitle) return null

  // 题号上限降序处理（上限大的单元先锁定，超限页优先归位）
  homeUnits.sort((a, b) => b.unitMaxQ - a.unitMaxQ)

  const used = new Set()
  const chains = []
  for (const { h, u, unitMaxQ: cap } of homeUnits) {
    if (used.has(h)) continue
    used.add(h)
    const chain = [h]
    let curMax = h.maxQ
    for (;;) {
      const cands = meta.filter(m => !used.has(m) && m.minQ === curMax + 1 && m.maxQ <= cap)
      if (cands.length === 0) break
      // ★ 防护（2026-08-07）：链延伸前校验候选页在首页单元内的题号覆盖率。
      // 题号连续只说明"页码相邻"，不能证明属于同一单元——若某页题号恰巧连续
      // 但内容属于下一单元（如上一张卷 Q1-13 尾页 与 下一张卷 Q14-18 首页），
      // 纯题号延伸会把它错误拉进链。要求候选页 ≥50% 题号在首页单元答案库中
      // 存在，否则视为不属于该单元、终止延伸（该页交回后续精细匹配）。
      const covCands = cands.filter(m => {
        const secMap = answersByUnit.get(u)
        if (!secMap) return false
        let covered = 0, total = 0
        for (const q of m.pg.questions || []) {
          if (q.question_number == null) continue
          total++
          const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
          for (const qMap of secMap.values()) {
            if (qMap.has(qKey)) { covered++; break }
          }
        }
        if (total === 0) return false
        const cov = covered / total
        if (cov < 0.5) {
          console.log(`   [物理链] 候选页 p${m.pageNumber}(Q${m.minQ}-${m.maxQ}) 在首页单元 "${u}" 覆盖率=${(cov * 100).toFixed(0)}% < 50%，视为不属于该单元，终止延伸`)
        }
        return cov >= 0.5
      })
      if (covCands.length === 0) break
      let picked
      if (covCands.length === 1) {
        picked = covCands[0]
      } else {
        // 多候选（同题号竞争）：学生答案在首页单元内反推决胜
        const secMap = answersByUnit.get(u)
        let best = null
        let bestScore = -1
        for (const c of covCands) {
          let s = 0
          for (const q of c.pg.questions || []) {
            const sa = (q.student_answer || '').toString().trim()
            if (!sa) continue
            if (q.question_type === 'choice' || q.question_type === 'judge') continue
            const found = searchByAnswerFingerprint(sa, q.question_type || 'answer', secMap, new Set())
            if (found && found.score >= 0.7) s += found.score
          }
          if (s > bestScore) { bestScore = s; best = c }
        }
        picked = (best && bestScore > 0) ? best : covCands[0]
      }
      used.add(picked)
      chain.push(picked)
      curMax = picked.maxQ
    }
    chains.push({ chain, u, home: h })
  }

  // 3. 链内全部继承首页单元
  const overrides = new Map()
  for (const { chain, u, home } of chains) {
    const chainPages = chain.map(m => m.pageNumber)
    for (const m of chain) {
      overrides.set(m.pageNumber, {
        unitKey: u,
        homePage: home.pageNumber,
        chainPages,
      })
    }
    console.log(`   [resolveAnswerUnits] 物理连续链重建: [${chainPages.join(',')}] → unit="${u}"（首页 p${home.pageNumber} min_q=1 max_q=${home.maxQ} 确定）`)
  }
  return overrides.size ? overrides : null
}

/**
 * 结构指纹反查单元（2026-09-13）
 *
 * 场景：页眉是全书通用的学校跑马灯（"新闵学校"成长·桥"练习 第01周"）、正文也无课时小标题
 *   ⇒ 标题通道与正文小标题通道全废；学生又大量空题/书写不规范 ⇒ 「答案覆盖率兜底」够不着
 *   （它要求 ≥3 道非选择题作答且覆盖率 ≥60%）。实测 2ed887cd 两页 14 题因此全部挂空。
 *   另：chapterHint 由 AI 推断，会报错章节（抛物线卷面被报成"第二十一章一元二次方程"），
 *   把候选缩窄到 2 个、正确单元不在其中，故本函数【始终在全库扫描】，不复用上游候选。
 *
 * 思路：用「题号 + 小题拆分结构」当指纹在全库反查。小题结构区分度极高——
 *   Q4 拆(1)(2) ∧ Q8 拆(1)(2)(3) ∧ Q9 拆(1)(2) 这种组合在 49 个单元里唯一命中。
 *
 * ⚠️ 刻意不用「题号覆盖率」当主判据：题号 1~10 几乎所有单元都有，是纯数字信号，跨章错挂
 *    风险高。这里只把它当"入围后的择优"次要指标。也正因如此，本函数对【整份扫描】
 *   （多页题目合并）比对单页有效得多——单页往往只有 1~2 道多小题题，区分度不足会判平放弃。
 *
 * 保守判据（宁可留 pending，也不错挂）：
 *   ① 每道"多小题题"，unit 的小题集合必须【包含】OCR 拆出的小题（unit 可能存得更多，
 *      如 OCR 只认出 8.1~8.3 而答案库有 8.1~8.4，故用超集而非相等）；
 *   ② 至少 2 道多小题题匹配（单道巧合不足以定单元）；
 *   ③ 题号覆盖率 ≥ 70%；
 *   ④ 并列最优即放弃（沿用既有"打平即放弃"纪律）。
 *
 * @param {Map<string, Map<string, Map<string, object>>>} answersByUnit unitKey→section→qKey→row
 * @param {Array<{question_number:number, sub_no?:string}>} questions OCR 题目（可跨页合并）
 * @returns {string|null} unitKey；无法确定时返回 null
 */
function inferUnitByStructureFingerprint(answersByUnit, questions) {
  if (!answersByUnit || answersByUnit.size === 0 || !Array.isArray(questions) || questions.length === 0) return null

  // 本批题目的指纹：Number(qNo) → Set<subNo>（整题行 '' 不记入 sub）
  const pageFp = new Map()
  for (const q of questions) {
    if (q.question_number == null) continue
    const n = Number(q.question_number)
    if (!Number.isFinite(n)) continue
    if (!pageFp.has(n)) pageFp.set(n, new Set())
    const sub = String(q.sub_no || '')
    if (sub) pageFp.get(n).add(sub)
  }
  const multiPartQs = [...pageFp.entries()].filter(([, subs]) => subs.size > 0)
  const pageNos = [...pageFp.keys()]
  if (multiPartQs.length < 2 || pageNos.length < 3) return null

  let bestUnit = null
  let bestSubHits = -1
  let bestCov = -1
  let tie = false

  for (const [uk, secMap] of answersByUnit) {
    if (!secMap) continue
    const unitFp = new Map()
    for (const qMap of secMap.values()) {
      for (const key of qMap.keys()) {
        const [qStr, sub] = String(key).split('|')
        const n = Number(qStr)
        if (!Number.isFinite(n)) continue
        if (!unitFp.has(n)) unitFp.set(n, new Set())
        if (sub) unitFp.get(n).add(sub)
      }
    }
    // ①+② 多小题结构（超集）校验
    let subHits = 0
    let structOk = true
    for (const [n, subs] of multiPartQs) {
      const uSubs = unitFp.get(n)
      if (!uSubs || uSubs.size === 0) { structOk = false; break }
      for (const s of subs) if (!uSubs.has(s)) { structOk = false; break }
      if (!structOk) break
      subHits++
    }
    if (!structOk || subHits < 2) continue
    // ③ 题号覆盖率
    let hits = 0
    for (const n of pageNos) if (unitFp.has(n)) hits++
    const cov = hits / pageNos.length
    if (cov < 0.7) continue
    // ④ 择优 + 打平检测（小题命中数优先，其次覆盖率）
    if (subHits > bestSubHits || (subHits === bestSubHits && cov > bestCov + 1e-9)) {
      bestSubHits = subHits
      bestCov = cov
      bestUnit = uk
      tie = false
    } else if (subHits === bestSubHits && Math.abs(cov - bestCov) <= 1e-9 && bestUnit && bestUnit !== uk) {
      tie = true
    }
  }
  if (bestUnit && tie) return null
  return bestUnit
}

export function resolveAnswerUnits(answersByUnit, pageDataList) {
  const unitCount = answersByUnit ? answersByUnit.size : 0
  if (unitCount === 0) return pageDataList.map(p => ({ pageNumber: p.pageNumber, unitKey: null }))
  if (unitCount === 1) {
    const only = [...answersByUnit.keys()][0]
    return pageDataList.map(p => ({ pageNumber: p.pageNumber, unitKey: only }))
  }

  // ═══════════════════════════════════════════════════════════════
  // 题号连续性分组（前置层，2026-08-05）
  //
  // 背景：倒序扫描场景下（学生从练习册末页往首页拍），page_number 顺序
  // 与练习册物理顺序相反。逐页 pickAnswerUnit 对"非开头页"（q 不从 1 开始）
  // 匹配不可靠（多单元同题号范围 + 缺标题），而答案 PDF 的 answer_page_start/end
  // 可能全 NULL（页码兜底失效），导致双向继承被错锚污染。
  //
  // 策略：利用每页的 question_number 连续性做分组（单元边界 = 题号不连续处），
  // 对每组用"题号覆盖最全"的页反推单元，跳过逐页独立匹配的噪声。
  // 仅在分组成功时覆盖预扫描锚点；分组失败时回退到原有逐页匹配逻辑。
  //
  // 修复（2026-08-06）：分组命中结果【不得短路】pickAnswerUnit 的精细决策链，
  // 只作为其返回 null 时的兜底。组级覆盖率并列最高时用学生答案指纹决胜，
  // 仍无法区分则放弃（不写 override），绝不取迭代序第一个。
  // ═══════════════════════════════════════════════════════════════
  const pageGroups = _groupByQuestionContinuity(pageDataList, answersByUnit)
  const groupOverrides = new Map() // pageNumber → { unitKey, cov, tieUnits }（分组推断的覆盖值）
  const groupTieMap = new Map() // pageNumber → string[]（组级覆盖率打平的候选单元，诊断用）

  // ═══════════════════════════════════════════════════════════════
  // 物理页序重建（2026-08-06，本轮修复的核心）
  //
  // 背景：倒序扫描（p18→p1）下，逐页学生答案反推会被分数运算单元间的
  // 答案重叠污染（实测 p13/p14/p15 错反推为阶段练1 而非阶段练2，p7 错反推
  // 为阶段练3 而非阶段练4）。用户要求相邻继承必须基于卷面印刷页码，
  // 与上传顺序无关。题号连续性重建物理顺序后，链首页（min_q=1）的单元
  // 归属经 pickAnswerUnit 确认，整链继承——这是目前最强的单元判别信号。
  //
  // 优先级：physicalOverrides > pickAnswerUnit 逐页精确链 > 题号分组兜底。
  // ═══════════════════════════════════════════════════════════════
  const physicalOverrides = _groupByPhysicalContinuity(pageDataList, answersByUnit)
  if (pageGroups.length >= 2) {
    for (const grp of pageGroups) {
      const grpQuestions = grp.pages.flatMap(pg => pg.questions || [])
      if (grpQuestions.length === 0) continue
      // 组级覆盖率（覆盖键含 sub_no，比单页更可靠）。
      // 注意：打平组（逐页预匹配 unitKey=null，如 grp.tie 非空）也必须参与组级反推，
      // 整组题号 + 学生答案样本更足，恰恰是唯一能区分同号多单元的路径。
      let bestUnit = null
      let bestCov = 0
      const candidates = []
      for (const [uk, secMap] of answersByUnit) {
        const cov = coverageOfQuestionsInUnit(grpQuestions, secMap)
        if (cov > bestCov) { bestCov = cov; candidates.length = 0; candidates.push(uk) }
        else if (cov === bestCov && cov > 0) candidates.push(uk)
      }
      if (candidates.length === 0 || bestCov < 0.6) continue // 覆盖不足，放弃（唯一候选也要求 ≥60%，防止同号跨章以低覆盖率错挂）
      let tieUnits = null
      if (candidates.length === 1) {
        // ★ 防护（2026-08-07）：唯一覆盖率候选，但若组内某页带标题且标题指向不同单元，
        // 说明覆盖率命中可能是"题号恰好覆盖"的假象（同号多单元几乎必然打平，唯一候选
        // 大概率是同章姊妹单元，但标题是更强的信号）。标题能精确匹配到别的单元时，
        // 放弃组级兜底，交回逐页标题匹配（titleMatches 更强）。
        let titleConflict = false
        for (const pg of grp.pages) {
          const pt = pg.pageTitle
          if (!pt || typeof pt !== 'string' || pt.length < 3) continue
          const normPt = normalizeTitleForMatch(normalizeSectionName(pt))
          if (!normPt) continue
          for (const c of candidates) {
            const secMap = answersByUnit.get(c)
            if (!secMap) continue
            const sample = [...secMap.values()][0]?.values().next()?.value
            if (!sample) continue
            const ck = normalizeTitleForMatch(sample.unit_key || c)
            const ct = normalizeTitleForMatch(sample.unit_title || '')
            if (ck && titleMatches(normPt, ck)) titleConflict = true
            if (ct && titleMatches(normPt, ct)) titleConflict = true
            if (titleConflict) break
          }
          if (titleConflict) break
        }
        if (titleConflict) {
          console.log(`   [resolveAnswerUnits] 题号分组唯一候选但与组内标题冲突，放弃组级兜底，交回逐页标题匹配`)
          continue
        }
        bestUnit = candidates[0]
      } else {
        // 打平（同号多单元，本次 bug 的直接触发点）：用组内学生答案指纹在候选单元内决胜。
        // 置信门槛：最佳 score ≥ 3 且领先次佳 ≥ 1.0 才采用；否则判定"无法区分"→ 放弃，
        // 交给逐页 pickAnswerUnit + 双向相邻继承，并记录 tieUnits 供 is_suspicious 审计。
        tieUnits = candidates
        const candScores = []
        for (const uk of candidates) {
          const unitAnswers = answersByUnit.get(uk)
          let hits = 0
          let score = 0
          if (unitAnswers) {
            for (const q of grpQuestions) {
              const sa = (q.student_answer || '').toString().trim()
              if (!sa) continue
              if (q.question_type === 'choice' || q.question_type === 'judge') continue
              const found = searchByAnswerFingerprint(sa, q.question_type || 'answer', unitAnswers, new Set())
              if (found && found.score >= 0.7) { hits++; score += found.score }
            }
          }
          candScores.push({ uk, hits, score })
        }
        candScores.sort((a, b) => b.score - a.score)
        const best = candScores[0]
        const second = candScores[1]
        if (best.score >= 3 && second && best.score >= second.score + 1.0) {
          bestUnit = best.uk
          console.log(`   [resolveAnswerUnits] 题号分组 tie 决胜: [${grp.pages.map(p => p.pageNumber).join(',')}] 候选 ${candidates.length} 个 → "${best.uk}" (score=${best.score.toFixed(2)} vs 次佳=${second.score.toFixed(2)})`)
        } else {
          console.log(`   [resolveAnswerUnits] 题号分组 tie 无法区分: [${grp.pages.map(p => p.pageNumber).join(',')}] 候选 ${candidates.length} 个（最佳 score=${best.score.toFixed(2)}, 次佳=${second ? second.score.toFixed(2) : '-'}），放弃交回精细层`)
        }
      }
      if (!bestUnit) {
        // 打平且无法区分：把 tie 候选写入诊断（供 sectionMatch / is_suspicious）
        if (tieUnits) for (const pg of grp.pages) groupTieMap.set(pg.pageNumber, tieUnits)
        continue
      }

      for (const pg of grp.pages) {
        groupOverrides.set(pg.pageNumber, { unitKey: bestUnit, cov: bestCov, tieUnits })
      }
      const pgs = grp.pages.map(p => p.pageNumber).join(',')
      console.log(`   [resolveAnswerUnits] 题号分组命中: [${pgs}] → unit="${bestUnit}" (cov=${(bestCov*100).toFixed(0)}% minQ=${grp.minQ} maxQ=${grp.maxQ})${tieUnits ? ` 决胜自 tie=${tieUnits.length} 个候选` : ''}`)
    }
  }

  // 预扫描：每页独立匹配（含标题匹配/反推/覆盖率/页码兜底），得到锚点
  // ★ 修复：分组覆盖的页【仍然先走 pickAnswerUnit 完整精细链】，分组结果只作
  //   其返回 null 时的兜底，防止分组打平错锚后静默短路全部精细匹配。
  //   返回对象携带 method / groupMatched / groupTie 诊断字段，供 sectionMatch 审计。
  const resolved = pageDataList.map(({ pageTitle, sectionTitle, pageNumber, questions, chapterHint, rawOcrText }, idx) => {
    const groupInfo = groupOverrides.get(pageNumber)
    const groupTie = (groupInfo && groupInfo.tieUnits) ? groupInfo.tieUnits : (groupTieMap.get(pageNumber) || null)
    const physInfo = physicalOverrides ? physicalOverrides.get(pageNumber) : null
    // 物理连续链覆盖优先：链首页的单元经 pickAnswerUnit 确认，链内其余页继承，
    // 不受逐页学生答案反推（分数单元间答案重叠不可靠）干扰。
    if (physInfo) {
      return {
        pageNumber, unitKey: physInfo.unitKey, idx, method: 'physical-chain',
        groupMatched: groupInfo ? groupInfo.unitKey : null,
        groupTie,
        physHomePage: physInfo.homePage,
        physChainPages: physInfo.chainPages,
      }
    }
    const preciseUnit = pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint, sectionTitle, rawOcrText)
    if (preciseUnit) {
      return {
        pageNumber, unitKey: preciseUnit, idx, method: 'precise',
        groupMatched: groupInfo ? groupInfo.unitKey : null,
        groupTie,
        groupConflict: groupInfo ? groupInfo.unitKey !== preciseUnit : false
      }
    }
    if (groupInfo) {
      return {
        pageNumber, unitKey: groupInfo.unitKey, idx, method: 'group-fallback',
        groupMatched: groupInfo.unitKey,
        groupTie
      }
    }
    return { pageNumber, unitKey: null, idx, method: null, groupMatched: null, groupTie }
  })

  // 判断某单元是否能覆盖某页的全部题号（避免把无关页的题号也吸过来）
  // 返回覆盖率 0~1；0 表示完全无交集，1 表示全命中。
  const unitCoverage = (unitKey, questions) => {
    if (!unitKey) return 0
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return 0
    let covered = 0
    for (const q of questions) {
      if (q.question_number == null) continue
      const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { covered++; break }
      }
    }
    if (questions.length === 0) return 0
    return covered / questions.length
  }

  // 双向传播：每个无锚点页**独立**寻找最近的锚点页并继承其单元。
  // 与 BFS 逐轮扩散不同：这里只从"初始锚点"（pre 扫描直接命中）继承，
  // 绝不从"已传播的中间页"再扩散，避免一页错锚导致后续连环带偏。
  //
  // 修复（2026-08-06）：优先用【题号连续性相邻的锚点】继承，回退上传顺序距离。
  // 倒序扫描下上传顺序距离不反映物理相邻——实测 p17(Q24-26) 物理上紧跟 p18
  // (Q20-23，阶段练1)，但上传顺序里它夹在 p16(阶段练2) 与 p18(阶段练1) 之间，
  // 两锚点距离相等、覆盖率相同，旧逻辑取了前者 → p17 错挂阶段练2。
  // 题号连续性（min_q === 前页 max_q + 1 或 本页 max_q + 1 === 后页 min_q）
  // 是卷面物理相邻的等价物，优先采用。
  const anchors = resolved.filter(r => r.unitKey).map(r => r.idx) // 初始锚点索引
  const pageQRange = (i) => {
    const qnos = (pageDataList[i]?.questions || [])
      .map(q => Number(q.question_number))
      .filter(n => Number.isFinite(n))
    return {
      minQ: qnos.length ? Math.min(...qnos) : null,
      maxQ: qnos.length ? Math.max(...qnos) : null,
    }
  }
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].unitKey) continue
    if (anchors.length === 0) continue
    const page = pageDataList[i]
    const { minQ, maxQ } = pageQRange(i)

    // 1) 题号连续性相邻的锚点（物理相邻，最强信号）
    if (minQ != null || maxQ != null) {
      const contAnchors = []
      for (const a of anchors) {
        const ar = pageQRange(a)
        let cont = false
        if (minQ != null && ar.maxQ != null && ar.maxQ + 1 === minQ) cont = true
        else if (maxQ != null && ar.minQ != null && maxQ + 1 === ar.minQ) cont = true
        if (!cont) continue
        const unit = resolved[a].unitKey
        // 排除：该单元已有【其他】锚点页与本页题号范围重叠。
        // 实测 p17(Q24-26) 与 p3(评价测试卷 Q15-23) 题号也连续，但评价测试卷
        // 已有 p2(Q24-27) 覆盖 Q24-26 —— 同一单元内题号不可能重复页，排除 p3。
        const overlapsOther = anchors.some(b => {
          if (b === a) return false
          if (resolved[b].unitKey !== unit) return false
          const br = pageQRange(b)
          return br.minQ != null && br.maxQ != null && !(br.maxQ < minQ || br.minQ > maxQ)
        })
        if (overlapsOther) continue
        contAnchors.push({ idx: a, unit })
      }
      if (contAnchors.length > 0) {
        // 前后都连续时取两侧都出现的单元（同单元两侧页夹住本页）；
        // 否则取唯一候选。极端多候选时取物理距离最近的。
        let chosen = null
        const units = [...new Set(contAnchors.map(c => c.unit))]
        if (units.length === 1) {
          chosen = units[0]
        } else if (contAnchors.length === 2) {
          chosen = contAnchors[0].idx < i ? contAnchors[0].unit : contAnchors[1].unit
        } else {
          let best = null, bestDist = Infinity
          for (const c of contAnchors) {
            const d = Math.abs(c.idx - i)
            if (d < bestDist) { bestDist = d; best = c.unit }
          }
          chosen = best
        }
        resolved[i].unitKey = chosen
        resolved[i].method = 'propagated'
        console.log(`   [AnswerBank] 题号连续继承: pageNumber=${page.pageNumber} → unit="${chosen}"（min_q=${minQ} max_q=${maxQ} 与锚点题号相邻，共 ${contAnchors.length} 个候选）`)
        continue
      }
    }

    // 2) 回退：上传顺序距离（覆盖率优先 + 距离兜底）
    // 找 i 之前最近、之后最近的初始锚点
    let prevA = -1, nextA = -1
    for (const a of anchors) { if (a < i && (prevA === -1 || a > prevA)) prevA = a }
    for (const a of anchors) { if (a > i && (nextA === -1 || a < nextA)) nextA = a }
    if (prevA === -1 && nextA === -1) continue
    //   选择策略（覆盖率优先）：
    //   1) 覆盖率差异显著（高者 ≥ 低者 + 20%）→ 取覆盖率高者
    //   2) 覆盖率相同或相近 → 取距离更近者
    //   3) 仅一侧 → 直接继承
    //   为什么覆盖率优先：倒序扫描场景下物理距离不反映单元归属，
    //   而题号覆盖率（页的 q 范围与单元答案库 q 范围的交集）是单元归属的最强信号。
    let chosen
    const distPrev = prevA >= 0 ? i - prevA : Infinity
    const distNext = nextA >= 0 ? nextA - i : Infinity
    const prevUnit = prevA >= 0 ? resolved[prevA].unitKey : null
    const nextUnit = nextA >= 0 ? resolved[nextA].unitKey : null
    const prevCov = prevUnit ? unitCoverage(prevUnit, page.questions) : 0
    const nextCov = nextUnit ? unitCoverage(nextUnit, page.questions) : 0
    if (prevUnit && nextUnit) {
      if (prevCov >= nextCov + 0.2) chosen = prevUnit
      else if (nextCov >= prevCov + 0.2) chosen = nextUnit
      else chosen = distPrev <= distNext ? prevUnit : nextUnit
    } else {
      chosen = nextUnit || prevUnit
    }
    // ★ 防护（2026-08-07）：继承后校验本页题号确实被所选单元覆盖（覆盖率下界）。
    // 双向继承可能把"仅因相邻/距离近"的页错拉进无关单元（本页题号范围与所选单元
    // 答案库完全无交集时覆盖率=0，继承就是纯错挂）。覆盖率 <0.2 且本页题号不落
    // 在所选单元 max 范围内 → 拒绝继承，保持 null 交回"待审"通道，而非静默错挂。
    let inherited = chosen
    const covOfChosen = chosen ? unitCoverage(chosen, page.questions) : 0
    if (chosen) {
      const secMap = answersByUnit.get(chosen)
      let unitMax = -Infinity
      if (secMap) {
        for (const qMap of secMap.values()) {
          for (const key of qMap.keys()) {
            const qn = Number(String(key).split('|')[0])
            if (Number.isFinite(qn) && qn > unitMax) unitMax = qn
          }
        }
      }
      const pageMaxQ = maxQ
      const withinUnitRange = pageMaxQ != null && pageMaxQ <= unitMax
      if (covOfChosen < 0.2 && !withinUnitRange) {
        console.log(`   [AnswerBank] 双向继承防护: p${page.pageNumber} 在 "${chosen}" 覆盖率=${covOfChosen.toFixed(2)} 且题号超单元范围(${pageMaxQ} > ${unitMax})，拒绝继承，交回待审`)
        inherited = null
      }
    }
    if (inherited) {
      resolved[i].unitKey = inherited
      resolved[i].method = 'propagated'
      console.log(`   [AnswerBank] 双向相邻继承: pageNumber=${page.pageNumber} → unit="${inherited}" (distPrev=${distPrev} distNext=${distNext} prevCov=${prevCov.toFixed(2)} nextCov=${nextCov.toFixed(2)})（相邻锚点传播）`)
    } else {
      resolved[i].unitKey = null
      resolved[i].method = null
    }
  }

  return resolved.map(({ pageNumber, unitKey, method, groupMatched, groupTie, groupConflict }) => ({
    pageNumber, unitKey, method, groupMatched, groupTie, groupConflict
  }))
}

// 简单字符串相似度（归一化后基于最长公共子序列 LCS 长度比）
function stringSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const m = a.length, n = b.length
  if (m === 0 || n === 0) return 0
  // 优化：长度差过大时直接返回 0
  if (Math.abs(m - n) > Math.max(2, Math.min(m, n) * 0.3)) return 0
  // 动态规划 LCS
  const dp = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    let prev = 0
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1])
      }
      prev = tmp
    }
  }
  return dp[n] / Math.max(m, n)
}

// 标题匹配策略：
//  - 完全相等 → 命中
//  - 一侧是另一侧的子串 → 命中（"堂堂练② 19.1(2)平方根" ∈ "堂堂练② 19.1(2)平方根拓展"）
//  - 一侧是另一侧的「有效前缀/后缀」→ 命中
//    例：pageTitle="第十九章 单元测试卷" / unitTitle="第十九章" → 前缀命中
//    例：pageTitle="第十九章" / unitTitle="第十九章 单元测试卷" → 后缀命中
//  - 子串匹配要求长侧 ≥ 短侧 2 字符以上，避免单字符"1"误中"19.1(1)"
function titleMatches(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  // 包含关系：仅在长度差 ≤ 2 字符时接受
  //   修复前：minLen>=2 即通过 → pageTitle="第十九章实数"(6) 被 unitTitle="试卷⑥第十九章实数提高性测试"(14)
  //   误中（实测选到试卷6而非试卷3|19.2）。OCR 漏识别试卷小标题只返回大章级标题时，
  //   "包含"是子串错挂的元凶，必须用"长度差"卡掉大章级 → 完整标题的误中。
  if (a.includes(b) || b.includes(a)) {
    if (Math.abs(a.length - b.length) > 2) return false
    return Math.min(a.length, b.length) >= 2
  }
  // 前缀/后缀匹配：仅在长度差 ≤ 2 时启用，避免"第十九章"误中"第十九章阶段练"
  const lenDiff = Math.abs(a.length - b.length)
  if (lenDiff > 2) return false
  if (a.length <= b.length ? b.startsWith(a) : a.startsWith(b)) return true
  if (a.length <= b.length ? b.endsWith(a) : a.endsWith(b)) return true
  return false
}

// 兼容旧调用：pickAnswerSection 已废弃。业务已切到 pickAnswerUnit + getWorksheetAnswersBySection 的 3D 结构。
// 保留仅为防止外部 import 报错；返回 null 等同"无匹配"，调用方应改用 pickAnswerUnit。
// eslint-disable-next-line no-unused-vars
export function pickAnswerSection(_answersBySection, _pageTitle, _questions) {
  if (typeof console !== 'undefined') {
    console.warn('[worker] pickAnswerSection 已废弃，请改用 pickAnswerUnit(3D Map)')
  }
  return null
}

// ═══════════════════════════════════════════════
// 答案指纹匹配（OCR 题号错位兜底）
// ═══════════════════════════════════════════════
//
// ⚠️ 关键洞察：答案库 resource_answers.content 字段全空（虽然表结构有但数据没填），
// 没办法用"题目 ↔ 题目"匹配。OCR 题号错位时（OCR 读出 22 但答案库 22(1) 是另一道题），
// 必须用"答案 ↔ 答案"做兜底。
//
// 策略：
// 1) normalizeAnswerFingerprint：把答案字符串归一化（去空格、统一根式、统一分号）
// 2) calculateAnswerSimilarity：完全相等=1.0；归一化相等=0.95；包含=0.85；数字部分相同=0.7
// 3) searchByAnswerFingerprint：在同 unit 同 answer_type 内找最相似的题

/**
 * 题干垃圾内容检测：OCR 把印刷体题干识别成"× ×"、"÷ = × ×"这类无意义符号时判定为垃圾。
 * - 无数字、无汉字、无字母 → 纯符号
 * - 极短纯符号串（如 "= = ="、"x÷ = × x="、"÷ = × ×."）
 * 简答题/解答题/计算题的题干几乎必然含汉字描述或数字，纯符号题干基本是识别错误。
 * 返回 true 表示题干疑似识别错误，应触发重试或标记人工确认。
 */
function isGarbageQuestionContent(content) {
  if (content == null) return false
  const t = String(content).replace(/\s+/g, '')
  if (t.length === 0) return false
  // 无数字、无汉字、无字母 → 纯符号
  const hasSubstance = /[0-9\u4e00-\u9fa5a-zA-Z]/.test(t)
  if (!hasSubstance) return true
  // 极短纯符号串如 "= = ="、"x÷ = × x="、"÷ = × ×."
  if (t.length <= 12 && /^[=×÷\-+×:.()，。、"'xX]{1,12}$/.test(t)) return true
  return false
}

/**
 * 稀疏题干检测：OCR 只识别出指令词（如"计算："、"解方程："）但丢失了算式主体时判定为稀疏。
 * 这类题干虽含汉字（不会被 isGarbageQuestionContent 捕获），但对计算/解答题来说算式才是题干核心，
 * 只有"计算："无法向学生/家长展示题目内容，也影响章节反推。
 * 返回 true 表示题干缺失算式，应触发"区域聚焦重 OCR"补全。
 */
function isSparseQuestionContent(content) {
  if (content == null) return false
  const t = String(content).replace(/\s+/g, '').replace(/[：:、]/g, '')
  if (t.length === 0) return false
  // 仅含指令词（计算/化简/解方程/求值/口算/算一算等），不含任何算式成分（数字/变量/运算符）
  if (/^(计算|化简|解方程|求值|口算|算一算|直接写得数|脱式计算|简算|想一想|比一比|估一估|求下列各式的值|求未知数x)$/.test(t)) return true
  return false
}

/**
 * 区域聚焦重 OCR：整页识别对复杂数学题干（分数/带分数/分式方程）易丢失算式主体，
 * 只输出"计算："这类指令词。用该题的 block_coordinates（归一化 0-1000）从原图裁剪
 * 题目区域，放大后单独请求 VLM 转录完整算式，用返回内容覆盖稀疏题干。
 * @param {string} imageUrl - 页面原图 URL
 * @param {object} normBox - 归一化 0-1000 坐标 {x, y, width, height}
 * @param {string|number} questionNumber - 题号（用于提示词）
 * @param {string} userText - 额外识别指引（如"这是计算题，需完整转录算式"）
 * @returns {Promise<string|null>} 识别到的完整题干，失败返回 null
 */
async function reocrQuestionRegion(imageUrl, normBox, questionNumber, userText = '') {
  if (!imageUrl || !normBox) return null
  let imageBuffer
  try {
    imageBuffer = await downloadImage(imageUrl)
  } catch (e) {
    console.warn(`  ⚠️ [区域重OCR] 图片下载失败: ${e.message}`)
    return null
  }
  const meta = await sharp(imageBuffer).metadata()
  const imgW = meta.width
  const imgH = meta.height
  if (!imgW || !imgH) return null

  // 归一化 0-1000 → 像素坐标，加 20% 内边距（与错题裁剪逻辑一致），钳位到图边界
  const clamp = (v) => Math.max(0, Math.min(1000, Number(v) || 0))
  const toPx = (v, dim) => Math.round(clamp(v) / 1000 * dim)
  let left = toPx(normBox.x, imgW)
  let top = toPx(normBox.y, imgH)
  let width = toPx(normBox.width, imgW)
  let height = toPx(normBox.height, imgH)
  const padX = Math.round(width * 0.20)
  const padY = Math.round(height * 0.20)
  left = Math.max(0, left - padX)
  top = Math.max(0, top - padY)
  width = Math.min(width + padX * 2, imgW - left)
  height = Math.min(height + padY * 2, imgH - top)
  if (width <= 0 || height <= 0) return null

  let cropped
  try {
    cropped = await sharp(imageBuffer)
      .rotate()
      .extract({ left, top, width, height })
      .resize(1800, 1800, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch (e) {
    console.warn(`  ⚠️ [区域重OCR] 裁剪失败: ${e.message}`)
    return null
  }

  const focusPrompt = `你是专业的数学试卷OCR助手。这张图片是从试卷上裁剪出的【一道题目】的区域。

【任务】识别这道题的【印刷体题干原文】，特别是其中的数学算式，必须完整、准确地转录。

【数学符号识别规范】
- 题干中的数学式子必须完整转录，禁止漏写、替换或臆造符号。
- 分数用"a/b"格式（如"17/20"），带分数用"整数 a/b"格式（如"6 2/3"）。
- 乘号用"×"，除号用"÷"，根号用"√"，小数点"."，百分号"%"必须原样保留。
- 区分乘号"×"与字母"x/X"：算式中间表示相乘用"×"；方程未知数用"x"。
- 若题干含"计算""化简""解方程""求值"等指令词，必须完整保留。
- 若某处印刷体模糊无法辨认，用"□"占位，不要臆造。

只输出 JSON 对象，不要其他文字：
{
  "question_number": ${questionNumber},
  "content": "该题的完整题干原文，含完整算式"
}`

  try {
    const { content } = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${cropped.toString('base64')}`,
      systemPrompt: focusPrompt,
      userText: `请识别这道题（第${questionNumber}题）的完整题干，务必完整转录算式。${userText}`,
      temperature: 0.05,
      maxTokens: 1024
    })
    if (!content) return null
    const parsed = JSON.parse(stripCodeFence(content))
    const c = (parsed && typeof parsed === 'object') ? (parsed.content || null) : null
    if (c && typeof c === 'string' && String(c).trim()) {
      let newContent = String(c).trim()
      // 归一化 LaTeX/Unicode 数学表示 → 与系统其余部分一致的纯文本算式：
      //   带分数 \frac 前有整数部分 → "2 \frac{2}{7}" → "2 2/7"（先处理，避免粘连成 22/7）
      //   纯分数 \frac{2}{7} → 2/7，\times → ×，\div → ÷，\sqrt → √，
      //   Unicode 乘号变体 ✕✖ → ×，去除 LaTeX 数学模式符 $，去掉句子末尾句号
      newContent = newContent
        .replace(/\$/g, '')
        .replace(/(\d+)\s*\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1 $2/$3')
        .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1/$2')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\sqrt/g, '√')
        .replace(/[✕✖]/g, '×')
        .replace(/\\left|\\right/g, '')
        .replace(/[{}]/g, '')
        .replace(/\s+([×÷=])/g, '$1')
        .replace(/([×÷=])\s+/g, '$1')
        // 一元/二元加减号保留空格（-17 前无空格是负号，- 17 前后有空格是减号）
        .replace(/\s+/g, ' ')
        .replace(/[。.]$/, '')
        .trim()
      // 若聚焦识别仍产出稀疏/垃圾题干，视为失败，避免覆盖已有内容
      if (isSparseQuestionContent(newContent) || isGarbageQuestionContent(newContent)) return null
      return newContent
    }
    return null
  } catch (e) {
    console.warn(`  ⚠️ [区域重OCR] 第${questionNumber}题识别失败: ${e.message}`)
    return null
  }
}

/**
 * 答案字符串归一化（用于题号错位时的兜底匹配）
 * - 去 LaTeX 数学模式符（$...$）
 * - 统一根式：\sqrt / 根号 → √
 * - 处理 LaTeX 分数命令：\frac{a}{b} → a/b（先于去空白，避免带分数粘连）
 * - 统一乘除：\times → ×，\div → ÷
 * - 去大括号（LaTeX 残留）
 * - 中英文标点统一（，→ , ； → ;）
 * - 大小写不敏感
 */
function normalizeAnswerFingerprint(s) {
  if (s == null) return ''
  return String(s)
    .replace(/\$/g, '')                              // 去 LaTeX 数学模式符
    .replace(/\\times/g, '×')                        // \times → ×
    .replace(/\\div/g, '÷')                          // \div → ÷
    .replace(/[✕✖]/g, '×')                          // Unicode 乘号变体 → ×
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1/$2')  // \frac{a}{b} → a/b
    .replace(/\\sqrt\s*\{?/g, '√')                   // \sqrt{ → √；\sqrt → √
    .replace(/根号/g, '√')                            // 根号 → √
    .replace(/[{}]/g, '')                            // 去大括号
    .replace(/\s+/g, '')                             // 去所有空白
    .replace(/，/g, ',')                              // 中文逗号 → ASCII
    .replace(/；/g, ';')                              // 中文分号 → ASCII
    .replace(/。/g, '.')                              // 中文句号 → .
    .replace(/（/g, '(')                              // 中文括号 → ()
    .replace(/）/g, ')')
    .toLowerCase()
    .trim()
}

/**
 * 答案相似度评分（0-1）
 * - 1.0：完全相等
 * - 0.95：归一化后相等
 * - 0.85：一方包含另一方（子串）
 * - 0.7：数字序列相同（应对 √2 → 2√ 等表达差异）
 * - 0：完全不匹配
 */
export function calculateAnswerSimilarity(studentAns, refAns) {
  if (!studentAns || !refAns) return 0
  // ★ 收窄 student 到最终答案：过程型 "√(12/3)=√4=2" → "2"；"8-9=-1" → "-1"
  //   避免过程字符串与参考答案（结果）相似度为 0 被判错。
  //   收窄是幂等的：已经是最终答案的 "2" 不含 = ；， 收窄后仍为 "2"，无副作用。
  //   refAns 不收窄（参考答案保持原样，可能含等号表达式）。
  let sRaw = String(studentAns).trim()
  if (sRaw.includes('=')) sRaw = sRaw.slice(sRaw.lastIndexOf('=') + 1).trim()
  if (sRaw.includes(';') || sRaw.includes('；')) sRaw = sRaw.split(/[;；]/).pop().trim()
  // 纯比较符号答案（如 "> , <"）：逗号是多个比较符号的分隔（"3 > , < 5" 类），不是"多空最后答案"，
  // 不能按逗号收窄成末段，否则 "> , <" 被收窄成 "<" 导致正确答案被误判。直接去逗号整体比较。
  const isPureSymbolAnswer = /^[<>≥≤≠，, ]+$/.test(sRaw)
  if (isPureSymbolAnswer) sRaw = sRaw.replace(/[，,]/g, '')
  else if (sRaw.includes(',') || sRaw.includes('，')) sRaw = sRaw.split(/[,，]/).pop().trim()
  const rRaw = String(refAns).trim()
  if (sRaw === rRaw) return 1.0
  const sNorm = normalizeAnswerFingerprint(sRaw)
  const rNorm = normalizeAnswerFingerprint(rRaw)
  if (!sNorm || !rNorm) return 0
  if (sNorm === rNorm) return 0.95
  // 包含关系（短的包含在长的中）
  if (sNorm.includes(rNorm) || rNorm.includes(sNorm)) {
    const shorter = Math.min(sNorm.length, rNorm.length)
    const longer = Math.max(sNorm.length, rNorm.length)
    if (shorter >= 2 && longer / shorter <= 1.5) return 0.85
    // 应用题最终答案兜底：短串是"最终答案"（数字为主，可带纯单位/括号/标点），
    // 只要它整体出现在长串（学生答案）中，就视为实质命中。
    // 覆盖：学生答案 = 计算过程 + 最终答案（"…=1998(个) 答：有1998个。" vs "1998个"），
    // 纯过程/单位干扰使 longer/shorter 远超 1.5，旧逻辑拒绝 → 单元反推失败挂错单元。
    // 约束：短串长度 ≤ 12 且必须包含至少一个数字（避免"答："等无实质内容误中）。
    // 短串即最终答案：sNorm.includes(rNorm) 时 rNorm 更短，否则 sNorm 更短。
    const shortStr = sNorm.length < rNorm.length ? sNorm : rNorm
    if (shorter >= 2 && shorter <= 12 && /\d/.test(shortStr)) return 0.8
  }
  // 数字序列相同
  const sNums = (sNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  const rNums = (rNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  if (sNums && sNums === rNums && sNums.length >= 2) return 0.7
  return 0
}

/**
 * 在同 unit 内按"答案指纹"搜索最相似的题
 * @param {string} studentAnswer - 学生手写答案（OCR 识别）
 * @param {string} qType - 题型（choice/fill/answer/judge）
 * @param {Map} unitAnswers - unit 的 secMap (sectionKey → qKey → row)
 * @param {Set} usedKeys - 已被其他题占用的 qKey（避免重复匹配）
 * @returns {{ row, qKey, score } | null}
 */
export function searchByAnswerFingerprint(studentAnswer, qType, unitAnswers, usedKeys) {
  if (!studentAnswer || !unitAnswers) return null
  const trimmed = String(studentAnswer).trim()
  if (!trimmed) return null

  // 选择题/判断题答案太短（单字符 A/B/C/D/√/×），
  // 答案指纹搜索容易误匹配（如学生答 C，答案库有 3 道题答案都是 C），
  // 而且选择题题干才能确定答案，单字符匹配不能作为批改依据。
  // 因此选择题/判断题**跳过**答案指纹兜底，避免把真错题改对。
  const isChoiceLike = (t) => t === 'choice' || t === 'judge'
  if (isChoiceLike(qType)) return null

  let best = null
  let bestScore = 0
  for (const qMap of unitAnswers.values()) {
    for (const [qKey, row] of qMap) {
      if (usedKeys.has(qKey)) continue
      // 答案类型必须一致（选择题不能匹配解答题，除非都是非选择题）
      const rowType = row.answer_type || 'answer'
      const ocrType = qType || rowType
      if (rowType !== ocrType) {
        // 选择题/判断题跟解答题互不匹配
        if (isChoiceLike(rowType) !== isChoiceLike(ocrType)) continue
      }
      // 选择题/判断题也不参与兜底搜索（答案库端也跳过）
      if (isChoiceLike(rowType)) continue
      const refAns = row.answer
      if (!refAns) continue
      const score = calculateAnswerSimilarity(trimmed, refAns)
      if (score > bestScore) {
        bestScore = score
        best = { row, qKey, score }
      }
    }
  }
  // 阈值 0.7 才采用（避免"完全不匹配"反而误用）
  return bestScore >= 0.7 ? best : null
}

/**
 * 用学生答案反推最可能的 unit（无标题/无章节提示/无继承时兜底）
 *   对每道非选择/判断题，跨所有 unit 搜索最相似的答案行，
 *   统计每个 unit 的命中题数和总相似度，取最佳。
 *   选择题/判断题不参与（答案太短，易误匹配）。
 * @param {Array} questions - OCR 识别出的题目列表（含 student_answer, question_type）
 * @param {Map} answersByUnit - unitKey → secMap
 * @param {Array<{unitKey:string}|string>} [candidateUnits] - 候选单元范围（pickAnswerUnit 收窄后）。
 *   ★ 2026-08-07 修复：必须限定在候选内反推，禁止传全库 answersByUnit——否则学生答案反推
 *   无视前面标题/章节/lesson_code 收窄，被题号恰好覆盖的无关单元抢走（实测"二次根式运算"
 *   卷第 2 页被 堂堂练24|21.4(2) 抢走、第 1 页被 试卷3|19.2 实数卷抢走，整页答案错挂）。
 * @returns {{ unitKey, hits, totalScore } | null}
 */
export function searchUnitByStudentAnswers(questions, answersByUnit, candidateUnits) {
  if (!questions || questions.length === 0 || !answersByUnit || answersByUnit.size === 0) return null
  const isChoiceLike = (t) => t === 'choice' || t === 'judge'

  // 候选 unitKey 白名单：收窄后的候选集合；未传则保持全库（旧行为，兼容外部调用）
  const allowedKeys = Array.isArray(candidateUnits) && candidateUnits.length > 0
    ? new Set(candidateUnits.map(c => (c && typeof c === 'object' && c.unitKey) ? c.unitKey : c))
    : null

  const unitScores = new Map() // unitKey → { hits, totalScore }

  for (const q of questions) {
    const studentAnswer = (q.student_answer || '').toString().trim()
    if (!studentAnswer) continue
    const qType = q.question_type || 'answer'
    if (isChoiceLike(qType)) continue

    for (const [unitKey, unitAnswers] of answersByUnit) {
      if (allowedKeys && !allowedKeys.has(unitKey)) continue
      const found = searchByAnswerFingerprint(studentAnswer, qType, unitAnswers, new Set())
      if (found && found.score >= 0.7) {
        if (!unitScores.has(unitKey)) unitScores.set(unitKey, { hits: 0, totalScore: 0 })
        const s = unitScores.get(unitKey)
        s.hits++
        s.totalScore += found.score
      }
    }
  }

  if (unitScores.size === 0) return null

  let bestUnit = null
  let bestTotalScore = 0
  for (const [unitKey, score] of unitScores) {
    if (score.totalScore > bestTotalScore) {
      bestTotalScore = score.totalScore
      bestUnit = unitKey
    }
  }

  const best = unitScores.get(bestUnit)
  // 采用条件：≥2 道题命中，或总相似度 ≥ 1.5（至少 2 道较强匹配）
  if (best.hits >= 2 || best.totalScore >= 1.5) {
    // ★ 防护（2026-08-07）：优势检验——最佳必须显著领先次佳才采用。
    // 姊妹单元（试卷9|20.2 vs 试卷10|20.2、堂堂练24 vs 堂堂练25 等）题号都从 1 开始、
    // 题型结构相似、部分答案雷同，2 道题弱命中完全可能同时命中多个单元。
    // 若最佳只比次佳多一点点（差 <0.8 或 命中数相同），说明"无法可靠区分"，
    // 返回 null 交回标题/物理链/继承等更强信号，绝不靠微弱领先硬选（防再错挂）。
    const sortedScores = [...unitScores.entries()]
      .sort((a, b) => b[1].totalScore - a[1].totalScore)
    const second = sortedScores[1] ? sortedScores[1][1] : null
    let hasAdvantage = true
    if (second && second.totalScore > 0) {
      const gap = best.totalScore - second.totalScore
      // 绝对差 < 0.8（约 1 道 0.8 相似度的题）且命中数相同 → 无法区分
      if (gap < 0.8 && best.hits <= second.hits + 1) hasAdvantage = false
    }
    if (hasAdvantage) {
      return { unitKey: bestUnit, hits: best.hits, totalScore: best.totalScore }
    }
    console.log(`[searchUnitByStudentAnswers] 最佳 "${bestUnit}" score=${best.totalScore.toFixed(2)}（hits=${best.hits}）与次佳 "${second ? sortedScores[1][0] : '-'}" score=${second ? second.totalScore.toFixed(2) : '-'}（hits=${second ? second.hits : '-'}）差距过小，无法可靠区分，放弃反推`)
  }
  return null
}

export const processWorkbookGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, worksheetId, images: jobImages, forceUnitId } = job.data
  const startTime = Date.now()

  // workbook 的学科以已选择的练习册资源为权威来源；客户端/旧任务字段只作兜底。
  // 这样即使历史任务的 tasks.subject 为空，批改仍能把正确学科传播到题目和错题本。
  const { rows: subjectRows } = await query(
    `SELECT r.subject AS resource_subject, t.subject AS task_subject
       FROM ${TABLES.TASKS} t
       LEFT JOIN ${TABLES.RESOURCES} r
         ON r.id = t.worksheet_id AND r.resource_type = 'worksheet'
      WHERE t.id = $1 AND t.worksheet_id = $2
      LIMIT 1`,
    [taskId, worksheetId]
  )
  const normalizeSubject = (value) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    return normalized || null
  }
  const workbookSubject = normalizeSubject(subjectRows[0]?.resource_subject)
    || normalizeSubject(job.data.subject)
    || normalizeSubject(subjectRows[0]?.task_subject)
    || null

  // 任务元数据也自愈：只补空值，不覆盖已有任务字段，避免改动历史人工记录。
  if (workbookSubject && taskId) {
    await query(
      `UPDATE ${TABLES.TASKS}
          SET subject = $1, updated_at = NOW()
        WHERE id = $2 AND (subject IS NULL OR BTRIM(subject) = '')`,
      [workbookSubject, taskId]
    )
  }

  console.log(`\n📘 [Workbook] 开始练习册批改 taskId=${taskId}, worksheetId=${worksheetId}, subject=${workbookSubject || '未设置'}`)

  // 1. 收集所有待处理的图片URL（支持多页）
  const resolveUrl = (url) => {
    if (typeof url === 'string') return url.startsWith('{') ? (JSON.parse(url).url || '') : url
    return url?.url || String(url || '')
  }

  let imageList
  if (Array.isArray(jobImages) && jobImages.length > 0) {
    imageList = jobImages.map(img => ({
      image_url: resolveUrl(img.image_url),
      page_number: img.page_number || 0
    }))
  } else {
    // 降级：只有单张图片
    imageList = [{ image_url: resolveUrl(rawImageUrl), page_number: 1 }]
  }

  imageList = imageList.filter(img => img.image_url?.startsWith('http'))

  if (imageList.length === 0) {
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: '所有图片URL无效', errorType: 'INVALID_URL'
    })
    throw new Error('所有图片URL无效')
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5, startedAt: new Date().toISOString() })

  // 2. 逐页处理：下载 → 压缩 → OCR → 解析
  const workbookPrompt = `你是一个专业的学生手写答案识别助手。请从作业图片中提取页面标题和每道题的题号、学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer

只输出 JSON 对象，格式：
{
  "page_title": "页面顶部印刷体标题。注意区分层级：'堂堂练① 19.1(1) 算术平方根'（课时练习）、'试卷① 19.1 平方根与立方根 基础性测试'（课时测试卷）、'第二章 评价测试卷'/'第十九章 单元测试卷'（章级/综合测试卷）。'试卷N'与'第X章...测试卷'是不同单元，必须如实区分输出，不要简化或省略，没有则填 null",
  "section_title": "正文里印着的【本页课时小标题】，形如'27.3（2）已知图像上三点求二次函数的表达式'、'19.1(1) 算术平方根'、'27.2（4）二次函数的图像与性质'；整页没有则填 null",
  "lesson_code": "本页印刷的【课时编号】本身，形如 '27.3(2)'、'19.1(1)'、'27.2（3）'。只填编号，不要带后面的标题文字（如填 '27.3(2)' 而不是 '27.3（2）已知图像上三点求二次函数的表达式'）；整页找不到这种编号才填 null",
  "chapter_hint": "根据题目内容推断的章节名，如'第二十章二次根式'，不确定就填 null",
  "questions": [
    {
      "question_number": 1,
      "sub_no": "1",  // 如果该题包含多个小问（如 21.(1)、21.(2)），填写小问号 1/2/3...；否则填 null
      "parent_stem": null,  // ⚠️多小问大题必填：(1) 之前的公共题干原文（公共条件、公共图形描述、公共设问前提）。同一大题拆出的每个小问，parent_stem 必须逐字相同；没有小问的题填 null
      "content": "题目原文（印刷体题干，含题号描述，如'与数轴上的点一一对应的是'，选择题可写'下列各式中正确的是'）",
      "options": ["选项A的正文", "选项B的正文", "选项C的正文", "选项D的正文"],
      "student_answer": "学生手写的答案文本，没有则填 null",
      "question_type": "choice",  // choice | fill | judge | answer
      "block_coordinates": { "x": 120, "y": 300, "width": 760, "height": 90 },
      "image_type": "geometry/chart/none",
      "image_bbox": null,  // 有配图时填 { "x": 640, "y": 180, "width": 200, "height": 130 }（只框图形本身）
      "has_figure": false  // true=本题有配图并对图形本身给出了 image_bbox
    }
  ]
}

注意：
- page_title 从页面页眉/大标题的印刷体读取，尽量完整（包括圈序号 ①②③、课时编号 19.1(1) 等关键信息）。
  它是批改时定位答案库的关键锚点——必须如实输出，绝不要省略或简化。
  例如：识别到"堂堂练①  19.1(1)  算术平方根"就必须原样输出整串，不要简化为"堂堂练1"。

⚠️【lesson_code 是本管线最重要的锚点，必须优先保证】
  它是"这一页到底属于哪一课时"的唯一硬凭据，缺失会让这一页的参考答案全部取错。
  规则：
  1) 「课时编号」= "数字.数字" 或 "数字.数字(数字)" 形式，如 27.3(2)、19.1(1)、27.2（3）、30.1。
     lesson_code 只填这个编号本身，括号统一用半角，不要带任何后续标题文字。
  2) 【它可能出现在页面的任何位置】—— 不一定在页眉。可能在页眉下方一行大字、
     可能在页面正中、也可能与书名印在同一行。请通读整页后再填。
  3) ⚠️ 练习册页眉常见【两行标题】的排版：
     第一行是全书通用的书名跑马灯（如「新闵学校"成长·桥"练习 第01周」「数学堂堂清」），
        → 这一行填 page_title；
     第二行才是本页真正的课时标题（如「27.3（2）已知图像上三点求二次函数的表达式」），
        → 这一行整句填 section_title，其中的编号 "27.3(2)" 填 lesson_code。
     绝不能因为第一行有书名就忽略第二行——第二行才是本页的归属依据。
  4) 整页确实没有任何"数字.数字"形式的课时编号（如整本是单元测试卷、期中期末卷）时，
     lesson_code 与 section_title 都填 null，不要用书名、栏目名、题号去凑。

⚠️【关键】如果页面顶部看不到印刷体页眉/标题（被裁掉、模糊、或本就是"二、选择题 + 简答题"这类无章节标题的排版），
  绝对不能把 page_title 留为 null！必须根据本页【题目内容特征】推断最可能的章节标题并填入：
  - 题目出现 √、±√、二次根式、根号运算、平方根、立方根 → 填 "第二十章二次根式"
  - 题目出现实数、无理数、有理数、相反数、绝对值、数轴、科学记数法、近似数 → 填 "第十九章实数"
  - 题目出现一元二次方程、求根公式、判别式、根与系数 → 填 "第二十一章一元二次方程"
  - 题目出现直角三角形、勾股定理、角平分线 → 填 "第二十二章直角三角形"
  - 其他情况：根据题号所在范围 + 内容特征推断；实在判断不出，填 "未知章节"。
  page_title 缺失会导致后端无法定位答案库而错挂章节，批改结果"一塌糊涂"。

- chapter_hint 必须填！当 page_title 拿不准章节时，chapter_hint 是关键的兜底信号。
  填法与上面 page_title 的章节推断规则完全一致。

- content 必须填：每道题的题干原文（印刷体），至少包含这道题在问什么。
  选填题可写"下列各式中正确的是"或"与数轴上的点一一对应的是"等；
  计算题可写"(1) √12 × √(1/3)"；填空题可写"某数..."。
  它的作用是：后端会用 content 里的关键数学符号（√、根号等）反推章节归属。
  content 缺失会导致章节无法反推。

- 配图字段（image_type / image_bbox / has_figure）必须填（2026-09-21 补，与日常批改管线同口径）：
  ⚠️ 2026-09-20 事故：本 prompt 原先没有配图字段，全卷「如图」的几何题配图从未被采集，
  落库后 geometry_image_url 全空 → 错题本/周末课件题单/讲题白板里的几何题没有图，
  学生在白板上看到的是一道没有图形的几何证明题。**引图题漏填 image_bbox 等同于这道题不可用。**
  · image_type：图形类别，"geometry"（几何图/示意图）| "chart"（函数图/统计图表）| "none"（无配图）。
  · image_bbox：**配图本身**的外接矩形（0-1000 归一化，与 block_coordinates 同一坐标系）；
    只框图形（几何图、函数图、统计图表、示意图），不要把题干文字、选项文字、答题横线框进去。
    没有配图时填 null。
  · has_figure：本题是否有配图并给出了 image_bbox（true/false）。
  · ⚠️ 常见排版陷阱：很多试卷把好几道题的配图集中排成一行，图的正下方标注"第1题图"
    "第2题图"…，而不是把图放在各自题目的正下方。遇到这种排版，必须按下方标注找到
    属于本题的那一格图，只框那一格（例如第2题就框标注"第2题图"的那一张），
    绝不能框题干下面的那条文字，也不要把整行图全框进来。
  · 如果确实找不到本题的配图，image_type 填 "none"、image_bbox 填 null、has_figure 填 false，
    **不要用题干区域的坐标凑一个框**——凑出来的框裁出的是文字，会被当成配图展示给学生。
  · ⚠️ 多小问大题（拆成多行输出、公共题干写在 parent_stem）：如果图形出现在公共题干里
    （公共题干含"如图/图1/图示/附图/见图"），那么**拆出来的每一个小问都必须返回同一个
    image_type 与 image_bbox**（同一个图形，坐标逐字相同），不能只在其中一个小问上返回、
    也不能都不返回。小问自己另配图时，才返回它自己的框。

- options 必须填：**凡是卷面印了 A、B、C、D 选项的题，都要把选项完整填进 options**。
  ⚠️ 2026-09-18 事故：本 prompt 原先没有 options 字段，选择题的选项从未被采集，
  落库后 options=[] → 周末课件题单/讲题白板只剩「题干 + 参考答案 D」，老师看不到 A/B/C/D，
  误以为识别失败。**选择题漏填 options 等同于这道题不可用**，必须逐题检查。
  - 只填【选项正文】，绝不能带 A/B/C/D 标号：卷面印的「（A）3/4」「(B) 4/3」「A. apple」
    要去掉标号，只留 ["3/4", "4/3", "apple"]，按 A、B、C、D 顺序排列。
    标号由界面按顺序自动生成，options 里再带一遍会显示成 "A. （A）3/4"。
  - 选项是【图形】时（如「下列作图中正确的是」配四张图），填该选项图的简短描述，
    形如 ["选项A图", "选项B图", "选项C图", "选项D图"]，或带上能区分四张图的特征
    （如 ["图A：开口向上的抛物线与斜率为正的直线", …]）。
    **绝不能因为选项是图就把 options 留空。**
  - 判断题的 options 填 ["正确", "错误"]。
  - 填空题/解答题等非选择题 options 填 []。
  - 选项正文里的分数、根号、指数按「数学符号识别规范」原样转录（如 "3/8"、"√15/15"）。

【数学符号识别规范（印刷体题干，必须严格遵守）】
- 题干中的数学式子必须完整、准确地转录，禁止漏写、替换或臆造符号。
- 严格区分三种"叉形"符号：
  · 算式中间表示相乘的是乘号"×"（如"3×4"、"√12 × √(1/3)"）；
  · 出现在未知数/方程/代数式里的是字母"x/X"（如"x²-3x+2=0"、"x÷3"）；
  · 判断题批改标记、或题干里明确是判断结果时才用"√/✗"。
  绝不要用"×"去替代方程里的字母 x，也不要把题干文字里的打叉当成乘号。
- 除号"÷"、分数线"/"、根号"√"、平方"²"、立方"³"、指数、小数点"."、百分号"%"必须原样保留。
- 题干里的填空横线"____"、括号"（ ）"、空格占位要原样保留，不要删掉也不要擅自填写。
- 若某处印刷体实在模糊无法辨认，用"□"占位，绝不要输出一堆无意义的符号（如"× ×"、"% = %"、"= = ="）。
- 判断题/简答题题干若含"对/错""下列……正确的是""计算""化简""求值""求证""解方程"等文字，必须完整保留这些文字。
- ⚠️ 简答题/解答题/计算题的题干一定包含汉字描述或数字（如"计算"、"化简"、"解方程"、"求值"）。
  如果识别出的 content 全部是符号、不含任何汉字和数字（如"÷ = × ×"），说明识别错误，
  必须重新仔细查看该题印刷体原图后重新填写真实题干。
- 分数与紧邻自变量字符的边界（易错点，必须严格遵守）：
  · 当分数 1/3、2/5、a/b 后面紧接独立自变量（x²、y³、t、z^n），必须理解为「系数 × 自变量」
    ——分母是该分数的分母，自变量是该字符和它后面的指数，两者各自独立。
  · 正例：y = -1/3 x² 表示 -(1/3)·x² = -x²/3，分母是 3、自变量是 x²。
  · 反例：写成 y = -1/(3x)² 是错的——分母变成 3x²，等价于 -1/(9x²)，原题没有这个意思。
    除非原题明确把分母用括号括起来（如 1/(3x)），否则不要把分母和紧邻自变量合并。
  · 紧凑排版的视觉错觉：印刷体里分数 -1/3 和紧邻 x² 之间只有很窄的视觉间隙，
    模型容易把分母 3 和自变量 x 合并为 3x——必须警惕。
  · 同样适用于所有「分数 + 自变量 + 指数」组合：1/2 y³、2/5 t、a/b z^n、1/4 x、3/5 sinθ 等。

- question_number 从印刷体题号读取，必须是数字
- 如果一道大题包含多个小问（如 21.(1)、21.(2)、22.(1)、22.(2)），必须将每个小问拆成独立的 question 对象输出：question_number 填大题号，sub_no 填小问号，content 只写该小问的题干，student_answer 只写该小问的手写答案。不要把多个小问合并成一道题
- ⚠️【拆小问绝不能丢掉大题的公共题干】每个拆出来的小问对象都必须带 parent_stem：
  填该大题第一个小问标号（(1)）**之前的公共题干原文**（公共已知条件、公共图形文字描述、公共设问前提），
  一个字都不能少、不能改写；同一大题拆出的所有小问，parent_stem 必须逐字相同。
  没有小问的普通题 parent_stem 填 null。
  反例（本系统真实事故）：原题「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).(1)求 a、b 的值；(2)求抛物线与直线 y=x+5 的两交点及顶点所构成的三角形的面积。」
    错误写法：只输出两条 content「(1)求 a、b 的值；」「(2)求…面积。」，parent_stem 留空
      → 公共条件「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).」彻底丢失，
        这两问在错题重练卷上变成没有条件的空题，学生根本无法作答。
    正确写法：两条都带 parent_stem = "已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b)."，
      content 分别只写「(1)求 a、b 的值；」「(2)求…面积。」（content 不要重复 parent_stem 的内容）
  公共题干若跨多行（含图形说明、表格、"其中…"补充条件），必须完整并入 parent_stem，不要只取第一行。
- student_answer 只提取学生手写的内容，如果没有手写迹，填 null；判断题的 √/× 也要提取
- block_coordinates 是该题在图片中的整体外接矩形框（含题号、题干、学生作答区），
  用【归一化 0-1000 坐标系】：x/y 为矩形左上角，width/height 为宽高，
  取值范围 0-1000（相对图片宽/高的千分比，与图片实际像素分辨率无关）。
  必须为每道题都返回该框，用于前端在原图上定位题目。
  ⚠️ 必须按题目【真实位置】返回！x/y/width/height 要反映题目在图片中的实际位置，
  不能返回均匀递增的"占位"坐标（如 y:150,200,250,300...）。
  - x：题号最左侧的 x 坐标（0-1000）
  - y：题号上边缘的 y 坐标（0-1000）
  - width：题号所在行到题目整体最右侧的宽度
  - height：题号到题目最后一行（学生作答区下沿）的高度
  ⚠️ width/height 必须是【宽和高】，不是右下角坐标。右下角 = x+width、y+height。
     不要把右下角的 x2/y2 填进 width/height（那会让每道题的框纵向拉到下一题，圈住整块页面）。
  如果实在无法判断某道题的具体边界，至少让 width/height 反映题目的真实占比（计算题比选择题高），不要全部返回相同值。
- 不要猜测标准答案
- 只返回 JSON，不要其他文字`

  let allQuestions = []
  let allPageTitles = []
  let pageDataList = []   // 逐页数据：{ pageTitle, imageUrl, questions[] }
  let ocrErrors = 0
  // 页码 → 压缩后的页图 buffer（2026-09-21 补，几何配图裁剪按页取图）。
  // 此前 compressedBuffer 是 for 循环内的局部变量、用完即弃，本管线没有任何页图留存，
  // 所以即便 OCR 采到了 image_bbox 也无从裁剪。与 processTask 的 pageBuffers 同构。
  const pageBuffers = new Map()
  // 记录最近一次 AI 原始响应（去空白/截断 200 字），0 道题 throw 时拼到 error message，
  // 让 NON_RETRYABLE_ERROR_PATTERNS 能匹配"图片是空白"等 AI 拒绝模板。
  let _lastOcrAiHint = null
  const setLastAiHint = (content) => {
    if (content && typeof content === 'string') {
      _lastOcrAiHint = content.substring(0, 200).replace(/\s+/g, ' ').trim()
    }
  }

  for (let pageIdx = 0; pageIdx < imageList.length; pageIdx++) {
    const { image_url: url } = imageList[pageIdx]
    console.log(`   [Workbook] 处理第 ${pageIdx + 1}/${imageList.length} 页: ${url.substring(0, 60)}...`)

    // 下载图片
    let imageBuffer
    try {
      imageBuffer = await downloadImage(url)
    } catch (e) {
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页下载失败:`, e.message)
      ocrErrors++
      continue
    }

    // 纠偏 + 压缩
    // ModelScope Qwen3-VL 限制 2048x2048：长边缩放到 1800 留余量，避免报 400
    //   ⚠️ 不设 withoutEnlargement：3116 bytes 这类手机缩略图实际只有 800x600，
    //   AI 看到原尺寸会胡说"图片是空白"（8B/235B 训练数据都是 1024+ 的图）。
    //   强制放大到 1800x1800 保留视觉信息，AI 才能正确 OCR。
    const compressedBuffer = await sharp(imageBuffer)
      .rotate()
      .resize(1800, 1800, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer()

    // 留存本页压缩图，供后续几何配图裁剪按页取图（页码口径与题目一致：imageList 的 page_number）
    pageBuffers.set(imageList[pageIdx].page_number || (pageIdx + 1), compressedBuffer)

    // OCR
    const { content } = await callVisionCompletion({
      imageDataURL: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
      systemPrompt: workbookPrompt,
      userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
      temperature: 0.1,
      maxTokens: 4096,
      // 配图字段（image_type/image_bbox）是本次新增采集，弱备份模型不守 schema 会整列丢失
      // → 配图全空、完整性闸又判缺图。与答案页 OCR 同口径锁主力模型。见 P0-3（2026-09-21）。
      noBackup: true
    })

    if (!content) {
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页AI识别返回为空，跳过`)
      ocrErrors++
      continue
    }

    // 解析 JSON
    let questions = []
    let pageTitle = null
    let sectionTitle = null
    // lesson_code：本页印刷的课时编号（"27.3(2)"）。与 section_title 一起构成本页的
    // 硬锚点，见 pickAnswerUnit 的「0-!) 整页课时编号硬锚定」。
    let lessonCode = null
    try {
      const jsonStr = stripCodeFence(content)
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed)) {
        questions = parsed
      } else if (parsed && typeof parsed === 'object') {
        pageTitle = parsed.page_title || null
        sectionTitle = parsed.section_title || null
        lessonCode = parsed.lesson_code || null
        // chapter_hint 是 AI 推断的章节名（"第二十章二次根式"等），用于
        // pickAnswerUnit 兜底章节匹配。即使 pageTitle 没识别到或无法匹配，
        // chapter_hint 仍可作为可靠的章节信号（AI 看过题目内容）。
        // 把它暂存在 pageDataList，下游消费。
        const chapterHint = parsed.chapter_hint || null
        questions = Array.isArray(parsed.questions) ? parsed.questions : []
        if (chapterHint) {
          // 把 chapter_hint 也合并进每个 question 的临时字段，供 pickAnswerUnit 用
          for (const q of questions) {
            if (q && typeof q === 'object') q._chapter_hint = chapterHint
          }
        }
        // lesson_code 同样挂到每题上：pickAnswerUnit 会连同页眉/正文/题干/OCR 原文
        // 一起扫，任一来源命中即可锚定。模型把它填在哪个字段都能被捡回来。
        if (lessonCode) {
          for (const q of questions) {
            if (q && typeof q === 'object') q._lesson_code = lessonCode
          }
        }
      }
    } catch (e) {
      // AI 拒绝返回 JSON 时（如 8B/235B 胡说"用户提供的图片是空白"），
      // 把原始响应的前 200 字附到日志 + 保存到 _lastOcrAiHint，
      // 0 道题 throw 时拼到 error message，让 NON_RETRYABLE_ERROR_PATTERNS 匹配。
      const aiHint = String(content || '').substring(0, 200).replace(/\s+/g, ' ').trim()
      setLastAiHint(content)
      console.error(`   [Workbook] 第 ${pageIdx + 1} 页JSON解析失败:`, e.message)
      if (aiHint) console.error(`   AI 原始响应(前200字): ${aiHint}`)
      ocrErrors++
      continue
    }

    normalizeBlockBoxSemantics(questions)

    // 标记每道题来自哪页图片（image_url）及页码（page_number），保存时写入。
    // page_number 用于前端分卷排序 / 卷N标注 / 中央页图同步——
    // 缺失会导致多卷任务全部塌缩到"第1页"。用上传顺序页号，兜底 pageIdx+1。
    const pageNo = imageList[pageIdx].page_number || (pageIdx + 1)
    for (const q of questions) {
      q._page_image_url = url
      q._page_number = pageNo
    }

    // 把 AI 合并输出的多小问大题拆成独立题目（如 q21(1)、q21(2)）
    questions = splitOcrQuestionsBySubNo(questions)

    // 题干垃圾检测：识别出"× ×"这类无意义符号题干时标记，触发整页重试一次。
    // 根因：模型把印刷体数学题干错误转录成纯符号堆（如"÷ = × ×."）。
    const garbageCount = questions.filter(q => q && isGarbageQuestionContent(q.content)).length
    if (garbageCount > 0) {
      const garbageExamples = questions
        .filter(q => q && isGarbageQuestionContent(q.content))
        .map(q => `Q${q.question_number}:"${String(q.content).slice(0, 20)}"`)
        .slice(0, 3)
        .join(' ')
      console.warn(`   ⚠️ [Workbook] 第 ${pageIdx + 1} 页检测到 ${garbageCount} 道题题干为无意义符号（${garbageExamples}），标记重试`)
      // 若存在可回填的答案库题干，后续匹配时会用真实题干覆盖占位（见下方 answerRow 回填逻辑）；
      // 无法回填时保留 content 原样，前端可人工修订。
      for (const q of questions) {
        if (q && isGarbageQuestionContent(q.content)) {
          q._content_garbage = true
        }
      }
    }

    // 稀疏题干检测 + 区域聚焦重 OCR：
    // 整页 OCR 对复杂数学题干（分数/带分数/分式）易只识别出指令词（"计算："、"解方程："），
    // 算式主体丢失。此时用该题 block_coordinates 从原图裁剪题目区域单独请求 VLM，
    // 聚焦识别完整算式并覆盖稀疏题干。这是"计算："问题不再复发的关键一环。
    const sparseCount = questions.filter(q => q && isSparseQuestionContent(q.content)).length
    if (sparseCount > 0) {
      console.warn(`   ⚠️ [Workbook] 第 ${pageIdx + 1} 页检测到 ${sparseCount} 道题题干稀疏（仅指令词无算式），触发区域聚焦重OCR`)
      for (const q of questions) {
        if (!q || !isSparseQuestionContent(q.content)) continue
        const fullContent = await reocrQuestionRegion(url, q.block_coordinates, q.question_number,
          q.question_type === 'answer'
            ? (q.content.includes('方程') ? '这是解方程题，需完整转录方程算式。' : '这是计算题，需完整转录算式（含分数/带分数）。')
            : '')
        if (fullContent) {
          console.log(`   ✅ [Workbook] 区域聚焦重OCR补全 第${pageIdx + 1}页 Q${q.question_number}: "${q.content}" → "${fullContent}"`)
          q.content = fullContent
          q._content_recovered = true
        } else {
          console.warn(`   ⚠️ [Workbook] 区域聚焦重OCR未补全 Q${q.question_number}，保留原题干"${q.content}"`)
          q._content_sparse = true
        }
      }
    }

    console.log(`   [Workbook] 第 ${pageIdx + 1} 页: 识别到 ${questions.length} 道题, 标题="${pageTitle}"${garbageCount > 0 ? `, ${garbageCount} 题题干异常` : ''}${sparseCount > 0 ? `, ${sparseCount} 题题干稀疏` : ''}`)

    allQuestions.push(...questions)
    if (pageTitle) allPageTitles.push(pageTitle)
    // pageNumber 一并入 pageDataList，供下游 pickAnswerUnit 走"页码范围兜底"匹配：
    // 答案 PDF 中按页号记录了每个单元的起止页，本页若 OCR 失败或标题失配，
    // 可用页码范围作为辅助信号定位所属单元。
    // chapterHint 来自 AI 推断（"第二十章二次根式"等），pickAnswerUnit 内部会消费它。
    pageDataList.push({
      pageTitle,
      sectionTitle,
      // OCR 原始响应全文：模型这一次调用"读到"的整页文本都在这里。
      // pickAnswerUnit 会扫它找课时编号 —— 即便模型把编号塞进了别的字段、或被结构化输出
      // 挤掉了，只要响应里出现过就能捞回来。零额外成本（同一次调用已产出）。
      rawOcrText: content,
      imageUrl: url,
      questions,
      pageNumber: pageNo,
      chapterHint: questions.find(q => q && q._chapter_hint)?._chapter_hint || null
    })

    const progress = 5 + Math.round(((pageIdx + 1) / imageList.length) * 60)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress })
  }

  // 所有页面都识别失败 —— 切下一个视觉模型重试 1 次
  // 原因：8B 配额耗尽/降智时可能全返回 0 道题，换 235B/8B-Thinking/Agnes 一次就过；
  // 如果重试仍 0 道题，基本可以确认是图片本身没内容（白页/过小/拍照模糊），放弃。
  if (allQuestions.length === 0) {
    const retriedModel = rotateVLModel()
    if (retriedModel) {
      console.warn(`🔄 [Workbook] 第 1 轮全 0 道题，切换到下一个视觉模型 (${retriedModel}) 重试 1 次...`)
      // 重置页级状态
      let allQuestionsRetry = []
      let ocrErrorsRetry = 0
      const pageDataListRetry = []
      for (let pageIdx = 0; pageIdx < imageList.length; pageIdx++) {
        const { image_url: url } = imageList[pageIdx]
        let imageBuffer
        try {
          imageBuffer = await downloadImage(url)
        } catch (e) {
          console.error(`   [Workbook] 重试第 ${pageIdx + 1} 页下载失败:`, e.message)
          ocrErrorsRetry++
          continue
        }
        const compressedBuffer = await sharp(imageBuffer)
          .rotate()
          .resize(1800, 1800, { fit: 'inside' })
          .jpeg({ quality: 85 })
          .toBuffer()
        // 与首轮同口径留存页图（重试成功会整体替换 allQuestions/pageDataList，
        // 页图也必须跟着换，否则几何配图会按旧页图裁剪）。
        pageBuffers.set(imageList[pageIdx].page_number || (pageIdx + 1), compressedBuffer)
        const { content } = await callVisionCompletion({
          imageDataURL: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
          systemPrompt: workbookPrompt,
          userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
          temperature: 0.1,
          maxTokens: 4096,
          model: retriedModel, // 锁定到刚切到的模型，不让它内部再切回
        })
        if (!content) { ocrErrorsRetry++; continue }
        let questions = []
        let pageTitle = null
        let sectionTitle = null
        let lessonCode = null
        try {
          const jsonStr = stripCodeFence(content)
          const parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed)) questions = parsed
          else if (parsed && typeof parsed === 'object') {
            pageTitle = parsed.page_title || null
            sectionTitle = parsed.section_title || null
            lessonCode = parsed.lesson_code || null
            questions = Array.isArray(parsed.questions) ? parsed.questions : []
          }
        } catch (e) {
          setLastAiHint(content)
          const aiHint = String(content || '').substring(0, 200).replace(/\s+/g, ' ').trim()
          console.error(`   [Workbook] 重试第 ${pageIdx + 1} 页JSON解析失败:`, e.message)
          if (aiHint) console.error(`   重试 AI 原始响应(前200字): ${aiHint}`)
          ocrErrorsRetry++
          continue
        }
        const pageNo = imageList[pageIdx].page_number || (pageIdx + 1)
        for (const q of questions) {
          q._page_image_url = url
          q._page_number = pageNo
          if (lessonCode) q._lesson_code = lessonCode
        }
        questions = splitOcrQuestionsBySubNo(questions)
        allQuestionsRetry.push(...questions)
        pageDataListRetry.push({ pageTitle, sectionTitle, lessonCode, rawOcrText: content, imageUrl: url, questions, pageNumber: pageNo, chapterHint: null })
        console.log(`   [Workbook] 重试第 ${pageIdx + 1} 页: 识别到 ${questions.length} 道题`)
      }
      if (allQuestionsRetry.length > 0) {
        console.log(`✅ [Workbook] 模型切换重试成功，识别到 ${allQuestionsRetry.length} 道题`)
        allQuestions = allQuestionsRetry
        pageDataList = pageDataListRetry
        ocrErrors = ocrErrorsRetry
        allPageTitles = pageDataListRetry.map(p => p.pageTitle).filter(Boolean)
      } else {
        console.warn(`⚠️ [Workbook] 模型切换重试仍为 0 道题，放弃`)
      }
    }
  }

  // 重试后仍 0 道题 → 标记为 AI_EMPTY 进入黑名单，PendingTaskRecovery 不再反复入队
  //   同时把最近一次 AI 原始响应（去空白/截断 200 字）附在 error message 末尾，
  //   让 NON_RETRYABLE_ERROR_PATTERNS 能匹配"图片是空白"等 AI 拒绝模板。
  if (allQuestions.length === 0) {
    const baseError = ocrErrors > 0 ? `${ocrErrors} 页识别失败` : '所有页面识别结果为空'
    const lastAiHint = _lastOcrAiHint ? `；AI 提示: "${_lastOcrAiHint}"` : ''
    const errorDetail = baseError + lastAiHint
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: errorDetail, errorType: 'AI_EMPTY'
    })
    throw new Error(errorDetail)
  }

  // 3. 逐页单元感知的答案匹配（3D 结构：unitKey → sectionKey → qNo|subNo → row）
  const answersByUnit = await getWorksheetAnswersBySection(worksheetId)

  // 统计所有页标题（仅用于诊断日志）
  const titleFreq = {}
  for (const t of allPageTitles) {
    if (t) titleFreq[t] = (titleFreq[t] || 0) + 1
  }

  let wrongCount = 0
  let matchedCount = 0
  let emptyCount = 0
  // P1/P2 参考答案安全带（2026-09-16）：被判定为"参考答案与本题不匹配"而丢弃的题数
  let refGuardDowngraded = 0
  const pagesMatchInfo = []
  const isChoiceLike = (t) => t === 'choice' || t === 'judge'

  // ★ 两遍扫描：先预识别每页单元（含双向相邻继承，解决学生倒序扫描时
  //   无标题解答题页永远继承不到后页标题页的问题），批改循环直接采用结果。
  const resolvedUnits = resolveAnswerUnits(answersByUnit, pageDataList)
  const unitByPageNumber = new Map(resolvedUnits.map(r => [r.pageNumber, r.unitKey]))
  const resolvedByPage = new Map(resolvedUnits.map(r => [r.pageNumber, r]))

  // ── forceUnitId：定向重跑时把整份扫描钉死到指定单元 ──────────────────────
  // 适用场景：扫描页页眉/小标题 OCR 质量差，pickAnswerUnit 所有通道都没锚定到
  // 正确单元（matchedUnit=null ⇒ unitAnswers=null ⇒ 答案指纹/覆盖率兜底全部失效），
  // 导致整页题目拿不到答案库答案；但人工已确认该份作业属于某个具体单元。
  // 仅覆盖"单元归属"这一个环节，不改动题号/小问/section 的匹配逻辑与判等口径，
  // 也不放宽任何答案审核门禁——答案仍全部来自 worksheet_answers。
  if (forceUnitId) {
    // answersByUnit 的键是 unit_key（如 "27.2(2)"），见 getWorksheetAnswersBySection。
    // 允许直接传 unit_key，也允许传 unit_id(UUID)——后者需反查成 unit_key。
    let forcedUnitKey = answersByUnit.has(forceUnitId) ? forceUnitId : null
    if (!forcedUnitKey) {
      outer:
      for (const [, secMap] of answersByUnit) {
        for (const [, qMap] of secMap) {
          for (const [, row] of qMap) {
            if (row.unit_id === forceUnitId) { forcedUnitKey = row.unit_key; break outer }
          }
        }
      }
    }
    if (forcedUnitKey) {
      for (const r of resolvedUnits) {
        r.unitKey = forcedUnitKey
        r.method = 'forced-unit'
        r.groupTie = null   // 钉死后不再算"低置信度"，避免误标 is_suspicious
      }
      for (const key of [...unitByPageNumber.keys()]) unitByPageNumber.set(key, forcedUnitKey)
      console.log(`   [Workbook] forceUnitId 生效："${forceUnitId}" → 单元 "${forcedUnitKey}"，全部 ${resolvedUnits.length} 页钉死（人工指定，跳过页眉锚定）`)
    } else {
      console.warn(`   [Workbook] forceUnitId="${forceUnitId}" 既不是 unit_key 也查不到对应 unit_id（本册共 ${answersByUnit.size} 个单元）→ 忽略，回退正常锚定`)
    }
  }

  // ── 全任务级结构指纹兜底（2026-09-13）──────────────────────────────────
  // 逐页 pickAnswerUnit 全部锚定失败时（页眉是学校跑马灯、section_title 缺失、
  // chapterHint 还可能被 AI 报错章节），用【整份扫描合并后】的题目做结构反查。
  // 为什么必须合并：单页常只有 1~2 道多小题题，区分钟不够会判平放弃；
  // 多页合并后（如 Q4(1)(2) ∧ Q8(1)(2)(3) ∧ Q9(1)(2)）在 49 个单元里唯一命中。
  // 只在"本来会挂空"的页上补挂，已锚定成功的页不动；判据与逐页版一致（打平即放弃）。
  if (resolvedUnits.some(r => !r.unitKey) && allQuestions.length > 0) {
    const fpUnit = inferUnitByStructureFingerprint(answersByUnit, allQuestions)
    if (fpUnit) {
      let patched = 0
      for (const r of resolvedUnits) {
        if (!r.unitKey) {
          r.unitKey = fpUnit
          r.method = 'struct-fingerprint'
          r.groupTie = null
          patched++
        }
      }
      for (const [k, v] of [...unitByPageNumber.entries()]) {
        if (!v) unitByPageNumber.set(k, fpUnit)
      }
      console.log(`   [Workbook] 全任务结构指纹兜底命中：unit="${fpUnit}" → 补挂 ${patched} 页（页眉无课时号，按整份扫描的小题结构反查）`)
    }
  }

  for (const { pageTitle, sectionTitle, imageUrl, questions, pageNumber, chapterHint } of pageDataList) {
    if (questions.length === 0) continue
    // 页级可疑标记：单元匹配经分组兜底（group-fallback）或同号多单元打平（groupTie），
    // 说明本页归属置信度低，写 is_suspicious 供 PC 端展示，避免错挂静默无感。
    const resolvedInfo = resolvedByPage.get(pageNumber) || {}
    const pageSuspicious = !!(resolvedInfo.groupTie || resolvedInfo.method === 'group-fallback')

    // 1) 选本页所属单元（unitKey）—— pageNumber 用于"页码范围兜底"
    //    chapterHint 来自 OCR 阶段 AI 推断的章节（如"第二十章二次根式"），
    //    当 pageTitle 缺失/匹配失败时作为强信号兜底。
    //    预扫描 resolveAnswerUnits 已内含：标题匹配 + 学生答案反推 + 答案覆盖率兜底 +
    //    页码范围兜底 + 双向相邻页继承（含倒序扫描场景）。
    const matchedUnit = unitByPageNumber.get(pageNumber) ?? null

    const unitAnswers = matchedUnit != null ? answersByUnit.get(matchedUnit) : null

    // 2.0) 单元答案池结构体检（P2，2026-09-16）
    //   答案册是双栏连排、一个单元的回答常常横跨页边界，而解析按「页」归属单元：
    //   上一单元的尾巴会被划进本单元，本单元自己的尾巴会被下一单元带走并同题号互相覆盖。
    //   可观测症状 = 单元答案池的题号不连续（出现缺口）。缺口之后的题号极可能来自别的单元，
    //   不能拿去判分（实测 28.1(2) 池缺 5/6，q7~q14 实为 28.1(1) 的尾巴）。
    //   题号连续（无缺口）时不产生任何影响 —— 27 章那批单元都是连续的。
    const unitQuestionNos = new Set()
    if (unitAnswers) {
      for (const [, qMap] of unitAnswers) {
        for (const qKey of qMap.keys()) {
          const n = parseInt(String(qKey).split('|')[0], 10)
          if (Number.isFinite(n)) unitQuestionNos.add(n)
        }
      }
    }
    let unitGapStart = null
    if (unitQuestionNos.size > 0) {
      const maxNo = Math.max(...unitQuestionNos)
      for (let n = 1; n <= maxNo; n++) {
        if (!unitQuestionNos.has(n)) { unitGapStart = n; break }
      }
    }
    if (unitGapStart != null) {
      console.warn(`   [Workbook][RefGuard] 单元 "${matchedUnit}" 答案池题号不连续（缺口起点 ${unitGapStart}，共 ${unitQuestionNos.size} 个题号）→ 题号 ≥ ${unitGapStart} 的参考答案不采信`)
    }

    // 2) 在该单元的"section → qNo|subNo → row"二维索引中，每道题独立查答案。
    //    同一 unit 下不同 section 可能有相同题号（如"一、填空题 1"和"三、解答题 1"），
    //    必须按 question_type 选择对应 section，否则会把填空题答案挂到解答题上。
    const sectionScoreForType = (section, questionType) => {
      if (!section) return 50
      const s = String(section)
      if (questionType === 'choice') return /选择/.test(s) ? 100 : 0
      if (questionType === 'judge') return /判断/.test(s) ? 100 : 0
      if (/填空/.test(s)) return 100
      if (/解答|计算|证明|简答|作图/.test(s)) return 90
      if (/选择/.test(s)) return 0
      if (/判断/.test(s)) return 0
      return 50
    }
    const lookupWholeRow = (qNo, questionType) => {
      if (!unitAnswers) return null
      const qKeyWhole = `${Number(qNo)}|`
      let bestWhole = null
      let bestWholeScore = -1
      for (const [section, qMap] of unitAnswers) {
        const row = qMap.get(qKeyWhole)
        if (!row) continue
        const score = sectionScoreForType(section, questionType)
        if (score > bestWholeScore) {
          bestWholeScore = score
          bestWhole = row
        }
      }
      return bestWhole
    }
    const lookupRow = (qNo, subNo, questionType) => {
      if (!unitAnswers) return null
      // 先精确匹配 qno|sub_no（答案库若按小问分条则可精确定位）
      const qKey = `${Number(qNo)}|${subNo || ''}`
      let best = null
      let bestScore = -1
      for (const [section, qMap] of unitAnswers) {
        const row = qMap.get(qKey)
        if (!row) continue
        const score = sectionScoreForType(section, questionType)
        if (score > bestScore) {
          bestScore = score
          best = row
        }
      }
      // 整题行（qno|''）：供小问回退与小题行防误伤校验共用
      const wholeRow = subNo ? lookupWholeRow(qNo, questionType) : null
      if (best) {
        // P0.5 防误伤：答案库小题行自身可能错位（实测 27.2(2) q=10 sub='1' 是别的题
        // 的答案）。整题行能拆出小问分段时校验一致性，明显不符则弃用小题行。
        if (wholeRow && !isSubRowConsistentWithWhole(subNo, best.answer, wholeRow.answer)) {
          console.warn(`   [Workbook] 答案库小题行疑似错位: 题${qNo}(${subNo}) 小题行答案"${String(best.answer).slice(0, 30)}"与整题行(${subNo})段不符，回退整题行答案`)
          return wholeRow
        }
        return best
      }
      // 回退：答案库整题一条答案（sub_no=''）而 OCR 拆成多个小问（Q3(1)/Q3(2)…）时，
      // 精确键 qno|小问 永远查不到。答案库 Q3 的答案含 (1)(2)(3) 全部小问，
      // 回退到 qno|'' 整题行，避免判成"参考答案空白"。
      if (subNo && wholeRow) {
        console.log(`   [Workbook] 小问回退: 题${qNo}(${subNo}) → 整题答案（答案库按整题存）`)
        return wholeRow
      }
      return null
    }

    // 避免答案指纹兜底时重复占用同一答案行
    const usedQKeys = new Set()

    pagesMatchInfo.push({
      has_title: !!pageTitle,
      page_title: pageTitle,
      section_title: sectionTitle,
      matched_unit: matchedUnit,
      matched_method: resolvedInfo.method || null,
      group_tie_units: resolvedInfo.groupTie || null,
      suspicious: pageSuspicious,
      question_count: questions.length,
      page_number: pageNumber || null,
      unit_answer_count: unitQuestionNos.size,
      unit_gap_start: unitGapStart
    })

    console.log(`   [Workbook] 页匹配: title="${pageTitle}" → unit="${matchedUnit}" (${questions.length} 题)${pageSuspicious ? ' [suspect]' : ''}`)

    // 对该页题目逐题判定
    for (const q of questions) {
      if (q.question_number == null) continue
      if (pageSuspicious) q.is_suspicious = true

      let answerRow = lookupRow(q.question_number, q.sub_no, q.question_type)
      let usedKey = `${Number(q.question_number)}|${q.sub_no || ''}`

      // 答案指纹兜底：题号在单元内查不到（OCR 题号错位/漏读）时，按学生答案内容找最相似行
      // 选择题/判断题答案太短，不参与
      if (!answerRow && unitAnswers && q.student_answer && !isChoiceLike(q.question_type)) {
        const found = searchByAnswerFingerprint(q.student_answer, q.question_type, unitAnswers, usedQKeys)
        if (found) {
          answerRow = found.row
          usedKey = found.qKey
          console.log(`   [Workbook] 答案指纹兜底: 题${q.question_number} → ${usedKey} student="${String(q.student_answer).slice(0, 30)}" ref="${String(found.row.answer).slice(0, 30)}"`)
        }
      }

      // ── P1 参考答案安全阀（2026-09-16）──────────────────────────────────
      //   取到行从不等于"这就是本题的答案"：卷面题与答案册不同源（老师随机组题）或
      //   单元归属错位时，按题号取出的行是**别的题**的答案，直接判分就是假红叉，
      //   而且 UI 上参考答案有内容、置信度 0.95，老师根本看不出异常。
      //   两条硬判据（都只在"一眼可判"时拦，判不出就放行，不比改前更差）：
      //     ① 题型/形态冲突：选择题配到非选项字母、填空题配到一整段解答；
      //     ② 题号落在该单元答案池的缺口之后（结构体检发现尾部被别的单元占了）。
      //   命中 → 丢弃参考答案、is_correct=null、写 answer_exception_reason 让老师看见。
      if (answerRow) {
        const sheetType = q.question_type || 'choice'
        const mismatchReason = detectReferenceMismatch({ sheetType, referenceAnswer: answerRow.answer })
          || (unitGapStart != null && Number(q.question_number) >= unitGapStart ? 'reference_mismatch' : null)
        if (mismatchReason) {
          refGuardDowngraded++
          console.warn(`   [Workbook][RefGuard] 题 ${q.question_number}: 参考答案与本题不匹配，已丢弃（卷面题型=${sheetType}，答案库行=${usedKey}，答案="${String(answerRow.answer).slice(0, 40)}"${unitGapStart != null && Number(q.question_number) >= unitGapStart ? `，单元题号缺口≥${unitGapStart}` : ''}）→ 转人工`)
          q.is_correct = null
          q.answer = null
          q.answer_source = 'recognized'
          q.is_suspicious = true
          q._unjudged_reason = mismatchReason
          continue
        }
      }

      if (answerRow) {
        usedQKeys.add(usedKey)
        q.answer = answerRow.answer
        q.answer_source = 'worksheet'
        // 答案库的 answer_type 描述的是「这条答案记录」的题型，不是本题的题型，
        // 不能无条件覆盖 OCR 判定结果。实测事故（2026-09-11，练习册 27.5 第 6 题）：
        // 卷面第 6 题是填空题「则当OP=______米时，该花坛POQ的面积最大.」，答案库同题号
        // 那条记录是 answer_type='choice'/answer='A'，这里一覆盖 → 落库成
        // 「选择题 + options=[]」→ 完整性闸报「选择题缺少选项」，老师标错被拦、
        // 编辑页又只有选项区块（只在 choice 下渲染），没有任何可执行的补救动作。
        // 现在只接受与题干不矛盾的题型；题干有明确填空线且无任何选项证据时按填空题走。
        const bankType = answerRow.answer_type || q.question_type || 'choice'
        const resolvedType = resolveEffectiveQuestionType({
          question_type: bankType,
          content: q.content,
          options: q.options
        })
        if (resolvedType.corrected) {
          console.log(`   [Workbook] 题 ${q.question_number}: 答案库题型 "${bankType}" 与题干不符（题干含填空线且无选项）→ 按 "${resolvedType.type}" 处理`)
        }
        q.question_type = resolvedType.type || 'choice'
        // 回填题干：答案库有题干时用真实题干替换占位符 "第 N 题"
        if (answerRow.content && String(answerRow.content).trim()) {
          q.content = String(answerRow.content).trim()
        }
        matchedCount++

        const hasAnswer = q.student_answer && q.student_answer !== 'null' && q.student_answer !== '未作答'
        if (hasAnswer) {
          const judgment = judgeAnswer(q.student_answer, q.answer, q.question_type)
          q.is_correct = judgment.isCorrect
          if (q.is_correct === false) wrongCount++
          // 答案库给的参考答案也可能是"证明略""答案不唯一"这类无从核对的值，
          // judgeAnswer 会返回 null；记下原因，落库后统一标注给老师看。
          if (q.is_correct === null) {
            q._unjudged_reason = detectUnverifiableReference(q.answer) || 'no_reference_answer'
          }
        } else {
          q.is_correct = null // 未作答
          // 必须显式标 blank：本管线原先只把 is_correct 置 null，未作答题与"AI 判不出"
          // 在库里长得一样，列表页的"空"和"待复核"两桶就分不开（复核页也只能显示"处理中"）。
          q.answer_source = 'blank'
          emptyCount++
        }
        console.log(`   [Workbook] 题 ${q.question_number}: 学生="${q.student_answer}" 标准="${q.answer}" → ${q.is_correct === true ? '正确' : q.is_correct === false ? '错误' : '待人工'}`)
      } else {
        console.log(`   [Workbook] 题 ${q.question_number}: 答案库无匹配（页标题="${pageTitle}"），标记待人工`)
        q.is_correct = null
        q._unjudged_reason = 'no_reference_answer'
      }
    }
  }

  console.log(`   [Workbook] 答案匹配: ${matchedCount}/${allQuestions.length} 题, 错误: ${wrongCount} 题, 空: ${emptyCount} 题`)

  // 用 OCR 卷面标题给任务改名（与通用管线 5436 行口径一致）：练习册类型上传时前端
  // 固定把任务名拼成"科目 · 练习册名"——选练习册只是选批改模式/答案来源，不代表
  // 作业本身身份，列表里多份同练习册任务无法区分。命名统一以卷面印刷标题为准。
  // 优先取匹配成功页的标题（该标题已通过 pickAnswerUnit 可信校验），兜底取首个非空标题。
  try {
    const titledPage = pagesMatchInfo.find(p => p.matched_unit && p.page_title)
      || pagesMatchInfo.find(p => p.page_title)
    if (titledPage?.page_title) {
      const { rows: nameRows } = await query(
        `SELECT original_name FROM ${TABLES.TASKS} WHERE id = $1`,
        [taskId]
      )
      const originalName = nameRows[0]?.original_name || ''
      // 2026-09-17：与通用管线共用 deriveTaskTitle —— 卷面顶部印的是校徽文字时
      // （"新闵学校“成长·桥”练习"）剥掉页眉只留课时后缀；剥完为空则【不改名】。
      if (isAutoTaskName(originalName, { treatClientPaperNameAsAuto: true })) {
        const cleaned = deriveTaskTitle(titledPage.page_title)
        if (cleaned) {
          await query(`UPDATE ${TABLES.TASKS} SET original_name = $1 WHERE id = $2`, [cleaned, taskId])
          console.log(`   📝 [Workbook] 任务改名: "${originalName}" → "${cleaned}"（来自卷面标题）`)
        } else {
          console.log(`   ⏭️ [Workbook] 卷面标题"${titledPage.page_title}"是校名页眉/无信息量，不用于命名（保留"${originalName}"）`)
        }
      }
    }
  } catch (e) {
    console.warn(`   ⚠️ [Workbook] 任务改名失败: ${e.message}`)
  }

  // 单元匹配诊断信息（写入 task metadata 供前端排查）
  const sectionMatchInfo = {
    pages: pagesMatchInfo,
    total_units: answersByUnit.size
  }
  const allNoMatch = pagesMatchInfo.every(p => p.matched_unit == null)
  if (allNoMatch) {
    sectionMatchInfo.match_fail_reason = '所有页面均无法匹配到所属练习单元'
  }

  // P2 入口预检结论（2026-09-16）：丢弃率过高说明「这份卷根本不是这本练习册的题」
  //   （实测：成长·桥第03周 12 题里有 9 题的参考答案被判为不匹配）。
  //   不静默判分、不假装成功 —— 把结论写进 result 供前端提示，并给出明确建议。
  if (refGuardDowngraded > 0) {
    const ratio = refGuardDowngraded / Math.max(allQuestions.length, 1)
    sectionMatchInfo.workbookMatch = {
      downgraded: refGuardDowngraded,
      total: allQuestions.length,
      ratio: Number(ratio.toFixed(2))
    }
    if (ratio >= 0.5) {
      sectionMatchInfo.match_fail_reason = '卷面题目与本练习册答案册对不上（题型/题号不匹配），参考答案已丢弃并转人工；建议改用普通作业批改'
      console.warn(`   ⚠️ [Workbook][RefGuard] ${refGuardDowngraded}/${allQuestions.length} 题的参考答案与卷面题不匹配（${(ratio * 100).toFixed(0)}%）—— 这份卷很可能不是这本练习册的题，建议改走普通作业批改`)

      // 半数以上的参考答案都对不上 ⇒ 剩下的那部分也不可信（同一份答案册、同一次取行）。
      // 题型/答案形态"看起来正常"的题（如选择题配到一个合法字母）恰恰最危险：
      // 老师看不出异常，却是在用另一道题的答案判分。整卷丢弃，全部转人工。
      // 未作答不动（本来就走 blank 桶）；本就没有参考答案的题不动。
      let dropped = 0
      for (const q of allQuestions) {
        if (q.answer_source === 'blank') continue
        if (String(q.answer ?? '').trim() === '' && q.is_correct == null) continue
        q.answer = null
        q.is_correct = null
        q.is_suspicious = true
        q._unjudged_reason = 'reference_mismatch'
        dropped++
      }
      // 计数器随答案一起重算：不重算会把"已丢弃的错"写进 tasks.result.wrongCount，
      // 列表页就会显示"6 错"，老师点进去却一道都没有。
      wrongCount = 0
      matchedCount = 0
      emptyCount = allQuestions.filter(q => q.answer_source === 'blank').length
      sectionMatchInfo.workbookMatch.dropped_all = dropped
      console.warn(`   ⚠️ [Workbook][RefGuard] 整卷 ${dropped} 题的参考答案已全部丢弃，转人工；wrongCount/matchedCount 已重算`)
    } else {
      console.warn(`   ⚠️ [Workbook][RefGuard] ${refGuardDowngraded}/${allQuestions.length} 题的参考答案被丢弃（占 ${(ratio * 100).toFixed(0)}%），已转人工确认`)
    }
  }

  await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 75 })

  // 判题终裁：规则判不出的客观题 → grok-4.5 仲裁（落库前执行，结论随 createQuestions 一并写入）
  await aiJudgeUncertainQuestions(allQuestions)

  // 5. 保存到数据库（复用现有 createQuestions）
  // 幂等：恢复链路/重试可能对同一 task 重复执行，先清掉旧题目行防止成倍重复
  const deletedOld = await deleteQuestionsByTaskId(taskId)
  if (deletedOld > 0) {
    console.log(`   [Workbook] 幂等清理: 删除旧题目 ${deletedOld} 行 (taskId=${taskId})`)
  }
  // ── 几何配图裁剪（2026-09-21 补，与日常管线 processTask 共用同一份实现）──
  // 事故：本管线此前完全没有配图采集与裁剪 → questions.geometry_image_url 恒为空 →
  //   ① 错题本完整性闸（checkQuestionCompleteness 规则1）判「题干引图但缺配图」，
  //      所以历史上不敢开这道闸（一开就把引图题全挡在错题本外）；
  //   ② 周末课件题单/讲题白板里的几何题没有图，老师对着一道没有图形的证明题讲不了。
  // 编排逻辑在 utils/geometryCrop.js，与 processTask 同源同判据。
  const workbookPageDims = new Map() // pageNumber → {w, h}
  for (const [pageNo, buf] of pageBuffers) {
    try {
      const _meta = await sharp(buf).metadata()
      workbookPageDims.set(pageNo, { w: _meta.width, h: _meta.height })
    } catch (e) {
      console.warn(`   ⚠️ [坐标] 读取第 ${pageNo} 页压缩图尺寸失败: ${e.message}`)
    }
  }
  let workbookFigureMissingRefs = 0
  try {
    const cropResult = await cropGeometryFigures({
      questions: allQuestions,
      pageBuffers,
      pageDims: workbookPageDims,
      cropImage: cropAndUploadGeometryImage,
      studentId,
      fallbackBuffer: pageBuffers.values().next().value || null,
      fallbackPage: imageList[0]?.page_number || 1
    })
    workbookFigureMissingRefs = cropResult.missingRefs
  } catch (e) {
    // 配图裁剪失败绝不能阻断批改主流程：题照常落库，配图留空由老师复核补。
    console.warn(`   ⚠️ [Workbook] 几何配图裁剪整体失败（题照常落库，配图留空）: ${e.message}`)
  }

  const questionsWithStudentId = allQuestions.map(q => ({
    ...q,
    id: crypto.randomUUID(),
    student_id: studentId,
    task_id: taskId,
    content: coerceAIText(q.content) || `第 ${q.question_number} 题`,
    options: q.options || [],
    analysis: coerceAIText(q.analysis),
    student_answer: coerceAIText(q.student_answer) || null,
    ai_answer: null,
    // is_complete 不在此硬编码：createQuestions 会用 checkQuestionCompleteness(q) 的
    // 动态真值覆写（这是「唯一判据」，落库列只是它的反范式缓存）。
    // 原先写的 `true` 会让建题瞬间与真值不符，且掩盖缺项；改为交给 createQuestions 统一算。
    confidence: q.is_correct !== null ? 0.95 : null,
    question_type: q.question_type || 'choice',
    image_url: q._page_image_url || imageList[0]?.image_url || '',
    page_number: q._page_number || 1,
    // 题目定位框（归一化 0-1000）：来自 OCR，供前端在原图上画蓝色定位框。
    // [2026-09-20] text_bbox 不再写成 block_coordinates 的副本（旧实现让前端
    // 「text_bbox ∪ image_bbox 优先」路径拿到的还是同一个占位框）；OCR 没量文字框就留空。
    block_coordinates: q.block_coordinates || null,
    text_bbox: q.text_bbox || null,
    // 配图元素（2026-09-21 补，与日常管线 processTask 同口径）：
    // 练习册此前完全不映射这三列 → geometry_image_url 永远为空 →
    // 引图题在错题本/周末课件/讲题白板里没有图，且完整性闸不敢开（一开就全挡）。
    // 字段名与 image_type 取值必须与 server/config/ai.js buildOCRPrompt 逐字一致。
    image_type: q.image_type || null,
    image_bbox: q.image_bbox || null,
    source_type: 'workbook',
    // workbook 学科由练习册资源决定，不能依赖 OCR 或客户端是否传 subject。
    subject: workbookSubject || q.subject || null
  }))
  // 清除临时标记字段
  for (const q of questionsWithStudentId) {
    delete q._page_image_url
    delete q._page_number
    delete q._chapter_hint
    delete q._lesson_code
    // 题干垃圾检测标记在匹配阶段已可能被答案库真实题干覆盖；
    // 若仍是垃圾内容（未回填），重置为占位符，避免"× ×"污染题库列表。
    if (q._content_garbage) {
      delete q._content_garbage
      if (q.content && isGarbageQuestionContent(q.content)) {
        const backup = q.content
        q.content = `第 ${q.question_number} 题`
        q._content_garbage_original = backup
        console.warn(`   [Workbook] 题 ${q.question_number}: 题干识别为无意义符号"${String(backup).slice(0, 30)}"，已重置为占位符，请人工修订`)
      }
    }
    // 稀疏题干（区域聚焦重OCR仍无法补全算式）：若匹配阶段未被答案库题干覆盖，
    // 重置为占位符，避免"计算："这类无算式题干污染题库列表，同时保留原内容供人工修订。
    if (q._content_sparse) {
      delete q._content_sparse
      if (q.content && isSparseQuestionContent(q.content)) {
        const backup = q.content
        q.content = `第 ${q.question_number} 题`
        q._content_sparse_original = backup
        console.warn(`   [Workbook] 题 ${q.question_number}: 题干稀疏（仅"${String(backup).slice(0, 30)}"，无算式），已重置为占位符，请人工修订`)
      }
    }
  }

  await createQuestions(questionsWithStudentId)

  // 判不出来的题：把原因落到 answer_exception_reason（观测用，不参与判定）
  await markUnjudgedReasons(questionsWithStudentId)

  // 图题风险标注：客观题 + 配图 → 软提示"AI 视觉推理不擅长，建议核对参考答案"
  // 与 markUnjudgedReasons 不冲突：前者写 is_correct=null 的"AI 未判定"原因列，
  // 本函数写 is_correct 已给但可能不可靠的"AI 答案存疑"提示列，两套语义分开。
  await markImageReasoningRisk(questionsWithStudentId)

  // 6. 自包含错题本同步：裁剪学生作业图片 + 直接写入 wrong_questions
  // 直接基于 questionsWithStudentId 过滤（自带 id），确保 question_id 一定与
  // 已落库的题目行一致；不再用"题号 → question_id"映射，避免多页同题号/跨 section
  // 同题号覆盖导致 question_id 指向错误的题目甚至 NULL。
  // ── 完整性闸（2026-09-21 对齐日常管线口径）──
  //
  // 口径契约：**两管线必须完全一致，不得为练习册另写豁免规则**（用户 2026-09-21 拍定：
  //   「一切都和日常管线走一样的路线，减少操作者老师的学习成本」）。
  //
  // 历史取舍（2026-09-18 只拦 missing_options）已被撤销。它的两条理由在配图能力补齐后：
  //   · 「missing_figure 会把 205 道引图题全挡掉」→ **不再成立**。本管线本次已补齐
  //     geometry_image_url 采集（见上方 [几何配图裁剪] 段），引图题不再是「缺图」；
  //     真缺图的题本期就该拦（第04周 11 道引图缺图题实测「应拦未拦」）。
  //   · 「missing_answer 会掐掉未作答业务线」→ **日常管线本来就豁免它**，豁免点不在闸里，
  //     而在**候选筛选**：answer_source='blank' 是入册条件之一，且这类题按设计没有
  //     参考答案。日常管线的做法是 —— 候选筛选只认 (判错 || 未作答)，闸跑全量判据。
  //     但因为「无参考答案时批改流程根本不会尝试入册」，missing_answer 天然进不了候选。
  //     本管线照抄同一结构即可，**不需要为练习册单独写一条豁免规则**。
  //
  // 入册前还必须调 syncQuestionCompleteness 把 questions.is_complete 反范式列对齐到
  // 动态真值 —— 否则「写入成功但错题列表看不见」（GET 按 q.is_complete = TRUE 过滤，
  // 2026-09-11 实测 396 条入册记录隐藏 112 条）。这一点与 addWrongQuestions 同源。
  let workbookSkippedIncomplete = 0
  const incompleteSkipReasons = {}
  const wrongQuestions = questionsWithStudentId.filter(q => {
    if (!((q.is_correct === false || q.answer_source === 'blank') && q.question_number)) return false
    const { isComplete, codes } = checkQuestionCompleteness(q)
    if (!isComplete) {
      workbookSkippedIncomplete++
      const label = codes.join(',') || 'unknown'
      incompleteSkipReasons[label] = (incompleteSkipReasons[label] || 0) + 1
      console.log(`   [Workbook] 完整性闸拦下: question_no=${q.question_number} 缺项=${codes.join('/')}`)
      return false
    }
    return true
  })
  // 入册前对齐 is_complete 缓存列（与 addWrongQuestions 内部同源）。
  // 必须在写 wrong_questions 之前完成，否则入册后立刻回拉错题列表会漏掉刚加的题。
  if (wrongQuestions.length > 0) {
    try {
      await syncQuestionCompleteness(wrongQuestions.map(q => q.id))
    } catch (e) {
      console.warn(`   ⚠️ [Workbook] is_complete 对齐失败（不阻断入册）: ${e.message}`)
    }
  }

  // 置信度闸（与 addWrongQuestions 同口径，2026-09-11 补齐）：
  //   练习册自包含错题走 addSelfContainedWrongQuestion，而该函数**没有**置信度闸，
  //   于是 AI 低置信判错的练习册题会直接入册，与「低置信度一定不能入」冲突。
  //   在此按同一阈值拦截。未作答(blank)不受约束；confidence 为空（AI 未判定）也不挡。
  //   实测：本路径已判定的题 confidence 统一为 0.95、未作答为 null，
  //   所以该闸对现有数据零影响，是防空转的未来防护。
  const workbookConfidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8
  let workbookAdded = 0
  let workbookSkippedLowConf = 0

  for (const wq of wrongQuestions) {
    if (wq.answer_source !== 'blank' && wq.confidence != null && wq.confidence < workbookConfidenceThreshold) {
      workbookSkippedLowConf++
      console.log(`   [Workbook] 低置信度错题已排除: question_no=${wq.question_number} conf=${wq.confidence} (阈值 ${workbookConfidenceThreshold})`)
      continue
    }
    // ── 整题裁片（wrong_questions.question_image_url）已下线（2026-09-21）──
    //
    // 用户口径：「我不管是日常作业还是练习册管线，我最终都是把题目结构化了。
    //   我的错题本都是结构化存到库里的。我如果要留痕的话，我只需要原始图片就可以了，
    //   而不是这道题的裁片。」
    //
    // 事实依据：
    //   · 本管线是 question_image_url 的**全仓唯一写入点**（日常管线不产它）；
    //   · 它按 block_coordinates 裁，而 block 是「均分占位」偏多 → 裁片系统性带上下邻题
    //     （第04周 p2 实测五张截图全部是「上半本题 + 下半下一题题号」）；
    //   · 消费方（周末课件题单 / 讲题白板）本就是**配图优先**（figure 先用
    //     clean_geometry_image_url / geometry_image_url），裁片只作回退，配图补齐后无消费方；
    //   · 留痕走整页原图（tasks.images + docImage），整页图永远正确，比错位裁片有用得多。
    //
    // 因此这里不再裁剪、不再写 question_image_url。存量行不删（无消费方，自然失效）。
    // 也正因此，不必再给写入侧补 blockBoxTrust 的第二三道闸 —— 那是给裁片修的护栏。
    const questionImageUrl = null

    // 逐题独立 try/catch：单题写入异常（写库抖动）不得中断其余错题的入册。
    // 练习册错题按「题」定位（2026-09-16 跨卷串行根治）：questionId=wq.id 恒有 →
    // 冲突目标 (student_id, question_id)，跨卷同题号不再共用一行；
    // 无 questionId 的真自包含错题才退 (student_id, worksheet_id, question_no)。
    // taskId 必传（2026-09-14 根治）：入册层据此区分「同任务重跑（不加 error_count）」
    // 与「新任务真做错（+1）」，杜绝批改链路重跑把错题次数越刷越高。
    try {
      await addSelfContainedWrongQuestion({
        studentId,
        worksheetId,
        questionNo: wq.question_number,
        pageNumber: wq.page_number || 1,
        studentAnswer: wq.student_answer || null,
        correctAnswer: wq.answer || null,
        answerType: wq.question_type || 'choice',
        content: wq.content || null,
        questionType: wq.question_type || 'choice',
        blockCoordinates: wq.block_coordinates || null,
        questionImageUrl,
        // 与 questions.subject 使用同一权威来源，保证错题本自包含记录也可按学科筛选。
        subject: workbookSubject || wq.subject || null,
        sourceType: 'workbook',
        questionId: wq.id,
        taskId
      })
    } catch (e) {
      console.error(`  ⚠️ [Workbook] 错题入册失败 question_no=${wq.question_number} q=${String(wq.id).slice(0, 8)}:`, e.message)
      continue
    }
    workbookAdded++
  }

  if (wrongQuestions.length > 0 || workbookSkippedIncomplete > 0) {
    const skipNote = [
      workbookSkippedLowConf > 0 ? `低置信度排除 ${workbookSkippedLowConf} 题` : '',
      workbookSkippedIncomplete > 0 ? `完整性闸排除 ${workbookSkippedIncomplete} 题（${Object.entries(incompleteSkipReasons).map(([k, v]) => `${k}=${v}`).join(' ')}）` : '',
    ].filter(Boolean).join('，')
    console.log(`   [Workbook] 已添加 ${workbookAdded} 题到错题本（自包含）${skipNote ? '，' + skipNote : ''}`)
  }

  // 7. 记录 judgement
  for (const q of questionsWithStudentId) {
    if (q.answer && q.student_answer && q.student_answer !== 'null') {
      try {
        await createJudgement({
          questionId: q.id,
          studentId,
          source: 'ai_ocr',
          confidence: q.is_correct !== null ? 0.95 : null,
          isCorrect: q.is_correct,
          content: q.content,
          answer: q.answer,
          studentAnswer: q.student_answer,
          analysis: q.analysis,
          metadata: { worksheet_id: worksheetId, source: 'workbook_pipeline' }
        })
      } catch (e) {
        // 非阻塞
      }
    }
  }

  // 8. 完成
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  // 待人工题数（答案库无匹配等）：不进 wrongCount 也不进 emptyCount，
  // 必须单独下发，否则列表页"无错无空"会写成"全部正确"。
  const { pendingCount } = computeTaskStats(questionsWithStudentId)
  await updateTaskStatus(taskId, TASK_STATUS.DONE, {
    progress: 100,
    questionCount: allQuestions.length,
    wrongCount,
    matchedCount,
    emptyCount,
    pendingCount,
    duration: `${duration}s`,
    source: 'workbook',
    sectionMatch: sectionMatchInfo,
    // 引图题最终没拿到配图的数量（与 processTask 同口径）：漏框 / 退化框 / 归属存疑被拦都计入。
    // 前端据此提示「重新识别」，运维可据此按图索骥补图。
    figureMissingRefs: workbookFigureMissingRefs > 0 ? workbookFigureMissingRefs : undefined,
    // 清除历史失败标记：updateTaskStatus 是 merge 语义，重跑成功时若不显式清除，
    // 上次失败的 error / errorType / failedAt 会残留在 result 里，前端据此误报失败。
    error: null,
    errorType: null,
    failedAt: null
  })

  console.log(`✅ [Workbook] 完成: ${allQuestions.length} 题, ${wrongCount} 错, ${emptyCount} 空, ${pendingCount} 待人工, 共 ${imageList.length} 页, 耗时 ${duration}s`)
}

// ═══════════════════════════════════════════════
// 统一答案库管线
// ═══════════════════════════════════════════════
//
// 适用场景：
//   - worksheet（official_verified）：练习册已有官方答案
//   - exam（teacher_verified）：试卷已有教师审核答案
//   - retry_paper（teacher_verified）：错题重练卷已有答案
//
// 流程：OCR 提取学生答案 → resource_answers 查找 → judgeAnswer 比对
// 跳过 AI 生成答案，大幅节省成本。
//
// 关键修复（2026-08-01）：
// 旧版 bulkLookupResourceAnswers(resourceId, questionNos) 只按 question_no 查，
// 多 unit 场景下（试卷①/试卷②/试卷③ 题号都从 1 开始）只返回 question_no ASC 第一行，
// → 学生答对但用错单元的答案比对，批改结果"一塌糊涂"。
// 改用 getResourceAnswersBySection(resourceId) 返回 3D Map
// (unitKey → sectionKey → qNo|subNo → row) + pickAnswerUnit 选单元，按 (unit, section, qNo) 精确定位。

const processAnswerBankGrading = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName, resourceId: _resourceId } = job.data
  // resource_id 仅在夜间解析答案库时被设置；普通 workbook 任务只有 worksheet_id。
  // 降级兜底：resourceId 为空时回退到 worksheetId（两者对答案库批改管线等价）
  const resourceId = _resourceId || job.data.worksheetId || null
  const startTime = Date.now()

  const resolveImageUrl = (raw) => {
    if (typeof raw === 'string') {
      if (raw.startsWith('{')) {
        try { const parsed = JSON.parse(raw); return parsed.url || parsed.ossPath || '' }
        catch { return raw }
      }
      return raw
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }

  const fail = async (msg) => {
    console.error(`💥 [AnswerBank] taskId=${taskId} 失败: ${msg}`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: msg, last_error: msg, failedAt: new Date().toISOString() }).catch(() => {})
    throw new Error(msg)
  }

  console.log(`\n🔹 [AnswerBank] 开始答案库批改: resourceId=${resourceId}, taskId=${taskId}`)

  try {
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 5, startedAt: new Date().toISOString() })

    // 查询资源信息，确认答案状态
    const resource = await getResourceById(resourceId)
    if (!resource) return fail('资源不存在')
    // v4：草稿资源（status='draft'）不能被其他任务复用判题，必须 published 才走 AnswerBank。
    // answer_status 仅作辅助判定（兜底）。
    if (resource.status !== 'published') {
      console.warn(`⚠️ [AnswerBank] 资源未发布 (status=${resource.status})，降级为 general 管线`)
      job.data.resourceId = null
      return processTask(job)
    }
    if (resource.answer_status === 'none' || resource.answer_status === 'ai_draft') {
      console.warn(`⚠️ [AnswerBank] 资源答案未审核 (${resource.answer_status})，降级为 general 管线`)
      // 清除 resource_id 后重新走 general 管线
      job.data.resourceId = null
      return processTask(job)
    }

    // 多图处理
    let rawPages = Array.isArray(job.data.images) && job.data.images.length > 0
      ? job.data.images
      : (typeof job.data.images === 'string' ? (() => { try { return JSON.parse(job.data.images) } catch { return null } })() : null)
    if (!Array.isArray(rawPages) || rawPages.length === 0) {
      const url = resolveImageUrl(rawImageUrl)
      rawPages = [{ page_number: 1, image_url: url }]
    }
    const pages = rawPages.map((p, i) => ({ pageNumber: p.page_number || i + 1, imageUrl: resolveImageUrl(p.image_url), fileName: p.file_name || null }))

    if (pages.length === 0 || !pages[0].imageUrl) return fail('无有效图片')

    await job.updateProgress(10)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 10 })

    // 下载所有图片
    const imageBuffers = []
    for (const page of pages) {
      try {
        const buf = await downloadImage(page.imageUrl)
        imageBuffers.push({ pageNumber: page.pageNumber, buffer: buf })
      } catch (e) {
        console.error(`⚠️ [AnswerBank] 第 ${page.pageNumber} 页下载失败: ${e.message}`)
      }
    }
    if (imageBuffers.length === 0) return fail('图片全部下载失败')

    await job.updateProgress(20)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 20 })

    // ─────────────────────────────────────────────────────────
    // 答案库批改的 OCR 提示词（关键修复）
    // 旧版复用 buildOCRPrompt，prompt 里有"answer 标准答案"字段 + 整体走通用管线，
    // 实际没有用 AI 生成的 answer，而是和答案库比对；但 prompt 仍诱导 AI 干无用功，
    // 且**没有 page_title / chapter_hint 输出**，导致多 unit 场景下无法定位单元。
    //
    // 这里专门写一个 prompt：
    //   1) 不让 AI 猜标准答案（答案库已存在）
    //   2) 强制输出 page_title + chapter_hint（批改时定位单元的锚点）
    //   3) question_number 从印刷体题号读取
    // ─────────────────────────────────────────────────────────
    const answerBankPrompt = `你是一个专业的学生手写答案识别助手。请从试卷/作业图片中提取页面标题和每道题的题号、学生手写答案。

⚠️ 关键：请严格区分印刷体文字和手写文字
- 印刷体文字（题目、选项、题号数字等）→ 不要作为 student_answer
- 手写体文字（学生书写的内容）→ 这才是 student_answer
- 不要猜测或生成标准答案（answer 字段）！答案库已存在，你的任务是仅识别学生作答内容。

只输出 JSON 对象，格式：
{
  "page_title": "页面顶部印刷体标题，如'试卷① 19.1 平方根与立方根 基础性测试'（课时测试卷）、'试卷② 21.2(3) 一般的一元二次方程的解法'（课时测试卷）、'第二章 评价测试卷'/'第十九章 单元测试卷'（章级测试卷）。注意：'试卷N'与'第X章...测试卷'是不同层级的单元，必须如实区分输出，没有则填 null",
  "chapter_hint": "根据题目内容推断的章节名，如'第二十章二次根式'、'第十九章实数'，不确定就填 null",
  "questions": [
    {
      "question_number": 1,
      "sub_no": "1",  // 如果该题包含多个小问（如 21.(1)、21.(2)），填写小问号 1/2/3...；否则填 null
      "parent_stem": null,  // ⚠️多小问大题必填：(1) 之前的公共题干原文（公共条件、公共图形描述、公共设问前提）。同一大题拆出的每个小问，parent_stem 必须逐字相同；没有小问的题填 null
      "content": "题目原文（印刷体题干）",
      "options": ["选项A的正文", "选项B的正文", "选项C的正文", "选项D的正文"],
      "student_answer": "学生手写的答案文本，没有则填 null",
      "question_type": "choice",  // choice | fill | judge | answer
      "block_coordinates": { "x": 120, "y": 300, "width": 760, "height": 90 },
      "image_type": "geometry/chart/none",
      "image_bbox": null,  // 有配图时填 { "x": 640, "y": 180, "width": 200, "height": 130 }（只框图形本身）
      "has_figure": false  // true=本题有配图并对图形本身给出了 image_bbox
    }
  ]
}

注意：
- page_title 从页面页眉/大标题的印刷体读取，尽量完整（包括圈序号 ①②③、试卷序号、课时编号 19.1(1) 等关键信息）。
  它是批改时定位答案库的关键锚点——必须如实输出，绝不要省略或简化。
  例如：识别到"试卷①  19.1  平方根与立方根  基础性测试"就必须原样输出整串，不要简化为"试卷1"。

⚠️【关键】如果页面顶部看不到印刷体页眉/标题（被裁掉、模糊、或本就是"二、选择题 + 简答题"这类无章节标题的排版），
  绝对不能把 page_title 留为 null！必须根据本页【题目内容特征】推断最可能的章节标题并填入：
  - 题目出现 √、±√、二次根式、根号运算、平方根、立方根 → 填 "第二十章二次根式"
  - 题目出现实数、无理数、有理数、相反数、绝对值、数轴、科学记数法、近似数 → 填 "第十九章实数"
  - 题目出现一元二次方程、求根公式、判别式、根与系数 → 填 "第二十一章一元二次方程"
  - 题目出现直角三角形、勾股定理、角平分线 → 填 "第二十二章直角三角形"
  - 其他情况：根据题号所在范围 + 内容特征推断；实在判断不出，填 "未知章节"。
  page_title 缺失会导致后端无法定位答案库而错挂章节，批改结果"一塌糊涂"。

- chapter_hint 必须填！当 page_title 拿不准章节时，chapter_hint 是关键的兜底信号。
  填法与上面 page_title 的章节推断规则完全一致。

- content 必须填：每道题的题干原文（印刷体），至少包含这道题在问什么。
  选填题可写"下列各式中正确的是"或"与数轴上的点一一对应的是"等；
  计算题可写"(1) √12 × √(1/3)"；填空题可写"某数..."。
  它的作用是：后端会用 content 里的关键数学符号（√、根号等）反推章节归属。
  content 缺失会导致章节无法反推。

- 配图字段（image_type / image_bbox / has_figure）必须填（2026-09-21 补，与日常批改管线同口径）：
  ⚠️ 2026-09-20 事故：本 prompt 原先没有配图字段，全卷「如图」的几何题配图从未被采集，
  落库后 geometry_image_url 全空 → 错题本/周末课件题单/讲题白板里的几何题没有图，
  学生在白板上看到的是一道没有图形的几何证明题。**引图题漏填 image_bbox 等同于这道题不可用。**
  · image_type：图形类别，"geometry"（几何图/示意图）| "chart"（函数图/统计图表）| "none"（无配图）。
  · image_bbox：**配图本身**的外接矩形（0-1000 归一化，与 block_coordinates 同一坐标系）；
    只框图形（几何图、函数图、统计图表、示意图），不要把题干文字、选项文字、答题横线框进去。
    没有配图时填 null。
  · has_figure：本题是否有配图并给出了 image_bbox（true/false）。
  · ⚠️ 常见排版陷阱：很多试卷把好几道题的配图集中排成一行，图的正下方标注"第1题图"
    "第2题图"…，而不是把图放在各自题目的正下方。遇到这种排版，必须按下方标注找到
    属于本题的那一格图，只框那一格（例如第2题就框标注"第2题图"的那一张），
    绝不能框题干下面的那条文字，也不要把整行图全框进来。
  · 如果确实找不到本题的配图，image_type 填 "none"、image_bbox 填 null、has_figure 填 false，
    **不要用题干区域的坐标凑一个框**——凑出来的框裁出的是文字，会被当成配图展示给学生。
  · ⚠️ 多小问大题（拆成多行输出、公共题干写在 parent_stem）：如果图形出现在公共题干里
    （公共题干含"如图/图1/图示/附图/见图"），那么**拆出来的每一个小问都必须返回同一个
    image_type 与 image_bbox**（同一个图形，坐标逐字相同），不能只在其中一个小问上返回、
    也不能都不返回。小问自己另配图时，才返回它自己的框。

- options 必须填：**凡是卷面印了 A、B、C、D 选项的题，都要把选项完整填进 options**。
  ⚠️ 2026-09-18 事故：本 prompt 原先没有 options 字段，选择题的选项从未被采集，
  落库后 options=[] → 周末课件题单/讲题白板只剩「题干 + 参考答案 D」，老师看不到 A/B/C/D，
  误以为识别失败。**选择题漏填 options 等同于这道题不可用**，必须逐题检查。
  - 只填【选项正文】，绝不能带 A/B/C/D 标号：卷面印的「（A）3/4」「(B) 4/3」「A. apple」
    要去掉标号，只留 ["3/4", "4/3", "apple"]，按 A、B、C、D 顺序排列。
    标号由界面按顺序自动生成，options 里再带一遍会显示成 "A. （A）3/4"。
  - 选项是【图形】时（如「下列作图中正确的是」配四张图），填该选项图的简短描述，
    形如 ["选项A图", "选项B图", "选项C图", "选项D图"]，或带上能区分四张图的特征
    （如 ["图A：开口向上的抛物线与斜率为正的直线", …]）。
    **绝不能因为选项是图就把 options 留空。**
  - 判断题的 options 填 ["正确", "错误"]。
  - 填空题/解答题等非选择题 options 填 []。
  - 选项正文里的分数、根号、指数按「数学符号识别规范」原样转录（如 "3/8"、"√15/15"）。

【数学符号识别规范（印刷体题干，必须严格遵守）】
- 题干中的数学式子必须完整、准确地转录，禁止漏写、替换或臆造符号。
- 严格区分三种"叉形"符号：
  · 算式中间表示相乘的是乘号"×"（如"3×4"、"√12 × √(1/3)"）；
  · 出现在未知数/方程/代数式里的是字母"x/X"（如"x²-3x+2=0"、"x÷3"）；
  · 判断题批改标记、或题干里明确是判断结果时才用"√/✗"。
  绝不要用"×"去替代方程里的字母 x，也不要把题干文字里的打叉当成乘号。
- 除号"÷"、分数线"/"、根号"√"、平方"²"、立方"³"、指数、小数点"."、百分号"%"必须原样保留。
- 题干里的填空横线"____"、括号"（ ）"、空格占位要原样保留，不要删掉也不要擅自填写。
- 若某处印刷体实在模糊无法辨认，用"□"占位，绝不要输出一堆无意义的符号（如"× ×"、"% = %"、"= = ="）。
- 判断题/简答题题干若含"对/错""下列……正确的是""计算""化简""求值""求证""解方程"等文字，必须完整保留这些文字。
- ⚠️ 简答题/解答题/计算题的题干一定包含汉字描述或数字（如"计算"、"化简"、"解方程"、"求值"）。
  如果识别出的 content 全部是符号、不含任何汉字和数字（如"÷ = × ×"），说明识别错误，
  必须重新仔细查看该题印刷体原图后重新填写真实题干。
- 分数与紧邻自变量字符的边界（易错点，必须严格遵守）：
  · 当分数 1/3、2/5、a/b 后面紧接独立自变量（x²、y³、t、z^n），必须理解为「系数 × 自变量」
    ——分母是该分数的分母，自变量是该字符和它后面的指数，两者各自独立。
  · 正例：y = -1/3 x² 表示 -(1/3)·x² = -x²/3，分母是 3、自变量是 x²。
  · 反例：写成 y = -1/(3x)² 是错的——分母变成 3x²，等价于 -1/(9x²)，原题没有这个意思。
    除非原题明确把分母用括号括起来（如 1/(3x)），否则不要把分母和紧邻自变量合并。
  · 紧凑排版的视觉错觉：印刷体里分数 -1/3 和紧邻 x² 之间只有很窄的视觉间隙，
    模型容易把分母 3 和自变量 x 合并为 3x——必须警惕。
  · 同样适用于所有「分数 + 自变量 + 指数」组合：1/2 y³、2/5 t、a/b z^n、1/4 x、3/5 sinθ 等。

- question_number 从印刷体题号读取，必须是数字。
  注意：每个试卷单元（如"试卷①"）的题号都从 1 重新开始编号，请按当前页所在单元的局部题号输出。
  试卷小标题出现在本页时（如"试卷① 19.1..."），该单元下的题号即从 1 开始。
- 如果一道大题包含多个小问（如 21.(1)、21.(2)、22.(1)、22.(2)），必须将每个小问拆成独立的 question 对象输出：question_number 填大题号，sub_no 填小问号，content 只写该小问的题干，student_answer 只写该小问的手写答案。不要把多个小问合并成一道题
- ⚠️【拆小问绝不能丢掉大题的公共题干】每个拆出来的小问对象都必须带 parent_stem：
  填该大题第一个小问标号（(1)）**之前的公共题干原文**（公共已知条件、公共图形文字描述、公共设问前提），
  一个字都不能少、不能改写；同一大题拆出的所有小问，parent_stem 必须逐字相同。
  没有小问的普通题 parent_stem 填 null。
  反例（本系统真实事故）：原题「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).(1)求 a、b 的值；(2)求抛物线与直线 y=x+5 的两交点及顶点所构成的三角形的面积。」
    错误写法：只输出两条 content「(1)求 a、b 的值；」「(2)求…面积。」，parent_stem 留空
      → 公共条件「已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).」彻底丢失，
        这两问在错题重练卷上变成没有条件的空题，学生根本无法作答。
    正确写法：两条都带 parent_stem = "已知抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b)."，
      content 分别只写「(1)求 a、b 的值；」「(2)求…面积。」（content 不要重复 parent_stem 的内容）
  公共题干若跨多行（含图形说明、表格、"其中…"补充条件），必须完整并入 parent_stem，不要只取第一行。。

- student_answer 只提取学生手写的内容，如果没有手写迹，填 null；判断题的 √/× 也要提取

- 不要猜测标准答案！不要输出 answer 字段！答案库已存在，不要试图生成。

- 只返回 JSON，不要其他文字`

    // OCR 提取学生答案（按页处理，每页保留 page_title / chapter_hint）
    const pageDataList = []
    let ocrErrors = 0
    let totalQuestions = 0

    for (let pageIdx = 0; pageIdx < imageBuffers.length; pageIdx++) {
      const { pageNumber, buffer } = imageBuffers[pageIdx]
      console.log(`   [AnswerBank] 处理第 ${pageIdx + 1}/${imageBuffers.length} 页: pageNumber=${pageNumber}`)

      let compressed
      try {
        compressed = await sharp(buffer).rotate().normalize().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      } catch (e) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页压缩失败: ${e.message}`)
        ocrErrors++
        continue
      }

      // OCR 调用 + 解析（2026-08-06 加自动重试）：
      // 偶发一次失败/空结果就整页丢弃，会破坏题号连续链——实测 p12（阶段练3 首页）
      // 单次 OCR 失败导致首页锚点缺失，阶段练3 的 p9/p10 被物理链错归阶段练2。
      // 重试（AI_CONFIG.MAX_RETRIES+1 次，指数退避）显著提升整卷连续链稳定性。
      let content = null
      let questions = []
      let pageTitle = null
      let sectionTitle = null
      let chapterHint = null
      const maxAttempts = (AI_CONFIG.MAX_RETRIES || 0) + 1
      let ocrLastError = ''
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const result = await callVisionCompletion({
            imageDataURL: bufferToBase64(compressed),
            systemPrompt: answerBankPrompt,
            userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
            temperature: 0.1,
            maxTokens: 4096,
            // 配图字段（image_type/image_bbox）是本次新增采集，弱备份模型不守 schema 会整列丢失
            // → 配图全空、完整性闸又判缺图。与答案页 OCR 同口径锁主力模型。见 P0-3（2026-09-21）。
            noBackup: true
          })
          content = result?.content
        } catch (e) {
          ocrLastError = `调用失败: ${e.message}`
          if (attempt < maxAttempts - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); continue }
          break
        }
        if (!content) {
          ocrLastError = 'AI 返回空内容'
          if (attempt < maxAttempts - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); continue }
          break
        }
        // 解析 JSON
        try {
          const jsonStr = stripCodeFence(content)
          const parsed = JSON.parse(jsonStr)
          questions = []
          pageTitle = null
          sectionTitle = null
          chapterHint = null
          if (Array.isArray(parsed)) {
            questions = parsed
          } else if (parsed && typeof parsed === 'object') {
            pageTitle = parsed.page_title || null
            sectionTitle = parsed.section_title || null
            chapterHint = parsed.chapter_hint || null
            questions = Array.isArray(parsed.questions) ? parsed.questions : []
            if (chapterHint) {
              for (const q of questions) {
                if (q && typeof q === 'object') q._chapter_hint = chapterHint
              }
            }
          }
        } catch (e) {
          ocrLastError = `JSON 解析失败: ${e.message}`
          if (attempt < maxAttempts - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); continue }
          break
        }
        if (questions.length === 0) {
          ocrLastError = '识别到 0 道题'
          if (attempt < maxAttempts - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); continue }
          break
        }
        break // 成功
      }

      if (questions.length === 0) {
        console.error(`   [AnswerBank] 第 ${pageNumber} 页 OCR 失败（重试 ${maxAttempts} 次后放弃）: ${ocrLastError}`)
        ocrErrors++
        continue
      }

      normalizeBlockBoxSemantics(questions)

      // 标记每道题来自哪页图片
      for (const q of questions) {
        q._page_number = pageNumber
        q._page_image_url = pages[pageIdx]?.imageUrl || null
      }

      // 把 AI 合并输出的多小问大题拆成独立题目（如 q21(1)、q21(2)）
      questions = splitOcrQuestionsBySubNo(questions)

      // 稀疏/垃圾题干检测 + 区域聚焦重 OCR（与 workbook 管线同一套逻辑）：
      // 整页 OCR 对复杂数学题干易只识别出"计算："这类指令词而丢失算式，
      // 或产出"× ×"这类无意义符号；用该题 block_coordinates 从原图裁剪
      // 题目区域单独请求 VLM 补全算式。
      const pageImageUrl = pages[pageIdx]?.imageUrl || null
      const sparseCount = questions.filter(q => q && (isSparseQuestionContent(q.content) || isGarbageQuestionContent(q.content))).length
      if (sparseCount > 0 && pageImageUrl) {
        console.warn(`   ⚠️ [AnswerBank] 第 ${pageNumber} 页检测到 ${sparseCount} 道题题干稀疏/垃圾（无算式或纯符号），触发区域聚焦重OCR`)
        for (const q of questions) {
          if (!q || !(isSparseQuestionContent(q.content) || isGarbageQuestionContent(q.content))) continue
          const fullContent = await reocrQuestionRegion(pageImageUrl, q.block_coordinates, q.question_number,
            q.question_type === 'answer'
              ? (q.content.includes('方程') ? '这是解方程题，需完整转录方程算式。' : '这是计算题，需完整转录算式（含分数/带分数）。')
              : '')
          if (fullContent) {
            console.log(`   ✅ [AnswerBank] 区域聚焦重OCR补全 第${pageNumber}页 Q${q.question_number}: "${q.content}" → "${fullContent}"`)
            q.content = fullContent
            q._content_recovered = true
          } else {
            console.warn(`   ⚠️ [AnswerBank] 区域聚焦重OCR未补全 Q${q.question_number}，保留原题干"${q.content}"`)
            q._content_sparse = true
          }
        }
      }

      console.log(`   [AnswerBank] 第 ${pageNumber} 页: 识别到 ${questions.length} 道题, 标题="${pageTitle}"`)

      totalQuestions += questions.length
      pageDataList.push({
        pageTitle,
        sectionTitle,
        pageNumber,
        imageUrl: pages[pageIdx]?.imageUrl || null,
        questions,
        chapterHint: questions.find(q => q && q._chapter_hint)?._chapter_hint || null
      })

      const progress = 20 + Math.round(((pageIdx + 1) / imageBuffers.length) * 30)
      await job.updateProgress(progress)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress })
    }

    if (totalQuestions === 0) {
      const errorDetail = ocrErrors > 0 ? `${ocrErrors} 页识别失败` : 'OCR 未识别到任何题目'
      return fail(errorDetail)
    }

    await job.updateProgress(50)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 50 })

    // ─────────────────────────────────────────────────────────
    // 单元感知批改（关键修复）
    // 旧版用 bulkLookupResourceAnswers(resourceId, questionNos) → answerMap = Map<questionNo, row>，
    // 完全没考虑 unit_id。当答案库有多个 unit（试卷①/试卷②/试卷③），每个 unit 题号都从 1 开始，
    // answerMap.get(1) 只返回 question_no ASC 排序后的第一行 → 学生答对但批错。
    //
    // 新版：getResourceAnswersBySection 返回 3D Map（unitKey → sectionKey → qNo|subNo → row），
    // 用 pickAnswerUnit 选本页所属 unit，再在 unit 内部按 (section, question_no, sub_no) 精确定位。
    // ─────────────────────────────────────────────────────────
    const answersByUnit = await getResourceAnswersBySection(resourceId)
    const unitCount = answersByUnit.size
    console.log(`   [AnswerBank] 答案库共 ${unitCount} 个 unit: ${[...answersByUnit.keys()].join(', ')}`)

    // 比对并保存
    const savedQuestions = []
    let emptyCount = 0, matchedCount = 0
    let wrongCount = 0
    const unitHitMap = new Map()  // unitKey → 命中数（诊断用）
    // 临时索引：question_number → { matched_unit_key, matched_unit_title }
    // 供后续 judgement 写入时携带诊断信息（questions 表无此列，故不入表）
    const matchInfoByQN = new Map()
    let qnCounter = 0

    // ★ 两遍扫描：先预识别每页单元（含双向相邻继承，解决学生倒序扫描时
    //   无标题解答题页永远继承不到后页标题页的问题），批改循环直接采用结果。
    //   决策链（信息可靠性从高到低，2026-08 重排）：
    //     1. 标题匹配 (pageTitle+chapterHint+lessonHint+内容特征)  ── pickAnswerUnit 内部
    //     2. 学生答案反推（按题粒度）                            ── pickAnswerUnit 内部
    //     3. 答案覆盖率兜底（整页粒度）                          ── pickAnswerUnit 内部
//    4. 页码范围兜底（依赖答案 PDF 物理位置元数据）          ── pickAnswerUnit 内部
    //    5. 双向相邻页继承（锚点向两侧传播，含倒序扫描场景）     ── resolveAnswerUnits
    const resolvedUnits = resolveAnswerUnits(answersByUnit, pageDataList)
    const unitByPageNumber = new Map(resolvedUnits.map(r => [r.pageNumber, r.unitKey]))
    const resolvedByPage = new Map(resolvedUnits.map(r => [r.pageNumber, r]))

    for (const { pageTitle, pageNumber, imageUrl, questions, chapterHint } of pageDataList) {
      if (questions.length === 0) continue
      // 页级可疑标记：单元匹配经分组兜底（group-fallback）或同号多单元打平（groupTie），
      // 说明本页归属置信度低，写 is_suspicious 供 PC 端展示，避免错挂静默无感。
      const resolvedInfo = resolvedByPage.get(pageNumber) || {}
      const pageSuspicious = !!(resolvedInfo.groupTie || resolvedInfo.method === 'group-fallback')

      // 1) 选本页所属 unit（直接用预扫描结果，含双向相邻继承）
      const matchedUnit = unitByPageNumber.get(pageNumber) ?? null

      const unitAnswers = matchedUnit != null ? answersByUnit.get(matchedUnit) : null
      const noUnit = unitCount === 0

      if (matchedUnit) {
        unitHitMap.set(matchedUnit, (unitHitMap.get(matchedUnit) || 0) + 1)
      }
      // 防御 4：诊断标记——为便于事后审计，用 [suspect] 标记当 pageTitle 不为 null 但
      // 已被 pickAnswerUnit 内部的 trustedPageTitle 自检置空的页（OCR 误识别场景）。
      // 因为 trustedPageTitle 是 pickAnswerUnit 局部变量，这里只能根据 pageTitle 与所有候选
      // unit title/key 都不匹配来近似判定（与 pickAnswerUnit 内部同一规则）。
      let suspectMount = false
      if (matchedUnit && pageTitle && typeof pageTitle === 'string' && pageTitle.length >= 3) {
        let anyContain = false
        for (const uk of answersByUnit.keys()) {
          const secMap = answersByUnit.get(uk)
          if (!secMap) continue
          const sample = [...secMap.values()][0]?.values().next()?.value
          if (!sample) continue
          const ck = sample.unit_key || uk
          const ct = sample.unit_title || ''
          if (ck.includes(pageTitle) || ct.includes(pageTitle) || pageTitle.includes(ck) || pageTitle.includes(ct)) {
            anyContain = true
            break
          }
        }
        if (!anyContain) suspectMount = true
      }
      console.log(`   [AnswerBank] 页匹配: pageNumber=${pageNumber} title="${pageTitle}" chapterHint="${chapterHint}" → unit="${matchedUnit}" (${questions.length} 题)${suspectMount || pageSuspicious ? ' [suspect]' : ''}`)

      // 2) 在该 unit 的"section → qNo|subNo → row"二维索引中，每道题独立查答案
      //   同一 unit 下不同 section 可能有相同题号（如"一、填空题 1"和"三、解答题 1"），
      //   必须按 question_type 选择对应 section，否则会把填空题答案挂到解答题上。
      const sectionScoreForType = (section, questionType) => {
        if (!section) return 50
        const s = String(section)
        if (questionType === 'choice') return /选择/.test(s) ? 100 : 0
        if (questionType === 'judge') return /判断/.test(s) ? 100 : 0
        // fill/answer 都可能落在"填空题"或"解答题/计算题/证明题"；
        // 按 section 在答案库中的出现顺序（填空题通常在前）作为次优先级
        if (/填空/.test(s)) return 100
        if (/解答|计算|证明|简答|作图/.test(s)) return 90
        if (/选择/.test(s)) return 0
        if (/判断/.test(s)) return 0
        return 50
      }
      const lookupRow = (qNo, subNo, questionType) => {
        if (!unitAnswers) return null
        const qKey = `${Number(qNo)}|${subNo || ''}`
        let best = null
        let bestScore = -1
        for (const [section, qMap] of unitAnswers) {
          const row = qMap.get(qKey)
          if (!row) continue
          const score = sectionScoreForType(section, questionType)
          if (score > bestScore) {
            bestScore = score
            best = row
          }
        }
        // P0.5 防误伤：小题行可能错位（27.2(2) 实测），与整题行对应段明显不符时回退整题行
        if (best && subNo) {
          const qKeyWhole = `${Number(qNo)}|`
          let wholeRow = null
          let wholeScore = -1
          for (const [section, qMap] of unitAnswers) {
            const row = qMap.get(qKeyWhole)
            if (!row) continue
            const score = sectionScoreForType(section, questionType)
            if (score > wholeScore) {
              wholeScore = score
              wholeRow = row
            }
          }
          if (wholeRow && !isSubRowConsistentWithWhole(subNo, best.answer, wholeRow.answer)) {
            console.warn(`   [AnswerBank] 答案库小题行疑似错位: 题${qNo}(${subNo}) 小题行答案"${String(best.answer).slice(0, 30)}"与整题行(${subNo})段不符，回退整题行答案`)
            return wholeRow
          }
        }
        return best
      }

      // 2.0-pre) 列出答案库中某题号的所有 sub_no 行（如 q21 → [{1, row}, {2, row}]）
      //   用于 OCR student_answer 合并输出（"(1) 2 (2) 2√10"）但无 sub_no 字段时，
      //   自动展开 sub 并按段匹配。
      const findSubRowsForQuestion = (qNo) => {
        if (!unitAnswers) return []
        const out = []
        for (const qMap of unitAnswers.values()) {
          for (const [qKey, row] of qMap) {
            const [qnStr, subStr] = qKey.split('|')
            if (Number(qnStr) === Number(qNo) && subStr) {
              out.push({ sub: subStr, row })
            }
          }
        }
        return out
      }

      // 2.0-pre1a) 列出答案库中某题号的所有行（含整题 + 所有 sub），排除已占用的
      //   用于 OCR 把多空题拆成多条记录时，按出现顺序或相似度匹配
      const findAllRowsForQuestion = (qNo) => {
        if (!unitAnswers) return []
        const out = []
        for (const qMap of unitAnswers.values()) {
          for (const [qKey, row] of qMap) {
            const [qnStr, subStr] = qKey.split('|')
            if (Number(qnStr) === Number(qNo)) {
              const qKeyFull = `${Number(qNo)}|${subStr || ''}`
              if (!usedQKeys.has(qKeyFull)) {
                out.push({ sub: subStr || '', row, qKey: qKeyFull })
              }
            }
          }
        }
        return out
      }

      // 2.0-pre2) 从 student_answer 字符串中解析 (1) X (2) Y 标记，返回 [{sub, val}]
      //   支持中英文括号、半角/全角数字、空格；段内允许含括号（如"(3√2-2)²"）
      //   例："(1) 2 (2) 2√10" → [{sub:'1', val:'2'}, {sub:'2', val:'2√10'}]
      //   例："（1）√14；2 （2）2√10；√10" → [{sub:'1', val:'2'}, {sub:'2', val:'√10'}]
      //   例："（1）8-9=-1 （2）..." → [{sub:'1', val:'-1'}, ...]（取最右"="右侧）
      //   策略：先按 (1)(2)... 标记 split 字符串；段内"过程+结果"型收窄到最终答案
      //
      //   ️ 关键修复（2026-08-01 22:10）：移除负向断言，回归基础模式
      //
      //   根因分析：
      //   - 负向断言 (?![0-9...]) 会拒绝 "(2)2√10"（因为 ) 后是数字 2）
      //   - 负向断言 (?![...（...]) 会拒绝 "(1)（2）"（因为 ） 后是 （）
      //   - 负向断言 (?![...（...]) 会拒绝 "(1)(3√2-2)"（因为 ） 后是 (）
      //
      //   最终方案：移除负向断言，只用基础模式 /[（(]\s*(\d{1,2})\s*[)）]/g
      //   数学表达式如 "(12×1/3)" 中 "12" 后是 "×" 不是 ")"，基础模式已经能区分。
      //   子题标记如 "(1)2√10" 中 "1" 后是 ")"，基础模式能匹配。
      const parseSubAnswers = (s) => {
        if (!s) return []
        // 找所有 (N) 标记的位置和 N，N 为 1-2 位数字
        const markerRe = /[（(]\s*(\d{1,2})\s*[)）]/g
        const markers = []
        let m
        while ((m = markerRe.exec(s)) !== null) {
          markers.push({ sub: String(parseInt(m[1], 10)), start: m.index, contentStart: m.index + m[0].length })
        }
        if (markers.length < 1) return []

        const parts = []
        for (let i = 0; i < markers.length; i++) {
          const mk = markers[i]
          const end = i + 1 < markers.length ? markers[i + 1].start : s.length
          let val = s.slice(mk.contentStart, end)
          // 收窄到"最终答案"：
          //   1) 含 "=" 时取最右 "=" 右侧（"8-9=-1" → "-1"，避免"过程"被包含关系阈值过严误判）
          //   2) 按 ; ； 切分取末段（"√14；2" → "2"）
          //   3) 按 , ， 切分取末段（"5, 6, 7" → "7"）
          if (val.includes('=')) {
            val = val.slice(val.lastIndexOf('=') + 1)
          }
          val = val.split(/[;；]/).pop()
          val = val.split(/[,，]/).pop()
          val = val.trim()
          if (val) parts.push({ sub: mk.sub, val })
        }
        return parts
      }

      // 2.0-pre3) 兜底：OCR 漏掉 (1)(2) 标记时，按 ；/; 切分，段数与答案库 sub 数对齐
      //   例："√(12/3)=√4=2；2√(10)" → [{sub:'1', val:'2'}, {sub:'2', val:'2√(10)'}]
      //   例："9×4=36；8-9=-1" → [{sub:'1', val:'36'}, {sub:'2', val:'-1'}]
      //   触发条件：parseSubAnswers 返回空 + 答案库有 ≥2 个 sub + ；/; 切分后段数匹配
      //   策略：按 ；/; 切分；段内同样收窄到最终答案（= 右侧、末段）
      //
      //   关键修复（2026-08-01 22:15）：优先使用此函数（比 parseSubAnswers 更可靠），
      //   因为数学括号如 "(12×1/3)" 会干扰 parseSubAnswers 的 regex 匹配。
      //   段数匹配策略：优先精确匹配，其次允许段数 ≥ subCount（多余段合并到末段）。
      const splitBySemicolon = (s, subCount) => {
        if (!s || subCount < 2) return []
        const parts = s.split(/[;；]/).map(p => p.trim()).filter(p => p)
        if (parts.length < subCount) return []  // 段数不够，无法匹配
        // 段数 ≥ subCount 时，前 subCount-1 段各取一段，剩余全部合并到末段
        const result = []
        for (let i = 0; i < subCount; i++) {
          let val = i < subCount - 1 ? parts[i] : parts.slice(i).join('; ')
          // 收窄到最终答案
          if (val.includes('=')) val = val.slice(val.lastIndexOf('=') + 1)
          val = val.split(/[,，]/).pop().trim()
          if (val) result.push({ sub: String(i + 1), val })
        }
        return result.filter(Boolean)
      }

      // 取本页代表 unit_title（供本页所有题目的 judgement.metadata 共用）
      const pageUnitTitle = unitAnswers
        ? [...unitAnswers.values()][0]?.values().next().value?.unit_title || null
        : null

      // 已通过题号匹配占用的 qKey（一页内 + 历史前页），避免答案指纹搜索时重复匹配
      const usedQKeys = new Set()
      // 暂存"题号可疑"的题：第一轮题号匹配时答案完全不对，二轮用答案指纹兜底
      const suspectQuestions = []

      // 2.0-pre3a) 预扫描：检测 OCR 把多空题拆成多条同题号记录的情况
      //   例：q21 出现 2 次 → [{idx:0, occ:1}, {idx:5, occ:2}]
      //   用于 fallback 阶段按出现顺序映射到答案库 sub 行
      const qNoIndicesMap = new Map()  // qNo → [{idx, occ}]
      for (let qi = 0; qi < questions.length; qi++) {
        if (questions[qi].question_number == null) continue
        const qNo = Number(questions[qi].question_number)
        if (!qNoIndicesMap.has(qNo)) qNoIndicesMap.set(qNo, [])
        qNoIndicesMap.get(qNo).push(qi)
      }

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        if (q.question_number == null) continue

        const studentAnswer = (q.student_answer || '').toString().trim()
        const isEmpty = !studentAnswer

        let answerRow = null
        let subBreakdown = null  // [{sub, row, studentPart, refPart, correct}]，合并 sub 时填充
        if (!noUnit) {
          answerRow = lookupRow(q.question_number, q.sub_no, q.question_type)

          // 2.0.0) ★ 核心修复：OCR 把多空题拆成多条同题号记录 → 按出现顺序映射 sub ★
          //   场景：OCR 输出两条 q21（student="=√4" 和 "2√(5÷0.5)"），答案库有 21|1="2" 21|2="2√10"
          //   旧版：每条 q21 的 student_answer 只含一个 sub 答案，splitBySemicolon 拆不出来 → ref 空
          //   修复：第 1 条 q21 → lookupRow(21, '1')，第 2 条 → lookupRow(21, '2')
          //   这是"答案对不上"的根因——OCR 拆题但后端不知道该映射哪个 sub
          if (!answerRow && !isEmpty) {
            const qNo = Number(q.question_number)
            const indices = qNoIndicesMap.get(qNo) || []
            if (indices.length >= 2) {
              // 多条同题号 → 计算当前是第几条（出现顺序）
              const occ = indices.indexOf(qi) + 1
              // 按出现顺序查 sub 行
              const subRow = lookupRow(qNo, String(occ), q.question_type)
              if (subRow) {
                answerRow = subRow
                // 占用该 sub 行，避免后续同题号记录通过相似度兜底重复匹配，
                // 保证“顺序给答案”不跳跃、不重复（即使学生答错也占用）。
                usedQKeys.add(`${qNo}|${occ}`)
                // 用相似度判分（学生答案可能是过程"=√4"，参考答案是结果"2"）
                const sim = calculateAnswerSimilarity(studentAnswer, subRow.answer)
                let correct = null
                if (sim >= 0.7) correct = true
                else if (sim < 0.5) correct = false
                subBreakdown = [{
                  sub: String(occ),
                  row: subRow,
                  studentPart: studentAnswer,
                  refPart: subRow.answer,
                  correct,
                  sim
                }]
                q._subBreakdown = subBreakdown
                console.log(`   [AnswerBank] OCR拆分映射 q${qNo} occ=${occ} → sub(${occ}) student="${studentAnswer.slice(0, 30)}" ref="${(subRow.answer || '').slice(0, 30)}" sim=${sim.toFixed(2)}`)
              }
            }
          }

          // 2.0.1) sub_no 缺失 + 答案库有 sub 划分 + OCR 合并输出 → 自动拆分按段匹配
          //   例：OCR q21 student="(1) 2 (2) 2√10"，sub_no 缺失，答案库有 21|1="2" 21|2="2√10"
          //   修复前：lookupRow(21, null) 查 "21|" → 找不到 → answer 为空
          //   修复后：拆 student_answer → 段1查 21|1="2"，段2查 21|2="2√10" → 合并
          //   ★ 优先级：在 2.0.0b 相似度兜底之前执行，避免兜底提前消费答案行 ★
          if (!answerRow && !q.sub_no && !isEmpty) {
            const subRows = findSubRowsForQuestion(q.question_number)
            if (subRows.length >= 1) {
              // 优先用 parseSubAnswers（有 (1)(2) 标记时更准确，能按标记正确拆分）
              //   例："（1）√14；2 （2）2√10；√10" → sub(1)="2" sub(2)="√10" ✅
              //   splitBySemicolon 按 ；切分会把标记和答案拆开 → sub(1)="（1）√14" ❌
              let parsed = parseSubAnswers(studentAnswer)
              // 兜底：无 (1)(2) 标记或数学括号干扰时，用 splitBySemicolon（按 ；切分）
              //   例："√(12×1/3)=√4=2；2√(5/0.5)=2√10" → parseSubAnswers 返回 [] → splitBySemicolon → sub(1)="2" sub(2)="2√10" ✅
              if (parsed.length < 1) {
                parsed = splitBySemicolon(studentAnswer, subRows.length)
              }
              // parsed 段数应 ≥ subRows 段数（或更宽容：≥1）
              if (parsed.length >= 1) {
                subBreakdown = []
                let refParts = []
                let allCorrect = true
                let anyMatched = false
                // 按 sub 数字匹配（OCR 可能漏读 sub 编号）：把 parsed 按 sub 数字查 subRows
                for (const { sub, val } of parsed) {
                  const sr = subRows.find(s => s.sub === sub)
                  if (!sr) {
                    // sub 编号对不上 → 跳过（保留待人工审核）
                    continue
                  }
                  // 2.0.1.0) sub 段 judge：用答案指纹（sim >= 0.7 对；< 0.5 错；中间 null）
                  //   judgeAnswer 精确匹配在 OCR 噪声场景下易漏：
                  //     - "√10" vs "2√10"（"√10" 是 "2√10" 子串，sim=0.85）
                  //     - "8-9=-1" vs "-1"（"-1" 是 "8-9=-1" 子串，sim=0.85）
                  //   这些情况学生答案实质正确，应判对。
                  const sim = calculateAnswerSimilarity(val, sr.row.answer)
                  let correct = null
                  if (sim >= 0.7) correct = true
                  else if (sim < 0.5) correct = false
                  // 0.5 ≤ sim < 0.7 → correct=null（待人工审核，不判错也不判对）
                  subBreakdown.push({ sub, row: sr.row, studentPart: val, refPart: sr.row.answer, correct, sim })
                  refParts.push(sr.row.answer)
                  anyMatched = true
                  if (correct === false) allCorrect = false
                }
                if (anyMatched) {
                  // 合成 answerRow（用第 1 个 sub 的元数据 + 合并 ref），主循环后续按聚合处理
                  answerRow = { ...subRows[0].row, answer: refParts.join('; ') }
                  q._subBreakdown = subBreakdown
                }
              }
            }
          }

          // 2.0.0b) 答案相似度兜底：主路径 + 拆分映射 + sub 拆分都查不到 → 按 qNo 找最相似行
          //   覆盖：OCR 拆分但出现顺序与 sub_no 不一致、答案库只有整题行等边界场景
          //   ★ 在 2.0.1 之后执行，避免提前消费答案行 ★
          if (!answerRow && !isEmpty) {
            const allRows = findAllRowsForQuestion(q.question_number)
            if (allRows.length >= 1) {
              let bestRow = null
              let bestSim = 0
              let bestSub = ''
              let bestQKey = ''
              for (const { sub, row, qKey } of allRows) {
                const sim = calculateAnswerSimilarity(studentAnswer, row.answer)
                if (sim > bestSim) {
                  bestSim = sim
                  bestRow = row
                  bestSub = sub
                  bestQKey = qKey
                }
              }
              // 相似度 ≥ 0.3 才采用（避免完全不相关的答案被误匹配）
              if (bestRow && bestSim >= 0.3) {
                answerRow = bestRow
                // 占用该 qKey，避免同题号的其他记录重复匹配到同一行
                usedQKeys.add(bestQKey)
                // 如果命中的是 sub 行，设 subBreakdown
                if (bestSub) {
                  let correct = null
                  if (bestSim >= 0.7) correct = true
                  else if (bestSim < 0.5) correct = false
                  subBreakdown = [{
                    sub: bestSub,
                    row: bestRow,
                    studentPart: studentAnswer,
                    refPart: bestRow.answer,
                    correct,
                    sim: bestSim
                  }]
                  q._subBreakdown = subBreakdown
                }
                console.log(`   [AnswerBank] 相似度兜底 q${q.question_number} → sub(${bestSub || 'whole'}) sim=${bestSim.toFixed(2)} student="${studentAnswer.slice(0, 30)}" ref="${(bestRow.answer || '').slice(0, 30)}"`)
              }
            }
          }
          // 2.0.2) 关键修复：主路径 (qNo, subNo) 查不到 + q.sub_no 非空 → fallback 到整题 (qNo, '')
          //   场景：答案库整题合并存储为 21|'' = "(1)2 (2)2√10"，但 OCR 输出 sub_no='1' / sub_no='2' 两行
          //   (例如 AI 视觉模型把 (1)(2) 主动拆成 2 条 sub 题目入库)。
          //   旧版 lookupRow(21, '1') 查 21|1 找不到 → answer 为空，右侧答案显示空。
          //   修复后：整题 row.answer 用 splitSubAnswers 拆 sub 段，按当前 q.sub_no 命中对应段。
          //   同时 student_answer 可能不含 (1)(2) 标记（OCR 已拆开），直接整段比对。
          if (!answerRow && q.sub_no && !isEmpty) {
            const wholeRow = lookupRow(q.question_number, '', q.question_type)
            if (wholeRow && wholeRow.answer) {
              // 整题 row.answer 含 sub 标记？尝试按段匹配
              const subSegs = splitSubAnswers(wholeRow.answer)
              if (subSegs && subSegs.length >= 2) {
                const seg = subSegs.find(s => String(s.sub_no) === String(q.sub_no))
                if (seg) {
                  // 找到对应 sub 段：用整段 student_answer 比对 seg.answer
                  const sim = calculateAnswerSimilarity(studentAnswer, seg.answer)
                  let correct = null
                  if (sim >= 0.7) correct = true
                  else if (sim < 0.5) correct = false
                  // 0.5 ≤ sim < 0.7 → null（边界情况待人工）
                  subBreakdown = [{
                    sub: String(q.sub_no),
                    row: { ...wholeRow, answer: seg.answer },
                    studentPart: studentAnswer,
                    refPart: seg.answer,
                    correct,
                    sim
                  }]
                  // answerRow 用 seg.answer（让 answer 字段显示子段答案而非整题合并），便于右侧展示
                  answerRow = { ...wholeRow, answer: seg.answer }
                  q._subBreakdown = subBreakdown
                }
              }
              // 整题 row.answer 不含 sub 标记（如纯选择题"21. C"）：兜底整段比对
              if (!answerRow) {
                const sim = calculateAnswerSimilarity(studentAnswer, wholeRow.answer)
                if (sim >= 0.5) {
                  // 整题 row.answer 短或与 student_answer 相似时，按整题采用
                  answerRow = wholeRow
                }
              }
            }
          }
        }

        let isCorrect = null
        const refAnswer = answerRow ? answerRow.answer : null
        const refType = answerRow ? (answerRow.answer_type || q.question_type || 'answer') : (q.question_type || 'answer')

        if (subBreakdown && subBreakdown.length >= 1) {
          // 2.0.1.1) sub 拆分匹配：按 sub 段分别 judge，全部正确才算对；任一错则整题错
          //   不再用整段 judgeAnswer（会因 "(1) 2 (2) 2√10" vs "2; 2√10" 字符串相似但语义错位而误判）
          let allOk = true
          let anyJudged = false
          for (const seg of subBreakdown) {
            if (seg.correct === true) { anyJudged = true; continue }
            if (seg.correct === false) { allOk = false; anyJudged = true }
            // null（边界情况）→ 不影响 allOk
          }
          isCorrect = anyJudged ? allOk : null
          if (isCorrect === true || isCorrect === false) matchedCount++
          console.log(`   [AnswerBank] sub 拆分匹配 q${q.question_number}: ${subBreakdown.map(s => `(${s.sub})${s.correct ? '✓' : '✗'}`).join(' ')} student="${studentAnswer.slice(0, 40)}" ref="${refAnswer.slice(0, 40)}"`)
        } else if (answerRow && !isEmpty) {
          // judgeAnswer 签名：(studentAnswer, referenceAnswer, questionType)
          // 是同步函数，无需 catch 兜底（processWorkbookGrading 也按此调用）
          const judgement = judgeAnswer(studentAnswer, refAnswer, refType)
          isCorrect = judgement && typeof judgement.isCorrect !== 'undefined' ? judgement.isCorrect : null
          if (isCorrect === true || isCorrect === false) matchedCount++
        } else if (isEmpty) {
          emptyCount++
          isCorrect = null
        } else {
          // 答案库无此题目，标记为待审核
          isCorrect = null
        }

        if (isCorrect === false) wrongCount++

        // 标记题号已占用（避免二轮答案指纹搜索重复占用）
        // sub 拆分匹配时，把该题所有 sub 都标为已用
        if (subBreakdown && subBreakdown.length >= 1) {
          for (const seg of subBreakdown) {
            usedQKeys.add(`${Number(q.question_number)}|${seg.sub}`)
          }
        } else if (answerRow) {
          usedQKeys.add(`${Number(q.question_number)}|${q.sub_no || ''}`)
        }

        // 收集"题号可疑"的题进入二轮（OCR 题号错位兜底）：
        // 条件：题号匹配到 row、答案非空、但答案相似度 < 0.5（基本不匹配）
        // sub 拆分场景下已按段 judge，跳过整体 suspect 判断（避免 sub 合并 ref 引发误判）
        if (answerRow && !isEmpty && !subBreakdown) {
          const sim = calculateAnswerSimilarity(studentAnswer, refAnswer)
          if (sim < 0.5) {
            suspectQuestions.push({ q, studentAnswer, qType: q.question_type, currentRef: refAnswer, currentSim: sim })
          }
        }

        const questionData = {
          task_id: taskId,
          student_id: studentId,
          content: q.content || (answerRow && answerRow.content) || `第${q.question_number}题`,
          question_type: refType,
          answer: refAnswer,
          student_answer: studentAnswer,
          ai_answer: null,
          answer_source: isEmpty ? 'blank' : 'recognized',
          is_correct: isCorrect,
          status: isCorrect === false ? 'wrong' : 'pending',
          page_number: q._page_number || pageNumber,
          question_number: q.question_number,
          is_suspicious: !!subBreakdown || pageSuspicious,  // sub 拆分/页级归属可疑标记，供 PC 端展示
          confidence: isEmpty ? 0 : (answerRow ? (subBreakdown ? 0.9 : 0.85) : 0),
          source_type: resource.resource_type === 'exam' ? 'exam' : 'homework',
          // 落库学生作答页图 + 归一化 0-1000 坐标，供 PC 后台 PaperViewerPanel
          // 在中间试卷页定位题目（与 processWorkbookGrading 保持一致的存储策略）。
          image_url: q._page_image_url || imageUrl || null,
          block_coordinates: q.block_coordinates || null,
          // [2026-09-20] 不再写成 block_coordinates 的副本（见 processWorkbookGrading 同款改动）
          text_bbox: q.text_bbox || null,
          // 配图元素（2026-09-21 补，与 processWorkbookGrading / processTask 同口径）
          image_type: q.image_type || null,
          image_bbox: q.image_bbox || null,
          // 单元匹配结果不写入 questions（表无对应列），仅在 judgement.metadata 记录
        }

        // 稀疏/垃圾题干（区域聚焦重OCR仍未补全算式）：答案库题干优先覆盖；
        // 否则重置为占位符，避免"计算："这类无算式题干污染题库列表。
        if (q._content_sparse) {
          delete q._content_sparse
          const rawContent = questionData.content
          if (rawContent && (isSparseQuestionContent(rawContent) || isGarbageQuestionContent(rawContent))) {
            questionData.content = `第${q.question_number}题`
            questionData._content_sparse_original = rawContent
            console.warn(`   [AnswerBank] 题 ${q.question_number}: 题干异常（"${String(rawContent).slice(0, 30)}"），已重置为占位符，请人工修订`)
          }
        }

        savedQuestions.push(questionData)
        // 用全局递增 id 作为临时 key（不依赖 question_number，因多页可能同号）
        qnCounter++
        matchInfoByQN.set(qnCounter, {
          matched_unit_key: matchedUnit,
          matched_unit_title: answerRow ? answerRow.unit_title : pageUnitTitle
        })
      }

      // 2.5) 答案指纹兜底（题号错位场景）
      //   对第一轮收集的"题号可疑"题，在同 unit 内用"答案 ↔ 答案"找最相似的题
      //   解决：OCR 错把题号 22 读出来，但答案库 22(1) 是另一道题（用户截图实例）
      if (suspectQuestions.length > 0 && unitAnswers) {
        let fingerHit = 0
        for (const suspect of suspectQuestions) {
          const found = searchByAnswerFingerprint(suspect.studentAnswer, suspect.qType, unitAnswers, usedQKeys)
          if (!found) continue
          // 找到更匹配的题：用 found.row 重批 savedQuestions 里的最后一条 questionData
          // （注意：suspect 来自 questions 循环，questionData 已在 savedQuestions 末尾，qnCounter 已递增）
          // 简化做法：定位到对应的 questionData 并原地更新
          const idx = savedQuestions.length - suspectQuestions.length + suspectQuestions.indexOf(suspect)
          const qd = savedQuestions[idx]
          if (!qd) continue

          const oldRef = qd.answer
          const newRef = found.row.answer
          const newQKey = found.qKey
          const newScore = found.score

          // 用新匹配重批
          const judgement = judgeAnswer(suspect.studentAnswer, newRef, found.row.answer_type || suspect.qType || 'answer')
          const newIsCorrect = judgement && typeof judgement.isCorrect !== 'undefined' ? judgement.isCorrect : null

          // 还原统计：原题号匹配判"错"时 wrongCount++，新匹配判"对"时不需 wrongCount--
          // 简化：直接重算 isCorrect 后用最终态更新 wrongCount（仅当状态从 false → true 时 --）
          if (qd.is_correct === false && newIsCorrect === true) wrongCount--
          if (qd.is_correct !== false && newIsCorrect === false) wrongCount++

          qd.answer = newRef
          qd.is_correct = newIsCorrect
          qd.status = newIsCorrect === false ? 'wrong' : 'pending'
          qd.confidence = Math.max(0.85, newScore)  // 答案指纹命中，置信度提升
          qd.is_suspicious = true  // 标记"题号曾错位"供 PC 端展示
          // 记录原题号 vs 答案指纹匹配的真实题号（仅 console，方便诊断）
          const newQNo = newQKey.split('|')[0]
          const oldQNo = String(suspect.q.question_number)
          if (newQNo !== oldQNo) {
            console.log(`   [AnswerBank] 答案指纹兜底: OCR题号 ${oldQNo} → 答案库题号 ${newQNo} (score=${newScore.toFixed(2)}) 学生="${suspect.studentAnswer.slice(0, 20)}" 答案库="${newRef.slice(0, 20)}"`)
            fingerHit++
          }
          usedQKeys.add(newQKey)
        }
        if (fingerHit > 0) {
          console.log(`   [AnswerBank] 答案指纹兜底命中: ${fingerHit}/${suspectQuestions.length} 题（OCR 题号错位已修正）`)
        }
      }
    }

    if (unitCount > 1) {
      const hitSummary = [...unitHitMap.entries()].map(([k, v]) => `${k}=${v}`).join(', ')
      console.log(`   [AnswerBank] 多 unit 命中分布: ${hitSummary}（未命中页将答非所问）`)
    }

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // 幂等：先清旧题，再批量写入
    const deletedOld = await deleteQuestionsByTaskId(taskId)
    if (deletedOld > 0) {
      console.log(`   [AnswerBank] 幂等清理: 删除旧题目 ${deletedOld} 行`)
    }

    // 每个 question 预生成 ID，供错题本和 judgement 使用
    const questionsWithIds = savedQuestions.map(q => ({
      ...q,
      id: crypto.randomUUID(),
      student_id: studentId,
      task_id: taskId
    }))

    // 判题终裁：规则判不出的客观题 → grok-4.5 仲裁（落库前执行，结论随 createQuestions 一并写入）
    await aiJudgeUncertainQuestions(questionsWithIds)

    await createQuestions(questionsWithIds)

    // 判不出来的题：把原因落到 answer_exception_reason（观测用，不参与判定）
    await markUnjudgedReasons(questionsWithIds)

    // 图题风险标注：客观题 + 配图 → 软提示"AI 视觉推理不擅长，建议核对参考答案"
    await markImageReasoningRisk(questionsWithIds)

    // 同步错题本 + judgement
    //
    // ⚠️ 旧写法 `addWrongQuestions(studentId, [q.id], null, null)` 两个 Map 都传 null，
    //    而 neonService.addWrongQuestions 的两道闸都是「参数是 Map 实例才生效」→ 等于闸全开，
    //    低置信度题可绕过置信度闸直接入册（2026-09-11 修复）。
    //
    // 置信度闸：只对 answer_source<>'blank' 的题生效。
    //   未作答（blank）的 confidence 结构性为 0（建题时 `isEmpty ? 0 : …`），用阈值卡
    //   会永远入不了册，而「未作答等同不会」按口径该入 → blank 题**不放置信度值**；
    //   闸的实现是「map 里查不到 = 放行」，故 blank 天然豁免、AI 判错的题仍受阈值约束。
    // 完整性闸：传 questionMap 让 checkQuestionCompleteness 生效，并顺带回写 is_complete。
    const answerBankConfidenceMap = new Map(
      questionsWithIds
        .filter(q => q.answer_source !== 'blank')
        .map(q => [q.id, q.confidence])
    )
    const answerBankQuestionMap = new Map(questionsWithIds.map(q => [q.id, q]))

    for (let idx = 0; idx < questionsWithIds.length; idx++) {
      const q = questionsWithIds[idx]
      const matchInfo = matchInfoByQN.get(idx + 1) || {}
      if (q.is_correct === false || q.answer_source === 'blank') {
        await addWrongQuestions(studentId, [q.id], answerBankConfidenceMap, answerBankQuestionMap).catch(e =>
          console.error(`⚠️ [AnswerBank] 错题本同步失败 questionId=${q.id}:`, e.message)
        )
      }
      // 写 judgement 审计记录
      await createJudgement({
        questionId: q.id,
        studentId,
        source: 'ai_answer_gen',
        confidence: q.confidence || 0,
        isCorrect: q.is_correct,
        content: q.content,
        answer: q.answer,
        studentAnswer: q.student_answer,
        metadata: {
          resource_id: resourceId,
          answer_bank: true,
          // 关键诊断字段：错位排查时一眼能看出命中了哪个 unit
          matched_unit_key: matchInfo.matched_unit_key || null,
          matched_unit_title: matchInfo.matched_unit_title || null
        }
      }).catch(e => console.error(`⚠️ [AnswerBank] judgement 写入失败:`, e.message))
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    // 单元匹配诊断信息（写入 task metadata 供前端排查，与 processWorkbookGrading 一致）
    const pagesMatchInfo = []
    for (const pgd of pageDataList) {
      const rInfo = resolvedByPage.get(pgd.pageNumber) || {}
      pagesMatchInfo.push({
        has_title: !!pgd.pageTitle,
        page_title: pgd.pageTitle,
        matched_unit: unitByPageNumber.get(pgd.pageNumber) ?? null,
        matched_method: rInfo.method || null,
        group_tie_units: rInfo.groupTie || null,
        suspicious: !!(rInfo.groupTie || rInfo.method === 'group-fallback'),
        question_count: (pgd.questions || []).length,
        page_number: pgd.pageNumber || null
      })
    }
    const sectionMatchInfo = {
      pages: pagesMatchInfo,
      total_units: answersByUnit.size
    }
    const allNoMatch = pagesMatchInfo.every(p => p.matched_unit == null)
    if (allNoMatch) {
      sectionMatchInfo.match_fail_reason = '所有页面均无法匹配到所属练习单元'
    }
    const { pendingCount } = computeTaskStats(questionsWithIds)
    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questionsWithIds.length,
      wrongCount,
      emptyCount,
      pendingCount,
      matchedCount,
      duration: `${duration}s`,
      source: 'answer_bank',
      resourceType: resource.resource_type,
      sectionMatch: sectionMatchInfo
    })

    console.log(`✅ [AnswerBank] 完成: ${questionsWithIds.length} 题, ${wrongCount} 错, ${emptyCount} 空, ${pendingCount} 待人工, ${matchedCount} 匹配答案库, 耗时 ${duration}s`)
  } catch (e) {
    console.error(`💥 [AnswerBank] 异常:`, e.message)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, { error: e.message, last_error: e.message, failedAt: new Date().toISOString() }).catch(() => {})
  }
}

export const processTask = async (job) => {
  const { taskId, studentId, imageUrl: rawImageUrl, originalName } = job.data
  const startTime = Date.now()

  // ── 幂等闸门：已完成的任务不得被重复批改 ──
  // BullMQ 在 worker 进程被杀 / lock 过期时会把 active job 判为 stalled 并重新投递。
  // 这些"僵尸 job"对应的任务往往早已 done，重跑一遍不但白烧 AI 配额，还会
  // 长时间占满 concurrency 槽位 —— 用户新上传的任务排在后面迟迟不被处理，
  // 表现就是"传上去很久没反应"。实测：jobId=165 对应的 30483 已 done，
  // 仍被 stalled 机制重新投递并真的开始跑。
  // 这里直接放行返回，让槽位立刻交给真正待处理的任务。
  if (taskId) {
    try {
      const { rows } = await query(
        `SELECT status, (SELECT COUNT(*)::int FROM ${TABLES.QUESTIONS} WHERE task_id = $1) AS q_rows
         FROM ${TABLES.TASKS} WHERE id = $1`,
        [taskId]
      )
      const row = rows[0]
      if (row && ['done', 'reviewed'].includes(row.status) && row.q_rows > 0) {
        console.log(`⏭️ [Worker] 跳过重复投递: taskId=${taskId} 已是 ${row.status}（${row.q_rows} 道题），不重复批改`)
        return { taskId, skipped: true, reason: `already_${row.status}`, questionCount: row.q_rows }
      }
    } catch (e) {
      // 查询失败时不阻塞正常处理（宁可多跑一次，也不能因 DB 抖动卡住批改）
      console.error(`⚠️ [Worker] 幂等闸门查询失败 taskId=${taskId}:`, e.message)
    }
  }

  // ── 路由字段兜底：恢复链路重新入队的 job 可能缺 taskType/worksheetId/generatedExamId，
  // 从 tasks 行回读，防止 workbook/错题重练任务被静默降级为完整 AI 管线 ──
  if ((job.data.taskType === undefined || (job.data.taskType === 'workbook' && !job.data.worksheetId)) && taskId) {
    try {
      const { rows } = await query(
        `SELECT task_type, worksheet_id, generated_exam_id, resource_id, subject FROM ${TABLES.TASKS} WHERE id = $1`,
        [taskId]
      )
      if (rows[0]) {
        job.data.taskType = rows[0].task_type || 'general'
        if (!job.data.worksheetId) job.data.worksheetId = rows[0].worksheet_id || null
        if (!job.data.generatedExamId) job.data.generatedExamId = rows[0].generated_exam_id || null
        if (!job.data.subject) job.data.subject = rows[0].subject || null
        if (!job.data.resourceId) job.data.resourceId = rows[0].resource_id || rows[0].worksheet_id || null
      }
    } catch (e) {
      console.error(`⚠️ 路由字段回读失败 taskId=${taskId}:`, e.message)
    }
  }
  // 兜底后仍缺 worksheetId 的 workbook 任务：直接抛错，禁止降级到 general 管线
  // 原因：用户既然选了练习册上传，就明确希望走预埋答案库管线。
  // 静默降级会让学生试卷被错批/对不上答案库，违背用户意图，必须让用户看到明确的失败原因并重新上传。
  // 历史上 line 2421-2424 仅为 console.error，导致 fall through 到 general 管道、task_type=workbook
  // 仍被当成通用卷处理，错挂章节、错判答案。
  if (job.data.taskType === 'workbook' && !job.data.worksheetId) {
    const errMsg = `workbook 任务缺少 worksheetId，无法走预埋答案管线 taskId=${taskId}。请检查：(1) 前端是否正确传递 worksheetId (2) 数据库 tasks.worksheet_id 是否为 null (3) 练习册是否被删除`
    console.error(`❌ [路由] ${errMsg}`)
    throw new Error(errMsg)
  }
  const generatedExamId = job.data.generatedExamId
  const resourceId = job.data.resourceId

  // ── 练习册管线优先：workbook 任务必须走 worksheet_answers 预埋答案管线 ──
  // worksheet_id 与 resource_id 是不同表的键：worksheet_answers 存练习册答案（getWorksheetAnswersBySection），
  // resource_answers 存答案库资源答案。上方 line 5485 的路由兜底会把 worksheet_id 填进 resourceId，
  // 若先判 resourceId 会把本应走 processWorkbookGrading 的 workbook 任务错拐进 processAnswerBankGrading
  // （查 resource_answers，且本册 resources 行 answer_status='none' 会再降级 general），导致整页挂空。
  // 因此 workbook 分支必须在 resourceId 分支之前判定。
  if (job.data.taskType === 'workbook' && job.data.worksheetId) {
    return processWorkbookGrading(job)
  }

  // ── 统一答案库管线：优先使用 resource_answers（已审核的答案库）──
  // 跳过 AI 生成答案步骤，仅 OCR + 比对缓存答案，大幅节省成本
  if (resourceId) {
    return processAnswerBankGrading(job)
  }

  // ── 精简管线（错题重练）：按组卷 question_ids 匹配题库已存答案，自动判定 ──
  // 不跑完整 OCR+AI作答+AI判卷 worker，仅 OCR 学生手写答案 → 与存储答案 deterministic 比对
  // → 置信度门禁（0.8）→ 全部高置信度则自动批改并推进掌握度；否则回退人工改判。
  if (generatedExamId) {
    return processSlimGrading(job)
  }

  // Defensive: imageUrl from DB might be string URL, JSON object string, or object
  const resolveUrl = (raw) => {
    if (typeof raw === 'string') {
      // Could be plain URL or JSON string from old object serialization
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw)
          return parsed.url || parsed.ossPath || ''
        } catch (e) {
          return raw // fallback: assume it's a URL
        }
      }
      return raw // normal URL string
    }
    if (typeof raw === 'object' && raw !== null) return raw.url || raw.ossPath || ''
    return String(raw || '')
  }
  const imageUrl = resolveUrl(rawImageUrl)

  // ── 多图一任务：job.data.images 为页数组 [{page_number, image_url, file_name}] ──
  // 旧任务/恢复链路可能只有 imageUrl，回退为单页。
  let rawPages = Array.isArray(job.data.images) && job.data.images.length > 0
    ? job.data.images
    : (typeof job.data.images === 'string' ? (() => { try { return JSON.parse(job.data.images) } catch { return null } })() : null)
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    rawPages = [{ page_number: 1, image_url: imageUrl }]
  }
  const pages = rawPages
    .map((p, i) => ({ pageNumber: p.page_number || i + 1, imageUrl: resolveUrl(p.image_url), fileName: p.file_name || null }))
    .sort((a, b) => a.pageNumber - b.pageNumber)

  const invalidPage = pages.find(p => !p.imageUrl || typeof p.imageUrl !== 'string' || !p.imageUrl.startsWith('http'))
  if (invalidPage) {
    console.error(`\n💥 [Worker] taskId=${taskId} — 第 ${invalidPage.pageNumber} 页 imageUrl 无效: ${String(invalidPage.imageUrl).substring(0, 100)}`)
    console.error(`  原因: 上传流程未成功完成或 URL 格式错误`)
    await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
      error: '文件上传未成功完成，无法生成边界框',
      errorType: 'UPLOAD_NOT_COMPLETED',
      failedAt: new Date().toISOString(),
    })
    throw new Error('文件上传未成功完成')
  }

  console.log(`\n🔥 [Worker] ==========================================`)
  console.log(`🔥🔥 [Worker] 开始处理任务:`)
  console.log(`   taskId: ${taskId}`)
  console.log(`   studentId: ${studentId}`)
  console.log(`   页数: ${pages.length}`)
  pages.forEach(p => console.log(`   第 ${p.pageNumber} 页: ${p.imageUrl}`))
  console.log(`   originalName: ${originalName}`)
  console.log(`🔥🔥 ==========================================\n`)

  try {
    const startedAt = new Date().toISOString()
    console.log(`📊 [Step 1/6] 更新任务状态为 PROCESSING...`)
    await job.updateProgress(5)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, {
      progress: 5,
      startedAt
    })
    console.log(`✅ [Step 1/6] 状态更新完成`)

    // ── Step 2~5：并行 下载 → 拉直压缩 → AI 识别 ──
    // 各页独立无依赖，Promise.all 并发提升吞吐。
    // 进度在 5→70 区间直接跳到完成值（并行下无法精确递增）。
    const pageBuffers = new Map() // pageNumber → 压缩后 buffer（几何裁剪按页取图）
    const questions = []
    let totalOcrDuration = 0
    let ocrTruncatedPages = 0 // 靠截断抢救才出结果的页数，用于在任务结果里标记"可能缺题"

    const pageTasks = pages.map(async (page, pageIdx) => {
      const pageLabel = pages.length > 1 ? `第 ${page.pageNumber}/${pages.length} 页 ` : ''

      console.log(`📊 [Step 2/6] ${pageLabel}从 OSS 下载图片...`)
      let imageBuffer
      try {
        imageBuffer = await downloadImage(page.imageUrl)
      } catch (downloadError) {
        console.error('下载图片失败:', downloadError.message)
        throw new Error(`下载图片失败(${pageLabel.trim() || '第 1 页'}): ` + downloadError.message)
      }
      console.log(`✅ [Step 2/6] ${pageLabel}图片下载完成: ${imageBuffer.length} bytes`)

      console.log(`📊 [Step 3~4/8] ${pageLabel}拉直并压缩图片（合并 Sharp 管线）...`)
      let compressedBuffer
      try {
        // ⚡ 合并 deskew + compress 为单次 Sharp 管线，避免中间 buffer 分配和二次初始化
        compressedBuffer = await sharp(imageBuffer)
          .rotate()
          .normalize()
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        console.log(`✅ [Step 3~4/8] ${pageLabel}拉直+压缩完成: ${imageBuffer.length} → ${compressedBuffer.length} bytes (${Math.round(compressedBuffer.length/imageBuffer.length*100)}%)`)
      } catch (processError) {
        console.error('图片处理失败:', processError)
        throw processError
      }

      const imageBase64 = bufferToBase64(compressedBuffer)

      console.log(`📊 [Step 5/8] ${pageLabel}调用 AI 视觉识别...`)
      const ocrResult = HYBRID_VISION_ENABLED
        ? await recognizeQuestionsHybrid(imageBase64, taskId)
        : await recognizeQuestions(imageBase64, taskId)

      if (!ocrResult.success) {
        console.error(`❌ [Step 5/8] ${pageLabel}AI 识别失败: ${ocrResult.error}`)
        throw new Error(ocrResult.error || 'AI识别失败')
      }

      const pageQuestions = (ocrResult.questions || []).map(q => ({
        ...q,
        page_number: page.pageNumber,
      }))

      console.log(`✅ [Step 5/8] ${pageLabel}识别 ${pageQuestions.length} 道题`)
      return { pageNumber: page.pageNumber, compressedBuffer, ocrDuration: ocrResult.duration || 0, pageQuestions, truncated: Boolean(ocrResult.truncated), pageTitle: ocrResult.pageTitle || null }
    })

    const pageResults = await Promise.all(pageTasks)
    let ocrPageTitle = null
    for (const r of pageResults) {
      pageBuffers.set(r.pageNumber, r.compressedBuffer)
      questions.push(...r.pageQuestions)
      totalOcrDuration += r.ocrDuration
      if (r.truncated) ocrTruncatedPages += 1
      if (!ocrPageTitle && r.pageTitle) ocrPageTitle = r.pageTitle
    }
    if (ocrTruncatedPages > 0) {
      console.warn(`⚠️  ${ocrTruncatedPages} 页是截断抢救的结果，可能缺题（已记入任务结果 ocrTruncated）`)
    }

    // 用卷面印刷标题给任务改名：客户端只能给出"数学作业 08/27 21:58"或相机文件名，
    // 列表里一排同名任务用户分不清哪份。只覆盖这类自动名，用户选过练习册/答案库的名字不动。
    //
    // 2026-09-17：卷面顶部印的可能是校徽文字（"新闵学校“成长·桥”练习"）——它是页眉跑马灯，
    // 不是作业身份，直接拿来命名会让整屏任务同名。deriveTaskTitle 统一剥掉校名页眉，
    // 剥完没内容就【不改名】（保留"科目作业 时间"）。口径与 workbook 管线同一份实现。
    if (ocrPageTitle) {
      if (isAutoTaskName(originalName)) {
        const cleaned = deriveTaskTitle(ocrPageTitle)
        if (cleaned) {
          try {
            await query(`UPDATE ${TABLES.TASKS} SET original_name = $1 WHERE id = $2`, [cleaned, taskId])
            console.log(`   📝 任务改名: "${originalName}" → "${cleaned}"（来自卷面标题）`)
          } catch (e) {
            console.warn(`   ⚠️ 任务改名失败: ${e.message}`)
          }
        } else {
          console.log(`   ⏭️ 卷面标题"${ocrPageTitle}"是校名页眉/无信息量，不用于命名（保留"${originalName}"）`)
        }
      }
    }

    await job.updateProgress(70)
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 70 })

    // 兼容后续单图逻辑：compressedBuffer 指向第 1 页（pHash 缓存等非关键路径）
    const compressedBuffer = pageBuffers.get(pages[0].pageNumber)

    let wrongCount = questions.filter(q => q.is_correct === false).length
    // 引图题（题干含「如图」等）最终没拿到配图的数量：漏框 / 退化框 / 归属存疑被拦都计入。
    // 落进任务 result，供前端提示「重新识别」，也供运维按图索骥补图。
    let figureMissingRefs = 0
    let answerGenResult = { updated: 0, total: 0, empty: 0, placeholder: 0, exceptions: 0, cacheHits: 0, cacheMisses: 0 }

    console.log(`✅ [Step 5/8] AI 识别成功: ${pages.length} 页共 ${questions.length} 道题, ${wrongCount} 道错题, OCR 耗时 ${Math.round(totalOcrDuration/1000)}s`)

    if (questions.length > 0) {
      console.log(`📊 [Step 6/8] 保存题目到数据库...`)

      // ── 坐标存储策略：block_coordinates / text_bbox 保持 AI 返回的 0-1000 归一化坐标直接入库 ──
      // 前端按图片实际显示尺寸(naturalWidth/naturalHeight)换算像素，彻底与分辨率解耦，
      // 无论展示原图还是压缩图，overlay 都能精准对齐。
      // 几何图裁剪需要对应页压缩图的像素坐标，故仅在裁剪处把 image bbox 局部换算，
      // 不影响入库的归一化值。
      const pageDims = new Map() // pageNumber → {w, h}
      for (const [pageNo, buf] of pageBuffers) {
        try {
          const _meta = await sharp(buf).metadata()
          pageDims.set(pageNo, { w: _meta.width, h: _meta.height })
        } catch (e) {
          console.warn(`   ⚠️ [坐标] 读取第 ${pageNo} 页压缩图尺寸失败: ${e.message}`)
        }
      }

      // ── 多模态切题：处理几何配图（⚡ 并行化） ─
      // 编排逻辑已抽到 utils/geometryCrop.js，与练习册管线 processWorkbookGrading 共用同一份实现。
      // 抽出的动因：练习册管线本次补齐配图采集，两条管线做的是同一件事（把手写卷面上的
      // 几何图形按 image_bbox 裁出来），算法抄两份必然漂移。
      const cropResult = await cropGeometryFigures({
        questions,
        pageBuffers,
        pageDims,
        cropImage: cropAndUploadGeometryImage,
        studentId,
        fallbackBuffer: compressedBuffer,
        fallbackPage: pages[0]?.pageNumber || 1,
      })
      const geometryImageCount = cropResult.cropped
      figureMissingRefs = cropResult.missingRefs

      const questionsWithStudentId = questions.map(q => ({
        ...q,
        student_id: studentId
      }))

      // AI 解析自检：抽 answer/analysis/answer 三字段做一致性校验，
      // 把"步骤对结论错"算术幻觉 + answer 串行污染两路都标出来。
      // 2026-09-02 截图案例（y=3(x-1)²+2 代入 x=6，AI 写"最终答案 83"实际应为 77）
      // 就是这两路都中招。光靠 prompt 改措辞治不了，必须在落库前做硬校验。
      // 不重试 OCR：单题失败重跑整页 OCR 太重，靠 prompt 升级 + 红色横幅兜底。
      let selfCheckFailed = 0
      const selfCheckIssueCounts = {}
      for (const q of questionsWithStudentId) {
        const check = aiParseSelfCheck({
          answer: q.answer,
          student_answer: q.student_answer,
          analysis: q.analysis
        })
        q.ai_self_check_passed = check.pass
        q.ai_self_check_issues = check.issues
        if (!check.pass) {
          selfCheckFailed += 1
          for (const issue of check.issues) {
            selfCheckIssueCounts[issue] = (selfCheckIssueCounts[issue] || 0) + 1
          }
        }
      }
      if (selfCheckFailed > 0) {
        const issueSummary = Object.entries(selfCheckIssueCounts)
          .map(([k, v]) => `${k}=${v}`).join(', ')
        console.warn(`   [AI自检] ${selfCheckFailed}/${questionsWithStudentId.length} 道题自检失败 (${issueSummary})，前端会标红横幅`)
      } else {
        console.log(`   [AI自检] ${questionsWithStudentId.length} 道题全部通过`)
      }

      // 幂等：恢复链路 / 用户重试 / 队列重投可能对同一 task 重复执行本管线。
      // workbook 与答案库管线早已在写入前清旧题，通用 AI 管线此前漏了，
      // 导致同一任务跑两次就产生成倍的 questions 行（实测 3 道题 → 6 行），
      // 进而污染 wrong_questions 与知识点掌握度。
      const deletedOld = await deleteQuestionsByTaskId(taskId)
      if (deletedOld > 0) {
        console.log(`   幂等清理: 删除旧题目 ${deletedOld} 行 (taskId=${taskId})`)
      }

      // ── 配图展示增强（P0，2026-09-18）──
      // 原裁片 → 干净展示图（去网点/拉对比/锐化/裁白边）→ clean_geometry_image_url。
      // 只读 geometry_image_url，失败静默保留原裁片；ENHANCE_FIGURE=0 可整体关闭。
      // 与几何重画链的关系：重画成功时 geometryWorker 会覆盖 clean_geometry_image_url
      // （重画图更干净，优先级更高，符合预期）；本块只为"只有原裁片"的题兜底。
      const ENHANCE_FIGURE = process.env.ENHANCE_FIGURE !== '0'
      if (ENHANCE_FIGURE) {
        const cropsToEnhance = questionsWithStudentId.filter(q => q.geometry_image_url && !q.clean_geometry_image_url)
        if (cropsToEnhance.length > 0) {
          console.log(`   [配图增强] ⚡ 并行增强 ${cropsToEnhance.length} 张配图（写 clean_geometry_image_url）...`)
          await Promise.allSettled(cropsToEnhance.map(async (q) => {
            try {
              const url = await enhanceAndUploadFigure(q.geometry_image_url, studentId, q.id, { minShortEdge: 300 })
              if (url) q.clean_geometry_image_url = url
            } catch (e) {
              console.warn(`   ⚠️ [配图增强] ${q.id.slice(0, 8)} 失败（保留原裁片）: ${e.message}`)
            }
          }))
        }
      }

            // ── 写入侧定位框补测（2026-09-20 方案A，必须在落库前执行）──────────────────
      // 主 OCR 的 block_coordinates 是占位框；这里按页实测并覆盖成真值，createQuestions
      // 才把真值写入库 —— 复核页打开即显示，不消耗运行时额度。
      // 只走免费视觉通道；失败静默保留占位框（读取侧兜底），不阻断批改。
      try {
        const refined = await refineStoredBlocks({ questions: questionsWithStudentId, pageBuffers })
        if (refined > 0) console.log(`✅ [写入侧框] 共补测写回 ${refined} 题的 block_coordinates（免费通道）`)
      } catch (e) {
        console.warn(`   ⚠️ [写入侧框] 补测整体失败（保留占位框）：${e.message}`)
      }

      await createQuestions(questionsWithStudentId)
      console.log(`✅ [Step 6/8] 题目保存成功 (含 ${geometryImageCount} 张几何配图)`)

      // ── 页面理解：将裁剪后的几何图保存到 question_assets（⚡ 并行化） ──
      // 待重绘的 pending 几何资产（{assetId, questionId}）：Step 6 收集，
      // 等 Step 7 判题终定后只对「判错/空答」入队（2026-09-20 P0）。
      const pendingGeometryAssets = []
      const geometryQuestions = questions.filter(q => q.geometry_image_url)
      if (geometryQuestions.length > 0) {
        const assetResults = await Promise.allSettled(geometryQuestions.map(async (q) => {
          const imageType = q.image_type || 'geometry'
          const imageBbox = q.image_bbox || (q.geometry_image?.bbox || null)
          const sourcePage = pages.find(p => p.pageNumber === q.page_number)

          // 入队前先过配图引用闸门。闸门不过的三种情形：
          //   number_line      —— 数轴题，点线渲染器画出来是一条无意义线段
          //   function_graph   —— 函数图象/抛物线题，点线渲染器画不出曲线
          //   no_figure_reference —— 题干根本没提图，模型会照着题干文字编一张幻觉图
          // 实测（2026-09-18）74 张入队资产仅 1 张成功，其中 62 张属前两类。
          //
          // 函数图象题先走**确定性通道**：抛物线表达式本来就写在题干里，
          // 纯文本解析 + 服务端采样即可出图，零视觉调用。
          //   出图   → tikz_status='completed'，SVG 当场入库，不入队；
          //   出不了 → 'none'（开口/位置无法确定，或题干另有三角形/辅助线会画残缺），
          //            前端回退裁剪原图，不入队、不重试、不报错。
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
                  console.warn(`   ⚠️ [函数图象] 第 ${q.question_number} 题确定性渲染异常: ${e.message}`)
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
                  const pub = await publishCleanGeometryUrl({
                    questionId: q.id,
                    svg: built.svg,
                    studentId
                  })
                  if (!pub.ok) {
                    console.warn(`   [函数图象] 第 ${q.question_number} 题配图 URL 未发布（${pub.reason}），课件回退原题裁片`)
                  }
                } catch (e) {
                  console.warn(`   [函数图象] 第 ${q.question_number} 题配图 URL 发布异常: ${e.message}`)
                }
                console.log(
                  `   [函数图象] 第 ${q.question_number} 题走确定性通道出图（${built.spec.expression}${built.spec.approximate ? '，陡缓为示意' : ''}），零视觉调用`
                )
              } else {
                tikzStatus = 'none'
                assetError = FIGURE_GATE_MESSAGE[figureGate.reason] || figureGate.reason
                console.log(
                  `   [几何图] 第 ${q.question_number} 题不进重画队列（${figureGate.reason}），回退裁剪原图`
                )
              }
            }
          }

          const created = await createQuestionAsset({
            question_id: q.id,
            asset_type: imageType === 'chart' ? 'chart_image' : 'geometry_image',
            original_image_url: sourcePage?.imageUrl || imageUrl,
            cropped_image_url: q.geometry_image_url,
            bbox: imageBbox,
            tikz_status: tikzStatus,
            tikz_code: tikzCode,
            tikz_json: tikzJson,
            last_error: assetError
          })
          // 收集待重绘资产：只有真正需要 Vision 重画的（geometry + pending）才收集；
          // 函数图象确定性通道（completed）与回退原图（none）不占用重绘队列。
          // 是否真的入队由 Step 7 判题终定后决定（只重绘判错/空答，2026-09-20 P0）。
          if (tikzStatus === 'pending' && created?.id) {
            pendingGeometryAssets.push({ assetId: created.id, questionId: q.id })
          }
          return true
        }))
        const assetCount = assetResults.filter(r => r.status === 'fulfilled').length
        console.log(`   ✅ [question_assets] 已保存 ${assetCount} 条资源记录（其中 geometry 类型标记为 tikz_status=pending）`)
      }

      // ── 几何图重建 → 后台异步任务 ──
      // 上面 Step 6 只收集 pending 资产、不立即入队；Step 7 判题终定后
      // 仅对「判错/空答」的题入队重绘（见上方 [几何重绘 判题终定后入队]）。
      // 失败/遗漏的资产仍由 geometryWorker 批量扫描 + pendingTaskRecovery
      // （pending>30min 兜底 / failed 重试 / 24h watchdog）保底重绘。
      // 详见 geometryWorker.js 和 pendingTaskRecovery.js。

      // OCR 结果只作为过程证据；错题、掌握度和最终判题记录统一在答案生成后结算。
      // ⚠️ 判题审计记录（judgements）必须等 Step 7 生成参考答案 + 重判之后再写，
      //    否则此刻 q.answer 仍为空/等于学生答案，会把"待判定"错记成"判定正确"，
      //    前端 mergeJudgements 再用这条脏记录兜底覆盖题目状态 → 错题显示判定正确。
      //    统一移动到 Step 7 重判之后写入（见下方 [Shadow Mode]）。
await job.updateProgress(80)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 80 })

      console.log(`📊 [Step 7/8] 生成AI参考答案...`)
      answerGenResult = await generateMissingAnswers(questions, compressedBuffer, taskId)
      
      let rejudgedWrong = 0
      // 始终执行重判定，确保 OCR 阶段错误的 is_correct 可以被纠正
      // 批量查询所有人工复核判定，避免逐题 N+1 DB 查询
      const judgementableQuestions = questions.filter(q =>
        q.answer && q.answer.trim() && q.answer !== '待人工补充' && q.answer !== '此为主观题，无唯一标准答案'
      )
      let manualJudgementMap = new Map()
      if (judgementableQuestions.length > 0) {
        try {
          const questionIds = judgementableQuestions.map(q => q.id)
          const { rows: judgements } = await query(
            `SELECT DISTINCT ON (question_id) question_id, id, source, is_correct
             FROM ${TABLES.JUDGEMENTS}
             WHERE question_id = ANY($1) AND student_id = $2 AND source = 'manual_review'
             ORDER BY question_id, created_at DESC`,
            [questionIds, studentId]
          )
          for (const j of judgements) {
            manualJudgementMap.set(j.question_id, j)
          }
        } catch (e) {
          console.error('  批量查询人工判定失败:', e.message)
        }
      }
      for (const q of judgementableQuestions) {
          const manualJudgement = manualJudgementMap.get(q.id)
          if (manualJudgement && manualJudgement.is_correct !== null) {
              if (manualJudgement.is_correct !== q.is_correct) {
                q.is_correct = manualJudgement.is_correct
                try {
                  await query(
                    `UPDATE questions SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
                    [manualJudgement.is_correct, q.id]
                  )
                } catch (e) {
                  console.error(`      更新题目 ${q.id.substring(0, 8)} is_correct 失败:`, e.message)
                }
                if (manualJudgement.is_correct === false) rejudgedWrong++
                console.log(`  [P0-1d] 人工判定覆盖AI重判定: q=${q.id.substring(0, 8)}, is_correct=${manualJudgement.is_correct}`)
              }
              continue
            }

            const originalCorrect = q.is_correct
            const gradingResult = resolveGradingResult({
              studentAnswer: q.student_answer,
              answer: q.answer,
              questionType: q.question_type
            })
            if (gradingResult.isCorrect !== originalCorrect) {
              q.is_correct = gradingResult.isCorrect
              try {
                await query(
                  `UPDATE questions SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
                  [gradingResult.isCorrect, q.id]
                )
              } catch (e) {
                console.error(`      更新题目 ${q.id.substring(0, 8)} is_correct 失败:`, e.message)
              }
              if (gradingResult.isCorrect === false) rejudgedWrong++
            }
            q._unjudged_reason = gradingResult.unjudgedReason
        }

        // 判题终裁：规则判不出的客观题 → grok-4.5 仲裁（本链路题目已落库，persist 逐题回写）
        await aiJudgeUncertainQuestions(questions, { persist: true })

        // 判不出来的题：把原因落到 answer_exception_reason，供复核页告诉老师"为什么要我来定"。
        // 原因只是观测标注，判定结果仍只由 is_correct 表达（null = AI 未判定）。
        // 学生未作答（answer_source='blank'）不在此列：那由 answer_source 表达，
        // 再叠一条异常原因会让老师误以为系统故障。
        await markUnjudgedReasons(questions)

        // 图题风险标注：客观题 + 配图 → 软提示"AI 视觉推理不擅长，建议核对参考答案"
        await markImageReasoningRisk(questions)
        wrongCount = questions.filter(q => q.is_correct === false).length
        console.log(`✅ [Step 7/8] AI答案生成完成: 生成了 ${answerGenResult.updated}/${answerGenResult.total} 道题的答案, 解析异常 ${answerGenResult.exceptions} 道, 重新判定 ${rejudgedWrong} 道错题, 当前错题数: ${wrongCount}`)
        console.log(`📦 [Cache] 缓存命中: ${answerGenResult.cacheHits} 次, 缓存未命中: ${answerGenResult.cacheMisses} 次`)

        // ── 几何重绘「判题终定后入队」（2026-09-20 P0）──
        // 只重绘会进错题本的题（is_correct===false 或空答 blank），判对/未判定不花视觉调用。
        // 判题至此已终定（人工判定覆盖 → gradingResult 重判 → grok 终裁 → markUnjudgedReasons）。
        // 判定为对/未定的 pending 资产必须降级为 none：否则 PendingTaskRecovery 会在 30 分钟后
        // 把它们捞起重绘，等于「对题也花钱」——这是本改动要消除的浪费。
        // ⚠️ worker.js ↔ queue.js 存在循环依赖（queue.js 顶层 import { processTask } from './worker.js'），
        //    所以这里必须用动态 import，不能把 getGeometryQueue 提到文件顶部。
        if (pendingGeometryAssets.length > 0) {
          const wrongQids = new Set(
            questions
              .filter(q => q.is_correct === false || q.answer_source === 'blank')
              .map(q => q.id)
          )
          const toRedraw = pendingGeometryAssets.filter(p => wrongQids.has(p.questionId))
          const toSkip = pendingGeometryAssets.filter(p => !wrongQids.has(p.questionId))

          // 判对/未判定 → 资产降级 none（不重绘，防 30 分钟后被恢复扫描捞起）
          if (toSkip.length > 0) {
            try {
              await query(
                `UPDATE ${TABLES.QUESTION_ASSETS} SET tikz_status = 'none', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                [toSkip.map(p => p.assetId)]
              )
              console.log(`   ℹ️ [几何重绘] ${toSkip.length} 个判对/未判定资产降级 none（不重绘）`)
            } catch (e) {
              console.warn(`   ⚠️ [几何重绘] 资产降级 none 失败: ${e.message.slice(0, 80)}`)
            }
          }

          if (toRedraw.length > 0) {
            try {
              const { getGeometryQueue } = await import('./queue.js')
              const geometryQueue = await getGeometryQueue()
              if (!geometryQueue) {
                console.warn(`   ⚠️ [几何重绘] 队列不可用，${toRedraw.length} 个错题资产等恢复扫描兜底`)
              } else {
                let queued = 0
                for (const p of toRedraw) {
                  try {
                    await geometryQueue.add('reconstruct', { assetId: p.assetId }, { attempts: 1 })
                    queued++
                  } catch (e) {
                    console.warn(`   ⚠️ [几何重绘] 入队失败 ${p.assetId}: ${e.message.slice(0, 80)}`)
                  }
                }
                console.log(`   ⚡ [几何重绘] 错题即入队 ${queued}/${toRedraw.length} 个（判对/未定 ${toSkip.length} 个已跳过）`)
              }
            } catch (e) {
              console.warn(`   ⚠️ [几何重绘] 动态加载队列失败（${e.message.slice(0, 60)}），交恢复扫描兜底`)
            }
          }
        }

        // 降级处理：如果没有任何答案生成且没有缓存命中，标记需要人工复核
        if (answerGenResult.updated === 0 && answerGenResult.cacheHits === 0 && answerGenResult.total > 0) {
          console.warn(`  ⚠️ 未生成任何参考答案，标记所有题目需要人工复核`)
          for (const q of questions) {
            if (!q.answer || !q.answer.trim()) {
              try {
                await markAnswerException(q.id, 'OCR答案待人工确认，AI未生成参考答案')
              } catch (e) {
                // ignore
              }
            }
          }
        }

      // [Shadow Mode] 判题审计记录：在参考答案生成 + 重判之后写入，反映最终判定。
      // 关键顺序修复：此前该写入放在 Step 6（答案尚未生成），会把"待判定/错题"错记为
      // 判定正确，前端 mergeJudgements 再用其兜底覆盖题目状态，导致错题显示"AI 判定正确"。
      try {
        const judgementPromises = questions.map(q =>
          createJudgement({
            questionId: q.id,
            studentId: studentId,
            source: 'ai_ocr',
            confidence: q.confidence ?? null,
            isCorrect: q.is_correct ?? null,
            content: q.content ?? null,
            answer: q.answer ?? null,
            studentAnswer: q.student_answer ?? null,
            analysis: q.analysis ?? null,
            metadata: {
              question_type: q.question_type,
              originalIsCorrect: q.is_correct
            }
          }).catch(e => console.error(`[Shadow] judgements写入失败 (OCR) q=${q.id?.substring(0,8)}:`, e.message))
        )
        await Promise.allSettled(judgementPromises)
        console.log(`  [Shadow] AI 判定记录已追加(答案生成后): ${questions.length} 条`)
      } catch (e) {
        console.error('  [Shadow] AI 判定记录写入异常:', e.message)
      }

      await job.updateProgress(85)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 85 })

      console.log(`📊 [Step 8/8] 生成本地标签...`)
      const tagResults = await generateTagsForQuestions(questions)
      const tagMap = {}
      const difficultyMap = {}
      for (const tr of tagResults) {
        tagMap[tr.questionId] = tr.tags
        difficultyMap[tr.questionId] = tr.difficulty
      }

      for (const q of questions) {
        const tags = tagMap[q.id]
        // 本地规则分类必得标签（至少 ['未分类']）→ 标记来源为 local。
        // 难度统一为默认值（3），留待每日回填任务用 LLM 修正。
        q.ai_tags = tags && tags.length > 0 ? tags : ['未分类']
        q.tags_source = 'local'
        q.difficulty = difficultyMap[q.id] ?? 3
      }

      const tagUpdates = questions.map(q => ({
        id: q.id,
        ai_tags: q.ai_tags,
        difficulty: q.difficulty
      }))
      await batchUpdateQuestionTags(tagUpdates)
      console.log(`✅ [Step 8/8] 本地标签保存成功`)

      await job.updateProgress(87).catch(() => {})
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 87 }).catch(() => {})

      await job.updateProgress(90)
      await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 90 })

      // ── 自动沉淀答案库（v4 策略）──
// 仅在以下条件建草稿：
//   1. task_type === 'exam'（晚托班试卷场景；workbook / homework / wrong_retry 不进）
//   2. task.resource_id 为空（避免重复建）
//   3. AI 至少识别到 1 道有 answer 的题
//
// 状态：
//   resources.status='draft'（不可见，不被其他学生复用）
//   resource_answers.answer_status='ai_draft'（暂存，等老师复核）
//
// 后续：
//   - 老师 PC 复核改题 → syncDraftAnswerBank（server/index.js:1351）按 v2 矩阵升级
//   - 老师点"完成复核" → server completeTaskReview 自动推 resources.status='published'
//   - 已发布才被 PC 答案库列表、移动端 ExamResourcePicker、其他学生 AnswerBank 管线复用
try {
  const { rows: taskMetaRows } = await query(
    `SELECT task_type, resource_id, subject FROM ${TABLES.TASKS} WHERE id = $1`,
    [taskId]
  )
  const taskMeta = taskMetaRows[0] || {}
  if (taskMeta.task_type !== 'exam') {
    console.log(`ℹ️  [Auto-sediment] 跳过：task_type=${taskMeta.task_type}（仅 exam 触发）`)
  } else if (taskMeta.resource_id) {
    console.log(`ℹ️  [Auto-sediment] 跳过：已关联 resource_id=${taskMeta.resource_id.slice(0, 8)}`)
  } else {
    const sedimentable = questions.filter(q =>
      q.answer && String(q.answer).trim()
        && q.answer !== '待人工补充'
        && q.answer !== '此为主观题，无唯一标准答案'
    )
    if (sedimentable.length === 0) {
      console.log(`ℹ️  [Auto-sediment] 无可用答案，跳过沉淀`)
    } else {
      const subject = job.data.subject || taskMeta.subject || null
      // 命名回落链：OCR 抽到的卷面大标题 → 首页首道题题干前 20 字（去题号）→ 任务原名 → 试卷_日期
      // 第二档接受"1. 下列说法正确的是"这种题目开头，老师可在 PC 答案库列表点重命名修正
      const firstLineFromContent = (() => {
        const firstQ = questions.find(q => q && q.content && String(q.content).trim())
        if (!firstQ) return null
        const cleaned = String(firstQ.content).trim()
          .replace(/^[\s\d.、．)\]）]+/, '')
          .slice(0, 20)
        return cleaned || null
      })()
      const resourceName = ocrPageTitle
        || firstLineFromContent
        || originalName
        || `试卷_${new Date().toISOString().slice(0, 10)}`

      const { rows: [newResource] } = await query(
        `INSERT INTO resources (resource_type, name, subject, answer_status, status, answer_count)
         VALUES ('exam', $1, $2, 'ai_draft', 'draft', $3) RETURNING *`,
        [resourceName, subject, sedimentable.length]
      )

      // 全部打 ai_draft；answer 取 q.answer。
      // 后续 syncDraftAnswerBank 会在老师复核时按 v2 矩阵升级（review_status='reviewed' + is_correct=true → student_answer，错误且未改 answer → 跳过，等等）。
      let savedCount = 0
      for (const q of sedimentable) {
        try {
          await query(
            `INSERT INTO resource_answers (resource_id, question_no, answer, answer_type, content, answer_status, source)
             VALUES ($1, $2, $3, $4, $5, 'ai_draft', 'auto_sediment')`,
            [newResource.id, q.question_number || 0, q.answer, q.question_type || 'choice', q.content || null]
          )
          savedCount++
        } catch (e) {
          console.error(`   ⚠️ [Auto-sediment] 保存第 ${q.question_number} 题答案失败:`, e.message)
        }
      }

      await query(
        `UPDATE tasks SET resource_id = $1 WHERE id = $2`,
        [newResource.id, taskId]
      )
      console.log(`✅ [Auto-sediment] 草稿资源已建: "${resourceName}" (${savedCount}/${sedimentable.length} 题, status=draft, resourceId=${newResource.id.slice(0, 8)})`)
    }
  }
} catch (e) {
  console.error(`  ⚠️ [Auto-sediment] 沉淀异常:`, e.message)
}
await job.updateProgress(95).catch(() => {})
await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 95 }).catch(() => {})
    } else {
      console.log(`⚠️  AI 未识别到任何题目`)
    }

    // ── 知识点归一化 + 掌握度更新（数据闭环最后一段，非阻塞）──
    // 在批改 pipeline 末尾追加：标签已生成（Step 8）且判定完成，
    // 把扁平标签归一化到知识树节点（question_knowledge），
    // 并按 正/错 更新各知识点掌握度（knowledge_mastery）。
    // 不 await：批改主流程尽快落库 done，同步在后台推进；
    // 内部全部 try-catch，失败不影响任务完成状态。
    try {
      finalizeGradingBatch({
        taskId,
        studentId,
        questions,
        source: 'ai_answer_gen',
        settlementMode: 'initial_grading'
      })
        .then(stats => {
          console.log(`📌 [Knowledge] 最终结算完成: ${stats.settled} 题, 错题 ${stats.wrongQuestions} 题, 掌握度更新 ${stats.mastery} 题, 跳过 ${stats.skipped} 题`)
        })
        .catch(e => console.error(`  ⚠️ [Knowledge] 知识点/掌握度同步异常:`, e.message))
    } catch (e) {
      console.error(`  ⚠️ [Knowledge] 知识点/掌握度同步异常:`, e.message)
    }

    await job.updateProgress(98).catch(() => {})
    await updateTaskStatus(taskId, TASK_STATUS.PROCESSING, { progress: 98 }).catch(() => {})

    await job.updateProgress(100)
    const duration = Date.now() - startTime

    // 空白题数（学生未作答）与待人工题数（AI 给不出结论 / 置信度不足）。
    // 两者都从落库后的题目行统一分桶，避免"非空但判不出"的题两边都不进、
    // 被列表页的"无错无空 ⇒ 全部正确"文案吞掉。
    let emptyCount = 0
    let pendingCount = 0
    try {
      const { rows: gradedRows } = await query(
        `SELECT is_correct, answer_source, review_status, confidence FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
        [taskId]
      )
      const stats = computeTaskStats(gradedRows)
      emptyCount = stats.emptyCount
      pendingCount = stats.pendingCount
    } catch (e) {
      console.error('   统计空白/待人工题数失败:', e.message)
    }

    await updateTaskStatus(taskId, TASK_STATUS.DONE, {
      questionCount: questions.length,
      wrongCount: wrongCount,
      emptyCount: emptyCount,
      pendingCount: pendingCount,
      duration: duration,
      completedAt: new Date().toISOString(),
      answerExceptions: answerGenResult.exceptions || 0,
      cacheHits: answerGenResult.cacheHits || 0,
      cacheMisses: answerGenResult.cacheMisses || 0,
      // 有页面靠截断抢救才出结果 → 本次批改可能缺题，前端据此提示用户核对
      ocrTruncated: ocrTruncatedPages > 0 ? ocrTruncatedPages : undefined,
      // 引图题最终没拿到配图的数量 → 前端同样给「重新识别」入口（魔搭配额恢复后重跑即可补上）
      figureMissingRefs: figureMissingRefs > 0 ? figureMissingRefs : undefined
    })

    console.log(`\n🎉🎉 [Worker] ==========================================`)
    console.log(`🎉🎉 [Worker] 任务完成:`)
    console.log(`   taskId: ${taskId}`)
    console.log(`   题目数: ${questions.length}`)
    console.log(`   错题数: ${wrongCount}`)
    console.log(`   待人工: ${pendingCount}`)
    console.log(`   缓存命中: ${answerGenResult.cacheHits || 0} 次`)
    console.log(`   总耗时: ${Math.round(duration / 1000)}s`)
    console.log(`🎉🎉🎉 ==========================================\n`)

    return {
      taskId,
      questionCount: questions.length,
      wrongCount,
      emptyCount,
      duration,
      cacheHits: answerGenResult?.cacheHits || 0,
      cacheMisses: answerGenResult?.cacheMisses || 0
    }
  } catch (error) {
    const duration = startTime ? Date.now() - startTime : 0
    console.error(`\n💥💥💥 [Worker] ==========================================`)
    console.error(`💥💥💥 [Worker] 任务处理失败:`)
    console.error(`   taskId: ${taskId}`)
    console.error(`   错误: ${error.message}`)
    console.error(`💥💥 ==========================================\n`)

    try {
      // 解析已有 retry_count（存于 result JSON），失败自增一次。
      let prevRetry = 0
      try {
        const { rows } = await query(
          `SELECT result, retry_count FROM ${TABLES.TASKS} WHERE id = $1`,
          [taskId]
        )
        if (rows.length > 0) {
          if (typeof rows[0].retry_count === 'number') prevRetry = rows[0].retry_count
          else if (rows[0].result) {
            const r = typeof rows[0].result === 'string' ? JSON.parse(rows[0].result) : rows[0].result
            prevRetry = Number(r?.retryCount || 0)
          }
        }
      } catch { /* 读取失败则 retry 从 0 计 */ }

      await updateTaskStatus(taskId, TASK_STATUS.FAILED, {
        error: error.message || '处理失败',
        last_error: error.message || '处理失败',
        retry_count: prevRetry + 1,
        duration: duration,
        failedAt: new Date().toISOString()
      })
    } catch (updateError) {
      console.error('更新任务失败状态时出错:', updateError)
    }

    // ── 关键：只有"永久不可恢复"错误才不抛给 BullMQ ──
    // 配额耗尽 / 限流 / URL 失效 / 缺少 worksheetId 等属于"自愈失败"，
    // 抛给 BullMQ 会触发 attempts=3 的内部重试（每次都重复下载图片、调 AI、浪费 30s+）。
    // 返回 undefined → BullMQ 视为 completed → 不再重试。
    //
    // ⚠️ 瞬时错误（OSS 400/5xx、网络超时）必须抛出去让 BullMQ 重试：
    //    它们发生在 Step 2/6（尚未调 AI），重试只是重新下载一次图片，成本极低且大概率自愈。
    //    此前用 /下载图片失败/ 整体匹配，把这类可自愈错误一并永久拉黑，
    //    导致任务卡死在 failed 且前端重试入口也失效（见 pendingTaskRecovery.js 注释）。
    //
    // ⚠️ 2026-09-20：配额/限流类（kind='quota'）同样不抛给 BullMQ —— 当天配额不会
    //    恢复，BullMQ 重试只会烧配额；它的重试时机是**跨自然日后**由
    //    PendingTaskRecovery.scanFailedTasks 自动放行（见该文件 QUOTA_ERROR_PATTERNS）。
    const verdict = classifyLastError(error.message)
    if (verdict.kind === 'permanent' || verdict.kind === 'quota') {
      console.warn(`🚫 [Worker] 任务命中不可立即重试黑名单（${verdict.kind}），跳过 BullMQ 重试: taskId=${taskId} — ${verdict.reason}`)
      return undefined
    }
    if (verdict.kind === 'transient') {
      console.warn(`🔁 [Worker] 瞬时错误，交由 BullMQ 重试: taskId=${taskId} — ${verdict.reason}`)
    }

    throw error
  }
}
