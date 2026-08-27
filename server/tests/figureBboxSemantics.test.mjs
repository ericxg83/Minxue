import { normalizeBlockBoxSemantics, clampImageBboxToBlock, isDegenerateFigureBox } from '../worker.js'

let pass = 0, fail = 0
const check = (name, got, expect) => {
  const g = JSON.stringify(got), e = JSON.stringify(expect)
  if (g === e) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}\n   期望 ${e}\n   实际 ${g}`) }
}

// ── 线上事故原始数据：任务 72ecfb3d「复习七 三角形(2)」 ──
// block_coordinates 是规范宽高，image_bbox 却是角点形态 [x1,y1,x2,y2]。
// 按宽高解读，配图框全部拉出页面，前端「配图」显示成隔壁题的选项文字。
const page1 = [
  { block_coordinates: { x: 150, y: 100, width: 700, height: 140 }, image_bbox: { x: 150, y: 150, width: 850, height: 240 } },
  { block_coordinates: { x: 150, y: 240, width: 700, height: 70 }, image_bbox: { x: 150, y: 280, width: 850, height: 310 } },
  { block_coordinates: { x: 150, y: 310, width: 700, height: 80 }, image_bbox: { x: 150, y: 350, width: 850, height: 390 } },
  { block_coordinates: { x: 150, y: 390, width: 700, height: 80 }, image_bbox: { x: 150, y: 430, width: 850, height: 470 } },
  { block_coordinates: { x: 150, y: 510, width: 700, height: 40 }, image_bbox: { x: 150, y: 550, width: 850, height: 590 } },
]
const blockBefore = JSON.parse(JSON.stringify(page1.map(q => q.block_coordinates)))
normalizeBlockBoxSemantics(page1)
check('image_bbox 角点形态整页换算', page1.map(q => q.image_bbox), [
  { x: 150, y: 150, width: 700, height: 90 },
  { x: 150, y: 280, width: 700, height: 30 },
  { x: 150, y: 350, width: 700, height: 40 },
  { x: 150, y: 430, width: 700, height: 40 },
  { x: 150, y: 550, width: 700, height: 40 },
])
check('同页规范的 block_coordinates 不被 image_bbox 的结论带偏', page1.map(q => q.block_coordinates), blockBefore)

// 第 2 页：只有 3 道题（无链式指纹），靠单框越界的确定性判据识别
const page2 = [
  { block_coordinates: { x: 90, y: 85, width: 750, height: 160 }, image_bbox: { x: 620, y: 25, width: 850, height: 150 } },
  { block_coordinates: { x: 90, y: 165, width: 850, height: 300 }, image_bbox: { x: 650, y: 200, width: 800, height: 300 } },
  { block_coordinates: { x: 90, y: 420, width: 850, height: 560 }, image_bbox: { x: 150, y: 560, width: 750, height: 700 } },
]
normalizeBlockBoxSemantics(page2)
check('少量配图框靠越界判据换算', page2.map(q => q.image_bbox), [
  { x: 620, y: 25, width: 230, height: 125 },
  { x: 650, y: 200, width: 150, height: 100 },
  { x: 150, y: 560, width: 600, height: 140 },
])

// 幂等
const again = JSON.parse(JSON.stringify(page2))
normalizeBlockBoxSemantics(again)
check('配图框换算幂等', again.map(q => q.image_bbox), page2.map(q => q.image_bbox))

// text_bbox 独立成组
const withText = [
  { text_bbox: { x: 100, y: 700, width: 800, height: 950 } },
  { text_bbox: { x: 100, y: 950, width: 800, height: 990 } },
]
normalizeBlockBoxSemantics(withText)
check('text_bbox 独立换算', withText.map(q => q.text_bbox), [
  { x: 100, y: 700, width: 700, height: 250 },
  { x: 100, y: 950, width: 700, height: 40 },
])

// legacy geometry_image.bbox
const legacy = [
  { geometry_image: { has_image: true, bbox: { x: 200, y: 600, width: 900, height: 900 } } },
]
normalizeBlockBoxSemantics(legacy)
check('legacy geometry_image.bbox 换算', legacy[0].geometry_image.bbox, { x: 200, y: 600, width: 700, height: 300 })

// 规范配图框不能被改坏
const sane = [
  { image_bbox: { x: 600, y: 100, width: 200, height: 150 } },
  { image_bbox: { x: 600, y: 400, width: 200, height: 150 } },
]
const saneBefore = JSON.parse(JSON.stringify(sane.map(q => q.image_bbox)))
normalizeBlockBoxSemantics(sane)
check('规范配图框保持不变', sane.map(q => q.image_bbox), saneBefore)

// ── clampImageBboxToBlock：不再拿题干框当配图 ──
check('配图在题目框之外时保持原框（多题配图集中排版）',
  clampImageBboxToBlock({ x: 620, y: 25, width: 230, height: 125 }, { x: 90, y: 85, width: 750, height: 160 }),
  { x: 620, y: 25, width: 230, height: 125 })
check('超大配图框按题目框收紧',
  clampImageBboxToBlock({ x: 100, y: 100, width: 800, height: 700 }, { x: 90, y: 85, width: 750, height: 300 }),
  { x: 100, y: 100, width: 750, height: 295 })
check('超大框与题目框完全不相交 → 判为未定位（不退回题干框）',
  clampImageBboxToBlock({ x: 100, y: 100, width: 800, height: 600 }, { x: 90, y: 800, width: 750, height: 150 }),
  null)
check('空/退化输入返回 null', [clampImageBboxToBlock(null, {}), clampImageBboxToBlock({ x: 1, y: 1, width: 0, height: 5 }, {})], [null, null])

// ── isDegenerateFigureBox：挡住从题目框机械推出来的"题干下方一条" ──
// 线上第 1 页 9 道题：配图框左边界与宽度全部与题目框一字不差
const copiedFromBlock = [
  [{ x: 150, y: 150, width: 700, height: 90 }, { x: 150, y: 100, width: 700, height: 140 }],
  [{ x: 150, y: 280, width: 700, height: 30 }, { x: 150, y: 240, width: 700, height: 70 }],
  [{ x: 150, y: 350, width: 700, height: 40 }, { x: 150, y: 310, width: 700, height: 80 }],
  [{ x: 150, y: 550, width: 700, height: 40 }, { x: 150, y: 510, width: 700, height: 40 }],
  [{ x: 150, y: 790, width: 700, height: 40 }, { x: 150, y: 750, width: 700, height: 40 }],
]
check('复制题目框的配图框全部被拦下',
  copiedFromBlock.map(([b, blk]) => isDegenerateFigureBox(b, blk)), [true, true, true, true, true])

check('过小的退化框被拦下',
  [{ x: 500, y: 100, width: 20, height: 300 }, { x: 100, y: 100, width: 300, height: 12 }]
    .map(b => isDegenerateFigureBox(b, null)), [true, true])

// 线上第 2 页：真正定位到的配图框，x 与题目框相差数百
const realFigures = [
  [{ x: 620, y: 25, width: 230, height: 125 }, { x: 90, y: 85, width: 750, height: 160 }],
  [{ x: 650, y: 200, width: 150, height: 100 }, { x: 90, y: 165, width: 850, height: 300 }],
  [{ x: 150, y: 560, width: 600, height: 140 }, { x: 90, y: 420, width: 850, height: 560 }],
]
check('真实配图框全部放行',
  realFigures.map(([b, blk]) => isDegenerateFigureBox(b, blk)), [false, false, false])

// 数轴这类合法的极扁配图不能因为宽高比被误杀
check('极扁的数轴配图不被误杀',
  isDegenerateFigureBox({ x: 200, y: 400, width: 700, height: 40 }, { x: 90, y: 300, width: 850, height: 200 }), false)
// 配图比题干起始位置更靠上（右上角配图）→ 即便同宽也说明是真定位
check('题干上方的同宽配图不被误杀',
  isDegenerateFigureBox({ x: 150, y: 60, width: 700, height: 120 }, { x: 150, y: 100, width: 700, height: 140 }), false)
check('空框判为退化', [isDegenerateFigureBox(null, null), isDegenerateFigureBox({ x: 1, y: 1 }, null)], [true, true])

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
