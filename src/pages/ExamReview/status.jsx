import { AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react'
import MathText from '../../components/MathText'
import { COLORS } from './constants'
import { getReviewState, getReviewStateLabel, isExcluded } from '../../utils/reviewDecision'

export const formatOption = (opt, index) => (
  <>{String.fromCharCode(65 + index)}. <MathText content={opt} /></>
)

// 复核状态的视觉映射。状态判定本身由 src/utils/reviewDecision.js 决定（与 PC 端同源），
// 这里只负责把 5 态翻译成移动端的颜色/文案/图标。
export const getStatusInfo = (q) => {
  if (!q) {
    return {
      bg: 'var(--bg-secondary)', color: COLORS.textSecondary,
      text: '未知', icon: AlertTriangle,
      isGreyed: false, source: 'unknown'
    }
  }

  // 已排除（人工复核结论，PC 端与移动端都写 review_status='exclude'）
  if (isExcluded(q)) {
    return {
      bg: 'var(--bg-secondary)', color: COLORS.textSecondary,
      text: '已排除', icon: XCircle,
      isGreyed: true, source: 'excluded'
    }
  }

  switch (getReviewState(q)) {
    case 'correct':
      return {
        bg: 'var(--success-soft)', color: COLORS.success,
        text: 'AI正确', icon: CheckCircle2,
        isGreyed: false, source: 'ai_correct'
      }
    case 'wrong':
      return {
        bg: 'var(--danger-soft)', color: COLORS.danger,
        text: 'AI错误', icon: XCircle,
        isGreyed: false, source: 'ai_wrong'
      }
    case 'exception':
      return {
        bg: 'var(--warning-soft)', color: 'var(--warning)',
        text: getReviewStateLabel(q),
        icon: AlertTriangle,
        isGreyed: false, source: 'error'
      }
    case 'processing':
      return {
        bg: 'var(--border-light)', color: 'var(--text-secondary)',
        text: '处理中', icon: Clock,
        isGreyed: true, source: 'processing'
      }
    default:
      return {
        bg: 'var(--warning-soft)', color: COLORS.warning,
        text: '待人工复核', icon: Clock,
        isGreyed: false, source: 'uncertain'
      }
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

// 统计标签组件（可点击时作为筛选入口）
export const StatChip = ({ label, count, color, bg, onClick, active = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
      background: bg, color, fontSize: 'var(--fs-11)', fontWeight: 600,
      whiteSpace: 'nowrap',
      border: active ? `1.5px solid ${color}` : '1.5px solid transparent',
      cursor: onClick ? 'pointer' : 'default'
    }}
  >
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: 'var(--radius-full)',
      background: color
    }} />
    {label} {count}
  </button>
)
