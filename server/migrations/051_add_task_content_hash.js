import { query } from '../config/neon.js'

// ============================================================
// 051: tasks.content_hash 上传内容哈希 + 学生内唯一索引
//
// 背景：
//   2026-09-01 上线当天，老师快速连点/重传同一张图片，
//   POST /api/tasks/upload 落成 2 份 task，AI 各跑一次，
//   重复批改。原代码（server/index.js:199-329）只按文件名落库，
//   且 file.name 匹配（useUploadFlow.js:267-280）在 iPhone/Android
//   相机文件名重传场景下不可靠（IMG_001 / IMG_002 不同名但同图）。
//
//   修复：客户端在压缩后算 SHA-256（X-Content-Hashes 头），
//   服务端前置 SELECT student_id + content_hash 命中则返回旧 task。
//   DB UNIQUE 索引兜底，防止 API 绕过。
//
// 幂等：ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS，
//       重复跑安全。历史 task 无 content_hash，部分索引
//       WHERE content_hash IS NOT NULL 规避冲突。
// ============================================================
export const migrateTaskContentHash = async () => {
  try {
    console.log('📦 [迁移051] tasks.content_hash 上传内容哈希...')

    // 1. tasks 表新增 content_hash 列（SHA-256 hex = 64 字符）
    await query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS content_hash CHAR(64)
    `)

    // 2. 部分唯一索引：同一学生 + 同一图片内容不能重复落 task
    //    只对未软删的行生效，历史 NULL 行（迁移前上传）不参与
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_student_content_hash
      ON tasks(student_id, content_hash)
      WHERE content_hash IS NOT NULL AND deleted_at IS NULL
    `)

    // 3. 普通索引：按 hash 查询未命中时的快速 fallback
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_content_hash
      ON tasks(content_hash)
      WHERE content_hash IS NOT NULL
    `)

    // 4. 验证
    const { rows } = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'content_hash'
    `)
    if (rows.length === 0) {
      throw new Error('迁移 051 失败：tasks.content_hash 列未创建')
    }
    console.log(`✅ [迁移051] content_hash 列就绪: ${JSON.stringify(rows[0])}`)
  } catch (e) {
    console.error('❌ [迁移051] 失败:', e.message)
    throw e
  }
}
