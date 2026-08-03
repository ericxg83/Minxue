import { query, transaction, TABLES } from '../config/neon.js'

/**
 * 后台数据清理服务
 *
 * 按用户要求清理三类数据，但保留练习册预埋答案：
 *   1. 学生试卷/任务（tasks）→ 生产环境外键为 ON DELETE SET NULL，因此删除 tasks 后
 *      需要再显式清理 task_id 为 NULL 的 orphan questions（级联删除 question_assets）
 *   2. 错题本（wrong_questions）
 *   3. 试卷重练（generated_exams）
 *
 * 练习册资源（resources.resource_type = 'worksheet'）及其答案库（resource_answers /
 * resource_units / resource_questions）严格保留。
 */

const COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*)::int FROM ${TABLES.TASKS}) AS tasks,
    (SELECT COUNT(*)::int FROM ${TABLES.QUESTIONS}) AS questions,
    (SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS}) AS wrong_questions,
    (SELECT COUNT(*)::int FROM ${TABLES.GENERATED_EXAMS}) AS generated_exams,
    (SELECT COUNT(*)::int FROM ${TABLES.RESOURCES} WHERE resource_type = 'worksheet') AS worksheets,
    (SELECT COUNT(*)::int FROM ${TABLES.RESOURCE_ANSWERS}
       WHERE resource_id IN (SELECT id FROM ${TABLES.RESOURCES} WHERE resource_type = 'worksheet')) AS worksheet_answers
`

async function getCounts() {
  const { rows } = await query(COUNTS_SQL)
  return rows[0] || {}
}

export async function cleanupStudentData(options = {}) {
  const {
    tasks: cleanTasks = true,
    wrongQuestions: cleanWrongQuestions = true,
    generatedExams: cleanGeneratedExams = true,
    dryRun = false,
  } = options

  if (!cleanTasks && !cleanWrongQuestions && !cleanGeneratedExams) {
    throw new Error('请至少选择一项要清理的数据')
  }

  const before = await getCounts()

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      scopes: { tasks: cleanTasks, wrongQuestions: cleanWrongQuestions, generatedExams: cleanGeneratedExams },
      before,
      after: before,
      deleted: {
        tasks: 0,
        orphanQuestions: 0,
        wrongQuestions: 0,
        generatedExams: 0,
      },
    }
  }

  const result = await transaction(async (client) => {
    let deletedTasks = 0
    let deletedOrphanQuestions = 0
    let deletedWrongQuestions = 0
    let deletedGeneratedExams = 0

    if (cleanTasks) {
      const r = await client.query(`DELETE FROM ${TABLES.TASKS}`)
      deletedTasks = r.rowCount || 0
      // 生产环境 questions.task_id 外键为 SET NULL，需主动清理残留题目
      const rq = await client.query(`DELETE FROM ${TABLES.QUESTIONS} WHERE task_id IS NULL`)
      deletedOrphanQuestions = rq.rowCount || 0
    }

    if (cleanWrongQuestions) {
      const r = await client.query(`DELETE FROM ${TABLES.WRONG_QUESTIONS}`)
      deletedWrongQuestions = r.rowCount || 0
    }

    if (cleanGeneratedExams) {
      const r = await client.query(`DELETE FROM ${TABLES.GENERATED_EXAMS}`)
      deletedGeneratedExams = r.rowCount || 0
    }

    return {
      deletedTasks,
      deletedOrphanQuestions,
      deletedWrongQuestions,
      deletedGeneratedExams,
    }
  })

  const after = await getCounts()

  console.log('[DataCleanup] 清理完成:', {
    scopes: { tasks: cleanTasks, wrongQuestions: cleanWrongQuestions, generatedExams: cleanGeneratedExams },
    deleted: {
      tasks: result.deletedTasks,
      orphanQuestions: result.deletedOrphanQuestions,
      wrongQuestions: result.deletedWrongQuestions,
      generatedExams: result.deletedGeneratedExams,
    },
    worksheetsKept: after.worksheets,
    worksheetAnswersKept: after.worksheet_answers,
  })

  return {
    success: true,
    dryRun: false,
    scopes: { tasks: cleanTasks, wrongQuestions: cleanWrongQuestions, generatedExams: cleanGeneratedExams },
    before,
    after,
    deleted: {
      tasks: result.deletedTasks,
      orphanQuestions: result.deletedOrphanQuestions,
      wrongQuestions: result.deletedWrongQuestions,
      generatedExams: result.deletedGeneratedExams,
    },
    kept: {
      worksheets: after.worksheets,
      worksheetAnswers: after.worksheet_answers,
    },
  }
}
