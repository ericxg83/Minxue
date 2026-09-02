import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, FileText, X } from 'lucide-react'
import { getResources } from '../../services/apiService'
import EmptyState from '../EmptyState'

// 移动端：选试卷答案库（仅 published）
// 数据源 getResources({ type: 'exam', status: 'published' })
// 老师选完后 onSelect({ resourceId, resourceName }) 由 App.jsx 注入 pendingUploadStore
export default function ExamResourcePicker({ visible, onClose, onSelect, subject }) {
  const [resources, setResources] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible) loadResources()
  }, [visible, subject])

  const loadResources = async () => {
    setLoading(true)
    try {
      const list = await getResources({ type: 'exam', status: 'published' })
      setResources(list || [])
    } catch (e) {
      console.error('加载试卷答案库失败:', e)
    }
    setLoading(false)
  }

  const filtered = resources.filter(r =>
    (!subject || r.subject === subject) &&
    (!search || (r.name || '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <AnimatePresence>
      {visible && (
        <div className="absolute inset-0 z-[25000] flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative bg-white rounded-t-3xl w-full max-w-lg mx-auto shadow-xl"
            style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>

            <div className="px-6 pt-2 pb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>选择试卷答案库</h3>
                <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                  <X size={18} />
                </button>
              </div>

              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="搜索答案库..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[14px] outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
                />
              </div>

              <div className="max-h-[50vh] overflow-y-auto -mx-2">
                {loading ? (
                  <div className="text-center py-8 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                    加载中...
                  </div>
                ) : filtered.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    iconSize={40}
                    title={search ? '未找到匹配的答案库' : '暂无已发布的试卷答案库'}
                    description="请先在 PC 端批改试卷并完成复核（自动发布）"
                    className="py-8"
                  />
                ) : filtered.map(r => (
                  <button
                    key={r.id}
                    onClick={() => {
                      onSelect({ resourceId: r.id, resourceName: r.name })
                      onClose()
                    }}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98] text-left mb-1"
                    style={{ background: 'transparent' }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--primary-soft)' }}>
                      <FileText size={20} style={{ color: 'var(--primary)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-medium truncate" style={{ color: 'var(--text)' }}>
                        {r.name}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {r.grade || ''} {r.subject || ''} · {r.answer_count || 0} 题
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  onSelect({ resourceId: null, resourceName: null })
                  onClose()
                }}
                className="w-full py-3.5 rounded-2xl text-[15px] font-medium transition-colors active:scale-[0.98] mt-3"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                不用答案库
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}