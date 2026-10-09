// 回归测试：错题重练（paper）复核页的定位框必须走「实测切段」，且喂给模型的题号
// 必须是【重练卷卷面编号】而不是【原始作业题号】。
//
// 事故背景（2026-10-09，虞晨熙 数学-1008-01 第 3 题）：
//   paper 模式的定位框过去只认 task.result.retryAlign —— 那是判题对位时存下的
//   【答卷 OCR 答案行】坐标。选择题的答案写在题干括号里，那份坐标整体偏移，第 3 题的
//   框压到了下一个栏目「二、填空题」上（老师截图反馈「定位在第三题，但对应的区域不准确」）。
//   改为在答卷图上按题切段实测（与 image 模式同一套 questionBoxMeasure）后修好。
//
// 两个必须锁住的判据：
//   ① paper 模式必须调实测量框（refine-boxes 带 questionIds），并且实测框优先于
//      retryAlign 兜底 —— 摘掉任一处就退回「框不对应这道题」。
//   ② 喂给模型的题号必须是卷面编号：重练卷题目记录带的是原始作业题号（实测
//      4,1,3,7,5,5,7,9,4,11,10），与卷面编号（1,2,3,4(2),5(5)…）完全不同。直接喂原题号
//      会让模型按原题号找行 → 切段整体错位（实测同一页两次调用 y 相差 30~180）。
//      改成卷面编号后连测两次结果几乎一致（差值 ≤8）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { anchoredSlice } from './sourceLockKit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const serverSrc = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
const storeSrc = readFileSync(resolve(ROOT, 'src/workbench/stores/reviewStore.js'), 'utf8')
const panelSrc = readFileSync(resolve(ROOT, 'src/workbench/components/review/PaperViewerPanel.vue'), 'utf8')
const apiSrc = readFileSync(resolve(ROOT, 'src/services/apiService.js'), 'utf8')

test('后端量框接口：paper 分支必须按 questionIds 取题（不是按 task_id）', () => {
  const fails = []
  const seg = anchoredSlice(serverSrc, 'const paperIds = Array.isArray(req.body?.questionIds)', 1600, 'index.js paperIds 分支', fails)
  if (seg !== null) {
    if (!seg.includes('WHERE id = ANY($1::uuid[])')) fails.push('index.js：paper 分支必须按 id 列表取题（题目挂在原始作业 task 上，按 task_id 查不到）')
    if (!seg.includes('paperLabels[i]')) fails.push('index.js：paper 分支必须用调用方给的卷面编号覆盖 question_number —— 直接喂原题号会让模型按原题号找行、切段整体错位')
    if (!seg.includes('question_number: lab')) fails.push('index.js：覆盖后的题号必须落到 question_number 字段（measurePageQuestionBoxes 按它生成题目清单）')
  }
  assert.deepEqual(fails, [])
})

test('前端：paper 模式必须调实测量框，并把卷面编号一起传给后端', () => {
  const fails = []
  const seg = anchoredSlice(storeSrc, 'const ensureRefinedBoxes = async () => {', 2200, 'reviewStore.ensureRefinedBoxes', fails)
  if (seg !== null) {
    if (!seg.includes("source.value !== 'paper'")) fails.push("reviewStore：ensureRefinedBoxes 必须覆盖 paper 模式（过去第一行 `if (source.value !== 'image') return` 让重练卷永远量不到框）")
    if (!seg.includes('parsePageAlignRecords(page)')) fails.push('reviewStore：paper 模式的题源必须取自 task.result.retryAlign（该页题目 + 卷面顺序）')
    if (!seg.includes('questionLabels: paperQuestionLabels')) fails.push('reviewStore：必须把卷面编号一起传给后端（漏了 → 模型按原题号找行、切段错位）')
  }
  const api = anchoredSlice(apiSrc, 'export const refineQuestionBoxes', 900, 'apiService.refineQuestionBoxes', fails)
  if (api !== null && !api.includes('body.questionLabels = opts.questionLabels')) {
    fails.push('apiService：refineQuestionBoxes 必须把 questionLabels 透传到请求体')
  }
  assert.deepEqual(fails, [])
})

test('前端画框：paper 模式实测框优先，量不到才退回 retryAlign 兜底', () => {
  const fails = []
  // ① 整页是否画：paper 分支必须认 refinedBoxes
  const show = anchoredSlice(panelSrc, 'const showBbox = computed(() => {', 900, 'PaperViewerPanel.showBbox', fails)
  if (show !== null) {
    const afterImage = show.split("store.source === 'image'")[1] || ''
    if (!afterImage.includes('store.refinedBoxes')) fails.push('PaperViewerPanel.showBbox：paper 分支必须认实测框 refinedBoxes，否则实测框到了也不画')
    if (!afterImage.includes('store.currentRetryAlignBoxes')) fails.push('PaperViewerPanel.showBbox：量框未回来/失败时必须保留 retryAlign 兜底，别让老师一帧框都看不到')
  }
  // ② 每题画在哪：paper 分支在实测框到位时必须只认实测框（返回 null 不画缺的题）
  const box = anchoredSlice(panelSrc, "if (store.source === 'paper') {", 700, 'PaperViewerPanel.getDisplayBox paper 分支', fails)
  if (box !== null) {
    if (!box.includes("store.refineStatus === 'done'")) fails.push("PaperViewerPanel.getDisplayBox：paper 分支必须按 refineStatus==='done' 判定实测框已到位")
    if (!box.includes('return null')) fails.push('PaperViewerPanel.getDisplayBox：实测框已到该页时缺的题必须返回 null（不画），混用两种口径会看着像画错了')
  }
  assert.deepEqual(fails, [])
})
