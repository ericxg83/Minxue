import { AlertCircle, Camera, CheckCircle2, ChevronRight, Clock3, Loader2, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import SwipeableRow from '../components/SwipeableRow'
import { MobileList, MobileSegmentedTabs, MobileTextAction } from '../features/mobile/MobilePrimitives'

const done = new Set(['done', 'graded', 'completed', 'reviewed'])
const active = new Set(['processing', 'queued', 'pending'])
const complete = t => done.has(t.status) || Boolean(t.result?.questionCount)
const retry = t => t.task_type === 'retry_paper' || t.task_type === 'wrong_retry'
const time = v => dayjs(v).isValid() ? dayjs(v).format('MM/DD HH:mm') : '刚刚'

// 已耗时 mm:ss（processing 用）；卡死时显示"已卡 N 分钟"
const formatElapsed = (start) => {
  const t = start ? new Date(start).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec} 秒`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} 分${sec % 60} 秒`
  return `${m} 分钟`
}
const formatStalled = (start) => {
  const t = start ? new Date(start).getTime() : Date.now()
  const m = Math.floor((Date.now() - t) / 60000)
  return m >= 1 ? `已卡 ${m} 分钟` : '处理超时'
}

// 服务重启/worker 崩溃会让任务永久停在 processing，仅看 status 会一直转圈且无重试入口。
// 用 started_at 实时判定超时，不落库——避免为此新增第五种任务状态。
// 排队期（还没被 worker 接手、started_at 为空）给更长缓冲，避免攒在队列里就被误判超时。
const STALL_MS = 30 * 60 * 1000
const QUEUE_STALL_MS = 60 * 60 * 1000
const stage = t => t.status === 'failed' ? 'failed'
  : active.has(t.status) ? (Date.now() - new Date(t.started_at || t.created_at).getTime() > (t.started_at ? STALL_MS : QUEUE_STALL_MS) ? 'stalled' : 'processing')
  : complete(t) ? 'completed' : 'waiting'

// 失败原因分类：旧文案一律写「图片处理没有完成」，会把 AI 输出格式问题误导成图片问题，
// 用户照着重拍会走同一条路再次失败。
// 2026-09-02 朱思诺事故：worker 写 jsonb 列失败，PG 报小写 "invalid input syntax for type json"，
// `/JSON|格式错误/` 是大小写敏感的，没匹配 → 走兜底文案「处理未完成，可重试」误导用户。
// 所有正则都加 /i 标志容忍大小写，并补 PG/数据库错误关键词。
const failReason = t => {
  const e = String(t.last_error || t.result?.error || '')
  if (/json|格式错误|syntax error|invalid input/i.test(e)) return 'AI 识别结果格式异常，可重试'
  if (/配额|quota|限流|rate.?limit|429/i.test(e)) return 'AI 服务配额不足，稍后重试'
  if (/超时|timeout/i.test(e)) return 'AI 服务响应超时，可重试'
  if (/分辨率|空白|无法识别|看不清|很抱歉/i.test(e)) return '图片不够清晰，建议重拍'
  if (/下载图片失败|URL|OSS|上传未成功|未成功完成/i.test(e)) return '图片上传未完成，请重新上传'
  return '处理未完成，可重试'
}

// 一行摘要：错/空/待复核 三桶互斥，都是批改 result 里的权威计数，各配状态色。
// 「待复核」必须单独成桶——非空但 AI 判不出的题（答案库无匹配 / 置信度不足）既不进
// wrongCount 也不进 emptyCount，早期只看这两个数会把它们静默归入"全对"，
// 出现列表写「7 道题全部正确」、点进复核页却显示「需处理 4」的自相矛盾。
// 仍刻意不显示"对题数"——result 未落库 correctCount，前端相减不可靠（详见 DEVLOG.md 待办）。
function ResultSummary({ questionCount, wrong, empty, pending, truncated }) {
  if (wrong === 0 && empty === 0 && pending === 0 && !truncated) {
    return <>{questionCount ? `${questionCount} 道题全部正确` : '批改完成'}</>
  }
  const warning = 'var(--warning, #b45309)'
  const parts = []
  if (questionCount) parts.push(`共${questionCount}题`)
  if (wrong > 0) parts.push(<span key='wrong' style={{ color: 'var(--danger)' }}>错{wrong}</span>)
  if (empty > 0) parts.push(<span key='empty' style={{ color: warning }}>空{empty}</span>)
  if (pending > 0) parts.push(<span key='pending' style={{ color: warning }}>待复核{pending}</span>)
  if (truncated) parts.push(<span key='truncated' style={{ color: warning }}>可能有漏题</span>)
  const nodes = []
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(' · ')
    nodes.push(part)
  })
  return <>{nodes}</>
}

