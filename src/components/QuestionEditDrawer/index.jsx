import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Save, Loader2 } from 'lucide-react'
import { usePendingQuestionStore } from '../../store'
import { updateQuestion } from '../../services/supabaseService'

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治']
const CATEGORIES = ['计算错误', '概念不清', '审题失误', '公式记错', '其他']

export default function QuestionEditDrawer({ questionId, visible, onClose, onSave }) {
  const { pendingQuestions, updatePendingQuestion } = usePendingQuestionStore()
  const [content, setContent] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [subject, setSubject] = useState('数学')
  const [category, setCategory] = useState('其他')
  const [isCorrect, setIsCorrect] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const contentRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (visible && questionId) {
      loadQuestion()
    }
  }, [visible, questionId])

  const loadQuestion = async () => {
    setLoading(true)
    try {
      const questionData = pendingQuestions.find(q => q.id === questionId)
      if (questionData) {
        setContent(questionData.content || '')
        setCorrectAnswer(questionData.correctAnswer || questionData.correct_answer || '')
        setSubject(questionData.subject || '数学')
        setCategory(questionData.category || '其他')
        setIsCorrect(questionData.is_correct !== undefined ? questionData.is_correct : false)
      }
    } catch (error) {
      console.error('加载题目失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const updatedQuestion = {
        id: questionId,
        content,
        correctAnswer: correctAnswer || undefined,
        correct_answer: correctAnswer || undefined,
        subject,
        category,
        is_correct: isCorrect,
        updated_at: new Date().toISOString()
      }
      await updateQuestion(questionId, updatedQuestion)
      updatePendingQuestion(questionId, updatedQuestion)
      onSave && onSave(updatedQuestion)
    } catch (error) {
      console.error('更新题目失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white rounded-t-3xl overflow-hidden z-[10001]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-[18px] font-bold text-slate-900">编辑题目</h2>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-gray-50 transition-colors"
              >
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto max-h-[70vh] no-scrollbar">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={32} className="text-blue-500 animate-spin mb-3" />
                  <p className="text-[14px] text-gray-400">加载中...</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Question Content */}
                  <div>
                    <label className="block text-[13px] font-bold text-gray-500 mb-2">题目内容</label>
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={4}
                      className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 text-[14px] focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
                    />
                  </div>

                  {/* Correct Answer */}
                  <div>
                    <label className="block text-[13px] font-bold text-gray-500 mb-2">正确答案</label>
                    <textarea
                      value={correctAnswer}
                      onChange={(e) => setCorrectAnswer(e.target.value)}
                      rows={2}
                      className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 text-[14px] focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
                      placeholder="请输入正确答案（选填）"
                    />
                  </div>

                  {/* Subject and Category */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-500 mb-2">科目</label>
                      <select
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 text-[14px] focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                      >
                        {SUBJECTS.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-gray-500 mb-2">分类</label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full p-4 bg-gray-50 rounded-xl border border-gray-100 text-[14px] focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                      >
                        {CATEGORIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Status Toggle */}
                  <div>
                    <label className="block text-[13px] font-bold text-gray-500 mb-3">识别状态</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setIsCorrect(true)}
                        className={`flex-1 py-3 px-4 rounded-xl border-2 text-[14px] font-bold transition-all ${
                          isCorrect
                            ? 'border-green-500 bg-green-50 text-green-600'
                            : 'border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}
                      >
                        识别正确
                      </button>
                      <button
                        onClick={() => setIsCorrect(false)}
                        className={`flex-1 py-3 px-4 rounded-xl border-2 text-[14px] font-bold transition-all ${
                          !isCorrect
                            ? 'border-red-500 bg-red-50 text-red-600'
                            : 'border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}
                      >
                        疑似错题
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {!loading && (
              <div className="px-6 py-4 border-t border-gray-100">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !content.trim()}
                  className="w-full py-4 rounded-2xl bg-blue-600 text-white text-[15px] font-bold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:opacity-80 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      保存
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>

          <style>{`
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
        </>
      )}
    </AnimatePresence>
  )
}
