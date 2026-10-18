/**
 * dashboardCaliberKit.mjs —— Dashboard summary SQL 口径判据（唯一实现，r301 修订）
 *
 * 背景（本 kit 守护的事故，2026-10-09 负责人拍板修复，见 test/dashboardCaliber.test.mjs 头注）：
 *   ① getDailyTrend 两条 SQL 必须 `::date::text AS day`（pg date 反序列化成 JS Date
 *      会让「近 7 日趋势」序列恒 0）；
 *   ② today_new_wrong 必须按上海自然日、不限 lifecycle（对齐周报口径）；
 *   ③ summary 查询占位符与参数数组必须对齐（pg bind 报错级）。
 *
 * ⛔ r301（2026-10-18）为什么从「精确字面量正则」改判「锚点切片 + 结构不变量」：
 *   10-17 22:05 并行会话 `88f11b4`（停课收口 P0/P1，已推送部署）给 6 处铃铛聚合加了
 *   `LEFT JOIN students + COALESCE(s.enrollment_status,'active') != 'paused'`，
 *   today_new_wrong / in_progress_count 两个子查询文本变长，超出旧判据 240 字符窗口
 *   ⇒ 旧正则三条判据全部失配（npm test 2536/2539，红在 HEAD 非 WIP）。
 *   逐条语义核对：上海自然日两处 cast、无 CURRENT_DATE、无 lifecycle_status、
 *   $3 占位与三参数组全部原样保留 ⇒ 定性为**锁过期（假红）**，按 r160/r214/r289
 *   先例修锁。停课生过滤是合法的产品新形态，本 kit 容忍它；三条历史事故形态
 *   （CURRENT_DATE / lifecycle 过滤 / 占位符错位）仍逐条判红（反向自检见探针实录）。
 *
 * 用法：测试与反向自检探针都 import 本文件，保证「锁的判据」只有一份。
 */

/** 切出 today_new_wrong 子查询全文（COUNT 锚点 → 'AS today_new_wrong'）。
 *  返回 null = 连锚点都没了（那正是要报警的结构性改动）。 */
export function extractTodayNewWrongSubquery(src) {
  const anchor = 'COALESCE((SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS}'
  const start = src.indexOf(anchor)
  if (start === -1) return null
  const end = src.indexOf('AS today_new_wrong', start)
  if (end === -1) return null
  return src.slice(start, end)
}

/** 切出 in_progress_count 子查询所在片段（'AS in_progress_count' 前 480 字符，
 *  容忍 JOIN / 停课过滤带来的增行；480 覆盖现行单行子查询约 250 字符）。 */
export function extractInProgressSegment(src) {
  const end = src.indexOf('AS in_progress_count')
  if (end === -1) return null
  return src.slice(Math.max(0, end - 480), end)
}

/** 审计 today_new_wrong 口径。字段均为布尔判据，测试与探针共用。 */
export function auditTodayNewWrong(src) {
  const sub = extractTodayNewWrongSubquery(src)
  return {
    subqueryFound: sub !== null,
    shanghaiNaturalDay:
      sub !== null &&
      sub.includes("(added_at AT TIME ZONE 'Asia/Shanghai')::date") &&
      sub.includes("(NOW() AT TIME ZONE 'Asia/Shanghai')::date"),
    usesCurrentDate: sub !== null && sub.includes('CURRENT_DATE'),
    filtersLifecycle: sub !== null && sub.includes('lifecycle_status'),
  }
}

/** 审计 summary 查询的占位符/参数对齐。 */
export function auditSummaryParams(src) {
  const seg = extractInProgressSegment(src)
  const from = src.indexOf('AS in_progress_count')
  const after = from === -1 ? '' : src.slice(from)
  // 参数数组形态：[TASK_STATUS.DONE, 'failed', TASK_STATUS.PROCESSING]
  // 容忍空白/换行（prettier 重排不该误红）；'new' 残留会被整段捕获后点名。
  const m = after.match(/\[\s*TASK_STATUS\.DONE\s*,[\s\S]*?\]/)
  return {
    segmentFound: seg !== null,
    usesDollar3: seg !== null && seg.includes('t.status = $3'),
    paramsFound: m !== null,
    paramsText: m ? m[0].replace(/\s+/g, ' ') : null,
    paramsHasNew: m !== null && m[0].includes("'new'"),
    paramsHasProcessing: m !== null && m[0].includes('TASK_STATUS.PROCESSING'),
  }
}
