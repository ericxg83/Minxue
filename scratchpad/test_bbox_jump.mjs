// 验证 PaperViewerPanel jumpToBbox 数学逻辑
// v2: 动态调整 zoom + panX/panY，让 bbox 中心在屏幕中央可见
//
// 关键修复：之前用 fitToContainer 的 zoom 缩放图片，bbox 中心 y_px * zoom + panY
// 经常超过容器高度（panY 居中时 bbox 在屏幕外）。新算法计算 zMin（让 panX/panY 居中
// 时在范围内）和 zMax（让 bbox 不超出屏幕），取合适的 zoom 让 bbox 居中且完整可见。
//
// 边界情况：bbox 在图片边缘时严格居中数学不可能，此时选 zMax 让 bbox 完整可见，
// 退而求其次让 bbox 尽量靠中央。

function computeJump({ nW, nH, cw, ch, bbox, currentZoom = null }) {
  // 归一化坐标 → 像素坐标
  const bboxLeft = (bbox.x / 1000) * nW
  const bboxTop = (bbox.y / 1000) * nH
  const bboxRight = ((bbox.x + bbox.width) / 1000) * nW
  const bboxBottom = ((bbox.y + bbox.height) / 1000) * nH
  const bboxCenterX = (bboxLeft + bboxRight) / 2
  const bboxCenterY = (bboxTop + bboxBottom) / 2
  const bboxW = bboxRight - bboxLeft
  const bboxH = bboxBottom - bboxTop

  // z 上界：让 bbox 完整可见（不被裁剪到屏幕外）
  const zMax = Math.min(ch / bboxH, cw / bboxW, 5)

  // z 下界：让 bbox 居中（panX/panY = cw/2 - bboxCenter*z 在图片偏移范围内）
  //   panY in [ch - nH*z, 0]  →  z >= ch/(2*bboxCenterY) && z >= ch/(2*(nH-bboxCenterY))
  //   panX in [cw - nW*z, 0]  →  z >= cw/(2*bboxCenterX) && z >= cw/(2*(nW-bboxCenterX))
  const lowerY1 = bboxCenterY > 0 ? ch / (2 * bboxCenterY) : 0
  const lowerY2 = nH > bboxCenterY ? ch / (2 * (nH - bboxCenterY)) : 0
  const lowerX1 = bboxCenterX > 0 ? cw / (2 * bboxCenterX) : 0
  const lowerX2 = nW > bboxCenterX ? cw / (2 * (nW - bboxCenterX)) : 0
  const zMin = Math.max(lowerX1, lowerX2, lowerY1, lowerY2)

  // 选 zoom：bbox 可以居中时取 zMin（精确中央），否则取 zMax（完整可见）
  let z = (zMin <= zMax) ? zMin : zMax
  z = Math.max(z, 0.2)  // 最小 zoom 兜底

  // 保留用户主动放大的 zoom（避免 zoom 在切题时跳动让用户迷失），
  // 但仅当保留后 bbox 仍能完整可见（zoom <= zMax）；否则降级到 zMax 保证可见性。
  if (currentZoom !== null && currentZoom > z) {
    z = Math.min(currentZoom, zMax)
  }

  const imgW = nW * z
  const imgH = nH * z

  // 目标：bbox 居中
  let targetPanX = cw / 2 - bboxCenterX * z
  let targetPanY = ch / 2 - bboxCenterY * z

  // 夹紧到图片偏移范围
  let panX = Math.min(0, Math.max(cw - imgW, targetPanX))
  let panY = Math.min(0, Math.max(ch - imgH, targetPanY))

  // 兜底：如果 bbox 被裁剪（zMax 仍不够），调整 panX/panY 让 bbox 完整可见
  const bboxScreenLeft = panX + bboxLeft * z
  const bboxScreenRight = panX + bboxRight * z
  const bboxScreenTop = panY + bboxTop * z
  const bboxScreenBottom = panY + bboxBottom * z

  if (bboxScreenLeft < 0) panX = -bboxLeft * z
  if (bboxScreenRight > cw) panX = cw - bboxRight * z
  if (bboxScreenTop < 0) panY = -bboxTop * z
  if (bboxScreenBottom > ch) panY = ch - bboxBottom * z

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

const cases = [
  // 1) 各种合法 y 位置 (y+height <= 1000)
  { name: 'y=0 (顶部) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 0, width: 800, height: 100 } },
  { name: 'y=200 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 200, width: 800, height: 100 } },
  { name: 'y=400 (中部偏上) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 400, width: 800, height: 100 } },
  { name: 'y=500 (中部) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 200 } },
  { name: 'y=600 (中部偏下) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 600, width: 800, height: 200 } },
  { name: 'y=700 (70%位置) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 700, width: 800, height: 200 } },
  { name: 'y=800 (80%位置) 容器 800x600 图 2000x3000', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 800, width: 800, height: 100 } },

  // 2) 各种容器大小
  { name: '宽屏 1200x800 y=500 图 2000x3000', nW: 2000, nH: 3000, cw: 1200, ch: 800, bbox: { x: 100, y: 500, width: 800, height: 200 } },
  { name: '窄屏 600x600 y=500 图 2000x3000', nW: 2000, nH: 3000, cw: 600, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 200 } },

  // 3) 极长图 (合法 y 范围)
  { name: '极长图 2000x5000 容器 800x600 y=500 (10%)', nW: 2000, nH: 5000, cw: 800, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 100 } },

  // 4) 小图（需要放大）
  { name: '小图 800x1200 容器 800x600 y=500', nW: 800, nH: 1200, cw: 800, ch: 600, bbox: { x: 50, y: 500, width: 700, height: 150 } },

  // 5) 横图
  { name: '横图 3000x2000 容器 800x600 y=500', nW: 3000, nH: 2000, cw: 800, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 200 } },

  // 6) 用户已有 zoom 时
  { name: '用户 zoom=1.5 容器 800x600 图 2000x3000 y=500', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 200 }, currentZoom: 1.5 },
  { name: '用户 zoom=2.0 容器 800x600 图 2000x3000 y=500', nW: 2000, nH: 3000, cw: 800, ch: 600, bbox: { x: 100, y: 500, width: 800, height: 200 }, currentZoom: 2.0 },
]

let pass = 0, fail = 0
for (const c of cases) {
  const r = computeJump(c)
  const cyExpected = c.ch / 2
  const inScreen = r.isInScreen
  const offsetY = Math.abs(r.bboxScreenY - cyExpected)
  const offsetX = Math.abs(r.bboxScreenX - c.cw / 2)
  // 通过条件：
  //   1) 必须在屏幕内（不可见 = 失败）
  //   2) bbox 数据合法（y+height <= 1000）时要求居中（< 100px 偏差）
  //   3) bbox 越界时允许偏差（AI 错误数据，不应怪前端）
  const bboxValid = (c.bbox.y + c.bbox.height) <= 1000
  const centerOk = bboxValid ? (offsetY < 100 && offsetX < 100) : true
  const ok = inScreen && centerOk

  if (ok) pass++; else fail++

  const status = ok ? '✅' : (inScreen ? '⚠️ 在屏但偏' : '❌ 跑出')
  const note = bboxValid ? '' : ' (bbox 越界)'
  console.log(`${status}${note} ${c.name}`)
  console.log(`   z=${r.z.toFixed(3)} panX=${r.panX.toFixed(0)} panY=${r.panY.toFixed(0)}`)
  console.log(`   bbox屏幕: (${r.bboxScreenX.toFixed(0)}, ${r.bboxScreenY.toFixed(0)}) 期望中心: (${c.cw/2}, ${cyExpected}) 偏差: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`)
  console.log(`   bbox 边界: x=[${r.bboxScreenLeft.toFixed(0)}, ${r.bboxScreenRight.toFixed(0)}] y=[${r.bboxScreenTop.toFixed(0)}, ${r.bboxScreenBottom.toFixed(0)}] | 在屏: ${inScreen}`)
}

console.log(`\n通过 ${pass}/${cases.length}`)
if (fail > 0) process.exit(1)
