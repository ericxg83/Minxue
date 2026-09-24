/**
 * 定向补裁：题干引图但 geometry_image_url 为空、且 image_bbox 可用的题（默认 dry-run）
 *
 * ── 为什么需要这个脚本（2026-09-23 Step 2）──
 * 复核减负的门槛之一是 missing_figure：题干写了「如图」，但没有配图。
 * 逐条拆开后发现分两类：
 *   · image_bbox 非空 → **本来能裁**，只是那条链路从来没被跑过
 *     （题在写入侧没有 question_assets 行 ⇒ 不在几何重绘入口里，见铁律 22）
 *   · image_bbox 为空 → 模型压根没给配图框，脚本救不了，需重识别
 * 本脚本只处理第一类：定向补裁，且**收紧判不出图形的直接不写**（不制造错配图）。
 *
 * ── 与 recropFigures.mjs 的分工 ──
 *   recropFigures：已有配图 → 按新收紧逻辑重裁（会清掉判不出图形的）
 *   本脚本      ：没有配图 → 从 image_bbox 现裁（只新增，不覆盖已有配图）
 *
 * ── 安全约束 ──
 *   · 默认 dry-run；--apply 才写库
 *   · **只补空**：geometry_image_url 非空的一律跳过（绝不覆盖老师已确认的配图）
 *   · 必须清代理（HTTP_PROXY 会让 OSS 下载 400 且被静默跳过）
 *   · 必须按生产同口径 rotate+resize(1800,1800,inside)+jpeg85 后再裁（铁律 23）
 *   · 写库前落回滚快照
 *
 * ── --whitelist：人工看图核验后的定向落库（2026-09-23 追加）──
 * 为什么需要它：dry-run 只回答「收紧逻辑认不认这块区域是图形」，
 * **不回答「这块区域是不是一张完整的图形」**。实测 14 道 dry-run 全绿的题里，
 * 人工看图只有 4 道是真图形，其余是残片（只剩顶点 A / 只剩底边）/ 纯文字 / 手写污染。
 * 两轮阈值校准（像素四特征、拓扑四特征）证明像素层无法区分二者 ⇒ 不放启发式上生产。
 * 于是改走：机器 dry-run 出候选 → 人工看图定白名单 → 本参数按白名单精确落库。
 * 白名单文件格式：[{ "id": "<questionId>", "key": "...", "note": "..." }]
 *
 * 用法：
 *   node server/scripts/backfillMissingFigures.mjs                       # 全库 dry-run
 *   node server/scripts/backfillMissingFigures.mjs --days 14             # 只近 14 天
 *   node server/scripts/backfillMissingFigures.mjs --task <id前缀>        # 只某个任务
 *   node server/scripts/backfillMissingFigures.mjs --apply               # 落库
 *   node server/scripts/backfillMissingFigures.mjs --whitelist <json> --apply   # 只落白名单
 */
import 'dotenv/config'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
import fs from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import axios from 'axios'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))

const APPLY = process.argv.includes('--apply')
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const TASK = argOf('--task')
const DAYS = Number(argOf('--days') || 0)
const LIMIT = Number(argOf('--limit') || 5000)
const WHITELIST_PATH = argOf('--whitelist')

// 人工核验白名单：给了就只处理这些 questionId（精确匹配，不按题目/卷子放宽）
let whitelist = null
if (WHITELIST_PATH) {
  const raw = JSON.parse(await fs.readFile(resolve(process.cwd(), WHITELIST_PATH), 'utf8'))
  const ids = raw.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
  if (ids.length === 0) {
    console.error(`❌ 白名单 ${WHITELIST_PATH} 里没有可用 id`)
    process.exit(1)
  }
  whitelist = new Set(ids)
  console.log(`📋 白名单模式：${ids.length} 个 questionId（${WHITELIST_PATH}）`)
}

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// 引图关键词（与 server/utils/questionCompleteness.js 逐字一致）
const FIG = '如图|图[0-9]+|图示|附图|见图'

const { cropAndUploadGeometryImage, isDegenerateFigureBox, clampImageBboxToBlock } = await import('../worker.js')

const params = [LIMIT]
let where = `
  q.deleted_at IS NULL
  AND (q.geometry_image_url IS NULL OR btrim(q.geometry_image_url) = '')
  AND q.image_bbox IS NOT NULL
  AND (COALESCE(q.parent_stem,'') || ' ' || COALESCE(q.content,'')) ~ $${params.length + 1}
`
params.push(FIG)
if (DAYS > 0) {
  params.push(DAYS)
  where += ` AND q.created_at > now() - ($${params.length}::int || ' days')::interval`
}
if (TASK) {
  params.push(TASK + '%')
  where += ` AND q.task_id::text LIKE $${params.length}`
}
if (whitelist) {
  params.push([...whitelist])
  where += ` AND q.id = ANY($${params.length}::uuid[])`
}

const rows = (await pool.query(`
  SELECT q.id, q.student_id, q.task_id, q.question_number, q.page_number,
         q.image_bbox, q.block_coordinates, q.geometry_image_url,
         q.content, q.parent_stem, t.images
  FROM questions q JOIN tasks t ON t.id = q.task_id
  WHERE ${where}
  ORDER BY q.created_at DESC
  LIMIT $1
`, params)).rows

console.log(`${APPLY ? '🛠  APPLY' : '🔍 DRY-RUN'} — 待补裁候选 ${rows.length} 题`)
if (DAYS > 0) console.log(`   范围：近 ${DAYS} 天`)
if (TASK) console.log(`   范围：任务 ${TASK}*`)
if (whitelist) {
  console.log(`   范围：白名单 ${whitelist.size} 个 id（命中 ${rows.length}）`)
  const hit = new Set(rows.map(r => r.id))
  const miss = [...whitelist].filter(id => !hit.has(id))
  if (miss.length) console.log(`   ⚠️ 白名单里 ${miss.length} 个 id 没进候选集（已有配图/无 image_bbox/已删除）：\n      ${miss.join('\n      ')}`)
}
console.log('')

