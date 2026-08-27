/**
 * 修复历史配图数据（默认 dry-run，加 --apply 才落库）
 *
 * 根因：VL 模型把配图框写成角点形态 [x1,y1,x2,y2]，而 image_bbox 一直按 {x,y,width,height}
 * 解读，裁剪框整体拉伸出页面，前端「配图」显示成隔壁题的选项文字甚至纸面空白。
 *
 * 本脚本做三件事：
 *  1) 按 (task_id, page_number) 整页表决，把 image_bbox / text_bbox 的角点形态换算为宽高；
 *  2) 换算后仍被 isDegenerateFigureBox 判为「从题目框机械推出来的一条」的题，
 *     清掉错误的 geometry_image_url 与 question_assets（宁可没配图，也不能给错配图）；
 *  3) --recrop：对坐标确实变了、且框有效的题，用原页图重新裁剪配图并回写。
 *
 * 幂等：只在与目标值不同时才写；重复执行不会二次改动。
 * 用法：node scripts/repairFigureBboxSemantics.mjs [--apply] [--recrop] [--task <taskId>]
 */
import 'dotenv/config'
import pg from 'pg'
import fs from 'node:fs/promises'
import axios from 'axios'
import {
  normalizeBlockBoxSemantics, isDegenerateFigureBox, clampImageBboxToBlock,
  cropAndUploadGeometryImage,
} from '../worker.js'

const APPLY = process.argv.includes('--apply')
const RECROP = process.argv.includes('--recrop')
// 已有配图也强制重裁（用于覆盖此前裁错的图；默认只补坐标刚修正或缺配图的）
const FORCE = process.argv.includes('--force')
const taskArg = process.argv.indexOf('--task')
const ONLY_TASK = taskArg >= 0 ? process.argv[taskArg + 1] : null

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
const q = (t, p) => pool.query(t, p).then(r => r.rows)

// 页图 URL 必须按 page_number 取本题所在那一页：
// tasks.image_url 只是第 1 页，多页任务拿它去裁第 2 页就是另一种张冠李戴。
const rows = await q(`
  SELECT q.id, q.task_id, q.student_id, q.page_number, q.question_number,
         q.block_coordinates, q.image_bbox, q.text_bbox, q.geometry_image_url,
         COALESCE(
           (SELECT qa.original_image_url FROM question_assets qa
             WHERE qa.question_id = q.id AND qa.original_image_url IS NOT NULL LIMIT 1),
           (SELECT im->>'image_url' FROM jsonb_array_elements(t.images) im
             WHERE (im->>'page_number')::int = COALESCE(q.page_number, 1) LIMIT 1),
           CASE WHEN COALESCE(q.page_number, 1) = 1 THEN t.image_url END
         ) AS page_image_url
  FROM questions q
  LEFT JOIN tasks t ON t.id = q.task_id
  WHERE (q.image_bbox IS NOT NULL OR q.text_bbox IS NOT NULL)
    ${ONLY_TASK ? 'AND q.task_id = $1' : ''}
  ORDER BY q.task_id, q.page_number, q.question_number
`, ONLY_TASK ? [ONLY_TASK] : [])
console.log(`扫描 ${rows.length} 道带坐标的题目`)

// ── 1. 整页表决换算 ──
const pages = new Map()
for (const r of rows) {
  const key = `${r.task_id}|${r.page_number ?? 1}`
  if (!pages.has(key)) pages.set(key, [])
  pages.get(key).push(r)
}

const boxFixes = []   // { row, image_bbox, text_bbox }
for (const [key, pageRows] of pages) {
  const probes = pageRows.map(r => ({
    block_coordinates: r.block_coordinates ? { ...r.block_coordinates } : null,
    image_bbox: r.image_bbox ? { ...r.image_bbox } : null,
    text_bbox: r.text_bbox ? { ...r.text_bbox } : null,
  }))
  const before = probes.map(p => JSON.stringify([p.image_bbox, p.text_bbox]))
  normalizeBlockBoxSemantics(probes)
  probes.forEach((p, i) => {
    if (JSON.stringify([p.image_bbox, p.text_bbox]) !== before[i]) {
      boxFixes.push({ row: pageRows[i], key, image_bbox: p.image_bbox, text_bbox: p.text_bbox })
    }
    pageRows[i]._fixed = p   // 供第 2/3 步复用换算结果
  })
}
console.log(`\n── 角点形态配图/文本框: ${boxFixes.length} 处（${new Set(boxFixes.map(b => b.key)).size}/${pages.size} 页命中）──`)
for (const b of boxFixes.slice(0, 8)) {
  console.log(`  任务 ${String(b.row.task_id).slice(0, 8)} 页${b.row.page_number} 第${b.row.question_number}题  ` +
    `img ${JSON.stringify(b.row.image_bbox)} → ${JSON.stringify(b.image_bbox)}`)
}
if (boxFixes.length > 8) console.log(`  …其余 ${boxFixes.length - 8} 处同理`)

// ── 2. 换算后仍是退化框 → 清掉错误配图 ──
const badFigures = []
for (const r of rows) {
  const fixed = r._fixed
  const bbox = fixed?.image_bbox
  if (!bbox) continue
  const degenerate = isDegenerateFigureBox(bbox, fixed.block_coordinates)
  const safe = degenerate ? null : clampImageBboxToBlock(bbox, fixed.block_coordinates)
  if ((degenerate || !safe) && r.geometry_image_url) {
    badFigures.push({ row: r, bbox })
  }
}
console.log(`\n── 未定位到图形却已生成配图（将清空 geometry_image_url + 资产）: ${badFigures.length} 条 ──`)
for (const b of badFigures.slice(0, 8)) {
  console.log(`  任务 ${String(b.row.task_id).slice(0, 8)} 页${b.row.page_number} 第${b.row.question_number}题  bbox ${JSON.stringify(b.bbox)}`)
}
if (badFigures.length > 8) console.log(`  …其余 ${badFigures.length - 8} 条同理`)

