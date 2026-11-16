#!/usr/bin/env node
/**
 * 存量试卷回填 metadata.pdfTextLayer（覆盖面凭据）。
 *
 * 为什么需要：`pdfTextLayer` 是 2026-11-16 才写入的字段，之前的卷没有这条凭据 ⇒
 * 界面无法区分「用文件里的字核过」和「视觉盲抄」。按「零错字 / 无错版」铁律，
 * 必须给每份卷标注真实覆盖面，**不能因为缺字段就默认说它是扫描件**。
 *
 * 判据只有一处实现：`services/pdfWitness.js → describePdfTextLayer`
 * （与解析闸、零错字审计共用）。
 *
 * 用法：
 *   node scripts/backfill-pdf-text-layer.mjs              # 只读预演
 *   node scripts/backfill-pdf-text-layer.mjs --apply      # 写库（先备份旧值）
 *   node scripts/backfill-pdf-text-layer.mjs --id <uuid>  # 只处理一份
 *
 * 只写 metadata.pdfTextLayer，不碰题目行、不碰任何审计结论。
 */
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import '../loadEnv.js'
import { getPool } from '../config/neon.js'
import { extractPdfTextPages } from '../services/pdfService.js'
import { stripSourceLabels, describePdfTextLayer } from '../services/pdfWitness.js'

const APPLY = process.argv.includes('--apply')
const idIdx = process.argv.indexOf('--id')
const ONLY_ID = idIdx > -1 ? process.argv[idIdx + 1] : null
const BACKUP_DIR = fileURLToPath(new URL('../../.audit_tmp/', import.meta.url))

const pdfUrls = (sf) => [
  ...(Array.isArray(sf?.questions) ? sf.questions : []),
  ...(Array.isArray(sf?.answers) ? sf.answers : []),
]
  .map(x => (typeof x === 'string' ? x : x?.url))
  .filter(u => typeof u === 'string' && /\.pdf(\?|$)/i.test(u))

async function fetchBuf(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const pool = await getPool()
  const { rows } = await pool.query(
    `SELECT id, name, metadata FROM resources
      WHERE COALESCE(metadata->'sourceFiles', '{}'::jsonb) <> '{}'::jsonb
      ORDER BY created_at DESC`
  )
  const targets = ONLY_ID ? rows.filter(r => r.id === ONLY_ID) : rows
  console.log(`候选 ${targets.length} 份${APPLY ? '（写库模式）' : '（预演，不改库）'}\n`)

  const backup = []
  let changed = 0
  for (const r of targets) {
    const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {}
    const urls = pdfUrls(meta.sourceFiles)
    if (!urls.length) {
      console.log(`- ${String(r.name).slice(0, 30)}：无 PDF 源 ⇒ 跳过`)
      continue
    }

    const { rows: qs } = await pool.query(
      `SELECT content, parent_stem FROM resource_questions WHERE resource_id = $1`, [r.id])
    const dbChars = qs.reduce((n, q) => n
      + String(q.content || '').length + String(q.parent_stem || '').length, 0)

    let pages = null
    let usedUrl = ''
    for (const u of urls) {
      try {
        pages = await extractPdfTextPages(await fetchBuf(u))
        if (pages) { usedUrl = u; break }
      } catch { /* 换下一份 */ }
    }
    const chars = pages ? pages.map(t => stripSourceLabels(t)).join('').replace(/\s/g, '').length : 0
    const info = describePdfTextLayer({ chars, dbChars, pageCount: pages?.length || 0, witnessedPages: pages?.length || 0 })
    const prev = meta.pdfTextLayer || null
    const same = prev && prev.mode === info.mode && prev.chars === info.chars
    console.log(`- ${String(r.name).slice(0, 30)}: ${info.mode}  文本层 ${chars} 字 / 库内 ${dbChars} 字`
      + `  页 ${pages?.length || 0}${same ? '  (无变化)' : ''}`)
    if (same) continue
    changed += 1
    backup.push({ id: r.id, name: r.name, prev, next: info, url: usedUrl })
  }

  console.log(`\n需更新 ${changed} 份`)

  if (!APPLY) {
    console.log('预演结束。加 --apply 写库。')
    await pool.end?.()
    return
  }
  if (!backup.length) {
    await pool.end?.()
    return
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const backupPath = path.join(BACKUP_DIR, `pdf_text_layer_backup_${stamp}.json`)
  await fs.writeFile(backupPath, JSON.stringify(backup, null, 1), 'utf8')
  console.log(`备份旧值 → ${backupPath}`)

  for (const b of backup) {
    await pool.query(
      `UPDATE resources
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pdfTextLayer', $2::jsonb)
        WHERE id = $1`,
      [b.id, JSON.stringify({ ...b.next, at: new Date().toISOString() })]
    )
  }
  console.log(`已写入 ${backup.length} 份`)
  await pool.end?.()
}

main().catch(e => { console.error('失败:', e.message); process.exit(1) })
