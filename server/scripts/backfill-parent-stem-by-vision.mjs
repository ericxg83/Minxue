/**
 * 补公共题干（parent_stem）：多小问大题只提取到子题干时的补救（2026-09-24）
 *
 * ── 问题 ──
 * 多小问大题在落库时拆成多行：公共条件存 `parent_stem`，每行 `content` 只留自己的小问。
 * 若采集时公共题干丢了，就只剩「(1) 10²ᵃ + 10ᵇ 的值；」这种**没有条件的小问** ——
 * 答案引擎拿不到「已知 10ᵃ=2，10ᵇ=3」，只能答「待人工补充」，答案永久为空。
 *
 * 实测（2026-09-24 全库）：这类 9 条，且同页其它小问的 parent_stem 都在（如「计算：」），
 * 只有个别题号整组丢了 —— 说明是采集侧漏读，不是题目本身没有。
 *
 * ── 做法 ──
 * 读原卷页图 → 视觉模型**逐字转录**第 N 题的公共题干 → 写回 `parent_stem`。
 *
 * ⛔ 防编造（本题的模型输出会被当成题目条件，编错了比没有更糟）：
 *   1. prompt 明令「只照抄原卷、不要补充不要推理、没有公共题干就返回空」；
 *   2. 转录结果必须**非空**且**与现有 content 不重复**（重复说明模型把子题干也抄进来了）；
 *   3. 两次独立运行转录结果必须一致（同 solve-with-figure 的防幻觉思路）；
 *   4. 默认 dry-run，`--apply` 才写库；写库只改 `parent_stem`。
 *
 * 用法:
 *   node server/scripts/backfill-parent-stem-by-vision.mjs                 # dry-run
 *   node server/scripts/backfill-parent-stem-by-vision.mjs --limit 3
 *   node server/scripts/backfill-parent-stem-by-vision.mjs --apply
 */
import '../loadEnv.js'
import pg from 'pg'
import sharp from 'sharp'
import { callVisionCompletion, WORKBOOK_OCR_VENDOR_CHAIN } from '../config/ai.js'
import { downloadImageBufferNoProxy } from '../utils/noProxyHttp.js'

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}

const APPLY = process.argv.includes('--apply')
const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const LIMIT = Number(argOf('--limit') || 100000)
const CONC = Number(argOf('--conc') || 2)

const PROMPT = `你是作业图片的文字转录助手。用户会指定页码上的某一道题，请**逐字转录**这道题的**公共题干**。

只返回 JSON：
{"parent_stem":"转录出的文字","reason":"简述依据"}

规则：
1. 只转录**公共题干**：从题号（如「13.」）开始，到第一个小问「(1)」之前为止。
   例：原卷印「13. 已知 10ᵃ=2，10ᵇ=3，求：(1) 10²ᵃ+10ᵇ 的值；(2) …」
       → parent_stem 只填「已知 10ᵃ=2，10ᵇ=3，求：」，**不要**把 (1)(2) 的小问抄进来。
2. ⛔ **只照抄原卷上印着的字**。不要补充条件、不要改写、不要"补全"成通顺句子、
   不要推理缺失的信息。原卷没印的一律不写。
3. 如果题号后**直接就是小问**（没有公共题干），parent_stem 填空字符串 ""。
4. 看不清、被遮挡、被裁掉的部分：不要猜，直接不写那部分，并在 reason 里说明。`

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
})

const rows = (await pool.query(
  `SELECT q.id, q.task_id, q.page_number, q.question_number, q.sub_no, q.content,
          COALESCE(q.parent_stem,'') AS parent_stem, t.images AS task_images, s.name
   FROM questions q
   JOIN tasks t ON t.id = q.task_id
   JOIN students s ON s.id = q.student_id
   WHERE q.deleted_at IS NULL
     AND q.sub_no IS NOT NULL
     AND (q.parent_stem IS NULL OR btrim(q.parent_stem) = '')
     AND q.content IS NOT NULL AND btrim(q.content) <> ''
   ORDER BY q.task_id, q.question_number
   LIMIT $1`,
  [LIMIT]
)).rows

