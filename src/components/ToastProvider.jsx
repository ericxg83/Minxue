import { createContext, useContext, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const ToastContext = createContext(null)

// Hard cap so a forgotten dismiss can never leave a loading toast on screen forever.
const LOADING_MAX_DURATION = 30000

function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] flex flex-col items-center gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`px-4 py-2.5 rounded-xl shadow-lg backdrop-blur-md flex items-center gap-2 pointer-events-auto ${
              toast.type === 'success' ? 'bg-green-600/90 text-white' :
              toast.type === 'error' ? 'bg-red-500/90 text-white' :
              toast.type === 'loading' ? 'bg-blue-600/90 text-white' :
              'bg-gray-900/90 text-white'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} />}
            {toast.type === 'error' && <XCircle size={18} />}
            {toast.type === 'loading' && <Loader2 size={18} className="animate-spin" />}
            <span className="text-[13px] font-medium">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})
  const idSeq = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts(prev => {
      const idsToRemove = id == null ? prev.map(t => t.id) : [id]
      idsToRemove.forEach(tid => {
        if (timers.current[tid]) {
          clearTimeout(timers.current[tid])
          delete timers.current[tid]
        }
      })
      return id == null ? [] : prev.filter(t => t.id !== id)
    })
  }, [])

  const show = useCallback(({ message, type = 'info', duration = 2000 }) => {
    const id = ++idSeq.current

    // Only one loading toast at a time: replace any existing loading toast
    // instead of stacking them into a pile.
    setToasts(prev => {
      const loadingToasts = prev.filter(t => t.type === 'loading')
      const filtered = type === 'loading' ? prev.filter(t => t.type !== 'loading') : prev
      if (type === 'loading') {
        loadingToasts.forEach(t => {
          if (timers.current[t.id]) {
            clearTimeout(timers.current[t.id])
            delete timers.current[t.id]
          }
        })
      }
      return [...filtered, { id, message, type }]
    })

    // Loading toasts (even duration: 0) always get an auto-dismiss safety cap.
    const liveDuration = type === 'loading' && duration <= 0 ? LOADING_MAX_DURATION : duration
    if (liveDuration > 0) {
      timers.current[id] = setTimeout(() => dismiss(id), liveDuration)
    }

    return { id, dismiss: () => dismiss(id) }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ show, dismiss, toasts }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}
