import { AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react'
import MathText from '../../components/MathText'
import { COLORS } from './constants'

const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  return /^[A-Da-d][.、)\)]\s/.test(String(opt).trim())
}

export const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return <MathText content={opt} />
  return <>{String.fromCharCode(65 + index)}. <MathText content={opt} /></>
}

export const getStatusInfo = (q) => {
  if (!q) {
    return {
      bg: 'var(--bg-secondary)', color: COLORS.textSecondary,
      text: '未知', icon: AlertTriangle,
      isGreyed: false, source: 'unknown'
    }
  }

  // 1. 已排除
  if (q.excluded) {
    return {
      bg: 'var(--bg-secondary)', color: COLORS.textSecondary,
      text: '已排除', icon: XCircle,
      isGreyed: true, source: 'excluded'
    }
  }

  const confidence = q.confidence != null ? q.confidence : 0

  // 2. 紫灰：处理中 — AI任务尚未完成（confidence=0，无 student_answer，非 blank）
  if (confidence === 0 && !q.student_answer && q.answer_source !== 'blank') {
    return {
      bg: 'var(--border-light)', color: 'var(--text-secondary)',
      text: '处理中', icon: Clock,
      isGreyed: true, source: 'processing'
    }
  }

  // 3. 橙色：AI异常 — OCR失败 / 未作答 / 数据缺失
  if (q.answer_source === 'blank' || q.is_correct === null) {
    return {
      bg: 'var(--warning-soft)', color: 'var(--warning)',
      text: q.answer_source === 'blank' ? '未作答' : 'AI异常',
      icon: AlertTriangle,
      isGreyed: false, source: 'error'
    }
  }

  // 4. AI 高置信度（>= 90%）— 绿色正确 / 红色错误
  if (confidence >= 0.9) {
    if (q.is_correct === true) {
      return {
        bg: 'var(--success-soft)', color: COLORS.success,
        text: 'AI正确', icon: CheckCircle2,
        isGreyed: false, source: 'ai_correct'
      }
    }
    if (q.is_correct === false) {
      return {
        bg: 'var(--danger-soft)', color: COLORS.danger,
        text: 'AI错误', icon: XCircle,
        isGreyed: false, source: 'ai_wrong'
      }
    }
  }

  // 5. 黄色：AI不确定 — 置信度不足，需人工复核
  return {
    bg: 'var(--warning-soft)', color: COLORS.warning,
    text: '待人工复核', icon: Clock,
    isGreyed: false, source: 'uncertain'
  }
}

// 圆点颜色映射
export const DOT_COLORS = {
  ai_correct: COLORS.success,
  ai_wrong: COLORS.danger,
  uncertain: COLORS.warning,
  error: 'var(--warning)',
  processing: 'var(--text-secondary)',
  excluded: 'var(--text-secondary)',
  unknown: 'var(--text-secondary)'
}

// 统计标签组件
export const StatChip = ({ label, count, color, bg }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: '3px',
    padding: '2px 8px', borderRadius: 'var(--radius-sm)',
    background: bg, color, fontSize: 'var(--fs-11)', fontWeight: 600,
    whiteSpace: 'nowrap'
  }}>
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: 'var(--radius-full)',
      background: color
    }} />
    {label} {count}
  </div>
)
