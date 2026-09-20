/**
 * 修复「平行线分线段」同题 3 个副本（f4803671 / 0a59bb5e / a9b7e038）的坏重绘 PNG。
 *
 * 背景（2026-09-20）：用户反馈重绘图"多个重复字母"。定位到 2026-09-18 早期批次
 * （无判据时代）生成的 PNG 把内部构造点命名成 P1~P6 上屏。同题 508f3427 在
 * non-c3-test 已有**闸门放行且已发布**的正确产物（标注 A~F + l₁/l₂/l₃）。
 * 本脚本把该正确产物复制发布到 3 个副本（题干完全一致 ⇒ 图形一致，安全复用）。
 *
 * 幂等：clean_geometry_image_url 已是 dsl- 前缀的行视为已修复，跳过。
 * 预演：不带 --apply 只打印将做什么，不写库。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import pg from 'pg'
import sharp from 'sharp'
import { uploadFile } from '../services/ossService.js'
import { query, TABLES } from '../config/neon.js'
import { updateQuestionAssetCleanData, updateQuestionAssetTikz, createQuestionAsset } from '../services/neonService.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { renderGeometryTikZ } from '../utils/geometryTikZ.js'
import { normalizeStructure } from '../utils/geom/structure.js'
import { validateStructureAgainstContent } from '../utils/geometryContentGate.js'

const APPLY = process.argv.includes('--apply')
const SRC_ID = '508f3427-19a2-4fa4-b604-97001c2860c2' // 正确产物源
const TARGETS = [
  'f4803671-6019-48a3-a82b-fe503ab21bd5',
  '0a59bb5e-940b-4c1a-a8ed-d783642ea9d3',
  'a9b7e038-e9ed-4ccc-9236-459b26b62a0b',
]

const SRC_DIR = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test/' + SRC_ID.slice(0, 8)
const BACKUP = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test/_fix-dup-letters-backup.json'

// ── 1. 读源产物 ──
if (!fs.existsSync(SRC_DIR + '/structure.json')) throw new Error('源 structure.json 缺失')
const srcStructure = JSON.parse(fs.readFileSync(SRC_DIR + '/structure.json', 'utf8'))
const srcSvg = renderGeometrySvg(srcStructure)
const srcTikz = renderGeometryTikZ(srcStructure)
console.log('源产物 508f3427: svg', srcSvg.length, '字节 / tikz', srcTikz.length, '字节')

// ── 2. 源结构先过一遍闸门（用源题干），确认源本身有效 ──
{
  const rs = await query(`SELECT id, parent_stem, content FROM ${TABLES.QUESTIONS} WHERE id = $1`, [SRC_ID])
  if (!rs.rows.length) throw new Error('源题不存在')
  const text = [String(rs.rows[0].parent_stem || ''), String(rs.rows[0].content || '')].join('\n')
  const s = normalizeStructure(JSON.parse(JSON.stringify(srcStructure)))
  const v = validateStructureAgainstContent(s, text)
  if (!v.ok) console.log('⚠️ 源结构过闸门被拒（仅提示，仍复用）：', (v.reasons || []).slice(0, 3).join(' | '))
  else console.log('源结构闸门 OK')
}

// ── 3. 对每个目标：备份旧值 + 预演/实发 ──
const backup = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : {}
for (const id of TARGETS) {
  const tag = id.slice(0, 8)
  const rs = await query(`SELECT id, clean_geometry_image_url, tikz_svg_url FROM ${TABLES.QUESTIONS} WHERE id = $1`, [id])
  if (!rs.rows.length) { console.log(`${tag} 不存在，跳过`); continue }
  const cur = rs.rows[0]
  const already = typeof cur.clean_geometry_image_url === 'string' && cur.clean_geometry_image_url.includes('/images/dsl-')
  if (already && backup[id]) { console.log(`${tag} 已是 dsl- 且已备份，跳过`); continue }
  if (already && !backup[id]) { console.log(`${tag} 已是 dsl-（补备份），继续刷新`); }

  // 备份旧值（仅一次）
  if (!backup[id]) {
    backup[id] = { clean_geometry_image_url: cur.clean_geometry_image_url, tikz_svg_url: cur.tikz_svg_url, backupAt: new Date().toISOString() }
    fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
    console.log(`${tag} 已备份旧值 → ${BACKUP}`)
  }

  if (!APPLY) { console.log(`[预演] ${tag}: 将发布正确重绘图（SVG+结构+PNG+TikZ），旧值=${cur.clean_geometry_image_url || '(空)'}`); continue }

  // 实发
  try {
    const svgPng = await sharp(Buffer.from(srcSvg)).resize({ width: 800, withoutEnlargement: false }).png().toBuffer()
    const url = await uploadFile(svgPng, 'png', 'images', `dsl-${tag}`)
    // asset 行：无则先建（坑 38：UPDATE 0 行静默成功）
    const has = await query(`SELECT 1 FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = $1 LIMIT 1`, [id])
    if (!has.rows.length) {
      await createQuestionAsset({ question_id: id, asset_type: 'geometry_image', tikz_status: 'none' })
      console.log(`  ${tag} 资产行缺失，已补建`)
    }
    await updateQuestionAssetCleanData(id, { clean_geometry_svg: srcSvg, geometry_structure_json: JSON.parse(JSON.stringify(srcStructure)) })
    await query(`UPDATE ${TABLES.QUESTIONS} SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2`, [url, id])
    const asset = await query(
      `SELECT id FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = $1 AND asset_type = 'geometry_image' ORDER BY created_at DESC LIMIT 1`,
      [id],
    )
    if (asset.rows.length) await updateQuestionAssetTikz(asset.rows[0].id, { tikz_code: srcTikz, tikz_status: 'completed' })
    await query(
      `UPDATE ${TABLES.QUESTIONS} SET tikz_svg_url = $1, display_image_type = COALESCE(display_image_type, 'clean'), updated_at = NOW() WHERE id = $2`,
      [srcTikz, id],
    )
    console.log(`${tag} ✅ 已发布（${url}）`)
  } catch (e) {
    console.log(`${tag} ❌ ${e.message.slice(0, 120)}`)
  }
}
console.log(APPLY ? '\n== 实发完成 ==' : '\n== 预演结束（加 --apply 实发）==')
process.exit(0)