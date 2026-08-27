import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import SwipeableRow from '../components/SwipeableRow'
import MathText from '../components/MathText'
import { MobileList, MobileSegmentedTabs } from '../features/mobile/MobilePrimitives'

const labels = { new: '待复习', review_1: '复习中', review_2: '再次复习', mastered: '已掌握' }
const lifecycle = i => i.lifecycle_status || i.status || 'new'
const text = i => (i.question || i).content || i.content || '题目内容暂不可用'

export default function WrongBookPageV2({
  filteredWrongQuestions,
  bankCounts,
  selectedQuestions,
  pendingWrongQuestionCount,
  onToggleSelection,
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
  const tabs = [
    { id: 'new', label: '待复习', count: counts.new || 0 },
    { id: 'review', label: '复习中', count: counts.review || 0 },
    { id: 'mastered', label: '已掌握', count: counts.mastered || 0 }
  ]
  const visible = questions.filter(i => filter === 'review' ? ['review_1', 'review_2'].includes(lifecycle(i)) : lifecycle(i) === filter)

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

  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mobile-page-wrongbook mx-auto w-full max-w-lg px-4 pb-28 pt-5'>
    <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='错题复习状态' />
    {!questions.length
      ? <EmptyState icon={Search} title='这里还没有错题' description='完成作业批改后，错题会自动进入这里' className='py-16' />
      : !visible.length
        ? <EmptyState icon={Search} title='这个分类暂时没有错题' description='切换其他状态看看' className='py-16' />
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
                  <button type='button' onClick={() => onOpenDetail(item)} className='min-w-0 flex-1 text-left'>
                    <span className='line-clamp-2 block text-[13px] font-medium leading-5' style={{ color: 'var(--text)' }}>
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
    {selectedQuestions.length > 0 && (
      <div className='fixed inset-x-0 z-40 mx-auto max-w-lg px-4' style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
        <div className='flex items-center gap-3 border bg-white px-3 py-2.5 shadow-lg' style={{ borderColor: 'var(--border-light)' }}>
          <span className='text-[12px]' style={{ color: 'var(--text-secondary)' }}>已选 {selectedQuestions.length} 道</span>
          <button
            type='button'
            onClick={onPrintPreview}
            className='ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white'
            style={{ background: 'var(--primary)' }}
          >生成重练</button>
        </div>
      </div>
    )}
  </motion.div>
}
