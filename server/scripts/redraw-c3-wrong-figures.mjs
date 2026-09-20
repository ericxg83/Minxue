/**
 * 初三错题配图 DSL 重绘（批量）
 *
 * 口径：students.grade='初三' 的错题（wrong_questions.question_id 关联）→ questions
 *   geometry_image_url 非空 AND clean_geometry_svg IS NULL（未重绘）
 * 通道：gemini-3.8-flash（辉辉云另一组 key，收费，0.02 元/次量级）
 * 循环：correctDslByVision（生成 1 + 核对 ≤4，maxRounds 5）
 *
 * **默认不写库**：结果落 logs/c3-dsl-redraw/（SVG/PNG/对比页 + 进度 JSON），
 * 用户满意后 --apply 才写 questions.clean_geometry_svg。
 * 断点续跑：每张完成即 append 进度，中断后重跑跳过已完成。
 *
 * 用法：
 *   node scripts/redraw-c3-wrong-figures.mjs            # 跑；--limit N 只跑前 N 张
 *   node scripts/redraw-c3-wrong-figures.mjs --apply    # 跑完并把成功的 SVG 写库
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { correctDslByVision } from '../utils/geom/dsl/reactLoop.js'
import { renderGeometrySvg } from '../utils/geometrySvg.js'

const OUT = 'D:/Minxue_App_V3/server/scripts/logs/c3-dsl-redraw'
fs.mkdirSync(OUT, { recursive: true })
const PROGRESS = path.join(OUT, 'progress.json')
const APPLY = process.argv.includes('--apply')
const RETRY = process.argv.includes('--retry')
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10)

const GEMINI = {
  endpoint: 'https://api.huihuiyun.top/v1/chat/completions',
  key: process.env.HUIHUIYUN_GEMINI_API_KEY,
  model: 'gemini-3.8-flash',
  maxTokens: 8192,
}
let calls = 0 // 真实调用计数（对账用）
async function callGemini({ systemPrompt, userText, imageDataURL }) {
  calls++
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

// ── 进度载入与取样 ──
const done = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}
// --retry：把失败记录从进度中剔除，允许重跑
if (RETRY) {
  const failedIds = Object.keys(done).filter(id => !done[id].ok)
  for (const id of failedIds) delete done[id]
  console.log(`--retry：剔除失败记录 ${failedIds.length} 张重跑`)
}
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// --apply：先把进度里「历史成功但未写库」的记录补写（重跑批次后调用，避免重复跑）
let appliedHist = 0
if (APPLY) {
  for (const [id, rec] of Object.entries(done)) {
    if (rec.ok && !rec.applied && rec.svg) {
      try {
        const svg = fs.readFileSync(path.join(OUT, rec.svg), 'utf8')
        await pool.query('UPDATE questions SET clean_geometry_svg = $1, updated_at = NOW() WHERE id = $2', [svg, id])
        rec.applied = true
        appliedHist++
      } catch (e) { console.warn(`   写库失败 ${String(id).slice(0, 8)}: ${e.message.slice(0, 60)}`) }
    }
  }
  fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
}
console.log(`--apply：已补写历史成功 ${appliedHist} 张`)
const q = await pool.query(`
  SELECT DISTINCT q.id, q.geometry_image_url, q.content
  FROM wrong_questions wq
  JOIN students st ON st.id = wq.student_id
  JOIN questions q ON q.id = wq.question_id
  WHERE st.grade = '初三' AND q.geometry_image_url IS NOT NULL AND q.geometry_image_url <> ''
    AND q.clean_geometry_svg IS NULL
  ORDER BY q.id`)
let rows = q.rows.filter(r => !done[r.id])
if (LIMIT > 0) rows = rows.slice(0, LIMIT)
console.log(`初三待重绘 ${rows.length} 张${APPLY ? '（--apply 将写库）' : ''}（已完成 ${Object.keys(done).length}）`)

// ── 逐张跑 ──
let okN = 0
const failed = []
for (const [i, r] of rows.entries()) {
  const tag = String(r.id).slice(0, 8)
  console.log(`\n[${i + 1}/${rows.length}] ${tag} ${(r.content || '').slice(0, 22)}`)
  try {
    const raw = Buffer.from(await (await fetch(r.geometry_image_url)).arrayBuffer())
    if (!raw || raw.length === 0) throw new Error('裁片下载为空')
    const result = await correctDslByVision({
      content: r.content || '（题干为空）',
      originalImageDataUrl: `data:image/png;base64,${raw.toString('base64')}`,
      dsl: null, callVision: callGemini, maxRounds: 5,
    })
    const rec = { id: r.id, content: (r.content || '').slice(0, 60), geometry_image_url: r.geometry_image_url,
      ok: result.ok, rounds: result.rounds, weakOk: !!result.weakOk, reason: result.reason || '',
      pts: result.structure?.points?.length, segs: result.structure?.segments?.length, at: new Date().toISOString() }
    if (result.ok && result.structure) {
      const svg = renderGeometrySvg(result.structure)
      if (svg) {
        const dir = path.join(OUT, tag); fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'draw.svg'), svg)
        const png = await sharp(Buffer.from(svg)).resize({ width: 520, fit: 'inside' }).png().toBuffer()
        fs.writeFileSync(path.join(dir, 'draw.png'), png)
        fs.writeFileSync(path.join(dir, 'orig.png'), raw)
        rec.svg = `${tag}/draw.svg`
        if (APPLY) {
          // 写库：clean_geometry_svg（展示字段，重绘优先级高于增强图 URL；不动 geometry_image_url）
          await pool.query('UPDATE questions SET clean_geometry_svg = $1, updated_at = NOW() WHERE id = $2', [svg, r.id])
          rec.applied = true
        }
      } else { rec.ok = false; rec.reason = 'render_empty' }
    }
    okN += rec.ok ? 1 : 0
    if (!rec.ok) failed.push(rec)
    done[r.id] = rec
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
    console.log(`   → ${rec.ok ? '✅' : '❌'} ${rec.rounds}轮${rec.weakOk ? ' 弱OK' : ''} ${rec.pts ?? 0}点/${rec.segs ?? 0}线 ${rec.reason || ''}${rec.applied ? ' [已写库]' : ''}`)
  } catch (e) {
    done[r.id] = { id: r.id, ok: false, reason: `EXC:${e.message.slice(0, 80)}`, at: new Date().toISOString() }
    fs.writeFileSync(PROGRESS, JSON.stringify(done, null, 2))
    failed.push(done[r.id])
    console.log(`   ❌ ${e.message.slice(0, 120)}`)
  }
}

// ── 汇总 ──
const allRec = Object.values(done)
const totalFig = allRec.length
const okRec = allRec.filter(r => r.ok)
console.log('\n== 汇总 ==')
console.log(JSON.stringify({
  本次处理: rows.length, 累计处理: totalFig, 成功: okRec.length,
  成功率: `${(okRec.length / Math.max(1, totalFig) * 100).toFixed(1)}%`,
  平均轮数: (okRec.reduce((a, b) => a + b.rounds, 0) / Math.max(1, okRec.length)).toFixed(2),
  弱OK数: okRec.filter(r => r.weakOk).length,
  gemini调用次数: calls,
  写库: APPLY ? (okRec.filter(r => r.applied).length) : '(未写库)',
  失败明细: failed.map(f => `${String(f.id).slice(0, 8)}:${f.reason}`).slice(0, 30),
}, null, 2))
console.log(`进度/产物目录: ${OUT}`)
await pool.end()