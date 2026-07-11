/**
 * TikZ 矢量图生成器
 * 将 AI 识别的 graphParams/tikzCode 转换为可渲染的 SVG
 * 
 * 核心原则：
 * 1. 有原图（局部截图）→ 必须显示原图，永不丢弃
 * 2. TikZ/SVG 只是附加信息（显示在原图下方），不可替代原图
 * 3. 空白坐标系毫无价值，绝不生成
 * 4. 没有原图时才尝试显示 TikZ 生成的 SVG
 * 5. 错误图形比原图更有害 — 至少原图是真实的
 */

/**
 * 将 TikZ 代码转换为 SVG 字符串（简化转换器）
 * 支持常见的 TikZ 命令：draw, node, coordinate, plot, circle, rectangle,
 * pic (angle/right angle), arc, tkzMarkAngle, tkzMarkRightAngle, fill, path
 *
 * @param {string} tikzCode - TikZ代码
 * @param {boolean} strict - 严格模式：只返回有实质内容的SVG，空白坐标系返回null
 */
export function tikzToSvg(tikzCode, strict = false) {
  if (!tikzCode) return null

  try {
    // 清理 TikZ 代码
    const cleanCode = tikzCode
      .replace(/\\begin\{tikzpicture\}.*?\[/, '')
      .replace(/\\end\{tikzpicture\}/, '')
      .replace(/\\begin\{tikzpicture\}/, '')

    // 提取 scale
    const scaleMatch = cleanCode.match(/scale=(\d+\.?\d*)/)
    const tikzScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1

    // 提取坐标点
    const coordRegex = /\\coordinate\s*\(?(\w+)\)?\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
    const coordinates = []
    let match
    while ((match = coordRegex.exec(cleanCode)) !== null) {
      coordinates.push({ name: match[1], x: parseFloat(match[2]), y: parseFloat(match[3]) })
    }

    // 提取所有被引用的坐标名（A/B/C/D等）并推断其位置
    const inferMissingCoords = () => {
      // 从 \node at (x,y) 语句中提取隐式坐标
      const implicitCoordRegex = /\\node.*?at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\{(\w+)\}/g
      while ((match = implicitCoordRegex.exec(cleanCode)) !== null) {
        const name = match[3]
        const x = parseFloat(match[1]), y = parseFloat(match[2])
        if (!coordinates.find(c => c.name === name)) {
          coordinates.push({ name, x, y })
        }
      }
    }
    inferMissingCoords()

    const svgElements = []
    const svgWidth = 380
    const svgHeight = 280
    let hasSubstantialContent = false

    // 坐标转换函数
    const scale = coordinates.length > 0
      ? (() => {
          const xs = coordinates.map(c => c.x)
          const ys = coordinates.map(c => c.y)
          const minX = Math.min(...xs), maxX = Math.max(...xs)
          const minY = Math.min(...ys), maxY = Math.max(...ys)
          const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
          return Math.min(svgWidth / (rangeX * 1.8), svgHeight / (rangeY * 1.8)) * tikzScale
        })()
      : 40 * tikzScale

    const offsetX = coordinates.length > 0
      ? svgWidth / 2 - (Math.min(...coordinates.map(c => c.x)) + Math.max(...coordinates.map(c => c.x))) / 2 * scale
      : svgWidth / 2
    const offsetY = coordinates.length > 0
      ? svgHeight / 2 + (Math.min(...coordinates.map(c => c.y)) + Math.max(...coordinates.map(c => c.y))) / 2 * scale
      : svgHeight / 2

    const toSvgX = (x) => x * scale + offsetX
    const toSvgY = (y) => -y * scale + offsetY

    const findCoord = (name) => coordinates.find(c => c.name === name)

    // 解析样式属性
    const parseStyle = (styleStr) => {
      const s = styleStr || ''
      return {
        strokeColor: s.includes('red') ? '#DC2626' : s.includes('blue') ? '#3B82F6' : '#333',
        strokeWidth: s.includes('thick') ? '2' : s.includes('ultra thick') ? '2.5' : s.includes('very thick') ? '2' : '1.5',
        dash: s.includes('dashed') ? 'stroke-dasharray="6,3"' : s.includes('dotted') ? 'stroke-dasharray="2,3"' : s.includes('dash pattern') ? 'stroke-dasharray="3,2"' : '',
        fill: s.includes('fill') ? (s.includes('gray!') || s.includes('lightgray') ? '#E5E7EB' : '#F3F4F6') : null,
        opacity: s.includes('opacity=') ? parseFloat(s.match(/opacity=([\d.]+)/)?.[1] || '1') : 1
      }
    }

    // ── 1. 绝对坐标线条 ──
    // \draw (x1,y1) -- (x2,y2); 或 \draw (x1,y1) -- (x2,y2) -- (x3,y3) -- cycle;
    const absDrawRegex = /\\draw(?:\[([^\]]*)\])?\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)\s*((?:--\s*\(-?[\d.]+\s*,\s*-?[\d.]+\)\s*)*)(?:--\s*cycle)?\s*;/g
    while ((match = absDrawRegex.exec(cleanCode)) !== null) {
      const style = match[1] || ''
      const styleInfo = parseStyle(style)
      const startX = parseFloat(match[2]), startY = parseFloat(match[3])
      const remaining = match[4]

      // 解析所有后续点
      const points = [[startX, startY]]
      const segmentRegex = /--\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)/g
      let segMatch
      while ((segMatch = segmentRegex.exec(remaining)) !== null) {
        points.push([parseFloat(segMatch[1]), parseFloat(segMatch[2])])
      }

      if (points.length >= 2) {
        hasSubstantialContent = true
        for (let i = 0; i < points.length - 1; i++) {
          const x1 = toSvgX(points[i][0]), y1 = toSvgY(points[i][1])
          const x2 = toSvgX(points[i+1][0]), y2 = toSvgY(points[i+1][1])
          svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
        }
        // 如果包含 cycle，闭合路径
        const fullMatch = match[0]
        if (fullMatch.includes('-- cycle')) {
          const x1 = toSvgX(points[points.length-1][0]), y1 = toSvgY(points[points.length-1][1])
          const x2 = toSvgX(points[0][0]), y2 = toSvgY(points[0][1])
          svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
        }
      }
    }

    // ── 2. 命名坐标线条（原逻辑增强：支持多段线和cycle）──
    const drawLineRegex = /\\draw(?:\[([^\]]*)\])?\s*\((\w+)\)\s*((?:--\s*\((\w+)\)\s*)*)(?:--\s*cycle)?/g
    while ((match = drawLineRegex.exec(cleanCode)) !== null) {
      const style = match[1] || ''
      const styleInfo = parseStyle(style)
      const startName = match[2]
      const midPart = match[0]

      // 收集所有命名的点
      const namedPoints = [startName]
      const nameRegex = /--\s*\((\w+)\)/g
      let nMatch
      while ((nMatch = nameRegex.exec(midPart)) !== null) {
        namedPoints.push(nMatch[1])
      }

      if (namedPoints.length >= 2) {
        const firstCoord = findCoord(namedPoints[0])
        if (!firstCoord) continue
        hasSubstantialContent = true

        for (let i = 0; i < namedPoints.length - 1; i++) {
          const from = findCoord(namedPoints[i])
          const to = findCoord(namedPoints[i + 1])
          if (from && to) {
            const x1 = toSvgX(from.x), y1 = toSvgY(from.y)
            const x2 = toSvgX(to.x), y2 = toSvgY(to.y)
            svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
          }
        }
        if (midPart.includes('-- cycle') && namedPoints.length > 1) {
          const from = findCoord(namedPoints[namedPoints.length - 1])
          const to = findCoord(namedPoints[0])
          if (from && to) {
            svgElements.push(`<line x1="${toSvgX(from.x).toFixed(1)}" y1="${toSvgY(from.y).toFixed(1)}" x2="${toSvgX(to.x).toFixed(1)}" y2="${toSvgY(to.y).toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
          }
        }
      }
    }

    // 兼容旧格式：简单的 named-from -- named-to
    const simpleLineRegex = /\\draw(?:\[([^\]]*)\])?\s*\((\w+)\)\s*--\s*\((\w+)\)/g
    while ((match = simpleLineRegex.exec(cleanCode)) !== null) {
      // 避免重复（已被上面新的 drawLineRegex 捕获）
      if (match[0].includes('--') && !match[0].match(/\((\w+)\)\s*--\s*\((\w+)\)\s*--/)) {
        const style = match[1] || ''
        const styleInfo = parseStyle(style)
        const from = findCoord(match[2]), to = findCoord(match[3])
        if (from && to) {
          hasSubstantialContent = true
          const x1 = toSvgX(from.x), y1 = toSvgY(from.y)
          const x2 = toSvgX(to.x), y2 = toSvgY(to.y)
          svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
        }
      }
    }

    // ── 3. 节点/标签 ──
    const nodeRegex = /\\node(?:\[([^\]]*)\])?\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\{([^}]+)\}/g
    while ((match = nodeRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const x = toSvgX(parseFloat(match[2]))
      const y = toSvgY(parseFloat(match[3]))
      const text = match[4].replace(/\\\$/g, '').replace(/\\text\{([^}]*)\}/g, '$1')
      const pos = match[1] || ''
      const anchor = getAnchorFromPos(pos)
      svgElements.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor.x}" dominant-baseline="${anchor.y}" font-size="13" fill="#1F2937">${text}</text>`)
    }

    // ── 4. 直角标记（rectangle）──
    const rightAngleRegex = /\\draw\s*\(([-\d.]+),([-\d.]+)\)\s*rectangle\s*\(([-\d.]+),([-\d.]+)\)/g
    while ((match = rightAngleRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const x1 = toSvgX(parseFloat(match[1])), y1 = toSvgY(parseFloat(match[2]))
      const x2 = toSvgX(parseFloat(match[3])), y2 = toSvgY(parseFloat(match[4]))
      svgElements.push(`<rect x="${Math.min(x1,x2).toFixed(1)}" y="${Math.min(y1,y2).toFixed(1)}" width="${Math.abs(x2-x1).toFixed(1)}" height="${Math.abs(y2-y1).toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
    }

    // ── 5. 圆弧（arc）──
    // \draw (x,y) arc[start angle=..., end angle=..., radius=...];
    // \draw (x,y) arc (start:end:radius);
    const arcRegex = /\\draw(?:\[([^\]]*)\])?\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)\s*arc\s*\[?start\s*angle\s*=\s*(-?[\d.]+)\s*,\s*end\s*angle\s*=\s*(-?[\d.]+)\s*,\s*radius\s*=\s*([\d.]+)\s*cm?\]?/g
    while ((match = arcRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const cx = toSvgX(parseFloat(match[2])), cy = toSvgY(parseFloat(match[3]))
      const startAngle = parseFloat(match[4]), endAngle = parseFloat(match[5])
      const radius = parseFloat(match[6]) * scale
      const startRad = startAngle * Math.PI / 180, endRad = endAngle * Math.PI / 180
      const sx = cx + radius * Math.cos(startRad), sy = cy - radius * Math.sin(startRad)
      const ex = cx + radius * Math.cos(endRad), ey = cy - radius * Math.sin(endRad)
      const largeArc = (endAngle - startAngle) > 180 ? 1 : 0
      const style = match[1] || ''
      const styleInfo = parseStyle(style)
      svgElements.push(`<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${largeArc} 0 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}"/>`)
    }

    // ── 6. \pic 角度标记 ──
    // \pic[draw, angle radius=0.5cm] {angle = A--B--C};
    const picAngleRegex = /\\pic(?:\[([^\]]*)\])?\s*\{angle\s*=\s*(\w+)\s*--\s*(\w+)\s*--\s*(\w+)\s*\}/g
    while ((match = picAngleRegex.exec(cleanCode)) !== null) {
      const style = match[1] || ''
      const radiusMatch = style.match(/angle\s*radius\s*=\s*([\d.]+)/)
      const picRadius = radiusMatch ? parseFloat(radiusMatch[1]) : 0.5
      const vertex = findCoord(match[3])
      const arm1 = findCoord(match[2]), arm2 = findCoord(match[4])
      if (vertex && arm1 && arm2) {
        hasSubstantialContent = true
        // 计算两条边的角度
        const vx = vertex.x, vy = vertex.y
        const a1x = arm1.x - vx, a1y = arm1.y - vy
        const a2x = arm2.x - vx, a2y = arm2.y - vy
        const angle1 = Math.atan2(a1y, a1x) * 180 / Math.PI
        const angle2 = Math.atan2(a2y, a2x) * 180 / Math.PI
        const r = picRadius * scale
        const startA = Math.min(angle1, angle2), endA = Math.max(angle1, angle2)
        const largeArc = (endA - startA) > 180 ? 1 : 0
        const sx = toSvgX(vx) + r * Math.cos(startA * Math.PI / 180)
        const sy = toSvgY(vy) - r * Math.sin(startA * Math.PI / 180)
        const ex = toSvgX(vx) + r * Math.cos(endA * Math.PI / 180)
        const ey = toSvgY(vy) - r * Math.sin(endA * Math.PI / 180)
        svgElements.push(`<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} 0 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
      }
    }

    // \pic[draw] {right angle = A--B--C};
    const picRightAngleRegex = /\\pic(?:\[([^\]]*)\])?\s*\{right\s*angle\s*=\s*(\w+)\s*--\s*(\w+)\s*--\s*(\w+)\s*\}/g
    while ((match = picRightAngleRegex.exec(cleanCode)) !== null) {
      const vertex = findCoord(match[3])
      const arm1 = findCoord(match[2]), arm2 = findCoord(match[4])
      if (vertex && arm1 && arm2) {
        hasSubstantialContent = true
        const r = 0.3 * scale
        // 沿两条边方向偏移 r 距离
        const len1 = Math.sqrt((arm1.x - vertex.x)**2 + (arm1.y - vertex.y)**2) || 1
        const len2 = Math.sqrt((arm2.x - vertex.x)**2 + (arm2.y - vertex.y)**2) || 1
        const ux1 = (arm1.x - vertex.x) / len1, uy1 = (arm1.y - vertex.y) / len1
        const ux2 = (arm2.x - vertex.x) / len2, uy2 = (arm2.y - vertex.y) / len2
        const p1x = toSvgX(vertex.x + ux1 * r / scale), p1y = toSvgY(vertex.y + uy1 * r / scale)
        const p2x = toSvgX(vertex.x + ux1 * r / scale + ux2 * r / scale), p2y = toSvgY(vertex.y + uy1 * r / scale + uy2 * r / scale)
        const p3x = toSvgX(vertex.x + ux2 * r / scale), p3y = toSvgY(vertex.y + uy2 * r / scale)
        svgElements.push(`<polyline points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
      }
    }

    // ── 7. \tkzMarkAngle ──
    // \tkzMarkAngle[size=0.5](A,B,C)
    const tkzAngleRegex = /\\tkzMarkAngle(?:\[([^\]]*)\])?\s*\((\w+)\s*,\s*(\w+)\s*,\s*(\w+)\)/g
    while ((match = tkzAngleRegex.exec(cleanCode)) !== null) {
      const style = match[1] || ''
      const sizeMatch = style.match(/size\s*=\s*([\d.]+)/)
      const tkzRadius = sizeMatch ? parseFloat(sizeMatch[1]) : 0.5
      const vertex = findCoord(match[3])
      const arm1 = findCoord(match[2]), arm2 = findCoord(match[4])
      if (vertex && arm1 && arm2) {
        hasSubstantialContent = true
        const vx = vertex.x, vy = vertex.y
        const a1x = arm1.x - vx, a1y = arm1.y - vy
        const a2x = arm2.x - vx, a2y = arm2.y - vy
        const angle1 = Math.atan2(a1y, a1x) * 180 / Math.PI
        const angle2 = Math.atan2(a2y, a2x) * 180 / Math.PI
        const r = tkzRadius * scale
        const startA = Math.min(angle1, angle2), endA = Math.max(angle1, angle2)
        const largeArc = (endA - startA) > 180 ? 1 : 0
        const sx = toSvgX(vx) + r * Math.cos(startA * Math.PI / 180)
        const sy = toSvgY(vy) - r * Math.sin(startA * Math.PI / 180)
        const ex = toSvgX(vx) + r * Math.cos(endA * Math.PI / 180)
        const ey = toSvgY(vy) - r * Math.sin(endA * Math.PI / 180)
        svgElements.push(`<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} 0 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
      }
    }

    // ── 8. \tkzMarkRightAngle ──
    // \tkzMarkRightAngle[size=0.3](A,B,C)
    const tkzRightAngleRegex = /\\tkzMarkRightAngle(?:\[([^\]]*)\])?\s*\((\w+)\s*,\s*(\w+)\s*,\s*(\w+)\)/g
    while ((match = tkzRightAngleRegex.exec(cleanCode)) !== null) {
      const style = match[1] || ''
      const sizeMatch = style.match(/size\s*=\s*([\d.]+)/)
      const sz = sizeMatch ? parseFloat(sizeMatch[1]) : 0.3
      const vertex = findCoord(match[3])
      const arm1 = findCoord(match[2]), arm2 = findCoord(match[4])
      if (vertex && arm1 && arm2) {
        hasSubstantialContent = true
        const r = sz * scale
        const len1 = Math.sqrt((arm1.x - vertex.x)**2 + (arm1.y - vertex.y)**2) || 1
        const len2 = Math.sqrt((arm2.x - vertex.x)**2 + (arm2.y - vertex.y)**2) || 1
        const ux1 = (arm1.x - vertex.x) / len1, uy1 = (arm1.y - vertex.y) / len1
        const ux2 = (arm2.x - vertex.x) / len2, uy2 = (arm2.y - vertex.y) / len2
        const p1x = toSvgX(vertex.x + ux1 * r / scale), p1y = toSvgY(vertex.y + uy1 * r / scale)
        const p2x = toSvgX(vertex.x + ux1 * r / scale + ux2 * r / scale), p2y = toSvgY(vertex.y + uy1 * r / scale + uy2 * r / scale)
        const p3x = toSvgX(vertex.x + ux2 * r / scale), p3y = toSvgY(vertex.y + uy2 * r / scale)
        svgElements.push(`<polyline points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
      }
    }

    // ── 9. 圆 ──
    // \draw (x,y) circle (r); 或 \draw[fill] (x,y) circle (r);
    const circleRegex = /\\draw(?:\[([^\]]*)\])?\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)\s*circle\s*\(?([\d.]+)\s*cm?\)?/g
    while ((match = circleRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const cx = toSvgX(parseFloat(match[2])), cy = toSvgY(parseFloat(match[3]))
      const r = parseFloat(match[4]) * scale
      const style = match[1] || ''
      const styleInfo = parseStyle(style)
      const fillAttr = styleInfo.fill ? ` fill="${styleInfo.fill}"` : ' fill="none"'
      svgElements.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"${fillAttr} stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}"/>`)
    }

    // ── 10. 填充路径 \fill ──
    // \fill (x1,y1) -- (x2,y2) -- (x3,y3) -- cycle;
    const fillRegex = /\\fill(?:\[([^\]]*)\])?\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)\s*((?:--\s*\(-?[\d.]+\s*,\s*-?[\d.]+\)\s*)*)(?:--\s*cycle)?/g
    while ((match = fillRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const points = [[parseFloat(match[2]), parseFloat(match[3])]]
      const segRegex = /--\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)/g
      let segM
      while ((segM = segRegex.exec(match[4])) !== null) {
        points.push([parseFloat(segM[1]), parseFloat(segM[2])])
      }
      const pointsStr = points.map(p => `${toSvgX(p[0]).toFixed(1)},${toSvgY(p[1]).toFixed(1)}`).join(' ')
      const styleInfo = parseStyle(match[1] || '')
      svgElements.push(`<polygon points="${pointsStr}" fill="${styleInfo.fill || '#E5E7EB'}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" opacity="${styleInfo.opacity}"/>`)
    }

    // ── 11. 路径命令 \path ──
    const pathRegex = /\\path(?:\[([^\]]*)\])?\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)\s*((?:--\s*\(-?[\d.]+\s*,\s*-?[\d.]+\)\s*)*)(?:--\s*cycle)?/g
    while ((match = pathRegex.exec(cleanCode)) !== null) {
      hasSubstantialContent = true
      const style = match[1] || ''
      const styleInfo = parseStyle(style)
      const points = [[parseFloat(match[2]), parseFloat(match[3])]]
      const segRegex = /--\s*\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)/g
      let segM
      while ((segM = segRegex.exec(match[4])) !== null) {
        points.push([parseFloat(segM[1]), parseFloat(segM[2])])
      }
      if (points.length >= 2) {
        for (let i = 0; i < points.length - 1; i++) {
          svgElements.push(`<line x1="${toSvgX(points[i][0]).toFixed(1)}" y1="${toSvgY(points[i][1]).toFixed(1)}" x2="${toSvgX(points[i+1][0]).toFixed(1)}" y2="${toSvgY(points[i+1][1]).toFixed(1)}" stroke="${styleInfo.strokeColor}" stroke-width="${styleInfo.strokeWidth}" ${styleInfo.dash}/>`)
        }
      }
    }
    
    // 检测坐标轴（axis）
    const hasAxis = cleanCode.includes('\\draw[->]') || cleanCode.includes('axis')
    if (hasAxis && coordinates.length === 0) {
      // 只有坐标轴，没有实质内容 → 严格模式下返回null
      if (strict) return null
      
      // 非严格模式：绘制简易坐标系
      const cx = svgWidth / 2, cy = svgHeight / 2
      svgElements.push(`<line x1="30" y1="${cy}" x2="${svgWidth-30}" y2="${cy}" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#arrow)"/>`)
      svgElements.push(`<line x1="${cx}" y1="${svgHeight-20}" x2="${cx}" y2="20" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#arrow)"/>`)
      svgElements.push(`<text x="${svgWidth-25}" y="${cy-8}" font-size="12" fill="#6B7280">x</text>`)
      svgElements.push(`<text x="${cx+8}" y="25" font-size="12" fill="#6B7280">y</text>`)
      svgElements.push(`<text x="${cx-5}" y="${cy+15}" font-size="11" fill="#6B7280">O</text>`)
    }
    
    // 严格模式：必须有实质内容才返回
    if (strict && !hasSubstantialContent) return null
    if (svgElements.length === 0) return null
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#9CA3AF"/>
        </marker>
      </defs>
      ${svgElements.join('\n      ')}
    </svg>`
  } catch (e) {
    console.warn('[TikZ] 转换失败:', e)
    return null
  }
}

/**
 * 根据 graphParams 生成 SVG（当 AI 没有直接生成 TikZ 代码时）
 */
export function graphParamsToSvg(graphParams, graphType, width = 380, height = 280) {
  if (!graphParams || !graphType) return null
  
  try {
    switch (graphType) {
      case 'geometry':
        return geometryParamsToSvg(graphParams, width, height)
      case 'function':
        return functionParamsToSvg(graphParams, width, height)
      default:
        return null
    }
  } catch (e) {
    console.warn('[TikZ] 参数转SVG失败:', e)
    return null
  }
}

/**
 * 几何图参数 → SVG
 */
function geometryParamsToSvg(params, width, height) {
  const svgElements = []
  
  // 顶点
  const vertices = params.vertices || []
  if (vertices.length === 0) return null
  
  const xs = vertices.map(v => v[1])
  const ys = vertices.map(v => v[2])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
  const scale = Math.min(width / (rangeX * 1.8), height / (rangeY * 1.8))
  const offsetX = width / 2 - (minX + maxX) / 2 * scale
  const offsetY = height / 2 + (minY + maxY) / 2 * scale
  
  // 线条
  if (params.lines) {
    params.lines.forEach(([from, to]) => {
      const fromV = vertices.find(v => v[0] === from)
      const toV = vertices.find(v => v[0] === to)
      if (fromV && toV) {
        const x1 = fromV[1] * scale + offsetX
        const y1 = -fromV[2] * scale + offsetY
        const x2 = toV[1] * scale + offsetX
        const y2 = -toV[2] * scale + offsetY
        svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#333" stroke-width="2"/>`)
      }
    })
  }
  
  // 标签
  if (params.labels) {
    params.labels.forEach(([text, x, y, pos]) => {
      const sx = x * scale + offsetX
      const sy = -y * scale + offsetY
      const anchor = getAnchorFromPos(pos)
      svgElements.push(`<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="${anchor.x}" dominant-baseline="${anchor.y}" font-size="13" fill="#1F2937">${text}</text>`)
    })
  }
  
  // 角度标记
  if (params.angles) {
    params.angles.forEach(([v1, v2, v3, angle]) => {
      const v = vertices.find(vt => vt[0] === v2)
      if (v) {
        const cx = v[1] * scale + offsetX
        const cy = -v[2] * scale + offsetY
        svgElements.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" fill="none" stroke="#9CA3AF" stroke-width="1"/>`)
      }
    })
  }
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgElements.join('')}</svg>`
}

/**
 * 函数图参数 → SVG
 */
function functionParamsToSvg(params, width, height) {
  const svgElements = []
  
  // 函数曲线（坐标点）
  const hasCurve = params.coordinates && params.coordinates.length > 1
  const hasLabels = params.labels && params.labels.length > 0
  
  // 只有坐标轴没有实质内容 → 不生成
  if (!hasCurve && !hasLabels) return null
  
  // 坐标轴
  const cx = width / 2, cy = height / 2
  svgElements.push(`<line x1="30" y1="${cy}" x2="${width-30}" y2="${cy}" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#arrow)"/>`)
  svgElements.push(`<line x1="${cx}" y1="${height-20}" x2="${cx}" y2="20" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#arrow)"/>`)
  svgElements.push(`<text x="${width-25}" y="${cy-8}" font-size="12" fill="#6B7280">x</text>`)
  svgElements.push(`<text x="${cx+8}" y="25" font-size="12" fill="#6B7280">y</text>`)
  svgElements.push(`<text x="${cx-5}" y="${cy+15}" font-size="11" fill="#6B7280">O</text>`)
  
  // 函数曲线
  if (hasCurve) {
    const points = params.coordinates.map(([x, y]) => {
      const sx = cx + x * 40
      const sy = cy - y * 40
      return `${sx},${sy}`
    }).join(' ')
    svgElements.push(`<polyline points="${points}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"/>`)
  }
  
  // 标签
  if (hasLabels) {
    params.labels.forEach(([text, x, y, pos]) => {
      const sx = cx + x * 40
      const sy = cy - y * 40
      const anchor = getAnchorFromPos(pos)
      svgElements.push(`<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="${anchor.x}" dominant-baseline="${anchor.y}" font-size="12" fill="#1F2937">${text}</text>`)
    })
  }
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#9CA3AF"/>
      </marker>
    </defs>
    ${svgElements.join('\n    ')}
  </svg>`
}

/**
 * 根据 TikZ 位置描述获取 SVG text-anchor 和 dominant-baseline
 */
function getAnchorFromPos(pos) {
  const p = pos.toLowerCase()
  if (p.includes('left') && p.includes('above')) return { x: 'end', y: 'auto' }
  if (p.includes('right') && p.includes('above')) return { x: 'start', y: 'auto' }
  if (p.includes('left') && p.includes('below')) return { x: 'end', y: 'hanging' }
  if (p.includes('right') && p.includes('below')) return { x: 'start', y: 'hanging' }
  if (p.includes('left')) return { x: 'end', y: 'middle' }
  if (p.includes('right')) return { x: 'start', y: 'middle' }
  if (p.includes('above')) return { x: 'middle', y: 'auto' }
  if (p.includes('below')) return { x: 'middle', y: 'hanging' }
  return { x: 'middle', y: 'middle' }
}

/**
 * 渲染图片区块：原图永远是主体，TikZ只是可选附加
 * 
 * 核心原则：
 * 1. 有原图（局部截图）→ 必须显示原图
 * 2. TikZ/SVG 只是附加信息，不可替代原图
 * 3. 空白坐标系毫无价值，绝不生成
 * 4. 没有原图时才显示占位符
 * 
 * @param {Object} block - 图片区块数据
 * @returns {{ type: 'image'|'placeholder', content: string, tikzSvg?: string }}
 */
export function renderImageBlock(block) {
  // 有局部截图 → 必须显示原图（永不丢弃）
  if (block.src) {
    // TikZ 作为附加信息（可选）
    let tikzSvg = null
    if (block.tikzCode) {
      tikzSvg = tikzToSvg(block.tikzCode)
    }
    if (!tikzSvg && block.graphParams && block.graphType) {
      tikzSvg = graphParamsToSvg(block.graphParams, block.graphType)
    }
    
    return { type: 'image', content: block.src, tikzSvg }
  }
  
  // 没有原图 → 尝试 TikZ（但不生成空白坐标系）
  if (block.tikzCode) {
    const svg = tikzToSvg(block.tikzCode, true) // strict模式：没有实质内容则返回null
    if (svg) {
      return { type: 'svg', content: svg }
    }
  }
  
  if (block.graphParams && block.graphType) {
    const svg = graphParamsToSvg(block.graphParams, block.graphType)
    if (svg) {
      return { type: 'svg', content: svg }
    }
  }
  
  // 无原图无TikZ → 占位符
  return { type: 'placeholder', content: block.caption || '待插入' }
}
