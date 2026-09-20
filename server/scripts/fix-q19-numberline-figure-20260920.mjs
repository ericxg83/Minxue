/**
 * 定向修复「第19题」数轴配图（2026-09-20）
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * 第19题公共题干含「如图，一只蚂蚁从点 A 沿数轴向右爬行了 2 个单位长度到达点 B」，
 * 但配图一直有问题：
 *   · 5636fc30（第19章实数复习1）：`geometry_image_url` 为 NULL —— 自动裁剪时
 *     `refineFigureBoxOnPage` 判「该区域分不出图形」按设计不出图 → `is_complete=false`
 *     （规则1「题干引用几何图但缺少配图」）。
 *   · 007113e4（同一份试卷的另一份上传）：图裁出来了，但框宽 1155px、高 132px，
 *     **把学生手写答案「(1)实数 m 的值是 √2+2」和题干文字一起圈进去了** —— 等于泄题。
 *
 * ── 为什么不用 cropAndUploadGeometryImage ───────────────────────────────
 * 该函数内部有两层不可控变形：
 *   ① `refineFigureRegion` 把搜索窗向下扩张（winY1 = box.y + box.height*(1+WIN_EXPAND_Y)）
 *      再 growVertical —— 007113e4 的学生手写紧贴刻度数字下沿，会被当成图形长进框，
 *      实测输入 680x80 输出 709x143，连下方答案行一起圈进来。
 *   ② `cleanGeometryCrop` 的 rotate(1°)+trim 会再吃掉左右白边，刻度「-2」被削掉。
 *
 * ── 本脚本的做法：先纠偏整页 → 再像素级直裁 ──────────────────────────────
 * 两份扫描件都有约 1° 倾斜，且方向相反（007113e4 左低右高 -1.1°，5636fc30 左高右低 +0.96°）。
 * 不纠偏的话矩形框必然「左边切掉刻度数字、右边带进手写」——这是最初反复调框都调不好的根因。
 * 纠偏后刻度水平对齐，一刀切底即可同时保住全部刻度、切干净手写。
 *
 * ── 安全 ────────────────────────────────────────────────────────────────
 * · 默认 dry-run；`--apply` 才写库，先落回滚快照。
 * · 只写 geometry_image_url / image_type / image_bbox 三列，写后重算完整性。
 * · 该页仅此一处图形（题17/18/20/21 均无图），不存在「裁到邻题图」的风险。
 * · `image_bbox` 由「纠偏后框」经逆旋转反算回原图坐标再归一化，保证与其它记录同语义。
 *
 * 用法：
 *   node scripts/fix-q19-numberline-figure-20260920.mjs            # dry-run（落预览图）
 *   node scripts/fix-q19-numberline-figure-20260920.mjs --only=5636fc30
 *   node scripts/fix-q19-numberline-figure-20260920.mjs --apply
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')

const PAGE_W = 1650
const PAGE_H = 2200

/**
 * 每个目标：整页纠偏角（sharp rotate，正=顺时针）+ 纠偏后图上的裁切框（人工核实）。
 * ⚠️ 两份扫描件倾斜方向相反，角度不可互用。
 */
const TARGETS = [
  {
    taskPrefix: '5636fc30', qidPrefix: '4dca950c', label: '第19章实数复习1 · 题19',
    rotate: -0.96, box: { x: 175, y: 584, width: 715, height: 73 },
  },
  {
    taskPrefix: '007113e4', qidPrefix: '9613812b', label: '第19章 实数复习1 · 题19(1)',
    rotate: 1.1, box: { x: 150, y: 566, width: 730, height: 76 },
  },
  {
    taskPrefix: '007113e4', qidPrefix: '0af67fe0', label: '第19章 实数复习1 · 题19(2)',
    rotate: 1.1, box: { x: 150, y: 566, width: 730, height: 76 },
  },
  {
    taskPrefix: '007113e4', qidPrefix: 'eec28b90', label: '第19章 实数复习1 · 题19(3)',
    rotate: 1.1, box: { x: 150, y: 566, width: 730, height: 76 },
  },
].filter(t => {
  const only = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
  return !only || t.taskPrefix === only || t.qidPrefix === only
})

const { query } = await import('../config/neon.js')
const sharp = (await import('sharp')).default
const { uploadImage } = await import('../services/ossService.js')
const { syncQuestionCompleteness } = await import('../services/questionCompletenessSync.js')

/**
 * 把「纠偏后图上的框」逆旋转回原图坐标，返回归一化 0-1000 的 bbox。
 *
 * sharp 的 rotate(θ) 把原图绕中心顺时针转 θ，画布放大到刚好容纳：
 *   前向  p' = M(θ)·(p − c) + c'      M(θ) = [[cosθ, −sinθ],[sinθ, cosθ]]（屏幕坐标 y 向下）
 *   逆向  p  = M(−θ)·(p' − c') + c
 */
