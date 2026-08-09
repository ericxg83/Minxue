import { Camera, FileText, Check, X, AlertCircle, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import { TaskCardSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const isTaskCompleted = (task) => {
  return task.status === 'done' || task.status === 'graded' || task.status === 'completed' || task.status === 'reviewed' || !!task.result?.questionCount
}

const isRetryTask = (t) => t.task_type === 'retry_paper' || t.task_type === 'wrong_retry'

export default function ProcessingPage({
  currentStudent,
  tasks,
  filteredTasks,
  isLoadingTasks,
  isInitializing,
  processingFilter,
  onFilterChange,
  onViewImage,
  onRetryTask,
  onDeleteTask,
  onOpenReview
}) {
  return (
    <motion.div
      key="processing-page"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="w-full"
    >
      {/* Filter Tabs */}
      <section className="px-4 pt-2.5 mb-1.5 overflow-x-auto no-scrollbar">
        <div className="flex gap-1.5 min-w-max">
          {(() => {
            const studentTasks = (Array.isArray(tasks) ? tasks : []).filter(t => t.student_id === currentStudent?.id)
            return [
              { id: 'all', label: '全部', count: studentTasks.length },
              { id: 'homework', label: '日常作业', count: studentTasks.filter(t => !isRetryTask(t)).length },
              { id: 'retry', label: '错题重练', count: studentTasks.filter(t => isRetryTask(t)).length }
            ]
          })().map((filter) => (
            <button
              key={filter.id}
              onClick={() => onFilterChange(filter.id)}
              className={`filter-chip ${processingFilter === filter.id ? 'active' : 'inactive'}`}
            >
              {filter.label}
              <span style={{ fontSize: 'var(--fs-10)', opacity: 0.7, marginLeft: '3px' }}>
                {filter.count}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Task List - Compact File Style */}
      <section className="px-4 space-y-2">
        {isLoadingTasks ? (
          <div className="space-y-1">
            <TaskCardSkeleton />
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </div>
        ) : filteredTasks.length === 0 ? (
          isInitializing ? (
            <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--primary-soft)' }}>
                <Camera size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
              </div>
              <p className="mt-4" style={{ fontSize: 'var(--fs-14)', fontWeight: 500, color: 'var(--text-secondary)' }}>正在加载学生数据...</p>
            </div>
          ) : (
            <EmptyState
              icon={Camera}
              iconSize={28}
              title="暂无任务"
              description="点击右下角按钮上传试卷"
              className="py-24 animate-fade-in"
              iconContainerStyle={{
                width: 64,
                height: 64,
                borderRadius: 'var(--radius-24)',
                background: 'var(--bg-secondary)',
              }}
              iconStyle={{ color: 'var(--text-secondary)' }}
              titleStyle={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)', marginTop: '16px' }}
              descriptionStyle={{ fontSize: 'var(--fs-12)', marginTop: '4px', color: 'var(--text-secondary)' }}
            />
          )
        ) : (
          filteredTasks.map((task) => (
            <SwipeableRow
              key={task.id}
              onDelete={() => onDeleteTask(task.id)}
            >
              <motion.div
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`card ${isTaskCompleted(task) ? 'cursor-pointer hover:shadow-md' : ''}`}
                style={{
                  padding: '12px',
                }}
                onClick={() => {
                  if (isTaskCompleted(task)) {
                    onOpenReview(task)
                  }
                }}
              >
              <div className="list-card-row items-center">
                {/* Thumbnail — portrait paper preview (A4-like), small radius for legibility */}
                <div
                  className="relative w-12 h-16 rounded-md flex-shrink-0 overflow-hidden cursor-pointer ring-1 ring-black/5"
                  style={{ background: 'var(--bg-mist)' }}
                  onClick={(e) => { e.stopPropagation(); onViewImage(task.image_url) }}
                >
                  {task.image_url ? (
                    (() => {
                      const taskPages = task.pages || (task.images ? task.images.map((img, i) => ({ ...img, id: img.id || `page-${i}` })) : null)
                      const isMultiPage = taskPages && taskPages.length > 1
                      if (isMultiPage) {
                        return (
                          <div className="relative w-full h-full">
                            {taskPages.slice(0, 3).map((page, index) => (
                              <div
                                key={page.id || index}
                                className="absolute inset-0 rounded overflow-hidden"
                                style={{
                                  transform: `translateX(${index * 2}px) translateY(${index * 2}px)`,
                                  zIndex: index,
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                }}
                              >
                                <img
                                  src={page.image_url || task.image_url}
                                  alt={`Page ${page.page_number}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                            {taskPages.length > 3 && (
                              <div className="absolute inset-0 rounded bg-[var(--bg-secondary)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
                                +{taskPages.length - 3}页
                              </div>
                            )}
                          </div>
                        )
                      }
                      return <img src={task.image_url} alt="" className="w-full h-full object-cover" />
                    })()
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText size={16} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  )}

                  {(() => {
                    const taskPages = task.pages || (task.images ? task.images.map((img, i) => ({ ...img, id: img.id || `page-${i}` })) : null)
                    return taskPages && taskPages.length > 1 ? (
                      <div className="absolute -top-1 -right-1 bg-purple-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium border-2 border-white shadow-sm">
                        {taskPages.length}
                      </div>
                    ) : null
                  })()}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {task.task_type === 'retry_paper' && (
                      <span
                        className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--purple)' }}
                        title="错题重练"
                      />
                    )}
                    <span className="text-card-title truncate">
                      {task.original_name || '未命名试卷'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-meta">
                      {dayjs(task.created_at).format('MM/DD HH:mm')}
                    </span>
                    {task.result?.questionCount ? (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-secondary)' }} />
                        <span className="text-meta-highlight">{task.result.questionCount} 题</span>
                      </>
                    ) : null}

                    {(() => {
                      const taskPages = task.pages || (task.images ? task.images.map((img, i) => ({ ...img, id: img.id || `page-${i}` })) : null)
                      return taskPages && taskPages.length > 1 ? (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-secondary)' }} />
                          <span className="text-meta-highlight">{taskPages.length} 页</span>
                        </>
                      ) : null
                    })()}
                    {!isTaskCompleted(task) && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-secondary)' }} />
                        {(() => {
                          const pendingMinutes = dayjs().diff(dayjs(task.created_at), 'minute')

                          // 上传中的临时任务：明确的"上传中"状态（区别于排队/批改）
                          if (task.is_temp) {
                            return (
                              <span className="inline-flex items-center gap-1 text-meta" style={{ color: 'var(--primary)' }}>
                                <Loader2 size={11} className="animate-spin" style={{ color: 'var(--primary)' }} />
                                上传中...
                              </span>
                            )
                          }

                          if (task.status === 'processing') {
                            return (
                              <span className="inline-flex items-center gap-1 text-meta" style={{ color: 'var(--primary)' }}>
                                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--primary)' }} />
                                批改中
                              </span>
                            )
                          }

                          if (task.status === 'failed') {
                            return (
                              <span className="inline-flex items-center gap-1 text-meta" style={{ color: 'var(--danger)' }}>
                                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
                                识别失败
                                <button
                                  onClick={(e) => { e.stopPropagation(); onRetryTask(task.id) }}
                                  className="rounded text-[10px] font-medium px-1.5 py-0.5 transition-colors tap-scale"
                                  style={{
                                    border: '1px solid var(--danger)',
                                    background: 'var(--danger-soft)',
                                    color: 'var(--danger)',
                                  }}
                                >
                                  重试
                                </button>
                              </span>
                            )
                          }

                          return (
                            <span className="inline-flex items-center gap-1 text-meta" style={{ color: pendingMinutes > 30 ? 'var(--danger)' : 'var(--warning)' }}>
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: pendingMinutes > 30 ? 'var(--danger)' : 'var(--warning)' }} />
                              等待中 ({pendingMinutes}分钟)
                            </span>
                          )
                        })()}
                      </>
                    )}
                  </div>
                  {!isTaskCompleted(task) && (task.is_temp || task.status === 'processing') && (
                    <div className="relative mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-secondary)' }}>
                      <motion.div
                        className="absolute inset-y-0 rounded-full"
                        style={{ background: 'var(--primary)' }}
                        animate={{ left: ['-30%', '100%'] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                      />
                    </div>
                  )}
                  {isTaskCompleted(task) && task.result?.questionCount ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="stat-pill" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                        <Check size={10} />
                        正确 {task.result?.questionCount - (task.result?.wrongCount || 0) - (task.result?.emptyCount || 0)}
                      </span>
                      <span className="stat-pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                        <X size={10} />
                        错误 {task.result?.wrongCount || 0}
                      </span>
                      {task.result?.emptyCount > 0 && (
                        <span className="stat-pill" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                          <AlertCircle size={10} />
                          空题 {task.result.emptyCount}
                        </span>
                      )}
                    </div>
                  ) : null}
                  {task.status === 'failed' && task.result?.error && (
                    <p className="text-meta mt-0.5" style={{ color: 'var(--danger)' }}>
                      {task.result.error}
                    </p>
                  )}
                </div>
              </div>
              </motion.div>
            </SwipeableRow>
          ))
        )}
      </section>
    </motion.div>
  )
}
