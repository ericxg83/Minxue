/**
 * 作废「不该重绘 / 陈旧」的 DSL 重绘产物，让前端回退到原卷裁片（2026-09-21）。
 *
 * 背景（老师报障 4 例）：
 *   · 第90题 数值转换器：判据上线前跑出的产物被发布上线，流程图框内中文全丢 → 空框
 *   · 第20题 对角线剪开：只画了图1，图2 整块丢失
 *   · 第16题 两正方形阴影：基于当时的坏裁片重绘，画出完全不同的图
 *   · 第12题 同心圆    ：模型自造字母 O 被闸门拒稿（闸门没错），回退图质量差
 *
 * 两类目标（`--set`）：
 *   nonredrawable  命中 `detectNonGeometryFigure`（流程图 / 输入输出表格 / 多子图 / 四选项图）
 *                  —— 这类图**根本不该重绘**，产物必须作废。
 *   stale          重绘生成时间早于当前裁片的上传时间 ⇒ 模型看的是旧裁片，产物已过期。
 *                  加 `--verify` 会**逐张下载当前裁片与本地产物目录里的 orig.png 做字节比对**，
 *                  只有真的不一致（= 模型当时看到的确实不是现在这张图）才列入。
 *
 * 作废动作（四端字段一次写清，缺一个 = 前端某处仍显示旧图）：
 *   · questions.clean_geometry_image_url / clean_geometry_svg / tikz_svg_url → NULL
 *     （白板 resolveFigure 读前者、PC 复核页 getGeometryDisplayUrl 读后者，清掉即回退裁片）
 *   · questions.display_image_type → 'raw'
 *   · question_assets.clean_geometry_svg / geometry_structure_json / tikz_code / tikz_json → NULL
 *   · question_assets.tikz_status → 'none'，last_error 写明原因
 *     ⚠️ last_error **绝不能**含「无可重绘的几何结构」——`getGeometryDisplayUrl` 见到
 *        「tikz_status==='none' 且 last_error 含该串」会把整张题图**隐藏**（那是给
 *        "bbox 裁到别处题目"用的护栏）。这里我们要的是"显示原卷裁片"。
 *
 * 写库前逐题备份完整字段到 _reports_0921/retract-backup/<tag>.json。
 *
 * 用法：
 *   node scripts/retract-nonredrawable-clean-figures.mjs                       # 预演 nonredrawable
 *   node scripts/retract-nonredrawable-clean-figures.mjs --set=stale --verify  # 只取证，不写
 *   node scripts/retract-nonredrawable-clean-figures.mjs --set=nonredrawable --apply
 *   node scripts/retract-nonredrawable-clean-figures.mjs --tags=3f6abe05,845802c9 --apply
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { detectNonGeometryFigure } from '../utils/geometryContentGate.js'

const ROOT = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test'
const PROGRESS = path.join(ROOT, 'progress.json')
const BACKUP = 'D:/Minxue_App_V3/_reports_0921/retract-backup'
const done = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || ''
const APPLY = process.argv.includes('--apply')
const VERIFY = process.argv.includes('--verify')
const SET = arg('set') || 'nonredrawable'
const TAGS = new Set(arg('tags').split(',').map((s) => s.trim()).filter(Boolean))
const REL_ERR_PREFIX = '不适用几何重绘（已作废旧重绘产物）'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const rows = (await pool.query(`
  SELECT q.id, q.question_number, q.image_type, q.display_image_type,
         q.geometry_image_url, q.clean_geometry_image_url, q.clean_geometry_svg, q.tikz_svg_url,
         q.parent_stem, q.content
    FROM questions q
   WHERE q.clean_geometry_image_url LIKE '%/dsl-%'
   ORDER BY q.id`)).rows

// ── 选目标 ──
const selected = []
for (const row of rows) {
  const tag = String(row.id).slice(0, 8)
  if (TAGS.size && !TAGS.has(tag)) continue
  if (SET === 'nonredrawable') {
    const text = [String(row.parent_stem || ''), String(row.content || '')].join('\n')
    const pref = detectNonGeometryFigure(text)
    if (pref.skip) selected.push({ row, tag, kind: pref.kind, reason: pref.reason })
    continue
  }
  if (SET === 'stale') {
    const rec = done[row.id]
    const genAt = rec?.at ? new Date(rec.at) : null
    let cropAt = null
    try {
      const h = await fetch(row.geometry_image_url, { method: 'HEAD' })
      if (h.ok && h.headers.get('last-modified')) cropAt = new Date(h.headers.get('last-modified'))
    } catch { /* 取不到就跳过 */ }
    if (!genAt || !cropAt) continue
    if (cropAt.getTime() - genAt.getTime() <= 60 * 1000) continue
    selected.push({ row, tag, kind: 'stale', reason: `重绘 ${genAt.toISOString().slice(0, 16)} 早于裁片 ${cropAt.toISOString().slice(0, 16)}` })
  }
}

