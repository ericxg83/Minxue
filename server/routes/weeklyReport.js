import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { parsePeriod, getIsoWeek, getPeriodRange, toLocalYmd } from '../utils/period.js'
import { sqlCorrectExpr, sqlWrongExpr } from '../utils/questionResultCaliber.js'

const router = Router()

/**
 * 计算上一周期（当前周期的前一期），用于成长对比。
 * 'all' 模式无对比对象，返回 null。
 * @param {string} mode - 'week' | 'month' | 'all'
 * @param {number} offset - 当前周期偏移
 * @returns {{ periodStart: Date, periodEnd: Date } | null}
 */
export function shiftPrevPeriod(mode, offset) {
  if (mode === 'all') return null
  return getPeriodRange(mode, offset + 1)
}

/**
 * 从本周期已出结果的重练任务（tasks.result）聚合成"重练进步"。
 * 判题结果只信任 tasks.result（slim 重练卷不写 questions 表，禁按 task_id 查题）。
 * 只统计"有效出结果"的卷：result 无 error/failedAt，且能读到数量型字段。
 * @param {Array<{id:string, result:Object}>} taskRows
 * @returns {Object}
 */
export function buildRetryProgress(taskRows) {
  const valid = (taskRows || []).filter(r => {
    const rs = r.result || {}
    if (rs.error || rs.failedAt) return false
    // 结果字段缺失即视为无效卷（早期老数据可能没有出分）
    return typeof rs.correctCount === 'number' || typeof rs.questionCount === 'number'
  })
  const sum = (key) => valid.reduce((acc, r) => acc + (Number((r.result || {})[key]) || 0), 0)
  const examCount = valid.length
  const retriedCount = sum('questionCount')
  const correctCount = sum('correctCount')
  const wrongCount = sum('wrongCount')
  const pendingCount = sum('pendingCount')
  const judged = correctCount + wrongCount
  return {
    examCount,
    retriedCount,
    correctCount,
    wrongCount,
    pendingCount,
    retryAccuracy: judged > 0 ? Math.round((correctCount / judged) * 1000) / 10 : 0
  }
}

/**
 * 错题掌握状态三态拆分（2026-10-04，r130）。
 *
 * 背景（负责人截图质疑「完全掌握只有 2」）：旧口径只把 lifecycle_status='mastered'
 * 算「完全掌握」，其余（review_1 基本掌握 / new 待复习 / NULL 历史）全部并进一个
 * pendingCount，前端给它起名「待提升」。后果是**「基本掌握」这一层在页面上完全
 * 没有出口**——陆晨曦实测 74 道错题 = 完全掌握 2 + 基本掌握 14 + 待复习 58，
 * 页面只显示「完全掌握 2 / 待提升 72」，家长看到的是 2，实际记住了 16 道。
 *
 * 本函数**不改动** masteredCount / pendingCount 的既有语义（老消费方全部照旧），
 * 只额外拆出基本掌握与待复习两层，供展示层画三态图。
 * 口径：review_2 是历史残留枚举，按 review_1 语义计入「基本掌握」
 * （与 weaknessService.getRetryEffectiveness 及 test/lifecycleQueue 锁一致）。
 *
 * @param {Array<{lifecycle_status: string|null, count: number}>} statusRows
 * @returns {{masteredCount:number, basicMasteredCount:number, notStartedCount:number, pendingCount:number}}
 */
export function splitMasteryStates(statusRows) {
  let masteredCount = 0
  let basicMasteredCount = 0
  let notStartedCount = 0
  let pendingCount = 0
  for (const row of statusRows || []) {
    const n = row.count || 0
    if (row.lifecycle_status === 'mastered') {
      masteredCount += n
    } else if (row.lifecycle_status === 'review_1' || row.lifecycle_status === 'review_2') {
      basicMasteredCount += n
      pendingCount += n
    } else {
      // new + NULL（历史无状态）都算「还没对过一次」
      notStartedCount += n
      pendingCount += n
    }
  }
  return { masteredCount, basicMasteredCount, notStartedCount, pendingCount }
}

/**
 * 获取单个学生的周期学习报告数据（与 GET /:studentId 完全同口径）。
 * 原逻辑抽取自路由 handler（2026-10-04），供分享卡等服务端产出物复用，
 * 口径变更只改这一处。options 参数与 GET 相同（mode/offset/weeks）。
 * 学生不存在时抛 statusCode=404 的 Error。
 * ⚠️ 参数名不能叫 query：文件顶部已从 neon.js 导入 query 函数，同名会把
 *    数据层调用遮蔽成「query is not a function」（r105 实证，分享卡 500）。
 */
