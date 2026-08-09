import React, { useState, useEffect } from 'react'
import { ChevronRight, BookOpen, ScanLine, RotateCcw } from 'lucide-react'
import { useStudentStore } from '../store'

export default function UploadTypeSelector({ visible, onClose, onUpload }) {
  const studentStore = useStudentStore()
  const [students, setStudents] = useState([])
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedWorksheet, setSelectedWorksheet] = useState(null)
  const [worksheets, setWorksheets] = useState([])
  const [showStudentSelector, setShowStudentSelector] = useState(false)
  const [showWorksheetPicker, setShowWorksheetPicker] = useState(false)
  const [uploadType, setUploadType] = useState('')

  useEffect(() => {
    if (visible) {
      setStudents(studentStore.students)
      setSelectedStudentId('')
      setSelectedSubject('')
      setSelectedWorksheet(null)
      setWorksheets([])
      setShowStudentSelector(false)
      setShowWorksheetPicker(false)
      // 立即加载练习册列表：避免 checkDefaultWorksheet 在 worksheets=[] 时找不到默认，
      // 误进入 showWorksheetPicker=true 但列表为空的状态。
      loadWorksheets()
    }
  }, [visible, studentStore.students])

  const selectWorkbook = () => {
    // 走"日常作业 → 选练习册"流程：
    // 让用户先选学生+科目，再选/确认练习册，最后才开始拍照。
    // 走完后通过 confirmUpload 传 { type: 'workbook', worksheetId, subject, ... } 给 Home，
    // Home 端进入暂存区拍照、提交时 dispatchEvent flow: 'workbook' + worksheetId，
    // App.jsx 监听 set-workbook-flow 后把 worksheetId 同步到 state/ref/module 兜底，
    // handleFileSelect 进入 workbook 管道，后端收到正确的 worksheet_id。
    // 修复前：selectWorkbook 直接 onUpload({ type: 'homework' }) 关闭，
    // H5 移动端根本没有机会选练习册，导致上传全部退化成 general 管道。
    setUploadType('workbook')
    setShowStudentSelector(true)
  }

  const selectRegular = () => {
    setUploadType('regular')
    onUpload({ type: 'regular' })
    onClose()
  }

  const selectWrongRetry = () => {
    setUploadType('wrong_retry')
    onUpload({ type: 'wrong_retry' })
    onClose()
  }

  const loadWorksheets = async () => {
    try {
      const response = await fetch('/api/worksheets')
      const data = await response.json()
      if (data.success) {
        setWorksheets(data.worksheets || [])
      }
    } catch (error) {
      console.error('Failed to load worksheets:', error)
    }
  }

  const checkDefaultWorksheet = async () => {
    if (!selectedStudentId || !selectedSubject) return

    try {
      const response = await fetch(`/api/worksheets/student-settings/${selectedStudentId}?subject=${selectedSubject}`)
      const data = await response.json()
      if (data.success && data.setting?.default_worksheet_id) {
        const worksheet = worksheets.find(w => w.id === data.setting.default_worksheet_id)
        if (worksheet) {
          setSelectedWorksheet(worksheet)
          setShowWorksheetPicker(false)
          return // 找到默认练习册，不显示选择器
        }
      }
      // 没有默认练习册，显示选择器
      setShowWorksheetPicker(true)
    } catch (error) {
      console.error('Failed to check default worksheet:', error)
      // 出错时也显示选择器
      setShowWorksheetPicker(true)
    }
  }

  const selectWorksheet = (worksheet) => {
    setSelectedWorksheet(worksheet)
    setShowWorksheetPicker(false)
  }

  const confirmUpload = () => {
    onUpload({
      type: 'workbook',
      studentId: selectedStudentId,
      subject: selectedSubject,
      worksheetId: selectedWorksheet.id,
      worksheet: selectedWorksheet
    })
    onClose()
  }

  // Check for default worksheet when student/subject changes
  useEffect(() => {
    if (selectedStudentId && selectedSubject) {
      checkDefaultWorksheet()
    }
  }, [selectedStudentId, selectedSubject])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-1 rounded-full bg-[var(--bg-secondary)] mx-auto mb-6"></div>

        <h3 className="text-xl font-bold text-center mb-6">
          {uploadType === 'workbook' ? '日常作业' : '选择上传方式'}
        </h3>

        {!uploadType && (
        <div className="space-y-3">
          {/* 日常作业 */}
          <button
            onClick={selectWorkbook}
            className="w-full rounded-2xl p-6 flex items-center gap-4 active:scale-[0.99] transition-all"
            style={{ background: 'var(--card-bg)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
              <BookOpen size={28} style={{ color: 'var(--primary)' }} />
            </div>
            <div className="text-left">
              <h4 className="font-bold text-base" style={{ color: 'var(--text)' }}>日常作业</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>拍照上传，选择练习册或AI批改</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* 普通试卷 */}
          <button
            onClick={selectRegular}
            className="w-full rounded-2xl p-6 flex items-center gap-4 active:scale-[0.99] transition-all"
            style={{ background: 'var(--card-bg)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(236, 72, 153, 0.1)' }}>
              <ScanLine size={28} style={{ color: '#EC4899' }} />
            </div>
            <div className="text-left">
              <h4 className="font-bold text-base" style={{ color: 'var(--text)' }}>普通试卷</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>考试卷/临时卷，AI智能批改</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* 错题重练 */}
          <button
            onClick={selectWrongRetry}
            className="w-full rounded-2xl p-6 flex items-center gap-4 active:scale-[0.99] transition-all"
            style={{ background: 'var(--card-bg)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
              <RotateCcw size={28} style={{ color: 'var(--success)' }} />
            </div>
            <div className="text-left">
              <h4 className="font-bold text-base" style={{ color: 'var(--text)' }}>错题重练</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>拍照上传，自动识别卷上二维码批改</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        )}

        {/* 学生选择器 */}
        {showStudentSelector && (
          <div className="mt-6">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>选择学生和科目</p>
            <div className="flex gap-3">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="flex-1 rounded-xl p-3 text-sm font-medium"
                style={{ background: 'var(--card-bg)', color: 'var(--text)' }}
              >
                <option value="">选择学生</option>
                {students.map(student => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="flex-1 rounded-xl p-3 text-sm font-medium"
                style={{ background: 'var(--card-bg)', color: 'var(--text)' }}
              >
                <option value="">选择科目</option>
                <option value="数学">数学</option>
                <option value="语文">语文</option>
                <option value="英语">英语</option>
                <option value="物理">物理</option>
                <option value="化学">化学</option>
                <option value="生物">生物</option>
              </select>
            </div>
          </div>
        )}

        {/* 练习册选择器 */}
        {showWorksheetPicker && (
          <div className="mt-6">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>选择练习册</p>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {worksheets.map(worksheet => (
                <div
                  key={worksheet.id}
                  onClick={() => selectWorksheet(worksheet)}
                  className="rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-[var(--bg-hover)] transition-all"
                  style={{ background: 'var(--card-bg)' }}
                >
                  <div>
                    <h5 className="font-medium" style={{ color: 'var(--text)' }}>{worksheet.name}</h5>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{worksheet.subject} · {worksheet.grade}</p>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--text-secondary)' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 确认按钮 */}
        {selectedWorksheet && selectedStudentId && selectedSubject && (
          <button
            onClick={confirmUpload}
            className="w-full mt-6 py-4 rounded-2xl font-bold text-white transition-all active:scale-[0.99]"
            style={{ background: 'var(--primary)' }}
          >
            开始拍照
          </button>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={onClose}
            className="text-sm font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}