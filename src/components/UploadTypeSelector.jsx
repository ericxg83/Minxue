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
    }
  }, [visible, studentStore.students])

  const selectWorkbook = async () => {
    setUploadType('workbook')
    setShowStudentSelector(true)
    await loadWorksheets()
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
        }
      }
    } catch (error) {
      console.error('Failed to check default worksheet:', error)
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
        <div className="w-12 h-1 rounded-full bg-gray-300 mx-auto mb-6"></div>

        <h3 className="text-xl font-bold text-center mb-6">选择上传方式</h3>

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
              <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>练习册/同步练习，已有标准答案</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-tertiary)' }} />
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
              <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>考试卷/临时卷，AI智能批改</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-tertiary)' }} />
          </button>

          {/* 错题重练 */}
          <button
            onClick={selectWrongRetry}
            className="w-full rounded-2xl p-6 flex items-center gap-4 active:scale-[0.99] transition-all"
            style={{ background: 'var(--card-bg)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
              <RotateCcw size={28} style={{ color: '#22C55E' }} />
            </div>
            <div className="text-left">
              <h4 className="font-bold text-base" style={{ color: 'var(--text)' }}>错题重练</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>扫二维码，智能推荐练习</p>
            </div>
            <ChevronRight size={20} style={{ color: 'var(--text-tertiary)' }} />
          </button>
        </div>

        {/* 学生选择器 */}
        {showStudentSelector && (
          <div className="mt-6">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-tertiary)' }}>选择学生和科目</p>
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
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-tertiary)' }}>选择练习册</p>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {worksheets.map(worksheet => (
                <div
                  key={worksheet.id}
                  onClick={() => selectWorksheet(worksheet)}
                  className="rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-gray-100/50 transition-all"
                  style={{ background: 'var(--card-bg)' }}
                >
                  <div>
                    <h5 className="font-medium" style={{ color: 'var(--text)' }}>{worksheet.name}</h5>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{worksheet.subject} · {worksheet.grade}</p>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
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
            style={{ color: 'var(--text-tertiary)' }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}