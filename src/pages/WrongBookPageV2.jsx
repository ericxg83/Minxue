import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import SwipeableRow from '../components/SwipeableRow'
import MathText from '../components/MathText'
import { MobileList, MobileSegmentedTabs } from '../features/mobile/MobilePrimitives'
import { formatQuestionLabel } from '../utils/questionStem'

// 两级掌握文案（2026-09-13 队列分层）：new 待复习 → review_1 基本掌握（周回顾验证）→ mastered 完全掌握。
// review_2 是历史残留枚举，按 review_1 语义展示。
const labels = { new: '待复习', review_1: '基本掌握', review_2: '基本掌握', mastered: '完全掌握' }
const lifecycle = i => i.lifecycle_status || i.status || 'new'
const text = i => (i.question || i).content || i.content || '题目内容暂不可用'
const qOf = i => i.question || i
// 多小问大题：列表里加「第10题(2)」小标，完整公共题干在详情弹窗里看
const subLabelOf = i => {
  const q = qOf(i)
  const subNo = q.sub_no == null ? '' : String(q.sub_no).trim()
  return subNo ? formatQuestionLabel(q.question_number, subNo) : ''
}

// 学科筛选：字段已在 wrong_questions / questions 合并结果里透传（apiService subject），
// 这里只做展示层映射，缺数据时该组 chip 自然不出现，不引入新接口。
const SUBJECT_NAMES = { math: '数学', chinese: '语文', english: '英语', physics: '物理', chemistry: '化学', biology: '生物' }
const subjectOf = i => {
  const q = qOf(i)
  const s = q.subject || i.subject
  return s ? String(s).trim() : ''
}
const subjectLabel = s => SUBJECT_NAMES[s.toLowerCase()] || s

// 日期筛选基于 added_at/created_at（列表行已在显示同源日期），纯客户端过滤。
const inDateRange = (item, range) => {
  if (range === 'all') return true
  const d = dayjs(item.added_at || item.created_at)
  if (!d.isValid()) return false
  return d.isAfter(dayjs().subtract(range === '7d' ? 7 : 30, 'day'))
}

