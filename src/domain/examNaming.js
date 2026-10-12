import dayjs from 'dayjs'

// 组卷命名：科目 + 日期 + 当天序号。
// 序号必须基于「拉全量后的列表」计算——空列表会让每次组卷都算出 -01，
// 实测曾让一名学生同名 -01 堆了 15 份，无法区分。
export const buildExamBaseName = (questions = []) => {
  const subjects = [...new Set(questions.map(q => q.subject || q.question?.subject).filter(Boolean))]
  const date = dayjs().format('MMDD')
  if (subjects.length === 0) return `错题重练-${date}`
  if (subjects.length <= 2) return `${subjects.join('')}-${date}`
  return `综合-${date}`
}

export const buildExamNameWithSeq = (baseName, existingExams = [], studentId) => {
  const count = countSameBaseToday(baseName, existingExams, studentId)
  return `${baseName}-${String(count + 1).padStart(2, '0')}`
}

/**
 * 统计该学生今日已创建的同名卷数量（P12 同名去重提醒用）。
 * 与 buildExamNameWithSeq 共享同一口径：同学号 + 当天 + 去 -NN 前缀相等。
 * 调用方在组卷前用它检测「今日已有 N 份同名卷」，>0 时弹确认提示老师。
 */
export const countSameBaseToday = (baseName, existingExams = [], studentId) => {
  const today = dayjs().format('YYYY-MM-DD')
  return (existingExams || []).filter(exam => {
    if (studentId && exam.student_id !== studentId) return false
    const createdDay = exam.created_at ? dayjs(exam.created_at).format('YYYY-MM-DD') : null
    if (createdDay !== today) return false
    return (exam.name || '').replace(/-\d{2}$/, '') === baseName
  }).length
}
