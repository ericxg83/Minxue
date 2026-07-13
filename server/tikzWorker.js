import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })

import axios from 'axios'
import { query, TABLES } from './config/neon.js'
import { buildTikzGenerationPrompt, callVisionCompletion } from './config/ai.js'
import { updateQuestionAssetTikz } from './services/neonService.js'
import { renderGeometryTikZ, isEmptyStructure } from './utils/geometryTikZ.js'
import { validateGeometryLabels } from './utils/geometryLabelValidator.js'

// ── 辅助：从 URL 下载图片 buffer ──
async function downloadImageBuffer(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    return Buffer.from(resp.data)
  } catch (error) {
    console.error(`   ⚠️ [TikZ Worker] 图片下载失败: ${error.message}`)
    return null
  }
}

// ── 从 AI 回复中提取 TikZ 代码 ──
function extractTikzCode(content) {
  if (!content) return null

  // 尝试匹配 ```tikz ... ``` 或 ```latex ... ``` 代码块
  const codeBlockMatch = content.match(/```(?:tex|latex|tikz)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch) {
    const code = codeBlockMatch[1].trim()
    if (code.includes('\\begin{tikzpicture}')) return code
  }

  // 尝试直接匹配 \begin{tikzpicture} ... \end{tikzpicture}
  const tikzMatch = content.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/)
  if (tikzMatch) return tikzMatch[0].trim()

  // 如果整段内容看起来就是 TikZ 代码（含 \begin{tikzpicture}）
  if (content.includes('\\begin{tikzpicture}') && content.includes('\\end{tikzpicture}')) {
    return content.trim()
  }

  return null
}

/**
 * TikZ 生成 Worker — 由 BullMQ 'tikz-generation' 队列调用。
 *
 * 流程：
 * 1. 下载净化后的几何图
 * 2. 调 VL 视觉模型生成 TikZ 代码
 * 3. 提取 TikZ 代码
 * 4. 存入 question_assets.tikz_code + tikz_status
 * 5. 更新 questions.tikz_svg_url + display_image_type
 *
 * @param {import('bullmq').Job} job - { data: { questionId, cleanGeometryUrl } }
 */
export async function processTikzGeneration(job) {
  const { questionId, cleanGeometryUrl } = job.data
  const shortId = (questionId || '').substring(0, 8)
  console.log(`[TikZ] ${shortId}: 开始生成 TikZ 代码...`)

  if (!questionId || !cleanGeometryUrl) {
    console.error(`[TikZ] ${shortId}: 缺少必要参数 questionId/cleanGeometryUrl`)
    return
  }

  // ── 优先路径：基于 geometry_structure_json 确定性生成 TikZ ──
  // 不再让 AI 自由猜测布局，完全由结构数据驱动渲染。
  let tikzCode = await generateTikZFromStructure(questionId, shortId)

  // ── 回退路径：无结构数据则调 VL 模型生成（旧图兼容） ──
  if (!tikzCode) {
    console.log(`[TikZ] ${shortId}: 无结构数据，回退到 VL 模型生成...`)

    // 1. 下载净化图
    const imageBuffer = await downloadImageBuffer(cleanGeometryUrl)
    if (!imageBuffer) {
      console.error(`[TikZ] ${shortId}: 下载净化图失败，标记 failed`)
      await markFailed(questionId)
      return
    }

    // 2. 调 VL 模型生成 TikZ
    try {
      const base64 = imageBuffer.toString('base64')
      const dataURL = `data:image/png;base64,${base64}`

      const result = await callVisionCompletion({
        imageDataURL: dataURL,
        systemPrompt: buildTikzGenerationPrompt(),
        userText: '请根据这个几何图形生成TikZ代码。',
        temperature: 0.2,
        maxTokens: 4096
      })

      // 3. 提取 TikZ 代码
      tikzCode = extractTikzCode(result.content)
      if (!tikzCode) {
        console.warn(`[TikZ] ${shortId}: VL 返回内容中未找到有效 TikZ 代码`)
        // 尝试将整段内容作为 TikZ 代码保存
        if (result.content.includes('\\draw') || result.content.includes('\\path')) {
          tikzCode = result.content.trim()
        }
      }
    } catch (error) {
      console.error(`[TikZ] ${shortId}: VL 模型调用失败:`, error.message)
      await markFailed(questionId)
      return
    }
  }

  if (!tikzCode) {
    console.warn(`[TikZ] ${shortId}: 无法提取 TikZ 代码`)
    await markFailed(questionId)
    return
  }

  // 4. 存入 question_assets
  try {
    const { rows } = await query(
      `SELECT id FROM ${TABLES.QUESTION_ASSETS}
       WHERE question_id = $1 AND asset_type = 'geometry_image'
       ORDER BY created_at DESC LIMIT 1`,
      [questionId]
    )
    if (rows.length > 0) {
      await updateQuestionAssetTikz(rows[0].id, {
        tikz_code: tikzCode,
        tikz_status: 'completed'
      })
    } else {
      console.warn(`[TikZ] ${shortId}: 未找到 question_assets 记录`)
    }
  } catch (error) {
    console.error(`[TikZ] ${shortId}: 写入 question_assets 失败:`, error.message)
  }

  // 5. 更新 questions 表（反范式副本）
  try {
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET tikz_svg_url = $1,
           display_image_type = COALESCE(display_image_type, 'clean'),
           updated_at = NOW()
       WHERE id = $2`,
      [tikzCode, questionId]
    )
    console.log(`✅ [TikZ] ${shortId}: 生成成功 (${tikzCode.length} 字符)`)
  } catch (error) {
    console.error(`[TikZ] ${shortId}: 更新 questions 表失败:`, error.message)
  }
}

