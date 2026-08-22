import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, ChevronRight, Filter, Loader2, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'
import { MobilePageHeader, MobileStatGrid, MobileSegmentedTabs, MobileList, MobileSectionHeading } from '../features/mobile/MobilePrimitives'

const lifecycleLabel = {
  new: '待处理',
  review_1: '复习中',
  review_2: '再次复习',
  mastered: '已掌握',
}

const errorLabel = {
  concept: '概念理解',
  calculation: '计算错误',
  careless: '审题问题',
  method: '方法不熟',
}

const getQuestionText = (wq) => {
  const question = wq.question || wq
  return question.content || wq.content || '题目内容暂不可用'
}

const getStudentAnswer = (wq) => wq.student_answer || wq.studentAnswer || '未记录作答'

const getLifecycle = (wq) => wq.lifecycle_status || wq.status || 'new'

const getQuestionCount = (wq) => wq.error_count || wq.grade_count || 1

function StatusPill({ status }) {
  const config = {
    new: { label: '待处理', color: 'var(--warning)', bg: 'var(--warning-soft)' },
    review_1: { label: '复习中', color: 'var(--primary)', bg: 'var(--primary-soft)' },
    review_2: { label: '再次复习', color: 'var(--accent)', bg: 'var(--accent-soft)' },
    mastered: { label: '已掌握', color: 'var(--success)', bg: 'var(--success-soft)' },
  }[status] || { label: '待处理', color: 'var(--warning)', bg: 'var(--warning-soft)' }

  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: config.bg, color: config.color }}>{config.label}</span>
}

function FilterSheet({ visible, onClose, selectedSubject, onSubjectChange, onResetFilters, allAvailableTags, selectedTags, onTagsChange }) {
  if (!visible) return null
  const subjects = [{ key: 'all', label: '全部科目' }, { key: 'math', label: '数学' }, { key: 'chinese', label: '语文' }, { key: 'english', label: '英语' }]

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="筛选错题">
      <button type="button" className="absolute inset-0 h-full w-full bg-black/30" onClick={onClose} aria-label="关闭筛选" />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-lg rounded-t-3xl bg-white px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-4 shadow-2xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: 'var(--border)' }} />
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>筛选错题</h2><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--bg-secondary)' }} aria-label="关闭"><X size={16} /></button></div>
        <p className="mb-2 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>科目</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {subjects.map((subject) => <button key={subject.key} type="button" onClick={() => onSubjectChange(subject.key)} className="rounded-full border px-3 py-1.5 text-[13px]" style={{ borderColor: selectedSubject === subject.key ? 'var(--primary)' : 'var(--border-light)', background: selectedSubject === subject.key ? 'var(--primary-soft)' : 'var(--bg-card)', color: selectedSubject === subject.key ? 'var(--primary)' : 'var(--text-secondary)' }}>{subject.label}</button>)}
        </div>
        {allAvailableTags?.length > 0 && <><p className="mb-2 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>标签</p><div className="mb-5 flex flex-wrap gap-2">{allAvailableTags.slice(0, 8).map((tag) => { const active = selectedTags.includes(tag); return <button key={tag} type="button" onClick={() => onTagsChange(active ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag])} className="rounded-full border px-3 py-1.5 text-[13px]" style={{ borderColor: active ? 'var(--primary)' : 'var(--border-light)', background: active ? 'var(--primary-soft)' : 'var(--bg-card)', color: active ? 'var(--primary)' : 'var(--text-secondary)' }}>{tag}</button> })}</div></>}
        <div className="flex gap-3"><button type="button" onClick={onResetFilters} className="h-11 flex-1 rounded-xl border text-[14px] font-medium" style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>重置</button><button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl text-[14px] font-semibold text-white" style={{ background: 'var(--primary)' }}>查看结果</button></div>
      </div>
    </div>
  )
}

