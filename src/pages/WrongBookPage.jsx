import { X, LayoutGrid, SlidersHorizontal, CheckCircle2, Sparkles } from 'lucide-react'
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
  onToggleSelection,
  onOpenDetail,
  onDelete,
  onToggleMastery,
  onSelectAll,
  onPrintPreview
}) {
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
              { id: 'all', label: '全部', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id).length },
              { id: 'new', label: '不懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && (wq.lifecycle_status || 'new') === 'new').length },
              { id: 'review', label: '略懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && (wq.lifecycle_status === 'review_1' || wq.lifecycle_status === 'review_2')).length },
              { id: 'mastered', label: '完全懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.lifecycle_status === 'mastered').length }
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
          {(selectedSubject !== 'all' || selectedTimeRange !== 'all' || selectedErrorCount !== 'all' || selectedTags.length > 0) && (
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
                    onClick={() => {
                      onSubjectChange('all')
                      onTimeRangeChange('all')
                      onErrorCountChange('all')
                      onTagsChange([])
                    }}
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
          <EmptyState
            icon={LayoutGrid}
            title="暂无错题"
            description="AI批改后错题会自动收录到错题本"
            className="py-16"
          />
        ) : (
          <div className="space-y-2">
            {filteredWrongQuestions.map((wq) => {
              const question = wq.question || wq
              const isSelected = selectedQuestions.find(q => q.id === wq.id)

              const statusCfg = (() => {
                const ls = wq.lifecycle_status || 'new'
                if (ls === 'mastered' || wq.status === 'mastered') return { bg: 'var(--success-soft)', color: 'var(--success)', text: '完全懂' }
                if (ls === 'review_2' || ls === 'review_1') return { bg: 'var(--primary-mist)', color: 'var(--primary-hover)', text: '略懂' }
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
                        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {dayjs(wq.added_at || wq.created_at).format('MM/DD')}
                        </span>

                        {tags.slice(0, 2).map((tag, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: 'var(--fs-10)',
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-8)',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                              maxWidth: '80px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {tag}
                          </span>
                        ))}

                        <span
                          onClick={(e) => { e.stopPropagation(); onToggleMastery(wq) }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: 'var(--fs-11)',
                            padding: '1px 8px',
                            borderRadius: 'var(--radius-sm)',
                            background: statusCfg.bg,
                            color: statusCfg.color,
                            cursor: 'pointer',
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
                    </div>
                  </div>
                </motion.div>
                </SwipeableRow>
              )
            })}
          </div>
        )}
      </section>

      {/* Floating Bottom Action Bar */}
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
    </motion.div>
  )
}
