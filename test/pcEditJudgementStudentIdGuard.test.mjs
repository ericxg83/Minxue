/**
 * 回归锁：createJudgement 所有调用点必须显式传 studentId
 *
 * 背景（2026-10-15 r288 巡查实证，server/index.js 两处、同族缺陷）：
 *   judgements.student_id / question_id 都是 NOT NULL（迁移 006），而 createJudgement
 *   自带「重试 3 次后吞异常」的容错（shadow 模式不阻塞主流程）。调用点一旦漏传
 *   studentId，写入必然 23502 失败、日志刷三行后被 .catch 吞掉——**审计静默丢失**，
 *   前端无感、无报错、无重试。
 *   实证：server.log 同一晚 9 条 failing row 全是 source='pc_edit'、
 *   编辑字段 ["review_status","review_metadata"]（负责人 PC 复核改判会话）；
 *   另一处 PUT /api/wrong-questions/:id（人工复审）连 studentId 和 question_id
 *   都没传（question_id 还错传成错题行 id，/api/judgements/latest 按 question_id
 *   反查永远匹配不上）。
 *
 * 判据设计（源码级锁定，与 adminAuthGuard / wrongCountIncrementGuard 同风格）：
 *   1. schema 事实：迁移 006 两列 NOT NULL（漏传为何必然失败的依据）；
 *   2. 全仓所有 createJudgement({ 调用点都必须显式传 studentId（字面 null 也算漏传）；
 *   3. pc_edit 站点取值必须与 manual_review 分支同源表达式；
 *   4. 人工复审站点必须先回读 wrong_questions 行取真实 student_id/question_id。
 *
 * 反向自检：GUARD_ROOT 指向含 HEAD 旧版 index.js 的目录时，断言 2/3/4 必须判红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.GUARD_ROOT
  ? path.resolve(process.env.GUARD_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const SCAN_FILES = [
  'server/index.js',
  'server/worker.js',
  'server/services/gradingFinalizer.js',
  'server/services/neonService.js',
]

test('schema 事实：judgements 的 student_id / question_id 均 NOT NULL（漏传必然 23502）', () => {
  const mig = read('server/migrations/006_create_judgements.sql')
  assert.match(mig, /student_id[^\n]*NOT NULL/i, 'student_id 必须 NOT NULL')
  assert.match(mig, /question_id[^\n]*NOT NULL/i, 'question_id 必须 NOT NULL')
})

test('所有 createJudgement 调用点必须显式传 studentId', () => {
  const re = /createJudgement\(\{[\s\S]*?\n\s*\}\)/g
  const bad = []
  let total = 0
  for (const f of SCAN_FILES) {
    const src = read(f)
    const calls = src.match(re) || []
    total += calls.length
    for (const c of calls) {
      const anchor = c.split('\n')[1]?.trim() || c.split('\n')[0].trim()
      if (!/studentId\s*[:,]/.test(c)) bad.push(`${f} 漏传 studentId（${anchor}）`)
      if (/studentId\s*:\s*null\s*[,\n]/.test(c)) bad.push(`${f} studentId 字面 null（${anchor}）`)
    }
  }
  // 防正则静默失效：低于历史基线说明提取不到调用点了，锁变成空锁
  assert.ok(total >= 13, `调用点提取应至少命中 13 处，实际 ${total}（提取正则失效？）`)
  assert.deepEqual(bad, [], `漏传 studentId 的调用点: ${bad.join(' / ')}`)
})

test('pc_edit 审计的 studentId 取值必须与 manual_review 分支同源', () => {
  const src = read('server/index.js')
  const i = src.indexOf("source: 'pc_edit'")
  assert.ok(i > -1, '必须存在 pc_edit 审计写入')
  const call = src.slice(src.lastIndexOf('createJudgement({', i), i)
  assert.match(
    call,
    /studentId:\s*updatedQuestion\.student_id\s*\|\|\s*oldQuestion\?\.student_id/,
    'pc_edit 必须传 studentId: updatedQuestion.student_id || oldQuestion?.student_id'
  )
})

test('人工复审审计必须先回读 wrong_questions 行，用真实 student_id/question_id 写入', () => {
  const src = read('server/index.js')
  const routeStart = src.indexOf("app.put('/api/wrong-questions/:id'")
  assert.ok(routeStart > -1, '必须存在 PUT /api/wrong-questions/:id 路由')
  const routeEnd = src.indexOf("app.delete('/api/wrong-questions/:id'", routeStart)
  assert.ok(routeEnd > routeStart, '必须存在相邻的 DELETE 路由作为截断边界')
  const route = src.slice(routeStart, routeEnd)
  assert.match(
    route,
    /SELECT student_id, question_id FROM \$\{TABLES\.WRONG_QUESTIONS\} WHERE id = \$1/,
    '人工复审审计前必须回读 wrong_questions 行取真实 student_id/question_id'
  )
  assert.match(route, /questionId: wqRow\.question_id/, '必须用真实 question_id（不再是错题行 id）')
  assert.match(route, /studentId: wqRow\.student_id/, '必须用真实 student_id')
  // 回读失败不能把已发出的响应打成 500（res.json 在前，catch 里再 setStatus 会撞 headers sent）
  assert.match(route, /try\s*\{[\s\S]*?SELECT student_id[\s\S]*?\}\s*catch/, '回读必须 try/catch 包裹，失败仅告警')
})
