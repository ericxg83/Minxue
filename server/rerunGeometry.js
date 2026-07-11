/**
 * 重跑几何重建流水线（结构识别升级版）。
 *
 * 作用：把"旧 AI 猜测生成的错误 TikZ/SVG"替换为
 * 新升级的几何结构识别（含坐标系/点类型/线段关系/约束）
 * 确定性渲染的干净 SVG + geometry_structure_json。
 *
 * 范围：所有已有 geometry_image_url 的几何题（排除 chart 类型）。
 *
 * 用法：
 *   node server/rerunGeometry.js            # 处理全部
 *   node server/rerunGeometry.js --limit=20 # 只处理前 20 题（试运行）
 *   node server/rerunGeometry.js --id=xxx  # 只处理指定题
 *
 * 注意：仅覆盖 clean_geometry_svg 和 geometry_structure_json，不触碰原始裁剪图/原始 TikZ。
 */

import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import { query, TABLES } from './config/neon.js'
import { callVisionCompletion, buildGeometryReconstructionPrompt } from './config/ai.js'
import { parseGeometryStructure, isEmptyStructure, renderGeometrySvg } from './utils/geometrySvg.js'
import { validateGeometryLabels } from './utils/geometryLabelValidator.js'
import { updateQuestionAssetCleanData } from './services/neonService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

// ── 解析命令行参数 ──
const args = process.argv.slice(2)
const getArg = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : null
}
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null
const ONLY_ID = getArg('id')
const DRY = args.includes('--dry')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── 内联复用 worker 的核心逻辑（避免引入 worker 的副作用依赖） ──

/** 从 URL 下载图片为 Buffer */
async function downloadImageBuffer(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    return Buffer.from(resp.data)
  } catch (error) {
    console.error(`   ⚠️ [下载] 图片下载失败: ${error.message}`)
    return null
  }
}

/**
 * 几何重建：原始裁剪图 → 视觉模型识别结构 → 服务端确定性渲染 SVG。
 * 复用与 worker 完全相同的 prompt 和渲染逻辑。
 */
async function reconstructGeometrySvg(imageBuffer, questionId) {
  const shortId = String(questionId).substring(0, 8)
  try {
    const base64 = imageBuffer.toString('base64')
    const dataURL = `data:image/png;base64,${base64}`

    const result = await callVisionCompletion({
      imageDataURL: dataURL,
      systemPrompt: buildGeometryReconstructionPrompt(),
      userText: '请识别这张几何图中的纯几何结构（点/线/圆/坐标系/约束），只输出结构化 JSON。',
      temperature: 0.1,
      maxTokens: 2048
    })

    const structure = parseGeometryStructure(result.content)
    if (!structure) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 未能解析出几何结构 JSON`)
      return null
    }
    if (isEmptyStructure(structure)) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 未识别到有效几何结构（空）`)
      return null
    }

    // 服务端二次整理：把模型 labels 按空间规则拆成 geometry_labels / ignored_labels
    const validated = validateGeometryLabels(structure)
    console.log(`   [几何重建] ${shortId}: 标注二次整理 ${validated.geometry_labels.length} 几何 / ${validated.ignored_labels.length} 忽略`)

    const svg = renderGeometrySvg(validated)
    if (!svg) {
      console.warn(`   ⚠️ [几何重建] ${shortId}: 结构渲染 SVG 失败`)
      return null
    }
    return { svg, structure: validated }
  } catch (error) {
    console.error(`   ⚠️ [几何重建] ${shortId} 失败:`, error.message)
    return null
  }
}

async function main() {
  let sql = `
    SELECT q.id, q.geometry_image_url
    FROM ${TABLES.QUESTIONS} q
    LEFT JOIN ${TABLES.QUESTION_ASSETS} a
      ON a.question_id = q.id AND a.asset_type = 'geometry_image'
    WHERE q.geometry_image_url IS NOT NULL
      AND q.image_type IS DISTINCT FROM 'chart'
      AND a.id IS NOT NULL
  `
  const params = []
  if (ONLY_ID) {
    // 支持短 ID（前 8 位）前缀匹配
    sql = `
      SELECT q.id, q.geometry_image_url
      FROM ${TABLES.QUESTIONS} q
      WHERE q.id::text LIKE $1
        AND q.geometry_image_url IS NOT NULL
        AND q.image_type IS DISTINCT FROM 'chart'
    `
    params.push(`${ONLY_ID}%`)
  } else {
    sql += ` ORDER BY q.created_at DESC`
    if (LIMIT) {
      sql += ` LIMIT ${LIMIT}`
    }
  }

  const { rows } = await query(sql, params)
  console.log(`\n🔄 [重跑几何重建] 待处理题目数: ${rows.length}` + (DRY ? '（DRY RUN — 不入库）' : ''))

  let ok = 0, fail = 0, skip = 0

  for (const q of rows) {
    const shortId = String(q.id).substring(0, 8)
    try {
      // 1. 下载原始裁剪几何图
      const rawBuffer = await downloadImageBuffer(q.geometry_image_url)
      if (!rawBuffer) {
        console.warn(`   ⚠️ ${shortId}: 下载失败，跳过`)
        skip++
        continue
      }

      // 2. 重新识别几何结构（新 prompt + 确定性渲染）
      const result = await reconstructGeometrySvg(rawBuffer, q.id)
      if (!result) {
        console.warn(`   ⚠️ ${shortId}: 重建失败（无有效结构），跳过`)
        skip++
        continue
      }

      const { svg, structure } = result
      const nP = structure.points.length
      const nS = structure.segments.length
      const nC = structure.circles.length
      const hasAxis = structure.coordinate_system?.exists
      console.log(`   ✅ ${shortId}: 识别 ${nP} 点 / ${nS} 线 / ${nC} 圆 / 坐标系=${hasAxis} / 约束 ${structure.constraints?.length || 0}`)

      // 3. 入库（覆盖 clean_geometry_svg + geometry_structure_json）
      if (!DRY) {
        await updateQuestionAssetCleanData(q.id, {
          clean_geometry_svg: svg,
          geometry_crop_type: 'clean_geometry',
          geometry_structure_json: structure
        })
        // 同步反范式写入 questions 表
        await query(
          `UPDATE ${TABLES.QUESTIONS}
           SET clean_geometry_svg = $1,
               display_image_type = COALESCE(display_image_type, 'clean'),
               updated_at = NOW()
           WHERE id = $2`,
          [svg, q.id]
        )
      }
      ok++
    } catch (error) {
      console.error(`   ❌ ${shortId}: 异常 ${error.message}`)
      fail++
    }
    // 轻量限速，避免触发 VL 模型配额
    await sleep(200)
  }

  console.log(`\n🎉 [重跑几何重建] 完成: 成功 ${ok} / 跳过 ${skip} / 失败 ${fail}`)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1) })