console.log(`\n[backfill-parent-stem] 候选 ${rows.length} 条 | 链 ${WORKBOOK_OCR_VENDOR_CHAIN.map(c => `${c.vendor}:${c.model}`).join(' → ')} | ${APPLY ? 'APPLY' : 'dry-run'}`)

const stripFence = (s) => String(s || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[，,。．.;；：:]$/g, '')

const loadPageDataURL = async (r) => {
  let imgs = r.task_images
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs) } catch { imgs = null } }
  const pgNo = r.page_number || 1
  const url = (imgs || []).find(x => Number(x?.page_number) === pgNo)?.image_url || (imgs || [])[0]?.image_url
  if (!url) return null
  const buf = await downloadImageBufferNoProxy(url)
  if (!buf || !buf.length) return null
  const out = await sharp(buf).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

const transcribe = async (r, dataURL) => {
  const out = await callVisionCompletion({
    imageDataURL: dataURL,
    systemPrompt: PROMPT,
    userText: `这是学生作业第 ${r.page_number || 1} 页的照片。请转录【第 ${r.question_number} 题】的公共题干（到第一个小问之前为止）。\n该题的第一个小问内容是：${String(r.content).slice(0, 120)}`,
    temperature: 0.1,
    maxTokens: 800,
    vendorChain: WORKBOOK_OCR_VENDOR_CHAIN,
  })
  const text = typeof out === 'string' ? out : (out?.content || out?.text || '')
  const m = String(text).match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(stripFence(m[0])) } catch { return null }
}

const results = []
let idx = 0
const worker = async () => {
  while (idx < rows.length) {
    const r = rows[idx++]
    const n = idx
    const label = `${r.name || ''} p${r.page_number} q#${r.question_number}(${r.sub_no})`
    try {
      const dataURL = await loadPageDataURL(r)
      if (!dataURL) { console.log(`[${n}/${rows.length}] SKIP ${label} <无页图>`); continue }

      const a = await transcribe(r, dataURL)
      const stem1 = String(a?.parent_stem || '').trim()
      if (!stem1) { console.log(`[${n}/${rows.length}] SKIP ${label} <模型判定无公共题干>`); results.push({ id: r.id, status: 'skip', why: 'empty' }); continue }

      // 校验1：不能与子题干重复（重复说明把子题干也抄进来了）
      if (norm(stem1).includes(norm(r.content).slice(0, 12)) && norm(r.content).length > 6) {
        console.log(`[${n}/${rows.length}] SKIP ${label} <转录含子题干，疑似越界>`)
        results.push({ id: r.id, status: 'skip', why: 'overlap' }); continue
      }
      // 校验2：两次独立转录必须一致
      const b = await transcribe(r, dataURL)
      const stem2 = String(b?.parent_stem || '').trim()
      if (norm(stem1) !== norm(stem2)) {
        console.log(`[${n}/${rows.length}] SKIP ${label} <两次转录不一致>`)
        results.push({ id: r.id, status: 'skip', why: 'inconsistent' }); continue
      }

      console.log(`[${n}/${rows.length}] OK   ${label} => ${JSON.stringify(stem1.slice(0, 70))}`)
      results.push({ id: r.id, status: 'ok', stem: stem1 })
      if (APPLY) {
        await pool.query(`UPDATE questions SET parent_stem = $1, updated_at = NOW() WHERE id = $2`, [stem1, r.id])
      }
    } catch (e) {
      console.log(`[${n}/${rows.length}] SKIP ${label} <${e.name}:${String(e.message).slice(0, 50)}>`)
      results.push({ id: r.id, status: 'skip', why: `${e.name}` })
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker))
await pool.end()

const ok = results.filter(x => x.status === 'ok')
console.log(`\n==== 补公共题干统计（${APPLY ? 'APPLY' : 'dry-run'}）====`)
console.log(`候选 ${rows.length} ｜ 采纳 ${ok.length} ｜ 丢弃 ${results.length - ok.length}`)
const dist = {}
for (const s of results.filter(x => x.status !== 'ok')) dist[s.why] = (dist[s.why] || 0) + 1
console.log('丢弃原因:', JSON.stringify(dist))
for (const o of ok) console.log(`  ${o.id.slice(0, 8)} => ${JSON.stringify(o.stem)}`)
