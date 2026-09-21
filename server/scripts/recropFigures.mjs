/**
 * 一次性回填：按新的"配图区域收紧"逻辑重裁历史配图（默认 dry-run，加 --apply 落库）
 *
 * 旧裁剪 = 模型框 + 20% padding，并排排版的配图行里会把隔壁题的图、图下的
 * "第N题图"图注、下方题干/选项一起圈进来。这里对已有配图重新走一遍
 * cropAndUploadGeometryImage（内部已接入像素收紧），拿到新 URL 后更新。
 * 收紧判不出图形的（模型把题干当配图）→ 清掉 geometry_image_url，不再展示错配图。
 *
 * 用法：node scripts/recropFigures.mjs [--apply] [--task <id前缀>] [--limit N]
 */
import 'dotenv/config'
// ⚠️ 必须清代理：不清时 OSS 下载返回 400 且被 catch 静默跳过，汇总打印"重裁 0 张"，
//   极易误判成"没有需要重裁的题"（2026-09-21 实测踩坑；其它同类脚本都自带这一段）。
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
import fs from 'node:fs/promises'
import pg from 'pg'
import axios from 'axios'
import sharp from 'sharp'
import { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } from '../worker.js'

const APPLY = process.argv.includes('--apply')
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const TASK = argOf('--task')
const GRADE = argOf('--grade')
// --no-clear：收紧判"分不出图形"时**保留原配图**，只做重裁，不把已有配图清空。
//   2026-09-17 实测：不加这个开关会误清 6 张**真图形**（矩形草地、阶梯图、抛物线…），
//   收紧闸对这些框是假阴性 —— 所以首次大批量重裁务必先 dry-run，再用 --no-clear 上。
const NO_CLEAR = process.argv.includes('--no-clear')
const LIMIT = Number(argOf('--limit') || 500)

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.task_id, q.question_number, q.page_number,
         q.image_bbox, q.block_coordinates, q.geometry_image_url, t.images
  FROM questions q JOIN tasks t ON t.id = q.task_id
  JOIN students s ON s.id = q.student_id
  WHERE q.image_bbox IS NOT NULL AND q.deleted_at IS NULL
    AND q.geometry_image_url IS NOT NULL
    ${TASK ? "AND q.task_id::text LIKE $2" : ''}
    ${GRADE ? `AND s.grade = '${String(GRADE).replace(/'/g, '')}'` : ''}
  ORDER BY q.created_at DESC LIMIT $1`,
  TASK ? [LIMIT, TASK + '%'] : [LIMIT])).rows

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — ${rows.length} 张历史配图待重裁\n`)

const pageCache = new Map()
const results = []
for (const r of rows) {
  let imgs = r.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const page = Array.isArray(imgs)
    ? (imgs.find(i => Number(i.page_number) === Number(r.page_number)) || imgs[0])
    : null
  const tag = `任务${String(r.task_id).slice(0, 8)} 第${r.question_number}题`
  if (!page?.image_url) { console.log(`  ${tag}: 找不到页图，跳过`); continue }

  // 与线上同样的前置门禁：退化框（从题目框机械推出来的）本就不该出图
  if (isDegenerateFigureBox(r.image_bbox, r.block_coordinates)
    || !clampImageBboxToBlock(r.image_bbox, r.block_coordinates)) {
    console.log(`  ${tag}: 配图框未定位到图形 → 清除配图`)
    results.push({ id: r.id, oldUrl: r.geometry_image_url, newUrl: null })
    continue
  }

  if (!pageCache.has(page.image_url)) {
    try {
      const raw = Buffer.from((await axios.get(page.image_url, { responseType: 'arraybuffer', timeout: 60000 })).data)
      // ⚠️ 必须与生产同口径：两条批改管线都是先把整页 rotate()+resize(1800,1800,inside)+jpeg85
      // 压缩后才交给 cropAndUploadGeometryImage（worker.js 的 pageBuffers，4183/4718/4896 三处同款）。
      // 拿原图直接裁，收紧的墨迹掩码尺度不同 ⇒ 裁出来的框与线上不一致
      // （2026-09-21 第5题 078d57ac 实测：原图路径裁片残留左侧手写，压缩路径裁片干净）。
      pageCache.set(page.image_url,
        await sharp(raw).rotate().resize(1800, 1800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer())
    } catch (e) {
      console.log(`  ${tag}: 页图下载失败(${e.message})，跳过`)
      continue
    }
  }
  const buf = pageCache.get(page.image_url)
  const meta = await sharp(buf).metadata()
  const px = {
    x: Math.round(r.image_bbox.x / 1000 * meta.width),
    y: Math.round(r.image_bbox.y / 1000 * meta.height),
    width: Math.round(r.image_bbox.width / 1000 * meta.width),
    height: Math.round(r.image_bbox.height / 1000 * meta.height)
  }

  if (!APPLY) {
    // dry-run 不上传，只报告收紧结果
    const { refineFigureBoxOnPage } = await import('../utils/figureRegionRefiner.js')
    const { estimatePaperBackground } = await import('../worker.js')
    const refined = await refineFigureBoxOnPage(buf, px, estimatePaperBackground)
    console.log(`  ${tag}: 模型框 ${px.width}x${px.height} → ${refined ? `${refined.width}x${refined.height}` : '判不出图形，将清除配图'}`)
    results.push({ id: r.id, oldUrl: r.geometry_image_url, newUrl: refined ? 'PENDING' : null })
    continue
  }

  const mapped = await cropAndUploadGeometryImage(buf, px, r.student_id, r.id)
  const newUrl = (!mapped && NO_CLEAR) ? r.geometry_image_url : mapped
  console.log(`  ${tag}: ${mapped ? '重裁完成' : (NO_CLEAR ? '收紧未通过，保留原图（--no-clear）' : '判不出图形 → 清除配图')}`)
  results.push({ id: r.id, oldUrl: r.geometry_image_url, newUrl, kept: !mapped && NO_CLEAR })
}

const cleared = results.filter(r => r.newUrl === null).length
const recropped = results.filter(r => r.newUrl && r.newUrl !== 'PENDING').length
console.log(`\n汇总：重裁 ${APPLY ? recropped : results.length - cleared} 张、清除 ${cleared} 张`)

if (!APPLY) {
  console.log('（dry-run，未上传也未写库。确认后加 --apply）')
  await pool.end()
  process.exit(0)
}

const backupPath = new URL(`./logs/recrop-backup-${Date.now()}.json`, import.meta.url)
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
await fs.writeFile(backupPath, JSON.stringify(results, null, 1), 'utf8')
console.log(`💾 回滚快照（含旧 URL）: ${backupPath.pathname}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const r of results) {
    await client.query(
      `UPDATE questions SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1`,
      [r.id, r.newUrl])
  }
  await client.query('COMMIT')
  console.log(`✅ 已提交 ${results.length} 条`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
