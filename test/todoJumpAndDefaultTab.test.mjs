// 回归测试：错题重练（paper）复核页「待处理」点击跳页 + 待复核入口默认对准「待处理」
//
// 事故背景（2026-10-15，负责人截图反馈）：
//   ① 左栏「待处理」页签点某条记录不跳到对应题所在答卷页（题在第二页，停在第一页）；
//      「已确认 / 全部」点同卷题却能跳对。根因：syncPageForCurrentQuestion 的 paper 分支
//      只对「retryAlign 里带定位框」的题翻页；matchedBy='none'（学生未作答 / AI 未判定）
//      的题 retryAlign 无 pageNumber、无框 → findIndex 返回 -1 → 直接 return，不翻页。
//      而「待处理」里恰是这类无框题（exception / pending），所以点了不动。
//   ② PC 后台「待复核」入口引导到批改页时默认对准「全部」，应默认对准「待处理」。
//
// [2026-10-15 二次事故] 上述 fix 用「最近邻有框题」回退，对 321afd64(origQ=11(1),
// matchedBy=position,pgNum=1) 这类「OCR 没读到题号、按位置猜错页」的题仍然给错——
// 真位置在同 origQ 的 38802d84(origQ=11(1),matchedBy=number,pgNum=2) 的 p2。
// 加二级回退「同 origQ 借用 number 匹配的页码」解决。
//
// 四道防线必须锁住（fail-closed，锚点改名/移动即红，不许静默失效）：
//   ① paper 分支直查：必须用「matchedBy='number'」的可信记录（不是 hasBox），
//      否则 position 误判的题会被引到错页。
//   ② paper 分支同 origQ 借用：必须用「其它题、同 origQ、number 匹配」的页码。
//   ③ paper 分支最近邻兜底：找不到时按卷面顺序最近邻推断。
//   ④ 待复核入口（批改中心 openTask / 通知中心 openTask）必须带 focus=todo；
//      ReviewWorkspace.focusQuestionFromQuery 必须消费 focus=todo 调 jumpToFirstUnconfirmed。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { anchoredSlice } from './sourceLockKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const storeSrc = readFileSync(resolve(ROOT, 'src/workbench/stores/reviewStore.js'), 'utf8')
const wsSrc = readFileSync(resolve(ROOT, 'src/workbench/components/review/ReviewWorkspace.vue'), 'utf8')
const gradeSrc = readFileSync(resolve(ROOT, 'src/workbench/views/GradeCenterWorkbench.vue'), 'utf8')
const notiSrc = readFileSync(resolve(ROOT, 'src/workbench/components/layout/NotificationList.vue'), 'utf8')

