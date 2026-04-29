import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Loader2, QrCode, Image as ImageIcon, Clock, ArrowLeft, Trophy } from 'lucide-react'
import { mockWrongQuestions, mockStudents } from '../../data/mockData'
import { useWrongQuestionStore } from '../../store'
import dayjs from 'dayjs'

const USE_MOCK_DATA = false

export default function Grading({ paperId, studentId, onClose, onComplete }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questions, setQuestions] = useState([])
  const [gradingResults, setGradingResults] = useState({})
  const [studentInfo, setStudentInfo] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [isScanning, setIsScanning] = useState(!paperId)
  
  const { wrongQuestions, updateWrongQuestionStatus } = useWrongQuestionStore()

  useEffect(() => {
    console.log('Grading: 初始化', { paperId, studentId })
    if (USE_MOCK_DATA) {
      const student = mockStudents.find(s => s.id === studentId) || mockStudents[0]
      const testQuestions = mockWrongQuestions
        .filter(wq => wq.student_id === student.id)
        .map(wq => ({
          ...wq.question,
          wrongQuestionId: wq.id,
          originalStatus: wq.status
        }))
      
      console.log('Grading: 加载题目', testQuestions.length, '道')
      setQuestions(testQuestions)
      setStudentInfo({
        name: student.name,
        class: student.class,
        date: dayjs().format('YYYY-MM-DD'),
        retryCount: 2
      })
    }
  }, [paperId, studentId])

  const handleScanComplete = () => {
    setIsScanning(false)
  }

  const handleMarkStatus = (status) => {
    const currentQuestion = questions[currentQuestionIndex]
    const newResults = {
      ...gradingResults,
      [currentQuestion.id]: {
        ...gradingResults[currentQuestion.id],
        status,
        questionId: currentQuestion.id,
        wrongQuestionId: currentQuestion.wrongQuestionId,
        markedAt: Date.now()
      }
    }
    setGradingResults(newResults)

    if (currentQuestionIndex < questions.length - 1) {
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1)
      }, 300)
    } else {
      setTimeout(() => {
        setShowResult(true)
      }, 300)
    }
  }

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
    }
  }

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    }
  }

  const handleComplete = async () => {
    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status === 'not_mastered').length
    
    if (USE_MOCK_DATA) {
      Object.values(gradingResults).forEach(result => {
        if (result.wrongQuestionId) {
          updateWrongQuestionStatus(result.wrongQuestionId, result.status)
        }
      })
    }
    
    onComplete && onComplete({
      masteredCount,
      notMasteredCount,
      totalQuestions: questions.length,
      results: gradingResults
    })
  }

  // Scan Page
  if (isScanning) {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 bg-black z-[10000] flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center relative">
            <div className="w-[280px] bg-white rounded-[12px] p-5 mb-10">
              <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
                <div className="text-[16px] font-bold">数学错题重练卷</div>
              </div>
              <div className="text-[13px] text-gray-700 mb-2">学生姓名：{studentInfo?.name}</div>
              <div className="text-[13px] text-gray-700 mb-2">重练次数：第{studentInfo?.retryCount}次</div>
              <div className="text-[13px] text-gray-700 mb-4">日期：{studentInfo?.date}</div>
              <div className="w-20 h-20 bg-gray-100 mx-auto flex items-center justify-center border border-gray-200 rounded-lg">
                <QrCode size={32} className="text-gray-400" />
              </div>
            </div>

            <div className="text-white text-[14px] text-center">将二维码放入框内，自动识别</div>
          </div>

          <div className="px-5 pb-8 flex justify-center gap-10">
            <div className="text-center text-white cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-2 mx-auto">
                <ImageIcon size={24} className="text-white" />
              </div>
              <div className="text-[12px]">相册</div>
            </div>
            
            <div 
              onClick={handleScanComplete}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center cursor-pointer"
            >
              <div className="w-[52px] h-[52px] rounded-full bg-white" />
            </div>
            
            <div className="text-center text-white cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-2 mx-auto">
                <Clock size={24} className="text-white" />
              </div>
              <div className="text-[12px]">扫码历史</div>
            </div>
          </div>
        </div>
      </AnimatePresence>
    )
  }

  // Result Page
  if (showResult) {
    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status === 'not_mastered').length
    const total = questions.length

    return (
      <AnimatePresence>
        <div className="fixed inset-0 bg-white z-[10000] flex flex-col overflow-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 px-6 pt-16"
          >
            {/* Success Icon */}
            <div className="text-center mb-8 mt-8">
              <div className="w-[120px] h-[120px] rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center mx-auto relative">
                <CheckCircle2 size={60} className="text-white" strokeWidth={2.5} />
                <div className="absolute top-[-10px] right-[-10px]">
                  <Trophy size={30} className="text-yellow-500" />
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-8">
              <div className="text-[24px] font-bold text-gray-900 mb-2">恭喜您！</div>
              <div className="text-[14px] text-gray-500">本次批改已完成</div>
              <div className="text-[14px] text-gray-500">你消灭了 {masteredCount} 道错题！</div>
            </div>

            {/* Stats Card */}
            <div className="bg-green-50 border border-green-100 rounded-2xl p-6 mb-6">
              <div className="text-center mb-4">
                <div className="w-20 h-20 rounded-full border-8 border-green-500 flex items-center justify-center mx-auto relative">
                  <span className="text-[28px] font-bold text-green-600">{masteredCount}</span>
                  <span className="text-[12px] text-gray-400 absolute bottom-2">已掌握</span>
                </div>
              </div>
              
              <div className="flex justify-around text-[13px]">
                <div className="text-center">
                  <div className="text-green-600 font-bold">{masteredCount} 题</div>
                  <div className="text-gray-400">已掌握 ({Math.round(masteredCount/total*100)}%)</div>
                </div>
                <div className="text-center">
                  <div className="text-red-500 font-bold">{notMasteredCount} 题</div>
                  <div className="text-gray-400">未掌握 ({Math.round(notMasteredCount/total*100)}%)</div>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="mb-8">
              <div className="flex justify-between mb-3 text-[14px]">
                <span className="text-gray-500">重练次数</span>
                <span className="text-gray-900">+1（本次累计 {studentInfo?.retryCount} 次）</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-gray-500">错题本状态</span>
                <span className="text-green-600">已同步更新</span>
              </div>
            </div>

            {/* Complete Button */}
            <button 
              onClick={handleComplete}
              className="w-full py-4 rounded-2xl bg-blue-600 text-white text-[15px] font-bold hover:bg-blue-500 transition-all active:opacity-80"
            >
              完成
            </button>
          </motion.div>
        </div>
      </AnimatePresence>
    )
  }

  // Grading Page
  const currentQuestion = questions[currentQuestionIndex]
  const currentResult = gradingResults[currentQuestion?.id]
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100

  if (!currentQuestion) {
    return (
      <div className="fixed inset-0 bg-gray-50 z-[10000] flex items-center justify-center">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
      </div>
    )
  }

  const isShortOptions = currentQuestion.options && currentQuestion.options.every(opt => opt.length <= 10)

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-gray-50 z-[10000] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-12 pb-4 bg-white border-b border-gray-100">
          <button onClick={onClose} className="text-[14px] font-medium text-gray-500 hover:text-gray-700">
            退出
          </button>
          <h2 className="text-[17px] font-bold text-gray-900">批改中</h2>
          <span className="text-[14px] font-medium text-blue-600">批改中</span>
        </div>

        {/* Progress */}
        <div className="px-5 py-4 bg-white">
          <div className="flex justify-between mb-3 text-[13px]">
            <span>{studentInfo?.name}</span>
            <span className="text-gray-400">{studentInfo?.date}</span>
            <span>第{studentInfo?.retryCount}次重练</span>
          </div>
          <div className="w-full h-2 bg-blue-50 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-blue-600 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="text-center mt-2 text-[12px] text-gray-400">
            进度 {currentQuestionIndex + 1}/{questions.length}
          </div>
        </div>

        {/* Question Content */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="bg-white rounded-2xl p-5 mb-3 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <div>
                <span className="text-[14px] font-bold text-blue-600 mr-2">第 {currentQuestionIndex + 1} 题</span>
                <span className="text-[13px] text-gray-400">
                  {currentQuestion.question_type === 'choice' ? '选择题' : 
                   currentQuestion.question_type === 'fill' ? '填空题' : '解答题'}
                </span>
              </div>
            </div>

            <div className="text-[15px] text-gray-700 leading-relaxed mb-4">
              {currentQuestion.content}
            </div>

            {currentQuestion.options && currentQuestion.options.length > 0 && (
              <div className={`flex ${isShortOptions ? 'flex-wrap gap-6' : 'flex-wrap gap-2'} mb-4`}>
                {currentQuestion.options.map((opt, i) => (
                  <div key={i} className="text-[14px] text-gray-700">
                    {String.fromCharCode(65 + i)}. {opt}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Answer */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mb-3">
            <div className="text-[14px] font-bold text-blue-600 mb-2">参考答案</div>
            <div className="text-[14px] text-gray-700 leading-relaxed">
              {currentQuestion.answer || '暂无答案'}
            </div>
          </div>

          {/* Analysis */}
          <div className="bg-green-50 border border-green-100 rounded-2xl p-5">
            <div className="text-[14px] font-bold text-green-600 mb-2">解析</div>
            <div className="text-[14px] text-gray-700 leading-relaxed">
              {currentQuestion.analysis || 
                `本题考查${currentQuestion.question_type === 'choice' ? '基础概念' : '计算能力'}。` +
                `正确答案是 ${currentQuestion.answer}。` +
                `解题思路：根据题目条件，运用相关知识点进行推导计算。`
              }
            </div>
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="bg-white px-5 py-4 border-t border-gray-100">
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => handleMarkStatus('mastered')}
              className={`flex-1 py-3 px-4 rounded-xl text-[14px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                currentResult?.status === 'mastered' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-green-50 text-green-600'
              }`}
            >
              <CheckCircle2 size={16} />
              已掌握
            </button>
            <button
              onClick={() => handleMarkStatus('not_mastered')}
              className={`flex-1 py-3 px-4 rounded-xl text-[14px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                currentResult?.status === 'not_mastered' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-red-50 text-red-600'
              }`}
            >
              <XCircle size={16} />
              未掌握
            </button>
          </div>

          <div className="flex justify-between items-center">
            <button 
              onClick={handlePrev}
              disabled={currentQuestionIndex === 0}
              className="text-[14px] text-gray-500 disabled:opacity-30"
            >
              <div className="flex items-center gap-1">
                <ChevronLeft size={16} />
                上一题
              </div>
            </button>
            <span className="text-[14px] text-gray-500">
              {currentQuestionIndex + 1} / {questions.length}
            </span>
            <button 
              onClick={handleNext}
              disabled={currentQuestionIndex === questions.length - 1}
              className="text-[14px] text-gray-500 disabled:opacity-30"
            >
              <div className="flex items-center gap-1">
                下一题
                <ChevronRight size={16} />
              </div>
            </button>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}
