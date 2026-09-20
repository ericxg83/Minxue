import { getTaskQueue, getGeometryQueue } from './queue.js'
import { query, TABLES } from './config/neon.js'

const PENDING_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

// 几何重建重试延迟（与服务端 handleRetry 保持一致）
const GEOMETRY_RETRY_DELAYS = [
  5 * 60 * 1000,   // 第 1 次失败 → 5 分钟
  30 * 60 * 1000,  // 第 2 次失败 → 30 分钟
  2 * 60 * 60 * 1000 // 第 3 次失败 → 2 小时
]
const GEOMETRY_MAX_RETRIES = GEOMETRY_RETRY_DELAYS.length

// ── 自动重试黑名单：以下 last_error 子串出现时，任务不应被 PendingTaskRecovery 反复入队 ──
//
// 错误按是否"自愈"分类：
//   1. 配额 / 限流：自愈取决于外部服务（明早重置 / 限流解除），与重试次数无关。
//      ⚠️ 2026-09-20 起从本名单拆出：配额/限流类自愈有明确时间点（自然日重置），
//      单独归入 QUOTA_ERROR_PATTERNS，由 scanFailedTasks 做「跨自然日自动放行」——
//      当天拦截防烧配额，次日扫描时配额已重置，自动重新入队（本次事故：
//      09/18 魔搭配额用尽的任务若不人工点重试会永久卡「识别异常」）。
//   2. 图片下载失败：⚠️ 已拆分为两类，见下方 TRANSIENT_ERROR_PATTERNS。
//   3. 用户输入类：缺少 worksheetId、URL 无效、文件未上传完成等，本身就是数据问题。
//   4. 图片质量：太小（<1KB）/ 0 道题 —— 学生拍的就是空白页/模糊页，重复 OCR 不会变好，
//      反复入队只会反复下载 → 调 AI → 0 道题 → 浪费配额 + 触发限流 429 风暴。
//
// 命中黑名单 → 直接跳过，不恢复、不入队，让任务停留在 failed 状态等待人工/数据修复。
export const NON_RETRYABLE_ERROR_PATTERNS = [
  /返回内容不是图片/,
  /URL.*失效/,
  /OSS.*错误页/,
  /缺少 worksheetId/,
  /所有图片URL无效/,
  /文件上传未成功完成/,
  /UPLOAD_NOT_COMPLETED/,
  /INVALID_URL/,
  /AI returned empty content/i,
  /Invalid model id/i, // 模型被供应商下架（如 Qwen3-8B-Instruct），不会自愈
  /图片分辨率过低/,        // 下载层拦截的极小图（< 600px 任意一边），客观不可识别，重试无意义
  // ⚠️ 不要把"页识别失败 / 所有页面识别结果为空 / AI_EMPTY / 图片是空白"加进黑名单！
  //   AI 视觉模型（尤其 Qwen3-VL-8B-Instruct）在配额紧张时**不稳定**：
  //   同样的高清图 + prompt，可能一次说"图片是空白"，下一次就完整 OCR 出 15+ 道题
  //   （实测：同一 worksheet 1c31ee45 的 taskId 4f4ac1cc(失败 1 页识别失败；AI 提示: 图片是空白)
  //           → 9016b0aa(成功 15/15 题，标题"试卷④ 19.2 实数 提高性测试")）。
  //   误进黑名单会导致**本来能成功的任务被永久放弃**，必须靠 PendingTaskRecovery 重新入队。
]

// ── 配额 / 限流类错误（2026-09-20 新增独立分类）────────────────────────────
// 性质：自愈有明确时间点 —— 视觉模型配额按**自然日**重置、限流随外部负载解除。
// 与永久黑名单的区别：这类错误**第二天自动放行重试**，不需要人工介入。
// 与瞬时错误（TRANSIENT_ERROR_PATTERNS）的区别：瞬时错误分钟级自愈、且发生在
// 下载阶段（不烧配额），所以当天内就给 5 次额度；配额类发生在 AI 调用阶段
// （烧配额），**当天只给 0 次**（拦截），跨自然日后再放行 —— 烧配额与自愈时间点
// 两者兼顾。
export const QUOTA_ERROR_PATTERNS = [
  /所有魔搭视觉模型.*配额.*用尽/,
  /所有视觉模型.*不可用/,
  /所有视觉模型.*失败/,
  /quota.*exhaust/i,
  /rate limit/i,
  /rate_limit/i,
  /429/,
]

