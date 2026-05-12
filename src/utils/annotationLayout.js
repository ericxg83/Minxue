/**
 * Annotation Layout Engine — Right-Side Anchoring
 * =================================================
 *
 * Computes collision-free positions for annotation icons/labels on the
 * exam review image. All annotations are anchored to the RIGHT of their
 * question bounding box so they never cover question text or diagrams.
 *
 * Strategy: Right-Side Anchoring + Vertical-Only Cascade
 *   Icons are placed to the right of each question block. When source
 *   block coordinates overlap, items keep their right-side X position
 *   and cascade downward in 32px steps to eliminate rectangle overlap.
 *   This is deterministic — the same input always produces the same
 *   layout — and responsive because positions are recalculated whenever
 *   the container resizes.
 *
 * Coordinate system:
 *   All positions are computed in container-pixel space. The caller
 *   converts back to percentage or CSS pixel values as needed.
 *
 * @module annotationLayout
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const ICON_SIZE = 28
const LABEL_HEIGHT = 20
const GAP = 4
const STAGGER = ICON_SIZE + GAP // 32px — vertical step for each cascade level

// ─── Rectangle helpers ─────────────────────────────────────────────────────

/**
 * Check if two axis-aligned rectangles overlap.
 * @param {{x,y,w,h}} a
 * @param {{x,y,w,h}} b
 * @param {number} padding — extra exclusion margin around each rect
 * @returns {boolean}
 */
function rectsOverlap(a, b, padding = 0) {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  )
}

/**
 * Compute the intersection area and overlap ratio of two rectangles.
 * @returns {{ overlapArea: number, ratio: number, severity: string }}
 */
export function assessOverlap(a, b) {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  if (ox <= 0 || oy <= 0) {
    return { overlapArea: 0, ratio: 0, severity: 'none' }
  }
  const area = ox * oy
  const aArea = a.w * a.h
  const bArea = b.w * b.h
  const ratio = Math.min(area / aArea, area / bArea)

  let severity = 'mild'
  if (ratio > 0.7) severity = 'stacked'
  else if (ratio > 0.3) severity = 'heavy'

  return { overlapArea: Math.round(area), ratio: Math.round(ratio * 1000) / 1000, severity }
}

// ─── Position computation ──────────────────────────────────────────────────

/**
 * Convert a block's percentage style-* string values to a pixel rect.
 * @param {{left:string,top:string,width:string,height:string}} style — from getBlockStyle()
 * @param {number} contW — container width in CSS px
 * @param {number} contH — container height in CSS px
 * @returns {{x:number, y:number, w:number, h:number}}
 */
function styleToPixelRect(style, contW, contH) {
  return {
    x: (parseFloat(style.left) || 0) / 100 * contW,
    y: (parseFloat(style.top) || 0) / 100 * contH,
    w: (parseFloat(style.width) || 0) / 100 * contW,
    h: (parseFloat(style.height) || 0) / 100 * contH,
  }
}

/**
 * Compute the ideal icon rect in container-pixel space.
 *
 * Icon is anchored to the RIGHT of the block's bounding box,
 * vertically centred. This keeps annotations outside question
 * content so they never cover text or diagrams.
 *
 * @returns {{x:number, y:number, w:number, h:number}}
 */
function computeIconRect(style, contW, contH) {
  const b = styleToPixelRect(style, contW, contH)
  return {
    x: b.x + b.w + GAP,
    y: b.y + b.h / 2 - ICON_SIZE / 2,
    w: ICON_SIZE,
    h: ICON_SIZE,
  }
}

/**
 * Compute the ideal number-label rect in container-pixel space.
 *
 * Label sits to the right of the icon (anchored right of the block),
 * vertically aligned with the icon.
 *
 * @returns {{x:number, y:number, w:number, h:number}}
 */
function computeLabelRect(style, contW, contH, number) {
  const icon = computeIconRect(style, contW, contH)
  const w = Math.max(20, String(number).length * 9 + 12)
  return {
    x: icon.x + ICON_SIZE + GAP,
    y: icon.y + (ICON_SIZE - LABEL_HEIGHT) / 2,
    w,
    h: LABEL_HEIGHT,
  }
}

// ─── Collision detection ───────────────────────────────────────────────────

