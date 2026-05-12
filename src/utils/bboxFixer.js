/**
 * Bounding Box Diagnostic & Auto-Fix Engine
 * ===========================================
 *
 * Detects and automatically repairs common bounding box issues produced
 * by the AI (Qwen3-VL-8B) OCR pipeline. The AI generates pixel-estimated
 * coordinates that are inherently approximate — this engine catches and
 * corrects the most frequent failure modes.
 *
 * Fix capabilities:
 *   1. De-overlap — vertically separates blocks that share Y ranges
 *   2. Reorder     — reassigns block numbers to match Y position
 *   3. Zero-dim    — estimates width/height from neighboring blocks
 *
 * All fixes are logged so the review UI can show which blocks were
 * adjusted and why.
 *
 * @module bboxFixer
 */

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum gap (px) between consecutive blocks after de-overlap. */
const MIN_GAP = 4

/** Below this value, width or height is considered "missing". */
const MIN_DIM = 20

// ─── Diagnosis ─────────────────────────────────────────────────────────────

/**
 * Diagnose all bounding box issues in a set of blocks.
 *
 * @param {Array} blocks — validated blocks with `.blockCoordinates`
 * @param {{width:number, height:number}|null} imageNaturalSize
 * @returns {{
 *   totalBlocks: number,
 *   zeroDimensions: Array<{ block, field: string }>,
 *   negativeDimensions: Array<{ block, field: string }>,
 *   outOfOrder: Array<{ block, expectedNumber: number }>,
 *   overlapping: Array<{ blockA, blockB, ratio: number }>,
 *   missingCoordinates: Array<{ block }>,
 *   summary: string,
 * }}
 */
export function diagnoseBlocks(blocks, imageNaturalSize) {
  const zeroDimensions = []
  const negativeDimensions = []
  const outOfOrder = []
  const overlapping = []
  const missingCoordinates = []

  for (const block of blocks) {
    const c = block.blockCoordinates
    if (!c || typeof c !== 'object') {
      missingCoordinates.push(block)
      continue
    }
    if (c.x == null || c.y == null) {
      missingCoordinates.push(block)
      continue
    }

    const w = c.width ?? 0
    const h = c.height ?? 0

    if (w === 0 || h === 0) {
      zeroDimensions.push({ block, field: w === 0 ? 'width' : 'height' })
    }
    if (w < 0 || h < 0) {
      negativeDimensions.push({ block, field: w < 0 ? 'width' : 'height' })
    }
  }

  // Detect out-of-order blocks (by Y position)
  const sorted = [...blocks]
    .filter(b => b.blockCoordinates?.y != null)
    .sort((a, b) => (a.blockCoordinates.y ?? 0) - (b.blockCoordinates.y ?? 0))

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i]
    const expectedNumber = i + 1
    if (block.number !== expectedNumber) {
      outOfOrder.push({ block, expectedNumber, actualY: block.blockCoordinates.y })
    }
  }

  // Detect overlapping blocks (exact AABB intersection)
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i].blockCoordinates
    if (!a || a.x == null) continue
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j].blockCoordinates
      if (!b || b.x == null) continue

      const aLeft = a.x, aRight = a.x + (a.width || 0)
      const aTop = a.y, aBottom = a.y + (a.height || 0)
      const bLeft = b.x, bRight = b.x + (b.width || 0)
      const bTop = b.y, bBottom = b.y + (b.height || 0)

      const overlapX = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft))
      const overlapY = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop))

      if (overlapX > 0 && overlapY > 0) {
        const area = overlapX * overlapY
        const aArea = (a.width || 1) * (a.height || 1)
        const bArea = (b.width || 1) * (b.height || 1)
        const ratio = Math.min(area / aArea, area / bArea)
        overlapping.push({ blockA: blocks[i], blockB: blocks[j], ratio: Math.round(ratio * 1000) / 1000 })
      }
    }
  }

  const total = blocks.length
  const summary = [
    `[Diagnosis] ${total} blocks analyzed.`,
    zeroDimensions.length > 0 ? `  ✗ Zero dimensions: ${zeroDimensions.length} block(s)` : null,
    negativeDimensions.length > 0 ? `  ✗ Negative dimensions: ${negativeDimensions.length} block(s)` : null,
    outOfOrder.length > 0 ? `  ✗ Out of Y-order: ${outOfOrder.length} block(s)` : null,
    overlapping.length > 0 ? `  ✗ Overlapping pairs: ${overlapping.length}` : null,
    missingCoordinates.length > 0 ? `  ✗ Missing coordinates: ${missingCoordinates.length} block(s)` : null,
  ].filter(Boolean).join('\n')

  return {
    totalBlocks: total,
    zeroDimensions,
    negativeDimensions,
    outOfOrder,
    overlapping,
    missingCoordinates,
    summary,
  }
}

