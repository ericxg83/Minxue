// ⚠️ 必须是第一个 import：dotenv 必须先于下面所有模块求值。
// 详见 loadEnv.js 顶部注释（2026-09-21「.env 切换对 index.js 不生效」事故）。
import './loadEnv.js'
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { pendingTaskRecovery } from './pendingTaskRecovery.js'
import { runMigrations } from './migrations/migrationLedger.js'
import { migrateGeometryImageUrl } from './migrations/addGeometryImageUrl.js'
import { migrateLifecycleStatus } from './migrations/007_add_lifecycle_status.js'
import { migrateReviewStatus } from './migrations/008_add_review_status.js'
import { migrateQuestionCacheId } from './migrations/009_add_question_cache_id.js'
import { migrateJudgements } from './migrations/010_add_judgements_table.js'
import { migrateIsComplete } from './migrations/011_add_is_complete.js'
import { migratePracticeCount } from './migrations/012_add_practice_count.js'
import { migrateDifficulty } from './migrations/013_add_difficulty.js'
import { migratePageUnderstanding } from './migrations/014_add_page_understanding.js'
import { migrateGeometryCleanup } from './migrations/015_add_geometry_cleanup.js'
import { migrateGeometryTikzDisplay } from './migrations/016_add_tikz_display.js'
import { migrateGeometryCropType } from './migrations/017_add_geometry_crop_type.js'
import { migrateCleanGeometrySvg } from './migrations/018_add_clean_geometry_svg.js'
import { migrateSourceType } from './migrations/019_add_source_type.js'
import { migrateRetryTaskFields } from './migrations/020_add_retry_task_fields.js'
import { migrateGeometryReconstructionAsync } from './migrations/021_add_geometry_reconstruction_async.js'
import { migrateTaskSystemFields } from './migrations/022_task_system_fields.js'
import { migrateWorksheets } from './migrations/023_add_worksheets_tables.js'
import { migrateTaskImages } from './migrations/024_add_task_images.js'
import { migrateWorksheetParseStatus } from './migrations/025_add_worksheet_parse_status.js'
import { migrateDeduplicateWorksheetAnswers } from './migrations/026_dedupe_worksheet_answers.js'
import { migrateWorksheetAnswerContent } from './migrations/027_add_worksheet_answer_content.js'
import { migrateResources } from './migrations/028_add_resources.js'
import { migrateQuestionPdfUrl } from './migrations/029_add_question_pdf_url.js'
import { migrateCompleteResources } from './migrations/030_complete_resources_migration.js'
import { migrateParseProgressColumns } from './migrations/031_add_parse_progress_columns.js'
import { migrateResourceUnits } from './migrations/032_add_resource_units.js'
import { migrateWrongQuestionSelfContained } from './migrations/033_add_wrong_question_self_contained.js'
import { migrateWrongQuestionSubject } from './migrations/034_add_wrong_question_subject.js'
import { migrateErrorAnalysis } from './migrations/035_add_error_analysis.js'
import { migrateKnowledgeTables } from './migrations/036_add_knowledge_tables.js'
import { migrateVariantQuestions } from './migrations/037_add_variant_questions.js'
import { migrateVariantQuestionType } from './migrations/042_add_variant_question_type.js'
import { migrateRelaxQuestionTypeCheck } from './migrations/043_relax_question_type_check.js'
import { migrateHandoutLectures } from './migrations/045_handout_lectures.js'
import { migrateTaskNotificationRead } from './migrations/046_add_task_notification_read.js'
import { migrateTeachingQuestionTypes } from './migrations/047_teaching_question_types.js'
import { migrateTeachingQuestionTypeAuto } from './migrations/048_teaching_question_type_auto.js'
import { migrateStudentEnrollmentStatus } from './migrations/049_add_student_enrollment_status.js'
import { migrateAiAnswerRiskReason } from './migrations/050_add_ai_answer_risk_reason.js'
import { migrateTaskContentHash } from './migrations/051_add_task_content_hash.js'
import { migrateWrongQuestionsUniqueIndex } from './migrations/052_dedupe_wrong_questions_unique_index.js'
import { migrateAiSelfCheck } from './migrations/053_ai_self_check.js'
import { migrateTaskTypeEnum } from './migrations/054_task_type_enum.js'
import { migrateFixExamPublishedInconsistency } from './migrations/055_fix_exam_published_inconsistency.js'
import { migrateGeometryManualOverride } from './migrations/056_add_geometry_manual_override.js'
import { migrateQuestionParentStem } from './migrations/057_add_question_parent_stem.js'
import { migrateWrongQuestionsLastWrongTaskId } from './migrations/058_add_wrong_questions_last_wrong_task_id.js'
import { migrateWrongQuestionsIdentitySplit } from './migrations/059_wrongbook_identity_split.js'
import { scheduleNightParse, scheduleWeeklyDiagnosis } from './services/nightParseService.js'
import { scheduleWeeklyMissingFigureCheck } from './services/missingFigureMonitorService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 环境变量已在文件首行 `import './loadEnv.js'` 加载完毕。
// 原先这里才 dotenv.config()，而它**跑不过上面的静态 import** ——
// 模块级读 process.env 的配置（ANSWER_ENGINE_*、ALLOWED_ORIGIN、PORT…）全部
// 拿到 undefined 走默认值。保留此行只为兼容，实际已由 loadEnv.js 完成。
dotenv.config({ path: resolve(__dirname, '.env') })

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { query, TABLES, TASK_STATUS, QUESTION_STATUS } from './config/neon.js'
import { uploadFilesWithRetry } from './services/uploadRetryManager.js'
import { createUploadReport, logUploadReport } from './services/uploadReportLogger.js'
import { createJudgement, batchUpdateQuestionTags, getQuestionAssets, getQuestionAssetsByType, createResource, replaceResourceAnswers, addWrongQuestions, deleteQuestionsByTaskId, markAiAnswerRisk, updateQuestionDenormalizedSvg, updateQuestionAssetCleanData } from './services/neonService.js'
// [人工兜底重绘] 教师手改几何结构 → 服务端确定性渲 SVG → 发布干净图 URL
import { renderGeometrySvg } from './utils/geometrySvg.js'
import { publishCleanGeometryUrl } from './utils/geom/cleanGeometryUrl.js'
import { judgeAnswer, findDirtyAnswers } from './services/judgeService.js'
import { checkQuestionCompleteness, hasFigureReference } from './utils/questionCompleteness.js'
import { isFigurePreflightSkipEnabled, MISSING_FIGURE_SKIP_REASON } from './utils/figureRequirementGuard.js'
import { isConstructionQuestion } from './utils/constructionQuestionGuard.js'
import { planTaskRouteChange, resolveRouteKind, shouldResetTaskName, isRouteAutoName, buildAutoTaskName, describeRouteRisk, isRouteConvertEnabled, ROUTE_CONVERT_DISABLED_MESSAGE } from './utils/taskRoute.js'
import { requeueGeometryRedrawOnRejudgeWrong } from './utils/geometryRequeueOnRejudge.js'
import { syncQuestionCompleteness, syncQuestionCompletenessQuietly } from './services/questionCompletenessSync.js'
import { computeWrongBookRisks } from './utils/wrongBookRisks.js'
import { requeueGateSkippedQuestion } from './services/wrongGateRequeue.js'
import { normalizeOptions, formatOptionsForPrompt } from './utils/optionText.js'
import { computeTaskStats } from './utils/taskStats.js'
import { summarizeQuestionResults, classifyQuestionResult } from './utils/questionResultCaliber.js'
import { buildGradingDetailView } from './utils/gradingDetailView.js'
import { fixFileIfNeeded } from './services/uploadValidator.js'
import { recognizeAnswerImage } from './services/answerOCRService.js'
import { recognizeQuestionImage } from './services/questionOCRService.js'
import { uploadImage, deleteFile } from './services/ossService.js'
import { getTaskQueue, getGeometryQueue, getQueueStats, taskWorker } from './queue.js'
import { processTask, generateAnswerForQuestion, extractAnswerFromAnalysis, normalizeGeneratedAnswer, validateAIAnswer } from './worker.js'
// 定时回填走 LLM（backfillTags.js 的 generateTag），用于修正上传热路径产出的
// 本地占位标签/难度（difficulty 默认 3），写入 tags_source='ai' 后退出筛选。
import { generateTag as generateTagWithLLM } from './backfillTags.js'
import { AI_CONFIG, getAIHeaders, buildTaggingPrompt, resetModelIndex, WORKBOOK_OCR_VENDOR_CHAIN, isDegradedAnswerEngine } from './config/ai.js'
import weeklyReportRouter from './routes/weeklyReport.js'
import worksheetsRouter from './routes/worksheets.js'
import resourcesRouter from './routes/resources.js'
import teachingRouter from './routes/teaching.js'
import variantsRouter from './routes/variants.js'
import handoutRouter from './routes/handout.js'
import handoutLectureRouter from './routes/handoutLecture.js'
import teachingQuestionTypesRouter from './routes/teachingQuestionTypes.js'
import weaknessRouter from './routes/weakness.js'
import examPdfRouter from './routes/examPdf.js'
import wrongQuestionsExportRouter from './routes/wrongQuestionsExport.js'
import dashboardRouter from './routes/dashboard.js'
import weekendHandoutRouter from './routes/weekendHandout.js'
import { runErrorDiagnosis } from './services/diagnosisService.js'
import { cleanupStudentData } from './services/dataCleanupService.js'
import { getStudentMastery } from './services/knowledgeMasteryService.js'
import { getKnowledgeTree, getQuestionKnowledge, clearKnowledgeCache } from './services/knowledgeService.js'
import { finalizeRejudgeResult, finalizeGeneratedExamResults } from './services/gradingFinalizer.js'

const app = express()
const PORT = process.env.PORT || 4000

// ── 兜底：Redis/连接类异常不得杀掉批改服务 ──
// 服务进程死亡的代价特别高：所有正在批改的任务会永久停在 processing，
// 前端只能一直转圈（这正是 2026-08-25 夜间那批试卷卡住的成因）。
// BullMQ 的 Queue/Worker 各自持有 RedisConnection，任何一处漏了 'error' 监听
// 都会让 Upstash 配额耗尽演变成进程崩溃。queue.js 里已逐个补齐监听，
// 这里再加一层兜底，只吞连接类错误，其余未捕获异常仍按原样崩溃暴露问题。
const CONNECTION_ERROR_RE = /Connection is closed|max requests limit|max daily requests|quota exceeded|ECONNRESET|ETIMEDOUT|EPIPE|Stream isn't writeable|Command timed out|WRONGPASS/i

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err)
  if (CONNECTION_ERROR_RE.test(msg)) {
    console.error(`⚠️ [兜底] 已拦截连接类未捕获异常，服务继续运行: ${msg}`)
    return
  }
  console.error('❌ [兜底] 未捕获异常，进程退出:', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason)
  if (CONNECTION_ERROR_RE.test(msg)) {
    console.error(`⚠️ [兜底] 已拦截连接类未处理拒绝: ${msg}`)
    return
  }
  console.error('❌ [兜底] 未处理的 Promise 拒绝:', reason)
})

const allowedOrigins = process.env.ALLOWED_ORIGIN 
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001', 'http://localhost:3002', 'http://192.168.71.9:3001']

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ limit: '500mb', extended: true }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
})

// Health check
// 附带版本信息：Render 自动部署时无法从外部确认"我刚推的修复到底上线了没有"，
// 只能靠盲等。这里回显 Render 注入的 git commit 与进程启动时间，
// 部署是否生效变成一次 curl 就能确认的事。
const BOOT_AT = new Date().toISOString()
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
    branch: process.env.RENDER_GIT_BRANCH || null,
    bootAt: BOOT_AT,
    uptimeSec: Math.round(process.uptime()),
    visionTimeoutMs: parseInt(process.env.VISION_TIMEOUT_MS) || 180000,
  })
})

// Proxy image fetch — avoids CORS issues when drawing cross-origin images to canvas
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'Missing url param' })
    const decoded = decodeURIComponent(url)
    const resp = await fetch(decoded)
    if (!resp.ok) return res.status(resp.status).json({ error: 'Fetch failed' })
    const buffer = Buffer.from(await resp.arrayBuffer())
    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(buffer)
  } catch (e) {
    res.status(500).json({ error: 'Proxy fetch failed' })
  }
})

