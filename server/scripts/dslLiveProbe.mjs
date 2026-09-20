/**
 * DSL ReAct 闭环的**真实视觉调用**探针（会消耗所选供应商的额度）。
 *
 * 选一道真实被旧闸门拦下的几何题（默认 0f8bf9ea：正方形 ABCD，E 在 BC 上，
 * F 在 CD 上，AE=AF），把它的原题裁片喂给视觉模型：
 *   第 1 轮：模型看裁片生成第一版 DSL
 *   第 2~N 轮：渲染 → 并排对照图回灌 → 模型核对并修正
 * 全程零人工干预，看模型能不能自己把图画对。
 *
 * 用法：
 *   node server/scripts/dslLiveProbe.mjs                      # 默认 Huihuiyun（无限额度）
 *   node server/scripts/dslLiveProbe.mjs --vendor bailian
 *   node server/scripts/dslLiveProbe.mjs --qid <shortId> --rounds 4
 *
 * 产出：server/scripts/logs/geom-dsl/live/<qid>/   （final.svg/.png、对照图、rounds.json、log.jsonl）
 */

import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import sharp from 'sharp'
import { correctDslByVision } from '../utils/geom/dsl/reactLoop.js'
import { buildStructureFromDsl, renderDslToSvg } from '../utils/geom/dsl/index.js'
import { composeComparison, toDataUrl } from '../utils/geom/dsl/render.js'
import { callVendorVisionCompletion } from '../config/ai.js'
import { validateStructureAgainstContent } from '../utils/geometryContentGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const args = process.argv.slice(2)
const argOf = (name, dflt = null) => {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  return dflt
}
const VENDOR = argOf('vendor', 'Huihuiyun')
const QID = argOf('qid', '0f8bf9ea')
const ROUNDS = argOf('rounds') ? Number(argOf('rounds')) : 3

const { query } = await import('../config/neon.js')
const { rows } = await query(
  `SELECT a.id, LEFT(a.question_id::text,8) AS q, a.cropped_image_url, q.content, q.parent_stem
     FROM question_assets a JOIN questions q ON q.id=a.question_id
    WHERE q.deleted_at IS NULL AND LEFT(a.question_id::text,8) LIKE $1
    ORDER BY a.question_id LIMIT 1`,
  [`${QID}%`]
)
if (!rows.length) { console.error(`❌ 找不到 qid=${QID} 的几何资产`); process.exit(1) }
const row = rows[0]
const content = (row.parent_stem || '') + (row.content || '')

// ── 拉原题裁片 ──
console.log(`题目 ${row.q}: ${content.slice(0, 60)}…`)
console.log(`下载裁片: ${String(row.cropped_image_url).slice(0, 90)}…`)
const resp = await fetch(row.cropped_image_url)
if (!resp.ok) { console.error(`❌ 裁片下载失败 HTTP ${resp.status}`); process.exit(1) }
const cropBuf = Buffer.from(await resp.arrayBuffer())
const originalImageDataUrl = toDataUrl(await sharp(cropBuf).png().toBuffer())
console.log(`裁片 ${cropBuf.length} 字节 → dataURL ${originalImageDataUrl.length} 字符`)

const OUT = resolve(__dirname, 'logs/geom-dsl/live', row.q)
mkdirSync(OUT, { recursive: true })
const logFile = resolve(OUT, 'log.jsonl')

const callVision = async ({ systemPrompt, userText, imageDataURL }) => {
  const t0 = Date.now()
  console.log(`\n── 视觉调用（${VENDOR}）…`)
  const res = await callVendorVisionCompletion({
    vendorName: VENDOR,
    systemPrompt,
    userText,
    imageDataURL,
    temperature: 0.2,
    maxTokens: 8000,
    timeout: 600000
  })
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`    ${res.vendor}/${res.model}  ${dt}s  回复 ${String(res.content).length} 字符`)
  appendFileSync(logFile, JSON.stringify({
    ts: new Date().toISOString(), vendor: res.vendor, model: res.model,
    secs: Number(dt), reply: String(res.content).slice(0, 2000)
  }) + '\n')
  return res.content
}

// ── 跑 ReAct 闭环 ──
const t0 = Date.now()
const result = await correctDslByVision({
  content,
  dsl: null,
  originalImageDataUrl,
  callVision,
  maxRounds: ROUNDS,
  onEvent: (ev) => {
    console.log(`  [第${ev.round}轮 ${ev.phase}] verdict=${ev.verdict} dslOk=${ev.dslOk} render=${ev.hasRender}${ev.note ? ' note=' + ev.note : ''}`)
    if (ev.errors?.length) console.log(`    执行错误: ${ev.errors.slice(0, 5).join(' | ')}`)
  }
})
const totalSecs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n═══ 结果：${result.ok ? '✅ 通过' : '❌ ' + result.reason}（${result.rounds} 轮，${totalSecs}s）═══`)

// ── 落盘：最终 DSL / 结构 / 对照图 / rounds 摘要 ──
writeFileSync(resolve(OUT, 'final.dsl.txt'), result.dsl || '')
writeFileSync(resolve(OUT, 'rounds.json'), JSON.stringify(result.history.map(h => ({
  round: h.round, phase: h.phase, verdict: h.verdict, dslOk: h.dslOk,
  errors: h.errors?.slice(0, 8), hasRender: h.hasRender, stats: h.stats, visionError: h.visionError
})), null, 1))

if (result.structure) {
  writeFileSync(resolve(OUT, 'final.structure.json'), JSON.stringify(result.structure, null, 1))
  const svg = renderDslToSvg(result.structure)
  if (svg) {
    writeFileSync(resolve(OUT, 'final.svg'), svg)
    const renderPng = await sharp(Buffer.from(svg)).resize({ width: 640, fit: 'inside' }).png().toBuffer()
    writeFileSync(resolve(OUT, 'final.png'), renderPng)
    const comp = await composeComparison(cropBuf, renderPng)
    if (comp) writeFileSync(resolve(OUT, 'comparison-final.png'), comp)
    const gate = validateStructureAgainstContent(result.structure, content)
    console.log(`内容闸门: ${gate.ok ? 'PASS' : 'REJECT: ' + (gate.reasons || []).join('；').slice(0, 120)}`)
    writeFileSync(resolve(OUT, 'gate.json'), JSON.stringify({ ok: gate.ok, reasons: gate.reasons }, null, 1))
  }
}

console.log(`产出目录: ${OUT}`)
process.exit(result.ok ? 0 : 1)