export async function fetchStudentWeeklyReport(studentId, options = {}) {
  const { periodStart, periodEnd, mode, offset } = parsePeriod(options)
  const isWeekMode = mode === 'week'

  // 1. 获取学生信息
  const { rows: studentRows } = await query(
    `SELECT id, name, grade FROM ${TABLES.STUDENTS} WHERE id = $1`,
    [studentId]
  )
  if (studentRows.length === 0) {
    const err = new Error('学生不存在')
    err.statusCode = 404
    throw err
  }

    // 2. 本周作业任务统计
    const { rows: taskRows } = await query(
      `SELECT
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE status IN ('done', 'reviewed'))::int AS completed_tasks
      FROM ${TABLES.TASKS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND deleted_at IS NULL`,
      [studentId, periodStart, periodEnd]
    )

    // 3. 本周批改题量 & 正确率
    // 2026-09-14：正确/错误按 questionResultCaliber 归类（**人工复核结论优先**），
    // 与移动端组卷数字、结算掌握度同一口径；此前只数 is_correct，老师改判不算数。
    // 未作答等同不会（blank 且 is_correct=false）计入 wrong —— 与周报 wrong 原口径一致。
    const { rows: questionRows } = await query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct,
        COUNT(*) FILTER (WHERE ${sqlWrongExpr()})::int AS wrong
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE`,
      [studentId, periodStart, periodEnd]
    )

    // 4. 本周新增错题 & 掌握状态
    // r133：顺带取「练过 / 反复错」两个计数，供页面的战果条与动作清单用。
    //     反复错 = error_count >= 2（错两次以上说明上次没真懂，回炉优先级最高）；
    //     练过   = practice_count >= 1（已纳入过重练）。
    const { rows: wrongStatusRows } = await query(
      `SELECT lifecycle_status, COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE COALESCE(practice_count, 0) >= 1)::int AS practiced,
              COUNT(*) FILTER (WHERE COALESCE(error_count, 0) >= 2)::int AS repeated
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1
        AND added_at >= $2
        AND added_at < $3
      GROUP BY lifecycle_status`,
      [studentId, periodStart, periodEnd]
    )

    // 5a. 本周新增错题总数（所有生命周期状态，不含 mastered 过滤）
    const { rows: wrongCountRows } = await query(
      `SELECT COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1
        AND added_at >= $2
        AND added_at < $3`,
      [studentId, periodStart, periodEnd]
    )

    // 5b. 获取可用于组卷的错题 question_id（仅含已完成题目，排除已掌握）
    //     选题口径（2026-09-13 队列分层定稿）：周报重练卷是「第二次验证」的承载，
    //     所以池子 = 本周期新增的 new/review_1 错题 + 全库到期的 review_1/review_2（基本掌握）。
    //     「到期」用 wq.updated_at 推导：重练结算会写 updated_at=NOW()，
    //     距上次练习 ≥7 天即视为该做周回顾了（MVP 不新增 review_due_at 字段）。
    //     排序：先到期的基本掌握题（二次验证优先，避免假掌握滞留），再按学习价值：
    //       1) 难度升序优先（简单→中等→难），让学生先练会简单题、再逐级突破难题；
    //          NULL 难度按中档(3)处理，保证无难度题也能稳定入序、不阻塞。
    //          当前系统仅录入数学，不做跨学科轮转；若将来多学科可在此改回 PARTITION BY 学科兜底。
    //       2) 同难度内错误次数（error_count）多的优先；
    //       3) 最后按最近错题。
    //     返回全量有序列表（ID 体积极小），由前端只取前 N 道生成再测卷。
    const { rows: wrongIdRows } = await query(
      `SELECT wq.question_id
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND q.is_complete = TRUE
      WHERE wq.student_id = $1
        AND (
          (wq.added_at >= $2 AND wq.added_at < $3
            AND (wq.lifecycle_status IS NULL OR wq.lifecycle_status != 'mastered'))
          OR
          (wq.lifecycle_status IN ('review_1', 'review_2')
            AND wq.updated_at IS NOT NULL
            AND wq.updated_at <= NOW() - INTERVAL '7 days')
        )
      ORDER BY
        (wq.lifecycle_status IN ('review_1', 'review_2')) DESC,
        COALESCE(q.difficulty, 3) ASC,
        COALESCE(wq.error_count, 1) DESC,
        wq.added_at DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 6. 本周知识点诊断（与 prev 周期共用 fetchKnowledgeDiagnosis，保证口径一致）
    const knowledgeDiagnosis = await fetchKnowledgeDiagnosis(studentId, periodStart, periodEnd)

    // 7. 每日正确率趋势（本周批改题目按日期分组）
    const { rows: trendRows } = await query(
      `SELECT
        to_char(created_at, 'MM-DD') AS day,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE
      GROUP BY day
      ORDER BY day`,
      [studentId, periodStart, periodEnd]
    )

    // 7b. 周期趋势（r130 新增，供页面的折线图用）。
    //     分桶粒度按**实际数据跨度**自适应，而不是死按 mode：
    //     跨度 <= 45 天 → 按日（一个月内的学习走势，这才是家长要看的信心曲线）；
    //     跨度更长 → 按月（全部模式跨半年时按日会挤成一条锯齿竖线）。
    //     依据：陆晨曦 298 道题全在 2026-09，若按月分桶只有 1 个点，折线图等于没有。
    //     isWeekMode 直接复用上面已查好的 trendRows，不重复打库。
    let periodTrend
    if (isWeekMode) {
      periodTrend = buildDailyTrend(trendRows, periodStart)
    } else {
      const { rows: spanRows } = await query(
        `SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at
         FROM ${TABLES.QUESTIONS}
         WHERE student_id = $1 AND created_at >= $2 AND created_at < $3 AND is_complete = TRUE`,
        [studentId, periodStart, periodEnd]
      )
      const first = spanRows[0]?.first_at
      const last = spanRows[0]?.last_at
      const spanDays = first && last ? Math.ceil((last - first) / 86400000) : 0
      const bucketFmt = spanDays > 45 ? 'YYYY-MM' : 'MM-DD'
      const { rows: bucketRows } = await query(
        `SELECT
          to_char(created_at, '${bucketFmt}') AS bucket,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
        FROM ${TABLES.QUESTIONS}
        WHERE student_id = $1
          AND created_at >= $2
          AND created_at < $3
          AND is_complete = TRUE
        GROUP BY bucket
        ORDER BY bucket`,
        [studentId, periodStart, periodEnd]
      )
      periodTrend = buildPeriodTrend(bucketRows, mode, periodStart)
    }

    // 7c. 按天 + 按周两套正确率序列（r132 新增，供页面粒度切换与 PDF 用）。
    //     为什么必须一次给全两种粒度：
    //       - 页面加「按天 / 按周」开关要即时重画，不能让用户每切一次就打一次库；
    //       - PDF 折线图的数据源是 dailyTrend，而旧版 dailyTrend **只在周模式生成**
    //         （月/全部一律返回 []）⇒ 周报 PDF 的折线图一直画不出来（r132 实测
    //         week 有效 0 点 / month 0 点 / all 0 点）。这里补上按天数据，
    //         PDF 侧只要改读这个字段就有图，两边口径同源。
    //     ⛔ 不补空日：当天没批改 = 「没考试」，不是「全错」，补 0 会让家长误读。
    //       没有批改的天直接不出现，折线自然断开（铁律：趋势图不许伪造数据）。
    //     按天用 Asia/Shanghai 切自然日，与 getDailyTrend / summary 的 today 口径一致。
    const { rows: dailyAccRows } = await query(
      `SELECT
        to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE
      GROUP BY day
      ORDER BY day`,
      [studentId, periodStart, periodEnd]
    )
    const dailyAccuracy = dailyAccRows.map(r => ({
      date: r.day,
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : null,
      count: r.total,
      correct: r.correct
    }))

    // 按周：与 dailyAccuracy 同期同口径，只用日桶累加，避免多打一次库
    const weeklyMap = new Map()
    for (const r of dailyAccRows) {
      // 'YYYY-MM-DD' → 该周的周一（date_trunc 在 SQL 里做跨年更稳，这里按自然日推算）
      const d = new Date(`${r.day}T00:00:00+08:00`)
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
      d.setDate(d.getDate() - dow)
      const wk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const cur = weeklyMap.get(wk) || { total: 0, correct: 0 }
      cur.total += r.total
      cur.correct += r.correct
      weeklyMap.set(wk, cur)
    }
    const weeklyAccuracy = [...weeklyMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([week, v]) => ({
        date: week,
        accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : null,
        count: v.total,
        correct: v.correct
      }))

    // 8. 各学科整体正确率（本周批改题目按学科聚合）
    const { rows: subjectAccRows } = await query(
      `SELECT
        COALESCE(NULLIF(subject, ''), '其他') AS subject,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE
      GROUP BY subject
      ORDER BY total DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 8.5 错因分布（仅做错题，空题不分析错因）——复用 diagnosisService 已回填的
    // wrong_questions.error_type（与 teaching.js 教学诊断同一口径，不重造错因分析）。
    const { rows: errorTypeRows } = await query(
      `SELECT
        COALESCE(NULLIF(wq.error_type, ''), '未分析') AS error_type,
        COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS} wq
      WHERE wq.student_id = $1
        AND wq.added_at >= $2
        AND wq.added_at < $3
        AND (wq.is_blank IS NOT TRUE)
      GROUP BY COALESCE(NULLIF(wq.error_type, ''), '未分析')
      ORDER BY count DESC`,
      [studentId, periodStart, periodEnd]
    )
    const errorTotal = errorTypeRows.reduce((s, r) => s + r.count, 0)
    const errorDistribution = errorTypeRows.map(r => ({
      errorType: r.error_type,
      count: r.count,
      ratio: errorTotal > 0 ? Math.round((r.count / errorTotal) * 100) : 0
    }))

    // 组合掌握状态统计（mastered / 基本掌握 / 待复习 三态）
    const { masteredCount, basicMasteredCount, notStartedCount, pendingCount } =
      splitMasteryStates(wrongStatusRows)
    // r133：练过 / 反复错合计（跨状态求和，与三态拆分互不干扰）
    const practicedCount = wrongStatusRows.reduce((s, r) => s + (r.practiced || 0), 0)
    const repeatWrongCount = wrongStatusRows.reduce((s, r) => s + (r.repeated || 0), 0)

    const stats = {
      totalTasks: taskRows[0]?.total_tasks || 0,
      completedTasks: taskRows[0]?.completed_tasks || 0,
      totalQuestions: questionRows[0]?.total || 0,
      correctCount: questionRows[0]?.correct || 0,
      wrongCount: questionRows[0]?.wrong || 0,
      accuracy: questionRows[0]?.total > 0
        ? Math.round((questionRows[0].correct / questionRows[0].total) * 1000) / 10
        : 0,
      newWrongCount: wrongCountRows[0]?.count || 0,
      masteredCount,
      basicMasteredCount,
      notStartedCount,
      practicedCount,
      repeatWrongCount,
      pendingCount,
      wrongQuestionIds: wrongIdRows.map(r => r.question_id)
    }

    // 各学科整体正确率映射
    const subjectAccuracyMap = {}
    for (const r of subjectAccRows) {
      subjectAccuracyMap[r.subject] = r.total > 0
        ? Math.round((r.correct / r.total) * 1000) / 10
        : 0
    }

    // 按学科分组诊断：每科取 TOP5 薄弱知识点，附占比与掌握标签
    const subjectDiagnosis = buildSubjectDiagnosis(knowledgeDiagnosis, subjectAccuracyMap)

    // 每日趋势（周模式补全 7 天，月/全部模式不生成趋势）
    const dailyTrend = isWeekMode ? buildDailyTrend(trendRows, periodStart) : []
    const weekNum = isWeekMode ? getIsoWeek(periodStart) : null

    // 8. 上一周期对比（week/month；all 模式 prev=null） + 本周期重练进步
    const prevPeriod = shiftPrevPeriod(mode, offset)
    const prev = prevPeriod
      ? await fetchPeriodCompare(studentId, { ...prevPeriod, mode, offset: offset + 1 })
      : null
    const retryProgress = await fetchRetryProgress(studentId, periodStart, periodEnd)
    // r136：逐份重练卷明细（进步证据页的时间线需要）。
    //     此前 fetchRetryProgress 只返回**汇总**（几份卷、共几题、正确率），
    //     画不出「每次重练答对率的起伏」—— 而那恰恰是家长最想看的进步过程。
    //     铁律 9：slim 重练卷不写 questions 表，判题结果只信任 tasks.result。
    const { rows: retryHistoryRows } = await query(
      `SELECT
         to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date,
         COALESCE((result->>'questionCount')::int, 0) AS question_count,
         COALESCE((result->>'correctCount')::int, 0)  AS correct_count
       FROM ${TABLES.TASKS}
       WHERE student_id = $1
         AND task_type = 'wrong_retry'
         AND deleted_at IS NULL
         AND (result->>'questionCount') IS NOT NULL
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at ASC`,
      [studentId, periodStart, periodEnd]
    )
    const retryHistory = retryHistoryRows.map(r => ({
      date: r.date,
      questionCount: r.question_count,
      correctCount: r.correct_count
    }))

    // ⛔ 注意：这里**故意不加**「曾经被批改过」的查询。
    //    r133 曾加过（供家长分享卡区分新/老学生），实测让周报接口**稳定多花 0.24s**
    //    （旧实例 1.094s / 新实例 1.333s，6 轮交错采样一致；改用 EXISTS 早退后仍 +0.1s）。
    //    周报接口是热路径（移动端/工作台/PDF 每次加载都调），不该为一张分享卡的文案
    //    多付一条查询 ⇒ 该查询放在分享卡链路（routes/shareCard.js），只有点"生成分享卡"
    //    时才付一次。见 shareCard.js 的 hasEverGraded 注释。

    const result = {
      success: true,
      student: studentRows[0],
      period: {
        // ⛔ 周期边界由 period.js 按**本地时区**算（new Date(y,m,d)），对外也必须按本地日历日印。
        //    旧写法 `periodStart.toISOString().split('T')[0]` 是 UTC ⇒ 本地 00:00 被写成前一天：
        //    周一 10/05 印成 10/04、10 月周期印成 09-30（家长看到的 PDF/分享卡「月徽章」成了「9月」）。
        //    r148 修，锁 test/weeklyReportPeriodLocalDate.test.mjs。
        start: mode === 'all' ? periodStart.toISOString().split('T')[0] : toLocalYmd(periodStart),
        // end 是**排他**边界（下周一 / 次月 1 日 00:00），对家长要说的是「最后一天」⇒ 减 1ms
        // （与 server/lib/weekendHandout.js:1131 同一口径；all 模式保留 2099-12-31 哨兵值）
        end: mode === 'all' ? periodEnd.toISOString().split('T')[0] : toLocalYmd(new Date(periodEnd.getTime() - 1)),
        mode,
        offset,
        weekNum
      },
      stats,
      knowledgeDiagnosis,
      subjectDiagnosis,
      errorDistribution,
      dailyTrend,
      // 2026-10-04（r130）：周/月/全部都能出图的周期趋势（纯新增，向后兼容）
      periodTrend,
      // 2026-10-04（r132）：按天 + 按周两套正确率序列（纯新增）。
      // 页面粒度切换与 PDF 折线图共用，不补空日（没批改的天不出现）。
      dailyAccuracy,
      weeklyAccuracy,
      // 2026-10-04（r136）：逐份重练卷明细（纯新增）——
      // retryProgress 只有汇总，画不出「每次重练答对率的起伏」。
      retryHistory,
      // 2026-09-20 成长历史 P0：两期对比 + 重练进步（纯新增字段，向后兼容）
      prev,
      retryProgress
    }

    return result
}

/**
 * GET /api/weekly-report/:studentId
 * 获取学生本周学习统计数据
 * Query params:
 *   - mode: 'week' | 'month' | 'all'，默认 week
 *   - offset: 偏移量，0=当前，1=上一个...
 *   - weeks: (兼容旧参数) 周数，默认 1（本周），2 表示近两周
 */
router.get('/:studentId', async (req, res) => {
  try {
    const result = await fetchStudentWeeklyReport(req.params.studentId, req.query)
    res.json(result)
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message })
    }
    console.error('获取周学习报告失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/weekly-report
 * 获取所有学生的本周统计数据（用于一键生成）
 */
router.get('/', async (req, res) => {
  try {
    const { periodStart, periodEnd, mode } = parsePeriod(req.query)
    const isWeekMode = mode === 'week'

    // 获取所有学生
    const { rows: studentRows } = await query(
      `SELECT id, name, grade FROM ${TABLES.STUDENTS} ORDER BY name`
    )

    const reports = await Promise.all(studentRows.map(async (student) => {
      try {
        // 本周作业任务统计
        const { rows: taskRows } = await query(
          `SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE status IN ('done', 'reviewed'))::int AS completed_tasks
          FROM ${TABLES.TASKS}
          WHERE student_id = $1
            AND created_at >= $2
            AND created_at < $3
            AND deleted_at IS NULL`,
          [student.id, periodStart, periodEnd]
        )

        // 本周批改题量 & 正确率
        const { rows: questionRows } = await query(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct,
            COUNT(*) FILTER (WHERE ${sqlWrongExpr()})::int AS wrong
          FROM ${TABLES.QUESTIONS}
          WHERE student_id = $1
            AND created_at >= $2
            AND created_at < $3
            AND is_complete = TRUE`,
          [student.id, periodStart, periodEnd]
        )

        // 本周新增错题
        const { rows: wrongRows } = await query(
          `SELECT COUNT(*)::int AS count
          FROM ${TABLES.WRONG_QUESTIONS}
          WHERE student_id = $1
            AND added_at >= $2
            AND added_at < $3`,
          [student.id, periodStart, periodEnd]
        )

        // 本周掌握状态
        const { rows: statusRows } = await query(
          `SELECT lifecycle_status, COUNT(*)::int AS count
          FROM ${TABLES.WRONG_QUESTIONS}
          WHERE student_id = $1
            AND added_at >= $2
            AND added_at < $3
          GROUP BY lifecycle_status`,
          [student.id, periodStart, periodEnd]
        )

        const { masteredCount, basicMasteredCount, notStartedCount, pendingCount } =
          splitMasteryStates(statusRows)

        return {
          student: { id: student.id, name: student.name, grade: student.grade },
          stats: {
            totalTasks: taskRows[0]?.total_tasks || 0,
            completedTasks: taskRows[0]?.completed_tasks || 0,
            totalQuestions: questionRows[0]?.total || 0,
            correctCount: questionRows[0]?.correct || 0,
            accuracy: questionRows[0]?.total > 0
              ? Math.round((questionRows[0].correct / questionRows[0].total) * 1000) / 10
              : 0,
            newWrongCount: wrongRows[0]?.count || 0,
            masteredCount,
            basicMasteredCount,
            notStartedCount,
            pendingCount
          }
        }
      } catch (e) {
        return {
          student: { id: student.id, name: student.name },
          stats: null,
          error: e.message
        }
      }
    }))

    // 单学生取数失败不能静默成「本周无数据」——必须显式上报，否则消费方
    // （批量 PDF 生成器 weeklyReportGenerator.js、工作台班级视图）会把失败
    // 渲染成 skipped/空数据，老师误以为该生这周没作业。见 stats===null 语义。
    const failed = reports
      .filter(r => r && r.stats === null)
      .map(r => ({ id: r.student?.id, name: r.student?.name, error: r.error || '未知错误' }))
    if (failed.length > 0) {
      console.error(`全班周报：${failed.length}/${reports.length} 名学生取数失败：`,
        failed.map(f => `${f.name}(${f.error})`).join('；'))
    }

    res.json({
      success: true,
      // 部分失败信号（纯新增字段，向后兼容）：stats===null 的 report 不可当作无数据
      partialFailure: failed.length > 0
        ? { count: failed.length, total: reports.length, students: failed }
        : null,
      period: {
        // 同上（全班版）：必须按本地日历日印，别用 toISOString 的 UTC 日 —— 见本文件上方单学生版的注释
        start: mode === 'all' ? periodStart.toISOString().split('T')[0] : toLocalYmd(periodStart),
        end: mode === 'all' ? periodEnd.toISOString().split('T')[0] : toLocalYmd(new Date(periodEnd.getTime() - 1)),
        mode,
        weekNum: isWeekMode ? getIsoWeek(periodStart) : null
      },
      reports
    })
  } catch (error) {
    console.error('获取全学生周统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ============================================================
// 成长对比（prev）与重练进步（retryProgress）查询
// 2026-09-20 新增：学习诊断"成长历史"P0 —— 两期对比 + 重练进步
// 口径约定：
//   - prev 只做同口径聚合（questions 正确率 / wrong_questions 错题与生命周期 /
//     知识点 ai_tags），SQL 与当前周期完全一致；
//   - 重练判题结果只信任 tasks.result（slim 重练卷不写 questions 表，
//     统计禁按 task_id 查题，见 working-memory 铁律 9）。
// ============================================================

/** 知识点诊断（按 ai_tags 展开，兼容 text 和 jsonb），当前周期与 prev 周期共用同一段 SQL */
async function fetchKnowledgeDiagnosis(studentId, periodStart, periodEnd) {
  const { rows: tagRows } = await query(
    `SELECT
      COALESCE(NULLIF(q.subject, ''), '其他') AS subject,
      jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END) AS tag,
      COUNT(*) FILTER (WHERE ${sqlWrongExpr('q.')})::int AS wrong_count,
      COUNT(*)::int AS total_count
    FROM ${TABLES.WRONG_QUESTIONS} wq
    JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
    WHERE wq.student_id = $1
      AND wq.added_at >= $2
      AND wq.added_at < $3
      AND q.is_complete = TRUE
      AND q.ai_tags IS NOT NULL
      AND q.ai_tags != ''
      AND q.ai_tags != '[]'
    GROUP BY COALESCE(NULLIF(q.subject, ''), '其他'), tag
    ORDER BY COALESCE(NULLIF(q.subject, ''), '其他'), wrong_count DESC, total_count DESC`,
    [studentId, periodStart, periodEnd]
  )
  return tagRows.map(r => ({
    subject: r.subject,
    tag: r.tag,
    wrongCount: r.wrong_count,
    totalCount: r.total_count,
    accuracy: r.total_count > 0
      ? Math.round(((r.total_count - r.wrong_count) / r.total_count) * 1000) / 10
      : 0
  }))
}

/**
 * 周期趋势（2026-10-04，r130 新增）：周/月/全部三档都能出图。
 *
 * 背景：旧版只在 isWeekMode 时用 buildDailyTrend 填 dailyTrend，月/全部一律返回 []，
 * 前端于是整块不渲染 —— 负责人截图（全部模式）页面上「一张图都没有」。
 * 这里**新增** periodTrend 字段（结构与 dailyTrend 同构：{date,accuracy,count}），
 * 按周期粒度自动选桶：周=补齐 7 天、月=按日、全部=按月。不改 dailyTrend 语义，
 * 移动端 PDF / 分享卡的既有消费方完全不受影响。
 *
 * @param {Array<{bucket:string, total:number, correct:number}>} rows 已按桶聚合
 * @returns {Array<{date:string, accuracy:number|null, count:number}>}
 */
function buildPeriodTrend(rows, mode, periodStart) {
  const map = {}
  for (const r of rows) {
    map[r.bucket] = {
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : null,
      count: r.total
    }
  }
  // 周模式复用 7 天补齐逻辑（含无数据的天 → accuracy null，折线自然断开）
  if (mode === 'week') return buildDailyTrend(rows.map(r => ({
    day: r.bucket, total: r.total, correct: r.correct
  })), periodStart)

  const keys = Object.keys(map).sort()
  return keys.map(k => ({
    date: k,
    accuracy: map[k].accuracy,
    count: map[k].count
  }))
}

/**
 * 上一周期的对比快照：作业/题量/正确率/错题/掌握状态 + 知识点诊断 */
export async function fetchPeriodCompare(studentId, { periodStart, periodEnd, mode, offset }) {
  const [taskRows, questionRows, wrongCountRows, statusRows] = await Promise.all([
    query(
      `SELECT
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE status IN ('done', 'reviewed'))::int AS completed_tasks
      FROM ${TABLES.TASKS}
      WHERE student_id = $1 AND created_at >= $2 AND created_at < $3 AND deleted_at IS NULL`,
      [studentId, periodStart, periodEnd]
    ),
    query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct,
        COUNT(*) FILTER (WHERE ${sqlWrongExpr()})::int AS wrong
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1 AND created_at >= $2 AND created_at < $3 AND is_complete = TRUE`,
      [studentId, periodStart, periodEnd]
    ),
    query(
      `SELECT COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1 AND added_at >= $2 AND added_at < $3`,
      [studentId, periodStart, periodEnd]
    ),
    query(
      `SELECT lifecycle_status, COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1 AND added_at >= $2 AND added_at < $3
      GROUP BY lifecycle_status`,
      [studentId, periodStart, periodEnd]
    )
  ])

  const { masteredCount, basicMasteredCount, notStartedCount, pendingCount } =
    splitMasteryStates(statusRows.rows)
  const q = questionRows.rows[0]
  const knowledgeDiagnosis = await fetchKnowledgeDiagnosis(studentId, periodStart, periodEnd)

  return {
    period: {
      // 同上：上一周期的「学习周期」也是印给家长看的（PDF 对比页），必须按本地日历日印
      start: mode === 'all' ? periodStart.toISOString().split('T')[0] : toLocalYmd(periodStart),
      end: mode === 'all' ? periodEnd.toISOString().split('T')[0] : toLocalYmd(new Date(periodEnd.getTime() - 1)),
      mode,
      offset
    },
    stats: {
      totalTasks: taskRows.rows[0]?.total_tasks || 0,
      completedTasks: taskRows.rows[0]?.completed_tasks || 0,
      totalQuestions: q?.total || 0,
      correctCount: q?.correct || 0,
      wrongCount: q?.wrong || 0,
      accuracy: q?.total > 0 ? Math.round((q.correct / q.total) * 1000) / 10 : 0,
      newWrongCount: wrongCountRows.rows[0]?.count || 0,
      masteredCount,
      basicMasteredCount,
      notStartedCount,
      pendingCount
    },
    knowledgeDiagnosis
  }
}

/** 本周期重练进步：已完成 wrong_retry 任务判题结果 + 练习后的错题生命周期推进 */
export async function fetchRetryProgress(studentId, periodStart, periodEnd) {
  const { rows } = await query(
    `SELECT id, result
     FROM ${TABLES.TASKS}
     WHERE student_id = $1
       AND task_type = 'wrong_retry'
       AND deleted_at IS NULL
       AND updated_at >= $2
       AND updated_at < $3`,
    [studentId, periodStart, periodEnd]
  )
  const progress = buildRetryProgress(rows)

  // 本周期练习后的错题去向（重练结算会写 updated_at=NOW()）：
  //   review_1 = 重练答对推进到「基本掌握」；new = 答错回池重练；mastered = 完全掌握
  const { rows: lc } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE lifecycle_status = 'review_1')::int AS pushed_to_basic,
       COUNT(*) FILTER (WHERE lifecycle_status = 'mastered')::int AS mastered_cnt,
       COUNT(*) FILTER (WHERE lifecycle_status = 'new')::int AS still_new
     FROM ${TABLES.WRONG_QUESTIONS}
     WHERE student_id = $1
       AND COALESCE(practice_count, 0) > 0
       AND updated_at >= $2
       AND updated_at < $3`,
    [studentId, periodStart, periodEnd]
  )
  progress.pushedToBasic = lc[0]?.pushed_to_basic || 0
  progress.masteredCnt = lc[0]?.mastered_cnt || 0
  progress.stillNew = lc[0]?.still_new || 0
  return progress
}

/**
 * 按学科分组诊断：每科取 TOP5 薄弱知识点
 * @param {Array} knowledgeDiagnosis - [{subject, tag, wrongCount, totalCount, accuracy}]
 * @param {Object} subjectAccuracyMap - { 学科: 整体正确率 }
 * @returns {Array} [{ subject, accuracy, topTags:[{tag,wrongCount,totalCount,ratio,masteryLabel}] }]
 */
function buildSubjectDiagnosis(knowledgeDiagnosis, subjectAccuracyMap) {
  const bySubject = {}
  for (const kp of knowledgeDiagnosis) {
    const subj = kp.subject || '其他'
    if (!bySubject[subj]) bySubject[subj] = []
    bySubject[subj].push(kp)
  }

  return Object.keys(bySubject).map(subject => {
    const tags = bySubject[subject]
    // 本科总错误次数（用于计算占比）
    const totalWrong = tags.reduce((sum, t) => sum + t.wrongCount, 0)
    const topTags = tags
      .slice()
      .sort((a, b) => b.wrongCount - a.wrongCount || b.totalCount - a.totalCount)
      .slice(0, 5)
      .map(t => ({
        tag: t.tag,
        wrongCount: t.wrongCount,
        totalCount: t.totalCount,
        accuracy: t.accuracy,
        ratio: totalWrong > 0 ? Math.round((t.wrongCount / totalWrong) * 100) : 0,
        masteryLabel: masteryLabelFor(t.accuracy)
      }))
    return {
      subject,
      accuracy: subjectAccuracyMap[subject] ?? null,
      topTags
    }
  }).sort((a, b) => {
    // 有整体正确率的学科在前，正确率低的（更需关注）在前
    const wrongA = a.topTags.reduce((s, t) => s + t.wrongCount, 0)
    const wrongB = b.topTags.reduce((s, t) => s + t.wrongCount, 0)
    return wrongB - wrongA
  })
}

/**
 * 掌握标签：按知识点正确率分档
 */
function masteryLabelFor(accuracy) {
  if (accuracy >= 80) return '需巩固'   // 掌握较好，巩固即可
  if (accuracy >= 50) return '需关注'   // 中等，需关注
  return '待加强'                        // 薄弱，重点加强
}

/**
 * 补全本周 7 天趋势，缺失日 accuracy=null
 * @param {Array} trendRows - [{day:'MM-DD', total, correct}]
 * @param {Date} periodStart - 周一
 * @returns {Array} [{ date:'MM-DD', accuracy:number|null, count:number }]
 */
function buildDailyTrend(trendRows, periodStart) {
  const map = {}
  for (const r of trendRows) {
    map[r.day] = {
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : null,
      count: r.total
    }
  }

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(periodStart)
    d.setDate(periodStart.getDate() + i)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${mm}-${dd}`
    days.push({
      date: key,
      accuracy: map[key] ? map[key].accuracy : null,
      count: map[key] ? map[key].count : 0
    })
  }
  return days
}

export default router