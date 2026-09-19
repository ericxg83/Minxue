/**
 * 错题入册快照回填 SQL（唯一出口）
 * ============================================================
 * 背景：`wrong_questions` 是错题的"自包含快照行"，白板/课件/错题本读它时
 * 不应再去猜出处。但重练卷结算路径（gradingFinalizer.finalizeGeneratedExamResults）
 * 历史上只写 (student_id, question_id, status, lifecycle_status, error_count,
 * practice_count)，出处分一个字段都没落：
 *
 *   · last_wrong_task_id 为空 → 周末班白板「学生原卷（整页图）」按它取 tasks.images
 *     取不到图，弹窗永远显示「无原卷图」（2026-09-19 用户报障）；
 *   · page_number / question_no 为空 → 错题本、课件分页/题号全靠 LEFT JOIN questions；
 *   · content 为空 → 错题行不自包含，题干丢失时无法展示。
 *
 * 本文件的 SQL 被两处复用，口径只能有一份：
 *   ① 结算写入侧：gradingFinalizer 在结算事务内补齐刚插入的行（治未来）
 *   ② 存量回填：server/scripts/backfill-wrong-question-snapshot.mjs（治历史）
 *
 * 纪律（勿改成"直接覆盖"）：
 *   · 每个字段都必须 `COALESCE(wq.<col>, q.<col>)` —— 只补空，绝不覆盖已有值；
 *   · WHERE 里必须逐字段 `IS NULL AND q.<col> IS NOT NULL` —— 只动真正会变的行，
 *     避免全表空转写放大；
 *   · 类型转换一律显式（`$1::uuid[]` / `$2::uuid`），不依赖 PG 推断
 *     （同类推断事故：42804，见 test/gradingSettlementSql.test.mjs）。
 *
 * 参数：$1 = uuid[] 限定 question_id（传 NULL 表示不过滤）
 *       $2 = uuid   限定 student_id （传 NULL 表示不过滤）
 */
import { TABLES } from '../config/neon.js'

export const buildWrongQuestionSnapshotSql = () => `
UPDATE ${TABLES.WRONG_QUESTIONS} wq
   SET last_wrong_task_id = COALESCE(wq.last_wrong_task_id, q.task_id),
       question_no        = COALESCE(wq.question_no, q.question_number),
       page_number        = COALESCE(wq.page_number, q.page_number),
       content            = COALESCE(NULLIF(wq.content, ''), q.content),
       question_type      = COALESCE(wq.question_type, q.question_type),
       block_coordinates  = COALESCE(wq.block_coordinates, q.block_coordinates)
  FROM ${TABLES.QUESTIONS} q
 WHERE wq.question_id = q.id
   AND ($1::uuid[] IS NULL OR wq.question_id = ANY($1::uuid[]))
   AND ($2::uuid IS NULL OR wq.student_id = $2::uuid)
   AND (
        (wq.last_wrong_task_id IS NULL AND q.task_id IS NOT NULL)
     OR (wq.question_no IS NULL AND q.question_number IS NOT NULL)
     OR (wq.page_number IS NULL AND q.page_number IS NOT NULL)
     OR (NULLIF(wq.content, '') IS NULL AND q.content IS NOT NULL)
     OR (wq.question_type IS NULL AND q.question_type IS NOT NULL)
     OR (wq.block_coordinates IS NULL AND q.block_coordinates IS NOT NULL)
   )
 RETURNING wq.id`

/** 快照字段 → 来源列 / 缺失判据（测试与文档共用，防止两边漂移） */
export const SNAPSHOT_FIELDS = [
  { col: 'last_wrong_task_id', src: 'task_id', guard: 'wq.last_wrong_task_id IS NULL' },
  { col: 'question_no', src: 'question_number', guard: 'wq.question_no IS NULL' },
  { col: 'page_number', src: 'page_number', guard: 'wq.page_number IS NULL' },
  // content 的空值是 '' 与 NULL 并存（历史写入给的是空串），判据要归一
  { col: 'content', src: 'content', guard: "NULLIF(wq.content, '') IS NULL" },
  { col: 'question_type', src: 'question_type', guard: 'wq.question_type IS NULL' },
  { col: 'block_coordinates', src: 'block_coordinates', guard: 'wq.block_coordinates IS NULL' },
]
