/**
 * 夜间自动补解析服务（程序内定时器版）
 *
 * 目标：练习册答案库解析是一次性工作，但受视觉模型「账号×模型×自然日」配额限制，
 * 白天经常跑不完。本服务随后端启动注册每日定时器，在配额重置后的低峰期
 * 自动扫描未解析完的练习册并重跑，直到全部解析干净——无需任何人工干预。
 *
 * 设计为程序内定时（而非 Windows 计划任务 / cron），随代码仓库走，
 * 推到 GitHub 后任何环境 `node index.js` 即自动生效。
 *
 * 安全设计（防止把好数据刷成坏数据）：
 *  1. 起跑前先用一张真实测试图探测配额，所有 Key×模型组合都耗尽则今晚直接放弃
 *  2. 每本书重跑前把现有 answers/units/解析状态快照到 *_night_backup 表
 *  3. 重跑后失败页比例 > 10% 判定为坏结果，自动回滚快照，留给下一晚再试
 *  4. 单本书最多自动重试 5 晚（scripts/night-parse-state.json 计数），超限后不再动它并高声报错
 *
 * 环境变量：
 *  - NIGHT_PARSE_ENABLED：设为 '0' / 'false' 关闭（默认开启）
 *  - NIGHT_PARSE_TIME：每日触发时刻，默认 '01:23'（本地时区）
 */
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { query, transaction } from '../config/neon.js'
import { callVisionCompletion } from '../config/ai.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MAX_ATTEMPTS = 5           // 单本书最多自动重试晚数
const MAX_BOOKS_PER_NIGHT = 3    // 每晚最多处理几本（控配额）
const FAIL_RATIO_ROLLBACK = 0.1  // 失败页占比超过 10% 即回滚

const STATE_FILE = join(__dirname, '../scripts/night-parse-state.json')
const LOG_DIR = join(__dirname, '../scripts/logs')
const LOG_FILE = join(LOG_DIR, 'night-parse.log')

function log(...a) {
  const line = `[夜间补解析 ${new Date().toISOString()}] ${a.join(' ')}`
  console.log(line)
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, line + '\n')
  } catch { /* 日志写盘失败不影响主流程 */ }
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

/** 配额探测：真实图片走完整 provider 链。全部耗尽会抛错。 */
async function probeQuota() {
  const sharp = (await import('sharp')).default
  const buf = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
  const { content } = await callVisionCompletion({
    imageDataURL: 'data:image/png;base64,' + buf.toString('base64'),
    systemPrompt: '你是图片识别助手',
    userText: '这张图片是什么颜色？一个词回答',
    maxTokens: 512,
  })
  return Boolean(content)
}

/** 从 parse_warning 中提取失败页数（"第 1、2、8 页 OCR 识别失败..."） */
function countFailedPages(warning) {
  const m = String(warning || '').match(/第\s*([\d、,，\s]+)\s*页\s*OCR\s*识别失败/)
  if (!m) return 0
  return m[1].split(/[、,，\s]+/).filter(Boolean).length
}

async function snapshot(resourceId) {
  await transaction(async (c) => {
    await c.query(`CREATE TABLE IF NOT EXISTS resource_answers_night_backup AS SELECT * FROM resource_answers WHERE false`)
    await c.query(`CREATE TABLE IF NOT EXISTS resource_units_night_backup AS SELECT * FROM resource_units WHERE false`)
    await c.query(`DELETE FROM resource_answers_night_backup WHERE resource_id = $1`, [resourceId])
    await c.query(`DELETE FROM resource_units_night_backup WHERE resource_id = $1`, [resourceId])
    await c.query(`INSERT INTO resource_units_night_backup SELECT * FROM resource_units WHERE resource_id = $1`, [resourceId])
    await c.query(`INSERT INTO resource_answers_night_backup SELECT * FROM resource_answers WHERE resource_id = $1`, [resourceId])
  })
  const { rows: [meta] } = await query(
    `SELECT parse_status, parse_count, parse_warning, parse_error FROM resources WHERE id = $1`, [resourceId])
  return meta
}

async function rollback(resourceId, meta) {
  await transaction(async (c) => {
    await c.query(`DELETE FROM resource_answers WHERE resource_id = $1`, [resourceId])
    await c.query(`DELETE FROM resource_units WHERE resource_id = $1`, [resourceId])
    await c.query(`INSERT INTO resource_units SELECT * FROM resource_units_night_backup WHERE resource_id = $1`, [resourceId])
    await c.query(`INSERT INTO resource_answers SELECT * FROM resource_answers_night_backup WHERE resource_id = $1`, [resourceId])
    await c.query(
      `UPDATE resources SET parse_status = $2, parse_count = $3, parse_warning = $4, parse_error = $5 WHERE id = $1`,
      [resourceId, meta?.parse_status || 'done', meta?.parse_count || 0, meta?.parse_warning || null, meta?.parse_error || null])
  })
}

let _running = false