function rotatedBoxToOriginalBbox(box, deg) {
  const rad = deg * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const cx = (PAGE_W - 1) / 2, cy = (PAGE_H - 1) / 2
  // 纠偏后画布尺寸
  const rw = Math.round(Math.abs(PAGE_W * cos) + Math.abs(PAGE_H * sin))
  const rh = Math.round(Math.abs(PAGE_W * sin) + Math.abs(PAGE_H * cos))
  const rcx = (rw - 1) / 2, rcy = (rh - 1) / 2

  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ]
  const xs = [], ys = []
  for (const [px, py] of corners) {
    const dx = px - rcx, dy = py - rcy
    // 逆旋转 M(-θ)
    const ox = dx * cos + dy * sin
    const oy = -dx * sin + dy * cos
    xs.push(ox + cx); ys.push(oy + cy)
  }
  const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys))
  const x1 = Math.min(PAGE_W, Math.max(...xs)), y1 = Math.min(PAGE_H, Math.max(...ys))
  return {
    x: Math.round(x0 / PAGE_W * 1000),
    y: Math.round(y0 / PAGE_H * 1000),
    width: Math.round((x1 - x0) / PAGE_W * 1000),
    height: Math.round((y1 - y0) / PAGE_H * 1000),
  }
}

console.log('='.repeat(78))
console.log(`📐 第19题数轴配图修复（纠偏 + 像素级直裁）   mode=${APPLY ? 'APPLY 写库' : 'DRY-RUN'}`)
console.log('='.repeat(78))

const pageBufCache = new Map()
const getPageBuf = async (taskPrefix) => {
  if (pageBufCache.has(taskPrefix)) return pageBufCache.get(taskPrefix)
  const { rows } = await query(`SELECT images FROM tasks WHERE id::text LIKE $1`, [taskPrefix + '%'])
  let imgs = rows[0]?.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = [] } }
  const url = imgs?.[2]?.image_url || imgs?.[2]
  if (!url) { console.warn(`   ⚠️ ${taskPrefix} 无 p3 页图`); pageBufCache.set(taskPrefix, null); return null }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const meta = await sharp(buf).metadata()
  if (meta.width !== PAGE_W || meta.height !== PAGE_H) {
    console.warn(`   ⚠️ ${taskPrefix} p3 尺寸 ${meta.width}x${meta.height}，与人工核实基准 ${PAGE_W}x${PAGE_H} 不符，跳过`)
    pageBufCache.set(taskPrefix, null); return null
  }
  pageBufCache.set(taskPrefix, buf)
  return buf
}

const snapshot = { ts: new Date().toISOString(), items: [] }
const touched = []

for (const t of TARGETS) {
  console.log(`\n${'─'.repeat(78)}\n🎯 ${t.label}  (${t.qidPrefix})`)

  const { rows } = await query(`
    SELECT id, student_id, question_number, image_type, geometry_image_url, image_bbox
    FROM questions WHERE id::text LIKE $1 AND deleted_at IS NULL`, [t.qidPrefix + '%'])
  if (rows.length !== 1) { console.log(`   ⚠️ 命中 ${rows.length} 行（预期 1），跳过`); continue }
  const q = rows[0]
  console.log(`   旧: url=${q.geometry_image_url ? '有' : 'NULL'} type=${JSON.stringify(q.image_type)} bbox=${JSON.stringify(q.image_bbox)}`)

  const pageBuf = await getPageBuf(t.taskPrefix)
  if (!pageBuf) continue

  const rotated = await sharp(pageBuf).rotate(t.rotate, { background: '#ffffff' }).toBuffer()
  const cropped = await sharp(rotated)
    .extract({ left: t.box.x, top: t.box.y, width: t.box.width, height: t.box.height })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()
  const outMeta = await sharp(cropped).metadata()
  const norm = rotatedBoxToOriginalBbox(t.box, t.rotate)
  console.log(`   纠偏 ${t.rotate}° → 裁片 ${outMeta.width}x${outMeta.height} → bbox ${JSON.stringify(norm)}`)

  if (!APPLY) {
    const tmp = resolve(__dirname, `logs/preview-q19-${t.qidPrefix}.png`)
    fs.mkdirSync(dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, cropped)
    console.log(`   (dry-run) 预览: ${tmp}`)
    snapshot.items.push({ id: q.id, before: { url: q.geometry_image_url, type: q.image_type, bbox: q.image_bbox }, after: { box: t.box, rotate: t.rotate, bbox: norm } })
    continue
  }

  const url = await uploadImage(cropped, `geometry_${q.student_id}_${q.id}.png`, q.student_id)
  if (!url) { console.log('   ❌ 上传失败，跳过'); continue }
  console.log(`   ✅ 新裁片: ${url}`)

  snapshot.items.push({ id: q.id, before: { url: q.geometry_image_url, type: q.image_type, bbox: q.image_bbox }, after: { url, type: 'geometry', bbox: norm } })

  await query(
    `UPDATE questions SET geometry_image_url = $2, image_type = 'geometry', image_bbox = $3, updated_at = NOW() WHERE id = $1`,
    [q.id, url, JSON.stringify(norm)])
  touched.push(q.id)
  console.log(`   💾 已写库`)
}

if (APPLY && touched.length) {
  await syncQuestionCompleteness([...new Set(touched)])
  const snapPath = resolve(__dirname, `logs/q19-numberline-figure-${Date.now()}.json`)
  fs.mkdirSync(dirname(snapPath), { recursive: true })
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2))
  console.log(`\n💾 回滚快照: ${snapPath}`)
  console.log(`🔁 已重算完整性 ${touched.length} 条`)
}

console.log('\n' + '='.repeat(78))
console.log(`📊 ${APPLY ? '执行完成' : 'DRY-RUN 预览'} · 处理 ${snapshot.items.length} 条`)
console.log('='.repeat(78))
process.exit(0)
