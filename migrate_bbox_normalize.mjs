import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })
import { query } from './server/config/neon.js'
import sharp from './server/node_modules/sharp/lib/index.js'
import axios from './server/node_modules/axios/index.js'

// 用法：
//   node migrate_bbox_normalize.mjs         → dry-run（只打印，不写库）
//   node migrate_bbox_normalize.mjs --apply → 实际写库
const APPLY = process.argv.includes('--apply')

// 复现 worker 的压缩逻辑：fit inside 1920x1920, withoutEnlargement
const MAX = 1920
const compressedDims = (w, h) => {
  const s = Math.min(MAX / w, MAX / h, 1)
  return { cw: Math.round(w * s), ch: Math.round(h * s) }
}

// 安全归一化：把压缩像素空间坐标转成 0-1000 归一化
const normBbox = (bbox, cw, ch) => {
  if (!bbox || typeof bbox !== 'object') return bbox
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
  return {
    ...bbox,
    x: Math.round(n(bbox.x) / cw * 1000),
    y: Math.round(n(bbox.y) / ch * 1000),
    width: Math.round(n(bbox.width) / cw * 1000),
    height: Math.round(n(bbox.height) / ch * 1000)
  }
}

const bboxMax = (b) => {
  if (!b || typeof b !== 'object') return 0
  const x = typeof b.x === 'number' ? b.x : (typeof b.left === 'number' ? b.left : 0)
  const y = typeof b.y === 'number' ? b.y : (typeof b.top === 'number' ? b.top : 0)
  const w = typeof b.width === 'number' ? b.width : 0
  const h = typeof b.height === 'number' ? b.height : 0
  return Math.max(0, x + w, y + h)
}

const parse = (v) => {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
  return v
}

const run = async () => {
  console.log(APPLY ? '=== APPLY 模式：将写入数据库 ===' : '=== DRY-RUN 模式：只打印，不写库（加 --apply 才写库）===')

  const { rows: tasks } = await query(`
    SELECT DISTINCT t.id, t.image_url
    FROM tasks t
    JOIN questions q ON q.task_id = t.id
    WHERE q.block_coordinates IS NOT NULL AND q.block_coordinates::text <> 'null'
  `)
  console.log(`共 ${tasks.length} 个 task 需要处理\n`)

  let migratedQ = 0, skippedTasks = 0, pixelTasks = 0, updatedAssets = 0, skippedAssets = 0

  for (const t of tasks) {
    let origW, origH
    try {
      const resp = await axios.get(t.image_url, { responseType: 'arraybuffer', timeout: 30000 })
      const meta = await sharp(Buffer.from(resp.data)).metadata()
      origW = meta.width; origH = meta.height
    } catch (e) {
      console.log(`⚠️ task ${t.id.substring(0,8)} 图片下载/解析失败，跳过: ${e.message}`)
      skippedTasks++
      continue
    }
    const { cw, ch } = compressedDims(origW, origH)

    const { rows: qs } = await query(
      `SELECT id, question_number, block_coordinates, text_bbox
       FROM questions WHERE task_id = $1
         AND block_coordinates IS NOT NULL AND block_coordinates::text <> 'null'`,
      [t.id]
    )

    // 判定该 task 是否处于「压缩像素空间」：只要任一坐标超过 1000 即证明是像素空间
    let taskMax = 0
    for (const q of qs) {
      taskMax = Math.max(taskMax, bboxMax(parse(q.block_coordinates)))
      if (q.text_bbox) taskMax = Math.max(taskMax, bboxMax(parse(q.text_bbox)))
    }
    const { rows: assets } = await query(
      `SELECT id, question_id, bbox FROM question_assets WHERE question_id = ANY($1)
         AND bbox IS NOT NULL AND bbox::text <> 'null'`,
      [qs.map(q => q.id)]
    )
    for (const a of assets) taskMax = Math.max(taskMax, bboxMax(parse(a.bbox)))

    const isPixelSpace = taskMax > 1000
    if (!isPixelSpace) {
      console.log(`task ${t.id.substring(0,8)}: max=${taskMax} ≤1000 → 已是归一化空间，跳过`)
      skippedTasks++
      continue
    }
    pixelTasks++
    console.log(`task ${t.id.substring(0,8)}: orig ${origW}x${origH} → comp ${cw}x${ch}, max=${taskMax} → 像素空间，归一化 ${qs.length} 题 / ${assets.length} asset`)

    for (const q of qs) {
      const oldBlock = parse(q.block_coordinates)
      const oldText = q.text_bbox ? parse(q.text_bbox) : null
      const newBlock = normBbox(oldBlock, cw, ch)
      const newText = oldText ? normBbox(oldText, cw, ch) : null
      console.log(`   Q#${q.question_number}: block ${JSON.stringify(oldBlock)} → ${JSON.stringify(newBlock)}`)

      if (APPLY) {
        await query(
          `UPDATE questions SET block_coordinates = $1::jsonb, text_bbox = $2::jsonb, updated_at = NOW() WHERE id = $3`,
          [JSON.stringify(newBlock), newText ? JSON.stringify(newText) : null, q.id]
        )
      }
      migratedQ++

      const qAssets = assets.filter(a => a.question_id === q.id)
      for (const a of qAssets) {
        const newAssetBbox = normBbox(parse(a.bbox), cw, ch)
        if (APPLY) {
          await query(`UPDATE question_assets SET bbox = $1::jsonb WHERE id = $2`, [JSON.stringify(newAssetBbox), a.id])
        }
        updatedAssets++
      }
    }
  }

  console.log(`\n完成：`)
  console.log(`  像素空间 task ${pixelTasks} 个 → ${migratedQ} 题${APPLY ? '已' : '将'}归一化，${updatedAssets} 条 asset bbox`)
  console.log(`  已归一化/跳过 task ${skippedTasks} 个（未被改动，保证不破坏已有归一化数据）`)
  if (!APPLY) console.log('\n这是 DRY-RUN，未写库。确认无误后运行： node migrate_bbox_normalize.mjs --apply')
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
