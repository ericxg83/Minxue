// 验证 PaperViewerPanel jumpToBbox 数学逻辑（修复版）
// 两种场景：
// 1. 图片比容器大 → 按 bbox 中心精确对齐屏幕中央
// 2. 图片比容器小 → panX/panY 居中（与 fitToContainer 一致），bbox 位置 = 居中 pan + bbox in image

function fitToContainer({ nW, nH, cw, ch }) {
  const pad = 0.92
  const scaleX = (cw * pad) / nW
  const scaleY = (ch * pad) / nH
  const zoom = Math.min(scaleX, scaleY, 1)
  const panX = (cw - nW * zoom) / 2
  const panY = (ch - nH * zoom) / 2
  return { zoom, panX, panY }
}

function jumpToBbox({ nW, nH, cw, ch, zoom, bbox }) {
  if (!bbox) return { panX: 0, panY: 0 }
  const imgW = nW * zoom
  const imgH = nH * zoom
  const bboxCenterX = (bbox.x + bbox.width / 2) / 1000 * nW
  const bboxCenterY = (bbox.y + bbox.height / 2) / 1000 * nH
  let panX, panY
  if (imgW > cw) {
    const targetPanX = cw / 2 - bboxCenterX * zoom
    panX = Math.min(0, Math.max(cw - imgW, targetPanX))
  } else {
    panX = (cw - imgW) / 2
  }
  if (imgH > ch) {
    const targetPanY = ch / 2 - bboxCenterY * zoom
    panY = Math.min(0, Math.max(ch - imgH, targetPanY))
  } else {
    panY = (ch - imgH) / 2
  }
  return {
    panX, panY,
    bboxScreenX: panX + bboxCenterX * zoom,
    bboxScreenY: panY + bboxCenterY * zoom
  }
}

const cases = [
  {
    name: '超长图 2000x3000 容器 800x600，第12题 y=600',
    fit: { nW: 2000, nH: 3000, cw: 800, ch: 600 },
    bbox: { x: 100, y: 600, width: 800, height: 100 },
  },
  {
    name: '第1题 y=50',
    fit: { nW: 2000, nH: 3000, cw: 800, ch: 600 },
    bbox: { x: 100, y: 50, width: 800, height: 80 },
  },
  {
    name: '短图 1200x1500 容器 800x600，第5题 y=400',
    fit: { nW: 1200, nH: 1500, cw: 800, ch: 600 },
    bbox: { x: 80, y: 400, width: 1000, height: 100 },
  },
  {
    name: '极长图 2000x8000 容器 800x600，第30题 y=800（图片必然比容器大）',
    fit: { nW: 2000, nH: 8000, cw: 800, ch: 600 },
    bbox: { x: 100, y: 800, width: 800, height: 100 },
  },
  {
    name: '图片比容器宽 1000x1500 容器 800x600，第3题 y=300',
    fit: { nW: 1000, nH: 1500, cw: 800, ch: 600 },
    bbox: { x: 50, y: 300, width: 900, height: 100 },
  },
  {
    name: '用户已 zoom in 到 0.5（图片比容器大），第12题 y=600',
    fit: { nW: 2000, nH: 3000, cw: 800, ch: 600 },
    userZoom: 0.5,
    bbox: { x: 100, y: 600, width: 800, height: 100 },
  },
  {
    name: '用户 zoom 到 1.2（图片比容器大很多），第12题 y=600',
    fit: { nW: 2000, nH: 3000, cw: 800, ch: 600 },
    userZoom: 1.2,
    bbox: { x: 100, y: 600, width: 800, height: 100 },
  },
]

let pass = 0, fail = 0
for (const c of cases) {
  const fit = fitToContainer(c.fit)
  const zoom = c.userZoom || fit.zoom
  const r = jumpToBbox({ ...c.fit, zoom, bbox: c.bbox })

  // 期望：根据 fit 后图片是否比容器大，分两种
  const imgH = c.fit.nH * zoom
  const imgW = c.fit.nW * zoom
  let expectedBboxScreenY
  if (imgH > c.fit.ch) {
    expectedBboxScreenY = c.fit.ch / 2  // 精确中央
  } else {
    // 居中显示，bbox 屏幕 y = fit.panY + bbox in image y
    expectedBboxScreenY = fit.panY + (c.bbox.y + c.bbox.height / 2) / 1000 * c.fit.nH * zoom
  }
  let expectedBboxScreenX
  if (imgW > c.fit.cw) {
    expectedBboxScreenX = c.fit.cw / 2
  } else {
    expectedBboxScreenX = fit.panX + (c.bbox.x + c.bbox.width / 2) / 1000 * c.fit.nW * zoom
  }

  const offsetY = Math.abs(r.bboxScreenY - expectedBboxScreenY)
  const offsetX = Math.abs(r.bboxScreenX - expectedBboxScreenX)
  const ok = offsetY < 1 && offsetX < 1
  console.log(`${ok ? '✅' : '❌'} ${c.name}`)
  console.log(`   zoom=${zoom.toFixed(3)} img=${imgW.toFixed(0)}x${imgH.toFixed(0)} panX=${r.panX.toFixed(1)} panY=${r.panY.toFixed(1)}`)
  console.log(`   bbox屏幕位置: (${r.bboxScreenX.toFixed(1)}, ${r.bboxScreenY.toFixed(1)})`)
  console.log(`   期望: (${expectedBboxScreenX.toFixed(1)}, ${expectedBboxScreenY.toFixed(1)}) 偏差: x=${offsetX.toFixed(1)} y=${offsetY.toFixed(1)}`)
  if (ok) pass++; else fail++
}
console.log(`\n通过 ${pass}/${cases.length}`)
if (fail > 0) process.exit(1)
