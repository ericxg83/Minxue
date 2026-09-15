// 回归测试：error_count 虚增的两处根治（2026-09-14 污染清洗后的代码防线）
//
// 事故背景：
//   A. 练习册批改链路多波重跑（09-09 答案错位事故后的修复回填），每次重跑
//      addSelfContainedWrongQuestion 的 ON CONFLICT 无条件 error_count+1，
//      5 个学生 36 行被刷到 err=2~9（真实做错只有 1 次）。
//   B. 重练结算 finalizeGeneratedExamResults 曾因 42804 半提交 + 审计未落库，
//      老师每点一次复核就重复推进一次（err 刷到 28、prac 刷到 31、假 mastered）。
//
// 本测试锁定：
//   A. 练习册入册必须按 last_wrong_task_id 条件增量（同任务重跑不加、换任务才 +1、
//      无 taskId 不加），worker 调用必须传 taskId，迁移 058 必须注册进启动链。
//   B. 重练结算的全部写入（错题推进/题目回写/exam 标记/结算审计）必须在同一事务内；
//      结算审计必须在事务内直写 client（createJudgement 吞异常且走连接池，禁用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const NEON = 'server/services/neonService.js'
const FINALIZER = 'server/services/gradingFinalizer.js'
const WORKER = 'server/worker.js'
const INDEX = 'server/index.js'
const MIGRATION = 'server/migrations/058_add_wrong_questions_last_wrong_task_id.js'

const sliceFrom = (src, marker) => {
  const i = src.indexOf(marker)
  assert.ok(i > 0, `源码中未找到标记: ${marker}`)
  return src.slice(i)
}

// ---------- 修复 1：练习册入册条件增量 ----------

test('addSelfContainedWrongQuestion 必须接收 taskId 参数', () => {
  const fn = sliceFrom(read(NEON), 'export const addSelfContainedWrongQuestion')
  // params 解构在函数体开头（taskId = null 默认值）
  const head = fn.slice(0, 800)
  assert.match(head, /taskId\s*=\s*null/, '参数解构必须含 taskId（默认 null）')
})

test('ON CONFLICT 不允许无条件 error_count+1，必须按 last_wrong_task_id 条件增量', () => {
  const fn = sliceFrom(read(NEON), 'export const addSelfContainedWrongQuestion')
  // 无条件增量形态已消失
  const bare = fn.match(/error_count = \$\{TABLES\.WRONG_QUESTIONS\}\.error_count \+ 1/g) || []
  assert.deepEqual(bare, [], '发现无条件 error_count+1（会随批改重跑虚增次数）')
  // 条件增量三要素
  assert.match(fn, /error_count = CASE/, '必须有 CASE 条件增量')
  assert.match(fn, /EXCLUDED\.last_wrong_task_id IS NOT NULL/, '必须要求来路 task 非空（宁少勿多）')
  assert.match(fn, /EXCLUDED\.last_wrong_task_id <> \$\{TABLES\.WRONG_QUESTIONS\}\.last_wrong_task_id/, '必须按任务不同才 +1')
  assert.match(fn, /last_wrong_task_id = COALESCE\(EXCLUDED\.last_wrong_task_id/, '必须记录最新判错任务')
  // INSERT 列与 VALUES 都要带上 last_wrong_task_id（否则 EXCLUDED 拿不到值）
  assert.match(fn, /is_blank, error_type, last_wrong_task_id\)/, 'INSERT 列必须含 last_wrong_task_id')
})

test('worker 练习册入册必须传 taskId', () => {
  const call = sliceFrom(read(WORKER), 'await addSelfContainedWrongQuestion({')
  const body = call.slice(0, call.indexOf('})') + 2)
  assert.match(body, /taskId/, 'addSelfContainedWrongQuestion 调用必须带 taskId（同任务重跑才不会虚加次数）')
})

test('迁移 058 必须存在、幂等（先查列再 ADD）、已注册进 index.js 启动链', () => {
  const mig = read(MIGRATION)
  assert.match(mig, /information_schema\.columns[\s\S]*last_wrong_task_id/, '必须先查列再决定是否 ADD（幂等）')
  assert.match(mig, /ADD COLUMN last_wrong_task_id UUID/, '列定义必须是可空 UUID')
  const idx = read(INDEX)
  assert.match(idx, /migrations\/058_add_wrong_questions_last_wrong_task_id\.js/, '必须 import 迁移')
  // 迁移链自 2026-09-15 起改由 runMigrations 台账执行：登记形式从裸
  // `await migrateXxx()` 变成 [key, fn] 元组（见 server/migrations/migrationLedger.js）。
  // 判据随之更新，但约束不放宽——迁移仍然必须注册进启动链，否则永远不会被应用。
  assert.match(
    idx,
    /\['migrateWrongQuestionsLastWrongTaskId',\s*migrateWrongQuestionsLastWrongTaskId\]/,
    '必须在 runMigrations 启动迁移清单中注册'
  )
})