const pageCache = new Map()   // url → 生产同口径压缩后的 Buffer
const results = []
let skipDegenerate = 0, skipNoPage = 0, skipNoFigure = 0, ok = 0

for (const r of rows) {
  const qno = r.question_number ?? '?'
  const tag = `${String(r.task_id).slice(0, 8)} 第${qno}题`

  // 页图
  let imgs = r.images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const page = Array.isArray(imgs)
    ? (imgs.find(i => Number(i.page_number) === Number(r.page_number)) || imgs[0])
    : null
  if (!page?.image_url) { console.log(`  ${tag}: 找不到页图，跳过`); skipNoPage++; continue }

  // 与线上同款前置门禁：退化框 / 未落在题目块内 → 本就不该出图
  if (isDegenerateFigureBox(r.image_bbox, r.block_coordinates)
    || !clampImageBboxToBlock(r.image_bbox, r.block_coordinates)) {
    console.log(`  ${tag}: 配图框退化或未落在题目块内 → 跳过（需重识别）`)
    skipDegenerate++
    continue
  }

  // 页图下载 + 生产同口径压缩
  if (!pageCache.has(page.image_url)) {
    try {
      const raw = Buffer.from((await axios.get(page.image_url, { responseType: 'arraybuffer', timeout: 60000 })).data)
      pageCache.set(page.image_url,
        await sharp(raw).rotate().resize(1800, 1800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer())
    } catch (e) {
      console.log(`  ${tag}: 页图下载失败(${e.message})，跳过`)
      skipNoPage++
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
  const inWhitelist = whitelist ? whitelist.has(r.id) : false

  if (!APPLY) {
    const { refineFigureBoxOnPage } = await import('../utils/figureRegionRefiner.js')
    const { estimatePaperBackground } = await import('../worker.js')
    const refined = await refineFigureBoxOnPage(buf, px, estimatePaperBackground)
    if (!refined) {
      console.log(`  ${tag}: 模型框 ${px.width}x${px.height} → 分不出图形，将跳过`)
      skipNoFigure++
    } else {
      console.log(`  ${tag}: 模型框 ${px.width}x${px.height} → 收紧 ${refined.width}x${refined.height} ✅ 可补`)
      ok++
    }
    results.push({ id: r.id, oldUrl: null, newUrl: refined ? 'PENDING' : null })
    continue
  }

  // 白名单是「人工看图核验过」的真值，允许绕过收紧闸；非白名单仍必须过闸
  if (inWhitelist) {
    // 白名单走老行为（bbox + 20% padding），因为核验时看的就是这个范围；
    // 临时置 FIGURE_REFINE=0 复用生产同一函数，避免另写一条裁剪路径。
    const prevRefine = process.env.FIGURE_REFINE
    process.env.FIGURE_REFINE = '0'
    let mapped = null
    try {
      mapped = await cropAndUploadGeometryImage(buf, px, r.student_id, r.id)
    } catch (e) {
      console.log(`  ${tag}: 白名单题补裁异常(${e.message})`)
    } finally {
      if (prevRefine === undefined) delete process.env.FIGURE_REFINE
      else process.env.FIGURE_REFINE = prevRefine
    }
    if (!mapped) {
      console.log(`  ${tag}: 白名单题补裁失败（上传/裁剪返回 null）`)
      results.push({ id: r.id, oldUrl: null, newUrl: null })
      continue
    }
    console.log(`  ${tag}: ✅ 白名单补裁完成`)
    ok++
    results.push({ id: r.id, oldUrl: null, newUrl: mapped })
    continue
  }

  const mapped = await cropAndUploadGeometryImage(buf, px, r.student_id, r.id)
  if (!mapped) {
    console.log(`  ${tag}: 分不出图形 → 跳过（不制造错配图）`)
    skipNoFigure++
    results.push({ id: r.id, oldUrl: null, newUrl: null })
    continue
  }
  console.log(`  ${tag}: ✅ 补裁完成`)
  ok++
  results.push({ id: r.id, oldUrl: null, newUrl: mapped })
}

console.log(`\n汇总：可补/已补 ${ok} 题；跳过——框退化 ${skipDegenerate}、分不出图形 ${skipNoFigure}、页图不可用 ${skipNoPage}`)

if (!APPLY) {
  console.log('（dry-run，未上传也未写库。确认后加 --apply）')
  await pool.end()
  process.exit(0)
}

const toWrite = results.filter(r => r.newUrl && r.newUrl !== 'PENDING')
if (toWrite.length === 0) {
  console.log('没有可写入的补裁结果。')
  await pool.end()
  process.exit(0)
}

const logDir = resolve(__dirname, 'logs')
await fs.mkdir(logDir, { recursive: true })
const backupPath = resolve(logDir, `backfill-missing-figures-${Date.now()}.json`)
await fs.writeFile(backupPath, JSON.stringify(toWrite, null, 1), 'utf8')
console.log(`💾 回滚快照（记录补裁前的 NULL 与原 URL）: ${backupPath}`)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const r of toWrite) {
    await client.query(
      `UPDATE questions SET geometry_image_url = $2, updated_at = NOW() WHERE id = $1`,
      [r.id, r.newUrl])
  }
  await client.query('COMMIT')
  console.log(`✅ 已提交 ${toWrite.length} 条 geometry_image_url`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error('❌ 已回滚：', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
