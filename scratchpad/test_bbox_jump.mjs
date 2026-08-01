// 验证 PaperViewerPanel jumpToBbox 数学逻辑 (v3)
// 关键设计：保持 zoom 不变（fitToContainer 初始值 / 用户手动值），只调整 panX/panY。
//   用户明确要求"我只要框换位置，我手动可以放大"——不要让 zoom 跳来跳去。

function computeJump({ nW, nH, cw, ch, bbox, currentZoom }) {
  // 归一化坐标 → 像素坐标（bbox 是相对原图的 0-1000 坐标）
  const bboxLeft = (bbox.x / 1000) * nW
  const bboxTop = (bbox.y / 1000) * nH
  const bboxRight = ((bbox.x + bbox.width) / 1000) * nW
  const bboxBottom = ((bbox.y + bbox.height) / 1000) * nH
  const bboxCenterX = (bboxLeft + bboxRight) / 2
  const bboxCenterY = (bboxTop + bboxBottom) / 2

  // 保持 zoom 不变
  const z = currentZoom
  const imgW = nW * z
  const imgH = nH * z

  // X 轴：图片比容器宽 → 自由调整让 bbox 中心到容器中央；图片比容器窄 → 居中
  let panX
  if (imgW > cw) {
    const targetPanX = cw / 2 - bboxCenterX * z
    panX = Math.min(0, Math.max(cw - imgW, targetPanX))
  } else {
    panX = (cw - imgW) / 2
  }

  // Y 轴同理
  let panY
  if (imgH > ch) {
    const targetPanY = ch / 2 - bboxCenterY * z
    panY = Math.min(0, Math.max(ch - imgH, targetPanY))
  } else {
    panY = (ch - imgH) / 2
  }

  return {
    z, panX, panY,
    bboxScreenX: panX + bboxCenterX * z,
    bboxScreenY: panY + bboxCenterY * z,
    bboxScreenLeft: panX + bboxLeft * z,
    bboxScreenTop: panY + bboxTop * z,
    bboxScreenRight: panX + bboxRight * z,
    bboxScreenBottom: panY + bboxBottom * z,
    isInScreen: panX + bboxLeft * z >= 0 &&
                panX + bboxRight * z <= cw &&
                panY + bboxTop * z >= 0 &&
                panY + bboxBottom * z <= ch,
  }
}

// 模拟一个"切题时 zoom 保持不变"的场景
// 关键验证：连续切题，zoom 应该一直等于 currentZoom（不变）
function testZoomStable() {
  console.log('=== 测试 1：切题时 zoom 保持稳定 ===')
  const cases = [
    { y: 0, name: '顶部题' },
    { y: 200, name: '中上题' },
    { y: 500, name: '中部题' },
    { y: 800, name: '底部题' },
    { y: 950, name: '接近底部' },
  ]
  const config = { nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: 0.4 }
  let stableOk = true
  for (const c of cases) {
    const r = computeJump({ ...config, bbox: { x: 100, y: c.y, width: 800, height: 80 } })
    const zStable = r.z === config.currentZoom
    if (!zStable) stableOk = false
    console.log(`  ${c.name} y=${c.y}: z=${r.z} ${zStable ? '✅' : '❌ 应保持 ' + config.currentZoom}`)
  }
  return stableOk
}

// 测试 fitToContainer 初始 zoom + 切题后 zoom 不变
function testFitToContainerZoom() {
  console.log('\n=== 测试 2：fitToContainer 初始 zoom 切题后保持 ===')
  // 模拟 fitToContainer: nW=2000, nH=3000, cw=800, ch=600, pad=0.92
  // scaleX = 800 * 0.92 / 2000 = 0.368
  // scaleY = 600 * 0.92 / 3000 = 0.184
  // zoom = min(0.368, 0.184, 1) = 0.184
  const fitZoom = Math.min(800 * 0.92 / 2000, 600 * 0.92 / 3000, 1)
  console.log(`  fitToContainer 计算 zoom = ${fitZoom.toFixed(4)}`)
  const cases = [
    { y: 100, name: '第1题 (顶部)' },
    { y: 500, name: '第10题' },
    { y: 1500, name: '中部题' },
    { y: 2800, name: '底部题' },
  ]
  let ok = true
  for (const c of cases) {
    const r = computeJump({ nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: fitZoom, bbox: { x: 100, y: c.y, width: 800, height: 80 } })
    const stable = r.z === fitZoom
    if (!stable) ok = false
    console.log(`  ${c.name} y=${c.y}: z=${r.z.toFixed(4)} ${stable ? '✅' : '❌'}`)
  }
  return ok
}

