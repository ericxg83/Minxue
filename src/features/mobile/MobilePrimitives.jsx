import { ChevronRight } from 'lucide-react'

export const MOBILE_TOKENS = {
  pageX: 'px-4',
  pageY: 'pt-5 pb-6',
  title: 'text-[24px] leading-[1.2] font-semibold tracking-[-0.04em]',
  eyebrow: 'text-[12px] leading-5 font-medium',
  description: 'text-[13px] leading-5',
  sectionTitle: 'text-[16px] leading-[1.4] font-semibold',
  meta: 'text-[12px] leading-[1.5]',
}

export function MobilePage({ children, className = '', ...props }) {
  return <div className={`mobile-page mx-auto w-full max-w-lg ${MOBILE_TOKENS.pageX} ${MOBILE_TOKENS.pageY} ${className}`} {...props}>{children}</div>
}

export function MobilePageHeader({ eyebrow, title, description, action }) {
  return (
    <header className="mobile-page-header mb-4 flex items-start justify-between">
      <div className="min-w-0">
        {eyebrow && <p className={`${MOBILE_TOKENS.eyebrow} mb-1 text-[var(--text-secondary)]`}>{eyebrow}</p>}
        <h1 className={MOBILE_TOKENS.title} style={{ color: 'var(--text)' }}>{title}</h1>
        {description && <p className={`${MOBILE_TOKENS.description} mt-1 text-[var(--text-secondary)]`}>{description}</p>}
      </div>
      {action || (Icon && <div className="mobile-page-header-icon flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icon size={18} /></div>)}
    </header>
  )
}

export function MobileStatGrid({ items, className = '' }) {
  return <div className={`mobile-stat-grid flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>{items.map((item) => <span key={item.label} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: item.color || 'var(--text-secondary)' }}><b className="font-semibold" style={{ color: item.valueColor || item.color || 'var(--text)' }}>{item.value}</b>{item.label}</span>)}</div>
}

export function MobileSegmentedTabs({ items, value, onChange, ariaLabel }) {
  return <div className="mobile-segmented-tabs mb-3 flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-secondary)' }} role="tablist" aria-label={ariaLabel}>{items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)} className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium" style={{ background: value === item.id ? 'var(--bg-card)' : 'transparent', color: value === item.id ? 'var(--text)' : 'var(--text-secondary)', boxShadow: value === item.id ? 'var(--shadow-sm)' : 'none' }}>{item.label}{typeof item.count === 'number' && <span style={{ color: value === item.id ? 'var(--primary)' : 'var(--text-tertiary)' }}>{item.count}</span>}</button>)}</div>
}

export function MobileList({ children, className = '' }) {
  return <div className={`mobile-list overflow-hidden border-y ${className}`} style={{ borderColor: 'var(--border-light)' }}>{children}</div>
}

export function MobileSectionHeading({ title, description, action, onAction }) {
  return <div className="mobile-section-heading mb-2 flex items-end justify-between px-1"><div><h2 className={MOBILE_TOKENS.sectionTitle} style={{ color: 'var(--text)' }}>{title}</h2>{description && <p className={`${MOBILE_TOKENS.meta} mt-0.5`} style={{ color: 'var(--text-secondary)' }}>{description}</p>}</div>{action && <button type="button" onClick={onAction} className="inline-flex items-center gap-0.5 text-[12px] font-medium" style={{ color: 'var(--primary)' }}>{action}<ChevronRight size={14} /></button>}</div>
}