export default function WrongBookPage({
  currentStudent,
  wrongQuestions,
  filteredWrongQuestions,
  bankFilter,
  onFilterChange,
  showFilterPanel,
  onCloseFilterPanel,
  selectedSubject,
  onSubjectChange,
  selectedTags,
  onTagsChange,
  allAvailableTags,
  selectedQuestions,
  priorityQuestions,
  pendingWrongQuestionCount,
  onToggleSelection,
  onOpenDetail,
  onDelete,
  onStartPriorityRetry,
  onSelectAll,
  onPrintPreview,
  onRetryFiltered,
  onResetFilters,
  bankCounts,
  hasMore,
  loadingMore,
  onLoadMore,
}) {
  const [renderLimit, setRenderLimit] = useState(30)
  const loadMoreRef = useRef(null)
  const studentQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter((item) => item.student_id === currentStudent?.id)
  const questions = Array.isArray(filteredWrongQuestions) ? filteredWrongQuestions : []
  const counts = bankCounts || {}
  const activeFilters = selectedSubject !== 'all' || selectedTags.length > 0

  useEffect(() => setRenderLimit(30), [currentStudent?.id, bankFilter, activeFilters])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      if (renderLimit < questions.length) setRenderLimit((limit) => limit + 30)
      else if (hasMore) onLoadMore?.()
    }, { rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, questions.length, renderLimit])

  const visibleQuestions = questions.slice(0, renderLimit)
  const repeatCount = questions.filter((item) => getQuestionCount(item) > 1).length
  const allSelected = questions.length > 0 && questions.every((item) => selectedQuestions.some((selected) => selected.id === item.id))

  return (
    <motion.div key="wrongbook-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="mx-auto w-full max-w-lg px-4 pb-6 pt-5">
      <header className="mb-5 flex items-start justify-between"><div><p className="mb-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{'\u9519\u9898\u672c'}</p><h1 className="text-[24px] font-semibold tracking-[-0.04em]" style={{ color: 'var(--text)' }}>{questions.length}{' \u9053\u9519\u9898\u5f85\u5904\u7406'}</h1></div><div className="flex items-center gap-2"><button type="button" onClick={onPrintPreview} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white" style={{ background: 'var(--primary)' }}>{'\u751f\u6210\u91cd\u7ec3'}</button><button type="button" onClick={() => onCloseFilterPanel(!showFilterPanel)} className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: activeFilters ? 'var(--primary)' : 'var(--border-light)', color: activeFilters ? 'var(--primary)' : 'var(--text-secondary)' }} aria-label="\u7b5b\u9009"><SlidersHorizontal size={17} /></button></div></header>
      <div className="mb-5 flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}><span>{'\u91cd\u590d\u51fa\u9519'} <b style={{ color: 'var(--text)' }}>{repeatCount}</b></span><span style={{ color: 'var(--border)' }}>|</span><span>{'\u5f85\u590d\u4e60'} <b style={{ color: 'var(--text)' }}>{counts.review ?? 0}</b></span><span style={{ color: 'var(--border)' }}>|</span><span>{'\u5df2\u638c\u63e1'} <b style={{ color: 'var(--success)' }}>{counts.mastered ?? 0}</b></span></div>
      {pendingWrongQuestionCount > 0 && priorityQuestions.length > 0 && <button type="button" onClick={onStartPriorityRetry} className="mb-6 flex w-full items-center gap-2 border-y py-3 text-left" style={{ borderColor: 'var(--border-light)' }}><Sparkles size={16} style={{ color: 'var(--primary)' }} /><span className="flex-1 text-[13px]" style={{ color: 'var(--text)' }}>{'\u4f18\u5148\u7ec3\u4e60'} {priorityQuestions.length} {'\u9053\u9ad8\u9891\u9519\u9898'}</span><span className="text-[12px] font-medium" style={{ color: 'var(--primary)' }}>{'\u751f\u6210\u7ec3\u4e60\u5377'}</span><ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} /></button>}
      <div className="mb-2 flex items-center justify-between"><h2 className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>{'\u9519\u9898'}</h2><span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{activeFilters ? '\u5df2\u7b5b\u9009' : '\u6700\u8fd1\u4f18\u5148'}</span></div>
      {questions.length === 0 ? <EmptyState icon={Search} title={activeFilters ? '\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u9519\u9898' : '\u8fd8\u6ca1\u6709\u9519\u9898'} description={activeFilters ? '\u8c03\u6574\u7b5b\u9009\u6761\u4ef6' : '\u5b8c\u6210\u4f5c\u4e1a\u6279\u6539\u540e\u4f1a\u81ea\u52a8\u51fa\u73b0'} className="py-16" iconContainerStyle={{ background: 'var(--bg-secondary)' }} iconStyle={{ color: 'var(--text-secondary)' }} /> : <div className="divide-y border-y" style={{ borderColor: 'var(--border-light)' }}>{visibleQuestions.map((wq, index) => { const selected = selectedQuestions.some((item) => item.id === wq.id); const count = getQuestionCount(wq); const canRetry = getLifecycle(wq) !== 'mastered'; return <SwipeableRow key={wq.id || `${wq.question_id}-${index}`} onDelete={() => onDelete(wq)}><div className={`flex items-center gap-3 px-1 py-3.5 ${selected ? 'bg-[var(--primary-mist)]' : ''}`}><button type="button" onClick={() => onToggleSelection(wq)} className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border" style={{ borderColor: selected ? 'var(--primary)' : 'var(--border)', background: selected ? 'var(--primary)' : '#fff', color: '#fff' }} aria-label={selected ? '\u53d6\u6d88\u9009\u62e9' : '\u9009\u62e9\u9519\u9898'}>{selected && <Check size={12} />}</button><button type="button" onClick={() => onOpenDetail(wq)} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><span className="text-[12px] font-medium" style={{ color: count > 1 ? 'var(--warning)' : 'var(--text-secondary)' }}>{'\u9519'} {count} {'\u6b21'}</span><span className="truncate text-[14px] font-medium" style={{ color: 'var(--text)' }}>{getQuestionText(wq)}</span></span><span className="mt-1 block truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{errorLabel[wq.error_type] || wq.error_type || '\u9700\u8981\u5173\u6ce8'}</span></button><button type="button" disabled={!canRetry} onClick={() => onToggleSelection(wq)} className="flex-shrink-0 text-[12px] font-medium" style={{ color: canRetry ? 'var(--primary)' : 'var(--text-tertiary)' }}>{canRetry ? '\u52a0\u5165\u91cd\u7ec3' : '\u5df2\u638c\u63e1'}</button></div></SwipeableRow>})}</div>}
      <div ref={loadMoreRef} className="flex items-center justify-center py-4 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{loadingMore ? <><Loader2 size={14} className="mr-1 animate-spin" />{'\u52a0\u8f7d\u4e2d'}</> : hasMore || renderLimit < questions.length ? '\u7ee7\u7eed\u4e0a\u6ed1' : ''}</div>
      {selectedQuestions.length > 0 && <div className="fixed inset-x-0 z-40 mx-auto max-w-lg px-4" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}><div className="flex items-center gap-3 border bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur" style={{ borderColor: 'var(--border-light)' }}><button type="button" onClick={onSelectAll} className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{allSelected ? '\u53d6\u6d88\u5168\u9009' : '\u5168\u9009'}</button><span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{'\u5df2\u9009'} {selectedQuestions.length} {'\u9053'}</span><button type="button" onClick={onPrintPreview} className="ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white" style={{ background: 'var(--primary)' }}>{'\u6279\u91cf\u52a0\u5165\u91cd\u7ec3'}</button></div></div>}
      <FilterSheet visible={showFilterPanel} onClose={() => onCloseFilterPanel(false)} selectedSubject={selectedSubject} onSubjectChange={onSubjectChange} onResetFilters={onResetFilters} allAvailableTags={allAvailableTags} selectedTags={selectedTags} onTagsChange={onTagsChange} />
    </motion.div>
  )
}