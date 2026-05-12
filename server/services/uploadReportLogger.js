const uploadReports = new Map()

export const createUploadReport = (studentId, uploadSummary, boundingBoxResults = []) => {
  const report = {
    id: `report-${studentId}-${Date.now()}`,
    studentId,
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: uploadSummary.totalFiles,
      successfulUploads: uploadSummary.successCount,
      failedUploads: uploadSummary.failedCount,
      autoFixed: uploadSummary.fixedCount,
      requiresManualIntervention: uploadSummary.manualInterventionCount,
    },
    files: [],
    boundingBoxStatus: {
      total: boundingBoxResults.length,
      generated: boundingBoxResults.filter((b) => b.status === 'generated').length,
      skipped: boundingBoxResults.filter((b) => b.status === 'skipped').length,
      failed: boundingBoxResults.filter((b) => b.status === 'failed').length,
      details: boundingBoxResults,
    },
  }

  for (const result of uploadSummary.results) {
    const fileEntry = {
      filename: result.filename,
      uploadStatus: result.success ? 'Success' : 'Failed',
      errorType: result.errorType || null,
      errorMessage: result.error || null,
      uploadUrl: result.url,
      wasAutoFixed: result.fixed,
      attemptCount: result.attempts.length,
      totalDurationMs: result.totalDurationMs,
      attempts: result.attempts.map((a) => ({
        type: a.type,
        attempt: a.attempt,
        result: a.result,
        error: a.error || null,
        durationMs: a.durationMs || null,
        timestamp: a.timestamp,
      })),
      boundingBoxStatus: null,
    }

    const bboxResult = boundingBoxResults.find((b) => b.filename === result.filename)
    if (bboxResult) {
      fileEntry.boundingBoxStatus = bboxResult.status
    }

    report.files.push(fileEntry)
  }

  uploadReports.set(report.id, report)
  return report
}

export const formatReportConsole = (report) => {
  const lines = []
  const sep = '='.repeat(60)

  lines.push('')
  lines.push(sep)
  lines.push('📊 上传流程报告')
  lines.push(sep)
  lines.push(`报告ID: ${report.id}`)
  lines.push(`学生ID: ${report.studentId}`)
  lines.push(`时间: ${report.timestamp}`)
  lines.push('')
  lines.push('── 汇总 ──')
  lines.push(`  总文件数:             ${report.summary.totalFiles}`)
  lines.push(`  成功上传:             ${report.summary.successfulUploads}`)
  lines.push(`  上传失败:             ${report.summary.failedUploads}`)
  lines.push(`  自动修复:             ${report.summary.autoFixed}`)
  lines.push(`  需人工干预:           ${report.summary.requiresManualIntervention}`)
  lines.push('')
  lines.push('── 边界框生成状态 ──')
  lines.push(`  总计:                 ${report.boundingBoxStatus.total}`)
  lines.push(`  已生成:               ${report.boundingBoxStatus.generated}`)
  lines.push(`  已跳过:               ${report.boundingBoxStatus.skipped}`)
  lines.push(`  生成失败:             ${report.boundingBoxStatus.failed}`)
  lines.push('')
  lines.push('── 文件详情 ──')

  for (const file of report.files) {
    lines.push('')
    lines.push(`  📄 ${file.filename}`)
    lines.push(`     上传状态:    ${file.uploadStatus}`)
    if (file.errorType) {
      lines.push(`     错误类型:    ${file.errorType}`)
      lines.push(`     错误信息:    ${file.errorMessage}`)
    }
    if (file.uploadUrl) {
      lines.push(`     OSS URL:     ${file.uploadUrl.substring(0, 80)}...`)
    }
    lines.push(`     自动修复:    ${file.wasAutoFixed ? '是' : '否'}`)
    lines.push(`     尝试次数:    ${file.attemptCount}`)
    lines.push(`     总耗时:      ${file.totalDurationMs}ms`)
    if (file.boundingBoxStatus) {
      lines.push(`     边界框:      ${file.boundingBoxStatus}`)
    }

    for (const attempt of file.attempts) {
      lines.push(
        `       [${attempt.type}] #${attempt.attempt || '—'} → ${attempt.result}${attempt.error ? ` (${attempt.error})` : ''}`
      )
    }
  }

  lines.push('')
  lines.push(sep)
  return lines.join('\n')
}

export const logUploadReport = (report) => {
  const formatted = formatReportConsole(report)
  console.log(formatted)
  return report
}

export const getUploadReport = (reportId) => {
  return uploadReports.get(reportId) || null
}

export const getAllUploadReports = () => {
  return Array.from(uploadReports.values())
}

export const getReportsByStudent = (studentId) => {
  return Array.from(uploadReports.values()).filter((r) => r.studentId === studentId)
}

export const clearUploadReports = () => {
  uploadReports.clear()
}
