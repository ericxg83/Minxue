import { getWorksheetById, getWorksheetAnswers } from './neonService.js'

// Publish gate: uncertain worksheet mappings must not become grading sources.
export const getWorksheetPublishRisk = async (id) => {
  const worksheet = await getWorksheetById(id)
  if (!worksheet) return null

  const answers = await getWorksheetAnswers(id)
  const warning = String(worksheet.parse_warning || '')
  const issues = []

  if (worksheet.parse_status !== 'done') {
    issues.push(`答案解析尚未完成（当前状态：${worksheet.parse_status || '未开始'}）`)
  }
  if (!answers.length) issues.push('没有可发布的答案')
  if (/题号连续性异常|OCR识别失败|仅识别了前|未能解析出任何答案|置信度偏低|无法匹配到所属练习单元|解析异常/.test(warning)) {
    issues.push(warning.replace(/\s+/g, ' ').trim())
  }

  const unitKeys = new Set(answers.map(a => a.unit_key).filter(Boolean))
  const ungroupedCount = answers.filter(a => !a.unit_key).length
  if (unitKeys.size > 1 && ungroupedCount > 0) {
    issues.push(`有 ${ungroupedCount} 条答案未归属单元，且本册包含 ${unitKeys.size} 个单元`)
  }

  const sections = new Set(answers.map(a => `${a.unit_key || ''}|${a.section || ''}`))
  const blocking = issues.length > 0
  return {
    can_publish: !blocking,
    blocking,
    issues: [...new Set(issues)],
    stats: {
      answer_count: answers.length,
      unit_count: unitKeys.size,
      section_count: sections.size,
      ungrouped_count: ungroupedCount,
      sub_answer_count: answers.filter(a => a.sub_no != null && String(a.sub_no) !== '').length,
    },
  }
}
