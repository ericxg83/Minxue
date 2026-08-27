import { AlertCircle, Camera, ChevronRight, Clock3, FileCheck2, Wand2 } from 'lucide-react'
import { motion } from 'motion/react'
import { MobileSectionHeading } from '../features/mobile/MobilePrimitives'

const done = new Set(['done', 'graded', 'completed', 'reviewed'])
const complete = (task) => done.has(task.status) || Boolean(task.result?.questionCount)
const failed = (task) => task.status === 'failed'
// 服务重启/worker 崩溃会让任务永久停在 processing，仅看 status 首页会永远挂"批改中"
// 且每次进首页都复活这个提醒。与作业页同一口径：超过 30 分钟即判超时，引导去重试。
const STALL_MS = 30 * 60 * 1000
const stalled = (task) => !complete(task) && !failed(task) && (Date.now() - new Date(task.started_at || task.created_at || 0).getTime() > STALL_MS)
const processing = (task) => !complete(task) && !failed(task) && !stalled(task)

// 主行动：永远存在、视觉权重最高，无论有没有错题/失败都不会被挤掉
function PrimaryAction({ onClick }) {
  return <button type='button' onClick={onClick} className='flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left shadow-sm transition-transform active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2' style={{ background: 'var(--primary)', color: '#fff' }}>
    <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl' style={{ background: 'rgba(255,255,255,.16)' }}><Camera size={22} aria-hidden='true' /></span>
    <span className='min-w-0 flex-1'><span className='block text-[16px] font-semibold'>上传今天的作业</span><span className='mt-0.5 block text-[12px] opacity-80'>拍照或选图，AI 批改后自动整理错题</span></span>
    <ChevronRight size={20} aria-hidden='true' />
  </button>
}

// 状态提醒卡：整行可点 + 右侧箭头，颜色区分紧急度
function ReminderCard({ icon, tone = 'neutral', title, detail, onClick }) {
  const tones = {
    neutral: { chipBg: 'var(--primary-soft)', chipColor: 'var(--primary)' },
    info: { chipBg: 'var(--info-soft)', chipColor: 'var(--info)' },
    success: { chipBg: 'var(--success-soft)', chipColor: 'var(--success)' },
  }
  const t = tones[tone] || tones.neutral
  return <button type='button' onClick={onClick} className='flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]' style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)' }}>
    <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl' style={{ background: t.chipBg, color: t.chipColor }}>{icon}</span>
    <span className='min-w-0 flex-1'><span className='block truncate text-[14px] font-medium' style={{ color: 'var(--text)' }}>{title}</span><span className='mt-0.5 block truncate text-[12px]' style={{ color: 'var(--text-secondary)' }}>{detail}</span></span>
    <ChevronRight size={16} aria-hidden='true' style={{ color: 'var(--text-tertiary)' }} />
  </button>
}

// 失败卡：双出口——重新提交 / 忽略，不再是"必须处理"的死胡同
function FailedCard({ onRetry, onDismiss }) {
  return <div className='rounded-2xl border px-4 py-3.5' style={{ background: 'var(--warning-soft)', borderColor: 'rgba(217,119,6,.25)' }}>
    <div className='flex items-start gap-3'>
      <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl' style={{ background: 'rgba(217,119,6,.14)', color: 'var(--warning)' }}><AlertCircle size={18} aria-hidden='true' /></span>
      <div className='min-w-0 flex-1'><p className='text-[14px] font-medium' style={{ color: 'var(--text)' }}>上次作业没能批改完成</p><p className='mt-0.5 text-[12px]' style={{ color: 'var(--text-secondary)' }}>可以重新提交再试一次，或先忽略这份</p></div>
    </div>
    <div className='mt-3 flex gap-2'>
      <button type='button' onClick={onRetry} className='flex-1 rounded-xl py-2 text-[13px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]' style={{ background: 'var(--warning)' }}>重新提交</button>
      <button type='button' onClick={onDismiss} className='rounded-xl px-4 py-2 text-[13px] font-medium transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]' style={{ background: 'rgba(0,0,0,.04)', color: 'var(--text-secondary)' }}>忽略</button>
    </div>
  </div>
}

