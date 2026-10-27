/**
 * 存量 chart_image 资产转录回填（2026-10-27 图表数字护栏）
 *
 * 背景：question_assets.chart_ocr_text（图表逐字转录）自本日起对新批改任务自动生成；
 * 存量资产没有转录文本 ⇒ 图表数字护栏（figureNumberGuard）对历史题 fail-open 跳过。
 * 本脚本补齐存量，让「同题再次出现走缓存命中」时护栏依然生效（缓存命中路径同样核对）。
 *
 * ⭐ 按 cropped_image_url 分组去重：1774 行资产实测只共享 15 张唯一裁剪图
 *   （同题不同学生各建一行、指向同一张 crop），每张唯一图只调一次转录。
 * 通道：CHART_OCR_VENDOR_CHAIN（SenseNova kimi-k3 主 —— 免费通道；Bailian qwen3.8-flash 兜 —— 套餐内）。
 * 并发 2、逐图 fail-open、失败可重跑（幂等：只补 chart_ocr_text IS NULL 的行）。
 *
 * 用法：node server/scripts/backfill-chart-ocr-20261027.mjs            # dry-run（默认，只数只看）
 *       node server/scripts/backfill-chart-ocr-20261027.mjs --apply
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { ocrChartCropImage } from '../utils/chartOcr.js'

const APPLY = process.argv.includes('--apply')
const CONCURRENCY = 2

const pool = getPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows

async function runBatch(items, worker) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(worker))
  }
}

const main = async () => {
  const rows = await q(
    `SELECT a.id, a.cropped_image_url, a.chart_ocr_text, q.question_number
       FROM question_assets a
       LEFT JOIN questions q ON q.id = a.question_id
      WHERE a.asset_type = 'chart_image' AND a.cropped_image_url IS NOT NULL
        AND (q.deleted_at IS NULL OR q.id IS NULL)
      ORDER BY a.created_at`
  )
  // 按 URL 分组；组内取任一已有转录做复用源，否则需要 OCR
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.cropped_image_url)) groups.set(r.cropped_image_url, { ids: [], text: null, no: r.question_number })
    const g = groups.get(r.cropped_image_url)
    g.ids.push(r.id)
    if (!g.text && r.chart_ocr_text) g.text = r.chart_ocr_text
  }
  const needOcr = [...groups.entries()].filter(([, g]) => !g.text)
  console.log(`chart_image 资产 ${rows.length} 行 → 唯一裁剪图 ${groups.size} 张，需转录 ${needOcr.length} 张`)

  if (!APPLY) {
    console.log('[dry-run] 未调用任何视觉通道。加 --apply 执行转录（kimi-k3 主，免费通道）。')
    await pool.end()
    return
  }

  let ok = 0
  const failures = []
  await runBatch(needOcr, async ([url, g]) => {
    const res = await ocrChartCropImage(url)
    if (res.ok) {
      g.text = res.text
      ok++
      console.log(`  ✅ ${g.ids.length} 行 ← 转录 ${res.text.length} 字（no=${g.question_number}）: ${res.text.slice(0, 60).replace(/\n/g, ' ')}`)
    } else {
      failures.push({ url: String(url).slice(-24), reason: res.reason })
      console.warn(`  ⚠️ 转录失败（${res.reason}）: …${String(url).slice(-24)}`)
    }
    return true
  })

  // 把组内文本写回所有缺转录的行（UPDATE ... RETURNING 才有行数；无 RETURNING 时 rows 恒空）
  let written = 0
  for (const [, g] of groups.entries()) {
    if (!g.text) continue
    const r = await pool.query(
      `UPDATE question_assets SET chart_ocr_text = $2, updated_at = NOW()
        WHERE id = ANY($1::uuid[]) AND chart_ocr_text IS NULL
        RETURNING id`,
      [g.ids, g.text]
    )
    written += r.rowCount
  }

  console.log(`\n[apply] 唯一图转录成功 ${ok}/${needOcr.length}，失败 ${failures.length}；写回 ${written} 行资产`)
  await pool.end()
}

main().catch(async (e) => {
  console.error('[fatal]', e)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
