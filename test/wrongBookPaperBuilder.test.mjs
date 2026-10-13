/**
 * 错题管理扩展（2026-10-13）回归锁
 *
 * 覆盖三块改动：
 *   ① M1 错题搜索的「参考答案 + 来源标注」
 *   ② M2 教师版（showAnalysis）解析渲染 —— 默认路径必须一字不变
 *   ③ M4 按知识点组卷（班级卷：不落库、不带二维码、只从错题组、按共错人数排序）
 *
 * 写法纪律（本仓铁律）：源码锁一律走 sourceLockKit 的 anchoredSlice / anchoredRange，
 * ⛔ 不用 `const i = src.indexOf(x); if (i >= 0 && ...)` —— 锚点一改名就静默失效，
 *    「把代码改坏的那次重构会顺手把盯着它的锁一起关掉」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { anchoredSlice, anchoredRange, includesLit } from './sourceLockKit.mjs'
import {
  resolveTeacherAnswerBlock,
  teacherOriginNote,
  ANSWER_MISSING_TEXT,
} from '../src/utils/teacherPaperExtras.js'
import { getReferenceAnswerOrigin } from '../src/utils/reviewDecision.js'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

const PDF_GEN = read('../src/utils/pdfGenerator.js')
const SEARCH_PAGE = read('../src/workbench/views/WrongBookSearch.vue')
const KP_ROUTES = read('../server/routes/teachingQuestionTypes.js')
const SERVER_INDEX = read('../server/index.js')

// ════════════════════════════════════════════════════════════════════
// A. 教师版决策：默认关闭 + 来源标注 + 缺答案不兜底（直接跑线上那个函数）
// ════════════════════════════════════════════════════════════════════

test('教师版决策：未传 showAnalysis 时全关闭（默认路径一字不变）', () => {
  const b = resolveTeacherAnswerBlock({ answer: '3', analysis: '因为…', answerSource: 'worksheet' })
  assert.equal(b.enabled, false, '默认必须关闭')
  assert.equal(b.hasAnswer, false)
  assert.equal(b.answerMissing, false)
  assert.equal(b.hasAnalysis, false)
  assert.equal(b.originLabel, '')
  assert.equal(teacherOriginNote(b), '', '关闭时不得产出任何来源文案')
})

test('教师版决策：只有 === true 才开启（反向自检：undefined/null/0/"true" 一律不开）', () => {
  const base = { answer: '3', analysis: '因为…', answerSource: 'worksheet' }
  for (const v of [undefined, null, 0, '', 'true', 1, {}]) {
    const b = resolveTeacherAnswerBlock({ ...base, showAnalysis: v })
    assert.equal(b.enabled, false, `showAnalysis=${JSON.stringify(v)} 不应开启教师版`)
  }
  assert.equal(resolveTeacherAnswerBlock({ ...base, showAnalysis: false }).enabled, false)
  assert.equal(resolveTeacherAnswerBlock({ ...base, showAnalysis: true }).enabled, true)
})

test('教师版决策：有答案有解析 → 两块都印', () => {
  const b = resolveTeacherAnswerBlock({ answer: '3', analysis: '因为…', answerSource: 'worksheet', showAnalysis: true })
  assert.equal(b.hasAnswer, true)
  assert.equal(b.answerMissing, false)
  assert.equal(b.hasAnalysis, true)
})

test('教师版决策：答案为空时只标「未录入」，绝不兜底（口径：宁可留空转人工）', () => {
  const b = resolveTeacherAnswerBlock({ answer: '   ', analysis: '因为…', showAnalysis: true })
  assert.equal(b.hasAnswer, false, '空白答案不得当作有答案')
  assert.equal(b.answerMissing, true, '必须走「本卷未录入」分支')
  assert.equal(b.originLabel, '', '没答案就不该有来源签（不能凭空说来源）')
  assert.equal(ANSWER_MISSING_TEXT, '本卷未录入')
})

test('教师版决策：答案来源沿用唯一口径（答案库 / AI 解答），不自行判断', () => {
  const bank = resolveTeacherAnswerBlock({ answer: '3', answerSource: 'worksheet', showAnalysis: true })
  assert.equal(bank.originLabel, '答案库')
  assert.equal(bank.originIsAi, false)

  // 其余取值（recognized / blank / teacher_input / null）一律归 AI 解答 —— 与
  // getReferenceAnswerOrigin 同口径，本模块不得另立规则
  for (const src of [null, undefined, 'recognized', 'blank', 'teacher_input']) {
    const b = resolveTeacherAnswerBlock({ answer: '3', answerSource: src, showAnalysis: true })
    assert.equal(b.originLabel, getReferenceAnswerOrigin({ answer: '3', answer_source: src }).label)
    assert.equal(b.originIsAi, true, `answerSource=${src} 应归 AI 解答并提示「仅供参考」`)
  }
})

test('教师版来源文案：AI 求解必须带「仅供参考」，答案库不带', () => {
  const ai = teacherOriginNote(resolveTeacherAnswerBlock({ answer: '2√2', answerSource: null, showAnalysis: true }))
  assert.match(ai, /AI 解答/)
  assert.match(ai, /仅供参考/, 'AI 算的答案必须提醒老师核对')
  const bank = teacherOriginNote(resolveTeacherAnswerBlock({ answer: '3', answerSource: 'worksheet', showAnalysis: true }))
  assert.match(bank, /答案库/)
  assert.doesNotMatch(bank, /仅供参考/)
})

// ════════════════════════════════════════════════════════════════════
// B. 源码锁：教师版块必须被 showAnalysis 守卫，且判定不许有第二处实现
// ════════════════════════════════════════════════════════════════════

test('pdfGenerator：教师版块必须走 teacherPaperExtras，且不得自行 import 来源判定', () => {
  const fails = []
  const seg = anchoredSlice(PDF_GEN, 'resolveTeacherAnswerBlock', 200, 'pdfGenerator 教师版决策', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(seg.includes('teacherPaperExtras'), '必须从 teacherPaperExtras 引入决策')
  // ⛔ 不得在 pdfGenerator 里再引一份 getReferenceAnswerOrigin 自己判来源。
  //    只看 import 语句（注释里提到函数名不算）—— 判定只能有一处
  //    （teacherPaperExtras → reviewDecision）。
  assert.ok(
    !/^\s*import[^\n]*getReferenceAnswerOrigin/m.test(PDF_GEN),
    'pdfGenerator 不得直接 import getReferenceAnswerOrigin —— 来源判定只能有一处（teacherPaperExtras → reviewDecision）'
  )
})

test('pdfGenerator：解析渲染必须在 teacher.enabled 守卫之内（默认路径不得产出解析块）', () => {
  const fails = []
  // 从答案块起点切到答案块结束，断言 answer-analysis 只出现在 enabled 守卫之后
  const seg = anchoredRange(
    PDF_GEN,
    'const teacher = resolveTeacherAnswerBlock({',
    'html += `</div>`\n    })',
    'pdfGenerator 答案块',
    fails
  )
  assert.equal(fails.length, 0, fails.join(' | '))
  const guard = seg.indexOf('if (teacher.enabled)')
  const analysis = seg.indexOf('answer-analysis')
  assert.ok(guard >= 0, '教师版块必须有 teacher.enabled 守卫')
  assert.ok(analysis > guard, 'answer-analysis 必须出现在守卫之后，否则学生版会印出解析')
})

test('pdfGenerator：教师版 CSS 类必须存在（否则印出来是裸文字）', () => {
  for (const cls of ['.answer-note{', '.answer-analysis{', '.answer-key.is-missing{']) {
    assert.ok(PDF_GEN.includes(cls), `缺少样式 ${cls}`)
  }
})

// ════════════════════════════════════════════════════════════════════
// C. 源码锁：班级卷的三条红线（不落库 / 不带二维码 / 只组错题）
// ════════════════════════════════════════════════════════════════════

test('组卷页：班级卷不得创建 generated_exams（否则污染「待批改」口径）', () => {
  assert.ok(
    !SEARCH_PAGE.includes('createGeneratedExam'),
    '组卷页不得调用 createGeneratedExam —— 班级卷没有对应学生，硬塞会污染待批改口径'
  )
})

test('组卷页：出卷不得传 qrContent（无二维码 = 不进批改链路）', () => {
  const fails = []
  const seg = anchoredSlice(SEARCH_PAGE, 'const result = await exportWrongBookPDF({', 400, '组卷导出调用', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(!seg.includes('qrContent'), '班级卷不得传 qrContent —— 它是「课上讲」的卷，不是给学生的作业')
  assert.ok(seg.includes('showAnalysis'), '教师版必须传 showAnalysis')
  assert.ok(seg.includes('showAnswers'), '必须显式控制是否印答案')
})

test('组卷页：只从错题组卷（onlyWrong=1），不与「通用题库」混', () => {
  const fails = []
  const seg = anchoredSlice(SEARCH_PAGE, 'await getKpQuestions({', 300, '组卷取数', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(/onlyWrong:\s*true/.test(seg), '组卷必须只取有人错过的题')
  assert.ok(/includeChildren:\s*true/.test(seg), '选父节点（≈章节）时要递归展开子孙')
})

test('组卷页：切到组卷模式必须拉知识点（否则左栏永远是空的）', () => {
  const fails = []
  const seg = anchoredSlice(SEARCH_PAGE, 'watch(mode,', 220, '模式切换加载知识点', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(seg.includes('loadKpRanking'), '进入组卷模式必须触发知识点加载（懒加载，只拉一次）')
})

test('组卷页：候选必须按「共错人数」重排（后端按错次排，不改后端）', () => {
  const fails = []
  const seg = anchoredSlice(SEARCH_PAGE, 'candidates.value = [...data.questions].sort(', 260, '候选重排', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(/studentCount/.test(seg), '必须按 studentCount（几个人错了）降序 —— 「5 人各错 1 次」比「1 人错 5 次」更该全班讲')
})

test('后端 kp-questions：排序口径不得改（它同时被考法库页与周末班课件消费）', () => {
  assert.ok(
    includesLit(KP_ROUTES, 'ORDER BY wrong_count DESC, student_count DESC, q.id'),
    'kp-questions 的排序被改动 —— 该接口有别的消费方，排序差异必须在页面侧解决'
  )
})

test('后端 kp-questions：必须返回 parent_stem（多小问共享题干，漏了组卷会「缺条件」）', () => {
  assert.ok(
    includesLit(KP_ROUTES, 'q.answer_source, q.parent_stem, q.sub_no, q.question_number,'),
    'kp-questions 必须带出 parent_stem / sub_no / question_number / answer_source'
  )
  assert.ok(
    includesLit(KP_ROUTES, 'parentStem: r.parent_stem,'),
    '映射层必须把 parent_stem 透出为 parentStem'
  )
})

// ════════════════════════════════════════════════════════════════════
// D. 源码锁：错题搜索的答案 + 来源标注（M1）
// ════════════════════════════════════════════════════════════════════

test('错题搜索接口：必须返回 answer_source 与 analysis（来源标注的数据来源）', () => {
  assert.ok(
    includesLit(SERVER_INDEX, 'q.analysis,\n         q.answer_source,'),
    'search 接口必须补 analysis / answer_source —— 少了它前端只能显示一个「裸的正确答案」'
  )
})

test('错题搜索页：来源签必须复用唯一判定，不得自行比对 answer_source', () => {
  assert.ok(
    includesLit(SEARCH_PAGE, "import { getReferenceAnswerOrigin } from '../../utils/reviewDecision'"),
    '搜索页必须 import 唯一来源判定'
  )
  // ⛔ 不得出现 `answer_source === 'worksheet'` 这类第二处判定
  assert.ok(
    !/answer_source\s*===\s*'worksheet'/.test(SEARCH_PAGE),
    '搜索页不得自行判断来源 —— 判定只能有一处（reviewDecision#getReferenceAnswerOrigin）'
  )
})

test('错题搜索页：结果卡片必须渲染参考答案与来源签', () => {
  const fails = []
  const seg = anchoredSlice(SEARCH_PAGE, '<div class="answer-line">', 700, '搜索结果答案行', fails)
  assert.equal(fails.length, 0, fails.join(' | '))
  assert.ok(seg.includes('参考答案'), '必须显示「参考答案」字样')
  assert.ok(seg.includes('originOf(item)'), '必须挂来源签')
  assert.ok(seg.includes('未录入'), '没有答案时必须明说「未录入」，不能留空让人以为是空白')
})
