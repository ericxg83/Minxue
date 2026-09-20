/**
 * 发布「非初三批次」DSL 重绘图（对标 c3 的 publish-dsl-redraws.mjs，多了闸门过滤 + 全字段落库）。
 *
 * 背景：几何重绘的产物目前只躺在 `scripts/logs/non-c3-test/<id8>/structure.json`（测试脚本不写库），
 * 生产端 `question_assets.geometry_structure_json` 至今 0 条、`clean_geometry_svg` 未写 ——
 * 前端主显示、周末班课件（<img>）、PDF 讲义（TikZ）三端都拿不到重绘图。
 *
 * 本脚本把**闸门放行的**重绘图完整落库（每个消费方读的字段都写全）：
 *   1. question_assets.clean_geometry_svg        ← 渲染出的 SVG 源码（前端 getGeometryDisplayUrl 主显示）
 *   2. question_assets.geometry_structure_json   ← 原始结构（TikZ 讲义/后续重建的基础）
 *   3. questions.clean_geometry_image_url        ← SVG→PNG 上传 OSS（周末班课件 resolveFigure/<img>）
 *   4. question_assets.tikz_code + tikz_status   ← TikZ 源码（PDF 讲义通道）
 *   5. questions.tikz_svg_url                    ← TikZ 源码（反范式副本，pdfGenerator 直接读）
 *
 * ⚠️ 闸门过滤是硬性要求：只发布 validateStructureAgainstContent 放行的；
 *    被拒的（幻觉点/漏画线段等）一律跳过并记录，绝不发布 —— 放行率不是 KPI。
 *
 * 幂等：progress.json 里 rec.published 标记已发布，重跑跳过；单张失败不阻塞其它。
 *
 * 用法：
 *   node server/scripts/publish-nonc3-dsl-redraws.mjs            # 预演：打印放行/拒稿清单，不写库
 *   node server/scripts/publish-nonc3-dsl-redraws.mjs --apply --limit 6   # 小批量实发
 *   node server/scripts/publish-nonc3-dsl-redraws.mjs --apply            # 全量实发
 *   node server/scripts/publish-nonc3-dsl-redraws.mjs --apply --allow=24f43832,786a9ee4
 *     # 人工放行通道：对经 triage + 题干人工核实为「闸门误杀」的指定样本
 *     # （如延长线构造、尺规作图痕迹线段），显式点名放行。名单外拒稿照拦。
 *     # 与练习册「教师看到 issues 二次确认后 force=true」同一产品语义。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { uploadFile } from '../services/ossService.js'
import { query, TABLES } from '../config/neon.js'
import { updateQuestionAssetCleanData, updateQuestionAssetTikz, createQuestionAsset } from '../services/neonService.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { renderGeometryTikZ } from '../utils/geometryTikZ.js'
import { normalizeStructure } from '../utils/geom/structure.js'
import { validateStructureAgainstContent } from '../utils/geometryContentGate.js'

const ROOT = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test'
const PROGRESS = path.join(ROOT, 'progress.json')
const APPLY = process.argv.includes('--apply')
// ── 人工放行通道（2026-09-20）：--allow=tag1,tag2 显式点名放行闸门误杀样本 ──
// 只对「triage 归档为甲·闸门过严、且人工核对题干确认线段是题干构造必然产物」的
// 样本使用；名单外的拒稿照拦，绝不因放行率放宽判据本身。
const allowArg = (process.argv.find((a) => a.startsWith('--allow=')) || '').split('=')[1] || ''
const ALLOW = new Set(allowArg.split(',').map((s) => s.trim().slice(0, 8)).filter(Boolean))

const done = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}
// ── 以数据库为准恢复 published 标记 ──
// 2026-09-20 教训：发布脚本与补跑脚本并发写同一个 progress.json，后写的把前写的
// published 标记整份覆盖（published 归零，幂等被破坏）。数据库才是真相：
// 本次发布写的 clean_geometry_image_url 一律是 `images/dsl-<tag>/...` 模式。
// 凡是命中该模式的行，一律视为已发布（补回标记），绝不重复发布也不跳过新图。
const doneIds = Object.keys(done)
if (doneIds.length) {
  const pubRs = await query(
    `SELECT id, clean_geometry_image_url FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`,
    [doneIds],
  )
  let restored = 0
  for (const r of pubRs.rows) {
    const pid = String(r.id)
    if (done[pid] && typeof r.clean_geometry_image_url === 'string' && r.clean_geometry_image_url.includes('/images/dsl-')) {
      if (!done[pid].published) {
        done[pid].published = true
        done[pid].publishedUrl = r.clean_geometry_image_url
        done[pid].publishedAt = done[pid].publishedAt || '2026-09-20T00:00:00.000Z'
        restored++
      }
    }
  }
  if (restored) {
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
    console.log(`已按数据库还原 published 标记 ${restored} 条`)
  }
}

const limArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--limit') + 1]
  || '0'
const LIMIT = parseInt(limArg, 10)

// ── 修复「已发布但 question_assets 无资产行」的题 ──
// 2026-09-20 实测：49 张已发布里 5 张（4cb93a33/a543fe73/8d3a1956/60ebd3b9/07b49090）
// 在 question_assets 里**没有任何行**（入库早于资产功能）——updateQuestionAssetCleanData
// 是 UPDATE，命中 0 行时静默不报错，于是 svg/structure/tikz 全没写进去。
// 这里统一补齐：没有资产行的先 createQuestionAsset 再 UPDATE。
const repairMissingAssets = async () => {
  const pubIds = Object.entries(done).filter(([, r]) => r.published).map(([id]) => id)
  let fixed = 0
  for (const id of pubIds) {
    const tag = String(id).slice(0, 8)
    const sp = path.join(ROOT, tag, 'structure.json')
    if (!fs.existsSync(sp)) continue
    const has = await query(`SELECT 1 FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = $1 LIMIT 1`, [id])
    if (has.rows.length) continue
    const structure = JSON.parse(fs.readFileSync(sp, 'utf8'))
    const svg = renderGeometrySvg(structure)
    const tikz = renderGeometryTikZ(structure)
    await createQuestionAsset({ question_id: id, asset_type: 'geometry_image', tikz_status: 'none' })
    await updateQuestionAssetCleanData(id, { clean_geometry_svg: svg, geometry_structure_json: structure })
    const asset = await query(
      `SELECT id FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = $1 AND asset_type = 'geometry_image' ORDER BY created_at DESC LIMIT 1`,
      [id],
    )
    if (asset.rows.length) await updateQuestionAssetTikz(asset.rows[0].id, { tikz_code: tikz, tikz_status: 'completed' })
    fixed++
    console.log(`修复资产行 ${tag}`)
  }
  if (fixed) console.log(`共补齐资产行 ${fixed} 条`)
  return fixed
}

let rows = Object.entries(done).filter(([, rec]) => rec.ok && !rec.published)

// ── --force=<tag,id8,…>：点名强制重发（无视 published 标记）──
// 用途：已发布图发现坏（如辅助点改名后 segments 引用断裂导致边消失），修好产物后覆盖上线。
// 数据库恢复逻辑会把 published 标记还原（URL 已是 dsl-），--force 绕过该判定直达闸门+发布。
const FORCE = new Set(
  (process.argv.find((a) => a.startsWith('--force='))?.split('=')[1] || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
)
for (const t of FORCE) {
  const hit = Object.entries(done).find(([id]) => id.replace(/-/g, '').startsWith(t))
  if (!hit) { console.log(`--force: 未找到 ${t} 的产物记录，跳过`); continue }
  if (!rows.some(([id]) => id === hit[0])) rows.push(hit)
}
if (LIMIT > 0) rows = rows.slice(0, LIMIT)

console.log(`候选 ${rows.length} 张（ok 且未发布；已发布 ${Object.values(done).filter((r) => r.published).length}）`)
console.log(APPLY ? '模式：实发' : '模式：预演（--apply 才写库，含修复缺资产行）')
if (APPLY) await repairMissingAssets()

// ── 从生产库批量取「完整题干」（parent_stem + content）+ 选项，与 _diag_gate_reject_triage.mjs 同一口径 ──
// ⚠️ 选择题的字母引用几乎全在选项里，不传 options 闸门必误杀（2026-09-20 实测 0da09535 类）
const idList = rows.map(([id]) => id)
const stemByQid = new Map()
if (idList.length) {
  const rs = await query(`SELECT id, parent_stem, content, options FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`, [idList])
  for (const r of rs.rows) {
    const text = [String(r.parent_stem || ''), String(r.content || '')].join('\n')
    const options = Array.isArray(r.options) ? r.options.filter(Boolean) : null
    stemByQid.set(String(r.id), { text, options })
  }
}

const passed = []
const rejected = []
const failed = []

for (const [id, rec] of rows) {
  const tag = String(id).slice(0, 8)
  const dir = path.join(ROOT, tag)
  const sp = path.join(dir, 'structure.json')
  try {
    if (!fs.existsSync(sp)) throw new Error('本地 structure.json 缺失')
    const structure = JSON.parse(fs.readFileSync(sp, 'utf8'))
    // 题干优先用生产库完整版（parent_stem + content + options）；查不到再退回 progress 里的 content
    const stem = stemByQid.get(id)
    const text = stem?.text || rec.content || ''
    const options = stem?.options ?? null
    if (!text.trim()) throw new Error('题干为空，无法过闸门')
    // ── 闸门（硬性）：⚠️ 返回 {ok, reasons} 对象，结构先 normalizeStructure，与治标脚本同一口径 ──
    const s = normalizeStructure(JSON.parse(JSON.stringify(structure)))
    const v = validateStructureAgainstContent(s, text, options)
    if (!v.ok) {
      if (ALLOW.has(tag)) {
        console.log(`  [人工放行] ${tag}: 闸门拒稿被显式放行（--allow），reasons=${(v.reasons || []).slice(0, 2).join(' | ')}`)
      } else {
        rejected.push({ tag, reasons: (v.reasons || []).slice(0, 3) })
        continue
      }
    }
    const svg = renderGeometrySvg(structure)
    const tikz = renderGeometryTikZ(structure)
    if (!svg || !tikz) throw new Error('渲染产出为空')
    passed.push({ id, tag, rec, svg, tikz })
  } catch (e) {
    failed.push({ tag, err: e.message.slice(0, 90) })
  }
}

console.log(`\n闸门放行 ${passed.length} / 拒稿 ${rejected.length} / 出错 ${failed.length}`)
if (rejected.length) {
  console.log('\n── 拒稿清单（不发布）──')
  for (const r of rejected) console.log(`  ${r.tag}: ${r.reasons.join(' | ')}`)
}
if (failed.length) {
  console.log('\n── 出错清单 ──')
  for (const f of failed) console.log(`  ${f.tag}: ${f.err}`)
}

if (!APPLY) {
  console.log(`\n预演结束：将发布 ${passed.length} 张。加 --apply 实发。`)
  process.exit(0)
}

// ── 实发 ──
let ok = 0
for (const [i, p] of passed.entries()) {
  try {
    const svgPng = await sharp(Buffer.from(p.svg)).resize({ width: 800, withoutEnlargement: false }).png().toBuffer()
    const url = await uploadFile(svgPng, 'png', 'images', `dsl-${p.tag}`)

    // 1. question_assets: clean_geometry_svg + geometry_structure_json
    await updateQuestionAssetCleanData(p.id, {
      clean_geometry_svg: p.svg,
      geometry_structure_json: JSON.parse(fs.readFileSync(path.join(ROOT, p.tag, 'structure.json'), 'utf8')),
    })

    // 2. questions: clean_geometry_image_url（<img> 消费方：周末班课件/旧端）
    await query(`UPDATE ${TABLES.QUESTIONS} SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2`, [url, p.id])

    // 3. question_assets: tikz_code + completed（PDF 讲义通道）
    const asset = await query(
      `SELECT id FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = $1 AND asset_type = 'geometry_image' ORDER BY created_at DESC LIMIT 1`,
      [p.id],
    )
    if (asset.rows.length > 0) {
      await updateQuestionAssetTikz(asset.rows[0].id, { tikz_code: p.tikz, tikz_status: 'completed' })
    }

    // 4. questions: tikz_svg_url（反范式副本，pdfGenerator 直接读）
    await query(
      `UPDATE ${TABLES.QUESTIONS} SET tikz_svg_url = $1, display_image_type = COALESCE(display_image_type, 'clean'), updated_at = NOW() WHERE id = $2`,
      [p.tikz, p.id],
    )

    done[p.id].published = true
    done[p.id].publishedAt = new Date().toISOString()
    done[p.id].publishedUrl = url
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
    ok++
    console.log(`[${i + 1}/${passed.length}] ${p.tag} ✅ 已发布（SVG + 结构 + PNG + TikZ）`)
  } catch (e) {
    console.log(`[${i + 1}/${passed.length}] ${p.tag} ❌ ${e.message.slice(0, 100)}`)
    failed.push({ tag: p.tag, err: e.message.slice(0, 90) })
  }
}

console.log(`\n== 汇总 ==`)
console.log(JSON.stringify({ 本次发布: passed.length, 成功: ok, 失败: failed.length, 累计已发布: Object.values(done).filter((r) => r.published).length }, null, 2))
process.exit(0)
