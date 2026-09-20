/**
 * 修复 9c679f37 双通道重复渲染（O×2）。
 *
 * 背景（2026-09-20）：该题 structure 里 O 同时出现在 points[]（顶点通道）与
 * labels[]（文字通道），旧渲染器两条通道各画一次 ⇒ 生产 SVG 里 O 出现两份
 * （完全同坐标重叠）。根因修复：normalizeStructure 加双通道去重（已锁专测）。
 * 本脚本用修复后的渲染管线重渲染该题存量 structure 并发布。
 *
 * 幂等：重渲染后 SVG 若无重复标注即跳过。
 * 预演：不带 --apply 只打印，不写库。
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import pg from 'pg'
import sharp from 'sharp'
import { uploadFile } from '../services/ossService.js'
import { query, TABLES } from '../config/neon.js'
import { updateQuestionAssetCleanData } from '../services/neonService.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { normalizeStructure } from '../utils/geom/structure.js'

const APPLY = process.argv.includes('--apply')
const QID = '9c679f37-7320-46c8-9cf3-2a9529364ee4'
const TAG = QID.slice(0, 8)
const LOG_DIR = 'D:/Minxue_App_V3/server/scripts/logs/non-c3-test/' + TAG
const BACKUP = LOG_DIR + '/_rerender-backup.json'

const dupCount = (svg) => {
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].trim()).filter(Boolean)
  const cnt = {}
  for (const t of texts) cnt[t] = (cnt[t] || 0) + 1
  return Object.entries(cnt).filter(([, v]) => v > 1)
}

// ── 1. 重渲染 ──
const raw = JSON.parse(fs.readFileSync(LOG_DIR + '/structure.json', 'utf8'))
const norm = normalizeStructure(JSON.parse(JSON.stringify(raw)))
const svg = renderGeometrySvg(norm)
const dups = dupCount(svg)
console.log('重渲染后重复标注:', dups.length ? JSON.stringify(dups) : '无 ✓', 'svg', svg.length, '字节')
if (dups.length) { console.log('仍有重复，中止'); process.exit(1) }

// 与生产旧 SVG 对比
const p = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const cur = await p.query(`SELECT clean_geometry_svg, clean_geometry_image_url FROM question_assets WHERE question_id = $1`, [QID])
if (!cur.rows.length) { console.log('资产行缺失'); process.exit(1) }
const oldSvg = cur.rows[0].clean_geometry_svg || ''
console.log('生产旧 SVG 重复标注:', JSON.stringify(dupCount(oldSvg)))
if (oldSvg === svg) { console.log('生产 SVG 已是新版，无需更新'); await p.end(); process.exit(0) }

// 备份
const backup = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : {}
if (!backup.clean_geometry_svg) {
  backup.clean_geometry_svg = oldSvg
  backup.clean_geometry_image_url = cur.rows[0].clean_geometry_image_url
  backup.backupAt = new Date().toISOString()
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
  console.log('已备份旧 SVG →', BACKUP)
}

// 同步本地产物 draw.svg
fs.writeFileSync(LOG_DIR + '/draw.svg', svg)

if (!APPLY) { console.log('[预演] 将上传新 PNG 并更新生产 SVG。加 --apply 实发'); await p.end(); process.exit(0) }

// ── 2. 实发 ──
const svgPng = await sharp(Buffer.from(svg)).resize({ width: 800, withoutEnlargement: false }).png().toBuffer()
const url = await uploadFile(svgPng, 'png', 'images', `dsl-${TAG}`)
// 只更新 SVG 与 PNG URL；geometry_structure_json 保留原始产物（渲染层每次 normalize）
await p.query(`UPDATE question_assets SET clean_geometry_svg = $1, updated_at = NOW() WHERE question_id = $2`, [svg, QID])
await p.query(`UPDATE questions SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2`, [url, QID])
console.log('✅ 已发布:', url)
await p.end()
