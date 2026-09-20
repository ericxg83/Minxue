/**
 * 冻结真实顶点（fixedPoints）在**全量语料**上的影响审计（离线、只读、零视觉调用）。
 *
 * 回答一个问题：把"修正只落在派生点上"作为默认行为后，
 *   - 有多少题走冻结路径（图更干净）
 *   - 有多少题冻结解不开、退回不冻结（= 改造前行为，覆盖率不丢）
 *   - 退回时真实顶点被挪了多少（衡量"扭曲"程度，用于决定要不要加位移上限闸门）
 *
 * 结构与题干直接取自 question_assets.tikz_json —— 是模型当时真实产出的结构，
 * 不需要重新识图，也不消耗任何视觉额度。
 *
 * 用法：
 *   node server/scripts/geometryFreezeAudit.mjs            # 全量
 *   node server/scripts/geometryFreezeAudit.mjs --limit 50
 *   node server/scripts/geometryFreezeAudit.mjs --json     # 额外输出 JSON 明细
 */

import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

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
const LIMIT = argOf('limit') ? Number(argOf('limit')) : null
const AS_JSON = args.includes('--json')

const { correctGeometryFigure } = await import('../utils/geom/correctedRender.js')
const { normalizeStructure } = await import('../utils/geom/structure.js')
const { query } = await import('../config/neon.js')

const { rows } = await query(
  `SELECT a.id AS asset_id, a.question_id, a.tikz_status, a.tikz_json, a.geometry_structure_json,
          q.content, q.parent_stem
     FROM question_assets a
     JOIN questions q ON q.id = a.question_id
    WHERE q.deleted_at IS NULL
      AND COALESCE(a.tikz_json, a.geometry_structure_json) IS NOT NULL
    ORDER BY a.question_id`
)

let items = rows.map(r => ({
  assetId: r.asset_id,
  shortId: String(r.question_id).slice(0, 8),
  tikzStatus: r.tikz_status,
  content: r.content || '',
  parentStem: r.parent_stem || '',
  structure: r.tikz_json || r.geometry_structure_json
}))
if (LIMIT) items = items.slice(0, LIMIT)

const stat = {
  total: items.length,
  noStructure: 0,
  noConstraints: 0,
  frozen: 0,        // 走冻结路径且通过
  retried: 0,       // 冻结解不开 → 退回不冻结且通过
  rejected: 0,      // 两条路径都不过
  rejectedReasons: {},
  retryShifts: [],
  frozenShifts: [],
  retriedIds: []
}
const details = []

for (const it of items) {
  const s = normalizeStructure(it.structure)
  const content = (it.parentStem || '') + (it.content || '')
  let r
  try {
    r = correctGeometryFigure(s, content)
  } catch (e) {
    r = { ok: false, reason: `throw:${e.message}` }
  }

  if (!r.ok) {
    if (r.reason === 'no_constraints') stat.noConstraints++
    else {
      stat.rejected++
      stat.rejectedReasons[r.reason] = (stat.rejectedReasons[r.reason] || 0) + 1
    }
    details.push({ ...it, structure: undefined, ok: false, reason: r.reason })
    continue
  }

  if (r.solved.frozeVertices) {
    stat.frozen++
    stat.frozenShifts.push(r.solved.shiftDerived)
  } else {
    stat.retried++
    stat.retryShifts.push(r.solved.shiftFixed)
    stat.retriedIds.push(it.shortId)
  }
  details.push({
    ...it,
    structure: undefined,
    ok: true,
    frozeVertices: r.solved.frozeVertices,
    shiftFixed: Number(r.solved.shiftFixed.toFixed(3)),
    shiftDerived: Number(r.solved.shiftDerived.toFixed(3)),
    nConstraints: r.solved.nConstraints,
    nDropped: r.solved.nDropped
  })
}

const pct = (n) => stat.total ? `${((n / stat.total) * 100).toFixed(1)}%` : '—'
const quant = (arr, q) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

console.log(`\n═══ 冻结真实顶点：全量语料影响审计 ═══`)
console.log(`带结构的几何资产：${stat.total} 条`)
console.log(`  走冻结路径（真实顶点 0 位移）  ：${stat.frozen} 条 (${pct(stat.frozen)})`)
console.log(`  冻结解不开→退回不冻结（=改造前）：${stat.retried} 条 (${pct(stat.retried)})`)
console.log(`  两条路径都不过                ：${stat.rejected} 条 (${pct(stat.rejected)})`)
console.log(`  无约束可抽                    ：${stat.noConstraints} 条 (${pct(stat.noConstraints)})`)
if (Object.keys(stat.rejectedReasons).length) {
  console.log(`  不过原因：${Object.entries(stat.rejectedReasons).map(([k, v]) => `${k}×${v}`).join('  ')}`)
}

console.log(`\n── 冻结路径的派生点位移（修正量都落在派生点上）──`)
if (stat.frozenShifts.length) {
  console.log(`  中位数 ${quant(stat.frozenShifts, 0.5).toFixed(1)}px   90分位 ${quant(stat.frozenShifts, 0.9).toFixed(1)}px   最大 ${Math.max(...stat.frozenShifts).toFixed(1)}px`)
} else console.log('  （无）')

console.log(`\n── 退回路径的真实顶点位移（越大=图被扭得越厉害）──`)
if (stat.retryShifts.length) {
  console.log(`  中位数 ${quant(stat.retryShifts, 0.5).toFixed(1)}px   90分位 ${quant(stat.retryShifts, 0.9).toFixed(1)}px   最大 ${Math.max(...stat.retryShifts).toFixed(1)}px`)
  const big = details.filter(d => d.ok && d.frozeVertices === false && d.shiftFixed > 20)
  if (big.length) {
    console.log(`  位移 > 20px 的 ${big.length} 条（考虑是否加位移上限闸门）：`)
    for (const b of big.slice(0, 15)) console.log(`    ${b.shortId}  shiftFixed=${b.shiftFixed}px  ${(b.content || '').slice(0, 34)}`)
  }
} else console.log('  （无）')

if (stat.retriedIds.length) {
  console.log(`\n退回不冻结的题（${stat.retriedIds.length} 条）：${stat.retriedIds.slice(0, 40).join(' ')}`)
}

if (AS_JSON) {
  const OUT = resolve(__dirname, 'logs/geom-derived')
  mkdirSync(OUT, { recursive: true })
  const p = resolve(OUT, 'freeze-audit.json')
  writeFileSync(p, JSON.stringify({ stat: { ...stat, retryShifts: undefined, frozenShifts: undefined }, details }, null, 1))
  console.log(`\n明细已写出：${p}`)
}

process.exit(0)