// 一行一动作：完成行整行可点开批改结果；失败/卡住行只保留"重新处理"；
// 处理中/等待行是纯状态展示，不可点（避免点开黑屏或无效跳转）。
function TaskRow({ task, onRetryTask, onOpenReview }) {
  const current = stage(task)
  const wrong = task.result?.wrongCount || 0
  const empty = task.result?.emptyCount || 0
  const pending = task.result?.pendingCount || 0
  const questionCount = task.result?.questionCount || task.question_count || 0
  const truncated = Number(task.result?.ocrTruncated) > 0
  const bad = current === 'failed' || current === 'stalled'
  const clickable = current === 'completed'
  const Icon = bad ? AlertCircle : current === 'processing' ? Loader2 : current === 'completed' ? CheckCircle2 : Clock3
  const pageCount = (Array.isArray(task.images) ? task.images.length : 0) || (Array.isArray(task.pages) ? task.pages.length : 0) || 0
  const isTemp = Boolean(task.is_temp) || (typeof task.id === 'string' && task.id.startsWith('temp-'))
  // 后端 result.progress 是 0-100 的真实批改进度；只有处理中且非 0/100 时显示百分比，
  // 避免把"刚创建/已结束"的任务也渲染成进度条。配合 5s 轮询实时刷新。
  const progress = Number(task.result?.progress)
  const showProgress = current === 'processing' && Number.isFinite(progress) && progress > 0 && progress < 100
  // 服务端任务显示落库的任务名（练习册名/科目+时间），重练卷保持固定名；旧数据回退"日常作业"
  const name = retry(task) ? '错题重练' : (task.original_name || '日常作业')
  const detail = current === 'failed' ? failReason(task)
    : current === 'stalled' ? formatStalled(task.started_at || task.created_at)
    : current === 'processing' && isTemp ? '正在上传图片'
    : current === 'processing' ? (showProgress ? `已耗时 ${formatElapsed(task.started_at || task.created_at)} · ${Math.round(progress)}%` : `已耗时 ${formatElapsed(task.started_at || task.created_at)}`)
    : current === 'completed'
      ? <ResultSummary questionCount={questionCount} wrong={wrong} empty={empty} pending={pending} truncated={truncated} />
    : '等待系统开始处理'

  const body = (
    <>
      <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg' style={{ background: bad ? 'var(--danger-soft)' : 'var(--primary-soft)', color: bad ? 'var(--danger)' : 'var(--primary)' }}>
        <Icon size={16} className={current === 'processing' ? 'animate-spin' : ''} />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-1.5 min-w-0'>
          <span className='block truncate text-[14px] font-semibold'>{name}</span>
          {pageCount > 1 && <span className='flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium' style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>共{pageCount}页</span>}
        </span>
        <span className='mt-0.5 block truncate text-[12px]' style={{ color: bad ? 'var(--danger)' : 'var(--text-secondary)' }}>
          {time(task.created_at)} · {detail}
        </span>
      </span>
      {clickable && <ChevronRight size={15} className='mt-1' style={{ color: 'var(--text-tertiary)' }} />}
    </>
  )

  return <div className='border-b px-0.5 py-3 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}>
    {clickable ? (
      <button type='button' onClick={() => onOpenReview(task)} className='flex w-full items-start gap-2.5 text-left'>
        {body}
      </button>
    ) : (
      <div className='flex items-start gap-2.5'>{body}</div>
    )}
    {bad && <div className='mt-1 pl-10'>
      <MobileTextAction onClick={() => onRetryTask(task.id)}><RotateCcw size={13} />{current === 'stalled' ? '重新处理' : '重新上传'}</MobileTextAction>
    </div>}
    {clickable && truncated && <div className='mt-1 pl-10'>
      <MobileTextAction onClick={() => onRetryTask(task.id)}><RotateCcw size={13} />重新识别</MobileTextAction>
    </div>}
  </div>
}

export default function ProcessingPageV2({ currentStudent, tasks, filteredTasks, isLoadingTasks, isInitializing, processingFilter, onFilterChange, onRetryTask, onOpenReview, onRefresh, onDeleteTask }) {
  const all = (Array.isArray(tasks) ? tasks : []).filter(t => t.student_id === currentStudent?.id)
  const visible = Array.isArray(filteredTasks) ? filteredTasks : []
  const tabs = [
    { id: 'all', label: '全部', count: all.length },
    { id: 'homework', label: '作业', count: all.filter(t => !retry(t)).length },
    { id: 'retry', label: '重练', count: all.filter(retry).length }
  ]
  // 有处理中任务时每 5s 拉一次最新进度（result.progress），让百分比实时上屏；
  // 全部任务都结束（done / failed / 无等待）就停轮询，避免无效请求。
  const hasInFlight = all.some(t => active.has(t.status) && stage(t) === 'processing')
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  useEffect(() => {
    if (!hasInFlight || typeof onRefreshRef.current !== 'function') return
    const id = setInterval(() => { onRefreshRef.current(false) }, 5000)
    return () => clearInterval(id)
  }, [hasInFlight])
  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    <MobileSegmentedTabs items={tabs} value={processingFilter} onChange={onFilterChange} ariaLabel='作业类型' />
    {isLoadingTasks || isInitializing
      ? <div className='space-y-3'>
          <div className='h-20 animate-pulse border-y' style={{ background: 'var(--bg-secondary)' }} />
          <div className='h-20 animate-pulse border-y' style={{ background: 'var(--bg-secondary)' }} />
        </div>
      : visible.length === 0
        ? <EmptyState icon={Camera} title='还没有作业记录' description='拍一份作业后，批改进度会显示在这里' className='py-16' />
        : <MobileList>{visible.map((task, index) => <SwipeableRow key={task.id || index} onDelete={onDeleteTask ? () => onDeleteTask(task.id) : undefined}><TaskRow task={task} onRetryTask={onRetryTask} onOpenReview={onOpenReview} /></SwipeableRow>)}</MobileList>}
    <p className='mt-4 text-[12px]' style={{ color: 'var(--text-tertiary)' }}>批改完成后，错题会自动进入错题本</p>
  </motion.div>
}
