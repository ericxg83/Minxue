import { query } from '../config/neon.js'

// ============================================================
// 065: questions.option_images
//
// 背景（2026-11-06，负责人拍板「方案 B」）：
//   图形选项题（A/B/C/D 四个选项本身是四幅图，如四张坐标系小图）此前只能把
//   四幅图压成一条 8.8:1 的扁长横带塞进 geometry_image_url，复核页显示为
//   「很扁的一条」，与原卷四幅各自独立、带标号的排版差别很大，老师难以逐幅
//   放大对照判题。
//
// 字段语义：
//   option_images jsonb 数组，按 A/B/C/D 顺序存四幅【各自独立】的裁图 URL，
//   例：["https://.../a.png", "https://.../b.png", "https://.../c.png", "https://.../d.png"]
//   - 只有 image_type = 'option_figures' 的题才会用到；其余题保持默认 []。
//   - 空数组 / NULL = 没有逐幅图，前端退回原「整条横带」geometry_image_url 展示。
//   - 仍是原卷裁片（不重绘），与 geometry_image_url 同源。
//
// 为什么是独立列而不是复用 questions.images：
//   questions.images 是历史空闲列，语义泛（tasks.images 是整卷页图数组），
//   复用会让「题目级多图」和「任务级页图」口径混淆。专用列一眼可辨。
//
// 幂等：ADD COLUMN IF NOT EXISTS + information_schema 校验。
//       不回填（存量题保持 []，由人工/脚本按需补图，不影响既有判题与完整性）。
// ============================================================
export const migrateQuestionOptionImages = async () => {
  try {
    console.log('📦 [迁移065] questions.option_images 逐幅选项图...')

    await query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS option_images jsonb NOT NULL DEFAULT '[]'::jsonb
    `)

    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'option_images'
    `)
    if (rows.length !== 1) {
      throw new Error('option_images 列创建后校验失败')
    }
    console.log('✅ [迁移065] questions.option_images 就绪', rows[0])
  } catch (e) {
    console.error('❌ [迁移065] 失败:', e.message)
    throw e
  }
}
