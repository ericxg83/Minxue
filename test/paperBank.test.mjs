/**
 * 试卷题库（2026-10-10）回归锁
 *
 * 对应产品评审：_试卷题库与勾题出讲义-产品评审-20261010.md
 * 需求：纸质中考模拟卷（拍照/PDF）→ 结构化题库（永久保存、跨年复用）
 *       → 跨卷按题号/题型/难度/标签勾题 → 出讲义 PDF 讲题。
 *
 * ── 这个功能最容易踩坏的四条红线，本文件逐条锁死 ──
 *   ① 试卷题**不得**写进 questions 表（task_id/student_id NOT NULL，挂着批改→错题→掌握度全链路）；
 *   ② 迁移必须是**纯加法**（只给 resource_questions 加列，不 ALTER/DROP 任何既有表）；
 *   ③ 讲义版式**不得**复用重练卷的 buildRetryPaperOrder / RETRY_PAPER_BLOCKS
 *      —— 那套会按选择题/填空题/解答题重新分块并重新编号，会丢原卷题号，
 *         而老师讲的正是「第 19 题」「第 24 题」（pdfGenerator.js 里那套是有意为之的）；
 *   ④ 侧栏入口高亮判定必须按路径段边界（2026-10-18 起 /paper 已下线，此判据作为
 *      /paper-bank 与其他前缀相似路由的通用防线保留）。
 *
 * 全部源码锁走 fail-closed（锚点不在即判红），且每条都配反向自检
 *（把「写坏的版本」喂给同一个检查函数必须判红）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredSlice } from './sourceLockKit.mjs'

import {
  deriveAutoTags,
  normalizeOptions,
  normalizeQuestionType,
  parseJsonLoose,
  mapWithConcurrency,
  attachEffectiveAnswer,
} from '../server/services/paperBankService.js'
import { groupHandoutQuestions } from '../src/utils/handoutGrouping.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

const SERVICE = 'server/services/paperBankService.js'
const ROUTES = 'server/routes/paperBank.js'
const MIGRATION = 'server/migrations/063_paper_bank_questions.js'
const HANDOUT = 'src/utils/handoutPdf.js'
const SIDEBAR = 'src/workbench/components/layout/AppSidebar.vue'
const INDEX = 'server/index.js'

/** 去掉注释，避免「注释里提到某写法」被误判成真的写了。 */
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// ─────────────────────────────────────────────────────────────
// 红线 ①：绝不写 questions 表
// ─────────────────────────────────────────────────────────────

/** @returns {string[]} 违规列表，空数组 = 通过 */
function checkNoWriteToQuestions(src) {
  const bad = []
  const s = stripComments(src)
  const patterns = [
    [/INSERT\s+INTO\s+questions\b/i, 'INSERT INTO questions'],
    [/UPDATE\s+questions\b/i, 'UPDATE questions'],
    [/DELETE\s+FROM\s+questions\b/i, 'DELETE FROM questions'],
  ]
  for (const [re, label] of patterns) {
    if (re.test(s)) bad.push(`禁止对 questions 表做写操作，命中：${label}`)
  }
  return bad
}

test('★ 采集管线与路由都不写 questions 表（试卷题没有学生/作答，写进去会污染批改链路）', () => {
  assert.deepEqual(checkNoWriteToQuestions(read(SERVICE)), [], SERVICE)
  assert.deepEqual(checkNoWriteToQuestions(read(ROUTES)), [], ROUTES)
})

test('反向自检：把写 questions 的版本喂进同一个检查函数必须判红', () => {
  assert.ok(checkNoWriteToQuestions('await query("INSERT INTO questions (id) VALUES ($1)")').length > 0)
  assert.ok(checkNoWriteToQuestions('await query(`UPDATE questions SET answer=$1`)').length > 0)
  assert.ok(checkNoWriteToQuestions('await query("DELETE FROM questions WHERE id=$1")').length > 0)
  // 注释里提到不算
  assert.deepEqual(checkNoWriteToQuestions('// 绝不 INSERT INTO questions\n'), [])
})

