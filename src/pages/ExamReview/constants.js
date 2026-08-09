// ── 复审面板样式常量 ──
export const COLORS = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  background: 'var(--primary-mist)',
  card: 'var(--bg-elevated)',
  text: 'var(--text)',
  textSecondary: 'var(--text-secondary)',
  border: 'var(--border-light)'
}

// ── 面板边界常量 ──
export const PANEL_MIN_HEIGHT = 220
export const PANEL_TOP_MARGIN = 60
export const PANEL_START_OFFSET = typeof window !== 'undefined' ? window.innerHeight - 80 : 600