/**
 * 基于 geometry_structure_json 确定性生成 TikZ 代码。
 * 不再让 AI 自由猜测布局，完全由结构数据驱动渲染。
 * @returns {Promise<string|null>}
 */
async function generateTikZFromStructure(questionId, shortId) {
  try {
    const { rows } = await query(
      `SELECT geometry_structure_json
       FROM ${TABLES.QUESTION_ASSETS}
       WHERE question_id = $1 AND asset_type = 'geometry_image'
       ORDER BY created_at DESC LIMIT 1`,
      [questionId]
    )
    const struct = rows[0]?.geometry_structure_json
    if (!struct || isEmptyStructure(struct)) {
      console.log(`[TikZ] ${shortId}: 无有效 geometry_structure_json，回退`)
      return null
    }
    // 与 SVG 路径保持一致：渲染前先跑服务端标注校验，过滤幻觉/题干数字，
    // 避免 TikZ 出现原图中不存在的边长/坐标数字。
    const validated = validateGeometryLabels(struct)
    const tikzCode = renderGeometryTikZ(validated)
    if (!tikzCode) {
      console.warn(`[TikZ] ${shortId}: 结构渲染 TikZ 失败`)
      return null
    }
    console.log(`✅ [TikZ] ${shortId}: 基于结构 JSON 确定性生成 TikZ (${tikzCode.length} 字符)`)
    return tikzCode
  } catch (error) {
    console.error(`[TikZ] ${shortId}: 读取结构 JSON 失败:`, error.message)
    return null
  }
}
async function markFailed(questionId) {
  const shortId = (questionId || '').substring(0, 8)
  try {
    const { rows } = await query(
      `SELECT id FROM ${TABLES.QUESTION_ASSETS}
       WHERE question_id = $1 AND asset_type = 'geometry_image'
       ORDER BY created_at DESC LIMIT 1`,
      [questionId]
    )
    if (rows.length > 0) {
      await updateQuestionAssetTikz(rows[0].id, { tikz_code: null, tikz_status: 'failed' })
    }
  } catch (error) {
    console.error(`[TikZ] ${shortId}: 标记失败状态出错:`, error.message)
  }
}