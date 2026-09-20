/**
 * C 类坏批次覆盖重跑：初三错题 20260919 老批次重绘图（无判据时代产物）整体重做。
 *
 * 背景（2026-09-20）：20260919 批次发布时判据未收紧、渲染器无双通道去重，
 * 68 张初三重绘图存在 P 系列冒名标注 / 占位符上屏 / 字母重复（OCR 实证）。
 * 本脚本对这批题用修复后的管线整卷重跑并覆盖：
 *   重绘（gemini-3.7-flash）→ normalizeStructure → 闸门 → 渲染 SVG/TikZ →
 *   备份旧值 → 写库（SVG+structure+PNG+TikZ+URL）。
 *
 * 安全：每张写库前备份旧 clean_geometry_svg / URL / tikz 到 logs/c3-redo-backup.json；
 *       闸门拒稿不写库（记录 pending），保持旧图等人工处理。
 * 幂等：进度文件 logs/c3-redo-progress.json，重跑跳过已完成。
 *
 * 用法：
 *   node scripts/redo-c3-bad-batch.mjs --limit=3      # 小批量试跑
 *   node scripts/redo-c3-bad-batch.mjs                # 全量（不写库预演模式见 APPLY）
 *   node scripts/redo-c3-bad-batch.mjs --apply        # 全量并写库
 *   node scripts/redo-c3-bad-batch.mjs --apply --only=1a9e7778,56b77a92
 *   node scripts/redo-c3-bad-batch.mjs --apply --only=5f6abd1e --allow=5f6abd1e
 *     （--allow=tag8：人工核对原卷后放行闸门拒稿——如原卷图本就有题干未提的交点标注 D/E，
 *       2026-09-20 实证「△ABC≅△GAF 相似对数题」原卷有 D/E 而题干无字样，闸门按题干核对必拦）
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import pg from 'pg'
import { correctDslByVision } from '../utils/geom/dsl/reactLoop.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'
import { renderGeometryTikZ } from '../utils/geometryTikZ.js'
import { normalizeStructure } from '../utils/geom/structure.js'
import { validateStructureAgainstContent } from '../utils/geometryContentGate.js'
import { uploadFile } from '../services/ossService.js'
import { updateQuestionAssetCleanData, updateQuestionAssetTikz, createQuestionAsset } from '../services/neonService.js'

const APPLY = process.argv.includes('--apply')
const MODEL = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'gemini-3.7-flash'
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10)
const ONLY = (process.argv.find(a => a.startsWith('--only='))?.split('=')[1] || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const ALLOW = (process.argv.find(a => a.startsWith('--allow='))?.split('=')[1] || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const PUBLISH_LOCAL = (process.argv.find(a => a.startsWith('--publish-local='))?.split('=')[1] || '')
  .split(',').map(s => s.trim()).filter(Boolean)

const OUT = 'D:/Minxue_App_V3/server/scripts/logs/c3-redo'
fs.mkdirSync(OUT, { recursive: true })
const PROGRESS = path.join(OUT, 'progress.json')
const BACKUP = path.join(OUT, 'backup.json')

const GEMINI = {
  endpoint: 'https://api.huihuiyun.top/v1/chat/completions',
  key: process.env.HUIHUIYUN_GEMINI_API_KEY,
  model: MODEL,
  maxTokens: 8192,
}
async function callGemini({ systemPrompt, userText, imageDataURL }) {
  const res = await fetch(GEMINI.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GEMINI.key}` },
    body: JSON.stringify({ model: GEMINI.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: [{ type: 'image_url', image_url: { url: imageDataURL } }, { type: 'text', text: userText }] }], max_tokens: GEMINI.maxTokens, temperature: 0.1 }),
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`gemini HTTP ${res.status}: ${text.slice(0, 120)}`)
  const msg = JSON.parse(text).choices?.[0]?.message
  const content = typeof msg?.content === 'string' ? msg.content : (Array.isArray(msg?.content) ? msg.content.map(x => x?.text || '').join('') : '')
  if (!content) throw new Error('gemini 空 content')
  return content
}

// ── 候选池：初三 + 坏图（20260919 老 dsl 批次，或从未重绘的普通 PNG）+ 库内无 structure ──
// --only 补跑时自动放宽为「初三 + 任意非今日 dsl URL」：普通 PNG 的题（20260918 早期
// 坏图、从未 dsl 重绘）也纳入治理（2026-09-20 对账发现 38 张漏网）
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const urlFilter = ONLY.length
  ? `(q.clean_geometry_image_url NOT LIKE '%/20260920/%')`
  : `((q.clean_geometry_image_url LIKE '%/images/dsl-%' AND q.clean_geometry_image_url LIKE '%/20260919/%')
      OR q.clean_geometry_image_url NOT LIKE '%/images/dsl-%')`
const q = await pool.query(`
  SELECT DISTINCT q.id, q.geometry_image_url, LEFT(q.content, 60) AS content,
         q.clean_geometry_image_url AS cur_url
  FROM questions q
  LEFT JOIN question_assets a ON a.question_id = q.id
  WHERE EXISTS (SELECT 1 FROM wrong_questions w JOIN students s ON s.id = w.student_id
                WHERE w.question_id = q.id AND s.grade = '初三')
    AND ${urlFilter}
    AND (a.question_id IS NULL OR a.geometry_structure_json IS NULL OR a.geometry_structure_json::text IN ('', '{}', 'null'))
  ORDER BY q.id`)
const done = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}
const backup = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : {}

// ── --publish-local：用已落盘的本地产物直接发布（跳过模型与闸门）──
// 前提：人工已对「原卷|重绘」并排终审通过（2026-09-20 核对流程），产物在 OUT/<tag8>/structure.json
if (PUBLISH_LOCAL.length) {
  const ids = Object.keys(done).filter(id => PUBLISH_LOCAL.includes(id.slice(0, 8)))
  console.log(`--publish-local 模式：${ids.length} 张（本地产物直接发布，不再调模型）`)
  let pok = 0
  for (const id of ids) {
    const tag = id.slice(0, 8)
    try {
      const sp = path.join(OUT, tag, 'structure.json')
      if (!fs.existsSync(sp)) throw new Error('本地 structure.json 缺失')
      const structure = JSON.parse(fs.readFileSync(sp, 'utf8'))
      const url = await publishStructure(id, tag, structure)
      done[id] = { ok: true, published: true, url, at: new Date().toISOString(), publishLocal: true }
      fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
      pok++
      console.log(`  ✅ ${tag} → ${url}`)
    } catch (e) {
      console.log(`  ❌ ${tag}: ${e.message.slice(0, 120)}`)
    }
  }
  console.log(`\n== publish-local 汇总 == 成功 ${pok}/${ids.length}`)
  await pool.end()
  process.exit(0)
}

// 共享发布段：渲染 → 备份 → 上传 OSS → 写库（主流程与 --publish-local 共用）
async function publishStructure(id, tag, structure) {
  const svg = renderGeometrySvg(structure)
  const tikz = renderGeometryTikZ(structure)
  if (!svg || !tikz) throw new Error('渲染产出为空')
  // 备份旧值（RIGHT JOIN 保证无资产行也能备份旧 URL）
  const cur = await pool.query(`SELECT a.clean_geometry_svg old_svg, a.tikz_code old_tikz, q.clean_geometry_image_url old_url
                                FROM questions q LEFT JOIN question_assets a ON a.question_id = q.id WHERE q.id = $1`, [id])
  if (!backup[id] && cur.rows.length) {
    backup[id] = {
      clean_geometry_svg: cur.rows[0].old_svg || '',
      tikz_code: cur.rows[0].old_tikz || '',
      clean_geometry_image_url: cur.rows[0].old_url || '',
      backupAt: new Date().toISOString(),
    }
    fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
  }
  const svgPng = await sharp(Buffer.from(svg)).resize({ width: 800, withoutEnlargement: false }).png().toBuffer()
  const url = await uploadFile(svgPng, 'png', 'images', `dsl-${tag}`)
  const has = await pool.query('SELECT 1 FROM question_assets WHERE question_id = $1 LIMIT 1', [id])
  if (!has.rows.length) await createQuestionAsset({ question_id: id, asset_type: 'geometry_image', tikz_status: 'none' })
  await updateQuestionAssetCleanData(id, { clean_geometry_svg: svg, geometry_structure_json: JSON.parse(JSON.stringify(structure)) })
  await pool.query('UPDATE questions SET clean_geometry_image_url = $1, updated_at = NOW() WHERE id = $2', [url, id])
  const asset = await pool.query(`SELECT id FROM question_assets WHERE question_id = $1 AND asset_type = 'geometry_image' ORDER BY created_at DESC LIMIT 1`, [id])
  if (asset.rows.length) await updateQuestionAssetTikz(asset.rows[0].id, { tikz_code: tikz, tikz_status: 'completed' })
  await pool.query(`UPDATE questions SET tikz_svg_url = $1, display_image_type = COALESCE(display_image_type, 'clean'), updated_at = NOW() WHERE id = $2`, [tikz, id])
  // 本地产物存档（供复核）
  const dir = path.join(OUT, tag)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify(structure, null, 1))
  fs.writeFileSync(path.join(dir, 'draw.svg'), svg)
  return url
}

let rows = ONLY.length
  ? q.rows.filter(r => ONLY.some(o => String(r.id).replace(/-/g, '').startsWith(o)))
  : q.rows.filter(r => !done[r.id])
if (LIMIT > 0) rows = rows.slice(0, LIMIT)
console.log(`模型 ${MODEL} | 候选 ${rows.length} 张 / 池 ${q.rows.length} 张 | ${APPLY ? '实发' : '预演（--apply 写库）'}`)

let ok = 0, gateRejected = 0, failed = 0
for (const [i, r] of rows.entries()) {
  const tag = String(r.id).slice(0, 8)
  let gateAllowedOverride = null
  console.log(`\n[${i + 1}/${rows.length}] ${tag} ${r.content}`)
  try {
    if (!r.geometry_image_url) throw new Error('原卷裁片 URL 为空')
    const raw = Buffer.from(await (await fetch(r.geometry_image_url)).arrayBuffer())
    if (!raw.length) throw new Error('裁片下载为空')
    // 完整题干（parent_stem + content）+ 选项 与发布闸门同一口径
    // ⚠️ 选择题的字母引用几乎全在选项里（「l₁∥l₂∥l₃，那么下列结论正确的是」——
    // A/B/C/D 点只在 AB/BC = DE/EF 这类选项里出现），不传 options 必误杀（2026-09-20 实测）
    const full = await pool.query('SELECT coalesce(parent_stem,\'\') ps, coalesce(content,\'\') c, options FROM questions WHERE id = $1', [r.id])
    const text = full.rows.length ? [full.rows[0].ps, full.rows[0].c].join('\n') : (r.content || '')
    const options = (full.rows.length && Array.isArray(full.rows[0].options)) ? full.rows[0].options.filter(Boolean) : null

    const result = await correctDslByVision({
      content: text || '（题干为空）',
      originalImageDataUrl: `data:image/png;base64,${raw.toString('base64')}`,
      dsl: null, callVision: callGemini, maxRounds: 5,
    })
    if (!result.ok || !result.structure) {
      console.log(`   → ❌ 重绘失败: ${result.reason || 'unknown'} (${result.rounds}轮)`)
      failed++
      done[r.id] = { ok: false, reason: result.reason || '', at: new Date().toISOString() }
      fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
      continue
    }
    // 闸门（题干 + 选项同一口径）
    const s = normalizeStructure(JSON.parse(JSON.stringify(result.structure)))
    const v = validateStructureAgainstContent(s, text, options)
    if (!v.ok) {
      const allowed = ALLOW.includes(tag)
      if (!allowed) {
        console.log(`   → ⛔ 闸门拒稿（不写库）: ${(v.reasons || []).slice(0, 2).join(' | ')}`)
        gateRejected++
        // 拒稿也存本地产物供人工核对页（不写库，2026-09-20）
        try {
          const rejSvg = renderGeometrySvg(result.structure)
          if (rejSvg) {
            const dir = path.join(OUT, tag)
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify(result.structure, null, 1))
            fs.writeFileSync(path.join(dir, 'draw.svg'), rejSvg)
            const rejPng = await sharp(Buffer.from(rejSvg)).resize({ width: 520, fit: 'inside' }).png().toBuffer()
            fs.writeFileSync(path.join(dir, 'draw.png'), rejPng)
            fs.writeFileSync(path.join(dir, 'orig.png'), raw)
          }
        } catch (se) { console.log(`   (拒稿产物存档失败: ${se.message.slice(0, 60)})`) }
        done[r.id] = { ok: true, published: false, gateRejected: true, rejectedArtifact: true, reasons: (v.reasons || []).slice(0, 3), at: new Date().toISOString() }
        fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
        continue
      }
      console.log(`   → ⚠️ 闸门拒稿但 --allow 人工放行: ${(v.reasons || []).slice(0, 2).join(' | ')}`)
      gateAllowedOverride = (v.reasons || []).slice(0, 3)
    }
    const svg = renderGeometrySvg(result.structure)
    const tikz = renderGeometryTikZ(result.structure)
    if (!svg || !tikz) throw new Error('渲染产出为空')

    if (!APPLY) {
      console.log(`   → ✅ 重绘+闸门通过（预演，不写库）`)
      ok++
      continue
    }
    const url = await publishStructure(r.id, tag, result.structure)
    console.log(`   → ✅ 已覆盖发布: ${url}`)
    ok++
    done[r.id] = { ok: true, published: true, url, at: new Date().toISOString(), ...(gateAllowedOverride ? { allowed: true, gateReasons: gateAllowedOverride } : {}) }
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
  } catch (e) {
    console.log(`   → ❌ ${e.message.slice(0, 140)}`)
    failed++
    done[r.id] = { ok: false, reason: e.message.slice(0, 200), at: new Date().toISOString() }
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
  }
}
console.log(`\n== 汇总 == 成功 ${ok} / 闸门拒 ${gateRejected} / 失败 ${failed}`)
await pool.end()
process.exit(0)