/**
 * Build connected components of overlapping items.
 * @param {Array<{index:number, rect:{x,y,w,h}}>} items
 * @param {number} padding — extra exclusion margin
 * @returns {number[][]} — array of groups, each group is an array of item indices
 */
function findOverlapGroups(items, padding = 0) {
  const n = items.length
  const adj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(items[i].rect, items[j].rect, padding)) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }

  const visited = new Set()
  const groups = []
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue
    const group = []
    const stack = [i]
    while (stack.length) {
      const idx = stack.pop()
      if (visited.has(idx)) continue
      visited.add(idx)
      group.push(idx)
      for (const nb of adj[idx]) {
        if (!visited.has(nb)) stack.push(nb)
      }
    }
    groups.push(group)
  }
  return groups
}

// ─── Collision resolution ──────────────────────────────────────────────────

/**
 * Resolve collisions within a single connected group using vertical-only
 * staggered cascade.
 *
 * Algorithm:
 *   1. Sort items by ideal Y position.
 *   2. Place the first item at its ideal position.
 *   3. For each subsequent item, scan downward in STAGGER-sized steps
 *      until a non-overlapping Y is found.
 *
 * X positions are NEVER adjusted — annotations stay on the right side
 * of their bounding boxes at all times. Only vertical staggering is
 * allowed to separate overlapping items.
 *
 * Modifies each item in-place, adding:
 *   adjustedX, adjustedY, offsetX, offsetY
 *
 * @param {Array} items — array of { index, rect, ... }
 */
function resolveGroupCollisions(items) {
  // Sort by original Y
  items.sort((a, b) => a.rect.y - b.rect.y)

  const placedRects = []

  for (const item of items) {
    let bestY = item.rect.y
    let attempts = 0

    // Vertical stagger only — X is fixed (right-side anchoring)
    while (attempts < 50) {
      const candidate = { x: item.rect.x, y: bestY, w: item.rect.w, h: item.rect.h }
      if (!placedRects.some(r => rectsOverlap(candidate, r, 2))) break
      bestY += STAGGER
      attempts++
    }

    item.adjustedX = Math.round(item.rect.x) // Fixed — never offset horizontally
    item.adjustedY = Math.round(bestY)
    item.offsetX = 0 // Always zero — annotations stay on the right
    item.offsetY = Math.round(bestY - item.rect.y)

    placedRects.push({ x: item.rect.x, y: bestY, w: item.rect.w, h: item.rect.h })
  }
}

// ─── Main API ──────────────────────────────────────────────────────────────

/**
 * Compute collision-free layout for all annotation icons.
 *
 * All annotations are anchored to the RIGHT of their question bounding
 * box — this keeps icons and labels outside question content.
 * Vertical-only collision avoidance staggers overlapping items.
 *
 * @param {Array} blocks           — validated block objects
 * @param {Function} getBlockStyle — (block) => {left%, top%, width%, height%}
 * @param {{width:number, height:number}} containerSize — container CSS px
 * @returns {{
 *   annotations: Array<{
 *     block,
 *     icon: { idealX, idealY, w, h, adjustedX, adjustedY, offsetX, offsetY },
 *     label: { idealX, idealY, w, h, adjustedX, adjustedY, offsetX, offsetY },
 *     severity: string,
 *     overlapping: boolean,
 *   }>,
 *   groups: number[][],
 *   stats: { totalAnnotations, overlappingCount, mildCount, heavyCount, stackedCount } | null,
 *   debug: { guideLines: Array<{x1,y1,x2,y2}>, severityColors: string[] },
 * }}
 */