// ---------- 修复 2：重练结算事务化 ----------

test('finalizeGeneratedExamResults 的全部写入必须在 transaction() 内', () => {
  const src = read(FINALIZER)
  assert.match(src, /import \{[^}]*\btransaction\b[^}]*\} from '\.\.\/config\/neon\.js'/, '必须 import transaction 助手')
  const fn = sliceFrom(src, 'export const finalizeGeneratedExamResults')
  const txStart = fn.indexOf('await transaction(async (client) => {')
  assert.ok(txStart > 0, '结算写入必须包在 transaction() 里')

  const txBody = fn.slice(txStart)
  const txEnd = txBody.indexOf('\n  })')
  const inner = txBody.slice(0, txEnd)
  // 事务内必须且只能用 client 查询（pool.query 逃出事务语义）
  for (const write of ['INSERT INTO ${TABLES.WRONG_QUESTIONS}', 'UPDATE ${TABLES.WRONG_QUESTIONS}', 'UPDATE ${TABLES.QUESTIONS}', "SET status = 'graded'", 'INSERT INTO ${TABLES.JUDGEMENTS}']) {
    assert.ok(inner.includes(write), `结算写入必须进事务: ${write}`)
    const inTx = inner.indexOf(write)
    const idx2 = inner.indexOf('client.query')
    assert.ok(idx2 > -1, '事务内必须用 client.query')
  }
  const poolInTx = (inner.match(/[^.]query\(/g) || []).filter(m => true).length
  const clientQueries = (inner.match(/client\.query\(/g) || []).length
  const directPool = poolInTx - 0 // 仅供可读性；下方逐条断言更精确
  assert.ok(clientQueries >= 5, `事务内至少 5 次 client.query（错题插入/更新、题目回写、exam 标记、审计），实际 ${clientQueries}`)
  // 事务体内不允许出现裸 pool 级 query( 调用（会逃出事务）
  const barePool = inner.match(/(?<!client\.)(?<!\w)query\(/g) || []
  assert.deepEqual(barePool, [], `事务内混入 pool 级 query 会逃出事务语义: ${barePool.length} 处`)
})

test('结算审计必须在事务内直写 client，禁止用吞异常的 createJudgement', () => {
  const fn = sliceFrom(read(FINALIZER), 'export const finalizeGeneratedExamResults')
  const txStart = fn.indexOf('await transaction(async (client) => {')
  const inner = fn.slice(txStart, txStart + fn.slice(txStart).indexOf('\n  })'))
  assert.match(inner, /INSERT INTO \$\{TABLES\.JUDGEMENTS\}/, '结算审计必须落库')
  assert.match(inner, /settlement_key/, '审计必须带 settlement_key（幂等判据）')
  const judgCalls = (fn.match(/createJudgement\(/g) || []).length
  // finalizeGeneratedExamResults 函数体内不允许再出现 createJudgement（其余两个函数保留使用）
  const fnEnd = fn.indexOf('\n}\n')
  const fnOwn = fn.slice(0, fnEnd)
  assert.equal(
    (fnOwn.match(/createJudgement\(/g) || []).length, 0,
    'finalizeGeneratedExamResults 内禁用 createJudgement：它自带重试且吞异常、走连接池，进不了事务'
  )
  void judgCalls
})

test('syncReviewResultsMastery 是尽力而为旁路，必须留在事务外', () => {
  const src = read(FINALIZER)
  const fn = sliceFrom(src, 'export const finalizeGeneratedExamResults')
  const txStart = fn.indexOf('await transaction(async (client) => {')
  const txEnd = txStart + fn.slice(txStart).indexOf('\n  })')
  const after = fn.slice(txEnd)
  const syncIdx = after.indexOf('syncReviewResultsMastery')
  assert.ok(syncIdx > -1, '事务外必须保留 syncReviewResultsMastery（尽力而为，失败仅告警）')
  assert.match(after, /catch \(error\)[\s\S]*mastery sync failed/, '旁路失败必须告警但不得中断结算返回')
})

test('事务内顺序不变：题目回写必须先于 exam 状态落库（保持原注释约定）', () => {
  const src = read(FINALIZER)
  const fn = sliceFrom(src, 'export const finalizeGeneratedExamResults')
  const txStart = fn.indexOf('await transaction(async (client) => {')
  const inner = fn.slice(txStart, txStart + fn.slice(txStart).indexOf('\n  })'))
  const questionWrite = inner.indexOf('buildIsCorrectAssignments(updateQuestionIds)')
  const examWrite = inner.indexOf("SET status = 'graded'")
  assert.ok(questionWrite > 0 && examWrite > 0, '两处写入语句必须都在事务内')
  assert.ok(questionWrite < examWrite, '题目回写必须先于 exam 状态落库')
})
