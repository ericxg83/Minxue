/**
 * Bounding Box Detection Module
 * ================================
 *
 * Formalizes OCR-derived block coordinates as proper bounding boxes for
 * each question on the exam image. Computes safe-zone margins around each
 * box where annotations can be placed without covering question content.
 *
 * This module is Stage 3 of the ExamReview rendering pipeline:
 *   Stage 1: Image load
 *   Stage 2: Coordinate validation
 *   Stage 3: Bounding box detection  ← you are here
 *   Stage 4: Collision avoidance
 *   Stage 5: Render
 *
 * Coordinate system:
 *   All bounding box values are in IMAGE-pixel space (the original exam
 *   image dimensions). The caller (annotationLayout.js) converts to
 *   container-pixel space for rendering.
 *
 * @module boundingBoxDetector
 */

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum safe margin above each bounding box (px in image space). */
const SAFE_MARGIN_TOP = 24

/** Minimum safe margin to the right of each bounding box. */
const SAFE_MARGIN_RIGHT = 40

/** Minimum safe margin below each bounding box. */
const SAFE_MARGIN_BOTTOM = 16

/** Minimum safe margin to the left of each bounding box. */
const SAFE_MARGIN_LEFT = 16

/**
 * Minimum pixel dimension needed to place an annotation.
 * ICON_SIZE(28) + GAP(4) = 32px vertically or horizontally.
 */
const MIN_ANCHOR_SPACE = 32

// ─── Main API ──────────────────────────────────────────────────────────────

/**
 * Formalize bounding boxes from block coordinates.
 *
 * Each block's `blockCoordinates` (from OCR) is treated as the bounding
 * box of the corresponding question. Safe-zone margins are computed and
 * clamped to the image boundaries.
 *
 * @param {Array}  blocks      — block objects with `.blockCoordinates`
 * @param {{width:number, height:number}|null} imageNaturalSize — original image px
 * @returns {Array} — blocks enhanced with `.boundingBox`, `.safeZone`, `.anchorPoints`
 */
export function formalizeBoundingBoxes(blocks, imageNaturalSize) {
  if (!blocks || blocks.length === 0) return []

  const imgW = imageNaturalSize?.width ?? Infinity
  const imgH = imageNaturalSize?.height ?? Infinity

  return blocks.map(block => {
    const coords = block.blockCoordinates || {}
    const x = coords.x ?? 0
    const y = coords.y ?? 0
    const w = coords.width ?? 100
    const h = coords.height ?? 100

    // ── Bounding box (alias for the OCR region) ──
    const boundingBox = { x, y, w, h }

    // ── Safe zone margins (clamped to image bounds) ──
    const margin = {
      top: Math.min(SAFE_MARGIN_TOP, Math.max(0, y)),
      right: Math.min(SAFE_MARGIN_RIGHT, Math.max(0, imgW - (x + w))),
      bottom: Math.min(SAFE_MARGIN_BOTTOM, Math.max(0, imgH - (y + h))),
      left: Math.min(SAFE_MARGIN_LEFT, Math.max(0, x)),
    }

    // ── Safe-zone rectangles (image-pixel space) ──
    const safeZone = {
      above:  margin.top    > 0  ? { x, y: y - margin.top, w, h: margin.top } : null,
      right:  margin.right  > 0  ? { x: x + w, y, w: margin.right, h } : null,
      below:  margin.bottom > 0  ? { x, y: y + h, w, h: margin.bottom } : null,
      left:   margin.left   > 0  ? { x: x - margin.left, y, w: margin.left, h } : null,
    }

    // ── Anchor points (centers of safe zones) ──
    // Use actual available space (distance to image edge) for feasibility,
    // not the safe margin (which caps the desired placement zone).
    const aboveAvailable = y  // pixels from box top to image top
    const rightAvailable = imgW - (x + w)  // pixels from box right to image right
    const anchorPoints = {
      aboveCenter: aboveAvailable >= MIN_ANCHOR_SPACE
        ? { x: x + w / 2, y: y - Math.min(aboveAvailable, 40) / 2 }
        : null,
      rightCenter: rightAvailable >= MIN_ANCHOR_SPACE
        ? { x: x + w + Math.min(rightAvailable, 40) / 2, y: y + h / 2 }
        : null,
    }

    return {
      ...block,
      boundingBox,
      safeZone,
      anchorPoints,
    }
  })
}

// ─── Report ────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable bounding box detection report.
 *
 * @param {Array} blocks — blocks enhanced by formalizeBoundingBoxes()
 * @returns {string}
 */
export function generateBoundingBoxReport(blocks) {
  if (!blocks || blocks.length === 0) {
    return '[BBox] No blocks — skipping bounding box report.'
  }

  const lines = []
  lines.push('')
  lines.push('══════════════════════════════════════════════════')
  lines.push('   Bounding Box Detection Report')
  lines.push('══════════════════════════════════════════════════')
  lines.push('')
  lines.push(`   Total questions:                ${blocks.length}`)
  lines.push('')

  // Per-block details
  lines.push('   ── Bounding Boxes (anchored right) ──')
  for (const block of blocks) {
    const bb = block.boundingBox
    const ap = block.anchorPoints
    if (!bb) {
      lines.push(`     Block #${block.number}: NO BOUNDING BOX`)
      continue
    }

    const rightOk = ap.rightCenter ? '✓' : '✗'

    lines.push(
      `     Block #${String(block.number).padStart(2)}: ` +
      `box=(${bb.x},${bb.y} ${bb.w}×${bb.h}) ` +
      `right=${rightOk}`
    )
  }

  // Summary stats
  lines.push('')
  const rightCount = blocks.filter(b => b.anchorPoints?.rightCenter).length
  const noAnchorCount = blocks.filter(b => !b.anchorPoints?.rightCenter).length

  lines.push('   ── Right-Side Anchor Feasibility ──')
  lines.push(`     Can anchor right:  ${rightCount} / ${blocks.length}`)
  if (noAnchorCount > 0) {
    lines.push(`     ⚠ No right-side space:  ${noAnchorCount} block(s)`)
  }

  lines.push('')
  lines.push(noAnchorCount === 0
    ? '   ✓ All blocks have viable right-side anchor space.'
    : `   ⚠ ${noAnchorCount} block(s) lack sufficient space on the right.`)
  lines.push('══════════════════════════════════════════════════')
  lines.push('')

  return lines.join('\n')
}

// ─── Overlap detection (bounding-box level) ────────────────────────────────

/**
 * Detect which bounding boxes overlap with each other.
 *
 * @param {Array} blocks — blocks enhanced by formalizeBoundingBoxes()
 * @returns {Array<{ blockA, blockB, intersectionArea, overlapRatio }>}
 */
export function detectBoundingBoxOverlaps(blocks) {
  const overlaps = []

  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i].boundingBox
    if (!a) continue

    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j].boundingBox
      if (!b) continue

      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

      if (overlapX > 0 && overlapY > 0) {
        const area = overlapX * overlapY
        const aArea = a.w * a.h
        const bArea = b.w * b.h
        const ratio = Math.min(area / aArea, area / bArea)

        overlaps.push({
          blockA: blocks[i],
          blockB: blocks[j],
          intersectionArea: Math.round(area),
          overlapRatio: Math.round(ratio * 1000) / 1000,
        })
      }
    }
  }

  return overlaps
}
