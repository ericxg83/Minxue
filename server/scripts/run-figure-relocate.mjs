// 后台跑「视觉重定位」apply（最强视觉 gemini + 搜本题页±1），逐题日志，不受 HTTP 超时限制。
// 用法：node scripts/run-figure-relocate.mjs            # apply（写库）
//       node scripts/run-figure-relocate.mjs --dry      # 只预演
import dotenv from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })
const { sweepFigureRelocate } = await import('../services/figureRelocateSweep.js')

const dryRun = process.argv.includes('--dry')
const limit = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 60
console.log(`[run-figure-relocate] 开始 dryRun=${dryRun} limit=${limit}`)
const r = await sweepFigureRelocate({ limit, dryRun, logTag: dryRun ? 'relocate_dry' : 'relocate_apply' })
console.log(`[run-figure-relocate] 完成: scanned=${r.scanned} cropped=${r.cropped} noFigure=${r.noFigure}`)
console.log(`[run-figure-relocate] 救回ids: ${JSON.stringify(r.ids)}`)
process.exit(0)
