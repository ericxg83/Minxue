// 回归测试：neonService 两处「SQL/并发」守卫
//
// 事故背景（2026-09-24 四份误挂卷重批）：
//   ① batchUpdateQuestionTags 的 VALUES 列 `difficulty` 没有显式类型，本批 difficulty
//      全为 null 时 Postgres 把 v.difficulty 推断成 text ⇒
//        `42804 COALESCE types text and smallint cannot be matched`
//      而该异常被函数内 try/catch 吞成一行 console.error ⇒ 每次复核「批量更新标签失败」，
//      题目标签/难度**静默不落库**（questions.difficulty 是 smallint）。
//      同类坑：gradingFinalizer 的 THEN 分支缺 ::boolean（test/gradingSettlementSql.test.mjs）。
//   ② addWrongQuestions 走「内存快照」分支（compensateWrongBook 传 questions 数组）时不校验
//      题是否还在库。同一 task 被**另一个 worker 并发重批**（deleteQuestionsByTaskId 删旧题）
//      时，旧 id 已不存在 ⇒ INSERT 撞 wrong_questions_question_id_fkey，异常上抛整轮入册失败
//      （实测 `Key (question_id)=8027fa6a… is not present in table "questions"`）。
//
// 本测试锁定：① difficulty 参数必须显式 ::smallint 且经 Number 归一；
//            ② addWrongQuestions 必须在构造 INSERT 行之前做「题是否仍存在」的 FK 安全闸。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const NEON = 'server/services/neonService.js'
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

function fnBody(src, name) {
  const start = src.indexOf(`export const ${name}`)
  assert.ok(start > 0, `未找到 ${name}`)
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end > 0 ? end : src.length)
}

test('batchUpdateQuestionTags: difficulty 占位符必须显式 ::smallint', () => {
  const body = fnBody(read(NEON), 'batchUpdateQuestionTags')
  assert.ok(
    /\$\{paramIdx \+ 3\}::smallint/.test(body),
    'difficulty 参数必须 ::smallint：缺类型注解且本批全 null 时 PG 推断成 text，COALESCE 撞 42804，整批标签静默丢失'
  )
  assert.ok(
    /Number\.isFinite\(Number\(update\.difficulty\)\)/.test(body),
    'difficulty 需先经 Number 归一，避免非数值字符串被硬转 smallint 抛错'
  )
})

test('batchUpdateQuestionTags: VALUES 各列都要有显式类型', () => {
  const body = fnBody(read(NEON), 'batchUpdateQuestionTags')
  for (const t of ['::uuid', '::jsonb', '::text', '::smallint']) {
    assert.ok(body.includes(t), `VALUES 列表缺少显式类型 ${t}`)
  }
})

test('addWrongQuestions: 必须在构造 INSERT 行之前做 FK 安全闸', () => {
  const body = fnBody(read(NEON), 'addWrongQuestions')
  const gate = body.indexOf('FK 安全闸')
  const build = body.indexOf('const values = newIds.map')
  assert.ok(gate > 0, '未找到 FK 安全闸注释锚点')
  assert.ok(build > 0, '未找到 const values = newIds.map')
  assert.ok(gate < build, 'FK 安全闸必须早于 INSERT 行构造：否则并发删除时仍会撞外键')
  assert.ok(
    /SELECT id FROM \$\{TABLES\.QUESTIONS\} WHERE id = ANY/.test(body),
    'FK 安全闸需以库为准（SELECT id FROM questions WHERE id = ANY）过滤掉已不存在的题'
  )
  assert.ok(
    /let newIds =/.test(body),
    'newIds 必须是 let：FK 安全闸需要按库里现况重新过滤后再赋值'
  )
})