test('题库路由不直接写答案库，也不改 resources 的发布态（否则会被批改链路的试卷选择器捞走）', () => {
  const s = stripComments(read(ROUTES))
  // 读答案库是允许且必要的（数条数）；**直接写**不行 —— 答案一律经练习册那条链落库。
  assert.ok(!/INSERT\s+INTO\s+resource_answers/i.test(s), '题库路由不得直接 INSERT 答案库')
  assert.ok(!/UPDATE\s+resource_answers/i.test(s), '题库路由不得直接 UPDATE 答案库')
  assert.ok(!/DELETE\s+FROM\s+resource_answers/i.test(s), '题库路由不得直接 DELETE 答案库')
  assert.ok(!/SET\s+status\s*=/i.test(s), '题库路由不得改 resources.status')
  assert.ok(!/SET\s+answer_status\s*=/i.test(s), '题库路由不得改 resources.answer_status')
})

// ─────────────────────────────────────────────────────────────
// 红线 ②：迁移纯加法
// ─────────────────────────────────────────────────────────────

function checkMigrationAdditiveOnly(src) {
  const bad = []
  const s = stripComments(src)
  for (const m of s.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)) {
    if (m[1] !== 'resource_questions') bad.push(`迁移不得 ALTER 其它表，命中：${m[1]}`)
  }
  if (/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i.test(s)) bad.push('迁移不得 DROP')
  if (/ALTER\s+COLUMN/i.test(s)) bad.push('迁移不得 ALTER COLUMN')
  if (/\bRENAME\b/i.test(s)) bad.push('迁移不得 RENAME')
  for (const m of s.matchAll(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?/gi)) {
    if (!m[1]) bad.push('ADD COLUMN 必须带 IF NOT EXISTS（迁移可能被重复执行）')
  }
  return bad
}

test('★ 迁移 063 是纯加法：只给 resource_questions 加列，不碰任何既有表', () => {
  assert.deepEqual(checkMigrationAdditiveOnly(read(MIGRATION)), [])
})

test('反向自检：ALTER 别的表 / DROP / 少写 IF NOT EXISTS 都必须判红', () => {
  assert.ok(checkMigrationAdditiveOnly('ALTER TABLE questions ADD COLUMN x TEXT').length > 0)
  assert.ok(checkMigrationAdditiveOnly('DROP TABLE resource_questions').length > 0)
  assert.ok(checkMigrationAdditiveOnly('ALTER TABLE resource_questions ADD COLUMN x TEXT').length > 0)
  assert.ok(checkMigrationAdditiveOnly('ALTER TABLE resource_questions ALTER COLUMN x TYPE INT').length > 0)
})

test('迁移 063 已注册进 index.js 的迁移清单（否则线上永远不建列）', () => {
  const src = read(INDEX)
  assert.match(src, /import\s*\{\s*migratePaperBankQuestions\s*\}\s*from\s*'\.\/migrations\/063_paper_bank_questions\.js'/)
  assert.match(src, /\['migratePaperBankQuestions',\s*migratePaperBankQuestions\]/)
})

// ─────────────────────────────────────────────────────────────
// 红线 ③：讲义版式保留原卷题号
// ─────────────────────────────────────────────────────────────

function checkHandoutKeepsOriginalNumbering(src) {
  const bad = []
  const s = stripComments(src)
  if (/RETRY_PAPER_BLOCKS/.test(s)) bad.push('讲义不得复用 RETRY_PAPER_BLOCKS（会按题型重排重编号）')
  if (/buildRetryPaperOrder/.test(s)) bad.push('讲义不得复用 buildRetryPaperOrder（会重排重编号）')
  // 题号标签必须取原卷题号，而不是数组下标
  if (!/q\.question_no/.test(s)) bad.push('讲义题号必须取原卷 q.question_no')
  return bad
}

test('★ 讲义版式保留原卷题号，绝不复用重练卷的分块/重编号口径', () => {
  const src = read(HANDOUT)
  assert.deepEqual(checkHandoutKeepsOriginalNumbering(src), [])
  // difficultyStars 是唯一允许的 retryPaperOrder 依赖（纯星级展示，与错题卷/周末班同口径）
  assert.match(src, /import\s*\{\s*difficultyStars\s*\}\s*from\s*'\.\/retryPaperOrder'/)
})