// ── 3. 框有效且能定位到本页原图 → 待重裁 ──
const recropTargets = []
for (const r of rows) {
  if (badFigures.some(x => x.row.id === r.id)) continue
  const fixed = r._fixed
  const bbox = fixed?.image_bbox
  if (!bbox || isDegenerateFigureBox(bbox, fixed.block_coordinates)) continue
  const safe = clampImageBboxToBlock(bbox, fixed.block_coordinates)
  if (!safe) continue
  if (!r.page_image_url) {
    console.warn(`  ⚠️ 任务 ${String(r.task_id).slice(0, 8)} 页${r.page_number} 第${r.question_number}题 找不到本页原图，跳过重裁`)
    continue
  }
  const coordsFixed = boxFixes.some(b => b.row.id === r.id)
  if (!FORCE && !coordsFixed && r.geometry_image_url) continue
  recropTargets.push({ row: r, safe })
}
console.log(`\n── 可重裁配图: ${recropTargets.length} 条${RECROP ? '' : '（未加 --recrop，本次只改坐标）'} ──`)
for (const t of recropTargets.slice(0, 8)) {
  console.log(`  任务 ${String(t.row.task_id).slice(0, 8)} 页${t.row.page_number} 第${t.row.question_number}题  → ${JSON.stringify(t.safe)}  原图 …${String(t.row.page_image_url).slice(-16)}`)
}
if (recropTargets.length > 8) console.log(`  …其余 ${recropTargets.length - 8} 条同理`)

if (!APPLY) {
  console.log('\n（dry-run，未写库。确认无误后加 --apply）')
  await pool.end()
  process.exit(0)
}

// ── 落库 ──
const backup = {
  at: new Date().toISOString(),
  boxes: boxFixes.map(b => ({ id: b.row.id, image_bbox: b.row.image_bbox, text_bbox: b.row.text_bbox })),
  figures: badFigures.map(b => ({ id: b.row.id, geometry_image_url: b.row.geometry_image_url })),
}
await fs.mkdir(new URL('./logs/', import.meta.url), { recursive: true })
const backupPath = new URL(`./logs/repair-figure-bbox-${Date.now()}.json`, import.meta.url)
await fs.writeFile(backupPath, JSON.stringify(backup, null, 1), 'utf8')
console.log(`\n💾 回滚快照: ${backupPath.pathname}`)

// 重裁在事务外做（涉及下载 + OSS 上传，失败不该拖垮坐标修复）
const recropped = []
if (RECROP && recropTargets.length) {
  console.log(`\n🖼️  重裁 ${recropTargets.length} 张配图…`)
  const pageCache = new Map()
  for (const t of recropTargets) {
    try {
      const url = t.row.page_image_url
      if (!pageCache.has(url)) {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
        pageCache.set(url, Buffer.from(resp.data))
      }
      const buf = pageCache.get(url)
      const sharpMod = (await import('sharp')).default
      const meta = await sharpMod(buf).metadata()
      const pixel = {
        x: Math.round(t.safe.x / 1000 * meta.width),
        y: Math.round(t.safe.y / 1000 * meta.height),
        width: Math.round(t.safe.width / 1000 * meta.width),
        height: Math.round(t.safe.height / 1000 * meta.height),
      }
      const ossUrl = await cropAndUploadGeometryImage(buf, pixel, t.row.student_id, t.row.id)
      if (ossUrl) recropped.push({ id: t.row.id, url: ossUrl, bbox: t.safe })
    } catch (e) {
      console.warn(`  ⚠️ 第${t.row.question_number}题重裁失败: ${e.message}`)
    }
  }
  console.log(`   成功 ${recropped.length}/${recropTargets.length}`)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const b of boxFixes) {
    await client.query(
      `UPDATE questions SET image_bbox = $2, text_bbox = $3, updated_at = NOW() WHERE id = $1`,
      [b.row.id, b.image_bbox ? JSON.stringify(b.image_bbox) : null, b.text_bbox ? JSON.stringify(b.text_bbox) : null])
  }
  if (badFigures.length) {
    const ids = badFigures.map(b => b.row.id)
    await client.query(`UPDATE questions SET geometry_image_url = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [ids])
    await client.query(`DELETE FROM question_assets WHERE question_id = ANY($1::uuid[])`, [ids])
  }
  for (const r of recropped) {
    await client.query(`UPDATE questions SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1`, [r.id, r.url])
    // 配图换了，之前基于错图重建出来的 TikZ / 净化图全部作废，重置成 pending 让 geometryWorker 重跑
    await client.query(
      `UPDATE question_assets
          SET cropped_image_url = $2, bbox = $3, tikz_status = 'pending',
              tikz_code = NULL, tikz_json = NULL, tikz_url = NULL, tikz_svg_url = NULL,
              clean_geometry_image_url = NULL, clean_geometry_svg = NULL,
              geometry_structure_json = NULL, last_error = NULL, retry_count = 0,
              updated_at = NOW()
        WHERE question_id = $1`, [r.id, r.url, JSON.stringify(r.bbox)])
  }
  await client.query('COMMIT')
  console.log(`\n✅ 已提交：坐标 ${boxFixes.length} 处、清空错误配图 ${badFigures.length} 条、重裁 ${recropped.length} 张`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('\n❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