// 判断 last_error 是否命中配额/限流类模式（供 scanFailedTasks 做跨日放行）
export function isQuotaError(msg) {
  const text = String(msg || '').trim()
  return QUOTA_ERROR_PATTERNS.some(pat => pat.test(text))
}

// 跨自然日判断：配额按自然日重置，失败时刻已是「今天之前」即放行。
// ⚠️ 用 UTC 日期（库内时间戳均为 UTC），与 SQL 侧 DATE_TRUNC('day', NOW()) 口径一致。
export function isBeforeTodayUtc(date) {
  if (!date) return false
  const d = new Date(date)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getUTCFullYear() < now.getUTCFullYear()
    || (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() < now.getUTCMonth())
    || (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() < now.getUTCDate())
}

// ── 瞬时可自愈错误：允许有限次自动重试（与上面的永久黑名单互斥）──
//
// 设计依据：这类错误发生在流程早期（Step 2/6 下载图片，progress=5），
// **尚未调用任何 AI 模型**，重试代价 = 一次 HTTP GET，不消耗配额、不会触发 429。
// 因此给比 MAX_AUTO_RETRIES(3) 更宽松的额度，让 OSS / 网络抖动能自愈。
export const TRANSIENT_ERROR_PATTERNS = [
  /下载图片失败/,                  // 内层原因已由永久黑名单先行排除（分辨率过低 / 非图片内容）
  /status code \d{3}/i,            // OSS / 网关返回的 4xx、5xx 抖动
  /timeout of \d+ms exceeded/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket hang up/,
  /network error/i,
  /ENOTFOUND/,
  /EAI_AGAIN/,
  /getaddrinfo/i
]

// 瞬时错误自动重试上限：5 次（AI 类错误仍是 3 次，避免烧配额）
export const MAX_TRANSIENT_RETRIES = 5
// 冷却：上次失败后至少间隔 5 分钟才再入队，避免 5 分钟扫描周期内反复入队刷日志
export const TRANSIENT_RETRY_COOLDOWN_MS = 5 * 60 * 1000

/**
 * 判断 last_error 是否命中"不应自动重试"黑名单。
 * 返回 { skip, kind, reason }：
 *   kind='permanent' → 永久不可恢复，放弃重试（skip=true）
 *   kind='transient' → 瞬时可自愈，允许有限次重试（skip=false）
 *   kind='quota'     → 配额/限流，**当天拦截**（skip=true），跨自然日后由
 *                      scanFailedTasks 自动放行重试（配额按自然日重置）
 *   kind='none'      → 未命中任何名单，走常规重试逻辑（skip=false）
 *
 * ⚠️ 先判永久、再判瞬时：下载失败的客观子类（"图片分辨率过低"、"返回内容不是图片"）
 *    会同时带上"下载图片失败"前缀，必须让永久黑名单优先命中。
 */
export function classifyLastError(lastError) {
  const msg = String(lastError || '').trim()
  if (!msg) return { skip: false, kind: 'none' } // 没有错误信息时放行（保守处理）

  if (isQuotaError(msg)) {
    // 配额/限流：当天拦截防烧配额；跨自然日后由 scanFailedTasks 自动放行重试。
    return { skip: true, kind: 'quota', reason: '配额/限流类错误（跨自然日自动放行）' }
  }

  for (const pat of NON_RETRYABLE_ERROR_PATTERNS) {
    if (pat.test(msg)) {
      return { skip: true, kind: 'permanent', reason: `命中非重试黑名单 (${pat})` }
    }
  }

  for (const pat of TRANSIENT_ERROR_PATTERNS) {
    if (pat.test(msg)) {
      return { skip: false, kind: 'transient', reason: `瞬时可自愈错误 (${pat})` }
    }
  }

  return { skip: false, kind: 'none' }
}

class PendingTaskRecovery {
  constructor() {
    this.scanInterval = null
    this.scanIntervalMs = parseInt(process.env.PENDING_TASK_SCAN_INTERVAL) || 5 * 60 * 1000 // 5 minutes
    this.isRunning = false
  }

