import { getWorksheetById, getWorksheetAnswers } from './neonService.js'
import { buildAnswerCoverage } from './answerCoverageService.js'

// ── 练习册答案解析质量闸（通用规则，见 AGENTS.md「练习册答案解析质量闸」）──
// 释义：旧版 risk 的 warning 正则把 parse_warning 当字符串匹配，主版本升级后
// parse_warning 已改为结构化 JSONB {code, message, seqAnomalies:[...]}，旧正则
// 永远匹配不上 → 风险评估对「结构化 seq 异常」永远静默。本函数同时兼容两种
// warning 形态，并对 seq 异常用「解析层原生的 kind/reason/message」逐条展示。
// 导出供回归测试引用：测试要断言「备用视觉模型页」告警文案**不得命中本正则**
// （命中即 blocking → 发布被 409 拦下）。见 test/worksheetBackupModelWarning.test.mjs。
export const RISK_WARNING_RE = /题号连续性异常|OCR识别失败|仅识别了前|未能解析出任何答案|置信度偏低|无法匹配到所属练习单元|解析异常/
// 「备用视觉模型页」标记（2026-09-21）：落在 parse_warning 里的稳定短语，见
// server/routes/worksheets.js → buildBackupModelWarning。**只进 notices，绝不进 issues**。
const BACKUP_MODEL_NOTICE_RE = /备用视觉模型/
const parseWarningPayload = (raw) => {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object') return obj
    } catch { /* 非 JSON，按纯文本处理 */ }
  }
  return { code: null, message: s, seqAnomalies: [] }
}

// seq 异常（解析层原生信号）直接转为 issues；正则仅兜底纯文本旧 warning
export const getWorksheetPublishRisk = async (id) => {
  const worksheet = await getWorksheetById(id)
  if (!worksheet) return null

  const answers = await getWorksheetAnswers(id)
  const parsed = parseWarningPayload(worksheet.parse_warning)
  const message = String(parsed?.message || '')
  const seqAnomalies = Array.isArray(parsed?.seqAnomalies) ? parsed.seqAnomalies : []
  const issues = []

  if (worksheet.parse_status !== 'done') {
    issues.push(`答案解析尚未完成（当前状态：${worksheet.parse_status || '未开始'}）`)
  }
  if (!answers.length) issues.push('没有可发布的答案')
  // seq 异常用解析层原生的 reason/message 逐条展示（reverse/reset/gap），不做二次概括
  for (const a of seqAnomalies.slice(0, 20)) {
    if (a && a.message) issues.push(String(a.message))
  }
  if (seqAnomalies.length > 20) {
    issues.push(`另有 ${seqAnomalies.length - 20} 处题号连续性异常未列出`)
  }
  if (RISK_WARNING_RE.test(message)) {
    issues.push(message.replace(/\s+/g, ' ').trim())
  }

  const unitKeys = new Set(answers.map(a => a.unit_key).filter(Boolean))
  const ungroupedCount = answers.filter(a => !a.unit_key).length
  if (unitKeys.size > 1 && ungroupedCount > 0) {
    issues.push(`有 ${ungroupedCount} 条答案未归属单元，且本册包含 ${unitKeys.size} 个单元`)
  }

  // ── notices：**非阻断**提示 ──
  // 「备用视觉模型页」只说明这几页的可信度低于主力模型（需老师看一眼），
  // 不像题号连续性异常那样必然意味着答案张冠李戴 ⇒ 不构成拒绝发布的理由。
  // 这里只进 notices、不进 issues；上游 buildBackupModelWarning 的文案也被刻意设计为
  // 不命中 RISK_WARNING_RE。两道保证共同避免"提示复核"被升级成"挡住发布"。
  const notices = []
  for (const seg of String(message).split(/[\n；;]+/)) {
    if (BACKUP_MODEL_NOTICE_RE.test(seg)) {
      const line = seg.replace(/\s+/g, ' ').trim()
      if (line) notices.push(line)
    }
  }

  // ── 答案册完整性体检（2026-09-22）──
  // 「某单元缺题号 N、M」意味着这些题**批改时必然拿不到参考答案**（转人工）。
  // 但它不构成拒绝发布的理由：RefGuard 会兜底留空转人工，绝不会写错答案；
  // 而答案册缺口往往是"老师手上那本答案册本来就只印到第几题"，阻断发布会冻结正常流程。
  // 因此只进 notices，让老师在审核页看到"哪里缺、去补哪几题"。
  const coverage = buildAnswerCoverage(answers)
  for (const m of coverage.messages.slice(0, 12)) notices.push(`答案册可能缺答案：${m}`)
  if (coverage.messages.length > 12) {
    notices.push(`答案册另有 ${coverage.messages.length - 12} 处缺口未列出`)
  }

  const sections = new Set(answers.map(a => `${a.unit_key || ''}|${a.section || ''}`))
  const blocking = issues.length > 0
  return {
    can_publish: !blocking,
    blocking,
    issues: [...new Set(issues)],
    notices: [...new Set(notices)],
    stats: {
      answer_count: answers.length,
      unit_count: unitKeys.size,
      section_count: sections.size,
      ungrouped_count: ungroupedCount,
      sub_answer_count: answers.filter(a => a.sub_no != null && String(a.sub_no) !== '').length,
      // 答案册完整性（2026-09-22）：units_with_gaps>0 表示有单元缺题号 → 那些题批改时会缺参考答案
      coverage: coverage.summary,
    },
  }
}