// ── --verify：字节比对"模型当时看到的图" vs "现在的裁片"（--set=stale 专用）──
if (VERIFY && SET === 'stale') {
  console.log('\n字节取证：本地产物 orig.png  vs  当前裁片（不一致 ⇒ 产物确实基于旧图）')
  const keep = []
  for (const s of selected) {
    const p = path.join(ROOT, s.tag, 'orig.png')
    let verdict
    if (!fs.existsSync(p)) verdict = '无本地产物图（无法比对）'
    else {
      try {
        const cur = Buffer.from(await (await fetch(s.row.geometry_image_url)).arrayBuffer())
        const local = fs.readFileSync(p)
        verdict = cur.length === local.length && cur.equals(local)
          ? 'SAME（裁片未变，判过期是误报）'
          : `DIFF（本地 ${local.length}B vs 当前 ${cur.length}B ⇒ 确实是旧图）`
        if (verdict.startsWith('DIFF')) keep.push(s)
      } catch (e) {
        verdict = `下载失败: ${e.message.slice(0, 40)}`
      }
    }
    s.verdict = verdict
    console.log(`  ${s.tag} qnum=${s.row.question_number ?? '-'}  ${verdict}`)
  }
  if (!APPLY) { await pool.end(); console.log(`\n取证结束：${keep.length}/${selected.length} 张确认过期。`); process.exit(0) }
  selected.length = 0
  selected.push(...keep)
  console.log(`\n仅对 ${selected.length} 张确认过期的执行作废`)
}

console.log(`\n=== 目标集合：${SET}，共 ${selected.length} 条 ===`)
for (const s of selected) {
  console.log(`  ${s.tag} [${s.kind}] qnum=${s.row.question_number ?? '-'}  ${String(s.row.content || '').replace(/\s+/g, ' ').slice(0, 46)}`)
  console.log(`      ${s.reason}`)
}
if (!selected.length) { await pool.end(); process.exit(0) }
if (!APPLY) { await pool.end(); console.log('\n预演结束（未写库）。加 --apply 执行。'); process.exit(0) }

// ── 备份 ──
fs.mkdirSync(BACKUP, { recursive: true })
let okN = 0
for (const s of selected) {
  const qid = s.row.id
  const [asset] = (await pool.query(
    `SELECT id, clean_geometry_svg, geometry_structure_json, tikz_code, tikz_json, tikz_status, last_error
       FROM question_assets WHERE question_id = $1 ORDER BY created_at DESC LIMIT 1`, [qid])).rows
  fs.writeFileSync(
    path.join(BACKUP, `${s.tag}.json`),
    JSON.stringify({
      backedUpAt: new Date().toISOString(), id: qid, tag: s.tag, kind: s.kind, reason: s.reason,
      question: {
        clean_geometry_image_url: s.row.clean_geometry_image_url,
        clean_geometry_svg: s.row.clean_geometry_svg,
        tikz_svg_url: s.row.tikz_svg_url,
        display_image_type: s.row.display_image_type,
      },
      asset: asset ? {
        asset_id: asset.id,
        clean_geometry_svg: asset.clean_geometry_svg,
        geometry_structure_json: asset.geometry_structure_json,
        tikz_code: asset.tikz_code,
        tikz_json: asset.tikz_json,
        tikz_status: asset.tikz_status,
        last_error: asset.last_error,
      } : null,
    }, null, 2),
  )

  const lastError = `${REL_ERR_PREFIX}（${s.kind}）: ${s.reason}`.slice(0, 300)
  await pool.query(
    `UPDATE question_assets
        SET clean_geometry_svg = NULL, geometry_structure_json = NULL,
            tikz_code = NULL, tikz_json = NULL,
            tikz_status = 'none', last_error = $2, updated_at = NOW()
      WHERE question_id = $1`,
    [qid, lastError],
  )
  await pool.query(
    `UPDATE questions
        SET clean_geometry_svg = NULL, clean_geometry_image_url = NULL,
            tikz_svg_url = NULL, display_image_type = 'raw', updated_at = NOW()
      WHERE id = $1`,
    [qid],
  )
  okN++
  console.log(`  ✅ ${s.tag} 已回退（备份 → ${BACKUP}\\${s.tag}.json）`)
}
await pool.end()
console.log(`\n完成：${okN}/${selected.length} 条已回退到原卷裁片。`)