  start() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
    }

    console.log(`[PendingTaskRecovery] 已启动 (扫描间隔: ${this.scanIntervalMs / 1000 / 60}分钟)`)

    this.scanInterval = setInterval(async () => {
      if (this.isRunning) return // Prevent overlapping scans
      await this.scanAndRecover()
    }, this.scanIntervalMs)

    // Run initial scan after 30 seconds
    setTimeout(() => this.scanAndRecover(), 30000)
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
      this.scanInterval = null
      console.log('[PendingTaskRecovery] 已停止')
    }
  }

  async scanAndRecover() {
    this.isRunning = true

    try {
      // ── 全局熔断：视觉模型配额耗尽时，所有需要 AI 的任务恢复都是徒劳的 ──
      // 配额按自然日计，一旦耗尽当天不会恢复。
      // 检查最近 5 分钟是否有任务因配额耗尽失败 → 有则跳过所有 AI 任务恢复，
      // 仅运行不依赖 AI 的扫描（如练习册解析卡死重置）。
      const quotaExhausted = await this.isVisionQuotaExhausted()
      if (quotaExhausted) {
        console.warn('[PendingTaskRecovery] 🚫 全局熔断：视觉模型配额耗尽，跳过 AI 任务恢复（仅运行非 AI 扫描）')
        await Promise.allSettled([
          this.scanStuckWorksheetParsing()
        ])
        return
      }

      // ⚡ 并行执行 5 个独立扫描，替代串行
      await Promise.allSettled([
        this.scanPendingTasks(),
        this.scanFailedTasks(),
        this.scanProcessingStuck(),
        this.scanGeometryAssets(),
        this.scanOverdueGeometry(),
        this.scanStuckWorksheetParsing()
      ])
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 扫描失败:', err)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 全局熔断检查：最近 5 分钟是否有任务因"视觉模型配额耗尽"失败。
   * 配额按自然日计，一旦耗尽当天不会恢复，此时恢复任务只是徒劳地
   * 下载图片 → 调 AI → 失败 → 写 DB → 下次扫描再恢复，形成死循环。
   *
   * 命中条件：status=failed AND last_error 包含配额耗尽关键词 AND updated_at > 5 分钟前
   */
  async isVisionQuotaExhausted() {
    try {
      const { rows } = await query(
        `SELECT 1 FROM ${TABLES.TASKS}
         WHERE status = 'failed'
           AND (
             last_error ILIKE '%配额%用尽%'
             OR last_error ILIKE '%视觉模型%不可用%'
             OR last_error ILIKE '%所有视觉模型%失败%'
           )
           AND updated_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        []
      )
      return rows.length > 0
    } catch {
      // 查询失败时保守放行（不熔断），避免 DB 抖动导致恢复完全停止
      return false
    }
  }

  /**
   * 扫描 failed 主任务并自动重试（此前任务系统只恢复 pending）。
   * 限制：同一任务最多自动重试 MAX_AUTO_RETRIES 次（含 worker 内部 + 此处），
   * 超出后保持 failed，避免对注定失败的图片无限重试。
   *
   * AI 偶发拒绝话术（"图片是空白" / "Unable to identify"）放宽到 MAX_AI_REFUSAL_RETRIES=10：
   *   8B 配额紧张时同样图一次"图片是空白"、下一次成功 OCR 15+ 道题；
   *   不应该被 MAX_AUTO_RETRIES=3 永久卡死。但完全不限会浪费配额在真的空白图上，
   *   10 次 ≈ 50 分钟足够。
   */
  isAIRefusalLikely = (lastError) => {
    if (!lastError) return false
    return /图片是空白|图片为空白|无法识别|无法看到|Unable to identify|Cannot identify|no text detected|cannot see|看不清|页面内容为空|用户提供的图片是空|所有页面识别结果为空|页识别失败|OCR 未识别到任何题目|AI_EMPTY|很抱歉|抱歉[，,]|对不起|由于您提供的|I'm sorry|I am sorry|I cannot|unable to process/i.test(String(lastError))
  }

  async scanFailedTasks() {
    try {
      const MAX_AUTO_RETRIES = 3
      const MAX_AI_REFUSAL_RETRIES = 10  // AI 偶发拒绝任务放宽上限
      console.log('[PendingTaskRecovery]  开始扫描 failed 任务...')

      // ── 双轨扫描 ──
      //   1) 常规任务：retry_count < MAX_AUTO_RETRIES
      //   2) AI 偶发拒绝 / 输出格式异常任务：retry_count < MAX_AI_REFUSAL_RETRIES
      // 两者都是「换个模型或换一次就好」的模型个体行为，不该被 3 次卡死。
      // 用条件 OR + ILIKE 让 DB 利用 idx_tasks_status 索引，避免全表扫描。
      //
      // ⚠️ 本列表比 isAIRefusalLikely 的正则多一项 'JSON 格式错误'，是有意的：
      //   拒绝话术类 → 命中 isAIRefusalLikely，retry_count 重置为 0（额度实际无上限）；
      //   JSON 格式错误 → 不重置，止步于 MAX_AI_REFUSAL_RETRIES=10。
      //   因为 recognizeQuestions 内部每次已自带一次换模型重试，10 次 = 试过 20 次模型组合，
      //   仍失败说明不是模型抽风，无限重试只会烧配额。
      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, created_at, updated_at, result, retry_count, last_error,
                task_type, worksheet_id, generated_exam_id, subject, resource_id
         FROM ${TABLES.TASKS}
         WHERE status = 'failed'
           AND created_at > NOW() - INTERVAL '7 days'
           AND (
             COALESCE(retry_count, 0) < $1
             OR (
                  (last_error ILIKE '%图片是空白%'
                   OR last_error ILIKE '%图片为空白%'
                   OR last_error ILIKE '%Unable to identify%'
                   OR last_error ILIKE '%no text detected%'
                   OR last_error ILIKE '%cannot identify%'
                   OR last_error ILIKE '%很抱歉%'
                   OR last_error ILIKE '%对不起%'
                   OR last_error ILIKE '%由于您提供的%'
                   OR last_error ILIKE '%JSON 格式错误%')
                  AND COALESCE(retry_count, 0) < $2
                )
             -- ③ 瞬时下载/网络错误（OSS 400/5xx、超时）：重试成本只是一次 HTTP GET，
             --    给比常规 3 次更宽松的额度让它自愈；客观子类由 classifyLastError 再过滤。
             OR (
                  last_error ILIKE '%下载图片失败%'
                  AND COALESCE(retry_count, 0) < $3
                )
             -- ④ 配额/限流（2026-09-20）：上次失败已是**今天之前**（跨自然日）→ 配额已重置，
             --    即使 retry_count 已撞 MAX_AUTO_RETRIES 也重新捞出来自动重试。
             --    当天失败的任务不捞（classifyLastError 兜底拦截），防烧配额。
             OR (
                  (last_error ILIKE '%配额%用尽%'
                   OR last_error ILIKE '%视觉模型%不可用%'
                   OR last_error ILIKE '%所有视觉模型%失败%'
                   OR last_error ILIKE '%quota%exhaust%'
                   OR last_error ILIKE '%rate limit%'
                   OR last_error ILIKE '%rate_limit%'
                   OR last_error ILIKE '%429%')
                  AND updated_at < DATE_TRUNC('day', NOW())
                )
           )
         ORDER BY updated_at ASC`,
        [MAX_AUTO_RETRIES, MAX_AI_REFUSAL_RETRIES, MAX_TRANSIENT_RETRIES]
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有可自动重试的 failed 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个可自动重试的 failed 任务:`)
      rows.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.original_name} (retry_count=${t.retry_count || 0}, ${String(t.last_error || '').substring(0, 60)})`)
      })

      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      // 去重：已在队列中的任务不再重复入队。
      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      let skippedCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️ ${task.original_name} 已在队列中`)
            continue
          }

          // ── 黑白名单：配额耗尽 / 限流 / 图片失效 / 数据错误 → 拒绝重试 ──
          // ⚠️ 2026-09-20 特例：配额/限流类（kind='quota'）当天拦截，但失败时刻
          //   已是今天之前（跨自然日）→ 配额按自然日已重置，自动放行重试，
          //   不再需要人工点「重新处理」。与应付费场景的既有语义一致：
          //   「配额用尽就是等明天」，现在让系统自己等。
          const verdict = classifyLastError(task.last_error)
          const quotaCrossedDay = verdict.kind === 'quota'
            && isBeforeTodayUtc(task.updated_at || task.created_at)
          if (verdict.skip && !quotaCrossedDay) {
            console.log(`[PendingTaskRecovery] 🚫 跳过 ${task.original_name}: ${verdict.reason}; last_error="${String(task.last_error || '').substring(0, 80)}"`)
            skippedCount++
            continue
          }
          if (quotaCrossedDay) {
            console.log(`[PendingTaskRecovery] 🌅 配额跨日自动放行: ${task.original_name} (失败于 ${new Date(task.updated_at || task.created_at).toISOString()}, 今日配额已重置)`)
          }

          // ── 瞬时错误冷却：距上次失败不足 TRANSIENT_RETRY_COOLDOWN_MS 则本轮不重试 ──
          //   目的：扫描每 5 分钟一次，不加冷却会让刚失败的任务被立刻重新入队，
          //   OSS 抖动还没恢复就又失败，retry_count 被白白耗尽。
          if (verdict.kind === 'transient') {
            const sinceMs = Date.now() - new Date(task.updated_at || task.created_at).getTime()
            if (sinceMs < TRANSIENT_RETRY_COOLDOWN_MS) {
              console.log(`[PendingTaskRecovery] ⏳ 冷却中，跳过 ${task.original_name}: ${verdict.reason}; 距上次失败 ${Math.round(sinceMs / 1000)}s < ${TRANSIENT_RETRY_COOLDOWN_MS / 1000}s`)
              skippedCount++
              continue
            }
          }

          // ── AI 偶发拒绝：重置 retry_count=0，让这次"重试"算作第 1 次 ──
          //   8B 配额紧张时同样图可能一次"图片是空白"、一次成功 OCR 15+ 道题，
          //   不应该被 MAX_AUTO_RETRIES=3 卡死。给它们无限重试机会，
          //   直到要么成功，要么用户主动取消/重新上传。
          // 配额跨日放行同理：配额按自然日重置，重试次数也应从头算（resetRetry=true 一并清零）。
          const isAIRefusal = this.isAIRefusalLikely(task.last_error)
          const baseRetry = (isAIRefusal || quotaCrossedDay) ? 0 : (task.retry_count || 0)
          await query(
            `UPDATE ${TABLES.TASKS}
             SET status = 'pending',
                 last_error = NULL,
                 retry_count = CASE WHEN $2 THEN 0 ELSE retry_count END,
                 updated_at = NOW()
             WHERE id = $1`,
            [task.id, isAIRefusal || quotaCrossedDay]
          )
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            resourceId: task.resource_id || task.worksheet_id || null,
            subject: task.subject || null,
            retryCount: baseRetry + 1
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })
          console.log(`[PendingTaskRecovery] ✅ 已恢复 failed 任务: ${task.original_name} (retry ${task.retry_count || 0}→${baseRetry + 1}${isAIRefusal ? ', AI 拒绝重置' : ''}${quotaCrossedDay ? ', 配额跨日重置' : ''})`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }
      console.log(`[PendingTaskRecovery] ✅ failed 任务恢复完成: ${recoveredCount}/${rows.length}（跳过 ${skippedCount}）`)
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ failed 任务扫描失败:', err)
    }
  }

  /**
   * 扫描 stuck processing 任务：started_at 距今超过 PROCESSING_TIMEOUT_MS 仍未结束
   * （worker 崩溃 / 锁超时未回填），重置为 pending 重新入队。
   *
   * 这是 BullMQ 自身 stalled 回收之外的第二道保险：只处理【已不在队列里】的 processing 孤儿
   * （in-flight 命中队列的会被跳过，不会和在跑的 job 抢），started_at 是首次进 PROCESSING 时
   * 写一次、之后不刷新，所以不能用它判活。阈值取 6 分钟：略大于 lockDuration(5min)，
   * 让 BullMQ 自己先回收；单页视觉链最坏情况(3min 超时 + 退避)也远小于 6min 且有 in-flight 闸门兜底，
   * 不会误伤正在跑的活 job。历史默认 30min 与 lockDuration 叠加，导致发版孤儿要卡满 ~30min。
   */
  async scanProcessingStuck() {
    try {
      const PROCESSING_TIMEOUT_MS = parseInt(process.env.TASK_PROCESSING_TIMEOUT_MS) || 6 * 60 * 1000 // 6 min
      const MAX_AUTO_RETRIES = 3
      console.log('[PendingTaskRecovery]  开始扫描 stuck processing 任务...')

      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, started_at, retry_count,
                task_type, worksheet_id, generated_exam_id, subject, resource_id, last_error
         FROM ${TABLES.TASKS}
         WHERE status = 'processing'
           AND COALESCE(retry_count, 0) < $1
           AND (started_at IS NULL OR started_at < NOW() - INTERVAL '${PROCESSING_TIMEOUT_MS / 1000 / 60} minutes')
         ORDER BY started_at ASC NULLS FIRST`,
        [MAX_AUTO_RETRIES]
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有 stuck processing 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个 stuck processing 任务`)

      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      let skippedCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️ ${task.original_name} 已在队列中`)
            continue
          }

          // ── 黑白名单：stuck 前 last_error 已知为配额/限流/图片错误 → 拒绝恢复 ──
          const verdict = classifyLastError(task.last_error)
          if (verdict.skip) {
            console.log(`[PendingTaskRecovery] 🚫 跳过 stuck ${task.original_name}: ${verdict.reason}; last_error="${String(task.last_error || '').substring(0, 80)}"`)
            skippedCount++
            continue
          }

          await query(
            `UPDATE ${TABLES.TASKS} SET status = 'pending', updated_at = NOW() WHERE id = $1`,
            [task.id]
          )
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            resourceId: task.resource_id || task.worksheet_id || null,
            subject: task.subject || null,
            retryCount: (task.retry_count || 0) + 1
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })
          console.log(`[PendingTaskRecovery] ✅ 已恢复 stuck processing 任务: ${task.original_name}`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }
      console.log(`[PendingTaskRecovery] ✅ stuck processing 恢复完成: ${recoveredCount}/${rows.length}（跳过 ${skippedCount}）`)
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ stuck processing 扫描失败:', err)
    }
  }

  /**
   * 扫描超时的 pending 主任务并重新入队
   */
  async scanPendingTasks() {
    try {
      console.log('[PendingTaskRecovery]  开始扫描超时 pending 任务...')

      // Find tasks that have been pending for too long
      const { rows } = await query(
        `SELECT id, student_id, image_url, images, original_name, status, created_at, result,
                task_type, worksheet_id, generated_exam_id, subject, resource_id
         FROM ${TABLES.TASKS}
         WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '${PENDING_TIMEOUT_MS / 1000 / 60} minutes'
         ORDER BY created_at ASC`,
        []
      )

      if (rows.length === 0) {
        console.log('[PendingTaskRecovery] ✅ 没有超时 pending 任务')
        return
      }

      console.log(`[PendingTaskRecovery] 📋 找到 ${rows.length} 个超时任务:`)
      rows.forEach((task, i) => {
        const pendingMinutes = Math.round((Date.now() - new Date(task.created_at).getTime()) / 60000)
        console.log(`   ${i + 1}. ${task.original_name} (已等待 ${pendingMinutes} 分钟)`)
      })

      // Reuse the shared queue connection instead of creating a fresh Queue per scan.
      const queue = await getTaskQueue()
      if (!queue) {
        console.error('[PendingTaskRecovery] ❌ 队列不可用，跳过恢复')
        return
      }

      // Single Redis call to fetch all in-flight jobs (was one getJobs() per task = N+1).
      const inFlightJobs = await queue.getJobs(['waiting', 'active', 'delayed'])
      const inFlightTaskIds = new Set(inFlightJobs.map(j => j.data?.taskId).filter(Boolean))

      let recoveredCount = 0
      for (const task of rows) {
        try {
          if (inFlightTaskIds.has(task.id)) {
            console.log(`[PendingTaskRecovery] ⏭️  ${task.original_name} 已在队列中`)
            continue
          }

          // Add task back to queue
          const retryCount = (task.result?.retryCount || 0) + 1
          await queue.add('process-task', {
            taskId: task.id,
            studentId: task.student_id,
            imageUrl: task.image_url,
            images: task.images || null,
            originalName: task.original_name,
            // 路由字段必须随恢复 job 带全，否则 workbook/错题重练任务会被静默降级为完整 AI 管线
            taskType: task.task_type || 'general',
            worksheetId: task.worksheet_id || null,
            generatedExamId: task.generated_exam_id || null,
            resourceId: task.resource_id || task.worksheet_id || null,
            subject: task.subject || null,
            retryCount,
            recovered: true
          }, {
            attempts: parseInt(process.env.MAX_RETRIES) || 3,
            backoff: { type: 'exponential', delay: 5000 }
          })

          console.log(`[PendingTaskRecovery] ✅ 已恢复: ${task.original_name}`)
          recoveredCount++
        } catch (err) {
          console.error(`[PendingTaskRecovery]  恢复失败 ${task.original_name}:`, err.message)
        }
      }

      console.log(`[PendingTaskRecovery] ✅ 恢复完成: ${recoveredCount}/${rows.length} 个任务`)
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ pending 任务扫描失败:', err)
    }
  }

  /**
   * 扫描卡死的练习册解析：parse_status='parsing' 但 updated_at 超过 15 分钟。
   * 练习册解析在路由进程内后台执行，10 分钟超时兜底也是内存态的——服务器重启/OOM
   * 后状态会永远停在 'parsing'：前端轮询无限转圈，重新上传被 409 拒绝。
   * 此处兜底重置为 failed 并写明原因，让用户可以重新上传。
   */
  async scanStuckWorksheetParsing() {
    try {
      const STUCK_MINUTES = parseInt(process.env.WORKSHEET_PARSING_TIMEOUT_MINUTES) || 15
      const { rows } = await query(
        `UPDATE ${TABLES.WORKSHEETS}
         SET parse_status = 'failed',
             parse_error = '解析进程中断（服务器重启或内存不足），请重新上传'
         WHERE parse_status = 'parsing'
           AND updated_at < NOW() - INTERVAL '${STUCK_MINUTES} minutes'
         RETURNING id, name`,
        []
      )
      if (rows.length > 0) {
        rows.forEach(w => {
          console.log(`[PendingTaskRecovery] ⚠️ 练习册解析卡死，已重置为 failed: ${w.name} (${w.id})`)
        })
      }
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 练习册解析扫描失败:', err)
    }
  }

  /**
   * 扫描 geometry 重建资产：
   *   1. failed 状态且 retry_count < MAX_RETRIES → 按时间表重新入队
   *   2. pending 状态超过 30 分钟 → 重新入队（防止 Worker 漏掉）
   */
  async scanGeometryAssets() {
    try {
      const geometryQueue = await getGeometryQueue()
      if (!geometryQueue) {
        console.log('[PendingTaskRecovery] ⏭️  geometry 队列不可用，跳过')
        return
      }

      // ── 1. 扫描需要重试的 failed 资产 ──
      // 包含 retry_count=0 的资产：旧代码路径（早期版本 handleRetry 未递增 retry_count
      // 或绕开 handleRetry 直接写库）会让资产停在 failed/0，这批卡住 3+ 天的资产永远
      // 不会被重试。统一当作"第 1 次重试"对待，按 GEOMETRY_RETRY_DELAYS[0]=5min 兜底。
      // 真正"未尝试"的资产 tikz_status 还是 pending，不会被这条 SQL 命中。
      const { rows: failedRows } = await query(
        `SELECT a.id, a.question_id, a.retry_count, a.updated_at, a.last_error
         FROM ${TABLES.QUESTION_ASSETS} a
         WHERE a.asset_type = 'geometry_image'
           AND a.tikz_status = 'failed'
           AND a.retry_count < $1
         ORDER BY a.updated_at ASC`,
        [GEOMETRY_MAX_RETRIES]
      )

      if (failedRows.length > 0) {
        const now = Date.now()
        let retryCount = 0
        for (const asset of failedRows) {
          const retries = asset.retry_count || 0
          // retry_count=0 时用 GEOMETRY_RETRY_DELAYS[0]=5min，否则按 retries-1 索引
          const delayIdx = retries === 0 ? 0 : Math.min(retries - 1, GEOMETRY_RETRY_DELAYS.length - 1)
          const delay = GEOMETRY_RETRY_DELAYS[delayIdx]
          const elapsed = now - new Date(asset.updated_at).getTime()
          if (elapsed >= delay) {
            // 重试时间已到 → 重新入队
            try {
              await geometryQueue.add('reconstruct', {
                assetId: asset.id,
                retryCount: retries + 1
              }, {
                attempts: 1
              })
              // 重置为 pending 状态
              await query(
                `UPDATE ${TABLES.QUESTION_ASSETS}
                 SET tikz_status = 'pending', updated_at = NOW()
                 WHERE id = $1`,
                [asset.id]
              )
              console.log(`[PendingTaskRecovery] ✅ 几何资产重试: ${asset.question_id?.substring(0, 8)} (第 ${retries + 1} 次重试)`)
              retryCount++
            } catch (err) {
              console.error(`[PendingTaskRecovery]  几何重试失败 ${asset.id?.substring(0, 8)}:`, err.message)
            }
          }
        }
        if (retryCount > 0) {
          console.log(`[PendingTaskRecovery] ✅ 几何资产重试: ${retryCount}/${failedRows.length} 个`)
        }
      }

      // ── 2. 扫描超时的 pending 资产（30 分钟以上未处理） ──
      const { rows: stalePending } = await query(
        `SELECT a.id, a.question_id, a.created_at
         FROM ${TABLES.QUESTION_ASSETS} a
         WHERE a.asset_type = 'geometry_image'
           AND a.tikz_status = 'pending'
           AND a.created_at < NOW() - INTERVAL '30 minutes'
         ORDER BY a.created_at ASC
         LIMIT 20`
      )

      if (stalePending.length > 0) {
        console.log(`[PendingTaskRecovery] 📋 发现 ${stalePending.length} 个超时未处理的几何资产`)
        for (const asset of stalePending) {
          try {
            await geometryQueue.add('reconstruct', {
              assetId: asset.id
            }, { attempts: 1 })
            console.log(`[PendingTaskRecovery] ✅ 重新入队: ${asset.question_id?.substring(0, 8)}`)
          } catch (err) {
            console.error(`[PendingTaskRecovery]  入队失败 ${asset.id?.substring(0, 8)}:`, err.message)
          }
        }
      }
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 几何资产扫描失败:', err)
    }
  }

  /**
   * 24h watchdog：扫描仍未收尾的几何资产,做长期兜底。
   *
   * 业务约束：上传后 24h 内任何题都必须有结论(completed / none),否则视为 bug。
   * 此扫描覆盖 scanGeometryAssets 漏掉的两类死角:
   *   1. pending/processing 卡死超过 24h（worker 进程被 SIGTERM / 队列假死 / Redis 断连）:
   *      强制重置为 pending + 重新入队,给最后一次翻身机会。
   *   2. failed 且 retry_count>=3 超过 24h:人工复核不会来,直接标 none 让前端回退裁剪原图。
   */
  async scanOverdueGeometry() {
    try {
      const geometryQueue = await getGeometryQueue()
      if (!geometryQueue) {
        console.log('[PendingTaskRecovery] ⏭️  geometry 队列不可用,跳过 24h watchdog')
        return
      }
      const OVERDUE_HOURS = parseInt(process.env.GEOMETRY_OVERDUE_HOURS) || 24
      const { rows } = await query(
        `SELECT id, question_id, tikz_status, retry_count,
                EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_sec
         FROM ${TABLES.QUESTION_ASSETS}
         WHERE asset_type = 'geometry_image'
           AND created_at < NOW() - ($1 || ' hours')::interval
           AND (
             tikz_status IN ('pending','processing')
             OR (tikz_status = 'failed' AND COALESCE(retry_count, 0) >= $2)
           )
         ORDER BY created_at ASC
         LIMIT 50`,
        [OVERDUE_HOURS, GEOMETRY_MAX_RETRIES]
      )

      let reEnqueued = 0
      let abandoned = 0
      for (const a of rows) {
        const ageH = Math.round(a.age_sec / 3600)
        try {
          if (a.tikz_status === 'failed') {
            // 24h+ 且已重试 3 次:放弃 Vision,前端回退裁剪原图
            await query(
              `UPDATE ${TABLES.QUESTION_ASSETS}
               SET tikz_status = 'none',
                   last_error = COALESCE(last_error, '') ||
                                ' [24h watchdog] 已超过 24h 且重试 >= ' || $1 || ' 次,放弃 Vision 回退原图'
               WHERE id = $2`,
              [GEOMETRY_MAX_RETRIES, a.id]
            )
            console.warn(`[PendingTaskRecovery] 🛑 24h watchdog 回退原图: ${a.question_id?.substring(0, 8)} (age=${ageH}h, retries=${a.retry_count})`)
            abandoned++
          } else {
            // pending/processing 卡死 24h+:重置状态 + 重新入队
            await query(
              `UPDATE ${TABLES.QUESTION_ASSETS}
               SET tikz_status = 'pending', processed_at = NULL
               WHERE id = $1`,
              [a.id]
            )
            await geometryQueue.add('reconstruct', { assetId: a.id }, { attempts: 1 })
            console.warn(`[PendingTaskRecovery] ⏰ 24h watchdog 强制入队: ${a.question_id?.substring(0, 8)} (age=${ageH}h, prev=${a.tikz_status})`)
            reEnqueued++
          }
        } catch (err) {
          console.error(`[PendingTaskRecovery]  24h watchdog 处理失败 ${a.id?.substring(0, 8)}:`, err.message)
        }
      }
      if (rows.length > 0) {
        console.log(`[PendingTaskRecovery] 🐕 24h watchdog 完成: 入队 ${reEnqueued}, 回退原图 ${abandoned}`)
      }
    } catch (err) {
      console.error('[PendingTaskRecovery] ❌ 24h watchdog 扫描失败:', err.message)
    }
  }
}

export const pendingTaskRecovery = new PendingTaskRecovery()
