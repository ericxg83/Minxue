import { getTeachingDiagnosis, getTeachingDiagnosisDetail } from '../services/apiService'
import { generatePaperWord } from './docxGenerator'
import { buildHandoutPaper } from './teachingHandoutCore'

/**
 * 生成教学讲义 docx
 * @param {Object} opts - { mode, offset, subject, periodText, maxItems, onProgress }
 */
export async function generateTeachingHandout(opts = {}) {
  const {
    mode = 'week',
    offset = 0,
    subject = '',
    periodText = '',
    maxItems = 12,
    onProgress
  } = opts

  const data = await getTeachingDiagnosis({ mode, offset, subject })
  if (!data.success || !data.diagnosis?.length) {
    throw new Error('该时段暂无共性错题，无法生成讲义')
  }
  const diagnosis = data.diagnosis

  const details = {}
  const top = diagnosis.slice(0, maxItems)
  for (let i = 0; i < top.length; i++) {
    const t = top[i]
    onProgress?.(`正在整理「${t.tag}」...`, i + 1, top.length)
    const d = await getTeachingDiagnosisDetail(t.tag, { mode, offset })
    if (d.success) details[t.tag] = d
  }

  const paper = buildHandoutPaper({ diagnosis, details, periodText, maxItems })
  return generatePaperWord(paper)
}

/**
 * 生成并下载教学讲义 docx
 */
export async function downloadTeachingHandout(opts = {}) {
  const blob = await generateTeachingHandout(opts)
  const { saveAs } = await import('file-saver')
  const suffix = (opts.periodText || '').replace(/[\\/:*?"<>|]/g, '_')
  saveAs(blob, `周学习诊断教学讲义_${suffix || '本周'}_${new Date().toISOString().slice(0, 10)}.docx`)
  return blob
}
