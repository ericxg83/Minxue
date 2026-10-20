// 回归锁（2026-10-20，负责人拍板「乙方案：删死分支」，修 r280-P-A）：
//「v2 答案库矩阵」的两个分支自出生起就是死的——syncDraftAnswerBank 按 review_status='excluded'
// 与'reviewed' 分支，但 questions.review_status 真实取值只有 4 个（见 src/utils/reviewDecision.js），
// **'excluded' / 'reviewed' 全表 0 行、git 全历史 0 次出现** ⇒ 矩阵承诺的三件事
//（排除标excluded / 复核升 teacher_verified / 错题未修 DELETE 行）一次都没执行过。
//
// 本锁的作用有两层：
//   ① 词汇表锁：证明 'excluded'/'reviewed' 确实不属于任何现实取值——死分支的前提事实；
//   ② 结构锁：防止有人日后把死分支「复活」（或反过来把注释又写回「矩阵决定最终态」）。
// 反向自检全部内联合成（Windows EBUSY纪律，禁 spawnSync 调 git）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { REVIEW_STATUS } from '../src/utils/reviewDecision.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_SRC = readFileSync(join(ROOT, 'server', 'index.js'), 'utf8')
const WORKER_SRC = readFileSync(join(ROOT, 'server', 'worker.js'), 'utf8')

// ── ① 词汇表锁：死分支的前提事实 ──
test('review_status 真实词汇表不含 excluded / reviewed（死分支的前提事实）', () => {
  const real = Object.values(REVIEW_STATUS)
  assert.ok(real.length > 0, 'REVIEW_STATUS 必须非空')
  assert.ok(!real.includes('excluded'), "'excluded' 不该是真实取值（注意拼写：真实值是 exclude，不是 excluded）")
  assert.ok(!real.includes('reviewed'), "'reviewed' 不该是真实取值")
  // 反向自检：合成一个含死值的词汇表，证明本断言真的会红
  const withDead = [...real, 'excluded', 'reviewed']
  assert.equal(withDead.includes('excluded'), true, '合成自检前提：塞进去就应被检出')
})

// ── ② 结构锁：死分支不得复活 ──
test('syncDraftAnswerBank 不得含按 excluded/reviewed 分支的死代码', () => {
  const fnStart = INDEX_SRC.indexOf('async function syncDraftAnswerBank')
  assert.ok(fnStart > 0, '必须能找到 syncDraftAnswerBank')
  // 取函数体（到下一个顶层 function 声明为止）
  const fnEnd = INDEX_SRC.indexOf('\nasync function ', fnStart + 10)
  const body = INDEX_SRC.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 4000)
  assert.ok(!/reviewStatus\s*===\s*'excluded'/.test(body), '死分支 excluded 不得复活')
  assert.ok(!/reviewStatus\s*===\s*'reviewed'/.test(body), '死分支 reviewed 不得复活')
  assert.ok(!/answer_status\s*=\s*'excluded'/.test(body), '不得再写 excluded 状态（该状态无来源）')
})

test('syncDraftAnswerBank 恒置 ai_draft 且answer 取老师答案||草稿原答案（唯一生效路径）', () => {
  const fnStart = INDEX_SRC.indexOf('async function syncDraftAnswerBank')
  const fnEnd = INDEX_SRC.indexOf('\nasync function ', fnStart + 10)
  const body = INDEX_SRC.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 4000)
  assert.ok(/const nextStatus = 'ai_draft'/.test(body), "必须恒置 'ai_draft'")
  assert.ok(/const nextAnswer = teacherAnswer \|\| row\.answer/.test(body), 'answer 取老师改写值||草稿原答案')
  // 不得再有 DELETE 分支（那属于从未执行过的死路径）
  assert.ok(!/DELETE FROM \$\{TABLES\.RESOURCE_ANSWERS\}/.test(body), '不得含 DELETE 行分支（r280 已证其从未执行）')
})

test('注释不得再宣称「v2 矩阵决定每题最终态」（那套规则从未运行过）', () => {
  // 说明性提及允许（函数头注里有"原注释却把它们写成…"的溯源），但不得作为现行规则宣称
  const claims = INDEX_SRC.split('\n').filter(
    (l) => /v2 矩阵/.test(l) && !/原注释|已删|从未|r280/.test(l)
  )
  assert.deepEqual(claims, [], '仍有注释把 v2 矩阵当现行规则宣称：\n' + claims.join('\n'))
})

// ── ③ worker.js 失效注释订正 ──
test('worker.js 不得再引用全仓不存在的 completeTaskReview 函数', () => {
  assert.ok(!/server completeTaskReview 自动推/.test(WORKER_SRC),
    '不得宣称 completeTaskReview 会自动发布（该函数全仓不存在，发布实际走 ExamWorkbench）')
  // 订正后的说明必须在位
  assert.ok(/ExamWorkbench PUT \/resources/.test(WORKER_SRC), '应说明发布实际走 ExamWorkbench 两条路由')
})