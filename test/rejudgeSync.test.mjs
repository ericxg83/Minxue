/**
 * 回归测试（2026-11-06）：重批改之后，页面不得残留「已复核-AI翻案」的假红 X。
 *
 * ── 报障形态（数学堂堂清04 #6，题 69d8eb2c）──
 * 卷子 2026-09-04 就 status='reviewed'（已完成复核），老师回看时发现 #6 判错，
 * 编辑学生答案保存 → 触发重批改 → 库里 is_correct false→true，
 * finalizeRejudgeResult 按人工改判口径把 review_status='wrong_no_book' 一并清成 NULL。
 * 但 /rejudge 响应只回 is_correct，前端只写 `question.is_correct = ...`：
 *   · 库里：review_status=NULL + is_correct=true（应为绿勾「AI判对」）
 *   · 页面：旧 wrong_no_book 还留着 + 新 is_correct=true
 *          ⇒ 橙色「错误，本次不入册」+ 红 X +「已复核-AI翻案」
 * 老师看到的是库里根本不存在的半同步状态，以为修复没生效、以为这卷不能再复核。
 *
 * ── 锁四件事 ──
 *  ① 后端 /rejudge 必须回**落库后**的判定快照（含 review_status），两条分支都要；
 *  ② 前端重判调用点必须整体套用共享补丁，禁止只写 is_correct（禁止前端猜口径）；
 *  ③ 补丁必须能把 review_status:null 覆盖掉旧错标，且不臆造未回传的列；
 *  ④ 已完成复核的卷仍要有可见改判入口；真冲突态必须给可行动提示。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildRejudgeSyncPatch, getReviewState, getReviewStateLabel } from '../src/utils/reviewDecision.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ── ① 后端契约：写库之后的真实行，两条分支都回 ────────────────────────────
test('后端 /rejudge 必须回判定快照（含 review_status），且两条返回路径都带', () => {
  const src = read('server/index.js')
  const start = src.indexOf("app.post('/api/questions/:id/rejudge'")
  assert.ok(start >= 0, '未找到 /rejudge 端点')
  const end = src.indexOf('\napp.', start + 1)
  const body = src.slice(start, end < 0 ? src.length : end)

  assert.ok(body.includes('loadJudgementSnapshot'), '必须重查落库后的判定行，不能只回算出来的 isCorrect')
  assert.ok(body.includes('review_status, confidence'), '快照必须含 review_status（判对时后端会清它）')
  assert.ok(body.includes('manualOverride: true'), 'PC 保存触发的重判仍是人工口径，不得改')
  const jsonCount = body.split('question: await loadJudgementSnapshot()').length - 1
  assert.equal(jsonCount, 2, '有 student_id 的结算分支 + 无 student_id 的兜底分支都要回快照')
})

// ── ② 前端：两处重判调用点都只能走共享补丁 ───────────────────────────────
test('源码锁：重判成功后禁止只写 is_correct（半同步红 X 的根因）', () => {
  const src = read('src/workbench/components/review/QuestionDetailPanel.vue')
  assert.ok(src.includes('buildRejudgeSyncPatch'), '必须复用共享补丁')
  const callCount = src.split('rejudgeQuestion(question.id)').length - 1
  assert.equal(callCount, 2, '编辑保存 + 快捷改学生答案两条路径都要同步')
  const patchCount = src.split('Object.assign(question, buildRejudgeSyncPatch(rejudgeResult))').length - 1
  assert.equal(patchCount, 2, '两条路径都必须整体套用补丁')
  assert.equal(src.includes('question.is_correct = rejudgeResult.is_correct'), false,
    '⛔ 单写 is_correct 会复辟「库里已翻案、页面还红 X」')
})

// ── ③ 补丁行为：null 也要覆盖，未回传的列不臆造 ──────────────────────────
test('补丁：后端判对并解除错标时，review_status:null 必须覆盖旧值', () => {
  const resp = {
    success: true,
    is_correct: true,
    question: { id: '69d8eb2c', is_correct: true, status: 'pending', review_status: null, confidence: 0.95 },
    idempotent: false
  }
  const patch = buildRejudgeSyncPatch(resp)
  assert.equal(patch.is_correct, true)
  assert.equal(patch.review_status, null, '⛔ 判跳过 null 就会留下 wrong_no_book 旧标')
  assert.equal(patch.status, 'pending')
  assert.equal(patch.confidence, 0.95)

  // 半同步 → 同步后的展示层结果（同一份判据）
  const stale = { confidence: 0.95, answer_source: 'teacher_input', review_status: 'wrong_no_book', is_correct: true }
  assert.equal(getReviewState(stale), 'wrong', '修复前的页面确实是红 X 态')
  assert.equal(getReviewStateLabel(stale), '已复核-AI翻案')
  const synced = Object.assign({}, stale, patch)
  assert.equal(getReviewState(synced), 'correct', '补丁套上后应立刻变绿')
  assert.equal(getReviewStateLabel(synced), 'AI判对')
})

test('补丁：AI 自动重解析保留人工错标时，不得擅自解除；旧版顶层响应仍兼容', () => {
  const patch = buildRejudgeSyncPatch({
    is_correct: true,
    question: { is_correct: true, review_status: 'wrong_no_book' }
  })
  assert.equal(patch.review_status, 'wrong_no_book', 'manualOverride=false 的口径属于后端，前端不许推翻')

  // 旧版后端只回顶层一列：至少保持原有行为，不臆造其它列
  assert.deepEqual(buildRejudgeSyncPatch({ success: true, is_correct: false }), { is_correct: false })
  assert.deepEqual(buildRejudgeSyncPatch(null), {})
  assert.deepEqual(buildRejudgeSyncPatch({}), {})
})

// ── ④ 已完成复核的卷：可见改判入口 + 真冲突的可行动提示 ─────────────────
test('源码锁：完成态保留可见改判入口，冲突态自动展开判定按钮并给提示', () => {
  const src = read('src/workbench/components/review/QuestionDetailPanel.vue')
  assert.ok(src.includes('改判本题'), '完成态必须给老师看得见的改判入口')
  assert.ok(src.includes('rejudgePanelOpen'), '开关必须存在，且不新增第二条判定路径')
  assert.ok(src.includes('!isAiReversalConflict'), '真冲突题要直接显示判定按钮组，别让老师再点一次')
  assert.ok(src.includes('确认翻案后红 X 才会变绿'), '「已复核-AI翻案」必须配可行动说明')
  assert.ok(/watch\(\(\) => q\.value\?\.id[\s\S]{0,200}rejudgePanelOpen\.value = false/.test(src),
    '切题必须收起临时展开，避免把上一题状态带过去')
})

console.log('✅ rejudgeSync: 全部通过（重判判定快照、前后端契约、已复核卷改判入口）')