/**
 * 执行一轮夜间补解析。可被定时器调用，也可被 CLI（scripts/night-parse-runner.js）手动调用。
 * @param {{ dryRun?: boolean }} opts
 */
export async function runNightParse({ dryRun = false } = {}) {
  if (_running) { log('上一轮仍在进行，跳过本次触发'); return }
  _running = true
  try {
    log(dryRun ? '启动（演练模式，不写库）' : '启动')

    // 1. 找出需要补解析的练习册：解析失败的，或成功但留有失败页警告的
    const { rows: candidates } = await query(`
      SELECT id, name, parse_status, parse_warning
      FROM resources
      WHERE pdf_url IS NOT NULL
        AND (parse_status = 'failed' OR (parse_warning IS NOT NULL AND parse_warning LIKE '%OCR 识别失败%'))
      ORDER BY updated_at ASC
    `)

    if (!candidates.length) { log('没有需要补解析的练习册，退出'); return }
    log(`发现 ${candidates.length} 本待补解析：`, candidates.map(c => `${c.name}(${c.parse_status})`).join('；'))

    const state = loadState()
    const todo = candidates.filter(c => {
      if (c.parse_status === 'parsing') { log(`跳过 ${c.name}：正在解析中`); return false }
      const attempts = state[c.id]?.attempts || 0
      if (attempts >= MAX_ATTEMPTS) {
        log(`⛔ ${c.name} 已自动重试 ${attempts} 晚仍未解析干净，停止自动重试，请人工检查！`)
        return false
      }
      return true
    }).slice(0, MAX_BOOKS_PER_NIGHT)

    if (!todo.length) { log('无可处理条目，退出'); return }
    if (dryRun) { log('演练模式：将处理', todo.map(c => c.name).join('；')); return }

    // 2. 配额探测
    try {
      await probeQuota()
      log('配额探测通过，开始补解析')
    } catch (e) {
      log('配额探测失败（今日配额可能已耗尽），今晚放弃，明晚再试:', e.message)
      return
    }

    // 延迟到探测通过后再 import（worksheets.js 依赖较重，且避免模块循环引用）
    const { doParseOcrBatched } = await import('../routes/worksheets.js')
    const { updateWorksheetParseStatus } = await import('./neonService.js')
    const { getPdfPageCount } = await import('./pdfService.js')

    let anyFailure = false
    for (const book of todo) {
      log(`===== 开始处理：${book.name} (${book.id}) =====`)
      state[book.id] = { name: book.name, attempts: (state[book.id]?.attempts || 0) + 1, lastRun: new Date().toISOString() }
      saveState(state)

      const meta = await snapshot(book.id)
      log('已快照现有数据')

      try {
        const { rows: [w] } = await query(`SELECT pdf_url FROM resources WHERE id = $1`, [book.id])
        const buf = Buffer.from(await (await fetch(w.pdf_url)).arrayBuffer())
        const totalPages = await getPdfPageCount(buf)
        log(`PDF ${(buf.length / 1024 / 1024).toFixed(1)} MB，共 ${totalPages} 页`)

        await updateWorksheetParseStatus(book.id, { status: 'parsing' })
        await doParseOcrBatched(book.id, buf, totalPages, null)

        const { rows: [after] } = await query(`SELECT parse_warning, parse_count FROM resources WHERE id = $1`, [book.id])
        const failed = countFailedPages(after?.parse_warning)
        const ratio = totalPages ? failed / totalPages : 0

        if (ratio > FAIL_RATIO_ROLLBACK) {
          log(`❌ 失败页 ${failed}/${totalPages}（${(ratio * 100).toFixed(0)}%）超过阈值，回滚快照，明晚再试`)
          await rollback(book.id, meta)
          anyFailure = true
        } else if (failed > 0) {
          log(`⚠️ 完成但有 ${failed} 页失败（${(ratio * 100).toFixed(0)}%），保留本次结果，明晚自动补跑失败页`)
        } else {
          log(`✅ ${book.name} 解析干净完成，共 ${after?.parse_count || '?'} 条答案`)
          delete state[book.id]
          saveState(state)
        }
      } catch (e) {
        log(`❌ ${book.name} 解析异常：${e.message}，回滚快照`)
        await rollback(book.id, meta).catch(err => log('回滚失败（人工检查！）:', err.message))
        anyFailure = true
        // 配额中途耗尽：后面的书也没必要跑了
        if (/配额|quota/i.test(e.message)) { log('配额已耗尽，今晚剩余任务放弃'); break }
      }
    }

    log('本轮结束', anyFailure ? '（有失败项，明晚自动重试）' : '')
  } finally {
    _running = false
  }
}

/** 计算距离下一次 HH:mm（本地时区）还有多少毫秒 */
function msUntilNext(timeStr) {
  const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/)
  const hour = m ? parseInt(m[1], 10) : 1
  const minute = m ? parseInt(m[2], 10) : 23
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next - now
}

/**
 * 注册每日定时器（在 index.js 启动时调用一次）。
 * 用 setTimeout 链而非 setInterval：每次触发后重新计算下一次时刻，不怕时钟漂移/休眠。
 */
