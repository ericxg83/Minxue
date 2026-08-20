import { useEffect, useRef, useState } from 'react'
import { X, LayoutGrid, SlidersHorizontal, FilterX, RotateCcw, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'

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
  selectedTimeRange,
  onTimeRangeChange,
  selectedErrorCount,
  onErrorCountChange,
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
  selectedErrorType,
  onErrorTypeChange,
  selectedRecentWrongRange,
  onRecentWrongRangeChange,
  selectedMasteryStage,
  onMasteryStageChange,
  allAvailableErrorTypes,
  bankCounts,
  hasMore,
  loadingMore,
  onLoadMore
}) {
  // P2 虚拟列表：渐进渲染窗口（筛选/数据变化时重置）
  const [renderLimit, setRenderLimit] = useState(30)
  const activeFilters = selectedSubject !== 'all' || selectedTimeRange !== 'all' || selectedErrorCount !== 'all' || selectedTags.length > 0 || selectedErrorType !== 'all' || selectedRecentWrongRange !== 'all' || selectedMasteryStage !== 'all'
  // 滚动触底：先渐进渲染已加载列表中的剩余卡片（窗口化），全部渲染完再触发服务端分页
  const loadMoreRef = useRef(null)
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return
      if (renderLimit < filteredWrongQuestions.length) {
        setRenderLimit(prev => prev + 30)
      } else if (hasMore) {
        onLoadMore?.()
      }
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [renderLimit, filteredWrongQuestions.length, hasMore, onLoadMore])

  // 筛选条件/学生/tab 变化时重置渲染窗口
  useEffect(() => {
    setRenderLimit(30)
  }, [currentStudent?.id, bankFilter, activeFilters])

  // Tab 计数优先使用服务端 total/counts（不随分页截断），服务端不可用时回退到已加载列表
  const studentWQs = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id)
  const counts = bankCounts || {}
  const tabCount = (filterId) => {
    switch (filterId) {
      case 'all': return counts.total ?? studentWQs.length
      case 'new': return counts.new ?? studentWQs.filter(wq => (wq.lifecycle_status || 'new') === 'new').length
      case 'review': return counts.review ?? studentWQs.filter(wq => wq.lifecycle_status === 'review_1' || wq.lifecycle_status === 'review_2').length
      case 'mastered': return counts.mastered ?? studentWQs.filter(wq => wq.lifecycle_status === 'mastered').length
      default: return 0
    }
  }
  return (
    <motion.div
      key="bank-page"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full"
    >
      {/* Filter Tabs + 筛选图标 */}
      <section className="px-4 pt-3 mb-3 flex items-center gap-2">
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 min-w-max">
            {[
              { id: 'all', label: '全部', count: tabCount('all') },
              { id: 'new', label: '不懂', count: tabCount('new') },
              { id: 'review', label: '略懂', count: tabCount('review') },
              { id: 'mastered', label: '完全懂', count: tabCount('mastered') }
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => onFilterChange(filter.id)}
                className={`filter-chip ${bankFilter === filter.id ? 'active' : 'inactive'}`}
              >
                {filter.label}
                <span style={{ fontSize: 'var(--fs-10)', opacity: 0.7, marginLeft: '3px' }}>{filter.count}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => onCloseFilterPanel(!showFilterPanel)}
          className="relative flex-shrink-0 flex items-center justify-center"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-light)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            cursor: 'pointer'
          }}
          aria-label="筛选"
        >
          <SlidersHorizontal size={17} />
          {(activeFilters) && (
            <span style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              width: '9px',
              height: '9px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--danger)',
              border: '2px solid var(--text-inverse)'
            }} />
          )}
        </button>
      </section>

      {/* Filter Drawer — 参考 PC FilterPanel 的 pill-chip 样式 */}
      {pendingWrongQuestionCount > 0 && (
        <section className="px-4 mb-4">
          <div
            className="flex items-center justify-between gap-3"
            style={{
              padding: '14px 15px',
              border: '1px solid var(--primary-soft)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--primary-soft)'
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary)',
                  color: 'var(--text-inverse)'
                }}
              >
                <RotateCcw size={16} />
              </div>
              <div className="min-w-0">
                <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--text)' }}>
                  优先处理
                </div>
                <div className="truncate" style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {pendingWrongQuestionCount} 道错题等待重练
                </div>
              </div>
            </div>
            <button
              onClick={onStartPriorityRetry}
              disabled={priorityQuestions.length === 0}
              className="flex items-center gap-1 flex-shrink-0"
              style={{
                minHeight: '34px',
                padding: '0 11px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: priorityQuestions.length > 0 ? 'var(--primary)' : 'var(--bg-secondary)',
                color: priorityQuestions.length > 0 ? 'var(--text-inverse)' : 'var(--text-secondary)',
                fontSize: 'var(--fs-12)',
                fontWeight: 600
              }}
            >
              开始重练
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
      )}

      {showFilterPanel && (
        <>
          <div className="absolute inset-0 z-50 bg-black/30" onClick={() => onCloseFilterPanel(false)} />
          <div
            className="absolute top-0 right-0 z-50 h-full bg-white shadow-xl"
            style={{
              width: '85%',
              maxWidth: '360px',
              animation: 'slideInRight 0.25s ease-out'
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-light)]">
              <span style={{ fontSize: 'var(--fs-17)', fontWeight: 600, color: 'var(--text)' }}>筛选</span>
              <button onClick={() => onCloseFilterPanel(false)} style={{ padding: '4px', cursor: 'pointer' }}>
                <X size={20} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div className="overflow-y-auto" style={{ height: 'calc(100% - 52px)' }}>
              <div style={{ padding: '16px' }}>
                {/* 科目 */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>科目</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: '全部科目' },
                      { key: '数学', label: '数学' },
                      { key: '语文', label: '语文' },
                      { key: '英语', label: '英语' },
                      { key: '物理', label: '物理' },
                      { key: '化学', label: '化学' }
                    ].map(s => (
                      <button
                        key={s.key}
                        onClick={() => onSubjectChange(s.key)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedSubject === s.key ? 500 : 400,
                          background: selectedSubject === s.key ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedSubject === s.key ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 时间 */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>加入时间</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: '全部时间' },
                      { key: 'today', label: '今天' },
                      { key: 'week', label: '最近7天' },
                      { key: 'month', label: '最近30天' },
                      { key: 'quarter', label: '最近3个月' }
                    ].map(t => (
                      <button
                        key={t.key}
                        onClick={() => onTimeRangeChange(t.key)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedTimeRange === t.key ? 500 : 400,
                          background: selectedTimeRange === t.key ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedTimeRange === t.key ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 错次 */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>错误次数</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: '全部次数' },
                      { key: '1', label: '1次' },
                      { key: '2-3', label: '2-3次' },
                      { key: '4-5', label: '4-5次' },
                      { key: '5+', label: '5次以上' }
                    ].map(e => (
                      <button
                        key={e.key}
                        onClick={() => onErrorCountChange(e.key)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedErrorCount === e.key ? 500 : 400,
                          background: selectedErrorCount === e.key ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedErrorCount === e.key ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 错因 */}
                {allAvailableErrorTypes.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>错因</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onErrorTypeChange('all')}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedErrorType === 'all' ? 500 : 400,
                          background: selectedErrorType === 'all' ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedErrorType === 'all' ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        全部错因
                      </button>
                      {allAvailableErrorTypes.map(type => (
                        <button
                          key={type}
                          onClick={() => onErrorTypeChange(type)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-lg)',
                            fontSize: 'var(--fs-13)',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: selectedErrorType === type ? 500 : 400,
                            background: selectedErrorType === type ? 'var(--primary-hover)' : 'var(--bg)',
                            color: selectedErrorType === type ? 'var(--text-inverse)' : 'var(--text-secondary)',
                            transition: 'all 0.15s'
                          }}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 最近错时间 */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>最近错时间</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: '全部时间' },
                      { key: 'today', label: '今天' },
                      { key: 'week', label: '最近7天' },
                      { key: 'month', label: '最近30天' }
                    ].map(r => (
                      <button
                        key={r.key}
                        onClick={() => onRecentWrongRangeChange(r.key)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedRecentWrongRange === r.key ? 500 : 400,
                          background: selectedRecentWrongRange === r.key ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedRecentWrongRange === r.key ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 掌握阶段（略懂分级：区分复习轮次） */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>掌握阶段</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: '全部阶段' },
                      { key: 'new', label: '不懂' },
                      { key: 'review_1', label: '复习1轮' },
                      { key: 'review_2', label: '复习2轮' },
                      { key: 'reviewing', label: '略懂(1+2轮)' },
                      { key: 'mastered', label: '完全懂' }
                    ].map(st => (
                      <button
                        key={st.key}
                        onClick={() => onMasteryStageChange(st.key)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedMasteryStage === st.key ? 500 : 400,
                          background: selectedMasteryStage === st.key ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedMasteryStage === st.key ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 标签 */}
                {allAvailableTags.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: 'var(--fs-15)', color: 'var(--text)', marginBottom: '12px', fontWeight: 500 }}>知识点标签</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onTagsChange([])}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-lg)',
                          fontSize: 'var(--fs-13)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: selectedTags.length === 0 ? 500 : 400,
                          background: selectedTags.length === 0 ? 'var(--primary-hover)' : 'var(--bg)',
                          color: selectedTags.length === 0 ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          transition: 'all 0.15s'
                        }}
                      >
                        全部标签
                      </button>
                      {allAvailableTags.map(tag => {
                        const isActive = selectedTags.includes(tag)
                        return (
                          <button
                            key={tag}
                            onClick={() => {
                              onTagsChange(isActive ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag])
                            }}
                            style={{
                              padding: '8px 16px',
                              borderRadius: 'var(--radius-lg)',
                              fontSize: 'var(--fs-13)',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: isActive ? 500 : 400,
                              background: isActive ? 'var(--primary-hover)' : 'var(--bg)',
                              color: isActive ? 'var(--text-inverse)' : 'var(--text-secondary)',
                              transition: 'all 0.15s'
                            }}
                          >
                            {tag}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Reset */}
                <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
                  <button
                    onClick={onResetFilters}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--fs-14)',
                      fontWeight: 500,
                      border: 'none',
                      cursor: 'pointer',
                      background: 'var(--bg)',
                      color: 'var(--text-secondary)',
                      transition: 'all 0.15s'
                    }}
                  >
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Wrong Question List */}
      <section className="px-4">
        {filteredWrongQuestions.length === 0 ? (
          studentWQs.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="暂无错题"
              description="AI批改后错题会自动收录到错题本"
              className="py-16"
            />
          ) : (
            <EmptyState
              icon={FilterX}
              title="没有符合条件的错题"
              description="试试调整或重置筛选条件"
              className="py-16"
            >
              <button
                onClick={onResetFilters}
                style={{
                  marginTop: '14px',
                  padding: '9px 22px',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 'var(--fs-13)',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--primary)',
                  color: 'var(--text-inverse)'
                }}
              >
                重置筛选
              </button>
            </EmptyState>
          )
        ) : (
          <div className="space-y-2">
            {filteredWrongQuestions.slice(0, renderLimit).map((wq) => {
              const question = wq.question || wq
              const isSelected = selectedQuestions.find(q => q.id === wq.id)

              const statusCfg = (() => {
                const ls = wq.lifecycle_status || 'new'
                if (ls === 'mastered' || wq.status === 'mastered') return { bg: 'var(--success-soft)', color: 'var(--success)', text: '完全懂' }
                if (ls === 'review_2') return { bg: 'var(--primary-mist)', color: 'var(--primary-hover)', text: '复习2轮' }
                if (ls === 'review_1') return { bg: 'var(--primary-mist)', color: 'var(--primary-hover)', text: '复习1轮' }
                return { bg: 'var(--warning-soft)', color: 'var(--warning)', text: '不懂' }
              })()

              const tags = question.tags_source === 'manual'
                ? (question.manual_tags || [])
                : (question.ai_tags || [])

              return (
                <SwipeableRow
                  key={wq.id}
                  onDelete={() => onDelete(wq)}
                >
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  data-wq-id={wq.id}
                  data-wq-card="true"
                  className="card"
                  style={{ padding: '12px' }}
                >
                  <div className="flex gap-2.5 items-start">
                    <button
                      onClick={() => onToggleSelection(wq)}
                      className="flex-shrink-0 mt-0.5"
                    >
                      <div
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: 'var(--radius-4)',
                          border: '2px solid',
                          borderColor: isSelected ? 'var(--primary-hover)' : 'var(--border)',
                          background: isSelected ? 'var(--primary-hover)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s'
                        }}
                      >
                        {isSelected && (
                          <CheckCircle2 size={12} className="text-white" />
                        )}
                      </div>
                    </button>

                    <div className="flex-1 min-w-0" onClick={() => onOpenDetail(wq)}>
                      <p className="text-[13px] leading-[1.4] text-[var(--text)] line-clamp-2">
                        {question.content}
                      </p>

                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {wq.error_count > 1 && (
                          <span className="flex-shrink-0" style={{ fontSize: 'var(--fs-10)', padding: '1px 7px', borderRadius: 'var(--radius-8)', background: 'var(--danger-soft)', color: 'var(--danger)', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            错{wq.error_count}次
                          </span>
                        )}

                        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {dayjs(wq.added_at || wq.created_at).format('MM/DD')}
                        </span>

                        {tags.slice(0, 2).map((tag, idx) => {
                          const isActiveTag = selectedTags.includes(tag)
                          return (
                            <button
                              key={idx}
                              title={`按「${tag}」筛选`}
                              onClick={(e) => {
                                e.stopPropagation()
                                onTagsChange(isActiveTag ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag])
                              }}
                              style={{
                                fontSize: 'var(--fs-10)',
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-8)',
                                background: isActiveTag ? 'var(--primary-hover)' : 'var(--bg-secondary)',
                                color: isActiveTag ? 'var(--text-inverse)' : 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                maxWidth: '80px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                cursor: 'pointer',
                                border: 'none',
                                transition: 'all 0.15s'
                              }}
                            >
                              {tag}
                            </button>
                          )
                        })}

                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: 'var(--fs-11)',
                            padding: '1px 8px',
                            borderRadius: 'var(--radius-sm)',
                            background: statusCfg.bg,
                            color: statusCfg.color,
                            whiteSpace: 'nowrap',
                            fontWeight: 500,
                            transition: 'all 0.15s'
                          }}
                        >
                          <span style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: 'var(--radius-full)',
                            background: statusCfg.color,
                            display: 'inline-block'
                          }} />
                          {statusCfg.text}
                        </span>
                      </div>

                      {/* 错因 + 最近错时间（P1 数据字段展示） */}
                      {(wq.error_type || wq.error_reason || wq.last_wrong_at) && (
                        <div className="flex items-center gap-1.5 mt-1.5 min-w-0" style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)' }}>
                          {wq.error_type && (
                            <span className="flex-shrink-0" style={{ color: 'var(--danger)', fontWeight: 600 }}>{wq.error_type}</span>
                          )}
                          {wq.error_reason && (
                            <span className="truncate min-w-0">{wq.error_reason}</span>
                          )}
                          {wq.last_wrong_at && (
                            <span className="flex-shrink-0" style={{ whiteSpace: 'nowrap', fontSize: 'var(--fs-10)', marginLeft: 'auto' }}>
                              最近错 {dayjs(wq.last_wrong_at).format('MM/DD')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
                </SwipeableRow>
              )
            })}
          </div>
        )}
        {hasMore && (
          <div ref={loadMoreRef} className="flex items-center justify-center py-3">
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)' }}>
              {loadingMore ? '加载中…' : '上滑加载更多'}
            </span>
          </div>
        )}
        {!hasMore && renderLimit < filteredWrongQuestions.length && (
          <div ref={loadMoreRef} className="flex items-center justify-center py-3">
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)' }}>
              继续上滑显示更多
            </span>
          </div>
        )}
      </section>

      {/* Floating Bottom Action Bar */}
      {filteredWrongQuestions.length > 0 && (
      <div className="absolute z-40 flex justify-center pointer-events-none" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', left: '12px', right: '12px' }}>
        <div className="bg-[var(--bg-elevated)]/85 backdrop-blur-xl rounded-xl shadow-lg border border-[var(--border-light)]/80 px-4 py-2.5 w-full max-w-lg flex items-center justify-between pointer-events-auto" style={{ maxWidth: 'calc(448px - 24px)' }}>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onSelectAll}
              className="flex items-center gap-1 text-[13px] font-medium"
              style={{ color: 'var(--primary-hover)', cursor: 'pointer' }}
            >
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: 'var(--radius-4)',
                  border: '2px solid',
                  borderColor: filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id)) ? 'var(--primary-hover)' : 'var(--border)',
                  background: filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id)) ? 'var(--primary-hover)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id)) && (
                  <CheckCircle2 size={11} className="text-white" />
                )}
              </div>
              全选
            </button>
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}>已选</span>
              <span style={{ fontSize: 'var(--fs-15)', fontWeight: 700, color: 'var(--primary-hover)' }}>{selectedQuestions.length}</span>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}>题</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {activeFilters && filteredWrongQuestions.length > 0 && (
              <button
                onClick={onRetryFiltered}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                style={{
                  background: 'var(--primary-soft)',
                  color: 'var(--primary-hover)',
                  whiteSpace: 'nowrap'
                }}
              >
                <RotateCcw size={13} />
                重练筛选
              </button>
            )}
            <button
              onClick={onPrintPreview}
              disabled={selectedQuestions.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all"
              style={{
                background: selectedQuestions.length > 0 ? 'var(--primary-hover)' : 'var(--bg-secondary)',
                color: selectedQuestions.length > 0 ? 'white' : 'var(--border)',
              }}
            >
              <Sparkles size={14} />
              生成试卷
            </button>
          </div>
        </div>
      </div>
      )}
    </motion.div>
  )
}
