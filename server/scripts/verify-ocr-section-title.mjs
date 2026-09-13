/**
 * 端到端验证：新的 OCR 提示词能否从真实练习册页图里读出「正文单元小标题」。
 *
 * 背景：3 份练习册卷 32 题全部 pending，根因是 page_title 只读页眉、读到的是全书书名跑马灯。
 * 本次给提示词加了 section_title（正文里的本页课时小标题）。这个脚本用真实页图实测，
 * 避免"应该能识别"的想当然。
 *
 * 只调 AI 识别，不写库。
 * 用法：node server/scripts/verify-ocr-section-title.mjs [taskId前8位]
 */
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })
import pg from 'pg'
import { callVisionCompletion, buildOCRPrompt } from '../config/ai.js'

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const prefix = process.argv[2] || '2ed887cd'

const { rows } = await pool.query(
  `SELECT id, original_name, images FROM tasks WHERE id::text LIKE $1 LIMIT 1`, [prefix + '%'])
if (rows.length === 0) { console.error('找不到任务', prefix); process.exit(1) }

const task = rows[0]
const imgs = Array.isArray(task.images) ? task.images : []
console.log(`任务: ${task.id}  卷名: ${task.original_name}  页数: ${imgs.length}`)

const page = imgs[0]
const url = page?.image_url
if (!url) { console.error('第 1 页没有 image_url'); process.exit(1) }
console.log(`第 1 页图: ${url.slice(0, 90)}...\n`)

const resp = await fetch(url)
if (!resp.ok) { console.error('图片下载失败', resp.status); process.exit(1) }
const buf = Buffer.from(await resp.arrayBuffer())
const ext = (resp.headers.get('content-type') || 'image/jpeg').includes('png') ? 'png' : 'jpeg'
console.log(`下载完成 ${(buf.length / 1024).toFixed(0)} KB\n正在调用视觉模型（新提示词）...\n`)

const t0 = Date.now()
const { content, provider } = await callVisionCompletion({
  imageDataURL: `data:image/${ext};base64,${buf.toString('base64')}`,
  systemPrompt: buildOCRPrompt(),
  userText: '识别这张作业图片的页面标题和所有题目的学生答案。',
  temperature: 0.1,
  maxTokens: 8192,
})
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  provider=${provider}\n`)

let parsed = null
try {
  const s = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  parsed = JSON.parse(s)
} catch (e) {
  console.error('JSON 解析失败:', e.message)
  console.log(String(content).slice(0, 600))
  await pool.end()
  process.exit(1)
}

console.log('══════ 识别结果 ══════')
console.log('page_title    (页眉/书名) :', JSON.stringify(parsed.page_title ?? null))
console.log('section_title (正文小标题):', JSON.stringify(parsed.section_title ?? null))
console.log('题目数:', Array.isArray(parsed.questions) ? parsed.questions.length : 0)
console.log('\n前 3 题题干：')
for (const q of (parsed.questions || []).slice(0, 3)) {
  console.log(`  ${q.question_number}. ${String(q.content || '').replace(/\s+/g, ' ').slice(0, 60)}`)
}

console.log('\n══════ 判定 ══════')
const st = parsed.section_title
if (!st) {
  console.log('❌ 模型没给出 section_title —— 提示词需要再收紧（或该页确实无正文小标题）')
} else if (/成长|桥|堂堂清|练习 第|周$/.test(st)) {
  console.log(`⚠️  section_title 疑似仍填了书名跑马灯：「${st}」，提示词约束不够`)
} else {
  console.log(`✅ section_title = 「${st}」，是可用于答案库定位的课时小标题`)
}

await pool.end()
