/**
 * 零错字审计 · 命令行入口（2026-11-09）
 *
 * ⚠ 正常的试卷上传**已经自动跑**这套审计（server/services/zeroTypoAuditService.js
 *   在解析完成后入队，结果写在 resources.metadata.zeroTypoAudit，工作台卷子头上直接显示）。
 *   这个脚本只剩两种用途：
 *     ① 存量老卷补跑（自动审计上线前解析的卷子）；
 *     ② 通道抖动 / 服务重启导致自动审计失败时的离线重跑与排查。
 *
 * 用法：
 *   node scripts/ops/zero_typo_audit.mjs --resource=<资源id>               # 只查不改（看差异）
 *   node scripts/ops/zero_typo_audit.mjs --resource=<资源id> --apply       # 两票以上一致就改库
 *   node scripts/ops/zero_typo_audit.mjs --resource=<资源id> --apply --verify  # 改完换问法闭环复核
 *   node scripts/ops/zero_typo_audit.mjs --resource=<资源id> --pages=3,4   # 只审指定页
 *   node scripts/ops/zero_typo_audit.mjs --resource=<资源id> --no-cache    # 不复用缓存（重新计费）
 *   node scripts/ops/zero_typo_audit.mjs --all-missing [--limit=5]         # 存量补审（没 passed 的都跑）
 *
 * ⛔ 审计判据只有一份实现：server/services/zeroTypoAuditService.js。
 *    本文件绝不再复制一套比对逻辑（否则线上自动跑与线下补跑会给出两个答案）。
 */
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config({ path: fileURLToPath(new URL('../../server/.env', import.meta.url)) })
import { getPool } from '../../server/config/neon.js'
import { runZeroTypoAudit } from '../../server/services/zeroTypoAuditService.js'

const args = process.argv.slice(2)
const resArg = args.find(a => a.startsWith('--resource='))
const RES_ID = resArg ? resArg.split('=')[1] : ''
const ALL_MISSING = args.includes('--all-missing')
if (!RES_ID && !ALL_MISSING) {
  console.error('用法: node scripts/ops/zero_typo_audit.mjs --resource=<资源id> [--pages=1,2] [--apply] [--verify] [--no-cache]')
  console.error('      node scripts/ops/zero_typo_audit.mjs --all-missing [--limit=5] [--apply] [--verify]')
  process.exit(2)
}

const pagesArg = args.find(a => a.startsWith('--pages='))
const PAGES = pagesArg ? pagesArg.split('=')[1].split(',').map(Number).filter(n => Number.isFinite(n) && n > 0) : null
const APPLY = args.includes('--apply')
const VERIFY = args.includes('--verify')
const NO_CACHE = args.includes('--no-cache')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 5) : 5

const pool = getPool()
try {
  let ids = [RES_ID]
  if (ALL_MISSING) {
    // 存量补审：只挑「还没有 passed」的卷子。已经通过的绝不重烧（重跑会重新计费）。
    const { rows } = await pool.query(
      `SELECT id FROM resources
        WHERE resource_type = 'exam'
          AND COALESCE(metadata->'zeroTypoAudit'->>'status', '') <> 'passed'
        ORDER BY COALESCE(metadata->'zeroTypoAudit'->>'at', created_at::text) ASC
        LIMIT $1`,
      [LIMIT]
    )
    ids = rows.map(r => r.id)
    console.log(`[zero-typo] 存量补审：${ids.length} 份卷子（limit=${LIMIT}）`)
  }

  for (const resourceId of ids) {
    console.log(`\n[zero-typo] === ${resourceId} ===`)
    const summary = await runZeroTypoAudit({
      resourceId,
      pages: ALL_MISSING ? null : (PAGES && PAGES.length ? PAGES : null),
      apply: APPLY,
      verify: VERIFY,
      noCache: NO_CACHE,
      reason: 'cli',
    })
    for (const [k, v] of Object.entries(summary)) {
      if (v == null || v === '') continue
      console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    }
    if (APPLY && summary.fixed) console.log(`  ↳ 改动前原文备份: ${summary.backupFile || '.audit_tmp/'}`)
  }
} catch (e) {
  console.error('[zero-typo] 审计失败:', e?.message || e)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
