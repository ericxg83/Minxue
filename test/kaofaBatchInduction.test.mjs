/**
 * 分批喂回归锁（r221）
 *
 * ⛔ 这道闸为什么必须有：r221 实测发现 `limit=30`（r145 三档实测的最优值：归类率 100%、
 *   每考法证据题 8 道、耗时反而更短）被 `auto-organize` 当成「每考点只跑一批」用
 *   ⇒ 超过 30 道的错题全部漏跑。实测：三角形 171 道只喂 30 道（漏 141）、
 *   二次根式 156（漏 126）…… 12 个考点**合计漏约 920 道**。
 *   ⇒ 不是「AI 归不了」，是「没喂给它」。
 *
 * 判据（缺一条就会静默退化，且都不报错、测试全绿）：
 *   1. 供给 SQL 必须排除已归类的题 —— 否则第二批重复归纳第一批的题、考法数量翻倍
 *   2. `maxBatches` 默认必须是 1（保留旧行为）；上限 10（35 批会超 HTTP 超时）
 *   3. 第 2 批起必须把**已有考法**当候选喂给 AI（否则考法数线性膨胀）
 *   4. `itemCount` 在复用已有考法时必须**累加**，不能被本批覆盖
 *      （否则 examples 表在追加、summary 在替换 ⇒ 两处数据对不上）
 *   5. 进度必须可透出（老师不能对着 15 分钟的跑批干等）
 *   6. 连续失败要能止损，不能白烧 token
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(resolve(ROOT, 'server/services/kaofaInduction.js'), 'utf8')
const ROUTE = readFileSync(resolve(ROOT, 'server/routes/teachingQuestionTypes.js'), 'utf8')

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
const CODE = stripComments(SRC)

// ── 1. 供给 SQL 必须排除已归类的题（防重复归纳）──────────────────────
test('分批：供给 SQL 必须排除已归类的题', () => {
  assert.match(
    CODE,
    /excludeQuestionIds\s*=\s*\[\]/,
    'fetchKpWrongQuestions 必须接 excludeQuestionIds 参数 —— 分批时不排除已归类的题会重复归纳、考法翻倍。',
  )
  // 关键：SQL 里真的带了 NOT EXISTS 判断
  const fn = CODE.slice(CODE.indexOf('export async function fetchKpWrongQuestions'))
  const sql = fn.slice(0, fn.indexOf('return rows.map'))
  assert.match(
    sql,
    /NOT EXISTS\s*\(\s*SELECT 1 FROM teaching_question_type_examples e\s+WHERE e\.source_question_id\s*=\s*q\.id\s*\)/,
    '供给 SQL 必须用 NOT EXISTS 排除已归入考法的题 —— 只声明参数不加进 SQL 等于没实现。',
  )
})

test('分批：必须暴露剩余未归类的计数（进度要用，且不喂 AI）', () => {
  assert.match(
    CODE,
    /export async function fetchKpRemainingCount/,
    '必须提供「还剩多少没归类」的计数，UI 才能显示进度。',
  )
  const fn = CODE.slice(CODE.indexOf('export async function fetchKpRemainingCount'))
  const sql = fn.slice(0, fn.indexOf('return rows[0]'))
  assert.match(
    sql,
    /NOT EXISTS \(SELECT 1 FROM teaching_question_type_examples/,
    '剩余计数的 SQL 也要排除已归类的题，否则进度永远是错的。',
  )
})

// ── 2. maxBatches 默认 1 + 上限 10 ──────────────────────────────────
test('分批：maxBatches 默认 1（保留旧行为）且上限 10', () => {
  assert.match(
    CODE,
    /maxBatches\s*=\s*1\s*,/,
    'maxBatches 必须默认 1：默认就跑多批会让单次请求超时，且旧调用方行为突变。',
  )
  // ⚠️ 夹紧后的变量名是 `batches`（不是 maxBatches）—— 断言要跟实现对齐，
  //   但语义仍必须校验：上限 10、下限 1。
  assert.match(
    CODE,
    /const batches = Math\.min\(Math\.max\(Number\(maxBatches\) \|\| 1, 1\), 10\)/,
    'maxBatches 必须夹在 1..10：实测 25s/批，35 批会远超 HTTP 超时，必须分次触发。',
  )
  assert.match(
    ROUTE,
    /maxBatches = Math\.min\(Math\.max\(Number\(req\.body\?\.maxBatches\) \|\| 1, 1\), 10\)/,
    '路由必须收 maxBatches 并夹紧（不能把任意大值透传给服务）。',
  )
})

test('分批：maxBatches 必须真的传进服务（否则参数是摆设）', () => {
  assert.match(
    ROUTE,
    /induceMethodsForKp\(\{[^}]*maxBatches/,
    '路由必须把 maxBatches 传给 induceMethodsForKp，否则整轮改造白做（这正是 r145「apply 没传」同款bug）。',
  )
  assert.match(
    ROUTE,
    /dryRun: !apply \}\)/,
    '⛔ 铁律 9：dryRun 必须由 apply 取反得来。r145 事故就是 apply/dryRun 名字不同义导致写库被静默跳过。',
  )
})

// ── 3. 第 2 批起复用已有考法 ────────────────────────────────────────
test('分批：第 2 批起必须把已有考法当候选喂给 AI', () => {
  assert.match(
    CODE,
    /const existing\s*=\s*b\s*===\s*1\s*\?\s*\[\]\s*:\s*await fetchExistingMethods/,
    '第 1 批建考法、第 2 批起复用 —— 否则每批都造新考法，考法数会线性膨胀。',
  )
  assert.match(
    CODE,
    /buildPrompt\(\s*kpName\s*,\s*\[\.\.\.kpVocab\]\s*,\s*questions\s*,\s*existing\s*\)/,
    'buildPrompt 必须接已有考法作为第 4 参 —— 声明了候选却不传，AI 看不到它。',
  )
  // 提示词里必须有「优先复用」的指令段
  assert.match(
    CODE,
    /优先复用，不要重复造/,
    '提示词必须明确要求优先复用已有考法。',
  )
  assert.match(
    CODE,
    /function fetchExistingMethods/,
    '必须有独立的 fetchExistingMethods 取已有考法。',
  )
  // 取已有考法的 SQL 要排除 archived（归档的考法不该再当候选）
  const fn = CODE.slice(CODE.indexOf('async function fetchExistingMethods'))
  const sql = fn.slice(0, fn.indexOf('return rows'))
  assert.match(
    sql,
    /t\.status\s*<>\s*'archived'/,
    '取已有考法必须排除 archived —— 归档等于老师不认可，不该再当候选塞回给 AI。',
  )
})

// ── 4. itemCount 必须累加（这是最容易静默出错的一处）─────────────────
test('分批：复用已有考法时 itemCount 必须累加而非覆盖', () => {
  const fn = CODE.slice(CODE.indexOf('const { rows } = await query'), CODE.indexOf('return { typeId, inserted'))
  assert.match(
    fn,
    /ON CONFLICT \(user_id, kp_id, name\) DO UPDATE SET[\s\S]*?auto_summary\s*=\s*teaching_question_types\.auto_summary\s*\|\|\s*EXCLUDED\.auto_summary/,
    'auto_summary 必须用 || 合并（保留旧字段），不能整块替换。',
  )
  assert.match(
    fn,
    /'itemCount',\s*\(SELECT COUNT\(\*\)::int FROM teaching_question_type_examples x[\s\S]*?\+\s*COALESCE\(jsonb_array_length\(/,
    "⛔ itemCount 必须 = examples 实际行数 + 本批新增。旧写法 EXCLUDED.auto_summary整块替换会让 13 道题的考法退成 5 道，而 examples 表仍在追加 ⇒ 两处数据对不上、界面显示「5 道」实际挂着 18 道。",
  )
  assert.doesNotMatch(
    fn,
    /ON CONFLICT[^]*?DO UPDATE SET\s*\n?\s*auto_summary\s*=\s*EXCLUDED\.auto_summary\s*,/,
    '不得用 auto_summary = EXCLUDED.auto_summary（整块替换），它会在分批复用时把历史题数清零。',
  )
})

// ── 5. 进度可透出 ───────────────────────────────────────────────────
test('分批：进度必须透出到接口（老师不能对着 15 分钟干等）', () => {
  assert.match(
    CODE,
    /progress:\s*\{[\s\S]*?batchesRun[\s\S]*?remainingBefore[\s\S]*?remainingAfter[\s\S]*?allDone/,
    'progress 必须含批次 / 跑前剩余 / 跑后剩余 / 是否跑完 —— 缺一项前端就画不出进度。',
  )
  assert.match(
    ROUTE,
    /progress:\s*r\.progress\s*\|\|\s*null/,
    '路由必须把 progress 透出到接口，否则服务里算了也白算。',
  )
  assert.match(
    CODE,
    /batchInfo\.push\(\{/,
    '每批的明细（题数/产出/拒绝/复用数/耗时/失败）必须记进 progress.detail。',
  )
})

// ── 6. 连续失败要止损 ───────────────────────────────────────────────
test('分批：连续失败要止损，不能白烧 token', () => {
  assert.match(
    CODE,
    /consecutiveErrors\s*>=\s*2/,
    '连续 2 批失败必须停止 —— 单批失败可容错（沿用 r145），但连续失败说明 AI 挂了，继续跑只是烧钱。',
  )
  assert.match(
    CODE,
    /res\.error\s*\?\s*consecutiveErrors\s*\+\s*1\s*:\s*0/,
    '失败计数必须有归零逻辑，否则一次成功后仍会因累计次数停机。',
  )
})

// ── 7. 已归完 ≠ 出错 ────────────────────────────────────────────────
test('分批：「已全部分类完毕」是成功不是跳过', () => {
  assert.match(
    CODE,
    /if \(questions\.length === 0\) skipReason =/,
    '没有未归类的题时要说清楚「已归完」，不能报成 skipped/error —— 否则老师以为失败了。',
  )
})

// ── 8. ⛔ SQL 注释里绝不能出现反引号（r221 实测整轮写入失败）────────────
test('⛔ SQL 模板字符串里不能有反引号（会提前闭合模板串）', () => {
  // r221 实测：为了说明 jsonb 优先级，我在 SQL 注释里写了 `a->'items'::jsonb`，
  // 结果反引号**提前闭合了 JS 模板字符串** ⇒ SyntaxError: missing ) after argument list
  // ⇒ 后端整个起不来（不是「这一条功能坏了」，是全站 500）。
  const sqlBlocks = [...CODE.matchAll(/`([^`]*)`/g)].map(m => m[1])
  const risky = sqlBlocks.filter(block =>
    /^\s*(INSERT|UPDATE|SELECT|DELETE|WITH)\b/i.test(block.trim()) && block.includes('`'))
  assert.equal(risky.length, 0,
    'SQL 模板字符串内部出现反引号会提前闭合模板串（r221 实测后端直接 SyntaxError 起不来）。注释里请用普通引号或中文描述。')

  // 顺带：itemCount 那段不能带 ::jsonb 强转（优先级会把 'items' 转 jsonb）
  assert.doesNotMatch(
    CODE,
    /jsonb_array_length\(\s*EXCLUDED\.auto_summary\s*->\s*'items'\s*::\s*jsonb\s*\)/,
    "⛔ EXCLUDED.auto_summary->'items'::jsonb 会按优先级变成 auto_summary -> ('items'::jsonb)，把字符串转 jsonb ⇒ invalid input syntax for type json（r221 实测整轮写入失败）。直接用 ->'items'（返回的已是 jsonb）。",
  )
})

// ── 9. 模块必须能加载（防注释/字符串层面的硬语法错误）───────────────
test('模块语法必须合法（SQL 注释里的反引号会整站起不来）', async () => {
  await assert.doesNotReject(
    () => import('../server/services/kaofaInduction.js'),
    'kaofaInduction.js 必须能被 import —— r221 曾在 SQL 注释里写反引号，导致后端 SyntaxError 全站 500。',
  )
})