export default function HomeDashboardV2({ currentStudent, tasks, isInitializing, pendingWrongCount = 0, onStartUpload, onOpenTasks, onStartPriorityRetry, onRetryTask, onDismissTask }) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((task) => task.student_id === currentStudent?.id).sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
  const failedTask = list.find(failed)
  const activeTask = list.find(processing)
  const stalledTask = list.find(stalled)
  const latest = list.find(complete)

  // 状态提醒，按紧急度排序：批改中 > 结果就绪 > 智能推荐重练（失败单独用 FailedCard 置顶）。
  // 首页是决策层：提醒卡只导航或发起流程，打开批改结果的动作归作业页列表行。
  const reminders = []
  if (!isInitializing && stalledTask) reminders.push({ key: 'stalled', icon: <AlertCircle size={18} />, tone: 'info', title: '上次作业处理超时', detail: 'AI 没有按时完成批改，去作业页重新处理', onClick: onOpenTasks })
  if (!isInitializing && activeTask) reminders.push({ key: 'active', icon: <Clock3 size={18} />, tone: 'info', title: '作业批改中', detail: '完成后会自动归入错题本', onClick: onOpenTasks })
  if (!isInitializing && latest) {
    const wrong = latest.result?.wrongCount
    reminders.push({ key: 'latest', icon: <FileCheck2 size={18} />, tone: wrong ? 'neutral' : 'success', title: wrong ? `上次作业已批改 · ${wrong} 道错题` : '上次作业已批改，表现不错', detail: wrong ? '去作业页查看被标出的题目和讲解' : `${latest.result?.questionCount || '全部'} 题已完成，继续保持`, onClick: onOpenTasks })
  }
  if (!isInitializing && pendingWrongCount > 0) reminders.push({ key: 'priorityRetry', icon: <Wand2 size={18} />, tone: 'neutral', title: `重点重练 · ${pendingWrongCount} 道错题待巩固`, detail: 'AI 挑选最需要巩固的错题，一键生成重练卷', onClick: onStartPriorityRetry })

  const empty = !isInitializing && !failedTask && reminders.length === 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    <header className='mb-5'><h1 className='truncate text-[24px] font-semibold tracking-[-0.04em]' style={{ color: 'var(--text)' }}>{isInitializing ? '正在准备学习数据…' : `${greeting}，${currentStudent?.name || '同学'}`}</h1></header>

    <section aria-label='上传作业' className='mb-6'><PrimaryAction onClick={onStartUpload} /></section>

    <section aria-label='待处理事项'>
      <MobileSectionHeading title='待处理' description={isInitializing ? '正在同步最新记录' : undefined} action='查看作业' onAction={onOpenTasks} />
      <div className='flex flex-col gap-2.5'>
        {isInitializing && <ReminderCard icon={<Clock3 size={18} />} tone='info' title='正在同步学习记录' detail='稍后会显示最新状态' onClick={onOpenTasks} />}
        {!isInitializing && failedTask && <FailedCard onRetry={() => onRetryTask?.(failedTask.id)} onDismiss={() => onDismissTask?.(failedTask.id)} />}
        {reminders.map((r) => <ReminderCard key={r.key} icon={r.icon} tone={r.tone} title={r.title} detail={r.detail} onClick={r.onClick} />)}
        {empty && <div className='rounded-2xl border border-dashed px-4 py-5 text-center' style={{ borderColor: 'var(--border-light)' }}><p className='text-[13px] font-medium' style={{ color: 'var(--text-secondary)' }}>今天还没有待处理的作业</p><p className='mt-0.5 text-[12px]' style={{ color: 'var(--text-tertiary)' }}>上传一份作业，就从这里开始</p></div>}
      </div>
    </section>
  </motion.main>
}