export function scheduleNightParse() {
  const enabled = !/^(0|false|off)$/i.test(String(process.env.NIGHT_PARSE_ENABLED || ''))
  if (!enabled) {
    console.log('🌙 夜间自动补解析：已通过 NIGHT_PARSE_ENABLED 关闭')
    return
  }
  const timeStr = process.env.NIGHT_PARSE_TIME || '01:23'

  const arm = () => {
    const delay = msUntilNext(timeStr)
    const timer = setTimeout(async () => {
      try {
        await runNightParse()
      } catch (e) {
        log('本轮异常退出:', e.message)
      }
      arm() // 跑完再排下一天
    }, delay)
    timer.unref?.() // 不阻止进程正常退出
    console.log(`🌙 夜间自动补解析：下一次将在 ${new Date(Date.now() + delay).toLocaleString('zh-CN')} 触发（每日 ${timeStr}）`)
  }
  arm()
}

// ============================================================
// 周维度错因诊断（新增于「教学备课建议」功能）
//
// 动机：老师周一打开学习诊断时，本周错题应已有 error_type / error_reason。
// 复用 diagnosisService.runErrorDiagnosis 现有回填能力，仅加调度触发。
//
// 设计：
//  - 时间：每周一 02:00（环境变量 WEEKLY_DIAGNOSIS_TIME，默认 '02:00'；WEEKLY_DIAGNOSIS_DAY=1 表示周一）
//  - 与夜间补解析（每日 01:23）错开 37 分钟，不撞配额
//  - 单实例锁：_weeklyDiagnosisRunning，防止同批重复跑
//  - 失败隔离：try/catch 包住，单点失败不影响其他夜间步骤
// ============================================================

let _weeklyDiagnosisRunning = false

/**
 * 执行一轮周维度错因诊断。可被定时器调用，也可被外部手动调用。
 * @param {{ trigger?: string }} opts
 */
export async function runWeeklyDiagnosis({ trigger = 'weekly-scheduler' } = {}) {
  if (_weeklyDiagnosisRunning) {
    log(`[WeeklyDiagnosis] (${trigger}) 上一轮仍在进行，跳过本次触发`)
    return { skipped: true }
  }
  _weeklyDiagnosisRunning = true
  try {
    log(`[WeeklyDiagnosis] (${trigger}) 启动`)
    const { runErrorDiagnosis } = await import('./diagnosisService.js')
    const result = await runErrorDiagnosis({ limit: 200, trigger: 'weekly' })
    log(`[WeeklyDiagnosis] (${trigger}) 完成 total=${result.total} blank=${result.blank} updated=${result.updated} skipped=${result.skipped}`)
    return result
  } catch (e) {
    log(`[WeeklyDiagnosis] (${trigger}) 异常退出: ${e.message}`)
    throw e
  } finally {
    _weeklyDiagnosisRunning = false
  }
}

/**
 * 计算距离下一次「周X HH:mm」（本地时区）还有多少毫秒。
 * @param {number} targetDay 0=周日, 1=周一, ..., 6=周六
 * @param {string} timeStr 'HH:mm'
 */
function msUntilNextWeekday(targetDay, timeStr) {
  const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/)
  const hour = m ? parseInt(m[1], 10) : 2
  const minute = m ? parseInt(m[2], 10) : 0
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  let diffDay = (targetDay - now.getDay() + 7) % 7
  if (diffDay === 0 && next <= now) diffDay = 7 // 今天已过
  next.setDate(next.getDate() + diffDay)
  return next - now
}

/**
 * 注册周维度错因诊断定时器（在 index.js 启动时调用一次）。
 * 与 scheduleNightParse 并存，互不影响。
 */
export function scheduleWeeklyDiagnosis() {
  const enabled = !/^(0|false|off)$/i.test(String(process.env.WEEKLY_DIAGNOSIS_ENABLED || ''))
  if (!enabled) {
    console.log('🗓️ 周维度错因诊断：已通过 WEEKLY_DIAGNOSIS_ENABLED 关闭')
    return
  }
  const timeStr = process.env.WEEKLY_DIAGNOSIS_TIME || '02:00'
  const targetDay = parseInt(process.env.WEEKLY_DIAGNOSIS_DAY || '1', 10) // 1=周一

  const arm = () => {
    const delay = msUntilNextWeekday(targetDay, timeStr)
    const timer = setTimeout(async () => {
      try {
        await runWeeklyDiagnosis()
      } catch (e) {
        log(`[WeeklyDiagnosis] 本轮异常退出: ${e.message}`)
      }
      arm() // 跑完再排下周
    }, delay)
    timer.unref?.()
    const dayLabel = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][targetDay]
    console.log(`🗓️ 周维度错因诊断：下一次将在 ${new Date(Date.now() + delay).toLocaleString('zh-CN')} 触发（每${dayLabel} ${timeStr}）`)
  }
  arm()
}
