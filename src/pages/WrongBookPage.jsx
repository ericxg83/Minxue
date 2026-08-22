import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, ChevronRight, Filter, Loader2, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'

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

  const tabs = [
    { id: 'all', label: '待处理', count: counts.total ?? studentQuestions.length },
    { id: 'new', label: '新错题', count: counts.new ?? studentQuestions.filter((item) => getLifecycle(item) === 'new').length },
    { id: 'review', label: '复习中', count: counts.review ?? studentQuestions.filter((item) => ['review_1', 'review_2'].includes(getLifecycle(item))).length },
    { id: 'mastered', label: '已掌握', count: counts.mastered ?? studentQuestions.filter((item) => getLifecycle(item) === 'mastered').length },
  ]

  const allSelected = questions.length > 0 && questions.every((item) => selectedQuestions.some((selected) => selected.id === item.id))
  const visibleQuestions = questions.slice(0, renderLimit)
  const repeatCount = questions.filter((item) => getQuestionCount(item) > 1).length
  const retryReadyCount = priorityQuestions.length

  return (
    <motion.div key="wrongbook-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="mobile-page mobile-page-wrongbook mx-auto w-full max-w-lg px-4 pb-32 pt-4">
      <div className="mb-5 flex items-start justify-between"><div><p className="mb-1 text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>学习问题</p><h1 className="text-[25px] font-semibold tracking-[-0.04em]" style={{ color: 'var(--text)' }}>错题本</h1><p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{currentStudent?.name || '当前学生'} · 优先处理需要重练的题目</p></div><button type="button" onClick={() => onCloseFilterPanel(!showFilterPanel)} className="relative flex h-10 w-10 items-center justify-center rounded-xl border" style={{ borderColor: activeFilters ? 'var(--primary)' : 'var(--border-light)', background: activeFilters ? 'var(--primary-soft)' : 'var(--bg-card)', color: activeFilters ? 'var(--primary)' : 'var(--text-secondary)' }} aria-label="筛选"><SlidersHorizontal size={18} />{activeFilters && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full" style={{ background: 'var(--primary)' }} />}</button></div>

      <div className="mb-5 flex gap-1 overflow-x-auto no-scrollbar rounded-xl p-1" style={{ background: 'var(--bg-secondary)' }}>{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => onFilterChange(tab.id)} className="flex min-w-max flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-[12px] transition-colors" style={{ background: bankFilter === tab.id ? 'var(--bg-card)' : 'transparent', color: bankFilter === tab.id ? 'var(--text)' : 'var(--text-secondary)', boxShadow: bankFilter === tab.id ? 'var(--shadow-sm)' : 'none', fontWeight: bankFilter === tab.id ? 600 : 400 }}>{tab.label}<span style={{ color: bankFilter === tab.id ? 'var(--primary)' : 'var(--text-tertiary)' }}>{tab.count}</span></button>)}</div>

      <div className="mb-6 grid grid-cols-3 divide-x overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-card)' }}><div className="px-3 py-3"><p className="text-[20px] font-semibold" style={{ color: 'var(--text)' }}>{questions.length}</p><p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>当前错题</p></div><div className="px-3 py-3"><p className="text-[20px] font-semibold" style={{ color: repeatCount > 0 ? 'var(--warning)' : 'var(--text)' }}>{repeatCount}</p><p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>重复出错</p></div><div className="px-3 py-3"><p className="text-[20px] font-semibold" style={{ color: retryReadyCount > 0 ? 'var(--primary)' : 'var(--text)' }}>{retryReadyCount}</p><p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>可安排重练</p></div></div>

      {pendingWrongQuestionCount > 0 && priorityQuestions.length > 0 && <div className="mb-6 flex items-center gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: 'rgba(250,140,22,0.24)', background: 'var(--warning-soft)' }}><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(250,140,22,0.18)', color: 'var(--warning)' }}><Sparkles size={17} /></div><div className="min-w-0 flex-1"><p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>系统已整理一组重练建议</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{pendingWrongQuestionCount} 道待处理错题，优先安排 {priorityQuestions.length} 道重复出错题</p></div><button type="button" onClick={onStartPriorityRetry} className="flex-shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold text-white" style={{ background: 'var(--primary)' }}>安排</button></div>}

      <div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>问题列表</h2><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>按最近错误和重复次数优先显示</p></div><button type="button" onClick={() => onCloseFilterPanel(!showFilterPanel)} className="flex items-center gap-1 text-[13px] font-medium" style={{ color: 'var(--primary)' }}><Filter size={14} />筛选</button></div>

      {questions.length === 0 ? <EmptyState icon={Search} iconSize={26} title={activeFilters ? '没有符合条件的错题' : '还没有错题记录'} description={activeFilters ? '可以调整筛选条件，或查看全部错题' : '完成作业批改后，系统会自动整理需要关注的问题'} className="rounded-2xl border py-16" iconContainerStyle={{ background: 'var(--bg-secondary)' }} iconStyle={{ color: 'var(--text-secondary)' }} titleStyle={{ color: 'var(--text)', fontSize: 'var(--fs-15)', fontWeight: 600 }} descriptionStyle={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-12)' }} /> : <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-card)' }}>{visibleQuestions.map((wq, index) => { const lifecycle = getLifecycle(wq); const selected = selectedQuestions.some((item) => item.id === wq.id); const count = getQuestionCount(wq); const canRetry = lifecycle !== 'mastered' && Boolean(wq.question_id || wq.content || wq.question?.content); return <SwipeableRow key={wq.id || `${wq.question_id}-${index}`} onDelete={() => onDelete(wq)}><motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex items-start gap-3 border-b px-4 py-4 last:border-b-0 ${selected ? 'bg-[var(--primary-mist)]' : ''}`} style={{ borderColor: 'var(--border-light)' }}><button type="button" onClick={() => onToggleSelection(wq)} className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: selected ? 'var(--primary)' : 'var(--border)', background: selected ? 'var(--primary)' : 'transparent', color: '#fff' }} aria-label={selected ? '取消选择' : '选择错题'}>{selected && <Check size={14} />}</button><button type="button" onClick={() => onOpenDetail(wq)} className="min-w-0 flex-1 text-left"><div className="mb-2 flex items-center gap-2"><StatusPill status={lifecycle} />{count > 1 && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: 'var(--warning)', background: 'var(--warning-soft)' }}>错 {count} 次</span>}<span className="ml-auto text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{wq.last_wrong_at ? dayjs(wq.last_wrong_at).format('MM/DD') : '最近'}</span></div><p className="line-clamp-2 text-[14px] font-medium leading-6" style={{ color: 'var(--text)' }}>{getQuestionText(wq)}</p><div className="mt-2 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}><span>{errorLabel[wq.error_type] || wq.error_type || '需要关注'}</span><span style={{ color: 'var(--border)' }}>·</span><span className="truncate">{wq.subject || '未标注科目'}</span><span style={{ color: 'var(--border)' }}>·</span><span className="truncate">{getStudentAnswer(wq)}</span></div><div className="mt-3 flex items-center justify-between"><span className="text-[12px]" style={{ color: canRetry ? 'var(--primary)' : 'var(--text-tertiary)' }}>{canRetry ? '可以加入重练' : '题目资料不完整，需先确认'}</span><ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} /></div></button></motion.div></SwipeableRow> })}</div>}

      <div ref={loadMoreRef} className="flex items-center justify-center py-4 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{loadingMore ? <><Loader2 size={14} className="mr-1 animate-spin" />正在加载更多</> : hasMore || renderLimit < questions.length ? '上滑加载更多' : questions.length > 0 ? '已显示全部错题' : ''}</div>

      {questions.length > 0 && <div className="fixed inset-x-0 z-40 mx-auto max-w-lg px-4" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}><div className="flex items-center gap-3 rounded-2xl border bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur" style={{ borderColor: 'var(--border-light)' }}><button type="button" onClick={onSelectAll} className="flex items-center gap-2 px-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}><span className="flex h-5 w-5 items-center justify-center rounded-full border-2" style={{ borderColor: allSelected ? 'var(--primary)' : 'var(--border)', background: allSelected ? 'var(--primary)' : 'transparent', color: '#fff' }}>{allSelected && <Check size={12} />}</span>全选</button><span className="h-5 w-px" style={{ background: 'var(--border-light)' }} /><span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>已选 <b style={{ color: 'var(--primary)' }}>{selectedQuestions.length}</b> 道</span><div className="ml-auto flex items-center gap-2">{activeFilters && <button type="button" onClick={onRetryFiltered} className="hidden rounded-lg px-2.5 py-2 text-[12px] font-medium sm:inline-flex" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>重练筛选</button>}<button type="button" onClick={onPrintPreview} disabled={selectedQuestions.length === 0} className="rounded-xl px-3.5 py-2 text-[13px] font-semibold" style={{ background: selectedQuestions.length > 0 ? 'var(--primary)' : 'var(--bg-secondary)', color: selectedQuestions.length > 0 ? '#fff' : 'var(--text-tertiary)' }}><RotateCcw size={14} className="mr-1 inline" />生成重练</button></div></div></div>}

      <FilterSheet visible={showFilterPanel} onClose={() => onCloseFilterPanel(false)} selectedSubject={selectedSubject} onSubjectChange={onSubjectChange} onResetFilters={onResetFilters} allAvailableTags={allAvailableTags} selectedTags={selectedTags} onTagsChange={onTagsChange} />
    </motion.div>
  )
}
