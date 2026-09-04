import { query } from '../config/neon.js'

// ============================================================
// 056: questions.geometry_manual_override 老师手动配图标记
//
// 背景：
//   geometryDisplay.js 有一条"无可重绘"闸门——当 question_assets.tikz_status
//   ='none' 且 last_error 匹配"图中无可重绘的几何结构（数轴/实物/统计图）"
//   时，前端 getGeometryDisplayUrl 直接返回 null，连 geometry_image_url 都
//   不看。原本是为屏蔽视觉模型对"数轴/实物"的 bbox 误裁（裁到别处题目）。
//
//   但老师点「原卷裁剪」或「上传配图」后，人工裁剪图与 AI 自动 bbox 裁剪
//   同样被闸门屏蔽，导致「已上传」的 toast 弹出来，配图区仍然「暂无配图」，
//   刷新更是一片空白——这是用户报告的核心问题。
//
// 方案：
//   加布尔列 geometry_manual_override。老师手动裁剪/上传时前端把它置 true
//   并 PUT 落库；getGeometryDisplayUrl 顶部分支：一旦 geometry_manual_override
//   === true 且有 geometry_image_url，直接返回该 URL，闸门不生效。
//
//   保留 question_assets.last_error 不动：诊断信息、"重新生成"按钮语义、
//   后台 retry 队列都以它为准；只是前端展示层"信任老师"。
//
//   deleteImage（老师清空配图）→ 前端把 flag 也带回 false，闸门恢复。
//
// 幂等：ADD COLUMN IF NOT EXISTS，重复跑安全；默认 false，不影响任何历史数据。
// ============================================================
export const migrateGeometryManualOverride = async () => {
  try {
    console.log('📦 [迁移056] questions.geometry_manual_override 手动配图标记...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS geometry_manual_override BOOLEAN DEFAULT FALSE
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'geometry_manual_override'
    `)
    if (rows.length !== 1) {
      throw new Error(`迁移 056 失败：期望 1 列，实际 ${rows.length} 列`)
    }
    console.log(`✅ [迁移056] 手动配图标记列就绪: ${JSON.stringify(rows)}`)
  } catch (e) {
    console.error('❌ [迁移056] 失败:', e.message)
    throw e
  }
}
