/**
 * 原卷裁剪弹窗「跨页配图」回归锁（2026-10-25）
 *
 * ── 现场问题 ──
 * 填空题 #9（矩形 ABCD 内作正方形 AEFD）题干印在第 1 页、配图印在第 2 页。
 * 点「编辑 → 原卷裁剪」时弹窗只按 `q.page_number` 锁定题干页，弹窗里没有任何翻页入口
 * ⇒ 老师根本翻不到第 2 页，配图永远补不上；而答案引擎的缺配图闸
 * （`server/utils/figureRequirementGuard.js`）会一直跳过 AI 解析，题目永远没有答案。
 *
 * ── 本测试锁三件事 ──
 *  ① 弹窗内有多页翻页入口（`cropPages` / `gotoCropPage`），且仅在多于 1 页时出现；
 *  ② 翻页必须清掉上一页的框与预览 —— 否则第 1 页框出的区域会被裁到第 2 页的图上
 *     （静默出错：图片看着有内容，实际是别的题的图）；
 *  ③ bbox 自动预选只在题干页生效 —— bbox 是题干页坐标，套到其它页会框出无关区域。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PANEL = readFileSync(
  new URL('../src/workbench/components/review/QuestionDetailPanel.vue', import.meta.url),
  'utf8'
)

/** 取某个函数（`const name = (…) => {` 或 `const name = async (…) => {`）的函数体 */
function fnBody (src, name) {
  const start = src.indexOf(`const ${name} = `)
  assert.ok(start >= 0, `未找到函数 ${name}`)
  const braceStart = src.indexOf('{', src.indexOf('=>', start))
  assert.ok(braceStart >= 0, `${name} 里没找到函数体起点`)
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  throw new Error(`${name} 函数体未闭合`)
}

test('裁剪弹窗有页图列表与翻页入口（跨页配图的唯一出口）', () => {
  assert.match(PANEL, /const cropPages = ref\(\[\]\)/, '缺少 cropPages 页图状态')
  assert.match(PANEL, /const cropPageIdx = ref\(0\)/, '缺少当前页索引')
  assert.match(PANEL, /const gotoCropPage = \(/, '缺少 gotoCropPage 翻页函数')
  // 模板里必须有翻页按钮，且只在多于一页时出现
  assert.match(
    PANEL,
    /v-if="cropPages\.length > 1" class="crop-page-bar"/,
    '翻页条必须在 cropPages.length > 1 时才渲染（单页不该出现翻页按钮）'
  )
  assert.match(PANEL, /@click="gotoCropPage\(cropPageIdx - 1\)"/, '缺少「上一页」按钮接线')
  assert.match(PANEL, /@click="gotoCropPage\(cropPageIdx \+ 1\)"/, '缺少「下一页」按钮接线')
})

test('裁剪弹窗宽度必须有界（width="auto" 会撑满整个窗口）', () => {
  // el-dialog 的 width 走 --el-dialog-width，auto 会被解析成块级 auto → 弹窗占满视口，
  // 图缩在左边、右边一大片白（2026-10-25 报障「这个页面突然全屏」）。
  const dialogOpen = PANEL.indexOf('v-model="cropDialogVisible"')
  assert.ok(dialogOpen > 0, '未找到裁剪弹窗')
  const head = PANEL.slice(dialogOpen, dialogOpen + 600)
  assert.doesNotMatch(head, /width="auto"/, '裁剪弹窗不允许再用 width="auto"')
  assert.match(head, /width="min\(\d+px, \d+vw\)"/, '裁剪弹窗必须给有界宽度（min(Npx, Nvw)）')
})

test('openCropDialog：默认落到题干页，页图列表来自 currentPaperPages', () => {
  const body = fnBody(PANEL, 'openCropDialog')
  assert.match(body, /store\.currentPaperPages/, '页图列表必须取自 store.currentPaperPages')
  assert.match(body, /cropPages\.value = /, 'openCropDialog 必须初始化 cropPages')
  assert.match(body, /cropQuestionPageNo\.value = pageNum/, '必须记下题干页号，供「本题在第 N 页」提示')
  assert.match(
    body,
    /findIndex\(p => Number\(p\.page_number\) === Number\(pageNum\)\)/,
    '定位题干页必须按 page_number 匹配（page_number 可能为字符串，必须 Number 归一）'
  )
})

test('翻页必须清掉上一页的框与预览（否则框到别的页的图）', () => {
  const body = fnBody(PANEL, 'gotoCropPage')
  assert.match(body, /cropImageSource\.value = next/, '翻页必须换图源')
  assert.match(body, /cropSelection\.value = null/, '翻页必须清空裁剪框')
  assert.match(body, /cropPreviewUrl\.value = ''/, '翻页必须清空预览（否则按钮可用但内容是上一页的）')
  assert.match(
    body,
    /idx === cropPageIdx\.value\) return/,
    '同一页重复点击应直接返回，避免误清已框好的区域'
  )
})

test('bbox 自动预选只在题干页生效', () => {
  const body = fnBody(PANEL, 'cropImageLoaded')
  const guardIdx = body.indexOf('if (!cropOnQuestionPage.value)')
  const bboxIdx = body.indexOf('parseBbox(')
  assert.ok(guardIdx >= 0, 'cropImageLoaded 缺少「是否题干页」守卫')
  assert.ok(bboxIdx > guardIdx, '守卫必须排在 parseBbox 预选之前（否则别页仍会用 bbox 框选）')
  // 守卫分支里要清框，避免上一页的框残留在新页上
  const guardBlock = body.slice(guardIdx, bboxIdx)
  assert.match(guardBlock, /cropSelection\.value = null/, '非题干页必须清空框')

  // 单页/兜底页不设限，保持原预选行为（不能因为页号对不上就整页失去预选）
  const onQPage = PANEL.slice(PANEL.indexOf('const cropOnQuestionPage = computed('))
  const onQPageBody = onQPage.slice(0, onQPage.indexOf('\n})') + 3)
  assert.match(
    onQPageBody,
    /cropPages\.value\.length <= 1\) return true/,
    '单页时必须视为「在题干页」，否则原预选行为被误伤'
  )
  // 旧数据无 page_number：仍把默认落地的首页当题干页，避免这批题彻底失去预选
  assert.match(
    onQPageBody,
    /cropQuestionPageNo\.value == null\) return cropPageIdx\.value === 0/,
    '缺 page_number 的旧题必须回落为「首页 = 题干页」'
  )
})
