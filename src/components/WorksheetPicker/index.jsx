import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, BookOpen, Check, X, Star } from 'lucide-react'
import { getWorksheets, getStudentWorksheetSetting, upsertStudentWorksheetSetting } from '../../services/apiService'
import { useStudentStore } from '../../store'

export default function WorksheetPicker({ visible, onClose, onSelect, subject }) {
  const { currentStudent } = useStudentStore()
  const [worksheets, setWorksheets] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [defaultId, setDefaultId] = useState(null)

  useEffect(() => {
    if (visible) {
      loadWorksheets()
      loadDefault()
    }
  }, [visible, subject, currentStudent])

  const loadWorksheets = async () => {
    setLoading(true)
    try {
      const all = await getWorksheets()
      // 只显示已发布 + 匹配科目
      const filtered = all.filter(w =>
        w.status === 'published' &&
        (!subject || w.subject === subject)
      )
      setWorksheets(filtered)
    } catch (e) {
      console.error('加载练习册失败:', e)
    }
    setLoading(false)
  }

  const loadDefault = async () => {
    if (!currentStudent || !subject) return
    try {
      const setting = await getStudentWorksheetSetting(currentStudent.id, subject)
      if (setting?.default_worksheet_id) {
        setDefaultId(setting.default_worksheet_id)
      }
    } catch (e) {
      // ignore
    }
  }

  const handleSelect = (worksheet) => {
    onSelect({ worksheetId: worksheet.id, worksheetName: worksheet.name })
    // 如果没有默认，自动保存为默认
    if (currentStudent && subject && !defaultId) {
      upsertStudentWorksheetSetting(currentStudent.id, subject, worksheet.id).catch(() => {})
    }
    onClose()
  }

  const handleSetDefault = async (worksheetId) => {
    if (!currentStudent || !subject) return
    try {
      await upsertStudentWorksheetSetting(currentStudent.id, subject, worksheetId)
      setDefaultId(worksheetId)
    } catch (e) {
      console.error('设置默认失败:', e)
    }
  }

  const filtered = worksheets.filter(w =>
    !search || w.name.toLowerCase().includes(search.toLowerCase())
  )

  // 默认练习册排最前
  const sorted = [...filtered].sort((a, b) => {
    if (a.id === defaultId) return -1
    if (b.id === defaultId) return 1
    return 0
  })

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
              <h3 className="text-center text-[17px] font-semibold text-[var(--text)] mb-4">选择练习册</h3>

              {/* 搜索 */}
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="搜索练习册..."
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
                ) : sorted.length === 0 ? (
                  <div className="text-center py-8">
                    <BookOpen size={40} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                    <div className="text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
                      {search ? '未找到匹配的练习册' : '暂无已发布的练习册'}
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      请先在 PC 端上传并发布练习册
                    </div>
                  </div>
                ) : sorted.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => handleSelect(ws)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98] text-left mb-1"
                    style={{ background: ws.id === defaultId ? 'var(--primary-soft)' : 'transparent' }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--accent-soft)' }}>
                      <BookOpen size={20} style={{ color: 'var(--accent)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-medium truncate" style={{ color: 'var(--text)' }}>
                          {ws.name}
                        </span>
                        {ws.id === defaultId && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: 'var(--primary)', color: '#fff' }}>
                            默认
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {ws.grade || ''} {ws.subject || ''} · {ws.answer_count || 0} 题
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetDefault(ws.id) }}
                      className="p-2 rounded-xl flex-shrink-0"
                      style={{ color: ws.id === defaultId ? 'var(--primary)' : 'var(--text-tertiary)' }}
                      title="设为默认"
                    >
                      <Star size={18} fill={ws.id === defaultId ? 'currentColor' : 'none'} />
                    </button>
                  </button>
                ))}
              </div>

              {/* 不使用练习册 */}
              <button
                onClick={() => {
                  onSelect({ worksheetId: null, worksheetName: null })
                  onClose()
                }}
                className="w-full py-3.5 rounded-2xl text-[15px] font-medium transition-colors active:scale-[0.98] mt-3"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                不使用练习册
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}