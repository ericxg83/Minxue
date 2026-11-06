/**
 * 回归测试（2026-11-06）：点「解析」之后参考答案必须同步。
 *
 * ── 报障形态 ──
 * 参考答案为空、解析也为空（或解析末尾写着「答案为 8 − √19」），老师点题干行的
 * 「解析」按钮，弹窗里出现了完整解析，右侧参考答案栏却仍是空的，还挂着
 * 「未采集到配图，已跳过 AI 解析」「配图已补齐，可点「AI 重解析」重新计算答案」，
 * 结果还得再走一遍「AI 重解析」的复杂流程才能批改对错。
 *
 * ── 四个真因（逐个锁死）──
 *  ① 后端 11-04 只做了「生成解析后写 answer」，已有解析时 early return 根本不写；
 *  ② 同一提交 SELECT 没读 student_answer / is_correct，却拿它们去判等结算 ⇒ undefined 误判；
 *  ③ 前端 store 只同步 analysis，库里写了页面看不见，旧异常红条也不清；
 *  ④ 成功后没清缓存，侧栏徽标/列表还是旧数。
 * 另有回归测试 recomputeAnswerTimeout.test.mjs ⑦ 段锁后端安全口径。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildAnalysisSyncPatch } from '../src/utils/reviewDecision.js'
import { extractFinalAnswerFromAnalysis, isNarrativeAnswer } from '../server/utils/aiParseSelfCheck.js'
import { validateArithmeticAnswer } from '../server/utils/arithmeticAnswerValidator.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ── ① 响应补丁：后端写过的列必须全部映射到前端题目对象 ──────────────────
test('解析补全写入参考答案时，补丁必须同步答案 + 判定 + 清异常标注', () => {
  const resp = {
    analysis: '……答案为 8 − √19',
    answer: '8 − √19',
    answer_synced: true,
    answer_sync_source: 'analysis',
    is_correct: true,
    answer_mismatch: false
  }
  const patch = buildAnalysisSyncPatch(resp)
  assert.equal(patch.analysis, resp.analysis)
  assert.equal(patch.answer, '8 − √19')
  assert.equal(patch.ai_answer, '8 − √19')
  assert.equal(patch.is_correct, true)
  assert.equal(patch.answer_exception, false)
  assert.equal(patch.answer_exception_reason, null, '旧的「未采集到配图」红条必须一并清掉')
  assert.equal(patch.ai_answer_risk_reason, null)
  // 后端没改 answer_source：擅自写成 'ai' 会把答案库来源误标成 AI 解答
  assert.equal('answer_source' in patch, false)
})

test('只生成解析、没写参考答案时只同步 analysis（不得臆造答案）', () => {
  assert.deepEqual(
    buildAnalysisSyncPatch({ analysis: '解题过程…', answer_synced: false, answer: null }),
    { analysis: '解题过程…' }
  )
})

test('answer_synced 为真但答案为空 / 响应为空 → 不产生补丁', () => {
  assert.deepEqual(buildAnalysisSyncPatch({ answer_synced: true, answer: '' }), {})
  assert.deepEqual(buildAnalysisSyncPatch(null), {})
  assert.deepEqual(buildAnalysisSyncPatch({}), {})
})

// ── ② 截图场景端到端（纯函数层）：解析末尾的答案能反填成参考答案 ──────────
test('「答案为 8 − √19」可反填，且三道闸都不误拦合法根式答案', () => {
  const analysis = '点 C 关于点 B 的对称点为 A，设点 A 表示的数为 a，已知点 B 表示 4，点 C 表示 √19，由中点公式得 (a+√19)/2 = 4，两边乘以 2 得 a + √19 = 8，解得 a = 8 − √19。验证 √19 ≈ 4.36，则 a ≈ 3.64，与图中位置一致。答案为 8 − √19'
  const ans = extractFinalAnswerFromAnalysis(analysis)
  assert.equal(ans, '8 − √19')
  assert.equal(isNarrativeAnswer(ans), false, '叙述残句闸不得误拦')
  const content = '如图，点 B，C 在数轴上表示的数分别是 4、√19，若点 C 关于点 B 的对称点为 A，则数轴上点 A 表示的数是___'
  const v = validateArithmeticAnswer(content, ans)
  assert.equal(v && v.applicable && !v.isValid, false, '验算闸不得把合法根式答案拦下')

  const patch = buildAnalysisSyncPatch({ analysis, answer: ans, answer_synced: true, is_correct: true })
  assert.equal(patch.answer, '8 − √19', '页面参考答案栏应当立刻有值，可以直接批改对错')
  assert.equal(patch.answer_exception_reason, null)
})

// ── ③ 前端解析入口：答案为空时不能秒回，成功后必须清缓存 ────────────────
test('源码锁：解析入口在参考答案为空时必须继续同步，并给成败反馈', () => {
  const src = read('src/workbench/components/review/AnalysisSource.vue')
  assert.ok(src.includes('hasAnalysis.value && hasAnswer'), '只有「解析有 + 答案有」才允许秒开')
  assert.ok(src.includes('needsFullSolve.value = !hasAnalysis.value'), '引擎 / 反填文案判据必须取动作前快照')
  assert.ok(src.includes('clearStudentCaches'), '写库成功后必须清缓存，否则徽标与列表滞留')
  assert.ok(src.includes('resp?.answer_synced'), '必须消费后端的答案同步结果')
  assert.ok(src.includes('syncWarn'), '抽不出答案时必须给可行动提示，不能点了没反应')
  assert.ok(src.includes('可以直接批改对错了'), '补齐成功要明确告诉老师下一步能做什么')
})

// ── ④ 前端 store：字段映射只能有一份实现 ────────────────────────────────
test('源码锁：applyGeneratedAnalysis 必须走共享补丁，禁止逐项手写映射', () => {
  const src = read('src/workbench/stores/reviewStore.js')
  assert.ok(src.includes('buildAnalysisSyncPatch'), 'store 必须复用共享判据')
  const fnStart = src.indexOf('const applyGeneratedAnalysis')
  assert.ok(fnStart >= 0, '未找到 applyGeneratedAnalysis')
  const fnBody = src.slice(fnStart, src.indexOf('\n  }', fnStart))
  assert.ok(fnBody.includes('Object.assign(q, patch)'), '必须整体套用补丁')
  assert.equal(fnBody.includes('q.answer ='), false, '不得在 store 里另写一份答案映射')
})

// ── ⑤ 后端：两条路径都返回同一套响应契约 ────────────────────────────────
test('源码锁：ensure-analysis 的「已有解析」秒回分支也必须能反填答案', () => {
  const src = read('server/index.js')
  const start = src.indexOf("app.post('/api/questions/:id/ensure-analysis'")
  assert.ok(start >= 0, '未找到 ensure-analysis 端点')
  const end = src.indexOf('\napp.', start + 1)
  const body = src.slice(start, end < 0 ? src.length : end)
  assert.equal(body.split('syncReferenceAnswer({').length - 1, 2, '引擎新解 + 已有解析反填都要走唯一写答案实现')

  // ⛔ 关键：11-04 的版本在 existingIsUsable 时直接 return，导致「有解析、答案为空」
  //    的题点「解析」什么也不做 —— 这正是用户截图里的场景。
  const fastStart = body.indexOf('if (existingIsUsable)')
  const fastEnd = body.indexOf('const content = [q.parent_stem')
  assert.ok(fastStart >= 0 && fastEnd > fastStart, '未找到已有解析的秒回分支')
  const fastPath = body.slice(fastStart, fastEnd)
  assert.ok(fastPath.includes('if (!storedAnswer)'), '已有解析但答案为空时必须尝试反填')
  assert.ok(fastPath.includes('answer_synced: true'), '反填成功必须返回 answer_synced:true 供前端同步')
  assert.ok(fastPath.includes('is_correct'), '反填成功必须把重判结论回传')
  assert.ok(fastPath.includes('syncReferenceAnswer({'), '反填必须复用唯一写答案实现，不得另写一份结算')
})

console.log('✅ analysisAnswerSync: 全部通过（解析→参考答案联动、截图场景反填、前后端契约与缓存）')