test('reviewStore.syncPageForCurrentQuestion：paper 分支必须三级定位（number 直查 → 同 origQ 借用 → 最近邻兜底）', () => {
  const fails = []
  // 锚到 syncPage 内 paper 分支独有的「三级定位」注释起始位置
  const seg = anchoredSlice(storeSrc, '三级定位（信任度从高到低）', 4800, 'syncPage paper 分支', fails)
  if (seg !== null) {
    // ① 直查：必须用 matchedBy='number'，不能用 hasBox（position 可能猜错页）
    if (!seg.includes("r.matchedBy === 'number'")) fails.push('syncPage：直查必须用 matchedBy=number 的可信记录（不是 hasBox），否则 position 误判的题会被引到错页（2026-10-15 321afd64 二次事故）')
    if (!seg.includes('if (directIdx >= 0)')) fails.push('syncPage：直查命中后必须进入翻页分支')
    if (!seg.includes('setPageIndex(directIdx)')) fails.push('syncPage：直查命中时必须调 setPageIndex(directIdx)')
    // ② 同 origQ 借用：必须用 q.question_number + q.sub_no 找同 origQ 的 number 匹配
    if (!seg.includes('q.question_number')) fails.push('syncPage：同 origQ 借用必须读 q.question_number 拼 origQ')
    if (!seg.includes('q.sub_no')) fails.push('syncPage：同 origQ 借用必须读 q.sub_no 处理小问号（11(1) vs 11 区分）')
    if (!seg.includes('oOrigQ')) fails.push('syncPage：同 origQ 借用必须遍历 other 题算 oOrigQ 做相等判定')
    if (!seg.includes('sameOrigQPageIdxs')) fails.push('syncPage：同 origQ 借用必须把命中的页号收集到 sameOrigQPageIdxs，避免多次 setPageIndex')
    if (!seg.includes('setPageIndex(picked)')) fails.push('syncPage：同 origQ 借用命中页码后必须 setPageIndex(picked)，不能只算不用')
    // ③ 最近邻兜底：必须用 retryAnswerPageMap
    if (!seg.includes('retryAnswerPageMap.value')) fails.push('syncPage：最近邻兜底必须读 retryAnswerPageMap（仅含有框题的页码）')
    if (!seg.includes('pageOf(cur + d)')) fails.push('syncPage：最近邻兜底必须向前找最近邻（页号随题序单调不降）')
    if (!seg.includes('pageOf(cur - d)')) fails.push('syncPage：最近邻兜底必须也有向后兜底（前向全无框时退到后向）')
    if (!seg.includes('Number(fallback) - 1')) fails.push('syncPage：回退页码必须由 1-based 转 0-based 索引')
    if (!seg.includes('setPageIndex(fIdx)')) fails.push('syncPage：最近邻兜底推断出页码后必须调 setPageIndex 翻页')
    // 蓝框不画：兜底分支不得凭空造框
    if (!/不画|不画框|无框不画/.test(seg)) fails.push('syncPage：最近邻兜底必须明确「不画框」（仅翻页），否则会凭空造框误导老师')
  }
  assert.deepEqual(fails, [])
})

test('reviewStore.syncPageForCurrentQuestion：同 origQ 借用必须「只翻页、不借框」（绝不乱画红线）', () => {
  const fails = []
  // 锚到借用分支的**代码**（不是头部注释里的描述文字——那会切到注释段，抓不到 setPageIndex）
  const borrowSeg = anchoredSlice(storeSrc, 'const qOrigQ = String(q.question_number', 1600, 'syncPage 同 origQ 借用代码段', fails)
  if (borrowSeg !== null) {
    // 借用段里不得给 bbox 赋值（= 借框：把别题的框画到本题头上）
    if (/text_bbox\s*=|image_bbox\s*=|block_coordinates\s*=/.test(borrowSeg)) {
      fails.push('syncPage：同 origQ 借用**不得**写 bbox（借框 = 把别题的框画到本题头上，违反「绝不乱画」红线）')
    }
    // 借用段里不得出现 currentRetryAlignBoxes（那是「当前页的框 map」，改它 = 伪造框）
    if (borrowSeg.includes('currentRetryAlignBoxes')) {
      fails.push('syncPage：同 origQ 借用**不得**改 currentRetryAlignBoxes（伪造框，违反红线）')
    }
    // 但必须翻页（借用是为了翻页）
    if (!borrowSeg.includes('setPageIndex')) {
      fails.push('syncPage：同 origQ 借用必须翻页（setPageIndex），否则借用了页码却不动')
    }
    if (!borrowSeg.includes('sameOrigQPageIdxs')) {
      fails.push('syncPage：同 origQ 借用必须用 sameOrigQPageIdxs 收敛命中页（避免多次 setPageIndex 抖动）')
    }
  }
  assert.deepEqual(fails, [])
})

