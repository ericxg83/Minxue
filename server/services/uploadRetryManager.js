import { uploadImage } from './ossService.js'
import { validateFile, fixFileIfNeeded } from './uploadValidator.js'

const DEFAULT_MAX_RETRIES = 3
const BASE_DELAY_MS = 2000
const HTTP_AUTH_ERRORS = new Set([401, 403])
const RETRYABLE_HTTP_ERRORS = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ERR_OSS_REQUEST_TIMEOUT',
  'ConnectionTimeout',
  'RequestTimeTooSkewed',
])

export const classifyError = (error) => {
  if (!error) return { type: 'UNKNOWN', retryable: false, label: '未知错误' }

  const statusCode = error.status || error.code

  if (HTTP_AUTH_ERRORS.has(statusCode)) {
    return {
      type: 'AUTH_ERROR',
      retryable: false,
      label: `认证失败 (${statusCode})`,
      action: '检查 OSS 密钥配置',
    }
  }

  if (RETRYABLE_HTTP_ERRORS.has(statusCode)) {
    return {
      type: 'HTTP_SERVER_ERROR',
      retryable: true,
      label: `服务端错误 (${statusCode})`,
      action: '自动重试',
    }
  }

  if (error.name === 'TimeoutError' || error.code === 'ECONNABORTED') {
    return {
      type: 'TIMEOUT',
      retryable: true,
      label: '请求超时',
      action: '自动重试',
    }
  }

  if (RETRYABLE_ERROR_CODES.has(error.code)) {
    return {
      type: 'NETWORK_ERROR',
      retryable: true,
      label: `网络错误 (${error.code})`,
      action: '自动重试',
    }
  }

  if (error.message?.includes('格式') || error.message?.includes('不支持')) {
    return {
      type: 'UNSUPPORTED_FORMAT',
      retryable: false,
      label: '不支持的格式',
      action: '需要用户重新上传',
    }
  }

  if (error.message?.includes('损坏') || error.message?.includes('corrupt')) {
    return {
      type: 'CORRUPTED_FILE',
      retryable: true,
      label: '文件可能损坏',
      action: '尝试修复后重试',
    }
  }

  return {
    type: 'UNKNOWN',
    retryable: false,
    label: error.message || '未知错误',
    action: '需要人工干预',
  }
}

export const calculateBackoff = (attempt, baseDelay = BASE_DELAY_MS) => {
  const delay = baseDelay * Math.pow(2, attempt - 1)
  const jitter = Math.random() * 1000
  return Math.min(delay + jitter, 30000)
}