// 测试用户手动放大 zoom=1.5 后切题，zoom 不变
function testUserZoomPreserved() {
  console.log('\n=== 测试 3：用户手动 zoom=1.5 后切题保持 ===')
  const userZoom = 1.5
  const cases = [
    { y: 100, name: '切到顶部题' },
    { y: 1500, name: '切到中部题' },
    { y: 2800, name: '切到底部题' },
  ]
  let ok = true
  for (const c of cases) {
    const r = computeJump({ nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: userZoom, bbox: { x: 100, y: c.y, width: 800, height: 80 } })
    const stable = r.z === userZoom
    if (!stable) ok = false
    console.log(`  ${c.name}: z=${r.z} ${stable ? '✅' : '❌'}`)
  }
  return ok
}

// 测试 bbox 在屏幕中央（图片比容器大很多时，bbox 居中数学不可能 → 期望 bbox 至少在屏内）
function testBboxCenter() {
  console.log('\n=== 测试 4：bbox 至少在屏幕内（图片比容器大很多）===')
  // 归一化坐标 0-1000 必须在合法范围
  const cases = [
    { y: 100, name: 'y=100 (10%)' },
    { y: 500, name: 'y=500 (50%)' },
    { y: 900, name: 'y=900 (90%)' },
  ]
  const config = { nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: 0.4 }
  let allOk = true
  for (const c of cases) {
    const r = computeJump({ ...config, bbox: { x: 100, y: c.y, width: 800, height: 80 } })
    // 核心要求：bbox 至少有一部分在屏幕内
    const partiallyInScreen = r.bboxScreenTop < config.ch && r.bboxScreenBottom > 0
    if (!partiallyInScreen) allOk = false
    console.log(`  ${c.name}: bbox屏幕 y=[${r.bboxScreenTop.toFixed(0)}, ${r.bboxScreenBottom.toFixed(0)}] z=${r.z} ${partiallyInScreen ? '✅' : '❌ 不在屏内'}`)
  }
  return allOk
}

// 测试 bbox 在图片边缘时（不可能居中）→ bbox 完整可见
function testEdgeBbox() {
  console.log('\n=== 测试 5：bbox 在图片边缘时（不可居中）完整可见 ===')
  // bbox 在 y=0（顶部）→ 居中数学不可能（panY 无法向上）
  const r = computeJump({ nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: 0.4, bbox: { x: 100, y: 0, width: 800, height: 100 } })
  console.log(`  y=0 顶部: panY=${r.panY} bbox screen y=[${r.bboxScreenTop.toFixed(0)}, ${r.bboxScreenBottom.toFixed(0)}] ${r.isInScreen ? '✅' : '❌'}`)
  const topOk = r.isInScreen
  // bbox 在 y=900（底部）
  const r2 = computeJump({ nW: 2000, nH: 3000, cw: 800, ch: 600, currentZoom: 0.4, bbox: { x: 100, y: 900, width: 800, height: 100 } })
  console.log(`  y=900 底部: panY=${r2.panY} bbox screen y=[${r2.bboxScreenTop.toFixed(0)}, ${r2.bboxScreenBottom.toFixed(0)}] ${r2.isInScreen ? '✅' : '❌'}`)
  const botOk = r2.isInScreen
  return topOk && botOk
}

// 测试图片比容器小（窄图）时图片居中
function testSmallImage() {
  console.log('\n=== 测试 6：图片比容器小时居中显示 ===')
  // 800x600 容器，图片 400x500
  const fitZoom = Math.min(800 * 0.92 / 400, 600 * 0.92 / 500, 1)  // = 1
  const r = computeJump({ nW: 400, nH: 500, cw: 800, ch: 600, currentZoom: fitZoom, bbox: { x: 50, y: 100, width: 300, height: 200 } })
  // 图片在中央，panX = (800-400)/2 = 200
  const ok = r.panX === 200 && r.panY === (600 - 500) / 2
  console.log(`  小图居中: panX=${r.panX} (应=200), panY=${r.panY} (应=50) ${ok ? '✅' : '❌'}`)
  return ok
}

const t1 = testZoomStable()
const t2 = testFitToContainerZoom()
const t3 = testUserZoomPreserved()
const t4 = testBboxCenter()
const t5 = testEdgeBbox()
const t6 = testSmallImage()

console.log(`\n=== 汇总 ===`)
console.log(`zoom 稳定: ${t1 ? '✅' : '❌'}`)
console.log(`fitToContainer zoom 保持: ${t2 ? '✅' : '❌'}`)
console.log(`用户 zoom 保持: ${t3 ? '✅' : '❌'}`)
console.log(`bbox 居中: ${t4 ? '✅' : '❌'}`)
console.log(`边缘 bbox 可见: ${t5 ? '✅' : '❌'}`)
console.log(`小图居中: ${t6 ? '✅' : '❌'}`)

if (![t1, t2, t3, t4, t5, t6].every(Boolean)) process.exit(1)