test('reviewStore.currentQuestionBoxHint：翻对页但没框时必须能给出诊断（不能静默）', () => {
  const fails = []
  const seg = anchoredSlice(storeSrc, 'const currentQuestionBoxHint = computed(', 1400, 'currentQuestionBoxHint', fails)
  if (seg !== null) {
    // 三种情况都要覆盖，否则老师会重新陷入「对着空白图猜」
    if (!seg.includes("'otherPage'")) fails.push('currentQuestionBoxHint：必须区分 otherPage（框记在别的页）')
    if (!seg.includes("'noTrace'")) fails.push('currentQuestionBoxHint：必须区分 noTrace（无作答痕迹）')
    if (!seg.includes("'noRecord'")) fails.push('currentQuestionBoxHint：必须区分 noRecord（无对位记录）')
    // 当前页已有框 → 不打扰老师
    if (!seg.includes('currentRetryAlignBoxes.value?.[q.id]')) {
      fails.push('currentQuestionBoxHint：当前页已有框时必须返回 null（不打扰老师）')
    }
  }
  // 必须导出，否则 UI 拿不到
  const exportSeg = anchoredSlice(storeSrc, 'currentRetryAlignBoxes,', 200, 'store 导出 currentQuestionBoxHint', fails)
  if (exportSeg !== null && !exportSeg.includes('currentQuestionBoxHint')) {
    fails.push('reviewStore：必须导出 currentQuestionBoxHint，否则 ReviewWorkspace 拿不到')
  }
  // UI 必须消费它（否则等于没做）
  const uiSeg = anchoredSlice(wsSrc, 'const boxHintText = computed(', 1200, 'ReviewWorkspace boxHintText', fails)
  if (uiSeg !== null) {
    if (!uiSeg.includes('store.currentQuestionBoxHint')) fails.push('ReviewWorkspace：boxHintText 必须消费 store.currentQuestionBoxHint')
    if (!uiSeg.includes('jumpToBoxPage')) fails.push('ReviewWorkspace：必须提供「跳到框所在页」出口，否则老师只能手动翻')
  }
  // 模板必须渲染
  if (!wsSrc.includes('v-if="boxHintText"')) fails.push('ReviewWorkspace：模板必须有 v-if="boxHintText" 的提示块')
  assert.deepEqual(fails, [])
})

test('ReviewWorkspace.focusQuestionFromQuery：focus=todo 时必须切待处理 + 跳首道未确认题', () => {
  const fails = []
  const seg = anchoredSlice(wsSrc, "if (route.query.focus === 'todo')", 160, 'ReviewWorkspace.focus=todo', fails)
  if (seg !== null) {
    if (!seg.includes('store.jumpToFirstUnconfirmed()')) fails.push('ReviewWorkspace：focus=todo 必须调 jumpToFirstUnconfirmed（与「还差 N 题」同源口径，不是另立一套）')
  }
  // ?q= 直达分支必须仍在（错题本「去原题编辑」入口），不能被 focus 逻辑挤掉
  const qSeg = anchoredSlice(wsSrc, 'const requestedQuestionId = route.query.q', 600, 'ReviewWorkspace.q 直达', fails)
  if (qSeg !== null) {
    if (!qSeg.includes('store.jumpToQuestion(idx)')) fails.push('ReviewWorkspace：?q= 直达必须仍走 jumpToQuestion(idx)，不能被 focus=todo 改造吞掉')
  }
  assert.deepEqual(fails, [])
})

test('GradeCenterWorkbench.openTask：待复核卷必须带 focus=todo，非待复核不带', () => {
  const fails = []
  const seg = anchoredSlice(gradeSrc, 'const focusTodo = isPendingReviewItem(task)', 220, 'GradeCenter.openTask focus', fails)
  if (seg !== null) {
    if (!seg.includes("isPendingReviewItem(task) ? 'todo' : undefined")) fails.push('GradeCenter：focus 只在 isPendingReviewItem(task) 为真时给 todo，否则 undefined（已复核完的卷不带，避免落到空列表）')
    if (!seg.includes('focus: focusTodo')) fails.push('GradeCenter：router.push 的 query 必须带 focus: focusTodo')
  }
  assert.deepEqual(fails, [])
})

test('NotificationList.openTask：done（待复核）分支必须带 focus=todo', () => {
  const fails = []
  // 锚到 done 分支里 router.push 的 query 片段（status='done' = AI 已完成待老师复核）
  const seg = anchoredSlice(notiSrc, "source: 'homework', focus: 'todo'", 60, 'NotificationList.openTask focus', fails)
  if (seg !== null) {
    if (!seg.includes("focus: 'todo'")) fails.push('NotificationList：done 分支 router.push 必须 query 带 focus: todo')
  }
  assert.deepEqual(fails, [])
})