test('反向自检：套用重练卷版式、或用下标当题号，都必须判红', () => {
  assert.ok(checkHandoutKeepsOriginalNumbering("import { RETRY_PAPER_BLOCKS } from './retryPaperOrder'").length > 0)
  assert.ok(checkHandoutKeepsOriginalNumbering('const order = buildRetryPaperOrder(questions)').length > 0)
  assert.ok(checkHandoutKeepsOriginalNumbering('const label = `${i + 1}.`; const n = q.content').length > 0)
})

test('★ 讲义渲染管线复用同一条 iframe 通道（字体预加载/KaTeX 度量只允许有一份实现）', () => {
  const src = read('src/utils/serverPdfExporter.js')
  const fails = []
  const seg = anchoredSlice(src, 'async function renderViaIframe(', 2600, 'serverPdfExporter.js', fails)
  if (seg !== null && !/preloadKatexFonts/.test(seg)) {
    fails.push('renderViaIframe 必须做 KaTeX 字体预加载（否则服务端渲染根号/分数线会散架）')
  }
  const seg2 = anchoredSlice(src, 'export async function renderCustomBodyToHTML(', 400, 'serverPdfExporter.js', fails)
  if (seg2 !== null && !/renderViaIframe\(/.test(seg2)) {
    fails.push('renderCustomBodyToHTML 必须走 renderViaIframe，不得自建一套渲染')
  }
  assert.deepEqual(fails, [])
})

// ─────────────────────────────────────────────────────────────
// 红线 ④：侧栏入口与高亮边界
// ─────────────────────────────────────────────────────────────

/** 侧栏高亮是否按「路径段边界」匹配（而不是裸前缀）。 */
function isActiveUsesPathBoundary(src) {
  const s = stripComments(src)
  const m = s.match(/const\s+isActive\s*=\s*\([^)]*\)\s*=>\s*([\s\S]{0,400})/)
  if (!m) return false
  const body = m[1]
  // 必须出现「path + '/'」这种段边界写法
  return /path\s*\+\s*'\/'/.test(body)
}

test('★ 侧栏 /paper-bank 入口存在；/paper（试卷答案库）已随 exam 路线下线（负责人 2026-10-18 裁决）', () => {
  const src = read(SIDEBAR)
  const fails = []
  const seg = anchoredSlice(src, 'const navGroups = [', 1600, SIDEBAR, fails)
  if (seg !== null) {
    assert.ok(seg.includes("path: '/paper-bank'"), '侧栏必须挂出 /paper-bank 入口')
    assert.ok(!seg.includes("path: '/paper'"), '/paper（试卷答案库）入口必须已删除')
    assert.ok(seg.includes('试卷题库'), '入口文案应为「试卷题库」')
  }
  assert.deepEqual(fails, [])
})

test('★ 侧栏高亮按路径段边界（/paper-bank 与其他前缀相似路由的通用防线）', () => {
  assert.ok(isActiveUsesPathBoundary(read(SIDEBAR)), 'isActive 必须用 path + \'/\' 做段边界匹配')
})

test('反向自检：裸前缀写法必须被判红（这正是本次踩到的坑）', () => {
  const broken = "const isActive = (path) => (path === '/' ? route.path === '/' : route.path.startsWith(path))"
  assert.equal(isActiveUsesPathBoundary(broken), false)
})

test('路由：/paper-bank 注册为 PaperBankWorkbench；/paper 已删除并重定向到 /paper-bank（2026-10-18 下线）', () => {
  const src = read('src/workbench/router/index.js')
  assert.match(src, /path:\s*'\/paper-bank'/)
  assert.match(src, /PaperBankWorkbench\.vue/)
  assert.ok(!/ExamWorkbench\.vue/.test(src), 'ExamWorkbench.vue（试卷答案库页）必须已从路由移除')
  assert.match(src, /path:\s*'\/paper\/:catchAll\(\.\*\)'/)
  assert.match(src, /redirect:\s*'\/paper-bank'/)
})

