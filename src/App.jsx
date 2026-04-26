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
import { mockStudents, mockTasks, mockQuestions, mockWrongQuestions } from './data/mockData'

// 使用测试数据开关
const USE_MOCK_DATA = true

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
      if (USE_MOCK_DATA) {
        // 使用测试数据
        setStudents(mockStudents)
        setCurrentStudent(mockStudents[0])
        setTasks(mockTasks)
        setWrongQuestions(mockWrongQuestions)
        return
      }

      try {
        const students = await getStudents()
        setStudents(students)
        
        // 如果有学生，默认选中第一个
        if (students.length > 0) {
          setCurrentStudent(students[0])
        }
      } catch (error) {
        console.error('初始化失败:', error)
        Toast.show({
          icon: 'fail',
          content: '连接数据库失败，请检查网络'
        })
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

  // 监听 showGrading 变化
  useEffect(() => {
    console.log('App: showGrading 变化:', showGrading)
  }, [showGrading])

  // 监听 gradingParams 变化
  useEffect(() => {
    console.log('App: gradingParams 变化:', gradingParams)
  }, [gradingParams])

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
    console.log('App: 扫码成功回调被调用，参数:', params)
    
    // 先设置参数
    setGradingParams(params)
    
    // 关闭扫码页面
    console.log('App: 关闭扫码页面')
    setShowScanQR(false)
    
    // 立即显示批改页面（不使用 setTimeout）
    console.log('App: 准备显示批改页面')
    setShowGrading(true)
  }

  console.log('App: 渲染, showScanQR=', showScanQR, 'showGrading=', showGrading)

  return (
    <>
      <Layout>
        {renderPage()}
      </Layout>
      
      {/* 扫码页面 - 全屏覆盖 */}
      {showScanQR && (
        <ScanQR
          onClose={() => {
            console.log('App: 关闭扫码')
            setShowScanQR(false)
          }}
          onScanSuccess={handleScanSuccess}
        />
      )}
      
      {/* 批改页面 - 全屏覆盖 */}
      {showGrading && (
        <Grading
          paperId={gradingParams?.paperId}
          studentId={gradingParams?.studentId}
          onClose={() => {
            console.log('App: 关闭批改')
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
