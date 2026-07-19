import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, FileText, Check, X } from 'lucide-react'

export default function ExamPicker({ visible, onClose, onSelect, subject }) {
  const [resources, setResources] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible) {
      loadExamResources()
    }
  }, [visible, subject])

  const loadExamResources = async () => {
    setLoading(true)
    try {
      const qs = subject ? `?subject=${encodeURIComponent(subject)}` : ''
      const response = await fetch(`/api/resources/exam-papers${qs}`)
      const data = await response.json()
      if (data.success) {
        setResources(data.resources || [])
      }
    } catch (e) {
      console.error('加载试卷答案库失败:', e)
    }
    setLoading(false)
  }

  const handleSelect = (resource) => {
    onSelect({ resourceId: resource.id, resourceName: resource.name })
    onClose()
  }

  const filtered = resources.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
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
            {/* 拖动条 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>

            <div className="px-6 pt-2 pb-4">
              <h3 className="text-center text-[17px] font-semibold text-[var(--text)] mb-1">选择试卷答案库</h3>
              <p className="text-center text-[13px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
                选择已有标准答案的试卷，上传后自动批改
              </p>

              {/* 搜索 */}
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="搜索试卷..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[14px] outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
                />
              </div>

              {/* 列表 */}
              <div className="max-h-[50vh] overflow-y-auto -mx-2">
                {loading ? (
                  <div className="text-center py-8 text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
                    加载中...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText size={40} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                    <div className="text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
                      {search ? '未找到匹配的试卷' : '暂无已发布的试卷答案库'}
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      请先在 PC 端审核并发布试卷答案库
                    </div>
                  </div>
                ) : filtered.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98] text-left mb-1"
                    style={{ background: 'transparent' }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(217, 119, 6, 0.1)' }}>
                      <FileText size={20} style={{ color: '#D97706' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-medium truncate" style={{ color: 'var(--text)' }}>
                          {r.name}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: 'rgba(217, 119, 6, 0.1)', color: '#D97706' }}>
                          答案库
                        </span>
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {r.grade || ''} {r.subject || ''} · {r.answer_count || 0} 题
                      </div>
                    </div>
                    <Check size={18} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                  </button>
                ))}
              </div>

              {/* 不使用答案库 */}
              <button
                onClick={() => {
                  onSelect({ resourceId: null, resourceName: null })
                  onClose()
                }}
                className="w-full py-3.5 rounded-2xl text-[15px] font-medium transition-colors active:scale-[0.98] mt-3"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                不使用答案库
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}