const DATE_CHIPS = [
  { id: 'all', label: '全部时间' },
  { id: '7d', label: '近7天' },
  { id: '30d', label: '近30天' }
]

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] leading-none'
      style={active
        ? { background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 600, border: '1px solid transparent' }
        : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

export default function WrongBookPageV2({
  filteredWrongQuestions,
  bankCounts,
  selectedQuestions,
  pendingWrongQuestionCount,
  onToggleSelection,
  onSelectVisible,
  onClearSelection,
  onOpenDetail,
  onDelete,
  onPrintPreview,
  hasMore,
  loadingMore,
  onLoadMore
}) {
  const questions = Array.isArray(filteredWrongQuestions) ? filteredWrongQuestions : []
  const counts = bankCounts || { new: pendingWrongQuestionCount || 0, review: 0, mastered: 0 }
  const [filter, setFilter] = useState('new')
  const [dateRange, setDateRange] = useState('all')
  const [subject, setSubject] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const tabs = [
    { id: 'new', label: '待复习', count: counts.new || 0 },
    { id: 'review', label: '基本掌握', count: counts.review || 0 },
    { id: 'mastered', label: '完全掌握', count: counts.mastered || 0 }
  ]

  const subjects = useMemo(() => {
    const seen = []
    for (const q of questions) {
      const s = subjectOf(q)
      if (s && !seen.includes(s)) seen.push(s)
    }
    return seen
  }, [questions])

  const visible = questions.filter(i =>
    (filter === 'review' ? ['review_1', 'review_2'].includes(lifecycle(i)) : lifecycle(i) === filter)
    && inDateRange(i, dateRange)
    && (subject === 'all' || subjectOf(i) === subject)
  )

  const allVisibleSelected = visible.length > 0
    && visible.every(i => selectedQuestions.some(s => s.id === i.id))

  // 长按题目（450ms）进入多选模式：进入的同时勾选该题，并抑制随后触发的 click。
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)
  const startPress = (item, selected) => {
    longPressFired.current = false
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setSelectMode(true)
      if (!selected) onToggleSelection(item)
    }, 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  // 触底加载下一页：服务端每页 100 条，Tab 计数是全量数字，
  // 不接回加载的话超过 100 条后新错题在移动端永远不可见。
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore) onLoadMore?.()
    }, { rootMargin: '240px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  const showFilterRow = questions.length > 0
  const showBottomBar = selectMode || selectedQuestions.length > 0

  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mobile-page-wrongbook mx-auto w-full max-w-lg px-4 pb-28 pt-5'>
    <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='错题复习状态' />
    {showFilterRow && (
      <div className='mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5' style={{ scrollbarWidth: 'none' }}>
        {DATE_CHIPS.map(c => (
          <FilterChip key={c.id} active={dateRange === c.id} onClick={() => setDateRange(c.id)}>{c.label}</FilterChip>
        ))}
        {subjects.length > 0 && (
          <>
            <span className='mx-0.5 h-3.5 w-px flex-shrink-0' style={{ background: 'var(--border-light)' }} aria-hidden='true' />
            {subjects.map(s => (
              <FilterChip key={s} active={subject === s} onClick={() => setSubject(subject === s ? 'all' : s)}>{subjectLabel(s)}</FilterChip>
            ))}
          </>
        )}
      </div>
    )}
    {selectMode && (
      <div className='mt-2 text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
        多选模式：点击题目勾选，「完成」退出
      </div>
    )}
    {!questions.length
      ? <EmptyState icon={Search} title='这里还没有错题' description='完成作业批改后，错题会自动进入这里' className='py-16' />
      : !visible.length
        ? <EmptyState icon={Search} title='这个分类暂时没有错题' description='试试放宽时间或学科筛选，或切换其他状态' className='py-16' />
        : <MobileList>
            {visible.map((item, index) => {
              const selected = selectedQuestions.some(e => e.id === item.id)
              const status = lifecycle(item)
              const date = dayjs(item.added_at || item.created_at)
              const wrongTimes = (item.error_count || 1) > 1 ? `错过${item.error_count}次` : (item.error_type || '需要关注')
              return <SwipeableRow key={item.id || index} onDelete={() => onDelete(item)}>
                <div className='flex items-center gap-2.5 border-b px-0.5 py-2.5 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}>
                  <button
                    type='button'
                    onClick={() => onToggleSelection(item)}
                    className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border'
                    style={{ borderColor: selected ? 'var(--primary)' : 'var(--border)', background: selected ? 'var(--primary)' : '#fff', color: '#fff' }}
                    aria-label={selected ? '取消选择' : '选择错题'}
                  >
                    {selected && <Check size={12} />}
                  </button>
                  <button
                    type='button'
                    className='min-w-0 flex-1 select-none text-left'
                    style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                    onPointerDown={() => startPress(item, selected)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={e => e.preventDefault()}
                    onClick={() => {
                      if (longPressFired.current) { longPressFired.current = false; return }
                      if (selectMode) onToggleSelection(item)
                      else onOpenDetail(item)
                    }}
                    aria-label={selectMode ? (selected ? '取消选择' : '选择错题') : '查看错题详情'}
                  >
                    <span className='line-clamp-2 text-[13px] font-medium leading-5' style={{ color: 'var(--text)' }}>
                      {subLabelOf(item) && (
                        <span className='mr-1 rounded px-1 align-middle text-[10px] font-normal' style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                          {subLabelOf(item)}
                        </span>
                      )}
                      <MathText content={text(item)} />
                    </span>
                    <span className='mt-0.5 block truncate text-[11px]' style={{ color: status === 'mastered' ? 'var(--success)' : 'var(--text-secondary)' }}>
                      {date.isValid() ? date.format('MM/DD') : ''}{date.isValid() ? ' · ' : ''}{wrongTimes}
                    </span>
                  </button>
                  <ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} />
                </div>
              </SwipeableRow>
            })}
            {hasMore && (
              <div ref={sentinelRef} className='py-3 text-center text-[12px]' style={{ color: 'var(--text-tertiary)' }}>
                {loadingMore ? '正在加载…' : ''}
              </div>
            )}
          </MobileList>}
    {showBottomBar && (
      <div className='fixed inset-x-0 z-40 mx-auto max-w-lg px-4' style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
        <div className='flex items-center gap-2 border bg-white px-3 py-2 shadow-lg' style={{ borderColor: 'var(--border-light)' }}>
          <span className='flex-shrink-0 text-[12px]' style={{ color: 'var(--text-secondary)' }}>已选 {selectedQuestions.length} 道</span>
          {visible.length > 0 && (
            <button
              type='button'
              onClick={() => onSelectVisible?.(visible)}
              className='flex-shrink-0 rounded-full px-2.5 py-1 text-[12px]'
              style={{ background: 'var(--bg-mist)', color: 'var(--primary)', fontWeight: 500 }}
            >{allVisibleSelected ? '取消全选' : '全选'}</button>
          )}
          <button
            type='button'
            onClick={() => { onClearSelection?.() }}
            className='flex-shrink-0 rounded-full px-2.5 py-1 text-[12px]'
            style={{ background: 'var(--bg-mist)', color: 'var(--text-secondary)' }}
          >清空</button>
          {selectMode ? (
            <button
              type='button'
              onClick={() => setSelectMode(false)}
              className='ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold'
              style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
            >完成</button>
          ) : (
            <button
              type='button'
              onClick={onPrintPreview}
              className='ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white'
              style={{ background: 'var(--primary)' }}
            >生成重练</button>
          )}
        </div>
      </div>
    )}
  </motion.div>
}