// ─── Auto-fix ──────────────────────────────────────────────────────────────

/**
 * Fix bounding box issues automatically.
 *
 * @param {Array} blocks — validated blocks with `.blockCoordinates`
 * @param {{width:number, height:number}|null} imageNaturalSize
 * @param {{ fixOverlaps?: boolean, fixOutOfOrder?: boolean, fixZeroDims?: boolean }} [options]
 * @returns {{ fixed: Array, report: string, changes: Array<{ block, field, from, to, reason }> }}
 */
export function fixBoundingBoxes(blocks, imageNaturalSize, options = {}) {
  const {
    fixOverlaps = true,
    fixOutOfOrder = false,
    fixZeroDims = true,
  } = options

  const changes = []

  // Work on a deep copy so we don't mutate the original
  let fixed = blocks.map(b => ({
    ...b,
    blockCoordinates: b.blockCoordinates ? { ...b.blockCoordinates } : b.blockCoordinates,
  }))

  // ── Step 1: Fix zero/negative dimensions ──
  if (fixZeroDims) {
    fixed = applyZeroDimFixes(fixed, imageNaturalSize, changes)
  }

  // ── Step 2: De-overlap — adjust Y positions ──
  if (fixOverlaps) {
    fixed = applyOverlapFixes(fixed, changes)
  }

  // ── Step 3: Reorder block numbers by Y position ──
  if (fixOutOfOrder) {
    fixed = applyOutOfOrderFixes(fixed, changes)
  }

  const report = generateFixReport(blocks, fixed, changes)

  return { fixed, report, changes }
}

// ─── Sub-fixers ────────────────────────────────────────────────────────────

/**
 * Estimate missing width/height from neighboring blocks.
 */
function applyZeroDimFixes(blocks, imageNaturalSize, changes) {
  const imgW = imageNaturalSize?.width || 0
  const imgH = imageNaturalSize?.height || 0

  // Collect valid dimensions for estimation
  const validW = []
  const validH = []
  for (const b of blocks) {
    const c = b.blockCoordinates
    if (c && (c.width || 0) >= MIN_DIM) validW.push(c.width)
    if (c && (c.height || 0) >= MIN_DIM) validH.push(c.height)
  }

  const avgW = validW.length > 0 ? validW.reduce((s, v) => s + v, 0) / validW.length : 400
  const avgH = validH.length > 0 ? validH.reduce((s, v) => s + v, 0) / validH.length : 150

  return blocks.map(b => {
    const c = b.blockCoordinates
    if (!c) return b

    if ((c.width || 0) < MIN_DIM) {
      const from = c.width
      const to = Math.round((c.width ?? 0) > 0 ? c.width : avgW)
      // Clamp to image bounds
      const clamped = Math.min(to, imgW - (c.x || 0))
      c.width = Math.max(MIN_DIM, clamped)
      changes.push({
        block: b,
        field: 'width',
        from: from != null ? String(from) : 'undefined',
        to: String(c.width),
        reason: 'Zero or too-small width estimated from peers',
      })
    }

    if ((c.height || 0) < MIN_DIM) {
      const from = c.height
      const to = Math.round((c.height ?? 0) > 0 ? c.height : avgH)
      const clamped = Math.min(to, imgH - (c.y || 0))
      c.height = Math.max(MIN_DIM, clamped)
      changes.push({
        block: b,
        field: 'height',
        from: from != null ? String(from) : 'undefined',
        to: String(c.height),
        reason: 'Zero or too-small height estimated from peers',
      })
    }

    return b
  })
}

/**
 * De-overlap blocks by pushing overlapping blocks downward.
 *
 * Algorithm:
 *   1. Sort blocks by current Y position.
 *   2. Walk through sorted list. For each block after the first,
 *      if it overlaps with the previous block, push its Y down
 *      to prev.y + prev.height + MIN_GAP.
 *   3. Record all changes.
 */
