/**
 * 知识树合并脚本 · 掌握度「只删不并」防回归锁（2026-10-07 事故沉淀）
 * ═══════════════════════════════════════════════════════════════
 * 事故：批次 2 / 批次 3 的合并脚本从批次 1 抄「删冲突行 + 重指向」时，
 *   **漏抄了批次 1 的 `UPDATE ... FROM knowledge_mastery d` 数值合并那一步**，
 *   同 (student, keep) 冲突的行被直接删掉 ⇒ 28 行掌握度的 total/correct/wrong/mastery 丢失。
 *   当晚用合并前的备份修回（`server/_repair_merge_mastery.mjs`，23 行），但这类丢失
 *   **不报错、不白屏**，只体现为「掌握度忽然变低/题数变少」，不锁住还会再犯。
 *
 * 本锁只认两件事（源码锁，因为是一次性脚本、没有可注入的纯函数）：
 *   ① 必须存在把 d.* 并进 k.* 的 UPDATE，且字段齐全（total/correct/wrong/mastery）；
 *   ② 「先并、后删」的顺序不能反。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPTS = [
  'server/scripts/applyKnowledgeMergeResidual.mjs',
  'server/scripts/applyKnowledgeMergePowerCluster.mjs',
]

for (const rel of SCRIPTS) {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')

  test(`${rel}：掌握度必须先把 d 的数值并进保留行`, () => {
    const at = src.indexOf('UPDATE knowledge_mastery k SET')
    assert.ok(at !== -1, '找不到数值合并的 UPDATE —— 只删不并会静默丢掌握度（2026-10-07 事故）')
    // 语句边界取到 kmDel 之前（含 WHERE 子句）
    const end = src.indexOf('const kmDel', at)
    const block = src.slice(at, end === -1 ? at + 2000 : end)
    for (const field of ['total_questions', 'correct_questions', 'wrong_questions', 'mastery']) {
      assert.match(block, new RegExp(`${field}\\s*=`), `合并语句里漏了 ${field}`)
    }
    assert.match(block, /k\.student_id = d\.student_id/, '合并必须按 (student, kp) 对齐')
    assert.match(block, /k\.kp_id = \$1 AND d\.kp_id = \$2/, '合并的 keep/drop 参数位不能写错')
  })

  test(`${rel}：先并数值、再删冲突行（顺序反了等于没并）`, () => {
    const mergeAt = src.indexOf('UPDATE knowledge_mastery k SET')
    const delAt = src.indexOf('DELETE FROM knowledge_mastery d WHERE d.kp_id=$1')
    assert.ok(mergeAt !== -1 && delAt !== -1, '合并/删除语句缺失')
    assert.ok(mergeAt < delAt, 'DELETE 出现在数值合并之前 —— 冲突行会带着数值被删掉')
  })

  test(`${rel}：考法关联表同样先并 question_count 再去重`, () => {
    const m = src.indexOf('UPDATE teaching_question_type_kps k')
    const d = src.indexOf('DELETE FROM teaching_question_type_kps d WHERE d.kp_id=$1')
    assert.ok(m !== -1, '考法关联没有并 question_count（同类丢失）')
    assert.match(src.slice(m, src.indexOf('FROM teaching_question_type_kps d', m)), /question_count\s*=/)
    assert.ok(m < d, 'DELETE 出现在 question_count 合并之前')
  })
}