// Upload a single image (for question images, avatars, etc.)
app.post('/api/upload', upload.single('files'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: '没有上传文件' })
    }

    // Decode UTF-8 filename (multer may encode as Latin-1)
    try {
      const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8')
      if (Buffer.from(decoded, 'utf8').toString('utf8') === decoded) {
        file.originalname = decoded
      }
    } catch (e) {}

    const studentId = req.body.studentId || 'unknown'
    const url = await uploadImage(file.buffer, file.originalname, studentId)

    res.json({ success: true, url })
  } catch (error) {
    console.error('上传失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Upload images and create tasks (with validation + retry pipeline)
app.post('/api/tasks/upload', upload.array('files', 20), async (req, res) => {
  try {
    const { studentId, taskType, generatedExamId, worksheetId, subject, resourceId, taskName } = req.body
    console.log(`[Upload] 📥 req.body: studentId=${studentId} taskType=${taskType} worksheetId=${worksheetId} (len=${worksheetId?.length}) subject=${subject} resourceId=${resourceId} generatedExamId=${generatedExamId} taskName=${taskName || '(由文件名生成)'}`)
    // 业务类型枚举：'general' / 'wrong_retry' / 'retry_paper' / 'workbook' / 'exam' / 'homework'
    // 移动端 useUploadFlow.js 实际上传 exam/homework，原样落库；其他类型归一到 'general'。
    // 'retry_paper'（历史客户端/周报遗留值）归一到 'wrong_retry'，保持"重练"标签分类一致。
    let normalizedTaskType = taskType === 'wrong_retry' ? 'wrong_retry'
      : taskType === 'retry_paper' ? 'wrong_retry'
      : taskType === 'workbook' ? 'workbook'
      : taskType === 'exam' ? 'exam'
      : taskType === 'homework' ? 'homework'
      : 'general'
    const normalizedGeneratedExamId = generatedExamId && /^[0-9a-f-]{36}$/i.test(generatedExamId) ? generatedExamId : null
    // 单点收口：只要携带合法 generatedExamId 即为错题重练批改，强制 task_type='wrong_retry'。
    if (normalizedGeneratedExamId) normalizedTaskType = 'wrong_retry'
    const normalizedResourceId = resourceId && /^[0-9a-f-]{36}$/i.test(resourceId) ? resourceId : null

    // 错题重练上传：未传 studentId 时，从组卷记录自动关联（二维码只承载 task 定位）
    let resolvedStudentId = studentId
    if (!resolvedStudentId && normalizedGeneratedExamId) {
      const { rows } = await query(
        `SELECT student_id FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
        [normalizedGeneratedExamId]
      )
      if (rows.length > 0) resolvedStudentId = rows[0].student_id
    }
    if (!resolvedStudentId) {
      return res.status(400).json({ error: '缺少 studentId' })
    }

    const files = req.files
    if (!files || files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' })
    }

    // Fix: multer may interpret UTF-8 filenames as Latin-1 (ISO-8859-1).
    // Decode each filename back to proper UTF-8 before processing.
    for (const file of files) {
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8')
        // Verify the decoded string is valid UTF-8 (round-trip check)
        if (Buffer.from(decoded, 'utf8').toString('utf8') === decoded) {
          file.originalname = decoded
        }
      } catch (e) {
        // If decoding fails, keep original filename
      }
    }

    // ── 内容 hash 去重（2026-09-01 上线事故）──
    // 客户端在压缩后对每张图算 SHA-256，多张图用逗号拼成 X-Content-Hashes 头。
    // 命中同一学生已有 task 时直接复用，跳过 OSS / 队列。
    // 没传 header（老版本/算 hash 失败）则跳过本段，走原流程。
    const rawHashes = req.headers['x-content-hashes']
    const contentHashes = typeof rawHashes === 'string'
      ? rawHashes.split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{64}$/.test(s))
      : []
    if (contentHashes.length > 0) {
      try {
        const { rows: existing } = await query(
          `SELECT id, status, created_at, original_name
           FROM ${TABLES.TASKS}
           WHERE student_id = $1
             AND content_hash = ANY($2::text[])
             AND deleted_at IS NULL
             AND status IN ('pending', 'processing', 'done', 'reviewed')
           ORDER BY created_at DESC
           LIMIT 1`,
          [resolvedStudentId, contentHashes]
        )
        if (existing.length > 0) {
          const existingTask = existing[0]
          console.log(`[Upload Dedup] ♻️  命中已有 task: id=${existingTask.id} status=${existingTask.status} studentId=${resolvedStudentId}`)
          return res.json({
            success: true,
            count: 1,
            failed: 0,
            dedup: true,
            reportId: null,
            tasks: [{
              ...existingTask,
              originalName: existingTask.original_name,
              _dedup: true,
              _dedupMessage: '已检测到相同内容试卷，直接复用上次批改任务',
            }],
            summary: { dedup: true, reusedTaskId: existingTask.id },
          })
        }
        // 命中但状态是 failed：让前端知道，避免静默重提
        const { rows: failedExisting } = await query(
          `SELECT id, status, last_error, created_at
           FROM ${TABLES.TASKS}
           WHERE student_id = $1
             AND content_hash = ANY($2::text[])
             AND deleted_at IS NULL
             AND status = 'failed'
           ORDER BY created_at DESC
           LIMIT 1`,
          [resolvedStudentId, contentHashes]
        )
        if (failedExisting.length > 0) {
          console.log(`[Upload Dedup] ⚠️  命中失败 task: id=${failedExisting[0].id} studentId=${resolvedStudentId}`)
          return res.status(409).json({
            error: 'EXISTING_FAILED_TASK',
            message: '相同内容试卷上次批改失败，请重试上次任务或换张照片',
            existingTask: {
              id: failedExisting[0].id,
              status: failedExisting[0].status,
              lastError: failedExisting[0].last_error,
              createdAt: failedExisting[0].created_at,
            },
          })
        }
      } catch (dedupErr) {
        // 去重查询失败不阻塞主流程：降级到原逻辑，记日志便于排查
        console.warn('[Upload Dedup] 查询失败，降级到原逻辑:', dedupErr.message)
      }
    }

    const queue = await getTaskQueue()
    console.log(`[Upload Pipeline] 收到 ${files.length} 个文件, studentId=${resolvedStudentId}`)

    const uploadSummary = await uploadFilesWithRetry(files, resolvedStudentId, {
      maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
      onFileProgress: (filename, step, data) => {
        console.log(`[Upload Pipeline] [${filename}] ${step}: ${data.valid ? 'PASS' : 'FAIL'}`)
      },
    })

    const tasks = []
    const boundingBoxResults = []

    // ── 多图一任务：一次上传的所有成功文件合并为一个 task ──
    // images JSONB 按上传顺序存 [{page_number, image_url, file_name}]，
    // image_url 列保留 = 第 1 页（缩略图 / 旧代码兼容）。
    const succeeded = uploadSummary.results.filter(r => r.success)
    const failed = uploadSummary.results.filter(r => !r.success)

    for (const result of failed) {
      console.error(`? [Upload] 文件 ${result.filename} 上传失败: ${result.errorType} — ${result.error}`)
      tasks.push({
        error: true,
        originalName: result.filename,
        message: result.error || '上传失败',
        errorType: result.errorType || 'UPLOAD_FAILED',
        attempts: result.attempts.map(a => ({
          type: a.type,
          result: a.result,
          error: a.error,
          timestamp: a.timestamp,
        })),
      })
      boundingBoxResults.push({
        filename: result.filename,
        status: 'skipped',
        error: result.error,
        note: '上传失败，跳过边界框生成',
      })
    }

    if (succeeded.length > 0) {
      const images = succeeded.map((result, index) => ({
        page_number: index + 1,
        image_url: typeof result.url === 'string' ? result.url : String(result.url),
        file_name: result.filename,
      }))
      const firstUrl = images[0].image_url
      // 客户端在内页选过名字（练习册/答案库/科目+时间）时优先使用，避免落库成相机文件名
      const clientTaskName = typeof taskName === 'string' && taskName.trim() ? taskName.trim().slice(0, 100) : null
      const taskNameResolved = clientTaskName || (succeeded.length > 1
        ? `${succeeded[0].filename} 等${succeeded.length}页`
        : succeeded[0].filename)

      // content_hash 取第一张图（多图任务以首页为主）。空数组 = 老版本/算 hash 失败 → 写 NULL。
      // 2026-09-02：提到 try 外层声明，让下方 catch 块的 23505 兜底能访问到
      // （之前写在 try 内，TDZ 让 catch 拿不到，会抛 ReferenceError）
      const primaryHash = contentHashes[0] || null

      try {
        for (const img of images) {
          console.log(`  OSS 上传成功: ${img.file_name} → ${img.image_url}`)
        }

        // content_hash 取第一张图（多图任务以首页为主）。空数组 = 老版本/算 hash 失败 → 写 NULL。
        // 已提到 try 外的上一层声明，catch 块可直接访问

        const { rows } = await query(
          `INSERT INTO ${TABLES.TASKS} (student_id, image_url, images, original_name, status, result, task_type, generated_exam_id, worksheet_id, subject, resource_id, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [resolvedStudentId, firstUrl, JSON.stringify(images), taskNameResolved, TASK_STATUS.PROCESSING, JSON.stringify({ progress: 0 }), normalizedTaskType, normalizedGeneratedExamId, worksheetId || null, subject || null, normalizedResourceId, primaryHash]
        )

        const savedTask = rows[0]
        console.log(`  DB 记录已创建: taskId=${savedTask.id} (${images.length} 页)`)

        const jobData = {
          taskId: savedTask.id,
          studentId: resolvedStudentId,
          imageUrl: firstUrl,
          images,
          originalName: taskNameResolved,
          generatedExamId: normalizedGeneratedExamId,
          taskType: normalizedTaskType,
          worksheetId: worksheetId || null,
          // 任务表已有 subject 时同步进 job；worker 仍以练习册资源 subject 为权威。
          subject: subject || null,
          resourceId: normalizedResourceId
        }

        if (queue) {
          console.log(`   提交任务到 Redis 队列: taskId=${savedTask.id}`)
          try {
            const job = await queue.add('process-task', jobData, {
              attempts: parseInt(process.env.MAX_RETRIES) || 3,
              backoff: { type: 'exponential', delay: 5000 }
            })
            console.log(`  ? 任务已加入队列: jobId=${job.id}`)
          } catch (queueError) {
            // 队列提交失败时清理孤儿任务，避免 pending 任务堆积
            console.error(`  ? 队列提交失败，清理 DB 记录: taskId=${savedTask.id}`, queueError.message)
            query(`DELETE FROM ${TABLES.TASKS} WHERE id = $1`, [savedTask.id])
              .catch(e => console.error(`  ? 清理孤儿任务失败:`, e.message))
            throw queueError // 由外层 catch 统一处理
          }
        } else {
          console.log(`  ??  Redis 队列未连接，跳过队列提交`)
          // 兜底：直接同步调用 Worker 处理
          processTask({ data: jobData }).catch(e => console.error('  ? 同步处理失败: ' + e.message))
        }

        tasks.push(savedTask)
        for (const img of images) {
          boundingBoxResults.push({
            filename: img.file_name,
            taskId: savedTask.id,
            status: 'queued',
            note: '等待队列处理后生成边界框',
          })
        }
      } catch (dbError) {
        console.error(`? [Upload] 数据库创建任务失败:`, dbError)
        // UNIQUE 23505 兜底：并发同图上传，前置查询都返回空、INSERT 撞唯一索引。
        // 此时 DB 已有同 hash 任务，直接复用并清掉这次孤儿 OSS 文件。
        if (dbError.code === '23505' && primaryHash) {
          try {
            const { rows: dup } = await query(
              `SELECT id, status, original_name, created_at FROM ${TABLES.TASKS}
               WHERE student_id = $1 AND content_hash = $2 AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1`,
              [resolvedStudentId, primaryHash]
            )
            if (dup.length > 0) {
              console.log(`[Upload Dedup] 23505 兜底命中: 新上传被合并到 taskId=${dup[0].id}`)
              for (const img of images) {
                try { const urlObj = new URL(img.image_url); const ossPath = urlObj.pathname.replace(/^\//, ''); await deleteFile(ossPath) } catch (e) { /* ignore */ }
              }
              tasks.push({
                ...dup[0],
                originalName: dup[0].original_name,
                _dedup: true,
                _dedupMessage: '并发上传已合并',
              })
              // 跳过后续报错推送，直接走正常返回
              return res.json({
                success: true,
                count: 1,
                failed: 0,
                dedup: true,
                reportId: null,
                tasks,
                summary: { dedup: true, reusedTaskId: dup[0].id },
              })
            }
          } catch (recoveryErr) {
            console.error('[Upload Dedup] 23505 兜底查询失败:', recoveryErr.message)
          }
        }
        tasks.push({
          error: true,
          originalName: taskName,
          message: '数据库写入失败: ' + dbError.message,
          errorType: 'DB_ERROR'
        })
        for (const img of images) {
          boundingBoxResults.push({
            filename: img.file_name,
            status: 'failed',
            error: dbError.message,
          })
          // 清理已上传的 OSS 文件（避免生成孤儿文件）
          try { const urlObj = new URL(img.image_url); const ossPath = urlObj.pathname.replace(/^\//, ''); await deleteFile(ossPath) } catch (e) { console.error('  OSS 清理失败:', e.message) }
        }
      }
    }

    const report = createUploadReport(studentId, uploadSummary, boundingBoxResults)
    logUploadReport(report)

    res.json({
      success: true,
      count: tasks.filter(t => !t.error).length,
      failed: tasks.filter(t => t.error).length,
      reportId: report.id,
      tasks,
      summary: report.summary,
    })
  } catch (error) {
    console.error('上传处理失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Create task by URL
app.post('/api/tasks/create-by-url', async (req, res) => {
  try {
    const { studentId, imageUrl, originalName } = req.body
    if (!studentId || !imageUrl) {
      return res.status(400).json({ error: '缺少 studentId 或 imageUrl' })
    }

    const queue = await getTaskQueue()

    const { rows } = await query(
      `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [studentId, imageUrl, originalName || `试卷_${Date.now()}.jpg`, TASK_STATUS.PENDING, JSON.stringify({ progress: 0 })]
    )

    const savedTask = rows[0]

    if (queue) {
      await queue.add('process-task', {
        taskId: savedTask.id,
        studentId: studentId,
        imageUrl: imageUrl,
        originalName: savedTask.original_name
      }, {
        attempts: parseInt(process.env.MAX_RETRIES) || 3,
        backoff: { type: 'exponential', delay: 5000 }
      })
    }

    res.json({ success: true, task: savedTask })
  } catch (error) {
    console.error('创建任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── 通知摘要缓存（10 秒 TTL，减少轮询时的重复查询）──
let summaryCache = { data: null, timestamp: 0 }
const SUMMARY_TTL = 10000

// ─────────────────────────────────────────────
// 通知摘要（跨学生全局聚合）
// ─────────────────────────────────────────────
app.get('/api/tasks/summary', async (req, res) => {
  try {
    // 缓存命中且未过期
    const now = Date.now()
    if (summaryCache.data && (now - summaryCache.timestamp) < SUMMARY_TTL) {
      return res.json(summaryCache.data)
    }

    // 单次查询：用子查询合并 3 个 COUNT，避免 3 次 DB 往返
    // 铃铛计数只统计「未读」的 done/failed 任务（notification_read_at IS NULL）
    // recent_tasks（PC 铃铛清单）：教师已读（notification_read_at IS NOT NULL）的 done 任务 + failed 任务
    // pending_tasks（Dashboard Layer 2）：教师未读（notification_read_at IS NULL）的 done 任务
    //   与 briefing 铃铛桶（未读 done）保持口径一致，点击直达对应 task 复核页
    const { rows } = await query(
      `SELECT
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.TASKS} WHERE status = $1 AND deleted_at IS NULL AND notification_read_at IS NULL), 0) AS pending_review,
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.TASKS} WHERE status = $2 AND deleted_at IS NULL AND notification_read_at IS NULL), 0) AS failed_tasks,
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} WHERE lifecycle_status = $3 AND added_at::date = CURRENT_DATE), 0) AS today_new_wrong,
         COALESCE((SELECT COUNT(*)::int FROM ${TABLES.TASKS} WHERE status = $4 AND deleted_at IS NULL), 0) AS in_progress_count,
         (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
           SELECT t.id, t.student_id, t.original_name, t.status, t.created_at, t.updated_at,
                  t.notification_read_at, s.name AS student_name,
                  COALESCE((t.result->>'wrongCount')::int, (t.result->>'wrong_count')::int, 0) AS wrong_count,
                  COALESCE((t.result->>'questionCount')::int, (t.result->>'question_count')::int, 0) AS question_count,
                  COALESCE((t.result->>'emptyCount')::int, (t.result->>'empty_count')::int, 0) AS empty_count,
                  COALESCE((t.result->>'pendingCount')::int, (t.result->>'pending_count')::int, 0) AS pending_count
           FROM ${TABLES.TASKS} t
           LEFT JOIN ${TABLES.STUDENTS} s ON s.id = t.student_id
           WHERE t.deleted_at IS NULL
             AND t.status = $1 AND t.notification_read_at IS NULL
           ORDER BY t.updated_at DESC LIMIT 5
         ) t) AS pending_tasks,
         (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
           SELECT t.id, t.student_id, t.original_name, t.status, t.created_at, t.updated_at,
                  t.notification_read_at, s.name AS student_name,
                  COALESCE((t.result->>'wrongCount')::int, (t.result->>'wrong_count')::int, 0) AS wrong_count,
                  COALESCE((t.result->>'questionCount')::int, (t.result->>'question_count')::int, 0) AS question_count,
                  COALESCE((t.result->>'emptyCount')::int, (t.result->>'empty_count')::int, 0) AS empty_count,
                  COALESCE((t.result->>'pendingCount')::int, (t.result->>'pending_count')::int, 0) AS pending_count
           FROM ${TABLES.TASKS} t
           LEFT JOIN ${TABLES.STUDENTS} s ON s.id = t.student_id
           WHERE t.deleted_at IS NULL
             AND ((t.status = $1 AND t.notification_read_at IS NOT NULL) OR t.status = $2)
           ORDER BY COALESCE(t.notification_read_at, t.updated_at) DESC LIMIT 5
         ) t) AS recent_tasks`,
      [TASK_STATUS.DONE, 'failed', 'new', TASK_STATUS.PROCESSING]
    )

    const mapTask = (t) => ({
      id: t.id,
      // studentId 供「点击通知直达该学生下的复核页」使用：复核页以 studentId 定位学生，
      // 缺失时会落到默认第一个学生的空状态（见 ReviewWorkspace 的 openTask 注释）。
      studentId: t.student_id,
      originalName: t.original_name,
      status: t.status,
      createdAt: t.created_at,
      notificationReadAt: t.notification_read_at,
      studentName: t.student_name,
      // 统计口径见 src/domain/taskResultStats.js：worker 写的是驼峰 wrongCount，
      // 这里原先只读下划线 wrong_count ⇒ 恒 0 ⇒ 移动端通知一律误报「全部做对」。
      // 现在两种命名都取，并把空题/待复核一并带出（wrong=0 不等于全对）。
      questionCount: t.question_count,
      wrongCount: t.wrong_count,
      emptyCount: t.empty_count,
      pendingCount: t.pending_count
    })

    const r = rows[0]
    const data = {
      success: true,
      summary: {
        pendingReview: r.pending_review,
        failedTasks: r.failed_tasks,
        todayNewWrongQuestions: r.today_new_wrong,
        inProgressCount: r.in_progress_count,
        totalNotifications: r.pending_review + r.failed_tasks,
        pendingTasks: (r.pending_tasks || []).map(mapTask),
        recentTasks: (r.recent_tasks || []).map(mapTask)
      }
    }

    // 写入缓存
    summaryCache = { data, timestamp: now }

    res.json(data)
  } catch (error) {
    console.error('获取通知摘要失败:', error)
    // 卡顿排查(P0)：DB 抖断时若上次有成功缓存，返回 stale 数据而非 500，
    // 避免前端铃铛/通知在 Neon 连接波动时卡死或报错。前端可据 _stale 提示用户数据可能延迟。
    if (summaryCache.data) {
      console.warn('[summary] DB 失败，降级返回上次缓存 (stale)')
      return res.json({ ...summaryCache.data, _stale: true })
    }
    res.status(500).json({ error: error.message })
  }
})

// ─────────────────────────────────────────────
// 通知全部已读：将批改完成/识别失败的任务标记为已读，铃铛数字归零
// ─────────────────────────────────────────────
app.post('/api/tasks/notifications/read', async (req, res) => {
  try {
    await query(
      `UPDATE ${TABLES.TASKS}
       SET notification_read_at = NOW()
       WHERE status IN ($1, $2) AND deleted_at IS NULL AND notification_read_at IS NULL`,
      [TASK_STATUS.DONE, 'failed']
    )
    // 使 summary 缓存失效，下次拉取立即反映新数字
    summaryCache = { data: null, timestamp: 0 }
    res.json({ success: true })
  } catch (error) {
    console.error('标记通知已读失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── 批改中看板缓存（10s TTL，独立于 summary）──
let inProgressCache = { data: null, timestamp: 0 }

// ─────────────────────────────────────────────
// 批改中任务列表：老师 PC 工作台"批改中"看板 + 移动端铃铛分两态的数据源
// 返回按 started_at DESC 最近 50 条 processing 任务；含卡死判定（5 分钟无更新）
// ─────────────────────────────────────────────
app.get('/api/tasks/in-progress', async (req, res) => {
  try {
    const now = Date.now()
    if (inProgressCache.data && (now - inProgressCache.timestamp) < SUMMARY_TTL) {
      return res.json(inProgressCache.data)
    }
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const { rows } = await query(
      `SELECT
         t.id, t.student_id, t.original_name, t.task_type, t.subject,
         t.started_at, t.updated_at, t.retry_count, t.last_error,
         s.name AS student_name,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(t.started_at, t.updated_at, t.created_at)))::int AS elapsed_sec,
         (COALESCE(t.updated_at, t.started_at, t.created_at) < NOW() - INTERVAL '300 seconds') AS is_stalled
       FROM ${TABLES.TASKS} t
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = t.student_id
       WHERE t.status = $1 AND t.deleted_at IS NULL
       ORDER BY COALESCE(t.started_at, t.updated_at, t.created_at) DESC
       LIMIT $2`,
      [TASK_STATUS.PROCESSING, limit]
    )
    const data = {
      success: true,
      count: rows.length,
      tasks: rows.map(t => ({
        id: t.id,
        studentId: t.student_id,
        studentName: t.student_name,
        originalName: t.original_name,
        taskType: t.task_type,
        subject: t.subject,
        startedAt: t.started_at,
        updatedAt: t.updated_at,
        retryCount: t.retry_count,
        lastError: t.last_error,
        elapsedSec: t.elapsed_sec,
        isStalled: t.is_stalled,
      }))
    }
    inProgressCache = { data, timestamp: now }
    res.json(data)
  } catch (error) {
    console.error('获取批改中任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get single task
app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { rows } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )

    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })

    res.json({ success: true, task: rows[0] })
  } catch (error) {
    console.error('获取任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// pendingCount（待复核）是后加的第三桶。历史任务的 result 里没有这个字段，若前端按 0 兜底，
// 旧作业会继续显示「N 道题全部正确」——正是本次要修掉的错觉。首次读列表时按题目行补算并
// 回写，之后有字段直接跳过，不必为此写一次全表迁移。
const backfillPendingCount = async (tasks) => {
  const stale = tasks.filter(t => t.result && t.result.questionCount && t.result.pendingCount == null)
  if (stale.length === 0) return

  const ids = stale.map(t => t.id)
  const { rows } = await query(
    `SELECT task_id, is_correct, answer_source, review_status, confidence
     FROM ${TABLES.QUESTIONS} WHERE task_id = ANY($1)`,
    [ids]
  )
  const byTask = new Map()
  for (const r of rows) {
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, [])
    byTask.get(r.task_id).push(r)
  }

  const patches = stale.map(t => {
    const { pendingCount } = computeTaskStats(byTask.get(t.id) || [])
    t.result = { ...t.result, pendingCount }
    return JSON.stringify({ pendingCount })
  })
  await query(
    `UPDATE ${TABLES.TASKS} t
     SET result = COALESCE(t.result, '{}'::jsonb) || v.patch::jsonb
     FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS patch) v
     WHERE t.id = v.id`,
    [ids, patches]
  )
}

// Get tasks by student
app.get('/api/tasks/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { rows } = await query(
      `SELECT id, student_id, status, original_name, image_url, images, result,
              created_at, updated_at, task_type, worksheet_id, subject, generated_exam_id,
              started_at, last_error, retry_count
       FROM ${TABLES.TASKS} WHERE student_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )
    // 回填失败不能拖垮列表：摘要退化成旧口径，但作业列表照常返回
    await backfillPendingCount(rows).catch(e => console.error('回填 pendingCount 失败:', e.message))
    res.json({ success: true, tasks: rows })
  } catch (error) {
    console.error('获取学生任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Update task (e.g., mark review as done)
app.put('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const { status } = req.body
    const { rows } = await query(
      `UPDATE ${TABLES.TASKS} SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, taskId]
    )
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })

    // v4 自动发布：老师"完成复核"（status→reviewed））→ 资源自动升 teacher_verified。
    // 语义：老师点完成复核 = 整份 task 已被审过 → 资源可信度升 teacher_verified。
    // 即便某些单题仍是 ai_draft（老师没改 AI 答案），整体已可信。
    // 2026-09-03 简化：去掉 AND status='draft' 限制，让任何 exam 资源在 reviewed 时
    // 都刷新 answer_status。已 published + ai_draft 的旧资源（新闵学校这条）现在也能
    // 通过老师完成任一次复核 → 一键背书，不再需要简陋的 ExamAnswerReview 逐题审。
    if (status === 'reviewed') {
      try {
        await query(
          `UPDATE ${TABLES.RESOURCES}
           SET answer_status = 'teacher_verified', updated_at = NOW()
           WHERE id = (SELECT resource_id FROM ${TABLES.TASKS} WHERE id = $1)
             AND resource_type = 'exam'
             AND answer_status != 'teacher_verified'`,
          [taskId]
        )
        console.log(`✅ [Auto-publish] 老师完成复核 task=${taskId.slice(0, 8)} → 关联资源已升 teacher_verified`)
      } catch (publishErr) {
        console.error('[Auto-publish] 失败:', publishErr.message)
      }
    }

    res.json({ success: true, task: rows[0] })
  } catch (error) {
    console.error('更新任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

async function retryTaskById(taskId) {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
    [taskId]
  )

  if (rows.length === 0) throw new Error('任务不存在')

  const task = rows[0]
  const queue = await getTaskQueue()
  const result = task.result || {}

  // 用户主动重试 → 重置 retry_count 与 last_error，给一份全新的自动重试额度。
  // 否则 retry_count 已撞上 MAX_AUTO_RETRIES 的任务即使这次又失败，
  // 也再不会被 PendingTaskRecovery 接管；残留的 last_error 还会命中非重试黑名单，
  // 让 stuck 扫描直接跳过它。
  await query(
    `UPDATE ${TABLES.TASKS}
     SET status = $1, result = $2, retry_count = 0, last_error = NULL, updated_at = NOW()
     WHERE id = $3`,
    [TASK_STATUS.PENDING, JSON.stringify({
      progress: 0,
      retryCount: (result.retryCount || 0) + 1,
      previousError: result.error || null
    }), taskId]
  )

  if (queue) {
    await queue.add('process-task', {
      taskId: task.id,
      studentId: task.student_id,
      imageUrl: task.image_url,
      images: task.images || null,
      originalName: task.original_name,
      taskType: task.task_type || null,
      worksheetId: task.worksheet_id || null,
      subject: task.subject || null,
      // ⚠️ workbook 任务绝不能把 worksheet_id 兜底进 resourceId：
      // processTask 见 resourceId 非空会优先路由到 processAnswerBankGrading（普通错题
      // addWrongQuestions 语义），绕开练习册专用的 processWorkbookGrading（自包含错题
      // addSelfContainedWrongQuestion 语义），重批改会破坏错题数据模型
      // （练习册错题带 worksheet_id/page_number/question_no，普通错题只挂 question_id）。
      // worksheet 的答案库本就存在 resource_answers（resource_id = worksheet_id），
      // workbook 管线内部按 worksheetId 读取，无需 resourceId 兜底。
      resourceId: task.task_type === 'workbook'
        ? (task.resource_id || null)
        : (task.resource_id || task.worksheet_id || null),
      generatedExamId: task.generated_exam_id || null
    }, {
      attempts: parseInt(process.env.MAX_RETRIES) || 3,
      backoff: { type: 'exponential', delay: 5000 }
    })
  }

  return { taskId: task.id, originalName: task.original_name, status: TASK_STATUS.PENDING }
}

// Retry task
app.post('/api/tasks/:taskId/retry', async (req, res) => {
  try {
    const { taskId } = req.params
    const result = await retryTaskById(taskId)
    res.json({ success: true, message: '任务已重新提交', ...result })
  } catch (error) {
    console.error('重试任务失败:', error)
    const status = error.message === '任务不存在' ? 404 : 500
    res.status(status).json({ error: error.message })
  }
})

// Admin: retry task by original name (useful when taskId is unknown)
app.post('/api/admin/tasks/retry-by-name', async (req, res) => {
  try {
    const { originalName } = req.body
    if (!originalName) return res.status(400).json({ error: '缺少 originalName' })

    const { rows } = await query(
      `SELECT id, original_name, status FROM ${TABLES.TASKS}
       WHERE deleted_at IS NULL AND original_name ILIKE $1
       ORDER BY updated_at DESC LIMIT 1`,
      [`%${originalName}%`]
    )
    if (rows.length === 0) return res.status(404).json({ error: '未找到匹配任务' })

    const taskId = rows[0].id
    const result = await retryTaskById(taskId)
    res.json({ success: true, message: '任务已重新提交', ...result })
  } catch (error) {
    console.error('按名称重试任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Admin: 改批改路线并重批 —— 「上传时选错练习册路线」的纠正通道。
//
// 事故背景（2026-09-20）：选了练习册路线、卷子其实不是那本练习册时，workbook 管线
// 拿 A 册答案库对 B 卷题号 ⇒ 整卷错判；且 workbook 的 OCR 只提「页标题+题号+手写答案」，
// 题干靠答案库回填，对不上就落成「第 N 题」占位符；错题还会以 source_type='workbook'
// + 错误的 worksheet_id 入册（周末课件按 ws:{worksheet_id}|p|n 聚合 ⇒ 脏题混进该册题单）。
// 而 PUT /api/tasks/:id 只能改 status、retry 从 DB 回读原字段重跑同一条管线 ⇒ 无法自愈。
//
// 本端点把「清脏数据 → 改路线 → 重入队」三步封成一次调用，字段口径唯一来源
// utils/taskRoute.js（worksheet_id 必须与 resource_id 一起清，否则 retryTaskById 会把
// worksheet_id 兜底成 resourceId，让任务拐进答案库管线用同一本练习册再错一次）。
//
// ⚠️ 默认 dryRun=true：先返回影响面，人工确认后再带 dryRun=false 执行。
app.post('/api/admin/tasks/:taskId/convert-route', async (req, res) => {
  try {
    const { taskId } = req.params
    const { target = 'homework', resourceId = null, worksheetId = null, dryRun = true } = req.body || {}

    // ⚠️ 功能开关（默认关闭）：dryRun 也一起拦，避免"能预演不能执行"的半开状态让人误会。
    if (!isRouteConvertEnabled()) {
      return res.status(403).json({ error: ROUTE_CONVERT_DISABLED_MESSAGE, code: 'route_convert_disabled' })
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(taskId)) return res.status(400).json({ error: '无效的任务ID' })

    const { rows } = await query(
      `SELECT id, student_id, original_name, status, task_type, worksheet_id, resource_id,
              generated_exam_id, subject, created_at, deleted_at
         FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const task = rows[0]
    if (!task) return res.status(404).json({ error: '任务不存在' })
    if (task.deleted_at) return res.status(400).json({ error: '任务已删除（软删），不能转路线' })

    const plan = planTaskRouteChange(task, target, { resourceId, worksheetId })
    if (!plan.ok) {
      const status = plan.code === 'noop' ? 200 : 400
      return res.status(status).json({ error: plan.reason, code: plan.code, routeKind: resolveRouteKind(task) })
    }

    // ── 影响面取证（dryRun 与实跑共用同一份，保证"看到的"就是"删掉的"）──
    // 题号列名：questions 表是 question_number，question_no 只存在于 wrong_questions /
    // worksheet_answers / resource_answers。此处写错列名会让整条路由 42703 直接 500
    // （2026-09-23 实际发生）。需求只是给老师看样本，故 question_number 即可。
    const { rows: questionRows } = await query(
      `SELECT id, content, page_number, question_number FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
      [taskId]
    )
    const questionIds = questionRows.map((r) => r.id)
    const placeholderCount = questionRows.filter((r) => /^第\s*\d+\s*题$/.test(String(r.content || '').trim())).length

    const countBy = async (sql, params) => {
      const { rows: c } = await query(sql, params)
      return c[0] || {}
    }
    const wq = await countBy(
      `SELECT COUNT(*)::int AS total FROM ${TABLES.WRONG_QUESTIONS}
        WHERE question_id = ANY($1::uuid[]) OR last_wrong_task_id = $2`,
      [questionIds, taskId]
    )
    const jd = await countBy(
      // ⚠️ judgements.question_id 是 TEXT 列（迁移 010 后建覆盖了 006 的 UUID 口径），
      // 传 uuid[] 会让 PG 报 "operator does not exist: text = uuid" ⇒ 整条路由 500。
      // 与 gradingFinalizer.getSettlementRows 同口径：改传 text[]。2026-09-23 二次踩坑。
      `SELECT COUNT(*)::int AS total FROM ${TABLES.JUDGEMENTS} WHERE question_id = ANY($1::text[])`,
      [questionIds.map(String)]
    )
    const asset = await countBy(
      `SELECT COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE clean_geometry_svg IS NOT NULL OR tikz_status = 'completed'))::int AS published
         FROM ${TABLES.QUESTION_ASSETS} WHERE question_id = ANY($1::uuid[])`,
      [questionIds]
    )

    // 转练习册时补查该册的答案条数（workbook 管线的题干与参考答案全靠它）。
    // 0 条 = 转换后整卷无参考答案，必须提前告诉老师。
    let workbookAnswerCount = null
    let worksheetRow = null
    if (target === 'workbook') {
      const { rows: wsRows } = await query(
        `SELECT id, name, resource_type FROM ${TABLES.RESOURCES} WHERE id = $1`,
        [worksheetId]
      )
      worksheetRow = wsRows[0] || null
      // 练习册不存在 ⇒ 转过去后 worker 会因缺答案整卷挂空，这里直接拦掉。
      if (!worksheetRow || worksheetRow.resource_type !== 'worksheet') {
        return res.status(400).json({ error: '所选练习册不存在（worksheetId 无效）', code: 'workbook_not_found' })
      }
      const c = await countBy(
        `SELECT COUNT(*)::int AS total FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1`,
        [worksheetId]
      )
      workbookAnswerCount = c.total || 0
    }

    const impact = {
      questions: questionRows.length,
      placeholderQuestions: placeholderCount,
      wrongQuestions: wq.total || 0,
      judgements: jd.total || 0,
      assets: asset.total || 0,
      publishedRedraws: asset.published || 0,
      workbookAnswerCount,
    }
    // ── 任务名还原（转路线后必须回到目标路线的命名口径）──
    // workbook 路线的名字是客户端拼的「科目 · 练习册名」，而通用管线的改名闸
    // `isAutoTaskName` 默认**不认**这种名字（treatClientPaperNameAsAuto 只有 workbook
    // 管线传 true）⇒ 不改就永远挂着错误的册名，且重跑时卷面标题覆盖不上它。
    // 还原成客户端同款自动名后，重跑时由卷面印刷标题按 taskTitle.js 口径改写。
    // 老师手工改过的名字（非自动名）一律不动。
    let nextName = null
    if (target === 'workbook') {
      if (worksheetRow?.name && isRouteAutoName(task.original_name)) {
        nextName = `${task.subject || '数学'} · ${worksheetRow.name}`
      }
    } else if (shouldResetTaskName(task.original_name)) {
      nextName = buildAutoTaskName({ subject: task.subject, createdAt: task.created_at })
    }

    const warnings = describeRouteRisk({
      target,
      questions: questionRows.length,
      placeholderQuestions: placeholderCount,
      workbookAnswerCount,
    })
    if (['pending', 'processing'].includes(task.status)) {
      warnings.push(`任务当前 status=${task.status}，可能正在批改中，建议等它结束后再转换（并发写会互相覆盖）`)
    }
    if (questionRows.length > 0 && placeholderCount / questionRows.length >= 0.5) {
      warnings.push(`${placeholderCount}/${questionRows.length} 道题干是「第 N 题」占位符 —— 符合"选错练习册路线"的特征`)
    }
    if ((asset.published || 0) > 0) {
      warnings.push(`将连带删除 ${asset.total} 条题目资产（含 ${asset.published} 条已发布重绘图，question_assets 是 ON DELETE CASCADE），重跑后需重新重绘`)
    }
    if (nextName) {
      warnings.push(`任务名将还原为「${nextName}」——重跑后由卷面印刷标题覆盖（校名页眉会被剥掉）`)
    } else if (/\s·\s/.test(String(task.original_name || ''))) {
      warnings.push(`任务名「${task.original_name}」疑似人工改过，保持原样不还原`)
    }

    if (dryRun) {
      return res.json({
        dryRun: true,
        taskId,
        studentId: task.student_id,
        originalName: task.original_name,
        routeKind: resolveRouteKind(task),
        from: plan.from,
        to: plan.patch,
        nameChange: nextName ? { from: task.original_name, to: nextName } : null,
        impact,
        warnings,
        samples: questionRows.slice(0, 5).map((r) => ({
          id: r.id, page: r.page_number, no: r.question_number,
          content: String(r.content || '').slice(0, 40),
        })),
        hint: '确认无误后带 dryRun=false 重新调用',
      })
    }

    // ── 执行：清脏数据 → 改路线 → 重入队 ──
    const deleted = { judgements: 0, wrongQuestions: 0, questions: 0 }
    if (questionIds.length > 0) {
      const r1 = await query(
        // 同 jd 计数：judgements.question_id 是 TEXT 列，必须传 text[]（见上条注释）。
        `DELETE FROM ${TABLES.JUDGEMENTS} WHERE question_id = ANY($1::text[])`,
        [questionIds.map(String)]
      )
      deleted.judgements = r1.rowCount || 0
      // ⚠️ 错题行必须先于题目行删除：wrong_questions.question_id 是 ON DELETE SET NULL，
      // 先删 questions 只会把这些自包含脏行变成孤儿（content/worksheet_id 全留着），清不掉。
      const r2 = await query(
        `DELETE FROM ${TABLES.WRONG_QUESTIONS}
          WHERE question_id = ANY($1::uuid[]) OR last_wrong_task_id = $2`,
        [questionIds, taskId]
      )
      deleted.wrongQuestions = r2.rowCount || 0
    }
    deleted.questions = await deleteQuestionsByTaskId(taskId)

    const setClauses = ['task_type = $1', 'worksheet_id = $2', 'resource_id = $3', 'updated_at = NOW()']
    const params = [plan.patch.task_type, plan.patch.worksheet_id, plan.patch.resource_id]
    if (nextName) {
      params.push(nextName)
      setClauses.push(`original_name = $${params.length}`)
    }
    params.push(taskId)
    await query(
      `UPDATE ${TABLES.TASKS} SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params
    )

    // retryTaskById 会重置 status/retry_count/last_error 并按【新字段】入队，
    // 此时 worksheet_id 已为 NULL ⇒ 不会再被兜底成 resourceId（见 utils/taskRoute.js）。
    const retry = await retryTaskById(taskId)

    console.log(
      `🔀 [Route] 转路线重批 task=${taskId.slice(0, 8)} ${plan.from.task_type}→${plan.patch.task_type}` +
      `（清 题${deleted.questions} / 错题${deleted.wrongQuestions} / 判题${deleted.judgements}，影响面 ${JSON.stringify(impact)}）`
    )

    res.json({
      dryRun: false,
      taskId,
      studentId: task.student_id,
      originalName: task.original_name,
      from: plan.from,
      to: plan.patch,
      nameChange: nextName ? { from: task.original_name, to: nextName } : null,
      impact,
      deleted,
      warnings,
      retry,
    })
  } catch (error) {
    console.error('[admin/tasks/convert-route] 失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Admin: 手动触发单条 geometry_image 资产重建。
// watchdog 之外的逃生通道：scanGeometryAssets / scanOverdueGeometry 都没动
// 它（队列不通 / 进程不在），人工强制 add 进 geometry-reconstruction 队列。
app.post('/api/admin/geometry/retry/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return res.status(400).json({ error: '无效的 assetId' })
    }

    const { rows } = await query(
      `SELECT id, question_id, tikz_status, retry_count,
              LEFT(COALESCE(last_error, ''), 200) AS last_error,
              created_at, updated_at
       FROM ${TABLES.QUESTION_ASSETS}
       WHERE id = $1 AND asset_type = 'geometry_image'`,
      [assetId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'asset 不存在或类型不是 geometry_image' })
    }
    const asset = rows[0]

    const geometryQueue = await getGeometryQueue()
    if (!geometryQueue) {
      return res.status(503).json({
        error: 'geometry 队列不可用（Redis 断开 / 配额耗尽 / Worker 未运行）',
        asset
      })
    }

    const job = await geometryQueue.add('reconstruct', {
      assetId: asset.id,
      retryCount: (asset.retry_count || 0) + 1,
      source: 'admin-manual-retry'
    }, {
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 }
    })

    console.log(`[admin/geometry/retry] 入队 assetId=${assetId} jobId=${job.id} prev_status=${asset.tikz_status} retry=${asset.retry_count || 0}`)
    res.json({
      success: true,
      message: '已加入 geometry-reconstruction 队列',
      jobId: job.id,
      asset
    })
  } catch (error) {
    console.error('[admin/geometry/retry] 失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── [人工兜底重绘] 教师手改几何结构 → 确定性出清晰矢量图 ──
// 背景：被文本闸门判「多画/无法重绘」回退成模糊裁片的题，老师一眼能认出正确结构。
// 本接口把老师确认的结构交给服务端确定性渲染器（不经视觉模型、不过文本闸门——
// 人工即权威），出干净 SVG 并发布图片 URL，回写 questions + question_assets，
// 标 geometry_manual_override=true（人工背书，前端直读展示）。
app.get('/api/questions/:id/geometry-structure', async (req, res) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      `SELECT a.geometry_structure_json, a.cropped_image_url, q.geometry_image_url\n         FROM ${TABLES.QUESTION_ASSETS} a\n         JOIN ${TABLES.QUESTIONS} q ON q.id = a.question_id\n        WHERE a.question_id = $1 AND a.asset_type = 'geometry_image'\n        ORDER BY a.created_at DESC LIMIT 1`,
      [id]
    )
    if (rows.length === 0) return res.json({ structure: null, cropUrl: null })
    res.json({
      structure: rows[0].geometry_structure_json || null,
      cropUrl: rows[0].cropped_image_url || rows[0].geometry_image_url || null,
    })
  } catch (error) {
    console.error('[geometry-structure GET] 失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/:id/geometry-structure', async (req, res) => {
  try {
    const { id } = req.params
    const structure = req.body?.structure
    if (!structure || !Array.isArray(structure.points) || structure.points.length === 0) {
      return res.status(400).json({ error: '结构为空：至少需要标注一个顶点' })
    }
    const svg = renderGeometrySvg(structure)
    if (!svg) return res.status(422).json({ error: '结构无法渲染（点/线不足或坐标缺失）' })

    await updateQuestionDenormalizedSvg(id, svg)
    const pub = await publishCleanGeometryUrl({ questionId: id, svg })
    await updateQuestionAssetCleanData(id, {
      clean_geometry_svg: svg,
      clean_geometry_image_url: pub?.ok ? pub.url : undefined,
      geometry_structure_json: structure,
    })
    await query(
      `UPDATE ${TABLES.QUESTION_ASSETS} SET tikz_status = 'completed', last_error = NULL, updated_at = NOW()\n        WHERE question_id = $1 AND asset_type = 'geometry_image'`,
      [id]
    )
    await query(`UPDATE ${TABLES.QUESTIONS} SET geometry_manual_override = TRUE, updated_at = NOW() WHERE id = $1`, [id])

    console.log(`[geometry-structure POST] q=${id.slice(0, 8)} 人工结构出图 SVG ${svg.length} 字符, 发布URL=${pub?.ok ? 'ok' : (pub?.reason || 'skip')}`)
    res.json({ success: true, svg, url: pub?.ok ? pub.url : null, published: !!pub?.ok })
  } catch (error) {
    console.error('[geometry-structure POST] 失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Recalculate task statistics from questions
app.post('/api/tasks/:taskId/recalculate-stats', async (req, res) => {
  try {
    const { taskId } = req.params

    // [2026-09-17 修复] 重练答卷（task_type=wrong_retry / 带 generated_exam_id）在 questions 表里
    // **没有本卷题行** —— 题目行是原作业共用行（task_id 指向原作业，见
    // topics/retry-paper-order.md §5.5）。旧实现一律按 task_id 查，对重练答卷恒 0 行，
    // 于是把 questionCount/wrongCount/emptyCount/pendingCount **全部写成 0**：
    // 实测 5 份 status='reviewed' 的重练答卷 result.questionCount 全是 0
    // （未复核的 done 卷反而正常）⇒ 老师一点「完成复核」，卡片上的题数与统计就清零。
    // 现在按题目 ID 取行（重练卷走 generated_exams.question_ids），口径不变。
    let questionIds = null
    const { rows: taskRows } = await query(
      `SELECT task_type, generated_exam_id FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const retryExamId = taskRows[0]?.task_type === 'wrong_retry' || taskRows[0]?.generated_exam_id
      ? taskRows[0]?.generated_exam_id
      : null
    if (retryExamId) {
      const { rows: examRows } = await query(
        `SELECT question_ids FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
        [retryExamId]
      )
      const raw = examRows[0]?.question_ids
      questionIds = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : [])
    }

    const { rows } = questionIds
      ? await query(
          `SELECT is_correct, answer_source, review_status, confidence
           FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`,
          [questionIds]
        )
      : await query(
          `SELECT is_correct, answer_source, review_status, confidence FROM ${TABLES.QUESTIONS} WHERE task_id = $1`,
          [taskId]
        )

    // 与复核页「需处理」同一套分桶：四桶互斥，未作答不再与"改判为错"同时命中，
    // 非空但判不出的题进 pendingCount 而不是凭空消失。
    const { questionCount, correctCount, wrongCount, emptyCount, pendingCount } = computeTaskStats(rows)

    const { rows: updatedRows } = await query(
      `UPDATE ${TABLES.TASKS}
       SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ questionCount, correctCount, wrongCount, emptyCount, pendingCount, progress: 100 }), taskId]
    )

    if (updatedRows.length === 0) {
      return res.status(404).json({ error: '任务不存在' })
    }

    res.json({ success: true, result: updatedRows[0].result })
  } catch (error) {
    console.error('重新计算任务统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Delete task - soft delete to preserve wrong questions
app.delete('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(taskId)) {
      return res.status(400).json({ error: '无效的任务ID' })
    }

    // Soft delete: set deleted_at instead of actual deletion
    // This preserves questions and wrong_questions associations
    await query(
      `UPDATE ${TABLES.TASKS} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [taskId]
    )

    res.json({ success: true, message: '任务已删除（错题已保留）' })
  } catch (error) {
    console.error('删除任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Save task answers as exam answer key (存档为答案库)
// v4 适配：老师"完成复核"已自动 publish（见 PUT /api/tasks/:taskId）。
// 此接口保留给 P1 "再次复核修正" 场景：老师从 PC 答案库列表点"复核"进入 task 复核页，
// 改题后走 PUT /api/questions/:id + syncDraftAnswerBank 升级答案；资源已 published 状态下
// 此接口仍可调用做"重命名 + 整体再升级"（v2 矩阵复用）。
app.post('/api/tasks/:taskId/save-as-answer-key', async (req, res) => {
  try {
    const { taskId } = req.params
    const { name, subject, grade } = req.body
    if (!name) return res.status(400).json({ error: '缺少资源名称' })

    const { rows: tasks } = await query(
      `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const task = tasks[0]
    if (!task) return res.status(404).json({ error: '任务不存在' })
    if (task.status !== 'done' && task.status !== 'reviewed') {
      return res.status(400).json({ error: '任务状态必须是 done 或 reviewed' })
    }
    // 任务类型不限：原本只允许 exam（P1 二次复核），现在 manual 留底也覆盖 workbook / general，
    // 让老师对任何已复核任务都能"留底为答案库"，复用给后续学生。
    // resource_type 固定 'exam'：保持 ExamResourcePicker 单一查询面；task_type 与 resource_type
    // 解耦不污染 picker 列表（picker 只看 resource_type=exam）。

    // 拉题目（含 ai_answer 用于判断"是否被老师改过"）
    // 注：questions 表本身没 sub_no 列（sub_no 只在 resource_answers 上，032 迁移）；
    // 留底时把 sub_no 留作 ''，与 resource_answers.sub_no 语义对齐（空串=整题）。
    const { rows: questions } = await query(
      `SELECT id, question_number, answer, ai_answer, student_answer, is_correct,
              review_status, question_type, content
       FROM ${TABLES.QUESTIONS}
       WHERE task_id = $1 AND answer IS NOT NULL
       ORDER BY question_number ASC`,
      [taskId]
    )
    if (questions.length === 0) return res.status(400).json({ error: '该任务没有题目答案数据' })

    // P1 闸门
    const BAD_ANSWER = findDirtyAnswers(questions)
    if (BAD_ANSWER.length > 0) {
      return res.status(400).json({
        error: '部分题目的标准答案疑似批语或被截断，请先在复核页核对后再存档为答案源',
        suspect: BAD_ANSWER,
      })
    }

    // 复用 task.resource_id（worker 自动建的草稿）；为空则新建。
    let resourceId = task.resource_id
    if (!resourceId) {
      const { rows: [created] } = await query(
        `INSERT INTO resources (resource_type, name, subject, grade, answer_status, status)
         VALUES ('exam', $1, $2, $3, 'teacher_verified', 'published') RETURNING id`,
        [name, subject || task.subject || null, grade || null]
      )
      resourceId = created.id
    }
    // name/subject/grade 的更新并入最后一段 UPDATE，避免「status=published 但 answer_status
    // 还是 ai_draft」的中间态窗口（旧逻辑把 status 推到 published 后，若请求中断会留下脏数据）。

    // v2 矩阵构造每题 answers
    const answers = []
    for (const q of questions) {
      const teacherAnswer = String(q.answer || '').trim()
      const aiAnswer = String(q.ai_answer || '').trim()
      const isAnswerModified = teacherAnswer && teacherAnswer !== aiAnswer
      const studentAnswer = String(q.student_answer || '').trim()
      const reviewStatus = q.review_status
      const isCorrect = q.is_correct

      let nextAnswer = null
      let nextStatus = 'ai_draft'
      if (reviewStatus === 'excluded') {
        nextStatus = 'excluded'
        nextAnswer = teacherAnswer
      } else if (reviewStatus === 'reviewed' && isCorrect === true) {
        nextStatus = 'teacher_verified'
        nextAnswer = studentAnswer
          && studentAnswer !== 'null'
          && studentAnswer !== '未作答'
          && studentAnswer !== '此为主观题，无唯一标准答案'
          ? studentAnswer
          : teacherAnswer
      } else if (reviewStatus === 'reviewed' && isCorrect === false) {
        if (isAnswerModified) {
          nextStatus = 'teacher_verified'
          nextAnswer = teacherAnswer
        } else {
          continue  // 错题且答案未修 → 不入库
        }
      } else if (reviewStatus === 'reviewed' && (isCorrect === null || isCorrect === undefined)) {
        nextStatus = 'ai_draft'
        nextAnswer = teacherAnswer
      } else {
        nextStatus = 'ai_draft'
        nextAnswer = teacherAnswer
      }
      if (!nextAnswer) continue

      answers.push({
        question_no: q.question_number,
        sub_no: q.sub_no || '',
        answer: nextAnswer,
        answer_type: q.question_type || 'answer',
        content: q.content || null,
        section: null,
        answer_status: nextStatus,
        source: 'teacher_approve'
      })
    }

    await replaceResourceAnswers(resourceId, answers)

    // 更新 resource 元信息
    // 资源级 answer_status 强制 teacher_verified：老师主动点"留底为答案库"
    // = 整张试卷已确认，无需再依赖每题是否被标 teacher_verified。
    // 题目级颗粒度仍保留 ai_draft / teacher_verified，供后续追溯。
    // 合并写入 name/subject/grade：旧 else 分支先 UPDATE name/subject/grade + status='published'
    // 再 UPDATE status/answer_status，中断会留 status='published' + answer_status='ai_draft' 脏数据。
    const finalAnswerStatus = 'teacher_verified'
    await query(
      `UPDATE resources
         SET name = $1,
             subject = COALESCE($2, subject),
             grade = COALESCE($3, grade),
             answer_count = $4,
             answer_status = $5,
             status = 'published',
             updated_at = NOW()
       WHERE id = $6`,
      [name, subject || task.subject || null, grade || null, answers.length, finalAnswerStatus, resourceId]
    )

    await query(
      `UPDATE tasks SET resource_id = $1, updated_at = NOW() WHERE id = $2`,
      [resourceId, taskId]
    )

    const { rows: [updatedResource] } = await query(`SELECT * FROM resources WHERE id = $1`, [resourceId])
    res.json({ success: true, resource: updatedResource })
  } catch (error) {
    console.error('存档答案库失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get tasks by resource_id (for exam answer key usage history)
app.get('/api/tasks/resource/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params
    const { rows } = await query(
      `SELECT t.id, t.student_id, t.status, t.original_name, t.created_at,
              s.name AS student_name
       FROM ${TABLES.TASKS} t
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = t.student_id
       WHERE t.resource_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      [resourceId]
    )
    res.json({ success: true, tasks: rows })
  } catch (error) {
    console.error('获取资源任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Queue stats
app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({ success: true, stats })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Retry a pending/failed task
app.post('/api/tasks/retry', async (req, res) => {
  try {
    const { taskId } = req.body
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' })

    // 委托给 retryTaskById：它会从库里读全 taskType / worksheetId / resourceId /
    // generatedExamId / images 等路由字段。此前这里只转发 body 里的 imageUrl，
    // workbook 和错题重练任务重试时会丢失路由信息，被静默降级为完整 AI 管线，
    // 多页任务还会只重跑第一页。
    const result = await retryTaskById(taskId)
    console.log(`[API] 任务已重新加入队列: ${result.originalName || taskId}`)
    res.json({ success: true, message: '任务已重新加入队列', ...result })
  } catch (error) {
    console.error('重试任务失败:', error)
    const status = error.message === '任务不存在' ? 404 : 500
    res.status(status).json({ error: error.message })
  }
})

// Diagnostics: Upload Reports
app.get('/api/diagnostics/upload-reports', async (req, res) => {
  try {
    const { getAllUploadReports, getUploadReport, getReportsByStudent } = await import('./services/uploadReportLogger.js')
    const { reportId, studentId } = req.query

    if (reportId) {
      const report = getUploadReport(reportId)
      return res.json({ success: true, report })
    }
    if (studentId) {
      const reports = getReportsByStudent(studentId)
      return res.json({ success: true, reports })
    }
    const reports = getAllUploadReports()
    res.json({ success: true, count: reports.length, reports })
  } catch (error) {
    console.error('获取上传报告诊断失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Diagnostics: 缺图监控 —— 每周被错题本挡的题趋势，数据驱动决定是否要做工程优化
app.get('/api/diagnostics/weekly-missing-figures', async (req, res) => {
  try {
    const weeks = Math.min(26, Math.max(1, parseInt(req.query.weeks, 10) || 8))
    const { getWeeklyMissingFigureStats } = await import('./services/missingFigureMonitorService.js')
    const stats = await getWeeklyMissingFigureStats(weeks)
    const currentWeek = stats[0]
    res.json({
      success: true,
      weeks,
      stats,
      decision: currentWeek?.wrong_book_blocked >= 5
        ? `⚠️ 本周 ${currentWeek.wrong_book_blocked} 道被错题本挡，建议评估"作图题分类 / prompt 调优"`
        : currentWeek?.wrong_book_blocked > 0
          ? `本周 ${currentWeek.wrong_book_blocked} 道被挡，老师复核补图可消化`
          : '本周 0 道被挡'
    })
  } catch (error) {
    console.error('获取缺图监控失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Diagnostics: Worker Status & System Health
app.get('/api/diagnostics/worker-status', async (req, res) => {
  try {
    const queue = await getTaskQueue()
    const stats = await getQueueStats()

    // Get failed jobs details
    let recentFailures = []
    let recentActive = []
    if (queue) {
      try {
        const failedJobs = await queue.getJobs(['failed'], 0, 4)
        recentFailures = failedJobs.map(j => ({
          jobId: j.id,
          taskId: j.data?.taskId,
          error: j.failedReason,
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          attempts: j.attemptsMade
        }))
      } catch (e) {}

      try {
        const activeJobs = await queue.getJobs(['active'], 0, 4)
        recentActive = activeJobs.map(j => ({
          jobId: j.id,
          taskId: j.data?.taskId,
          progress: j.progress,
          startedAt: j.processedOn ? new Date(j.processedOn).toISOString() : null
        }))
      } catch (e) {}
    }

    // Check OSS config
    const ossConfigOk = !!(process.env.OSS_REGION && process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID)

    // Check AI config
    const aiConfigOk = !!process.env.AI_API_KEY

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      worker: {
        available: !!queue,
        pid: process.pid
      },
      redis: {
        connected: stats.available || false,
        waiting: stats.waiting || 0,
        active: stats.active || 0,
        completed: stats.completed || 0,
        failed: stats.failed || 0,
        delayed: stats.delayed || 0
      },
      config: {
        oss: ossConfigOk,
        ai: aiConfigOk,
        neon: !!process.env.NEON_DATABASE_URL,
        redis: !!(process.env.REDIS_URL || process.env.REDIS_HOST)
      },
      jobs: {
        recentFailures,
        recentActive
      }
    })
  } catch (error) {
    console.error('诊断接口失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Students CRUD
app.post('/api/students', async (req, res) => {
    try {
      const { name, grade, avatar } = req.body
      if (!name) return res.status(400).json({ error: '缺少 name' })

      const { rows } = await query(
        `INSERT INTO ${TABLES.STUDENTS} (name, grade, avatar)
         VALUES ($1, $2, $3) RETURNING *`,
        [name, grade || '', avatar || '']
      )

      res.status(201).json({ success: true, student: rows[0] })
	      studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    } catch (error) {
      console.error('创建学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

// ── 学生列表缓存（5 分钟 TTL，学生列表变化极慢）──
let studentsCache = { data: null, timestamp: 0 }
const STUDENTS_TTL = 300000

app.get('/api/students', async (req, res) => {
  try {
    const now = Date.now()
    if (studentsCache.data && (now - studentsCache.timestamp) < STUDENTS_TTL) {
      return res.json(studentsCache.data)
    }
    // 派生字段：last_task_at（最近作业）、last_wrong_at（最近错题）、
    // total_error_count（错题条数）、recent_wrong_count（近 7 天新错题数）
    // total_error_count 用 COUNT(*)（错题条数），不是 SUM(error_count)：同题多次错只算 1 条，
    // 与「已掌握 N 题 = COUNT(lifecycle_status='mastered')」口径一致（已掌握是子集而非叠加）。
    // 供 PC 工作台 Layer 3 「待关注学生」排序使用；学生无任务/无错题时对应字段为 NULL/0
    // 子查询版本：避免 LEFT JOIN tasks × wrong_questions 笛卡尔积
    const { rows } = await query(
      `SELECT s.id, s.name, s.grade, s.avatar, s.enrollment_status, s.paused_at, s.created_at,
              (SELECT MAX(t.created_at) FROM ${TABLES.TASKS} t WHERE t.student_id = s.id AND t.deleted_at IS NULL) AS last_task_at,
              (SELECT MAX(w.last_wrong_at) FROM ${TABLES.WRONG_QUESTIONS} w WHERE w.student_id = s.id) AS last_wrong_at,
              (SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} w WHERE w.student_id = s.id) AS total_error_count,
              (SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} w WHERE w.student_id = s.id AND w.last_wrong_at >= NOW() - INTERVAL '7 days') AS recent_wrong_count,
              (SELECT COALESCE(SUM(w.practice_count), 0)::int FROM ${TABLES.WRONG_QUESTIONS} w WHERE w.student_id = s.id) AS practice_count,
              (SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} w WHERE w.student_id = s.id AND COALESCE(w.lifecycle_status, 'new') = 'mastered') AS mastered_count
       FROM ${TABLES.STUDENTS} s
       ORDER BY s.created_at DESC`
    )
    const data = { success: true, students: rows }
    studentsCache = { data, timestamp: now }
    res.json(data)
  } catch (error) {
    console.error('获取学生列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { rows } = await query(
      `SELECT id, name, grade, avatar, enrollment_status, paused_at, created_at
       FROM ${TABLES.STUDENTS} WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '学生不存在' })
    res.json({ success: true, student: rows[0] })
  } catch (error) {
    console.error('获取学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/students/:id', async (req, res) => {
    try {
      const { id } = req.params
      const { name, grade, avatar, enrollmentStatus } = req.body

      if (enrollmentStatus !== undefined && !['active', 'paused'].includes(enrollmentStatus)) {
        return res.status(400).json({ error: 'enrollmentStatus 只能是 active 或 paused' })
      }

      // paused_at 跟随 enrollment_status：停课记时间，恢复清空；不传该字段则原样保留
      const { rows } = await query(
        `UPDATE ${TABLES.STUDENTS}
         SET name = COALESCE($1, name),
             grade = COALESCE($2, grade),
             avatar = COALESCE($3, avatar),
             enrollment_status = COALESCE($4, enrollment_status),
             paused_at = CASE
               WHEN $4::text IS NULL THEN paused_at
               WHEN $4::text = 'paused' THEN COALESCE(paused_at, NOW())
               ELSE NULL
             END,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [name, grade, avatar, enrollmentStatus ?? null, id]
      )

      if (rows.length === 0) return res.status(404).json({ error: '学生不存在' })

      res.json({ success: true, student: rows[0] })
      studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    } catch (error) {
      console.error('更新学生失败:', error)
      res.status(500).json({ error: error.message })
    }
  })

app.delete('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [id])
    studentsCache = { data: null, timestamp: 0 } // 使缓存失效
    res.json({ success: true, message: '学生已删除' })
  } catch (error) {
    console.error('删除学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Questions CRUD
app.post('/api/questions', async (req, res) => {
  try {
    const { task_id, student_id, content, options, answer, status, question_type, subject, analysis, image_url, geometry_image_url, parent_stem } = req.body

    if (!task_id || !student_id || !content) {
      return res.status(400).json({ error: '缺少必要字段' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTIONS} (task_id, student_id, content, options, answer, status, question_type, subject, analysis, image_url, geometry_image_url, is_complete, parent_stem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [task_id, student_id, content, JSON.stringify(normalizeOptions(options || [])), answer || null, status || 'pending', question_type || 'answer', subject || '数学', analysis || '', image_url || null, geometry_image_url || null, checkQuestionCompleteness({ content, parent_stem, options, answer, question_type, geometry_image_url }).isComplete, parent_stem || null]
    )

    res.status(201).json({ success: true, question: rows[0] })
  } catch (error) {
    console.error('创建题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 复核页改题 → 回写到批改时自动沉淀的那份草稿答案库。
// 触发源（PUT /api/questions/:id）：answer / student_answer / is_correct / review_status 任一变化。
//
// v2 矩阵决定每题在 resource_answers 中的最终态：
//   review_status='excluded'                       → answer_status='excluded'（保留行，AnswerBank 管线跳过）
//   review_status=NULL（未复核）                   → answer=q.answer，answer_status='ai_draft'
//   review_status='reviewed' && is_correct=true    → answer=student_answer（若非占位）否则 q.answer；answer_status='teacher_verified'
//   review_status='reviewed' && is_correct=false   → 若 q.answer 被老师改过（≠ ai_answer）则用 q.answer + teacher_verified；否则 DELETE 行（错题且答案未修不入库）
//   review_status='reviewed' && is_correct=null    → answer=q.answer，answer_status='ai_draft'
//
// 三重限制确保只动"属于这份作业自己的草稿"：
//   1. resource.status='draft' —— 已发布的资源不能被单次复核偷偷改写；
//   2. resource_answers.source='auto_sediment' —— 不碰 PDF 解析/教师录入的答案；
//   3. 该答案库没有被别的任务共用 —— 共用时它已是多人参照物，只能走 PC 答案库详情页改。
async function syncDraftAnswerBank(question) {
  if (!question?.task_id || question.question_number == null) return
  const { rows: matchRows } = await query(
    `SELECT ra.id, ra.answer, ra.answer_status,
            q.ai_answer, q.student_answer, q.is_correct, q.review_status
     FROM ${TABLES.RESOURCE_ANSWERS} ra
     JOIN ${TABLES.TASKS} t ON t.resource_id = ra.resource_id
     JOIN ${TABLES.QUESTIONS} q ON q.task_id = t.id AND q.question_number = ra.question_no
                              AND (ra.sub_no IS NULL OR ra.sub_no = '') -- questions 表无 sub_no 列，只按整题级匹配草稿答案库
     WHERE t.id = $1
       AND ra.question_no = $2
       AND ra.answer_status IN ('ai_draft', 'excluded')
       AND ra.source = 'auto_sediment'
       AND EXISTS (SELECT 1 FROM ${TABLES.RESOURCES} r WHERE r.id = ra.resource_id AND r.status = 'draft')
       AND NOT EXISTS (
         SELECT 1 FROM ${TABLES.TASKS} t2
         WHERE t2.resource_id = ra.resource_id AND t2.id <> t.id AND t2.deleted_at IS NULL
       )
     LIMIT 1`,
    [question.task_id, question.question_number]
  )
  if (matchRows.length === 0) return
  const row = matchRows[0]
  const aiAnswer = String(row.ai_answer || '').trim()
  const teacherAnswer = String(question.answer || '').trim()
  const studentAnswer = String(question.student_answer || '').trim()
  const isAnswerModified = teacherAnswer && teacherAnswer !== aiAnswer
  const reviewStatus = question.review_status
  const isCorrect = question.is_correct

  // 决策
  let nextAnswer = null
  let nextStatus = 'ai_draft'

  if (reviewStatus === 'excluded') {
    nextStatus = 'excluded'
    nextAnswer = teacherAnswer || row.answer || null
  } else if (reviewStatus === 'reviewed' && isCorrect === true) {
    nextStatus = 'teacher_verified'
    nextAnswer = studentAnswer && studentAnswer !== 'null' && studentAnswer !== '未作答' && studentAnswer !== '此为主观题，无唯一标准答案'
      ? studentAnswer
      : teacherAnswer || row.answer
  } else if (reviewStatus === 'reviewed' && isCorrect === false) {
    if (isAnswerModified) {
      nextStatus = 'teacher_verified'
      nextAnswer = teacherAnswer
    } else {
      // 错题且答案未修 → 不入答案库
      await query(`DELETE FROM ${TABLES.RESOURCE_ANSWERS} WHERE id = $1`, [row.id])
      console.log(`[草稿答案库同步] task=${question.task_id.slice(0, 8)} 第${question.question_number}题 → 删除（错题且答案未修）`)
      return
    }
  } else if (reviewStatus === 'reviewed' && (isCorrect === null || isCorrect === undefined)) {
    nextStatus = 'ai_draft'
    nextAnswer = teacherAnswer || row.answer
  } else {
    // review_status=NULL（未复核）→ 维持 ai_draft；answer 取最新 q.answer（已被 syncDraftAnswerBank 写过）
    nextStatus = 'ai_draft'
    nextAnswer = teacherAnswer || row.answer
  }

  await query(
    `UPDATE ${TABLES.RESOURCE_ANSWERS}
     SET answer = $1, answer_status = $2, updated_at = NOW()
     WHERE id = $3`,
    [nextAnswer, nextStatus, row.id]
  )
  console.log(`[草稿答案库同步] task=${question.task_id.slice(0, 8)} 第${question.question_number}题 → status=${nextStatus}`)
}

app.put('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { content, options, answer, analysis, status, question_type, subject, is_correct, student_answer, image_url, ai_answer, answer_source, geometry_image_url, review_status, review_metadata, display_image_type, source_type, geometry_manual_override } = req.body
    const hasIsCorrect = 'is_correct' in req.body
    const hasAnswerSource = 'answer_source' in req.body && answer_source !== undefined
    const hasReviewStatus = 'review_status' in req.body
    const hasDisplayImageType = 'display_image_type' in req.body
    const hasSourceType = 'source_type' in req.body && source_type !== undefined
    // 手动配图标记：只在 body 里显式给了值时才更新，undefined/null 都不动。
    // 老师手动裁剪/上传时前端传 true，删除配图时前端传 false。
    const hasGeometryManualOverride = 'geometry_manual_override' in req.body && geometry_manual_override !== undefined && geometry_manual_override !== null

    // 复核或改判前读取旧值，用于 judgement 审计；answer / 存疑标注四列用于判断
    // 「参考答案是否被人工改写」（见下方 answerRewritten）。
    // 'answer' in req.body 必须进触发条件：老师只补答案、不改 is_correct 时，
    // 若这里不读旧 answer，就无法区分「真改了」与「原样回传」。
    let oldQuestion = null
    if (hasIsCorrect || hasReviewStatus || 'answer' in req.body) {
      const { rows: oldRows } = await query(
        `SELECT is_correct, task_id, student_id, review_status, answer,
                ai_answer_risk_reason, answer_exception, answer_exception_reason
           FROM ${TABLES.QUESTIONS} WHERE id = $1`,
        [id]
      )
      oldQuestion = oldRows[0] || null
    }
    const oldIsCorrect = oldQuestion?.is_correct ?? null

    // 人工改写参考答案 → 针对**旧**参考答案写下的观测标注全部失效，必须一并清掉。
    //
    // 为什么必须清：ai_answer_risk_reason 是「AI 给了正误结论，但参考答案本身可能不可靠」
    // 的提示，weekendHandout（answerRisk）与 QuestionDetailPanel 都是**无条件透传展示**，
    // 不看 answer 是否已经补上。而本接口原先完全不碰这三列，markAiAnswerRisk /
    // markAnswerException（services/neonService.js）也**只有 set 没有 clear**
    // → 老师补完答案，页面仍永久显示「⚠ 参考答案不可信」，会以为没保存成功而反复补。
    //
    // 判据取「非空 且 与旧值不同」：老师点「判错」时前端会把 answer 原样回传，
    // 那种情况答案没变、风险标注依旧成立，不能清。
    const nextAnswerText = typeof answer === 'string' ? answer.trim() : ''
    const oldAnswerText = typeof oldQuestion?.answer === 'string' ? oldQuestion.answer.trim() : ''
    const answerRewritten = 'answer' in req.body && nextAnswerText !== '' && nextAnswerText !== oldAnswerText

    // PostgreSQL pg 驱动无法推断 undefined 的类型，统一转 null
    const n = (v) => v === undefined ? null : v
    // options 是 jsonb 列：数组必须序列化后再进参数，否则 pg 会按 Postgres 数组字面量发送导致 jsonb 解析失败
    const optionsJson = options == null ? null : JSON.stringify(normalizeOptions(options))

    const { rows } = await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET content = COALESCE($1, content),
           options = COALESCE($2, options),
           answer = COALESCE($3, answer),
           analysis = COALESCE($4, analysis),
           status = COALESCE($5, status),
           question_type = COALESCE($6, question_type),
           subject = COALESCE($7, subject),
           is_correct = CASE WHEN $14 THEN $8::boolean ELSE is_correct END,
           student_answer = COALESCE($9, student_answer),
           image_url = COALESCE($10, image_url),
           ai_answer = COALESCE($11, ai_answer),
           answer_source = CASE WHEN $15 THEN $12::text ELSE answer_source END,
           geometry_image_url = COALESCE($16, geometry_image_url),
           review_status = CASE WHEN $17 THEN $18::text ELSE review_status END,
           display_image_type = CASE WHEN $20 THEN $19::text ELSE display_image_type END,
           source_type = CASE WHEN $21 THEN $22::text ELSE source_type END,
           geometry_manual_override = CASE WHEN $23 THEN $24::boolean ELSE geometry_manual_override END,
           ai_answer_risk_reason = CASE WHEN $25 THEN NULL ELSE ai_answer_risk_reason END,
           answer_exception = CASE WHEN $25 THEN FALSE ELSE answer_exception END,
           answer_exception_reason = CASE WHEN $25 THEN NULL ELSE answer_exception_reason END,
           updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [n(content), optionsJson, n(answer), n(analysis), n(status), n(question_type), n(subject), n(is_correct), n(student_answer), n(image_url), n(ai_answer), n(answer_source), id, hasIsCorrect, hasAnswerSource, n(geometry_image_url), hasReviewStatus, n(review_status), n(display_image_type), hasDisplayImageType, hasSourceType, n(source_type), hasGeometryManualOverride, n(geometry_manual_override), answerRewritten]
    )

    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })

    if (answerRewritten) {
      console.log(`[answer-risk] q=${id.substring(0, 8)} 参考答案被人工改写，已清除存疑标注 `
        + `(old=${JSON.stringify(oldAnswerText).slice(0, 40)} → new=${JSON.stringify(nextAnswerText).slice(0, 40)})`)
    }

    // [cache_id] 如果题目关联了 question_cache 且更新了权威字段，同步写入缓存
    const updatedQuestion = rows[0]
    if (updatedQuestion.cache_id) {
      const canonicalFields = ['content', 'options', 'answer', 'analysis', 'question_type', 'subject']
      const hasCanonicalUpdate = canonicalFields.some(f => f in req.body)
      if (hasCanonicalUpdate) {
        const cacheUpdates = []
        const cacheParams = []
        let paramIdx = 1
        for (const field of canonicalFields) {
          if (field in req.body) {
            let val = req.body[field]
            if (val !== undefined) {
              // JSONB 字段需要序列化
              if (field === 'options') {
                val = JSON.stringify(normalizeOptions(val))
              }
              cacheUpdates.push(`${field} = $${paramIdx++}`)
              cacheParams.push(val)
            }
          }
        }
        if (cacheUpdates.length > 0) {
          cacheParams.push(updatedQuestion.cache_id)
          query(
            `UPDATE ${TABLES.QUESTION_CACHE}
             SET ${cacheUpdates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIdx}`,
            cacheParams
          ).catch(e => console.error(`[cache_id] 同步写入缓存失败 cache=${updatedQuestion.cache_id.substring(0, 8)}:`, e.message))
        }
      }
    }

    // 复核页改题 → 同步回写自动沉淀的草稿答案库（不阻塞响应）
    // v4：监听 answer / student_answer / is_correct / review_status 任一变化
    // 任一触发都会让 syncDraftAnswerBank 按 v2 矩阵重算该题的 answer_status
    const triggeredByAnswerChange = 'answer' in req.body && answer != null && String(answer).trim()
    const triggeredByStudentAnswerChange = req.body.student_answer !== undefined && String(req.body.student_answer || '').trim()
    if (triggeredByAnswerChange || triggeredByStudentAnswerChange || hasIsCorrect || hasReviewStatus) {
      syncDraftAnswerBank(updatedQuestion)
        .catch(e => console.error('[草稿答案库同步] 失败:', e.message))
    }

    // [P1-4b] is_correct 变更时追加写入 PC 编辑判定记录
    // misjudgeType 由前端在 review_metadata.misjudgeType 传入（wrong→correct 时老师选的"误判类型"），
    // 透传到 judgements.metadata 用于事后分析"AI 判错样本归因"。
    const reviewMetadataIn = (review_metadata && typeof review_metadata === 'object') ? review_metadata : null
    const misjudgeType = reviewMetadataIn?.misjudgeType || null
    if (hasIsCorrect && oldIsCorrect !== is_correct) {
      // [问题4 修复 2026-09-01] PUT 改 is_correct 时必须走 settle 流程，
      // 否则 wrong_questions.status / questions.status 不同步——移动端只调 PUT
      // 不调 /rejudge，错题本永远不 mastered。finalizeRejudgeResult 内部按
      // (studentAnswer, answer, questionType, isCorrect) 算 fingerprint 做幂等，
      // 与 /rejudge 共用同一 settle 路径，错题本 + judgement + questions.status 一次同步。
      try {
        await finalizeRejudgeResult({
          question: { ...updatedQuestion, is_correct },
          isCorrect: is_correct,
          oldIsCorrect,
          source: 'review_edit',
          // 老师手动改 is_correct = 人工判定（ground truth），按口径「人工标错直接入」，
          // 不受 AI 置信度闸约束。此前靠「confidenceMap 传 null」意外绕过闸，
          // 2026-09-11 闸改 fail-closed（未传 Map 会回读 DB 判定）后必须显式声明，
          // 否则老师改错的低置信题会被误挡在错题本外。
          manualOverride: true
        })
        // [P1-几何重绘] 老师改判错（旧判对/未定 → 新判错）→ 复活几何资产并重绘。
        // 重绘异步进行、失败只告警，绝不阻塞改判响应（幂等见 requeueGeometryRedrawOnRejudgeWrong）。
        // 只对 is_correct 明确变错触发；改成对/平移状态不花钱重绘。
        if (is_correct === false && updatedQuestion?.id && oldIsCorrect !== false) {
          requeueGeometryRedrawOnRejudgeWrong(updatedQuestion.id).catch(e =>
            console.warn(`[几何重绘·改判错] 异步调用异常: ${e.message.slice(0, 80)}`)
          )
        }
      } catch (settleErr) {
        console.error('[settle] review_edit finalizeRejudgeResult 失败:', settleErr.message)
      }
      createJudgement({
        questionId: id,
        source: 'pc_edit',
        isCorrect: is_correct,
        metadata: { oldIsCorrect, editedFields: Object.keys(req.body).filter(k => k !== 'id'), misjudgeType }
      }).catch(e => console.error('[Shadow] judgements写入失败 (pc_edit):', e.message))
    }

    if (hasReviewStatus) {
      // 老师人工复核「标错」时强入错题本：即使 conf<0.8 当时 OCR 没入，现在也补入。
      // review_status='wrong_no_book' 是「明确不入」语义；其他值走原判定路径。
      if (review_status === 'wrong' && updatedQuestion.student_id) {
        const completeness = checkQuestionCompleteness(updatedQuestion)
        const hasAnswer = !!(updatedQuestion.answer && String(updatedQuestion.answer).trim())
        // 强入结果必须回传：过去失败只在 console 打日志，老师点了「错」以为已经入册，
        // 直到最后复核被门禁拦下才发现，还以为是系统重复提示。
        // wrong_book_sync 随响应一起返回（只读观测，不参与任何判定）。
        if (!hasAnswer) {
          updatedQuestion.wrong_book_sync = {
            status: 'skipped',
            reason: 'missing_answer',
            issues: completeness.issues,
            message: '缺少参考答案，未加入错题本'
          }
        } else if (!completeness.isComplete) {
          updatedQuestion.wrong_book_sync = {
            status: 'skipped',
            reason: 'incomplete',
            issues: completeness.issues,
            message: `题目元素不完整（${completeness.issues.join('、')}），未加入错题本`
          }
        } else {
          try {
            const added = await addWrongQuestions(
              updatedQuestion.student_id,
              [id],
              null,
              new Map([[id, updatedQuestion]]),
              { skipConfidence: true }
            )
            updatedQuestion.wrong_book_sync = {
              status: (added?.length || 0) > 0 ? 'added' : 'already_exists',
              reason: null,
              issues: [],
              message: (added?.length || 0) > 0 ? '' : '这道题已在错题本中'
            }
            // [P1-几何重绘] review_status='wrong' 强入错题本 → 复活几何资产重绘。
            // 覆盖「is_correct 未变但老师明确标错」的场景（如 AI 未判定 null → 老师标错入册）；
            // 若上层 review_edit 分支已触发过（is_correct 变 false），函数对 pending 幂等跳过，
            // 不会重复入队花钱。
            requeueGeometryRedrawOnRejudgeWrong(id).catch(e =>
              console.warn(`[几何重绘·标错强入册] q=${id.slice(0, 8)} 异常: ${e.message.slice(0, 80)}`)
            )
          } catch (e) {
            console.error(`[manual_review] 强入错题本失败 q=${id.slice(0,8)}:`, e.message)
            updatedQuestion.wrong_book_sync = {
              status: 'failed',
              reason: 'write_error',
              issues: [],
              message: '写入错题本失败，请稍后重试'
            }
          }
        }
      }
      // 复核点「正确」= AI 误判，学生本来没错 → 该题本不该入册，从错题本移除。
      // 复核点「排除」= 题目本身有问题（OCR 残段、重复题等）→ 从错题本移除。
      // 复核点「错误但不入册」= 老师明确否决入册 → 若历史上因低置信度已入册，一并撤回。
      // 严禁前端在此路径写 lifecycle_status='mastered'：掌握度只能由重练卷
      // finalizeGeneratedExamResults 状态机推进，绕开会造成"假掌握"（见 2026-09 reviewStore 修复）。
      if (
        (review_status === 'correct' || review_status === 'exclude' || review_status === 'wrong_no_book')
        && updatedQuestion.student_id
      ) {
        try {
          const del = await query(
            `DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = $2`,
            [updatedQuestion.student_id, id]
          )
          if (del.rowCount > 0) {
            console.log(`[manual_review] 从错题本移除 q=${id.slice(0,8)} 原因=${review_status} 影响行=${del.rowCount}`)
          }
        } catch (e) {
          console.error(`[manual_review] 错题本移除失败 q=${id.slice(0,8)}:`, e.message)
        }
      }
      await createJudgement({
        questionId: id,
        studentId: updatedQuestion.student_id || oldQuestion?.student_id || null,
        source: 'manual_review',
        isCorrect: review_status === 'correct' ? true : review_status === 'exclude' ? null : false,
        metadata: {
          oldReviewStatus: oldQuestion?.review_status ?? null,
          reviewDecision: review_status,
          wrongBookAction: review_status === 'wrong_no_book' ? 'skip' : review_status === 'wrong' ? 'add' : null,
          ...(review_metadata && typeof review_metadata === 'object' ? review_metadata : {})
        }
      })
    }

    // ── 补全即补入（2026-09-24）────────────────────────────────────────────
    // 背景：P2 门禁分层把「系统侧缺项」的错题自动记成 review_status='wrong_no_book'
    // 以换取不拦卷（见 src/domain/wrongGateTier.js）。但 wrong_no_book 在
    // src/utils/reviewDecision.js 里是**终态**，落下后就被 needsWrongBookDecision
    // 永久排除，且没有任何「补全元素后自动补入」的机制 ⇒ 老师补完配图/答案，
    // 题永远进不了错题本，还一直被告知「补全后可到错题本重新加入」。
    // 实测近 14 天 8 道被卡（8/8 元素已完整、8/8 仍未入册）。
    //
    // 这里独立成段（不在 hasReviewStatus 块内）：老师补元素走的是
    // QuestionDetailPanel 的普通编辑保存（PUT answer / geometry_image_url /
    // options / question_type），不带 review_status，原路径完全不会碰错题本。
    //
    // 判据与红线全部收在 server/utils/wrongGateRequeue.js：
    //   wrong_no_book + 系统自动放行（skipReason=recognition_error 且 gateAuto=true）
    //   + 仍判错 + 不在册 + 元素完整 ⇒ 补入。
    // **老师手动点的「本次不加入」永远不会被拉回**（手动路径写不出 gateAuto）。
    // 置信度闸不跳过：低置信题返回 skipped，留老师拍板。
    // 只在 review_status='wrong_no_book' 时才查库，正常 PUT 零额外开销。
    if (updatedQuestion.review_status === 'wrong_no_book' && updatedQuestion.student_id) {
      try {
        updatedQuestion.gate_requeue = await requeueGateSkippedQuestion({
          question: updatedQuestion,
          logTag: 'PUT /api/questions 补全即补入'
        })
      } catch (e) {
        // 写库失败必须外露（铁律 #11）：静默失败会让老师以为补入成功
        console.error(`[gate_requeue] 补全即补入失败 q=${id.slice(0, 8)}:`, e.message)
        updatedQuestion.gate_requeue = {
          status: 'failed',
          code: 'write_error',
          reason: 'write_error',
          message: '自动加入错题本失败，请稍后重试',
          issues: []
        }
      }
    }

    // 给复核页带最新入册风险：老师补完配图/改完题干后，前端拿到这个字段
    // 即时把 ⚠ tag 消失，不需要重拉整个 task。
    // is_complete 列此刻还是旧值（fire-and-forget 重算在 res.json 之后），
    // 所以基于"题干/选项/参考答案/配图"现算一次，保证响应反映补图后的真实状态。
    // 只覆盖响应里的副本，落库列由下面的 syncQuestionCompletenessQuietly 统一回写——
    // 历史 bug：这里一旦把 updatedQuestion.is_complete 改成新值，后面的
    // `isComplete !== updatedQuestion.is_complete` 就成了新值比新值，恒等，
    // UPDATE 永远不执行，缓存列再也追不上真值。
    try {
      const { isComplete: liveIsComplete } = checkQuestionCompleteness(updatedQuestion)
      updatedQuestion.is_complete = liveIsComplete
      const { rows: inWqRows } = await query(
        `SELECT EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} WHERE question_id = $1) AS in_wq`,
        [id]
      )
      const CONF_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8
      updatedQuestion.wrong_book_risks = computeWrongBookRisks(
        updatedQuestion,
        inWqRows[0]?.in_wq === true,
        CONF_THRESHOLD
      )
    } catch (e) {
      console.error(`[wrong_book_risks] 计算失败 q=${id.slice(0,8)}:`, e.message)
    }

    res.json({ success: true, question: updatedQuestion })

    // 回写落库列（非阻塞，失败只记日志）：缓存列必须追上动态真值，
    // 否则 GET 错题列表 / 周报 / 讲义按 `is_complete = TRUE` 过滤时会继续漏掉这题。
    syncQuestionCompletenessQuietly([id], `PUT /api/questions q=${id}`)
  } catch (error) {
    console.error('更新题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 上传一张「参考答案图片」→ 视觉模型识别 → 返回 {answer, analysis}，不写库。
// 仅在 PC 批改工作台「编辑参考答案」时使用：老师截图/拍照后一键 OCR 填进 textarea，
// 避免手敲 \frac、\sqrt 等 KaTeX 命令。识别后前端会弹窗预览让老师确认再覆盖。
app.post('/api/questions/:id/recognize-answer', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ ok: false, error: '未收到图片' })
    }
    const { rows } = await query(
      `SELECT id FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '题目不存在' })
    }
    const { fixedBuffer } = await fixFileIfNeeded(
      req.file.buffer,
      req.file.originalname || 'answer.jpg'
    )
    const result = await recognizeAnswerImage(fixedBuffer, 'image/jpeg')
    res.json({ ok: true, answer: result.answer, analysis: result.analysis })
  } catch (error) {
    console.error(`[recognize-answer] q=${req.params.id?.slice(0, 8)}:`, error.message)
    res.status(500).json({ ok: false, error: error.message || '识别失败' })
  }
})

// 上传一张「单题区域裁剪图」→ 视觉模型重识别题干/选项/答案 → 返回结构化元素，**不写库**。
// 用于 PC 批改工作台「重新识别本题」：整页 OCR 漏识别选择题选项（options 为空）时，
// 老师按 block_coordinates 框选该题区域重新识别，补全后即可通过完整性门禁进入错题本。
// 与 recognize-answer 一致：只返回结果，由前端预览确认后再走 PUT /api/questions/:id 落库。
app.post('/api/questions/:id/recognize-question', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ ok: false, error: '未收到图片' })
    }
    const { rows } = await query(
      `SELECT id FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '题目不存在' })
    }
    const { fixedBuffer } = await fixFileIfNeeded(
      req.file.buffer,
      req.file.originalname || 'question.jpg'
    )
    const result = await recognizeQuestionImage(fixedBuffer, 'image/jpeg')
    res.json({
      ok: true,
      content: result.content,
      options: result.options,
      answer: result.answer,
      analysis: result.analysis,
      question_type: result.question_type
    })
  } catch (error) {
    console.error(`[recognize-question] q=${req.params.id?.slice(0, 8)}:`, error.message)
    res.status(500).json({ ok: false, error: error.message || '识别失败' })
  }
})

// ─────────────────────────────────────────────
// 重批改（重新判定 is_correct）
// ─────────────────────────────────────────────
app.post('/api/questions/:id/rejudge', async (req, res) => {
  try {
    const { id } = req.params

    const { rows } = await query(
      `SELECT id, student_id, student_answer, answer, question_type, is_correct,
              content, parent_stem, geometry_image_url, options, answer_source
       FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '题目不存在' })

    const q = rows[0]
    const { student_answer, answer, question_type, student_id, is_correct: oldIsCorrect } = q

    // Re-judge using pure logic (no AI)
    const { isCorrect } = judgeAnswer(student_answer, answer, question_type)

    if (student_id) {
      const settlement = await finalizeRejudgeResult({
        question: q,
        isCorrect,
        oldIsCorrect,
        // 该端点由 PC 复核页「保存」触发（QuestionDetailPanel 教师操作）→ 人工判定，
        // 按口径不受 AI 置信度闸约束。理由同上方 review_edit 分支。
        manualOverride: true
      })
      // [P1-几何重绘] 重判变为「错」→ 复活几何资产并重绘（异步，失败只告警）。
      if (isCorrect === false && q?.id && oldIsCorrect !== false) {
        requeueGeometryRedrawOnRejudgeWrong(q.id).catch(e =>
          console.warn(`[几何重绘·重判错] 异步调用异常: ${e.message.slice(0, 80)}`)
        )
      }
      return res.json({
        success: true,
        is_correct: isCorrect,
        idempotent: settlement.skipped
      })
    }

    // Update is_correct in questions table（status 同步翻，理由同 finalizeRejudgeResult）
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_correct = $1,
           status = CASE
             WHEN status = 'mastered' THEN status
             WHEN $1 IS FALSE THEN 'wrong'
             WHEN status = 'wrong' THEN 'pending'
             ELSE status END,
           updated_at = NOW()
       WHERE id = $2`,
      [isCorrect, id]
    )

    // Write judgement record
    createJudgement({
      questionId: id,
      studentId: student_id,
      source: 'pc_rejudge',
      isCorrect,
      answer,
      studentAnswer: student_answer,
      metadata: { oldIsCorrect, questionType: question_type }
    }).catch(e => console.error('[Shadow] judgements写入失败 (pc_rejudge):', e.message))

    res.json({ success: true, is_correct: isCorrect })
  } catch (error) {
    console.error('重批改失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 教师工作台「AI 重解析」按钮（2026-09-23 临时功能）：
// 老师在批改页遇到参考答案缺失时手动触发，调答案引擎重算这一题的标准答案并写库。
// 默认仅在现有 answer 为空时写入，避免无脑覆盖老师已经填好的答案；force=true 时强制覆盖。
// 写库后用新的 answer 重判对错（judgeAnswer），并触发 finalizeRejudgeResult 走错题本/掌握度。
app.post('/api/questions/:id/recompute-answer', async (req, res) => {
  // 应用层总超时（2026-09-23 实测补充）：Neon 连接被中间设备静默断开时，
  // pg 的 query 会在已建连接上无限等待（connectionTimeoutMillis 只管建连，管不到
  // 已建连接上的查询），实测同一条请求出现过 60s 无任何响应。这里给整条链路
  // 兜一个上限，到点返回明确文案，老师不用对着转圈猜。
  // 2026-09-24 接入带图题视觉求解后上调 180s → 210s：视觉单级 150s + 读题/写库/结算
  // 往返需更多余量（前端 apiService timeout 必须严格大于本值，见 src/services/apiService.js）。
  const DEADLINE_MS = 210_000
  // 单次答案引擎 HTTP 调用的超时上限（仅本接口，批改链路不受影响）：
  // 默认 60s 是为「后台慢慢跑」设计的，对点了按钮在等结果的老师太长。
  // 严格模式下每一级只打一个通道（1 个模型 × Key 池）：
  //   · 主通道 120s —— ⚠️ 2026-09-24 实测修正：原设 45s，依据是「qwen3.8-flash 正常档
  //     9–13s，45s 绰绰有余」，**这个前提是错的**。同一批「带配图 + 答案为空」的题
  //     实测（`D:/tmp/rerun_plan.json` 等，55 条出答案的样本）：
  //       单请求(conc=1) 67.2s / 116.7s 才出答案；批量 p50≈70s、p90≈122s。
  //     只有**简单题**才是 7–13s（同批里两道快速拒绝只用了 6.9s / 7.5s）。
  //     ⇒ 45s 会把多数难题的正确答案**当场掐死**，然后掉到免费慢通道（还常撞 429），
  //       等于主备互换白做。故主通道提到 120s，覆盖实测最长成功耗时。
  //   · 备用通道 55s —— kimi-k3 慢是**固有特性**（拒绝约 25–30s，出答案 22–74s），
  //     给太短等于没备用。
  // 两级串行最坏 120s + 55s = 175s，仍在 210s 总兜底内（留 35s 余量给读题/写库/结算）。
  const ENGINE_TIMEOUT_MS = 120_000
  const SLOW_ENGINE_TIMEOUT_MS = 55_000
  // 带配图题的视觉求解单次超时（2026-09-24 接入读图）：视觉推理比纯文字慢
  // （实测整页 OCR p50≈72s、p90≈145s，单题裁剪图更快）。同步接口对带图题
  // **只跑付费强通道一级**（不串行等备用、不触发多路投票），故单级预算取 150s，
  // 加上取图下载 + 读题/写库/结算 DB 往返仍在 DEADLINE_MS=210s 内（不变量：视觉单级 < 总兜底）。
  const VISION_ENGINE_TIMEOUT_MS = Number(process.env.ANSWER_ENGINE_RECOMPUTE_VISION_TIMEOUT_MS) || 150_000
  // ── 重解析的通道链（2026-09-24 换模型；同日二次调整：主备互换）──────────────
  // ⚠️ 绝不能沿用答案引擎全局主模型 SenseNova:deepseek-flash —— 它可判正确率仅 33%，
  //    且 10 道里 2 次返回非 JSON（`_三模型对比-缺答案求解-20260923.md`）。
  //    **deepseek-flash 禁止用于解析答案**：它只适合批改/OCR/探活这类不写库的场景。
  //
  // ── 顺序 = 付费在前、免费在后（2026-09-24 用户拍板反转）────────────────────
  // 原顺序是「免费 kimi-k3 在前」以省额度，但实测 kimi-k3 作为**同步接口的第一级**
  // 频繁撞 429（tpm/rpm 限流），触发 `RETRY_DELAYS_429=[3000,5000]` 退避 ——
  // 老师点一下按钮要白等 8s 才开始算，之后还要再等它 22–74s，体验不可接受。
  // ⚠️ 关键区分：**429 退避在异步批改链路里无所谓（后台跑），在同步交互里是致命的**。
  //   故本接口把付费快通道提为主链；批改链路（generateMissingAnswers）不受本改动影响。
  //   ① Bailian:qwen3.8-flash —— 付费（Token Plan 套餐内≈0 边际成本）、约 9.5s、
  //      实测 68 次调用零 429、质量与 kimi-k3 并列 71%。
  //   ② SenseNova:kimi-k3 —— 免费、JSON 健康率 100%、对不可判题诚实返回「待人工补充」，
  //      但慢（22–74s）且易 429 ⇒ 退为备份，只在主链没给出答案时才用。
  // 两级各自走 strictPrimary（只打自己那一个通道、不降级），上一级没答案才让位下一级 ——
  // 这与「降级到弱模型」是两回事：链内两个通道都是实测合格的强模型。
  // ⚠️ 超时预算：纯文字两级 120s + 55s = 175s；带图题视觉单级 150s；两者均留在 210s 总兜底内（主通道预算依据见上方 ENGINE_TIMEOUT_MS 注释）。
  // 提成 env 便于换通道/回滚，不必改代码。
  const RECOMPUTE_CHAIN = [
    {
      vendor: process.env.ANSWER_ENGINE_RECOMPUTE_VENDOR || 'Bailian',
      model: process.env.ANSWER_ENGINE_RECOMPUTE_MODEL || 'qwen3.8-flash',
      timeoutMs: Number(process.env.ANSWER_ENGINE_RECOMPUTE_TIMEOUT_MS) || ENGINE_TIMEOUT_MS
    },
    {
      vendor: process.env.ANSWER_ENGINE_RECOMPUTE_FALLBACK_VENDOR || 'SenseNova',
      model: process.env.ANSWER_ENGINE_RECOMPUTE_FALLBACK_MODEL || 'kimi-k3',
      timeoutMs: Number(process.env.ANSWER_ENGINE_RECOMPUTE_FALLBACK_TIMEOUT_MS) || SLOW_ENGINE_TIMEOUT_MS
    }
  ]
  let finished = false
  const deadlineTimer = setTimeout(() => {
    if (finished) return
    finished = true
    console.error(`[AI 重解析] 超时 ${DEADLINE_MS / 1000}s 未完成 q=${req.params?.id}`)
    if (!res.headersSent) {
      res.status(503).json({
        error: 'timeout',
        message: `重算超过 ${DEADLINE_MS / 1000} 秒仍未完成（数据库或答案引擎响应过慢），请稍后重试或人工填写答案`
      })
    }
  }, DEADLINE_MS)
  const done = (fn) => {
    if (finished) return
    finished = true
    clearTimeout(deadlineTimer)
    fn()
  }
  try {
    const { id } = req.params
    const { force = false } = req.body || {}

    // is_correct 一并读出（2026-09-23）：原先在写库后又单独 SELECT 一次拿旧值，
    // 在 Neon 慢连接下等于多付一次 20s 超时风险。读题时一次拿全。
    // geometry_image_url 一并读出（2026-09-24）：带配图题现在会走视觉读图求解（见下方
    // 缺图闸后的 hasFigure 分支），无图题仍走纯文字链。先读出配图才能分流。
    const { rows } = await query(
      `SELECT id, task_id, student_id, student_answer, answer, question_type,
              content, parent_stem, options, answer_source, ai_answer, is_correct,
              geometry_image_url
       FROM ${TABLES.QUESTIONS} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (rows.length === 0) return done(() => res.status(404).json({ error: '题目不存在' }))
    const q = rows[0]
    const oldIsCorrect = q.is_correct

    // 答案非空且未要求 force：拒绝覆盖老师已填的答案，避免误操作。
    if (q.answer && q.answer.trim() && !force) {
      return done(() => res.status(409).json({
        error: 'already-has-answer',
        message: '此题已有参考答案，传 force=true 才能覆盖',
        existing_answer: q.answer
      }))
    }

    // 与 worker.js 批改链路逐字同构：parent_stem + content + options
    // （缺其中任一项都会被引擎判为缺条件 → 答案永久空）。
    const content = [q.parent_stem, q.content].filter(s => s && String(s).trim()).join('\n')
    const options = Array.isArray(q.options) ? q.options : []
    const fullContent = options.length > 0
      ? `${content}\n选项：${formatOptionsForPrompt(options)}`
      : content

    // ── 重解析的准确性口径（2026-09-24 定调）：只走实测合格的强模型，拿不到就失败 ──
    // 参考答案必须准确，**不接受弱模型的答案**：
    //   弱模型单次采样就是掷骰子（实测同题连出 ±5/±10/±10），而多路投票只是从若干次
    //   随机采样里挑多数派 —— 那仍是「抖出来的答案」，不是「算出来的答案」，
    //   写成标准答案比留空更危险（老师会照单全收，还会用它去判学生的对错）。
    //   ⇒ 链内每一级都走 strictPrimary（只打自己那一个通道，**绝不降级**到
    //     FALLBACK_MODELS / 备用供应商）；上一级没答案才让位给下一级 ——
    //     那不是「降级」，链里两个通道都是 9-23 实测合格的强模型（并列 71%）。
    //
    // 顺带解决 150s 超时：原实现复用批改口径，降级后 3 路投票被 429 信号量压成串行
    // （单题 140–230s）必然撞穿兜底。严格模式不降级 ⇒ 不触发投票，等待可控。

    // 硬闸：deepseek-flash **禁止**出现在重解析通道链里（铁律 40）。
    // 配错了当场炸出来，绝不静默放行 —— 静默的后果是老师拿到 33% 正确率的答案，
    // 还拿它当标准答案去判学生。日志同步报错，方便在服务端一眼看到是谁配错的。
    const RECOMPUTE_BLOCKED_MODELS = ['deepseek-flash']
    for (const ch of RECOMPUTE_CHAIN) {
      if (RECOMPUTE_BLOCKED_MODELS.includes(ch.model)) {
        console.error(`[AI 重解析] 通道链配置了禁用模型 ${ch.model}，拒绝执行`)
        return done(() => res.status(500).json({
          error: 'blocked-model-config',
          message: `重解析通道链配置了禁用的模型「${ch.model}」：该模型实测可判正确率仅 33%，禁止用于解析答案`
        }))
      }
    }

    let result = null
    let finalAnswer = ''
    let usedChannel = null
    let rejectReason = null

    // ── 缺配图预判闸（2026-09-24，用户要求：缺图就别解析，别浪费 token 和时间）──────
    // 题干明示引图（如图①②③ / 数轴 / 统计图 / 函数图象）而本题**无配图**时：
    // 无论纯文字还是视觉链路都无图可读，引擎实测 100% 回「待人工补充」——
    // 老师白等 37~150s，还烧掉一次额度。拦在调引擎之前，文案直接给可执行动作
    //（补图 / 手填），比"AI 说不会"更早、更省。（注：有配图时不再走此闸，改走下方视觉求解）
    if (isFigurePreflightSkipEnabled() && hasFigureReference(q) &&
        !(q.geometry_image_url && String(q.geometry_image_url).trim())) {
      console.log(`[AI 重解析] 题目 ${String(q.id).slice(0, 8)} 缺配图，跳过引擎调用（省额度与等待）`)
      return done(() => res.status(400).json({
        error: 'figure-missing',
        message: '这道题的题干要求配图，但系统没有采集到配图，AI 只读文字题干无法作答。请先补上配图（或人工填写答案），补图后可直接重算',
        reason: MISSING_FIGURE_SKIP_REASON,
        has_figure: false
      }))
    }

    // ── 带配图题：走视觉读图求解（2026-09-24）──────────────────────────────
    // 本接口原先是纯文字链路，带图题必然回「待人工补充」。现在把 geometry_image_url
    // 交给多模态强模型看图求解。视觉更慢，且同步接口对带图题**只跑付费强通道一级**
    // （不串行等备用、不触发多路投票），用独立超时预算，避免撞穿 DEADLINE。
    const hasFigure = !!(q.geometry_image_url && String(q.geometry_image_url).trim())
    const solveChain = hasFigure ? RECOMPUTE_CHAIN.slice(0, 1) : RECOMPUTE_CHAIN

    // ── 作图题预判闸（2026-09-25）：答案是一张画在图上的图形、AI 给不出可核对文字参考 ──
    // 带配图且为题干明写「保留作图痕迹/不写作法/尺规作图」的作图题 → 跳过视觉、转人工。
    // 证明/作文/解答类不拦（模型能写出可参考的解答文本，且判分链路对主观参考本就自动转人工）。
    // 复用 ai-declined 错误码：前端已按「终态 / warning」处理，避免误导老师反复重试。
    if (hasFigure && isConstructionQuestion(q)) {
      console.log(`[AI 重解析] 题目 ${String(id).slice(0, 8)} 为作图题，跳过视觉求解，转人工`)
      return done(() => res.status(400).json({
        error: 'ai-declined',
        message: '这道题是作图题，答案是画在图中的图形、没有可核对的文字解答，因此不走视觉重算。请人工判定（重复重算不会有结果）',
        reason: 'construction-manual',
        has_figure: true
      }))
    }

    for (const ch of solveChain) {
      if (finished) break // 已经超时了，别再烧额度（也别让老师等更久）
      usedChannel = `${ch.vendor}:${ch.model}`
      const r = await generateAnswerForQuestion(fullContent, 0, hasFigure ? {
        // 带图：把配图 URL 交给 generateAnswerForQuestion 内部下载并走视觉链（单级、不降级）
        imageUrl: q.geometry_image_url,
        visionVendorChain: [{ vendor: ch.vendor, model: ch.model }],
        timeoutMs: VISION_ENGINE_TIMEOUT_MS,
        maxRetries: 0
      } : {
        vendorOverride: ch.vendor,
        modelOverride: ch.model,
        strictPrimary: true,
        timeoutMs: ch.timeoutMs,
        // 不做整轮递归重跑（HTTP 层的 429 退避仍保留），否则超时预算被重试吃光。
        maxRetries: 0
      })
      result = r
      // 题干为空是终态：换哪个模型都一样没答案，别再往下试第二级。
      if (r.source === 'empty-input') break
      // 与 worker.js 同口径：先尝试从 analysis 抽出标准答案，再用归一化兜底。
      const rawAnswer = extractAnswerFromAnalysis(r.answer || '', r.analysis || '', options)
      const normalized = normalizeGeneratedAnswer({ question_type: q.question_type, options }, rawAnswer || '')
      // ⚠️ 必须过 validateAIAnswer（与批改链路同口径，2026-09-24 实测补上这一闸）：
      //   kimi-k3 / qwen3.8-flash 对「无图不可判」的题会诚实返回「待人工补充」——
      //   那是**AI 自述不会**，不是答案。它非空、能轻易穿过 `!answer.trim()` 的检查，
      //   一旦写库就成了「标准答案」，随后拿它判学生：学生写的 -4 对不上「待人工补充」
      //   ⇒ 好端端做对的题被判成错。
      //   「AI 不会」必须体现为「这次没拿到答案」，绝不能当成答案落库。
      const check = normalized && normalized.trim()
        ? validateAIAnswer(normalized, r.analysis || '')
        : { isValid: false, reason: '答案为空' }
      if (check.isValid) { finalAnswer = normalized; break }
      rejectReason = check.reason
      console.warn(`[AI 重解析] ${usedChannel} 产出无效答案（${check.reason}），让位给下一通道`)
    }

    if (!finalAnswer || !finalAnswer.trim()) {
      // 题干本身就是空的：这不是引擎忙，重算多少次都不会有答案，
      // 明确提示老师去补题干，别让他对着按钮反复点。
      if (result?.source === 'empty-input') {
        return done(() => res.status(400).json({
          error: 'empty-question-content',
          message: '这道题的题干内容为空，AI 无法计算答案，请先补齐题干或人工填写答案'
        }))
      }
      // 「AI 自己说不会」（待人工补充 / 主观题无唯一答案 / '-'）——
      // 这与「引擎忙/不可用」是两回事：它是**终态**，再点多少次、换哪个模型都一样。
      // 必须说清楚，否则老师会一直重试，而重试只会重复烧额度。
      if (rejectReason === 'AI标记需要人工补充') {
        // 带图题现在已走视觉读图求解（2026-09-24）：若仍回「待人工补充」，说明图不清晰、
        // 条件不足或需人工判读 —— 这是终态，再点多少次都一样，说清楚让老师直接手填。
        return done(() => res.status(400).json({
          error: 'ai-declined',
          message: hasFigure
            ? '这道题带配图，已走视觉读图求解仍拿不到可信答案（可能图不清晰、条件不足或需人工判读）。这是终态，重复重算不会有结果，请人工填写'
            : 'AI 判断这道题无法给出确定的标准答案（可能缺少配图或条件不足）。这是终态，重复重算不会有结果，请人工填写答案',
          engine: result?.engine,
          reason: rejectReason,
          has_figure: hasFigure
        }))
      }
      // 严格模式下「没答案」只有一个含义：链上这些实测合格的强模型这次都没给出可信答案。
      // 文案必须说清「不是系统偷懒，是刻意不用不合格的模型顶替」——否则老师会以为系统坏了，
      // 或者以为换个方式就能拿到一个（但不准的）答案。
      return done(() => res.status(503).json({
        error: 'primary-model-unavailable',
        message: `答案引擎（${RECOMPUTE_CHAIN.map(c => `${c.vendor}:${c.model}`).join(' → ')}）这次都没能给出答案。为保证参考答案准确，系统不会用实测不合格的模型顶替，请稍后再试或人工填写`,
        engine: result?.engine,
        source: result?.source,
        reason: rejectReason
      }))
    }

    // ⚠️ 超时后不能再写库（2026-09-24）：兜底 timer 只负责「先给老师回一个 503」，
    // 它中断不了已经在途的引擎调用。若引擎在 150s 之后才返回，下面的 UPDATE 仍会执行，
    // 结果是老师看到「重算失败」、库里却悄悄多了一个 AI 答案 —— 老师随后手填或再点一次
    // 都会和这个没人认领的答案打架。响应已经发出去了，此时直接放弃写库。
    if (finished) {
      console.warn(`[AI 重解析] 引擎在超时后才返回，放弃写库 q=${id}`)
      return
    }

    // 降级留痕（与批改链路 buildAnswerTrustNotes 同口径）：主模型不可用时答案来自降级
    // 通道，必须让老师知道该自己核一遍，而不是当成标准答案照单全收。
    // 标尺用「本次点名的通道」而不是全局主模型：重解析点名的是 kimi-k3 / qwen3.8-flash，
    // 拿全局主模型（SenseNova:deepseek-flash）当标尺会把一次成功的点名误判成降级。
    const degraded = isDegradedAnswerEngine(result?.engine, result?.expectedProvider)
    // 与人工改写参考答案同一口径（见本文件人工改写处的注释）：
    // 新答案写库后，针对**旧**答案写下的风险标注全部失效，必须清掉或换成新的，
    // 否则重解析成功了，页面仍永久挂着「⚠ 参考答案不可信」，老师会以为没生效。
    const riskReason = degraded
      ? `参考答案由降级通道 ${result.engine} 生成（主模型不可用），建议核对`
      : null

    // 写库：force 模式直接覆盖，非 force 模式只填空（双保险）。
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET answer = $1,
           analysis = COALESCE(NULLIF($2, ''), analysis),
           ai_answer = $1,
           answer_exception = FALSE,
           answer_exception_reason = NULL,
           ai_answer_risk_reason = $4,
           updated_at = NOW()
       WHERE id = $3`,
      [finalAnswer, result.analysis || '', id, riskReason]
    )

    // 用新答案重判对错并走结算（错题本/掌握度同步）。
    const { isCorrect } = judgeAnswer(q.student_answer, finalAnswer, q.question_type)
    if (q.student_id) {
      // 结算失败不能吞掉「答案已写库」这个主结果：答案已经算出来并落库了，
      // 错题本/掌握度同步失败只告警，仍把新答案返回给老师（否则老师会以为白跑了）。
      try {
        await finalizeRejudgeResult({
          question: { ...q, answer: finalAnswer, analysis: result.analysis || '' },
          isCorrect,
          oldIsCorrect,
          manualOverride: false
        })
      } catch (settleErr) {
        console.error(`[AI 重解析] 结算失败 q=${id}（答案已写库，不影响本次结果）:`, settleErr.message)
      }
    } else {
      await query(
        `UPDATE ${TABLES.QUESTIONS}
         SET is_correct = $1,
             status = CASE
               WHEN status = 'mastered' THEN status
               WHEN $1 IS FALSE THEN 'wrong'
               WHEN status = 'wrong' THEN 'pending'
               ELSE status END,
             updated_at = NOW()
         WHERE id = $2`,
        [isCorrect, id]
      )
    }
    createJudgement({
      questionId: id,
      studentId: q.student_id,
      source: 'pc_recompute_answer',
      isCorrect,
      answer: finalAnswer,
      studentAnswer: q.student_answer,
      metadata: { engine: result.engine, source: result.source, questionType: q.question_type }
    }).catch(e => console.error('[Shadow] judgements写入失败 (pc_recompute_answer):', e.message))

    done(() => res.json({
      success: true,
      answer: finalAnswer,
      analysis: result.analysis || '',
      engine: result.engine,
      // 主模型不可用时为 true：前端据此把绿色「完成」降级成黄色提示，提醒老师核一遍。
      degraded,
      is_correct: isCorrect
    }))
  } catch (error) {
    // 数据库不可用与「引擎算不出来」是两回事，分开报，老师才知道该等还是该手填。
    // 2026-09-23 实测：Neon(新加坡) 连接不稳时 query 抛
    // "Connection terminated due to connection timeout"，原实现统一 500 + 原始英文
    // 文案，前端只能显示 "Internal Server Error"，无法归因。
    const msg = String(error?.message || error || '')
    const isDbDown = /connection terminated|timeout exceeded when trying to connect|ECONNRESET|ETIMEDOUT|ECONNREFUSED|terminating connection/i.test(msg)
    if (isDbDown) {
      console.error(`[AI 重解析] 数据库不可用 q=${req.params?.id}:`, msg)
      return done(() => res.status(503).json({
        error: 'db-unavailable',
        message: '数据库暂时连不上（不是 AI 的问题），请稍后重试；若持续失败请人工填写答案'
      }))
    }
    console.error('AI 重算失败:', error)
    done(() => res.status(500).json({ error: msg || '服务器内部错误' }))
  }
})

app.post('/api/questions/batch-update-tags', async (req, res) => {
  try {
    const { updates } = req.body
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: '缺少 updates 数组' })
    }

    const results = await batchUpdateQuestionTags(updates)
    res.json({ success: true, updated: results.length })
  } catch (error) {
    console.error('批量更新标签失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/questions/batch', async (req, res) => {
  try {
    const { ids, studentId } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    // 过滤掉无效的 UUID（防止 PostgreSQL 报错 "invalid input syntax for type uuid"）
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const validIds = ids.filter(id => uuidRegex.test(id))
    if (validIds.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',')
    let queryStr = `SELECT q.*,
      qc.content AS _cache_content,
      qc.options AS _cache_options,
      qc.answer AS _cache_answer,
      qc.analysis AS _cache_analysis,
      qc.ai_tags AS _cache_ai_tags,
      a.tikz_status,
      a.processed_at AS asset_processed_at,
      a.last_error AS asset_last_error,
      tk.image_url AS task_image_url,
      tk.images AS task_images`
    // 当提供 studentId 时，LEFT JOIN wrong_questions 带出掌握度信息
    if (studentId) {
      queryStr += `, wq.error_count, wq.lifecycle_status, wq.status AS wq_status`
    }
    // 原卷页图存在 tasks 上（tasks.image_url = 上传首页图；tasks.images = JSONB 数组，
    // 顺序即 1-based 页号），而 questions.image_url 基本为空（全库约 12.5% 有值，
    // 重练卷引用的原题 60/60 全为 NULL）。重练批改页「原卷出处」需要按 page_number 取页图，
    // 故随 q.* 一并带出。纯增字段：tasks.id 是主键，LEFT JOIN 不会放大行数；移动端忽略即可。
    queryStr += ` FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       LEFT JOIN ${TABLES.TASKS} tk ON tk.id = q.task_id
       LEFT JOIN LATERAL (
         SELECT tikz_status, processed_at, last_error
         FROM ${TABLES.QUESTION_ASSETS}
         WHERE question_id = q.id AND asset_type = 'geometry_image'
         ORDER BY created_at DESC LIMIT 1
       ) a ON TRUE`
    if (studentId) {
      queryStr += ` LEFT JOIN ${TABLES.WRONG_QUESTIONS} wq ON wq.question_id = q.id AND wq.student_id = $${validIds.length + 1}`
    }
    queryStr += ` WHERE q.id IN (${placeholders})`

    const params = studentId ? [...validIds, studentId] : validIds
    const { rows } = await query(queryStr, params)

    const merged = rows.map(q => ({
      ...q,
      content: q.content || q._cache_content,
      options: q.options || q._cache_options,
      answer: q.answer || q._cache_answer,
      analysis: q.analysis || q._cache_analysis,
      ai_tags: q.ai_tags || q._cache_ai_tags
    }))
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_ai_tags
    }

    // 关键修复：PostgreSQL 的 `WHERE id IN (...)` 不保证返回顺序与输入顺序一致，
    // 且移动端（不带 studentId，无 JOIN）与 PC 后台（带 studentId，含 LEFT JOIN）
    // 的查询计划不同，会导致同一套卷子的题目在两端以不同顺序展现（重大 BUG）。
    // 这里按输入 question_ids 的顺序重新排序，确保两端完全一致。
    const orderMap = new Map(validIds.map((id, idx) => [id, idx]))
    merged.sort((a, b) => {
      const ia = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER
      const ib = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER
      return ia - ib
    })

    res.json({ success: true, questions: merged })
  } catch (error) {
    console.error('批量获取题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get questions by task ID
app.get('/api/questions/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params
    // LATERAL 取最新一条 geometry_image 资产的 tikz_status（前端需要它来判断
    // 「几何图重建中…」标签，没它就会把"none/失败"的题误判为 pending 一直转圈）
    const { rows } = await query(
      `SELECT q.*,
              qc.content AS _cache_content,
              qc.options AS _cache_options,
              qc.answer AS _cache_answer,
              qc.analysis AS _cache_analysis,
              qc.question_type AS _cache_question_type,
              qc.subject AS _cache_subject,
              qc.ai_tags AS _cache_ai_tags,
              a.tikz_status,
              a.processed_at AS asset_processed_at,
              a.last_error AS asset_last_error,
              EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} wq WHERE wq.question_id = q.id) AS in_wrong_book
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       LEFT JOIN LATERAL (
         SELECT tikz_status, processed_at, last_error
         FROM ${TABLES.QUESTION_ASSETS}
         WHERE question_id = q.id AND asset_type = 'geometry_image'
         ORDER BY created_at DESC LIMIT 1
       ) a ON TRUE
       WHERE q.task_id = $1
         AND (q.review_status IS NULL OR q.review_status != 'exclude')
       -- 小问确定性排序（2026-09-23）：OCR 给同一道大题的所有小问行同一个
       -- block_coordinates.y，且同批插入 created_at 完全相同 ⇒ 旧 ORDER BY 三键全并列，
       -- PostgreSQL 对并列行返回任意顺序（同一份卷换学生看就是 (3)(2)(1)、(2)(1)(3) 乱序）。
       -- 题号/小问号只作并列行的兜底，不影响本来就有不同 y 的题。
       ORDER BY COALESCE(q.page_number, 1),
                COALESCE((q.block_coordinates->>'y')::float, 99999),
                COALESCE(NULLIF(regexp_replace(q.question_number::text, '\\D', '', 'g'), ''), '0')::int,
                COALESCE(NULLIF(regexp_replace(q.sub_no, '\\D', '', 'g'), ''), '0')::int,
                q.created_at, q.id`,
      [taskId]
    )
    const CONF_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.8
    // JS 层做 COALESCE：cache 字段优先于 question 自身字段
    const merged = rows.map(q => {
      const merged_q = {
        ...q,
        content: q.content ?? q._cache_content,
        options: q.options ?? q._cache_options,
        answer: q.answer || q._cache_answer,
        analysis: q.analysis ?? q._cache_analysis,
        question_type: q.question_type ?? q._cache_question_type,
        subject: q.subject ?? q._cache_subject,
        ai_tags: q.ai_tags ?? q._cache_ai_tags
      }
      merged_q.wrong_book_risks = computeWrongBookRisks(merged_q, q.in_wrong_book, CONF_THRESHOLD)
      return merged_q
    })
    // 移除 _cache_ 前缀的临时字段
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_question_type
      delete qq._cache_subject
      delete qq._cache_ai_tags
    }
    res.json({ success: true, questions: merged })
  } catch (error) {
    console.error('获取任务题目失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 题目定位框「实测」接口（2026-09-20）。
 *
 * 背景：主 OCR 的 block_coordinates / text_bbox 是模型照抄 schema 示例平铺整页的产物
 * （实测同一页 8 题 y 等差恒 150、height 全同），直接画在复核页上会把第 1 题的框
 * 画到第 2~5 题上。详见 server/services/questionBoxMeasure.js 顶部注释与
 * server/_probe_bbox_prompt_ab.mjs 的 A/B 实测。
 *
 * 本接口按页做一次「只为量框」的轻量视觉调用，结果缓存进 tasks.result.refinedBoxes[page]，
 * 同一页只量一次（想重量传 force=true）。前端复核页拿到后优先用它画框。
 */
app.post('/api/questions/task/:taskId/refine-boxes', async (req, res) => {
  const { taskId } = req.params
  const pageNumber = Number(req.body?.pageNumber || 1)
  const force = req.body?.force === true
  try {
    const { rows: trows } = await query(
      `SELECT id, images, image_url, result FROM ${TABLES.TASKS} WHERE id = $1`, [taskId])
    if (!trows.length) return res.status(404).json({ error: '任务不存在' })
    const task = trows[0]

    let result = task.result
    if (typeof result === 'string') { try { result = JSON.parse(result) } catch { result = {} } }
    if (!result || typeof result !== 'object') result = {}
    const cachedAll = result.refinedBoxes && typeof result.refinedBoxes === 'object' ? result.refinedBoxes : {}
    if (!force && cachedAll[pageNumber] && Object.keys(cachedAll[pageNumber]).length > 0) {
      return res.json({ success: true, cached: true, boxes: cachedAll[pageNumber] })
    }

    // 页图：优先 task.images 里 page_number 匹配的那张，退化到 image_url
    const imgs = Array.isArray(task.images) && task.images.length
      ? task.images
      : (task.image_url ? [{ image_url: task.image_url, page_number: 1 }] : [])
    const pageImg = imgs.find(i => Number(i.page_number || 1) === pageNumber) || imgs[0]
    if (!pageImg?.image_url) return res.json({ success: true, cached: false, boxes: {}, error: '该页没有图片' })

    const { rows: qs } = await query(
      `SELECT id, question_number, sub_no, page_number, content, block_coordinates
       FROM ${TABLES.QUESTIONS}
       WHERE task_id = $1 AND COALESCE(page_number, 1) = $2
       ORDER BY COALESCE((block_coordinates->>'y')::float, 99999), created_at`,
      [taskId, pageNumber])
    if (!qs.length) return res.json({ success: true, cached: false, boxes: {}, error: '该页没有题目' })

    const resp = await fetch(pageImg.image_url)
    if (!resp.ok) return res.json({ success: true, cached: false, boxes: {}, error: '页图下载失败 ' + resp.status })
    const buf = Buffer.from(await resp.arrayBuffer())

    const { measurePageQuestionBoxes } = await import('./services/questionBoxMeasure.js')
    // [2026-09-22] 魔搭失守后再改造：原「魔搭主力 + HuihuiyunGemini 强兜底」（noBackup+strongBackupOnly）
    // 在魔搭欠费禁用后只会落 gemini-3.7-flash，绕开了矩阵评测的场景三赢家。改为显式链
    // WORKBOOK_OCR_VENDOR_CHAIN：deepseek-flash@SenseNova 主（免费、1.7-2.1s、场景三第一）
    // + qwen3.8-flash@Bailian 兜（qwen 系坐标基准好）。依据：_视觉模型最强阵容-全供应商矩阵评测-20260922.md §7/§9。
    const r = await measurePageQuestionBoxes({ imageBuffer: buf, questions: qs, vendorChain: WORKBOOK_OCR_VENDOR_CHAIN })
    if (r.error || !Object.keys(r.boxes).length) {
      return res.json({ success: true, cached: false, boxes: {}, error: r.error || '未量到框' })
    }

    const nextResult = { ...result, refinedBoxes: { ...cachedAll, [pageNumber]: r.boxes } }
    await query(`UPDATE ${TABLES.TASKS} SET result = $2 WHERE id = $1`, [taskId, JSON.stringify(nextResult)])
    res.json({ success: true, cached: false, boxes: r.boxes, padTop: r.padTop })
  } catch (error) {
    console.error('实测题目定位框失败:', error)
    res.json({ success: false, boxes: {}, error: error.message })
  }
})

// Question search & filter
app.get('/api/questions/search', async (req, res) => {
  try {
    const {
      keyword = '',
      subject = '',
      question_type = '',
      is_correct = '',
      status = '',
      student_id = '',
      limit = '30',
      offset = '0'
    } = req.query

    const conditions = []
    const params = []
    let idx = 1

    // keyword: search across content, answer, analysis (both q and qc)
    if (keyword.trim()) {
      const kw = `%${keyword.trim()}%`
      conditions.push(`(q.content ILIKE $${idx} OR qc.content ILIKE $${idx} OR qc.answer ILIKE $${idx} OR qc.analysis ILIKE $${idx})`)
      params.push(kw)
      idx++
    }

    if (subject) {
      conditions.push(`q.subject = $${idx}`)
      params.push(subject)
      idx++
    }

    if (question_type) {
      conditions.push(`q.question_type = $${idx}`)
      params.push(question_type)
      idx++
    }

    if (is_correct === 'true' || is_correct === 'false') {
      conditions.push(`q.is_correct = $${idx}`)
      params.push(is_correct === 'true')
      idx++
    }

    if (status) {
      conditions.push(`q.status = $${idx}`)
      params.push(status)
      idx++
    }

    if (student_id) {
      conditions.push(`q.student_id = $${idx}`)
      params.push(student_id)
      idx++
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       ${whereClause}`,
      params
    )
    const total = parseInt(countResult.rows[0]?.total || '0', 10)

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200)
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0)

    params.push(limitNum)
    const limitIdx = idx++
    params.push(offsetNum)
    const offsetIdx = idx++

    const { rows } = await query(
      `SELECT q.*,
              qc.content AS _cache_content,
              qc.options AS _cache_options,
              qc.answer AS _cache_answer,
              qc.analysis AS _cache_analysis,
              qc.ai_tags AS _cache_ai_tags,
              a.tikz_status,
              a.processed_at AS asset_processed_at,
              a.last_error AS asset_last_error
       FROM ${TABLES.QUESTIONS} q
       LEFT JOIN ${TABLES.QUESTION_CACHE} qc ON q.cache_id = qc.id
       LEFT JOIN LATERAL (
         SELECT tikz_status, processed_at, last_error
         FROM ${TABLES.QUESTION_ASSETS}
         WHERE question_id = q.id AND asset_type = 'geometry_image'
         ORDER BY created_at DESC LIMIT 1
       ) a ON TRUE
       ${whereClause}
       ORDER BY q.updated_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    )

    const merged = rows.map(q => ({
      ...q,
      content: q.content ?? q._cache_content,
      options: q.options ?? q._cache_options,
      answer: q.answer || q._cache_answer,
      analysis: q.analysis || q._cache_analysis,
      ai_tags: q.ai_tags || q._cache_ai_tags
    }))
    for (const qq of merged) {
      delete qq._cache_content
      delete qq._cache_options
      delete qq._cache_answer
      delete qq._cache_analysis
      delete qq._cache_ai_tags
    }

    res.json({ success: true, questions: merged, total, limit: limitNum, offset: offsetNum })
  } catch (error) {
    console.error('题目搜索失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── question_assets API ──

/**
 * GET /api/questions/:questionId/assets
 * 获取指定题目的所有资源（几何图、图表等）
 */
app.get('/api/questions/:questionId/assets', async (req, res) => {
  try {
    const { questionId } = req.params
    const { type } = req.query
    let assets
    if (type) {
      assets = await getQuestionAssetsByType(questionId, type)
    } else {
      assets = await getQuestionAssets(questionId)
    }
    res.json({ success: true, assets })
  } catch (error) {
    console.error('获取题目资源失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// [P1-4a] 批量查询每道题的最新 judgement
app.post('/api/judgements/latest', async (req, res) => {
  try {
    const { studentId, questionIds } = req.body
    if (!studentId || !questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.json({ success: true, judgements: [] })
    }

    const placeholders = questionIds.map((_, i) => `$${i + 2}`).join(',')
    const { rows } = await query(
      `SELECT DISTINCT ON (question_id) *
       FROM ${TABLES.JUDGEMENTS}
       WHERE student_id = $1 AND question_id IN (${placeholders})
       ORDER BY question_id, created_at DESC`,
      [studentId, ...questionIds]
    )

    res.json({ success: true, judgements: rows })
  } catch (error) {
    console.error('获取最新判定记录失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// Wrong Questions
app.post('/api/wrong-questions', async (req, res) => {
  try {
    const { studentId, questionIds } = req.body
    if (!studentId || !questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: '缺少 studentId 或 questionIds' })
    }

    const existingRows = await query(
      `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
      [studentId, questionIds]
    )
    const existingIds = new Set(existingRows.rows.map(r => r.question_id))
    const newIds = questionIds.filter(id => !existingIds.has(id))

    // 完整性检查 — 用动态口径 checkQuestionCompleteness() 现算（唯一真值源）。
    // 查全部 questionIds 而非只查 newIds：已入册但被隐藏的题也要参与下面的自愈。
    // parent_stem 必须一起查：拆小问后「如图」只留在公共题干，漏查会把缺图题判成完整。
    const { rows: qRows } = await query(
      `SELECT id, content, parent_stem, geometry_image_url, question_type, options, answer FROM ${TABLES.QUESTIONS} WHERE id = ANY($1)`,
      [questionIds]
    )
    const qIdSet = new Set(qRows.map(r => r.id))
    const isCompleteMap = new Map(qRows.map(r => [r.id, checkQuestionCompleteness(r).isComplete]))
    const completeIds = questionIds.filter(id => isCompleteMap.get(id) === true)

    // 写入侧自愈：questions.is_complete 只是动态口径的反范式缓存。questions 有 20+ 处
    // UPDATE 写入点，历史上有 30+ 处根本不回写它，答案/选项/配图入库后被异步
    // 补全时列值长期偏旧（2026-09-11 实测：396 条已入册错题被读口径隐藏 112 条，
    // 近 48h 新入册甚至隐藏 53%）。GET 错题列表按该列过滤，不回写就会出现
    // 「写入成功/已存在，但列表看不到 → 点了没反应」。
    // 范围只限本次提交的题目，不做全表回填（全量走 backfill 脚本）。
    // 必须在 res.json 之前完成——前端 addQuestionToBook 拿到响应后立刻 loadWrongQuestions。
    if (completeIds.length > 0) {
      try {
        await syncQuestionCompleteness(completeIds)
      } catch (e) {
        console.error('[manual-add] is_complete 回写失败（不影响入册结果）:', e.message)
      }
    }

    if (newIds.length === 0) {
      return res.json({ success: true, added: [], skipped: [], alreadyExists: [...existingIds], message: '全部已存在' })
    }

    // 只有确实存在该题、且动态口径判不完整时才算 skipped（保持原有语义）
    const skippedIds = newIds.filter(id => qIdSet.has(id) && isCompleteMap.get(id) !== true)
    const validIds = newIds.filter(id => isCompleteMap.get(id) === true)
    if (skippedIds.length > 0) {
      console.log(`  ⚠️ [manual-add] ${skippedIds.length} 道题不完整，已跳过: ${skippedIds.join(', ')}`)
    }
    if (validIds.length === 0) {
      return res.json({ success: true, added: [], skipped: skippedIds, alreadyExists: [...existingIds], message: '所有题目均不完整' })
    }

    const values = validIds.map((id, i) => `($1, $${i + 2})`).join(',')
    const params = [studentId, ...validIds]

    await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    )

    res.json({ success: true, added: validIds, skipped: skippedIds, alreadyExists: [...existingIds] })
    // [Shadow Mode] 追加写入人工添加错题判定记录
    for (const qId of validIds) {
      createJudgement({
        questionId: qId,
        studentId: studentId,
        source: 'manual_review',
        isCorrect: false,
        metadata: { action: 'manual_add_to_wrong_book' }
      }).catch(e => console.error('[Shadow] judgements写入失败 (人工加错题):', e.message))
    }
  } catch (error) {
    console.error('添加错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/wrong-questions/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0

    // 读前自愈：已入册但被 questions.is_complete 陈旧值挡住的行（下面主查询按
    // `q.is_complete = TRUE` 过滤会直接漏掉它们）。先按动态口径回写这些题，
    // 本次响应就能带上它们——老师不必"点一次加入"再靠写接口自愈才看得到。
    // 只处理该学生被隐藏的行（上限 200），不做全表扫描；失败不影响列表返回。
    try {
      const { rows: hidden } = await query(
        `SELECT wq.question_id
           FROM ${TABLES.WRONG_QUESTIONS} wq
           JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
          WHERE wq.student_id = $1
            AND q.is_complete IS DISTINCT FROM TRUE
          LIMIT 200`,
        [studentId]
      )
      if (hidden.length > 0) {
        const { updated } = await syncQuestionCompleteness(hidden.map(r => r.question_id))
        if (updated > 0) {
          console.log(`[wrong-book] 读前自愈 is_complete: student=${studentId} 更新 ${updated} 题`)
        }
      }
    } catch (e) {
      console.error('[wrong-book] 读前自愈失败（不影响列表）:', e.message)
    }

    const { rows } = await query(
      `SELECT wq.*,
         CASE WHEN q.id IS NULL THEN NULL ELSE
           jsonb_build_object(
             'id', q.id, 'content', q.content, 'subject', q.subject, 'question_type', q.question_type,
             'options', q.options, 'answer', q.answer, 'analysis', q.analysis,
             'ai_tags', CASE WHEN q.ai_tags IS NULL OR q.ai_tags = '' THEN '[]'::jsonb ELSE q.ai_tags::jsonb END,
             'manual_tags', CASE WHEN q.manual_tags IS NULL OR q.manual_tags = '' THEN '[]'::jsonb ELSE q.manual_tags::jsonb END,
             'image_url', q.image_url, 'images', q.images, 'geometry_image_url', q.geometry_image_url,
             -- 难度星级（difficultyStars）：组卷预览与重打预览必须同一口径，缺了会只在重打链路显示
             'difficulty', q.difficulty,
             -- 多小问（题组）：公共题干 + 小问号 + 原题号，供错题卡片补回被拆行丢掉的公共条件
             'parent_stem', q.parent_stem, 'sub_no', q.sub_no, 'question_number', q.question_number
           )
         END AS question
       FROM ${TABLES.WRONG_QUESTIONS} wq
       LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
       WHERE wq.student_id = $1
         AND (q.is_complete = TRUE OR wq.question_id IS NULL)
       ORDER BY wq.added_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )
    // 总条数与生命周期计数：移动端 Tab 计数不再受分页截断影响（兼容旧调用方，忽略即可）
    const { rows: countRows } = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(wq.lifecycle_status, 'new') = 'new')::int AS "new",
         COUNT(*) FILTER (WHERE wq.lifecycle_status IN ('review_1', 'review_2'))::int AS review,
         COUNT(*) FILTER (WHERE COALESCE(wq.lifecycle_status, 'new') = 'mastered')::int AS mastered
       FROM ${TABLES.WRONG_QUESTIONS} wq
       LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
       WHERE wq.student_id = $1
         AND (q.is_complete = TRUE OR wq.question_id IS NULL)`,
      [studentId]
    )
    res.json({
      success: true,
      wrongQuestions: rows,
      total: countRows[0]?.total ?? rows.length,
      counts: countRows[0] || null
    })
  } catch (error) {
    console.error('获取错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// [P0-2a] 按 (student_id, question_id) upsert，修复扫码批改 ID 错配
app.put('/api/wrong-questions/upsert', async (req, res) => {
  try {
    const { studentId, questionId, status, lifecycleStatus, isCorrect } = req.body
    if (!studentId || !questionId) {
      return res.status(400).json({ error: '缺少 studentId 或 questionId' })
    }

    // 完整性检查 — 不完整的题目不能添加/更新错题本
    // parent_stem 必须一起查：拆小问后「如图」只留在公共题干（见 questionCompleteness.js）。
    const { rows: qRows } = await query(
      `SELECT content, parent_stem, geometry_image_url, question_type, options, answer FROM ${TABLES.QUESTIONS} WHERE id = $1`,
      [questionId]
    )
    if (qRows.length > 0) {
      const { isComplete, issues } = checkQuestionCompleteness(qRows[0])
      if (!isComplete) {
        return res.status(422).json({ error: '题目不完整', issues })
      }
    }

    // 查找已有记录（按 student_id + question_id 唯一约束）
    let { rows } = await query(
      `SELECT id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = $2`,
      [studentId, questionId]
    )

    let wqId
    if (rows.length === 0) {
      const { rows: inserted } = await query(
        `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, practice_count, added_at, last_wrong_at, created_at, updated_at)
         VALUES ($1, $2, 'pending', 1, 1, NOW(), NOW(), NOW(), NOW())
         RETURNING id`,
        [studentId, questionId]
      )
      wqId = inserted[0].id
    } else {
      wqId = rows[0].id
      // 现有记录：递增 practice_count
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET practice_count = practice_count + 1, updated_at = NOW() WHERE id = $1`,
        [wqId]
      )
    }

    // 动态构建 UPDATE SET（状态/生命周期）
    const setClauses = ["updated_at = NOW()"]
    const params = []
    if (status) { params.push(status); setClauses.push(`status = $${params.length}`) }
    if (lifecycleStatus) { params.push(lifecycleStatus); setClauses.push(`lifecycle_status = $${params.length}`) }

    if (setClauses.length > 1) {
      params.push(wqId)
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
        params
      )
    }

    // 同步更新 questions 表的 is_correct
    if (isCorrect !== undefined) {
      await query(
        `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
        [isCorrect, questionId]
      )
    }

    // [Shadow Mode] 追加写入人工复审判定记录
    createJudgement({
      questionId,
      studentId,
      source: 'manual_review',
      isCorrect: isCorrect ?? null,
      metadata: { status, lifecycleStatus, wrongQuestionId: wqId }
    }).catch(e => console.error('[Shadow] judgements写入失败 (upsert):', e.message))

    res.json({ success: true, wrongQuestionId: wqId })
  } catch (error) {
    console.error('Upsert错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 批量 upsert 错题状态（Phase 1 优化）
app.put('/api/wrong-questions/batch-upsert', async (req, res) => {
  try {
    const { studentId, results } = req.body

    if (!studentId || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 results 数组' })
    }

    const successIds = []
    const failures = []

    // 批量处理每个题目
    for (const result of results) {
      const { questionId, status, isCorrect } = result

      if (!questionId) {
        failures.push({ questionId, error: '缺少 questionId' })
        continue
      }

      try {
        // 查找已有记录
        let { rows } = await query(
          `SELECT id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = $2`,
          [studentId, questionId]
        )

        let wqId
        if (rows.length === 0) {
          // 创建新记录
          const { rows: inserted } = await query(
            `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, practice_count, added_at, last_wrong_at, created_at, updated_at)
             VALUES ($1, $2, $3, 1, 1, NOW(), NOW(), NOW(), NOW())
             RETURNING id`,
            [studentId, questionId, status || 'pending']
          )
          wqId = inserted[0].id
        } else {
          wqId = rows[0].id
          // 更新现有记录
          await query(
            `UPDATE ${TABLES.WRONG_QUESTIONS}
             SET status = $1, practice_count = practice_count + 1, updated_at = NOW()
             WHERE id = $2`,
            [status || 'pending', wqId]
          )
        }

        // 同步更新 questions 表的 is_correct
        if (isCorrect !== undefined) {
          await query(
            `UPDATE ${TABLES.QUESTIONS} SET is_correct = $1, updated_at = NOW() WHERE id = $2`,
            [isCorrect, questionId]
          )
        }

        // [Shadow Mode] 追加写入人工复审判定记录
        createJudgement({
          questionId,
          studentId,
          source: 'manual_review',
          isCorrect: isCorrect ?? null,
          metadata: { status, wrongQuestionId: wqId, batchUpsert: true }
        }).catch(e => console.error('[Shadow] judgements写入失败 (batch-upsert):', e.message))

        successIds.push(questionId)
      } catch (error) {
        console.error(`批量处理失败 questionId=${questionId}:`, error.message)
        failures.push({ questionId, error: error.message })
      }
    }

    res.json({
      success: true,
      total: results.length,
      successCount: successIds.length,
      failureCount: failures.length,
      successIds,
      failures
    })
  } catch (error) {
    console.error('批量Upsert错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { status, lifecycle_status, student_answer } = req.body

    // 动态构建 SET 子句
    const setClauses = ["updated_at = NOW()"]
    const params = []
    if (status) { params.push(status); setClauses.push(`status = $${params.length}`) }
    if (lifecycle_status) { params.push(lifecycle_status); setClauses.push(`lifecycle_status = $${params.length}`) }
    if (student_answer) { params.push(student_answer); setClauses.push(`student_answer = $${params.length}`) }

    if (setClauses.length > 1) {
      params.push(id)
      await query(
        `UPDATE ${TABLES.WRONG_QUESTIONS} SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
        params
      )
    }

    res.json({ success: true, message: '状态已更新' })

    // [Shadow Mode] 追加写入人工复审判定记录（错题状态变更）
    createJudgement({
      questionId: id,
      source: 'manual_review',
      metadata: { updatedStatus: status, wrongQuestionId: id }
    }).catch(e => console.error('[Shadow] judgements写入失败 (人工复审):', e.message))

  } catch (error) {
    console.error('更新错题状态失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/wrong-questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE id = $1`, [id])
    res.json({ success: true, message: '错题已移出' })
  } catch (error) {
    console.error('删除错题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 错题篮导出重练卷 PDF（router 自带绝对路径，不与上方 inline 路由冲突）
app.use(wrongQuestionsExportRouter)

// Generated Exams
app.post('/api/generated-exams', async (req, res) => {
  try {
    const { studentId, name, questionIds } = req.body
    if (!studentId || !name || !questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: '缺少 studentId、name 或 questionIds' })
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.GENERATED_EXAMS} (student_id, name, question_ids)
       VALUES ($1, $2, $3) RETURNING *`,
      [studentId, name, JSON.stringify(questionIds)]
    )

    res.status(201).json({ success: true, exam: rows[0] })
  } catch (error) {
    console.error('创建错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/generated-exams/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const { rows } = await query(
      `SELECT id, student_id, name, question_ids, status, retry_task_id, created_at, updated_at
       FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    )

    // 答卷汇总（2026-09-14）：移动端列表要区分「等待作答 / 已提交答卷 / 正在批改 / 等待复核」，
    // 但 exam.status 只能区分「是否结算」，判断「有没有交卷」的唯一判据是
    // tasks.generated_exam_id = exam.id 的行是否存在（与 PC 单一口径
    // src/workbench/utils/retryPaperState.js 完全一致，两端不许各判一套）。
    // 这里按卷返回全部答卷行（含 created_at，供前端「取最新一次」排序），纯粹只读扩展。
    const examIds = rows.map(e => e.id)
    const sheetsByExam = new Map()
    if (examIds.length > 0) {
      const sheetPlaceholders = examIds.map((_, i) => `$${i + 1}`).join(',')
      const { rows: sheetRows } = await query(
        `SELECT id, generated_exam_id, status, created_at FROM ${TABLES.TASKS}
         WHERE generated_exam_id IN (${sheetPlaceholders})
         ORDER BY created_at ASC`,
        examIds
      )
      for (const sheet of sheetRows) {
        if (!sheetsByExam.has(sheet.generated_exam_id)) sheetsByExam.set(sheet.generated_exam_id, [])
        sheetsByExam.get(sheet.generated_exam_id).push(sheet)
      }
    }

    // 批量计算所有试卷的统计（1 次查询替代 N 次 per-exam 查询）
    // 2026-09-14：正确/错误/未判定的归类统一走 server/utils/questionResultCaliber.js ——
    // **人工复核结论（review_status）优先于 AI 判定**，与前端 effectiveIsCorrect / 结算
    // gradeGeneratedExam 同源。此前这里只数 is_correct，老师改判的结果不会体现在
    // 家长看到的分数上（全库 7 份已批改卷里 6 份两套口径不一致）。
    const allQIds = [...new Set(rows.flatMap(e => e.question_ids || []))]
    const qCorrectMap = new Map()
    if (allQIds.length > 0) {
      const placeholders = allQIds.map((_, i) => `$${i + 1}`).join(',')
      const { rows: qRows } = await query(
        `SELECT id, is_correct, answer_source, review_status FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
        allQIds
      )
      for (const q of qRows) {
        qCorrectMap.set(q.id, { is_correct: q.is_correct, answer_source: q.answer_source, review_status: q.review_status })
      }
    }

    const examsWithStats = rows.map(exam => {
      const qIds = exam.question_ids || []
      const summary = summarizeQuestionResults(qIds.map(qid => qCorrectMap.get(qid)))
      // not_answered_count 沿用旧字段名（前端 apiService 已透传），语义 = 「未判定」：
      // AI 给不出结论（is_correct IS NULL）或老师标了排除。未作答按既定口径并入 wrong。
      const { correct: correct_count, wrong: wrong_count, unjudged: not_answered_count, excluded: excluded_count } = summary
      return {
        ...exam,
        correct_count, wrong_count, not_answered_count, excluded_count, total_count: qIds.length,
        // 该卷的答卷行（学生每交一次一条，按 created_at 升序）。空数组 = 学生还没交卷。
        answer_sheets: sheetsByExam.get(exam.id) || []
      }
    })

    res.json({ success: true, generatedExams: examsWithStats })
  } catch (error) {
    console.error('获取错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 按 ID 查询单个组卷（扫码批改：二维码只含组卷ID，扫码后拉取详情）
app.get('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    const { rows } = await query(
      `SELECT e.*, s.name AS student_name
       FROM ${TABLES.GENERATED_EXAMS} e
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = e.student_id
       WHERE e.id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: '试卷不存在' })
    }
    res.json({ success: true, exam: rows[0] })
  } catch (error) {
    console.error('获取组卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`, [id])
    res.json({ success: true, message: '错题卷已删除' })
  } catch (error) {
    console.error('删除错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 组卷「批改详情」只读数据源（移动端 ExamDetailModal → 标注视图专用）。
// 场景：晚托班老师在手机上打开一份已出结果的重练卷，要看答卷图上每题的勾/叉
// 标注，对照学生手里的纸质卷讲题。PC 批改页（PaperViewerPanel paper 模式）已有
// 同款能力，本端点把它的数据链路原样开放给移动端 —— **纯只读**，不写任何字段。
//
// 数据口径与 PC 完全同源（不许各判一套）：
//   · 页图：tasks.generated_exam_id = exam.id 的全部答卷行按 created_at 升序，
//     行内 images JSONB 展开成页（多图行 page_number 1..n；与 reviewStore
//     currentPaperPages 的展开规则一致）。
//   · 定位框：只认 task.result.retryAlign 的【答卷图坐标系】框（worker 逐页 OCR
//     写死 pageNumber=行内 1-based）；取框优先级 = text_bbox ∪ image_bbox 并集 →
//     回退 block_coordinates → 无框不画。绝不回退题目行自身坐标（那是原作业图）。
//     旧记录缺 pageNumber 视为该行第 1 页（旧管线只 OCR 首页，与 PC 同款兼容）。
//   · 判定：questions.is_correct/review_status，人工复核优先（classifyQuestionResult，
//     与结算/移动端分数同一口径）。retryAlign 里自带的 isCorrect 只是当时快照，
//     不采用 —— 老师复核改判后必须以 questions 表为准。
//   · 多次交卷 / 分批上传：同一 questionId 出现在多行时，后写者覆盖（最新提交为准）。
app.get('/api/generated-exams/:id/grading-detail', async (req, res) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    const { rows: examRows } = await query(
      `SELECT id, question_ids, status FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
      [id]
    )
    if (examRows.length === 0) {
      return res.status(404).json({ error: '试卷不存在' })
    }
    const exam = examRows[0]
    const questionIds = Array.isArray(exam.question_ids) ? exam.question_ids : []

    // 答卷行：与 PC _pageTasks 同款归拢（判「有没有交卷」的唯一依据）
    const { rows: sheetRows } = await query(
      `SELECT id, status, images, result, created_at FROM ${TABLES.TASKS}
       WHERE generated_exam_id = $1
       ORDER BY created_at ASC`,
      [id]
    )

    // ── 页图展开 + 对位明细：几何/对位口径在 server/utils/gradingDetailView.js
    //      （唯一口径，test/gradingDetailView.test.mjs 锁死）──
    const verdictByQuestion = new Map()
    if (questionIds.length > 0) {
      const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(',')
      const { rows: qRows } = await query(
        `SELECT id, is_correct, review_status, answer_source FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
        questionIds
      )
      for (const qr of qRows) {
        verdictByQuestion.set(qr.id, classifyQuestionResult(qr))
      }
    }
    const { pages, marks } = buildGradingDetailView(
      questionIds,
      sheetRows,
      qid => verdictByQuestion.get(qid) || 'unjudged'
    )

    res.json({
      success: true,
      detail: {
        examId: id,
        status: exam.status,
        totalPages: pages.length,
        hasAnswerSheet: sheetRows.length > 0,
        pages,
        marks,
      },
    })
  } catch (error) {
    console.error('获取组卷批改详情失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新组卷题单/名称 —— 仅供「周报再测卷幂等复用」使用。
// 守卫：已批改的卷判题结果挂在 question_ids 上，禁止改；已有答卷任务（tasks.generated_exam_id）
// 引用的卷正在批改链路中，改了会导致 worker 判错题单，禁止改。
app.put('/api/generated-exams/:id', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    const { rows } = await query(`SELECT id, status FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`, [id])
    if (rows.length === 0) return res.status(404).json({ error: '试卷不存在' })
    if (rows[0].status === 'graded') {
      return res.status(409).json({ error: '该卷已批改，不能修改题单' })
    }
    const { rows: linked } = await query(
      `SELECT id FROM ${TABLES.TASKS} WHERE generated_exam_id = $1 LIMIT 1`,
      [id]
    )
    if (linked.length > 0) {
      return res.status(409).json({ error: '该卷已有答卷任务引用，不能修改题单' })
    }
    const sets = []
    const params = []
    if (Array.isArray(req.body.questionIds)) {
      params.push(JSON.stringify(req.body.questionIds))
      sets.push(`question_ids = $${params.length}`)
    }
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      params.push(req.body.name.trim())
      sets.push(`name = $${params.length}`)
    }
    if (sets.length === 0) return res.status(400).json({ error: '没有需要更新的字段' })
    params.push(id)
    const { rows: updated } = await query(
      `UPDATE ${TABLES.GENERATED_EXAMS} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    )
    res.json({ success: true, exam: updated[0] })
  } catch (error) {
    console.error('更新组卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 标记错题卷为已批改
app.put('/api/generated-exams/:id/graded', async (req, res) => {
  try {
    const { id } = req.params
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }
    await query(
      `UPDATE ${TABLES.GENERATED_EXAMS} SET status = 'graded', updated_at = NOW() WHERE id = $1`,
      [id]
    )
    res.json({ success: true, message: '错题卷已标记为已批改' })
  } catch (error) {
    console.error('标记错题卷失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ===== 错题重练任务入口（二维码 = /retry-task/:id） =====
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 错题重练任务详情（入口页拉取）：学生/名称/题数/状态 + 关联批改任务状态
app.get('/api/retry-tasks/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) return res.status(400).json({ error: '无效的任务ID' })
    const { rows } = await query(
      `SELECT e.*, s.name AS student_name
       FROM ${TABLES.GENERATED_EXAMS} e
       LEFT JOIN ${TABLES.STUDENTS} s ON s.id = e.student_id
       WHERE e.id = $1`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '任务不存在' })
    const exam = rows[0]
    let gradingTask = null
    if (exam.retry_task_id) {
      const { rows: tRows } = await query(
        `SELECT id, status, result, image_url, original_name, created_at FROM ${TABLES.TASKS} WHERE id = $1`,
        [exam.retry_task_id]
      )
      if (tRows.length) gradingTask = tRows[0]
    }
    res.json({ success: true, task: { ...exam, gradingTask } })
  } catch (error) {
    console.error('获取错题重练任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 关联 AI 批改任务 + 置 grading（上传答卷照片后调用）
app.patch('/api/retry-tasks/:id/link', async (req, res) => {
  try {
    const { id } = req.params
    const { retryTaskId } = req.body || {}
    if (!UUID_RE.test(id)) return res.status(400).json({ error: '无效的任务ID' })
    if (!retryTaskId || !UUID_RE.test(retryTaskId)) {
      return res.status(400).json({ error: '无效的批改任务ID' })
    }
    await query(
      `UPDATE ${TABLES.GENERATED_EXAMS}
       SET retry_task_id = $1, status = 'grading', updated_at = NOW()
       WHERE id = $2`,
      [retryTaskId, id]
    )
    res.json({ success: true, message: '已关联批改任务' })
  } catch (error) {
    console.error('关联错题重练任务失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 批改组卷试卷（含掌握度进阶逻辑）
app.post('/api/generated-exams/:id/grade', async (req, res) => {
  try {
    const { id } = req.params
    const { studentId, results } = req.body

    if (!studentId || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少 studentId 或 results 数组' })
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: '无效的试卷ID' })
    }

    // 掌握度进阶：new → review_1 → mastered（累计答对 2 次；答错不重置；mastered 后答错退回 review_1）
    const gradingResult = await finalizeGeneratedExamResults({
      generatedExamId: id,
      studentId,
      results
    })
    return res.json({
      success: true,
      stats: {
        total: gradingResult.total,
        masteredCount: gradingResult.masteredCount,
        upgradedCount: gradingResult.upgradedCount,
        resetCount: gradingResult.resetCount
      },
      lifecycleChanges: gradingResult.lifecycleChanges,
      idempotent: gradingResult.skipped > 0 && gradingResult.settled === 0
    })

  } catch (error) {
    console.error('组卷批改失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 知识点标签回填：为所有已有题目重新生成 AI 知识点标签
let backfillRunning = false
let backfillProgress = { total: 0, updated: 0, skipped: 0, failed: 0, done: false, detail: '', remaining: null }

// 筛选"缺知识点标签 或 缺难度 或 仅有本地占位"的题目 —— select 与 count 共用，避免两处漂移。
// tags_source='local'：上传热路径用本地规则分类打的占位（tags 可能是「未分类」、difficulty 恒为 3），
// 需由定时 LLM 回填修正；修正成功后 tags_source 被写为 'ai'，自然不再被重复捞取。
//
// ⚠️ 2026-09-18：**难度回填不再要求 is_complete=TRUE**。
//   原写法 `q.is_complete = TRUE AND (...)` 会让所有 is_complete=false 的题永远拿不到难度 ——
//   实测全库 287 条 `difficulty IS NULL` 100% 是 is_complete=false（残题：选择题选项是图片/
//   未抓到 → options=[] → 完整性闸判缺选项），导致周末课件出现「未判定」档。
//   难度只依赖题干、与题目是否完整无关；标签回填仍只在完整题上做（避免用残题正文打错标签，
//   写入侧由下方 `q.is_complete === true` 把关）。
const BACKFILL_WHERE = `(
           (q.is_complete = TRUE AND (
             q.ai_tags IS NULL
             OR q.ai_tags = ''
             OR q.ai_tags = '[]'
             OR q.ai_tags::text = '["未分类"]'
             OR q.tags_source = 'local'
           ))
           OR q.difficulty IS NULL
         )`

/** 把题目 options 归一化成字符串数组：兼容数组 / JSON字符串 / 对象 / null */
function normalizeOptionsToArray(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') return Object.values(parsed)
      return [String(parsed)]
    } catch {
      return [s]
    }
  }
  if (typeof raw === 'object') return Object.values(raw)
  return [String(raw)]
}

/** 统计当前仍待回填的题目总数（全局，跨批次） */
async function countBackfillRemaining() {  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM ${TABLES.QUESTIONS} q WHERE ${BACKFILL_WHERE}`
  )
  return rows[0]?.n ?? 0
}

/**
 * 回填核心逻辑（小批量）：每次只捞 limit 道「缺标签 或 缺难度」的题目，逐题重生成并写回。
 * free 实例内存/CPU 有限，单批控制在 ~20 题 / 20 余秒内结束，避免长任务被 OOM/spin-down 腰斩。
 * chain=true 时，一批跑完若仍有剩余，自动延时触发下一批，直到全部补齐。
 * @param {{limit?:number, trigger?:string, chain?:boolean}} opts
 */
async function runBackfillTags({ limit = 20, trigger = 'manual', chain = false } = {}) {
  if (backfillRunning) {
    return { started: false, reason: 'running', progress: backfillProgress }
  }
  backfillRunning = true
  backfillProgress = { total: 0, updated: 0, skipped: 0, failed: 0, done: false, detail: '', remaining: null }

  try {
    // 重置模型轮换索引，从第一个模型开始
    backfillProgress.detail = '重置模型索引...'
    resetModelIndex()

    // 1. 查找本批需要回填的题目：知识点标签缺失 或 难度未判定
    backfillProgress.detail = '查询数据库中...'
    const { rows: questions } = await query(
      `SELECT q.id, q.content, q.options, q.subject, q.ai_tags, q.difficulty, q.question_type, q.is_complete
       FROM ${TABLES.QUESTIONS} q
       WHERE ${BACKFILL_WHERE}
       ORDER BY q.created_at DESC
       LIMIT $1`,
      [limit]
    )

    backfillProgress.total = questions.length
    if (questions.length === 0) {
      console.log(`[BackfillTags] (${trigger}) 没有待回填的题目`)
      backfillProgress.done = true
      backfillProgress.remaining = 0
      return { started: true, total: 0, remaining: 0 }
    }

    console.log(`[BackfillTags] (${trigger}) 本批 ${questions.length} 道（小批量）`)

    // 2. 逐题处理（串行，避免并发触发模型限流）
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const content = q.content || ''
      // options 可能是数组、JSON 字符串、对象或 null（不同来源/历史数据不一致）——统一成数组
      const options = normalizeOptionsToArray(q.options).join('；')
      const fullContent = options ? `${content}\n选项：${options}` : content
      const subject = q.subject || null

      const shortId = String(q.id).substring(0, 8)
      backfillProgress.detail = `[${i + 1}/${questions.length}] ${shortId}`

      try {
        // 单次生成标签+难度（LLM），内置重试和主备 API 切换。
        // 回填的目的就是用 LLM 修正上传时的本地占位（tags 可能是「未分类」、difficulty 恒为 3）。
        const tagResult = await generateTagWithLLM(fullContent, subject)

        const hasTags = tagResult && tagResult.tags && tagResult.tags.length > 0 && tagResult.tags[0] !== '未分类'
        const hasDifficulty = tagResult && tagResult.difficulty !== null && tagResult.difficulty !== undefined
        // 标签只在完整题上写：残题（is_complete=false）正文可能残缺，打标签会误导知识点关联；
        // 难度不看完整性（只依赖题干），残题也要补，否则课件永远显示「未判定」。
        const writeTags = hasTags && q.is_complete === true

        if (writeTags || hasDifficulty) {
          // 动态拼装 SET 子句：只更新本次成功识别出的字段，避免用 NULL 覆盖已有值
          const sets = []
          const params = []
          let p = 1
          if (writeTags) {
            const uniqueTags = [...new Set(tagResult.tags.map(t => t.trim()).filter(Boolean))]
            sets.push(`ai_tags = $${p++}::jsonb`, `tags_source = 'ai'`)
            params.push(JSON.stringify(uniqueTags))
          }
          if (hasDifficulty) {
            sets.push(`difficulty = $${p++}`)
            params.push(tagResult.difficulty)
          }
          sets.push('updated_at = NOW()')
          params.push(q.id)

          try {
            await query(
              `UPDATE ${TABLES.QUESTIONS} SET ${sets.join(', ')} WHERE id = $${p}`,
              params
            )
            backfillProgress.updated++
            const tagStr = writeTags ? tagResult.tags.join(', ') : '(保留原标签)'
            console.log(`  [BackfillTags] ✅ [${i + 1}/${questions.length}] ${shortId}: ${tagStr} | 难度=${hasDifficulty ? tagResult.difficulty : '-'}`)
          } catch (err) {
            backfillProgress.failed++
            console.error(`  [BackfillTags] ❌ [${i + 1}/${questions.length}] ${shortId}: DB写入失败 ${err.message}`)
          }
        } else {
          // AI 未返回有效标签且未判定难度（主备均失败或内容残缺）→ 保持字段为 NULL，
          // 不写「未分类」，让后续回填任务可持续重试。计入 skipped 以便观察。
          backfillProgress.skipped++
          console.log(`  [BackfillTags] ⏭️ [${i + 1}/${questions.length}] ${shortId}: 未识别/失败 (${subject || '无学科'})`)
        }
      } catch (err) {
        backfillProgress.failed++
        console.error(`  [BackfillTags] ❌ [${i + 1}/${questions.length}] ${shortId}: ${err.message}`)
      }

      // 每题间隔 1.5 秒，避免触发 ModelScope 限流
      if (i < questions.length - 1) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    console.log(`[BackfillTags] (${trigger}) 本批完成！更新:${backfillProgress.updated} 跳过:${backfillProgress.skipped} 失败:${backfillProgress.failed}`)
    return { started: true, total: questions.length }
  } catch (err) {
    backfillProgress.detail = `错误: ${err.message}`
    console.error(`[BackfillTags] (${trigger}) 执行失败:`, err)
    return { started: true, error: err.message }
  } finally {
    // 统计全局剩余，供进度接口展示；失败时置 null 不阻断
    try {
      backfillProgress.remaining = await countBackfillRemaining()
    } catch { backfillProgress.remaining = null }
    backfillProgress.done = true
    backfillProgress.detail = ''
    backfillRunning = false

    // 自链式：本批跑完仍有剩余则延时触发下一批，直至补齐。
    // 用短批 + 15s 间隙，规避 free 实例内存峰值与 spin-down；
    // 仅当本批确有产出（updated>0）才继续，避免主备全挂时空转刷屏。
    if (chain && backfillProgress.remaining > 0 && backfillProgress.updated > 0) {
      const nextRemaining = backfillProgress.remaining
      setTimeout(() => {
        console.log(`[BackfillTags] (chain) 仍剩 ${nextRemaining} 道，触发下一批...`)
        runBackfillTags({ limit, trigger: 'chain', chain: true })
          .catch(e => console.error('[BackfillTags] 链式回填异常:', e.message))
      }, 15000)
    }
  }
}

app.post('/api/admin/backfill-tags', async (req, res) => {
  if (backfillRunning) {
    return res.status(409).json({ error: '回填任务正在进行中', progress: backfillProgress })
  }

  // sync=1：在请求内同步跑完一小批再返回。free 实例空闲时事件循环几乎不给 CPU，
  // 后台 setTimeout 接力会被冻结；把一批放进「有活跃请求」的处理器里执行，
  // 才能保证整批拿到 CPU。由外部驱动（curl 循环 / cron）反复调用直到 remaining=0。
  const sync = req.query.sync === '1' || req.query.sync === 'true'
  if (sync) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20)
    const result = await runBackfillTags({ limit, trigger: 'sync', chain: false })
    return res.json({ success: true, sync: true, ...result, progress: backfillProgress })
  }

  // 异步模式（兼容旧调用）：不阻塞响应，chain=true 小批量自动接力。
  res.json({ success: true, message: '标签回填任务已启动（小批量自动接力）' })
  runBackfillTags({ trigger: 'manual', chain: true }).catch(err => {
    console.error('[BackfillTags] 手动回填异常:', err)
  })
})

app.get('/api/admin/backfill-tags/progress', (req, res) => {
  res.json({ success: true, ...backfillProgress })
})

// ── 误判类型归因统计（2026-09-01 上线问题 6）──
// 按 metadata.misjudgeType 聚合 judgements 表的 PC 改判记录（source='pc_edit' 且 is_correct 由 false→true），
// 让产品/算法能看出"AI 误判主要发生在哪类题型"以指导后续 prompt/规则调优。
app.get('/api/admin/judgements/misjudge-stats', async (req, res) => {
  try {
    const since = req.query.since || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const { rows: byType } = await query(
      `SELECT
         COALESCE(metadata->>'misjudgeType', 'unset') AS misjudge_type,
         COUNT(*)::int AS count
       FROM judgements
       WHERE source = 'pc_edit'
         AND is_correct = true
         AND (metadata->>'oldIsCorrect')::boolean = false
         AND created_at >= $1::date
       GROUP BY misjudge_type
       ORDER BY count DESC`,
      [since]
    )
    const { rows: total } = await query(
      `SELECT COUNT(*)::int AS total
       FROM judgements
       WHERE source = 'pc_edit'
         AND is_correct = true
         AND (metadata->>'oldIsCorrect')::boolean = false
         AND created_at >= $1::date`,
      [since]
    )
    const { rows: recent } = await query(
      `SELECT id, question_id, metadata, created_at
       FROM judgements
       WHERE source = 'pc_edit'
         AND is_correct = true
         AND (metadata->>'oldIsCorrect')::boolean = false
         AND metadata->>'misjudgeType' IS NOT NULL
         AND created_at >= $1::date
       ORDER BY created_at DESC
       LIMIT 20`,
      [since]
    )
    res.json({
      success: true,
      since,
      totalOverrides: total[0]?.total || 0,
      byType: byType.map(r => ({ type: r.misjudge_type, count: r.count })),
      recent: recent.map(r => ({
        id: r.id,
        questionId: r.question_id,
        misjudgeType: r.metadata?.misjudgeType,
        createdAt: r.created_at
      }))
    })
  } catch (error) {
    console.error('获取误判统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── 教学诊断回填（空题标记 + 做错错因分析，异步小批量自动接力）──
let diagnosisRunning = false
let diagnosisProgress = { total: 0, blank: 0, updated: 0, skipped: 0, done: false, detail: '' }

async function runDiagnosisBackfill({ limit = 10, trigger = 'manual', chain = false } = {}) {
  if (diagnosisRunning) return { started: false, reason: 'running', progress: diagnosisProgress }
  diagnosisRunning = true
  diagnosisProgress = { total: 0, blank: 0, updated: 0, skipped: 0, done: false, detail: '' }
  try {
    diagnosisProgress.detail = '扫描待分析错题...'
    const result = await runErrorDiagnosis({ limit, trigger, chain: false })
    if (result.total > 0) {
      diagnosisProgress.total = result.total
      diagnosisProgress.blank = result.blank || 0
      diagnosisProgress.updated = result.updated || 0
      diagnosisProgress.skipped = result.skipped || 0
      // 自链式小批量接力
      if (chain && result.updated > 0) {
        setTimeout(() => {
          runDiagnosisBackfill({ limit, trigger: 'chain', chain: true })
            .catch(e => console.error('[DiagnosisBackfill] 链式回填异常:', e.message))
        }, 10000)
      }
    }
    return result
  } catch (err) {
    diagnosisProgress.detail = `错误: ${err.message}`
    console.error('[DiagnosisBackfill] 执行失败:', err)
    return { started: true, error: err.message }
  } finally {
    diagnosisProgress.done = true
    diagnosisProgress.detail = ''
    diagnosisRunning = false
  }
}

app.post('/api/admin/backfill-diagnosis', async (req, res) => {
  if (diagnosisRunning) {
    return res.status(409).json({ error: '诊断回填正在进行中', progress: diagnosisProgress })
  }
  const sync = req.query.sync === '1' || req.query.sync === 'true'
  if (sync) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20)
    const result = await runDiagnosisBackfill({ limit, trigger: 'sync' })
    return res.json({ success: true, sync: true, ...result, progress: diagnosisProgress })
  }
  res.json({ success: true, message: '诊断回填任务已启动（小批量自动接力）' })
  runDiagnosisBackfill({ trigger: 'manual', chain: true }).catch(err => {
    console.error('[DiagnosisBackfill] 手动回填异常:', err.message)
  })
})

app.get('/api/admin/backfill-diagnosis/progress', (req, res) => {
  res.json({ success: true, ...diagnosisProgress })
})

// ── 后台数据清理：删除学生试卷、错题本、试卷重练，保留练习册预埋答案 ──
app.post('/api/admin/data-cleanup', async (req, res) => {
  try {
    const { scopes = {}, dryRun = false } = req.body || {}
    const result = await cleanupStudentData({
      tasks: scopes.tasks !== false,
      wrongQuestions: scopes.wrongQuestions !== false,
      generatedExams: scopes.generatedExams !== false,
      dryRun: dryRun === true,
    })
    res.json(result)
  } catch (error) {
    console.error('[Admin] 数据清理失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取已发布的试卷答案库列表（供移动端选择器）
app.get('/api/resources/exam-papers', async (req, res) => {
  try {
    const { subject } = req.query
    // v4：必须 status='published' 才能被其他任务复用判题（仅'已发布'才被其他学生答案库管线用）。
    // 草稿资源（status='draft'，老师还没完成复核）不应该被选择器列出。
    const conditions = [
      "resource_type = 'exam'",
      "status = 'published'",
      "answer_status IN ('teacher_verified', 'official_verified')"
    ]
    const params = []
    let idx = 1
    if (subject) {
      conditions.push(`subject = $${idx++}`)
      params.push(subject)
    }
    const { rows } = await query(
      `SELECT r.*,
         (SELECT COUNT(*)::int FROM ${TABLES.RESOURCE_ANSWERS} ra WHERE ra.resource_id = r.id) AS answer_count
       FROM ${TABLES.RESOURCES} r
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC`,
      params
    )
    res.json({ success: true, resources: rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 周学习诊断报告
app.use('/api/weekly-report', weeklyReportRouter)
app.use('/api/worksheets', worksheetsRouter)
app.use('/api/resources', resourcesRouter)
app.use('/api/teaching', teachingRouter)
app.use('/api/variants', variantsRouter)
app.use('/api/handout', handoutRouter)
app.use('/api/handout', handoutLectureRouter)
app.use('/api/teaching-question-types', teachingQuestionTypesRouter)
app.use('/api/weakness', weaknessRouter)
app.use('/api/exam-pdf', examPdfRouter)
app.use('/api/dashboard', dashboardRouter)
// weekendHandout 路由内部已写完整路径（/api/weekend-ppt/*），直接挂载避免双重前缀
app.use(weekendHandoutRouter)

// 错误处理中间件（必须在路由之后，才能捕获路由中的未处理异常）
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      // 各上传端点限制不同（图片 20MB / 练习册 PDF 50MB），不写死具体数值
      return res.status(400).json({ error: '文件大小超过服务器限制，请压缩后重试' })
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: '文件数量超过限制（最多20个）' })
    }
  }
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

const __filename = fileURLToPath(import.meta.url)

if (process.argv[1] === __filename || process.argv[1]?.endsWith('server/index.js')) {
  app.listen(PORT, async () => {
    console.log(`敏学后端服务已启动: http://localhost:${PORT}`)

    // 启动队列和 Worker
    try {
      const queue = await getTaskQueue()
      const worker = taskWorker
      console.log(`任务队列: ${queue ? '已连接' : '未连接'}`)
      console.log(`Worker: ${worker ? '已启动' : '未启动'}`)
      if (queue) {
        const stats = await getQueueStats()
        console.log(`队列统计: waiting=${stats.waiting}, active=${stats.active}, failed=${stats.failed}`)
      }
    } catch (err) {
      console.error('队列初始化失败:', err.message)
    }

    // 启动 Pending 任务恢复扫描器
    try {
      pendingTaskRecovery.start()
    } catch (err) {
      console.error('Pending 任务恢复扫描器启动失败:', err.message)
    }

    // 运行数据库迁移
    // 经台账（schema_migrations）判定，已应用的迁移不再重复执行。
    // 背景：本回调每次冷启动都会跑一遍，48 个迁移每个 2 次 DB 往返，
    // 而 Render 实例在 Oregon、Neon 在新加坡，单次往返约 200ms——
    // 90+ 次串行跨洋往返就是「过一段时间打开 App 干等半分钟」的主因。
    // 台账把稳态成本压到 1 次查询；迁移文件改动后源码指纹变化仍会重跑，不吞迁移。
    try {
      await runMigrations([
        ['migrateGeometryImageUrl', migrateGeometryImageUrl],
        ['migrateLifecycleStatus', migrateLifecycleStatus],
        ['migrateReviewStatus', migrateReviewStatus],
        ['migrateQuestionCacheId', migrateQuestionCacheId],
        ['migrateJudgements', migrateJudgements],
        ['migrateIsComplete', migrateIsComplete],
        ['migratePracticeCount', migratePracticeCount],
        ['migrateDifficulty', migrateDifficulty],
        ['migratePageUnderstanding', migratePageUnderstanding],
        ['migrateGeometryCleanup', migrateGeometryCleanup],
        ['migrateGeometryTikzDisplay', migrateGeometryTikzDisplay],
        ['migrateGeometryCropType', migrateGeometryCropType],
        ['migrateCleanGeometrySvg', migrateCleanGeometrySvg],
        ['migrateSourceType', migrateSourceType],
        ['migrateRetryTaskFields', migrateRetryTaskFields],
        ['migrateGeometryReconstructionAsync', migrateGeometryReconstructionAsync],
        ['migrateTaskSystemFields', migrateTaskSystemFields],
        ['migrateWorksheets', migrateWorksheets],
        ['migrateTaskImages', migrateTaskImages],
        ['migrateWorksheetParseStatus', migrateWorksheetParseStatus],
        ['migrateDeduplicateWorksheetAnswers', migrateDeduplicateWorksheetAnswers],
        ['migrateWorksheetAnswerContent', migrateWorksheetAnswerContent],
        ['migrateResources', migrateResources],
        ['migrateQuestionPdfUrl', migrateQuestionPdfUrl],
        ['migrateCompleteResources', migrateCompleteResources],
        ['migrateParseProgressColumns', migrateParseProgressColumns],
        ['migrateResourceUnits', migrateResourceUnits],
        ['migrateWrongQuestionSelfContained', migrateWrongQuestionSelfContained],
        ['migrateWrongQuestionSubject', migrateWrongQuestionSubject],
        ['migrateErrorAnalysis', migrateErrorAnalysis],
        ['migrateKnowledgeTables', migrateKnowledgeTables],
        ['migrateVariantQuestions', migrateVariantQuestions],
        ['migrateVariantQuestionType', migrateVariantQuestionType],
        ['migrateRelaxQuestionTypeCheck', migrateRelaxQuestionTypeCheck],
        ['migrateHandoutLectures', migrateHandoutLectures],
        ['migrateTaskNotificationRead', migrateTaskNotificationRead],
        ['migrateTeachingQuestionTypes', migrateTeachingQuestionTypes],
        ['migrateTeachingQuestionTypeAuto', migrateTeachingQuestionTypeAuto],
        ['migrateStudentEnrollmentStatus', migrateStudentEnrollmentStatus],
        ['migrateAiAnswerRiskReason', migrateAiAnswerRiskReason],
        ['migrateTaskContentHash', migrateTaskContentHash],
        ['migrateWrongQuestionsUniqueIndex', migrateWrongQuestionsUniqueIndex],
        ['migrateTaskTypeEnum', migrateTaskTypeEnum],
        ['migrateAiSelfCheck', migrateAiSelfCheck],
        ['migrateFixExamPublishedInconsistency', migrateFixExamPublishedInconsistency],
        ['migrateGeometryManualOverride', migrateGeometryManualOverride],
        ['migrateQuestionParentStem', migrateQuestionParentStem],
        ['migrateWrongQuestionsLastWrongTaskId', migrateWrongQuestionsLastWrongTaskId],
        ['migrateWrongQuestionsIdentitySplit', migrateWrongQuestionsIdentitySplit]
      ])
    } catch (err) {
      console.error('数据库迁移失败:', err.message)
    }

    // 启动清残：练习册答案解析寄生在本进程内，进程重启后状态会永远停在 'parsing'
    // （前端无限转圈、重新上传被 409 拒绝、要等 15 分钟才被兜底扫描重置）。
    // 此处利用「进程刚启动 ⇒ 不存在本进程发起的解析」在启动瞬间一次性清残。
    // 仅托管实例（RENDER）执行，本机 dev 与线上共用同一个库，不得误伤线上在跑的解析。
    try {
      const { cleanupStaleParsingOnBoot } = await import('./services/neonService.js')
      const cleaned = await cleanupStaleParsingOnBoot()
      if (cleaned.skipped) {
        console.log(`🧹 启动清残（练习册解析状态）：跳过（${cleaned.skipped}）`)
      } else if (cleaned.count > 0) {
        console.log(`🧹 启动清残：${cleaned.count} 本练习册解析状态 parsing → failed（${cleaned.names.join('；')}）`)
      } else {
        console.log('🧹 启动清残（练习册解析状态）：无残留')
      }
    } catch (err) {
      console.error('启动清残（练习册解析状态）失败:', err.message)
    }

    // 定时自动回填知识点标签+难度：让曾因限流失败的题目能被持续重试补齐。
    // 启动 2 分钟后先跑一次，之后每 BACKFILL_INTERVAL_HOURS 小时（默认 6h）跑一次。
    try {
      const intervalHours = Number(process.env.BACKFILL_INTERVAL_HOURS) || 6
      const intervalMs = intervalHours * 60 * 60 * 1000
      setTimeout(() => {
        runBackfillTags({ trigger: 'auto', chain: true }).catch(e => console.error('[BackfillTags] 定时回填异常:', e.message))
      }, 2 * 60 * 1000)
      setInterval(() => {
        runBackfillTags({ trigger: 'auto', chain: true }).catch(e => console.error('[BackfillTags] 定时回填异常:', e.message))
      }, intervalMs)
      console.log(`⏰ 知识点/难度定时回填已启用（每 ${intervalHours} 小时）`)
    } catch (err) {
      console.error('定时回填启动失败:', err.message)
    }

    // 定时错因/空题诊断回填（与知识点回填同节奏，异步小批量）
    try {
      const intervalHours = Number(process.env.BACKFILL_INTERVAL_HOURS) || 6
      const intervalMs = intervalHours * 60 * 60 * 1000
      setTimeout(() => {
        runDiagnosisBackfill({ trigger: 'auto', chain: true }).catch(e => console.error('[DiagnosisBackfill] 定时回填异常:', e.message))
      }, 3 * 60 * 1000)
      setInterval(() => {
        runDiagnosisBackfill({ trigger: 'auto', chain: true }).catch(e => console.error('[DiagnosisBackfill] 定时回填异常:', e.message))
      }, intervalMs)
      console.log(`⏰ 错因/空题诊断回填已启用（每 ${intervalHours} 小时）`)
    } catch (err) {
      console.error('诊断定时回填启动失败:', err.message)
    }

    // 夜间自动补解析：配额重置后的低峰期自动重跑未解析干净的练习册（程序内定时，随仓库走）
    try {
      scheduleNightParse()
    } catch (err) {
      console.error('夜间补解析定时器启动失败:', err.message)
    }

    // 周维度错因诊断：每周一 02:00 自动回填本周新增错题的 error_type / error_reason，
    // 保证老师周一打开「学习诊断」时所有错题已有错因。
    try {
      scheduleWeeklyDiagnosis()
    } catch (err) {
      console.error('周维度错因诊断定时器启动失败:', err.message)
    }

    // 缺图监控：每周日 23:17 跑一次，记录"错题本被挡题数"趋势。
    // 数据驱动决策：若某周 ≥5 道再考虑做"作图题分类 / prompt 调优"工程。
    try {
      scheduleWeeklyMissingFigureCheck()
    } catch (err) {
      console.error('缺图监控定时器启动失败:', err.message)
    }

    console.log(`并发数: ${process.env.CONCURRENCY || 2}`)
    console.log(`数据库: Neon PostgreSQL`)
  })
}

// ─────────────────────────────────────────────
// 知识点驱动学习数据层 API（成长中心 / 讲义引擎数据源）
// ─────────────────────────────────────────────

// 学生知识点掌握度列表（成长中心核心数据）
app.get('/api/knowledge/mastery', async (req, res) => {
  try {
    const { studentId, subject } = req.query
    if (!studentId) return res.status(400).json({ error: '缺少 studentId' })
    const rows = await getStudentMastery(studentId, subject || null)
    res.json({ success: true, mastery: rows })
  } catch (error) {
    console.error('获取知识点掌握度失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 知识树（嵌套结构，供成长中心/讲义下钻）
app.get('/api/knowledge/tree', async (req, res) => {
  try {
    const subject = req.query.subject || '数学'
    const tree = await getKnowledgeTree(subject)
    res.json({ success: true, subject, tree })
  } catch (error) {
    console.error('获取知识树失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 单题知识点（供题目详情展示"这题考什么"）
app.get('/api/questions/:id/knowledge', async (req, res) => {
  try {
    const { id } = req.params
    const rows = await getQuestionKnowledge(id)
    res.json({ success: true, knowledge: rows })
  } catch (error) {
    console.error('获取题目知识点失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 运维：清除进程内的知识树缓存。
// 知识树修改后调用一次，下一次 API 请求会从 DB 重新加载。
app.post('/api/knowledge/cache/clear', async (req, res) => {
  try {
    clearKnowledgeCache()
    res.json({ success: true, message: '知识树缓存已清空' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export { app }

export const createServer = (port = PORT) => {
  return new Promise(async (resolve) => {
    // 启动时初始化队列
    await getTaskQueue()

    // 启动 Pending 任务恢复扫描器
    try {
      pendingTaskRecovery.start()
    } catch (err) {
      console.error('Pending 任务恢复扫描器启动失败:', err.message)
    }

    const server = app.listen(port, () => {
      resolve(server)
    })
  })
}
