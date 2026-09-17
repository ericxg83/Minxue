import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const NEON_SRC = readFileSync(resolve(ROOT, 'server/services/neonService.js'), 'utf8')
const MIGRATION_SRC = readFileSync(resolve(ROOT, 'server/migrations/059_wrongbook_identity_split.js'), 'utf8')
const INDEX_SRC = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
const WORKER_SRC = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')

/**
 * 错题本跨卷串行根治（方案A，2026-09-16 事故沉淀）
 *
 * 事故：错题本练习册路径身份键 (student_id, worksheet_id, question_no) 里
 * worksheet_id 是「答案册资源」——同一本答案册挂多份周练 → 不同卷子的同题号
 * 共用一行，upsert 快照 COALESCE 保旧 + question_id 保旧 → 题干/判定/快照
 * 三方错配（实测：第01周 27.3(2) 题8 的行被第03周 28.1(2) 题8 的批改覆盖）。
 *
 * 修复：写入侧按「题」定位——有 questionId 走 (student_id, question_id)
 * 冲突目标且快照取最新；真自包含（无 questionId）保留旧键（索引收窄到
 * question_id IS NULL）。
 */

test('addSelfContainedWrongQuestion：有 questionId 时按题定位，快照取最新', () => {
  // 冲突目标必须是 (student_id, question_id) + 部分索引谓词
  assert.ok(
    NEON_SRC.includes('ON CONFLICT (student_id, question_id)\n       WHERE question_id IS NOT NULL'),
    '必须有 (student_id, question_id) 冲突目标分支'
  )
  // 快照策略反转：取 EXCLUDED（最新一次做错），不再是 COALESCE 保旧
  const qidBranch = NEON_SRC.split('if (questionId) {')[1]?.split('} else {')[0] || ''
  assert.ok(qidBranch.includes('student_answer = EXCLUDED.student_answer'), '快照必须取最新')
  assert.ok(qidBranch.includes('correct_answer = EXCLUDED.correct_answer'), '快照必须取最新')
  assert.ok(qidBranch.includes('content = EXCLUDED.content'), '题干必须取最新')
  assert.ok(!qidBranch.includes('question_id = COALESCE('), 'question_id 不得保旧')
  // 出处刷新：worksheet_id / question_no / page_number 跟随最新一次做错
  assert.ok(qidBranch.includes('worksheet_id = EXCLUDED.worksheet_id'), '出处必须刷新')
  assert.ok(qidBranch.includes('question_no = EXCLUDED.question_no'), '题号必须刷新')
})

test('addSelfContainedWrongQuestion：无 questionId 的真自包含路径保留旧键', () => {
  assert.ok(
    NEON_SRC.includes('WHERE question_id IS NULL AND worksheet_id IS NOT NULL AND question_no IS NOT NULL'),
    '自包含冲突目标必须收窄到 question_id IS NULL 的行'
  )
})

test('addSelfContainedWrongQuestion：error_count 条件增量逻辑不得回退', () => {
  const i = NEON_SRC.indexOf('error_count = CASE')
  assert.ok(i > 0, 'error_count 条件增量必须存在')
  const seg = NEON_SRC.slice(i, i + 600)
  assert.ok(seg.includes('EXCLUDED.last_wrong_task_id <> '), '必须按 last_wrong_task_id 判同任务重跑')
  assert.ok(seg.includes('error_count + 1'), '不同任务真做错必须 +1')
})

test('addSelfContainedWrongQuestion：23505/42P10 必须回退旧冲突目标而非中断批改', () => {
  assert.ok(NEON_SRC.includes("e.code === '23505' || e.code === '42P10'"), '必须有回退分支')
  const fb = NEON_SRC.split('e.code === \'23505\'')[1] || ''
  assert.ok(fb.includes('ON CONFLICT (student_id, worksheet_id, question_no)'), '回退目标必须是旧键')
})

test('迁移059：宽索引必须删除、自包含收窄索引必须新建、且先建后删', () => {
  assert.ok(MIGRATION_SRC.includes('DROP INDEX IF EXISTS uq_wrong_questions_student_ws_qno'), '必须删宽索引')
  assert.ok(MIGRATION_SRC.includes('uq_wrong_questions_student_ws_qno_selfcontained'), '必须建自包含索引')
  const iCreate = MIGRATION_SRC.indexOf('uq_wrong_questions_student_ws_qno_selfcontained')
  const iDrop = MIGRATION_SRC.indexOf('DROP INDEX IF EXISTS uq_wrong_questions_student_ws_qno')
  assert.ok(iCreate > 0 && iDrop > iCreate, '必须先建自包含索引再删宽索引（避免中间态无索引）')
  assert.ok(MIGRATION_SRC.includes('uq_wrong_questions_student_question_id'), '必须兜底确认 052 索引')
})

test('迁移059 必须注册进启动迁移链', () => {
  assert.ok(INDEX_SRC.includes("from './migrations/059_wrongbook_identity_split.js'"), '必须 import')
  assert.ok(INDEX_SRC.includes("['migrateWrongQuestionsIdentitySplit', migrateWrongQuestionsIdentitySplit]"), '必须注册 runMigrations')
})

test('worker 入册调用必须传 questionId=wq.id（按题定位的前提）', () => {
  // 窗口 900：2026-09-17 起 subject 传播使调用块从 ~570 字符增至 ~680，
  // 原 600 窗口会漏匹配；取 900 留余量。
  const m = WORKER_SRC.match(/addSelfContainedWrongQuestion\(\{[\s\S]{0,900}?\}\)/)
  assert.ok(m, '找到入册调用')
  assert.ok(m[0].includes('questionId: wq.id'), '必须传 wq.id')
  assert.ok(m[0].includes('taskId'), '必须传 taskId（error_count 条件增量依赖）')
})