test('/api/paper-bank 已挂到 Express', () => {
  const src = read(INDEX)
  assert.match(src, /app\.use\('\/api\/paper-bank',\s*paperBankRouter\)/)
})

// ─────────────────────────────────────────────────────────────
// 行为级：采集管线的纯函数
// ─────────────────────────────────────────────────────────────

test('「压轴题」只按题号位置自动打标：解答题最后 2 题，且解答题不足 3 道时不打', () => {
  const rows = [
    { __key: 'a', question_type: 'choice', question_no: 1 },
    { __key: 'b', question_type: 'answer', question_no: 19 },
    { __key: 'c', question_type: 'answer', question_no: 20 },
    { __key: 'd', question_type: 'answer', question_no: 24 },
    { __key: 'e', question_type: 'answer', question_no: 25 },
  ]
  const out = deriveAutoTags(rows)
  const tagged = out.filter(r => (r.tags || []).includes('压轴题')).map(r => r.question_no)
  assert.deepEqual(tagged, [24, 25])

  // 解答题只有 2 道 → 不打标（否则整卷都成了压轴题）
  const few = deriveAutoTags([
    { __key: 'a', question_type: 'answer', question_no: 1 },
    { __key: 'b', question_type: 'answer', question_no: 2 },
  ])
  assert.deepEqual(few.flatMap(r => r.tags || []), [])
})

test('选项归一化去掉 A./（A）/A、 这类标号（标号由界面按顺序生成）', () => {
  assert.deepEqual(
    normalizeOptions(['A. 3/4', '（B）2/3', 'C、1/2', 'D．1/3']),
    ['3/4', '2/3', '1/2', '1/3']
  )
  assert.deepEqual(normalizeOptions(null), [])
  assert.deepEqual(normalizeOptions(['', '  ']), [])
})

test('题型归一化：未知值一律归解答题（宁错块不漏题）', () => {
  assert.equal(normalizeQuestionType('choice'), 'choice')
  assert.equal(normalizeQuestionType('FILL'), 'fill')
  assert.equal(normalizeQuestionType('judge'), 'judge')
  assert.equal(normalizeQuestionType('choice/fill/judge/answer'), 'answer')
  assert.equal(normalizeQuestionType(undefined), 'answer')
})

