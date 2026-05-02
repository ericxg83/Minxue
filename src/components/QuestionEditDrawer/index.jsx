import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Plus, Trash2 } from 'lucide-react'
import { usePendingQuestionStore } from '../../store'
import { updateQuestion } from '../../services/supabaseService'

export default function QuestionEditDrawer({ questionId, visible, onClose, onSave }) {
  const { pendingQuestions, updatePendingQuestion } = usePendingQuestionStore()
  
  const [activeTab, setActiveTab] = useState('stem')
  const [content, setContent] = useState('')
  const [options, setOptions] = useState([])
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [studentAnswer, setStudentAnswer] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [questionType, setQuestionType] = useState('选择题')
  const [displayImageUrl, setDisplayImageUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (visible && questionId) {
      loadQuestion()
    }
  }, [visible, questionId])

  const loadQuestion = async () => {
    setLoading(true)
    setActiveTab('stem')
    try {
      const questionData = pendingQuestions.find(q => q.id === questionId)
      if (questionData) {
        setContent(questionData.content || '')
        setOptions(cleanOptionPrefix(questionData.options || []))
        setCorrectAnswer(questionData.answer || questionData.correctAnswer || questionData.correct_answer || '')
        setStudentAnswer(questionData.student_answer || '')
        setAnalysis(questionData.analysis || '')
        setQuestionType(questionData.question_type || '选择题')
        setDisplayImageUrl('')
      }
    } catch (error) {
      console.error('加载题目失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const cleanOptionPrefix = (options) => {
    return (options || []).map(opt => {
      const cleaned = String(opt).replace(/^[A-Da-d][、.\.\s]*/, '').trim()
      return cleaned
    })
  }

  const updateOption = (index, value) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  const addOption = () => {
    setOptions([...options, ''])
  }

  const deleteOption = (index) => {
    setOptions(options.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const updatedQuestion = {
        id: questionId,
        content,
        options: options.length > 0 ? options : undefined,
        correctAnswer: correctAnswer || undefined,
        correct_answer: correctAnswer || undefined,
        analysis: analysis || undefined,
        question_type: questionType,
        image_url: displayImageUrl || undefined,
        updated_at: new Date().toISOString()
      }
      await updateQuestion(questionId, updatedQuestion)
      updatePendingQuestion(questionId, updatedQuestion)
      onSave && onSave(updatedQuestion)
      onClose && onClose()
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
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[10000]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[#F5F5F7] rounded-t-3xl overflow-hidden z-[10001] flex flex-col"
            style={{ height: '90vh' }}
          >
            {/* 顶部标题栏 */}
            <div className="bg-white px-4 py-4 flex items-center justify-center relative">
              <button onClick={onClose} className="absolute left-4 text-[15px] text-[#999]">
                <X size={20} />
              </button>
              <h2 className="text-[17px] font-bold text-[#333]">编辑题目</h2>
            </div>

            {/* Tab 切换 */}
            <div className="bg-white flex border-b border-[#F0F0F0]">
              {['stem', 'answer'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-3 text-[15px] font-medium relative transition-colors"
                  style={{
                    color: activeTab === tab ? '#1677FF' : '#999',
                    fontWeight: activeTab === tab ? 600 : 400
                  }}
                >
                  {tab === 'stem' ? '题干' : '答案'}
                  {activeTab === tab && (
                    <motion.div
                      layoutId="edit-tab-underline"
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] bg-[#1677FF] rounded-full"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={32} className="text-blue-500 animate-spin mb-3" />
                  <p className="text-[14px] text-gray-400">加载中...</p>
                </div>
              ) : (
                <>
                  {/* 题干 Tab */}
                  {activeTab === 'stem' && (
                    <div className="space-y-3">
                      {/* 题目内容 */}
                      <div className="bg-white rounded-3xl p-4 shadow-sm">
                        <div className="flex items-center mb-3">
                          <span className="text-[14px] font-bold text-[#333]">题目内容</span>
                          <span className="ml-2 text-[12px] text-[#1677FF]">
                            {questionType}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <textarea
                              value={content}
                              onChange={(e) => setContent(e.target.value)}
                              rows={5}
                              className="w-full text-[14px] text-[#333] focus:outline-none resize-none placeholder:text-[#CCC]"
                              placeholder="请输入题目内容"
                            />
                            <div className="text-right text-[12px] text-[#CCC] mt-2">
                              {content.length}/500
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 text-right">
                          <label className="text-[#1677FF] text-[13px] font-medium cursor-pointer">
                            {displayImageUrl ? '更换图片' : '上传图片'}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                const reader = new FileReader()
                                reader.onload = (ev) => setDisplayImageUrl(ev.target.result)
                                reader.readAsDataURL(file)
                              }}
                              style={{ display: 'none' }}
                            />
                          </label>
                        </div>
                        {displayImageUrl && (
                          <div className="mt-3 w-24 h-24 rounded-lg flex-shrink-0 overflow-hidden">
                            <img src={displayImageUrl} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>

                      {/* 选项区域 */}
                      {questionType === '选择题' && (
                        <div className="bg-white rounded-3xl p-4 shadow-sm mt-3">
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-[14px] font-bold text-[#333]">选项 (单选)</span>
                            <button
                              onClick={addOption}
                              className="text-[#1677FF] text-[13px] font-medium"
                            >
                              + 添加选项
                            </button>
                          </div>
                          <div className="space-y-3">
                            {options.map((option, index) => (
                              <div key={index} className="flex items-center gap-3">
                                <span className="w-7 h-7 rounded-full bg-[#F5F5F7] text-[#CCC] flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                                  {String.fromCharCode(65 + index)}
                                </span>
                                <input
                                  value={option}
                                  onChange={(e) => updateOption(index, e.target.value)}
                                  className="flex-1 h-11 px-4 bg-[#F5F5F7] rounded-xl text-[14px] text-[#333] focus:outline-none placeholder:text-[#CCC]"
                                  placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                                />
                                <button
                                  onClick={() => deleteOption(index)}
                                  className="p-2 text-[#CCC] hover:text-[#FF3B30] transition-colors flex-shrink-0"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 答案 Tab */}
                  {activeTab === 'answer' && (
                    <div className="space-y-3">
                      {/* 学生答案 & 正确答案 */}
                      <div className="bg-white rounded-3xl p-4 shadow-sm">
                        <div className="flex items-start gap-3 pb-4 border-b border-[#F0F0F0]">
                          <div className="w-9 h-9 rounded-full bg-[#F5F5F7] flex items-center justify-center flex-shrink-0">
                            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="#999">
                              <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160z"/>
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="text-[13px] text-[#999] mb-1">学生答案</div>
                            <div className="text-[15px] text-[#333]">
                              {studentAnswer || '未作答'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 pt-4">
                          <div className="w-9 h-9 rounded-full bg-[#E6F4FF] flex items-center justify-center flex-shrink-0">
                            <Plus size={18} className="text-[#1677FF]" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[13px] text-[#1677FF] font-medium mb-1">正确答案</div>
                            <textarea
                              value={correctAnswer}
                              onChange={(e) => setCorrectAnswer(e.target.value)}
                              rows={2}
                              className="w-full text-[17px] font-bold text-[#333] focus:outline-none resize-none placeholder:text-[#CCC]"
                              placeholder="请输入正确答案"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 题目解析 */}
                      <div className="bg-white rounded-3xl p-4 shadow-sm">
                        <div className="text-[14px] font-bold text-[#333] mb-3">
                          题目解析 (选填)
                        </div>
                        <textarea
                          value={analysis}
                          onChange={(e) => setAnalysis(e.target.value)}
                          rows={5}
                          className="w-full text-[14px] text-[#333] focus:outline-none resize-none placeholder:text-[#CCC]"
                          placeholder="请输入详细的 AI 解析内容或手动编辑解析内容..."
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="bg-white px-4 py-4 border-t border-[#F0F0F0] pb-8">
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 h-12 rounded-xl bg-[#F5F5F7] text-[#999] text-[16px] font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !content.trim()}
                  className="flex-1 h-12 rounded-xl bg-[#1677FF] text-white text-[16px] font-bold disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      保存中...
                    </span>
                  ) : '保存'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
