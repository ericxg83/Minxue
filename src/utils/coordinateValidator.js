/**
 * Coordinate Validation Utility
 * ===============================
 *
 * Validates block annotation coordinates for the Exam Review page.
 * Purpose: prevent stacked/overlapping annotations caused by missing
 * or invalid coordinates. Only annotations with valid coordinates
 * should enter the rendering pipeline.
 *
 * Usage in the rendering pipeline:
 *   blocks (API) → validateAnnotationPipeline() → validBlocks → render
 *                                               ↘ invalidBlocks → filtered out + reported
 *
 * @module coordinateValidator
 */

// ─── ANSI color helpers for console logging ────────────────────────────────
const C = {
  OK: '\x1b[32m',
  WARN: '\x1b[33m',
  ERR: '\x1b[31m',
  INFO: '\x1b[36m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
}

// ─── Individual coordinate validation ──────────────────────────────────────

/**
 * Validate a single block's coordinate object.
 *
 * Checks:
 *  1. Existence — x and y must be present
 *  2. Type — must be finite numbers
 *  3. Bounds — within [0, imageWidth] × [0, imageHeight]
 *
 * @param {object|null|undefined} coords  — { x, y, width?, height? }
 * @param {number}                imgW    — natural image width  (px)
 * @param {number}                imgH    — natural image height (px)
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateCoordinate(coords, imgW, imgH) {
  const issues = []

  if (!coords || typeof coords !== 'object') {
    return { valid: false, issues: ['coordinate object is null/undefined/not-an-object'] }
  }

  // ── Existence check ──
  if (coords.x === undefined || coords.x === null) {
    issues.push('x coordinate is missing')
  }
  if (coords.y === undefined || coords.y === null) {
    issues.push('y coordinate is missing')
  }
  if (issues.length > 0) {
    return { valid: false, issues } // can't do further checks
  }

  // ── Type check ──
  if (typeof coords.x !== 'number' || !Number.isFinite(coords.x)) {
    issues.push(`x coordinate is not a finite number: ${JSON.stringify(coords.x)}`)
  }
  if (typeof coords.y !== 'number' || !Number.isFinite(coords.y)) {
    issues.push(`y coordinate is not a finite number: ${JSON.stringify(coords.y)}`)
  }
  if (coords.width !== undefined && (typeof coords.width !== 'number' || !Number.isFinite(coords.width))) {
    issues.push(`width is not a finite number: ${JSON.stringify(coords.width)}`)
  }
  if (coords.height !== undefined && (typeof coords.height !== 'number' || !Number.isFinite(coords.height))) {
    issues.push(`height is not a finite number: ${JSON.stringify(coords.height)}`)
  }
  if (issues.length > 0) return { valid: false, issues }

  // ── Bounds check ──
  if (coords.x < 0 || coords.x > imgW) {
    issues.push(`x=${coords.x} is out of bounds [0, ${imgW}]`)
  }
  if (coords.y < 0 || coords.y > imgH) {
    issues.push(`y=${coords.y} is out of bounds [0, ${imgH}]`)
  }
  if ((coords.width ?? 0) > 0 && coords.x + coords.width > imgW) {
    issues.push(`x+width (${coords.x + coords.width}) exceeds image width (${imgW})`)
  }
  if ((coords.height ?? 0) > 0 && coords.y + coords.height > imgH) {
    issues.push(`y+height (${coords.y + coords.height}) exceeds image height (${imgH})`)
  }

  // ── Dimension sanity check ──
  // Zero dimensions produce invisible annotations; negative dimensions
  // produce inverted bounding boxes that break overlap detection.
  if (coords.width !== undefined && coords.width !== null && coords.width <= 0) {
    issues.push(coords.width === 0
      ? 'width is zero — annotation would be invisible'
      : `width is negative (${coords.width}) — bounding box would be inverted`)
  }
  if (coords.height !== undefined && coords.height !== null && coords.height <= 0) {
    issues.push(coords.height === 0
      ? 'height is zero — annotation would be invisible'
      : `height is negative (${coords.height}) — bounding box would be inverted`)
  }

  return { valid: issues.length === 0, issues }
}

// ─── Batch validation ──────────────────────────────────────────────────────

/**
 * Validate all blocks against image dimensions.
 * Logs per-block results to the console with colour-coded messages.
 *
 * @param {Array}   blocks — array of block objects with `.blockCoordinates`
 * @param {number}  imgW   — natural image width
 * @param {number}  imgH   — natural image height
 * @returns {{
 *   total:              number,
 *   validBlocks:        object[],
 *   invalidBlocks:      object[],
 *   missing:            object[],
 *   outOfBounds:        object[],
 *   overlappingGroups:  Array<{ blockA, blockB, intersectionArea, overlapRatio }>,
 *   validCount:         number,
 *   missingCount:       number,
 *   outOfBoundsCount:   number,
 *   overlappingCount:   number,
 * }}
 */