export function computeAnnotationLayout(blocks, getBlockStyle, containerSize) {
  const contW = containerSize?.width || 0
  const contH = containerSize?.height || 0

  // Guard: no blocks or container not yet measured
  if (!blocks.length || !contW) {
    return {
      annotations: [],
      groups: [],
      stats: null,
      debug: { guideLines: [], severityColors: [] },
    }
  }

  // ── Step 1: Compute ideal icon rects for every block ──────────────────
  // All icons anchored to the RIGHT of their bounding box.
  const iconItems = blocks.map((block, i) => {
    const style = getBlockStyle(block)
    const rect = computeIconRect(style, contW, contH)
    const labelRect = computeLabelRect(style, contW, contH, block.number)
    return { index: i, rect, labelRect, block }
  })

  // ── Step 2: Find connected groups of overlapping icons ────────────────
  const overlapGroups = findOverlapGroups(iconItems, 2)

  // ── Step 3: Resolve collisions per group (vertical-only stagger) ──────
  const adjustments = new Map() // index → { adjustedX, adjustedY, offsetX, offsetY }

  for (const group of overlapGroups) {
    if (group.length <= 1) continue
    const groupItems = group.map(idx => ({ ...iconItems[idx] }))
    resolveGroupCollisions(groupItems)
    for (const item of groupItems) {
      adjustments.set(item.index, {
        adjustedX: item.adjustedX,
        adjustedY: item.adjustedY,
        offsetX: item.offsetX,
        offsetY: item.offsetY,
      })
    }
  }

  // ── Step 4: Build annotation rows + assess severity ───────────────────
  const annotations = blocks.map((block, i) => {
    const item = iconItems[i]
    const iconRect = item.rect
    const labelRect = item.labelRect
    const adj = adjustments.get(i)

    // Assess overlap severity against ALL other icons
    let maxSeverity = 'none'
    for (let j = 0; j < iconItems.length; j++) {
      if (i === j) continue
      const { severity } = assessOverlap(iconRect, iconItems[j].rect)
      if (severity !== 'none') {
        const rank = { none: 0, mild: 1, heavy: 2, stacked: 3 }
        if (rank[severity] > (rank[maxSeverity] || 0)) {
          maxSeverity = severity
        }
      }
    }

    const isOverlapping = maxSeverity !== 'none'

    return {
      block,
      icon: {
        idealX: Math.round(iconRect.x),
        idealY: Math.round(iconRect.y),
        w: ICON_SIZE,
        h: ICON_SIZE,
        adjustedX: adj ? adj.adjustedX : Math.round(iconRect.x),
        adjustedY: adj ? adj.adjustedY : Math.round(iconRect.y),
        offsetX: adj ? adj.offsetX : 0,
        offsetY: adj ? adj.offsetY : 0,
      },
      label: {
        idealX: Math.round(labelRect.x),
        idealY: Math.round(labelRect.y),
        w: Math.round(labelRect.w),
        h: LABEL_HEIGHT,
        adjustedX: Math.round(labelRect.x),
        adjustedY: Math.round(labelRect.y),
        offsetX: 0,
        offsetY: 0,
      },
      severity: maxSeverity,
      overlapping: isOverlapping,
    }
  })

  // ── Step 5: Compute stats ─────────────────────────────────────────────
  const stats = {
    totalAnnotations: blocks.length,
    overlappingCount: annotations.filter(a => a.overlapping).length,
    mildCount: annotations.filter(a => a.severity === 'mild').length,
    heavyCount: annotations.filter(a => a.severity === 'heavy').length,
    stackedCount: annotations.filter(a => a.severity === 'stacked').length,
  }

  // ── Step 6: Build debug data ──────────────────────────────────────────
  const guideLines = []
  const severityColors = []
  for (const ann of annotations) {
    const cx = ann.icon.idealX + ann.icon.w / 2
    const cy = ann.icon.idealY + ann.icon.h / 2
    if (ann.overlapping) {
      guideLines.push({
        x1: cx,
        y1: cy,
        x2: ann.icon.adjustedX + ann.icon.w / 2,
        y2: ann.icon.adjustedY + ann.icon.h / 2,
      })
    }
    severityColors.push(
      ann.severity === 'none' ? '#22c55e'   // green — no issue
      : ann.severity === 'mild' ? '#eab308'  // yellow — mild
      : ann.severity === 'heavy' ? '#f97316' // orange — heavy
      : '#ef4444'                             // red — fully stacked
    )
  }

  return {
    annotations,
    groups: overlapGroups.filter(g => g.length > 1),
    stats,
    debug: { guideLines, severityColors },
  }
}

/**
 * Convert pixel offset values into a CSS transform string.
 * Combines with the existing `translateY(-50%)` for vertical centring.
 *
 * @param {number} offsetX — pixels to shift right
 * @param {number} offsetY — pixels to shift down
 * @returns {string} — e.g. "translateY(-50%) translate(0px,32px)"
 */
export function iconTransformString(offsetX = 0, offsetY = 0) {
  return `translateY(-50%) translate(${offsetX}px, ${offsetY}px)`
}