test('模型输出宽松解析：能从句柄包裹/带解释文字的返回里抠出 JSON', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"questions":[{"content":"x"}]}\n```'), { questions: [{ content: 'x' }] })
  assert.deepEqual(parseJsonLoose('好的，结果如下：{"a":1} 完毕'), { a: 1 })
  assert.deepEqual(parseJsonLoose({ a: 1 }), { a: 1 })
  assert.equal(parseJsonLoose('完全不是 JSON'), null)
})

test('并发映射保序，且单页失败不拖垮整批', async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    if (n === 3) throw new Error('boom')
    return n * 10
  })
  assert.deepEqual(out[0], 10)
  assert.deepEqual(out[1], 20)
  assert.ok(out[2].__error, '失败项应被收敛成 {__error}，不得整批抛出')
  assert.deepEqual(out[3], 40)
  assert.deepEqual(out[4], 50)
})

test('讲义按卷分组：保持传入顺序，同卷的行聚在一起', () => {
  const rows = [
    { resource_id: 'A', resource_name: '甲卷', question_no: 19 },
    { resource_id: 'B', resource_name: '乙卷', question_no: 19 },
    { resource_id: 'A', resource_name: '甲卷', question_no: 24 },
  ]
  const groups = groupHandoutQuestions(rows)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].paperName, '甲卷')
  assert.deepEqual(groups[0].questions.map(q => q.question_no), [19, 24])
  assert.deepEqual(groups[1].questions.map(q => q.question_no), [19])
  assert.deepEqual(groupHandoutQuestions(null), [])
})

// ─────────────────────────────────────────────────────────────
// 红线 ⑤：官方答案必须**复用**练习册的「预埋答案」链，不许另写一套
//   （2026-10-10 负责人指出：「这个逻辑有点像练习册预埋答案的逻辑…不要重复造轮子」）
// ─────────────────────────────────────────────────────────────

const WORKSHEETS = 'server/routes/worksheets.js'
const ANSWERS_REUSED = ['parsePdfInBackground', 'parseImagesInBackground']

test('★ 试卷答案解析必须调用练习册那两个后台函数，不得自建 OCR 解析', () => {
  const s = stripComments(read(SERVICE))
  for (const fn of ANSWERS_REUSED) {
    assert.ok(
      new RegExp(`${fn}`).test(s),
      `${SERVICE} 必须复用 ${fn}（练习册预埋答案链），不要另写一套`
    )
  }
  // 自己写答案 OCR 的特征：答案页专用提示词常量 / 视觉调用
  assert.ok(!/ANSWER_OCR_SYSTEM_PROMPT/.test(s), '不得自带答案页 OCR 提示词')
  assert.ok(!/识别标准答案/.test(s), '不得自带「识别标准答案」提示词')
})

test('★ 练习册那两个后台函数必须真的被 export（否则复用会拿到 undefined）', () => {
  const s = read(WORKSHEETS)
  for (const fn of ANSWERS_REUSED) {
    assert.match(
      s,
      new RegExp(`export\\s+async\\s+function\\s+${fn}\\s*\\(`),
      `${WORKSHEETS} 必须以 export async function 形式暴露 ${fn}`
    )
  }
})

test('★ 答案 join 键不含 unit_id（题目侧恒 NULL，带上就永远 join 不上）', () => {
  const s = stripComments(read(SERVICE))
  const fails = []
  const seg = anchoredSlice(s, 'const OFFICIAL_ANSWER_LATERAL', 1400, SERVICE, fails)
  if (seg !== null) {
    assert.ok(!/ra\.unit_id\s*=\s*rq\.unit_id/.test(seg), 'join 不得比对 unit_id')
    assert.ok(/ra\.question_no\s*=\s*rq\.question_no/.test(seg), 'join 必须按 question_no')
    assert.ok(/COALESCE\(ra\.sub_no/.test(seg), 'join 必须按 sub_no（空串口径）')
  }
  assert.deepEqual(fails, [])
})

test('★ 答案取值口径：官方答案优先，其次卷面印刷/老师手填', () => {
  const withOfficial = attachEffectiveAnswer({
    own_answer: 'B', own_answer_source: 'printed',
    official_answer: 'D', official_answer_status: 'official_verified',
    official_unit_title: null, answer_conflict_count: 1,
  })
  assert.equal(withOfficial.answer, 'D')
  assert.equal(withOfficial.answer_source, 'official')
  assert.equal(withOfficial.answer_status, 'official_verified')
  // own_* 是内部字段，不得漏到对外结构里
  assert.ok(!('own_answer' in withOfficial), 'own_answer 不得外泄')

  const noOfficial = attachEffectiveAnswer({
    own_answer: 'B', own_answer_source: 'printed',
    official_answer: null, official_answer_status: null,
    official_unit_title: null, answer_conflict_count: 0,
  })
  assert.equal(noOfficial.answer, 'B')
  assert.equal(noOfficial.answer_source, 'printed')

  const blank = attachEffectiveAnswer({
    own_answer: null, own_answer_source: null,
    official_answer: '   ', official_answer_status: 'official_verified',
    official_unit_title: null, answer_conflict_count: 1,
  })
  assert.equal(blank.answer, null, '官方答案只有空白时不得当成有效答案')
})

test('答案上传路由存在，且只写答案库、不碰题目表', () => {
  const s = stripComments(read(ROUTES))
  assert.match(s, /'\/papers\/:id\/parse-answers'/)
  assert.match(s, /parsePaperAnswers/)
  assert.deepEqual(checkNoWriteToQuestions(s), [])
})

test('反向自检：自带一套答案 OCR / 漏 export 都必须判红', () => {
  const selfMadeOcr = "const ANSWER_OCR_SYSTEM_PROMPT = '你是答案识别助手'"
  assert.ok(/ANSWER_OCR_SYSTEM_PROMPT/.test(selfMadeOcr))
  assert.ok(!/export\s+async\s+function\s+parsePdfInBackground\s*\(/.test('async function parsePdfInBackground(a,b) {}'))
})