function applyOverlapFixes(blocks, changes) {
  // Sort by Y, preserving original array order for tie-breaking
  const sorted = [...blocks]
    .filter(b => b.blockCoordinates?.y != null)
    .sort((a, b) => (a.blockCoordinates?.y ?? 0) - (b.blockCoordinates?.y ?? 0))

  if (sorted.length < 2) return blocks

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]

    const prevC = prev.blockCoordinates
    const currC = curr.blockCoordinates
    if (!prevC || !currC) continue

    const prevBottom = (prevC.y || 0) + (prevC.height || 0)
    const currTop = currC.y || 0

    if (currTop < prevBottom + MIN_GAP) {
      const from = currC.y
      currC.y = prevBottom + MIN_GAP
      changes.push({
        block: curr,
        field: 'y',
        from: String(from),
        to: String(currC.y),
        reason: `De-overlapped — was overlapping block #${prev.number} (prev ends at y=${prevBottom})`,
      })
    }
  }

  return blocks
}

/**
 * Reassign block numbers to match Y-sorted order.
 * Does NOT change the actual block objects' number field — instead
 * we record the change so the rendering layer can display the corrected
 * number without mutating the original source-of-truth.
 */
function applyOutOfOrderFixes(blocks, changes) {
  const sorted = [...blocks]
    .filter(b => b.blockCoordinates?.y != null)
    .sort((a, b) => (a.blockCoordinates?.y ?? 0) - (b.blockCoordinates?.y ?? 0))

  const newNumberMap = new Map()
  sorted.forEach((b, i) => {
    if (b.number !== i + 1) {
      newNumberMap.set(b.id, i + 1)
    }
  })

  return blocks.map(b => {
    const newNum = newNumberMap.get(b.id)
    if (newNum != null) {
      changes.push({
        block: b,
        field: 'number',
        from: String(b.number),
        to: String(newNum),
        reason: `Reordered by Y position (was out of order)`,
      })
      return { ...b, number: newNum, _originalNumber: b.number }
    }
    return b
  })
}

// ─── Report ────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable fix report.
 *
 * @param {Array} original — blocks before fixing
 * @param {Array} fixed — blocks after fixing
 * @param {Array} changes — change log from fixBoundingBoxes
 * @returns {string}
 */
export function generateFixReport(original, fixed, changes) {
  const lines = []
  lines.push('')
  lines.push('══════════════════════════════════════════════════')
  lines.push('   Bounding Box Fix Report')
  lines.push('══════════════════════════════════════════════════')
  lines.push('')
  lines.push(`   Total blocks:         ${original.length}`)

  if (changes.length === 0) {
    lines.push('')
    lines.push('   ✓ No fixes needed — all bounding boxes are clean.')
    lines.push('══════════════════════════════════════════════════')
    lines.push('')
    return lines.join('\n')
  }

  lines.push(`   Changes applied:      ${changes.length}`)
  lines.push('')

  // Group changes by type
  const byType = {}
  for (const ch of changes) {
    const key = ch.field
    if (!byType[key]) byType[key] = []
    byType[key].push(ch)
  }

  for (const [field, items] of Object.entries(byType)) {
    lines.push(`   ── ${field.toUpperCase()} fixes (${items.length}) ──`)
    for (const ch of items) {
      lines.push(
        `     Block #${ch.block.number}: ${field} ${ch.from} → ${ch.to}`
      )
      lines.push(`       ${ch.reason}`)
    }
    lines.push('')
  }

  // Summary of fixed block Y positions
  lines.push('   ── Fixed bounding boxes ──')
  for (const b of fixed) {
    const c = b.blockCoordinates
    if (!c) {
      lines.push(`     Block #${b.number}: NO COORDS`)
      continue
    }
    const yEnd = (c.y || 0) + (c.height || 0)
    const wasModified = changes.some(ch => ch.block.id === b.id)
    lines.push(
      `     Block #${String(b.number).padStart(2)}: ` +
      `box=(${c.x || 0},${c.y || 0} ${c.width || 0}×${c.height || 0}) ` +
      `→ y_end=${yEnd}${wasModified ? ' [FIXED]' : ''}`
    )
  }
  lines.push('')

  lines.push('   ✓ Fix complete.')
  lines.push('══════════════════════════════════════════════════')
  lines.push('')

  return lines.join('\n')
}