export function validateAllBlocks(blocks, imgW, imgH) {
  const validBlocks = []
  const invalidBlocks = []
  const missing = []
  const outOfBounds = []

  console.group(`${C.BOLD}${C.INFO}[Coordinate Validation]${C.RESET} ${C.BOLD}Validating ${blocks.length} block(s) against ${imgW}×${imgH} image${C.RESET}`)

  for (const block of blocks) {
    const coords = block.blockCoordinates
    const label = `Block #${block.number} (${block.id})`

    // Quick existence check before full validation
    if (!coords || coords.x === undefined || coords.x === null || coords.y === undefined || coords.y === null) {
      console.warn(
        `${C.WARN}⚠ ${label}: MISSING coordinates${C.RESET}` +
        (coords ? ` — x=${JSON.stringify(coords.x)}, y=${JSON.stringify(coords.y)}` : ' — blockCoordinates is null/undefined')
      )
      invalidBlocks.push(block)
      missing.push(block)
      continue
    }

    const result = validateCoordinate(coords, imgW, imgH)

    if (result.valid) {
      console.log(
        `${C.OK}✓ ${label}: (x=${coords.x}, y=${coords.y}, w=${coords.width}, h=${coords.height})${C.RESET}`
      )
      validBlocks.push(block)
    } else {
      console.warn(
        `${C.ERR}✗ ${label}: INVALID — ${result.issues.join('; ')}${C.RESET}`
      )
      invalidBlocks.push(block)
      if (result.issues.some(i => i.includes('out of bounds') || i.includes('exceeds'))) {
        outOfBounds.push(block)
      }
      if (result.issues.some(i => i.includes('missing'))) {
        missing.push(block)
      }
    }
  }

  console.groupEnd()

  // ── Overlap detection among valid blocks ──
  const overlappingGroups = detectOverlaps(validBlocks)

  return {
    total: blocks.length,
    validBlocks,
    invalidBlocks,
    missing,
    outOfBounds,
    overlappingGroups,
    validCount: validBlocks.length,
    missingCount: missing.length,
    outOfBoundsCount: outOfBounds.length,
    overlappingCount: overlappingGroups.length,
  }
}

// ─── Overlap detection ─────────────────────────────────────────────────────

/**
 * Detect overlapping block rectangles.
 * Two blocks overlap when their bounding boxes intersect.
 *
 * @param {object[]} blocks — valid blocks with .blockCoordinates
 * @returns {Array<{ blockA, blockB, intersectionArea: number, overlapRatio: number }>}
 */
export function detectOverlaps(blocks) {
  const overlapping = []

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i].blockCoordinates
      const b = blocks[j].blockCoordinates
      if (!a || !b) continue

      const aLeft = a.x
      const aRight = a.x + (a.width || 0)
      const aTop = a.y
      const aBottom = a.y + (a.height || 0)

      const bLeft = b.x
      const bRight = b.x + (b.width || 0)
      const bTop = b.y
      const bBottom = b.y + (b.height || 0)

      const overlapX = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft))
      const overlapY = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop))

      if (overlapX > 0 && overlapY > 0) {
        const area = overlapX * overlapY
        const aArea = (a.width || 1) * (a.height || 1)
        const bArea = (b.width || 1) * (b.height || 1)
        const overlapRatio = Math.min(area / aArea, area / bArea)

        overlapping.push({
          blockA: blocks[i],
          blockB: blocks[j],
          intersectionArea: Math.round(area),
          overlapRatio: Math.round(overlapRatio * 1000) / 1000,
        })
      }
    }
  }

  // Log any overlaps found
  if (overlapping.length > 0) {
    console.group(`${C.BOLD}${C.WARN}[Overlap Detection]${C.RESET} ${C.WARN}${overlapping.length} overlapping pair(s)${C.RESET}`)
    for (const ov of overlapping) {
      console.warn(
        `${C.WARN}↔ Block #${ov.blockA.number} × Block #${ov.blockB.number}: ` +
        `intersection=${ov.intersectionArea}px², overlap ratio=${(ov.overlapRatio * 100).toFixed(1)}%${C.RESET}`
      )
    }
    console.groupEnd()
  } else {
    console.log(`${C.OK}[Overlap Detection] No overlapping blocks detected${C.RESET}`)
  }

  return overlapping
}

// ─── Report generation ─────────────────────────────────────────────────────

