import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Processing from './pages/Processing'
import Pending from './pages/Pending'
import WrongBook from './pages/WrongBook'
import Exam from './pages/Exam'
import Students from './pages/Students'
import Grading from './pages/Grading'
import ScanQR from './pages/ScanQR'
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore } from './store'
import { getStudents } from './services/supabaseService'
import { Toast } from 'antd-mobile'

function App() {
  const { currentPage, toast, hideToast, setCurrentPage } = useUIStore()
  const { setStudents, setCurrentStudent } = useStudentStore()
  const { setTasks } = useTaskStore()
  const { setWrongQuestions } = useWrongQuestionStore()
  const [showGrading, setShowGrading] = useState(false)
  const [showScanQR, setShowScanQR] = useState(false)
  const [gradingParams, setGradingParams] = useState(null)

  // 初始化加载学生列表
  useEffect(() => {
    const init = async () => {
      try {
        const students = await getStudents()
        
        if (students && students.length > 0) {
          setStudents(students)
          setCurrentStudent(students[0])
        } else {
          // 数据库没有数据，显示空状态
          setStudents([])
          setCurrentStudent(null)
        }
      } catch (error) {
        console.error('从 Supabase 加载学生数据失败:', error)
        Toast.show({
          icon: 'fail',
          content: '连接数据库失败，请检查网络'
        })
        setStudents([])
        setCurrentStudent(null)
      }
    }
    
    init()
  }, [])

  // 显示全局提示
  useEffect(() => {
    if (toast) {
      Toast.show({
        icon: toast.type === 'success' ? 'success' : toast.type === 'fail' ? 'fail' : undefined,
        content: toast.message
      })
      hideToast()
    }
  }, [toast])

  // 根据当前页面渲染对应组件
  const renderPage = () => {
    switch (currentPage) {
      case 'processing':
        return <Processing />
      case 'pending':
        return <Pending />
      case 'wrongbook':
        return <WrongBook onScanQR={() => setShowScanQR(true)} />
      case 'exam':
        return <Exam />
      case 'students':
        return <Students />
      default:
        return <Processing />
    }
  }

  // 处理扫码成功
  const handleScanSuccess = (params) => {
    setGradingParams(params)
    setShowScanQR(false)
    setShowGrading(true)
  }

  return (
    <>
      <Layout>
        {renderPage()}
      </Layout>
      
      {/* 扫码页面 - 全屏覆盖 */}
      {showScanQR && (
        <ScanQR
          onClose={() => setShowScanQR(false)}
          onScanSuccess={handleScanSuccess}
        />
      )}
      
      {/* 批改页面 - 全屏覆盖 */}
      {showGrading && (
        <Grading
          paperId={gradingParams?.paperId}
          studentId={gradingParams?.studentId}
          onClose={() => {
            setShowGrading(false)
            setGradingParams(null)
          }}
          onComplete={(results) => {
            Toast.show({ icon: 'success', content: '批改完成' })
            setShowGrading(false)
            setGradingParams(null)
          }}
        />
      )}
    </>
  )
}

export default App
