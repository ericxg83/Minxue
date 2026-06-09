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
 * 支持常见的 TikZ 命令：draw, node, coordinate, plot, circle, rectangle
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
    
    const svgElements = []
    const svgWidth = 380
    const svgHeight = 280
    let hasSubstantialContent = false
    
    // 如果有坐标点，计算缩放和偏移
    if (coordinates.length > 0) {
      const xs = coordinates.map(c => c.x)
      const ys = coordinates.map(c => c.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
      const scale = Math.min(svgWidth / (rangeX * 1.8), svgHeight / (rangeY * 1.8)) * tikzScale
      const offsetX = svgWidth / 2 - (minX + maxX) / 2 * scale
      const offsetY = svgHeight / 2 + (minY + maxY) / 2 * scale
      
      // 绘制线条
      const drawLineRegex = /\\draw(?:\[([^\]]*)\])?\s*\((\w+)\)\s*(?:--|to)\s*\((\w+)\)(?:\s*--\s*\((\w+)\))?\s*(?:--\s*cycle)?/g
      while ((match = drawLineRegex.exec(cleanCode)) !== null) {
        const from = coordinates.find(c => c.name === match[2])
        const to = coordinates.find(c => c.name === match[3])
        if (from && to) {
          hasSubstantialContent = true
          const x1 = from.x * scale + offsetX
          const y1 = -from.y * scale + offsetY
          const x2 = to.x * scale + offsetX
          const y2 = -to.y * scale + offsetY
          const style = match[1] || ''
          const strokeColor = style.includes('red') ? '#DC2626' : style.includes('blue') ? '#3B82F6' : '#333'
          const strokeWidth = style.includes('thick') ? '2' : '1.5'
          const dash = style.includes('dashed') ? 'stroke-dasharray="4,3"' : ''
          svgElements.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash}/>` )
        }
      }
      
      // 绘制标签
      const nodeRegex = /\\node(?:\[([^\]]*)\])?\s*at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\{([^}]+)\}/g
      while ((match = nodeRegex.exec(cleanCode)) !== null) {
        hasSubstantialContent = true
        const x = parseFloat(match[2]) * scale + offsetX
        const y = -parseFloat(match[3]) * scale + offsetY
        const text = match[4].replace(/\\\$/g, '')
        const pos = match[1] || ''
        const anchor = getAnchorFromPos(pos)
        svgElements.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor.x}" dominant-baseline="${anchor.y}" font-size="13" fill="#1F2937">${text}</text>`)
      }
      
      // 绘制直角标记
      const rightAngleRegex = /\\draw\s*\(([\d.]+),([\d.]+)\)\s*rectangle\s*\(([\d.]+),([\d.]+)\)/g
      while ((match = rightAngleRegex.exec(cleanCode)) !== null) {
        hasSubstantialContent = true
        const x1 = parseFloat(match[1]) * scale + offsetX
        const y1 = -parseFloat(match[2]) * scale + offsetY
        const x2 = parseFloat(match[3]) * scale + offsetX
        const y2 = -parseFloat(match[4]) * scale + offsetY
        svgElements.push(`<rect x="${x1.toFixed(1)}" y="${y2.toFixed(1)}" width="${(x2-x1).toFixed(1)}" height="${(y1-y2).toFixed(1)}" fill="none" stroke="#666" stroke-width="1"/>`)
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