/**
 * Generate a human-readable validation report string (no ANSI codes, safe for file output).
 *
 * @param {object} v — result object from validateAllBlocks()
 * @returns {string}
 */
export function generateReport(v) {
  const sep = '══════════════════════════════════════════════════'
  const lines = [
    '',
    sep,
    '   Annotation Coordinate Validation Report',
    sep,
    '',
    `   Total annotations:       ${v.total}`,
    `   Valid coordinates:       ${v.validCount}`,
    `   Missing coordinates:     ${v.missingCount}`,
    `   Out-of-bounds:           ${v.outOfBoundsCount}`,
    `   Overlapping groups:      ${v.overlappingCount}`,
    '',
  ]

  if (v.missing.length > 0) {
    lines.push('   ── Missing Coordinates ──')
    for (const b of v.missing) {
      lines.push(`     Block #${b.number} (${b.id})`)
    }
    lines.push('')
  }

  if (v.outOfBounds.length > 0) {
    lines.push('   ── Out-of-Bounds ──')
    for (const b of v.outOfBounds) {
      const c = b.blockCoordinates
      lines.push(`     Block #${b.number}: x=${c?.x}, y=${c?.y}, w=${c?.width}, h=${c?.height}`)
    }
    lines.push('')
  }

  if (v.overlappingGroups.length > 0) {
    lines.push('   ── Overlapping Groups ──')
    for (const ov of v.overlappingGroups) {
      lines.push(
        `     Block #${ov.blockA.number} ↔ Block #${ov.blockB.number}  ` +
        `(intersection: ${ov.intersectionArea}px², ${(ov.overlapRatio * 100).toFixed(1)}% ratio)`
      )
    }
    lines.push('')
  }

  const allClean = v.missingCount === 0 && v.outOfBoundsCount === 0 && v.overlappingCount === 0
  lines.push(allClean
    ? '   ✓ All annotations valid — no stacking risk.'
    : `   ⚠ ${v.missingCount + v.outOfBoundsCount + v.overlappingCount} issue(s) found — see above.`
  )
  lines.push(sep)
  lines.push('')

  return lines.join('\n')
}

// ─── Full pipeline ─────────────────────────────────────────────────────────

/**
 * Run the complete annotation validation pipeline.
 *
 * Stages:
 *   1. Check input availability (blocks + image dimensions)
 *   2. Validate each block's coordinates (existence → type → bounds)
 *   3. Detect overlapping block regions
 *   4. Generate and log a human-readable report
 *   5. Return filtered results for the renderer
 *
 * @param {Array}         blocks           — block objects from API
 * @param {{width,height}}|null imageNaturalSize — natural image dimensions
 * @returns {{ validBlocks: object[], invalidBlocks: object[], report: string }}
 */
export function validateAnnotationPipeline(blocks, imageNaturalSize) {
  console.log(`${C.BOLD}${C.INFO}════════════════════════════════════════════════════${C.RESET}`)
  console.log(`${C.BOLD}${C.INFO}   Annotation Coordinate Validation Pipeline${C.RESET}`)
  console.log(`${C.BOLD}${C.INFO}════════════════════════════════════════════════════${C.RESET}`)

  if (!blocks || blocks.length === 0) {
    console.warn(`${C.WARN}[Pipeline] No blocks to validate${C.RESET}`)
    return { validBlocks: [], invalidBlocks: [], report: 'No blocks to validate.' }
  }

  if (!imageNaturalSize) {
    console.log(`${C.INFO}[Pipeline] Image not yet loaded — deferring validation${C.RESET}`)
    // Can't validate bounds without image dimensions. Assume valid for now.
    return { validBlocks: blocks, invalidBlocks: [], report: 'Image not loaded — bounds validation deferred.' }
  }

  const { width: imgW, height: imgH } = imageNaturalSize
  console.log(`${C.INFO}[Pipeline] Image dimensions: ${imgW} × ${imgH}px${C.RESET}`)
  console.log(`${C.INFO}[Pipeline] Processing ${blocks.length} annotation(s)...${C.RESET}`)

  const result = validateAllBlocks(blocks, imgW, imgH)
  const report = generateReport(result)

  // Print the report to console
  console.log(report)

  // Critical warning for any invalid blocks
  if (result.invalidBlocks.length > 0) {
    console.warn(
      `${C.ERR}${C.BOLD}[Pipeline] FILTERING OUT ${result.invalidBlocks.length} invalid block(s)${C.RESET}`,
      `${C.ERR}They will NOT be rendered to prevent coordinate stacking / overlapping.${C.RESET}`
    )
  }

  return {
    validBlocks: result.validBlocks,
    invalidBlocks: result.invalidBlocks,
    report,
  }
}