export const uploadWithRetry = async (fileBuffer, originalName, studentId, options = {}) => {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelay = BASE_DELAY_MS,
    onProgress,
  } = options

  const report = {
    filename: originalName || 'unknown',
    studentId,
    attempts: [],
    success: false,
    url: null,
    error: null,
    errorType: null,
    fixed: false,
    fixedAttempts: 0,
    totalDurationMs: 0,
    logs: [],
  }

  const log = (msg) => {
    report.logs.push(msg)
    console.log(`[RetryManager] ${msg}`)
  }

  const startTime = Date.now()
  log(`📤 开始上传流程: ${report.filename} (studentId=${studentId})`)

  // Step 1: Validate file before upload
  log(`[Step 1] 验证文件完整性...`)
  const validationReport = await validateFile(fileBuffer, originalName, { size: fileBuffer.length })
  report.attempts.push({
    type: 'validation',
    timestamp: new Date().toISOString(),
    result: validationReport.valid ? 'PASS' : 'FAIL',
    details: validationReport,
  })
  report.logs.push(...(validationReport.logs || []))
  onProgress?.('validation', validationReport)

  if (!validationReport.valid) {
    log(`❌ 文件验证失败: ${validationReport.error}`)

    // Try to fix the file
    log(`[Step 1.5] 尝试修复文件...`)
    const fixResult = await fixFileIfNeeded(fileBuffer, originalName)
    report.logs.push(...(fixResult.logs || []))
    report.fixed = fixResult.fixed
    report.fixedAttempts++

    if (fixResult.fixed) {
      log(`✅ 文件修复成功，使用修复后的缓冲区重新上传`)
      fileBuffer = fixResult.fixedBuffer

      const revalidation = await validateFile(fileBuffer, originalName, { size: fileBuffer.length })
      if (!revalidation.valid) {
        report.error = `文件修复后仍验证失败: ${revalidation.error}`
        report.errorType = 'CORRUPTED_FILE_UNFIXABLE'
        report.totalDurationMs = Date.now() - startTime
        return report
      }
      log(`✅ 修复后文件验证通过`)
    } else {
      report.error = validationReport.error
      report.errorType = validationReport.errorType || 'VALIDATION_FAILED'
      report.totalDurationMs = Date.now() - startTime
      return report
    }
  }

  // Step 2: Upload with retry
  let lastError = null
  let lastErrorClassification = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now()
    log(`[Step 2.${attempt}] 上传尝试 ${attempt}/${maxRetries}...`)

    try {
      const url = await uploadImage(fileBuffer, originalName, studentId)

      const attemptDuration = Date.now() - attemptStart
      log(`✅ 上传成功: ${url} (耗时 ${attemptDuration}ms)`)

      report.attempts.push({
        type: 'upload',
        attempt,
        timestamp: new Date().toISOString(),
        result: 'SUCCESS',
        url,
        durationMs: attemptDuration,
      })

      report.success = true
      report.url = url
      report.totalDurationMs = Date.now() - startTime
      return report
    } catch (err) {
      const attemptDuration = Date.now() - attemptStart
      lastError = err
      lastErrorClassification = classifyError(err)

      log(`❌ 上传失败 (尝试 ${attempt}/${maxRetries}): ${err.message}`)
      log(`   错误类型: ${lastErrorClassification.label}`)
      log(`   是否可重试: ${lastErrorClassification.retryable}`)
      log(`   建议操作: ${lastErrorClassification.action}`)

      report.attempts.push({
        type: 'upload',
        attempt,
        timestamp: new Date().toISOString(),
        result: 'FAIL',
        error: err.message,
        errorCode: err.code,
        httpStatus: err.status,
        errorClassification: lastErrorClassification,
        durationMs: attemptDuration,
      })

      // Do not retry if error is not retryable
      if (!lastErrorClassification.retryable) {
        log(`⛔ 错误不可重试，终止上传流程`)
        break
      }

      // Wait before retry (except on last attempt)
      if (attempt < maxRetries) {
        const delay = calculateBackoff(attempt, baseDelay)
        log(`⏳ 等待 ${Math.round(delay)}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  // All retries exhausted or non-retryable error
  report.error = lastError?.message || '上传失败'
  report.errorType = lastErrorClassification?.type || 'UNKNOWN'
  report.totalDurationMs = Date.now() - startTime

  log(`💥 上传流程结束: ${report.filename} — 失败 (${report.errorType})`)
  return report
}

export const uploadFilesWithRetry = async (files, studentId, options = {}) => {
  const { maxRetries = DEFAULT_MAX_RETRIES, onFileProgress } = options

  const results = []
  let successCount = 0
  let failedCount = 0
  let fixedCount = 0

  console.log(`\n[RetryManager] ========== 批量上传流程开始 ==========`)
  console.log(`  文件总数: ${files.length}`)
  console.log(`  学生ID: ${studentId}`)
  console.log(`  最大重试次数: ${maxRetries}`)

  for (const file of files) {
    const fileBuffer = file.buffer
    const originalName = file.originalname || 'unknown'

    console.log(`\n[RetryManager] --- 处理文件 ${results.length + 1}/${files.length}: ${originalName} ---`)

    const result = await uploadWithRetry(fileBuffer, originalName, studentId, {
      maxRetries,
      onProgress: (step, data) => {
        onFileProgress?.(originalName, step, data)
      },
    })

    results.push(result)

    if (result.success) {
      successCount++
      if (result.fixed) fixedCount++
    } else {
      failedCount++
    }
  }

  const summary = {
    totalFiles: files.length,
    successCount,
    failedCount,
    fixedCount,
    manualInterventionCount: failedCount,
    results,
    timestamp: new Date().toISOString(),
  }

  console.log(`\n[RetryManager] ========== 批量上传流程结束 ==========`)
  console.log(`  总计: ${summary.totalFiles} 文件`)
  console.log(`  成功: ${summary.successCount}`)
  console.log(`  失败: ${summary.failedCount}`)
  console.log(`  自动修复: ${summary.fixedCount}`)
  console.log(`  需要人工干预: ${summary.manualInterventionCount}`)

  return summary
}
