/**
 * 回归锁（2026-11-06）：解析入口收敛。
 *
 * ── 负责人裁决 ──
 * 「解析」和常驻的「AI 重解析」在「参考答案为空」时做的事几乎一样（都出解析、
 * 填答案、重判），两个入口是重复。方案：撤顶部常驻按钮，题干行「解析」做唯一主入口
 * 并按状态变形；低频的「强制重算」降为解析弹窗内次级文字链，仍调 /recompute-answer。
 *
 * ⛔ 撤的是「按钮」，不是「能力」：跨页在途恢复（RECOMPUTE_JOBS + localStorage 续查）、
 *    练习册答案库直查、降级提示、结论横幅、handler 本身一个都不能少。本锁两头都盯。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, ''))
  .join('\n')

const PANEL = read('src/workbench/components/review/QuestionDetailPanel.vue')
const SOURCE = read('src/workbench/components/review/AnalysisSource.vue')
const INDEX = read('server/index.js')
const STORE = read('src/workbench/stores/reviewStore.js')

test('常驻「AI 重解析」按钮已撤，重算事件交给解析入口', () => {
  const scriptAt = PANEL.indexOf('<script setup>')
  assert.ok(scriptAt > 0, '未找到 QuestionDetailPanel 的 script 段')
  const tpl = PANEL.slice(0, scriptAt)
  assert.equal(tpl.includes('@click="handleRecomputeAnswer"'), false, '顶部常驻重算按钮不得复辟')
  assert.equal(tpl.includes('>AI 重解析<'), false, '顶部不该再出现「AI 重解析」文案')
  assert.ok(
    /<AnalysisSource[^>]*@recompute="handleRecomputeAnswer"/.test(tpl),
    '解析入口必须接管重算事件，否则弹窗内「重新计算」点了没反应'
  )
  // 撤的是按钮，不是能力
  assert.ok(strip(PANEL).includes('const handleRecomputeAnswer'), '重算 handler 不能一起删掉')
  assert.ok(PANEL.includes('store.resumeRecomputeJobs()'), '跨页在途恢复不能丢')
  assert.ok(PANEL.includes('recomputeJob?.notice'), '上次结论横幅仍要常驻')
  assert.ok(
    PANEL.includes("console.error('AI 重解析失败:', err)"),
    'recomputeSurvivesPageLeave 的源码锚点不能改（改了那把锁会 fail-open）'
  )
})

test('解析主入口按状态变形，弹窗内提供低频次级重算', () => {
  assert.ok(SOURCE.includes("defineEmits(['recompute'])"), '必须把重算事件递给父组件')
  assert.ok(SOURCE.includes('store.recomputeJobFor'), '在途状态必须读 store，禁止再起组件级 ref')
  for (const label of ['查看解析', '解析并补答案', '重算中', '重新计算', 'requestRecompute']) {
    assert.ok(SOURCE.includes(label), `解析入口缺少「${label}」`)
  }
  assert.ok(SOURCE.includes('if (recomputing.value) return'), '重算在途不得并发再发 ensure-analysis')
  assert.ok(SOURCE.includes('hasAnalysis.value && hasAnswer.value'), '入口状态判据必须同时看解析与答案')

  // store 里的新解析必须优先于本地兜底：否则重新计算后答案更新了、弹窗还显示旧解析
  const fnStart = SOURCE.indexOf('const analysis = computed')
  assert.ok(fnStart > 0, '未找到解析文本 computed')
  const fnBody = SOURCE.slice(fnStart, SOURCE.indexOf('\n})', fnStart))
  assert.ok(
    fnBody.indexOf('stored') < fnBody.indexOf('localAnalysis.value'),
    'store 解析必须优先于本地兜底文本'
  )
})

test('答案库直查提前到答案为空也生效', () => {
  const start = INDEX.indexOf("app.post('/api/questions/:id/recompute-answer'")
  assert.ok(start > 0, '未找到重解析端点')
  const end = INDEX.indexOf('\napp.', start + 1)
  assert.ok(end > start, '未找到重解析端点的结束位置')
  const body = INDEX.slice(start, end)
  const guard = 'if (force || !String(q.answer'
  assert.ok(body.includes(guard), '直查条件必须覆盖「答案为空」，不能只剩 force')
  assert.equal(body.includes('if (force) {'), false, '旧的「仅 force 才查库」不得复辟')
  const guardPos = body.indexOf(guard)
  const bankPos = body.indexOf('lookupWorksheetAnswerForRecompute(id)')
  assert.ok(bankPos > guardPos, '答案库直查必须仍在条件体内、且在引擎求解之前')
})

test('反向自检：入口改回两个常驻按钮 / 直查改回仅 force 都能被检出', () => {
  const withoutEvent = PANEL.replace(
    '<AnalysisSource :question="q" @recompute="handleRecomputeAnswer" />',
    '<AnalysisSource :question="q" />'
  )
  assert.equal(
    /<AnalysisSource[^>]*@recompute=/.test(withoutEvent.slice(0, withoutEvent.indexOf('<script setup>'))),
    false,
    '合成「没接事件」的旧形态应被检出'
  )
  const brokenIndex = INDEX.replace("if (force || !String(q.answer || '').trim()) {", 'if (force) {')
  assert.ok(brokenIndex.includes('if (force) {'), '合成「仅 force 才查库」的旧写法应被检出')
})

test('答案库直查命中时来源标签不得误标成 AI 解答', () => {
  assert.ok(
    STORE.includes("resp.source === 'worksheet' ? 'worksheet' : 'ai'"),
    'applyRecomputeAnswer 必须按响应区分来源（后端直查写的是 answer_source=worksheet）'
  )
})

console.log('✅ analysisEntryConvergence: 全部通过（入口收敛 + 能力零损失 + 答案库直查提前）')
