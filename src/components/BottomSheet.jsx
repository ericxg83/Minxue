import { X } from 'lucide-react'
import { motion } from 'motion/react'

// 移动端详情弹窗统一骨架：遮罩 + spring 进场 + 把手条 + 标题行(含关闭) + 可滚动主体 + 可选固定页脚。
// 组卷详情 / 错题详情 / 批改复核三处共用，保证「详情→就地动作」形态一致。
export default function BottomSheet({
  title,
  onClose,
  header,
  footer,
  children,
  bodyClassName = 'px-5 pb-4',
  maxWidth = 512,
}) {
  return (
    <div className='fixed inset-0 z-[20000] flex items-center justify-center px-4'>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className='relative mx-auto flex w-full flex-col overflow-hidden rounded-3xl bg-white shadow-xl'
        style={{
          maxWidth,
          maxHeight: 'min(85vh, 720px)',
          paddingBottom: footer ? 'env(safe-area-inset-bottom, 0px)' : 'calc(16px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* 把手条 */}
        <div className='flex shrink-0 justify-center pt-3 pb-1'>
          <div className='h-1 w-8 rounded-full' style={{ background: 'var(--border)' }} />
        </div>

        {/* 标题行 */}
        <div className='flex shrink-0 items-center justify-between px-5 pt-1 pb-2'>
          <h3 className='text-[16px] font-semibold' style={{ color: 'var(--text)' }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label='关闭'
            className='flex h-7 w-7 items-center justify-center rounded-full'
            style={{ background: 'var(--bg-mist)' }}
          >
            <X size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {header && <div className='shrink-0'>{header}</div>}

        <div className={bodyClassName} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          {children}
        </div>

        {footer && <div className='shrink-0'>{footer}</div>}
      </motion.div>
    </div>
  )
}
