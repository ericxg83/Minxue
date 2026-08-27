import { AlertCircle, CheckCircle2, RotateCcw, X } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import MathText from './MathText'
import { normalizeOptions } from '../utils/optionText'

// 状态词汇与错题本列表 Tab 对齐：待复习 / 复习中 / 已掌握
const statusMap = {
  new: { text: '待复习', color: 'var(--warning)', soft: 'var(--warning-soft)', icon: AlertCircle },
  review_1: { text: '复习中 · 第 1 轮', color: 'var(--primary)', soft: 'var(--primary-soft)', icon: RotateCcw },
  review_2: { text: '复习中 · 第 2 轮', color: 'var(--primary)', soft: 'var(--primary-soft)', icon: RotateCcw },
  mastered: { text: '已掌握', color: 'var(--success)', soft: 'var(--success-soft)', icon: CheckCircle2 }
}

// 错题详情：完整题面 + 重练动作集中在这里（对齐 ExamDetailModal 骨架）。
// 不提供编辑/删除——编辑去 PC 工作台，删除走列表左滑。
export default function WrongQuestionDetailModal({ wrongQuestion, onClose, onRetry, onViewImage }) {
  const wq = wrongQuestion
  const q = wq.question || wq
  const tags = q.tags_source === 'manual' ? (q.manual_tags || []) : (q.ai_tags || [])
  const status = statusMap[wq.lifecycle_status || 'new'] || statusMap.new
  const StatusIcon = status.icon
  const date = dayjs(wq.added_at || wq.created_at)
  const wrongTimes = (wq.error_count || 1) > 1 ? `错过${wq.error_count}次` : (wq.error_type || '需要关注')

  return <div className='absolute inset-0 z-[20000] flex items-center justify-center px-4'>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className='absolute inset-0 bg-black/50 backdrop-blur-sm'
      onClick={onClose}
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className='relative w-full max-w-lg mx-auto rounded-3xl bg-white shadow-xl'
      style={{ maxHeight: 'min(85vh, 720px)', display: 'flex', flexDirection: 'column', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className='flex justify-center pt-3 pb-1'>
        <div className='h-1 w-8 rounded-full' style={{ background: 'var(--border)' }} />
      </div>
      <div className='flex items-center justify-between px-5 pt-1 pb-2'>
        <h3 className='text-[16px] font-semibold' style={{ color: 'var(--text)' }}>错题详情</h3>
        <button
          onClick={onClose}
          className='flex h-7 w-7 items-center justify-center rounded-full'
          style={{ background: 'var(--bg-mist)' }}
          aria-label='关闭'
        >
          <X size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>
      <div className='overflow-y-auto px-5 pb-4'>
        {/* 档案身份块（对齐组卷详情） */}
        <div className='flex items-start gap-3'>
          <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl' style={{ background: status.soft, color: status.color }}>
            <StatusIcon size={18} />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-[15px] font-semibold' style={{ color: status.color }}>{status.text}</p>
            <p className='mt-0.5 truncate text-[12px]' style={{ color: 'var(--text-secondary)' }}>
              {date.isValid() ? date.format('YYYY/MM/DD') : ''}{date.isValid() ? ' · ' : ''}{wrongTimes}
            </p>
          </div>
        </div>

        {/* 题干 */}
        <div className='mt-4' style={{ fontSize: 'var(--fs-14)', lineHeight: 1.7, color: 'var(--text)' }}>
          <MathText content={q.content || '（无题干）'} />
        </div>

        {/* 选项 */}
        {Array.isArray(q.options) && q.options.length > 0 && (
          <div className='mt-3 space-y-1.5'>
            {normalizeOptions(q.options).map((opt, i) => {
              const letter = String.fromCharCode(65 + i)
              return (
                <div key={i} className='flex items-start gap-2 text-[13px]' style={{ color: 'var(--text)' }}>
                  <span className='font-medium flex-shrink-0'>{letter}.</span>
                  <span className='flex-1'><MathText content={opt} /></span>
                </div>
              )
            })}
          </div>
        )}

        {/* 配图 */}
        {q.image_url && (
          <div className='mt-3'>
            <button
              onClick={() => onViewImage(q.image_url)}
              className='w-full rounded-xl overflow-hidden block'
              style={{ background: 'var(--bg-secondary)' }}
            >
              <img
                src={q.image_url}
                alt='配图'
                loading='lazy'
                className='w-full object-cover'
                style={{ maxHeight: '260px' }}
                onError={(e) => {
                  // 图片加载失败（如历史错误截图）→ 自动回退到整页原图，保证能看到本题
                  const full = q.full_image_url
                  if (full && e.currentTarget.src !== full) {
                    e.currentTarget.src = full
                  } else {
                    e.currentTarget.style.display = 'none'
                  }
                }}
              />
            </button>
            {q.full_image_url && q.full_image_url !== q.image_url && (
              <button
                onClick={() => onViewImage(q.full_image_url)}
                className='mt-2 w-full py-2 rounded-lg text-[12px] font-medium'
                style={{ background: 'var(--primary-soft)', color: 'var(--primary-hover)' }}
              >
                查看完整原图（含本题）
              </button>
            )}
          </div>
        )}

        {/* 答案 */}
        {q.answer && (
          <div className='mt-3 rounded-lg px-3 py-2' style={{ background: 'var(--success-soft)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--success)', fontWeight: 600 }}>答案 </span>
            <span style={{ fontSize: 'var(--fs-13)', color: 'var(--success)' }}>{q.answer}</span>
          </div>
        )}

        {/* 解析 */}
        {q.analysis && (
          <div className='mt-2 rounded-lg px-3 py-2' style={{ background: 'var(--bg-mist)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', fontWeight: 600 }}>解析 </span>
            <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}><MathText content={q.analysis} /></span>
          </div>
        )}

        {/* 标签 */}
        {tags.length > 0 && (
          <div className='flex flex-wrap gap-1.5 mt-3'>
            {tags.map((tag, idx) => (
              <span key={idx} style={{ fontSize: 'var(--fs-11)', padding: '2px 8px', borderRadius: 'var(--radius-8)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 提示（对齐组卷详情的 info banner） */}
        <div className='mt-5 flex items-start gap-2.5 rounded-2xl px-3.5 py-3' style={{ background: 'var(--info-soft, var(--primary-soft))' }}>
          <AlertCircle size={15} className='mt-0.5 shrink-0' style={{ color: 'var(--primary)' }} />
          <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
            需要修改题干 / 答案 / 标签？请到 <b style={{ color: 'var(--text)' }}>PC 端工作台 · 错题本</b> 中编辑。
          </p>
        </div>

        {/* 动作栈（对齐组卷详情：整宽堆叠，主操作用主色实心） */}
        <div className='mt-4 space-y-2.5'>
          <button
            type='button'
            onClick={() => onRetry(wq)}
            className='flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]'
            style={{ background: 'var(--primary)' }}
          >
            <RotateCcw size={16} />只练这道题
          </button>
        </div>
      </div>
    </motion.div>
  </div>
}
