import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

/**
 * 项目级 Promise-based 确认弹窗
 *
 * 用法：
 *   const ok = await showConfirm({
 *     title: '首次复核',
 *     message: '📌 这份试卷将作为答案库留底保存。\n\n确认？',
 *     confirmText: '确认留底',
 *     cancelText: '取消',
 *     type: 'info'  // 'info' | 'warning' | 'success'
 *   })
 *   if (!ok) return  // 老师点取消
 *
 * - 单一全局实例：调用 showConfirm 时旧的会立即被替换（resolve(false)）
 * - 通过 Portal 渲染到 body，绕过父组件 overflow/z-index
 * - 弹窗打开时锁滚动
 *
 * 与 ToastProvider 同款：模块级 state + setState 引用，单组件挂到根。
 */

let moduleState = {
  visible: false,
  options: null,        // { title, message, confirmText, cancelText, type }
  resolve: null,        // (ok: boolean) => void
}
let setModuleState = null  // 由 ConfirmDialogHost 注册

export const showConfirm = (options = {}) => {
  return new Promise((resolve) => {
    // 替换旧弹窗：先关掉旧的（resolve false）
    if (moduleState.visible && moduleState.resolve) {
      try { moduleState.resolve(false) } catch {}
    }
    moduleState = {
      visible: true,
      options: {
        title: '确认',
        confirmText: '确认',
        cancelText: '取消',
        type: 'info',
        ...options,
      },
      resolve,
    }
    if (setModuleState) setModuleState({ ...moduleState })
  })
}

const ICONS = {
  info: { Icon: Info, bg: 'var(--primary-soft)', color: 'var(--primary)' },
  warning: { Icon: AlertCircle, bg: 'var(--warning-soft)', color: 'var(--warning)' },
  success: { Icon: CheckCircle2, bg: 'var(--success-soft)', color: 'var(--success)' },
  danger: { Icon: AlertCircle, bg: 'var(--danger-soft)', color: 'var(--danger)' },
}

function ConfirmDialogHost() {
  const [state, setState] = useState(moduleState)

  useEffect(() => {
    setModuleState = setState
    return () => { setModuleState = null }
  }, [])

  // 锁滚动
  useEffect(() => {
    if (!state.visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [state.visible])

  const close = useCallback((ok) => {
    if (state.resolve) {
      try { state.resolve(ok) } catch {}
    }
    setState((s) => ({ ...s, visible: false, resolve: null }))
  }, [state.resolve])

  // ESC 关闭 = 取消
  useEffect(() => {
    if (!state.visible) return
    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state.visible, close])

  if (typeof document === 'undefined') return null

  const opts = state.options || {}
  const iconMeta = ICONS[opts.type] || ICONS.info
  const { Icon, bg, color } = iconMeta

  return createPortal(
    <AnimatePresence>
      {state.visible && (
        <motion.div
          key="confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[30000] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => close(false)}
        >
          <motion.div
            key="confirm-card"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="card mx-5 w-full max-w-sm"
            style={{ padding: '24px', background: 'var(--card)', borderRadius: 'var(--radius-16)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: bg }}
              >
                <Icon size={20} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>
                  {opts.title}
                </h3>
                <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                  {opts.message}
                </p>
              </div>
              <button
                onClick={() => close(false)}
                className="flex-shrink-0 -mr-1 -mt-1 p-1 rounded-lg transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => close(false)}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium transition-colors active:scale-[0.98]"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {opts.cancelText}
              </button>
              <button
                ref={(el) => el && setTimeout(() => el.focus(), 0)}
                onClick={() => close(true)}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white transition-colors active:scale-[0.98]"
                style={{ background: color === 'var(--primary)' ? 'var(--primary)' : color }}
              >
                {opts.confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ConfirmDialogHost
