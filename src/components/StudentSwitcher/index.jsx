import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Plus, CheckCircle2, ChevronRight, UserPlus, User, Trash2, Pencil } from 'lucide-react'
import { useStudentStore } from '../../store'
import { createStudent, getStudents, deleteStudent, updateStudent } from '../../services/apiService'
import { mockStudents } from '../../data/mockData'

const GRADE_OPTIONS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

const USE_MOCK_DATA = false

export default function StudentSwitcher({ visible, onClose, onSelectStudent }) {
  const { students, currentStudent, setCurrentStudent, setStudents, updateStudent: updateStudentInStore } = useStudentStore()
  const [showForm, setShowForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [editingStudent, setEditingStudent] = useState(null)
  const [formData, setFormData] = useState({ name: '', grade: '', class: '' })
  const [submitting, setSubmitting] = useState(false)
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (visible) {
      loadStudents()
      resetForm()
      setShowForm(false)
    }
  }, [visible])

  useEffect(() => {
    if (showForm && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [showForm])

  const resetForm = () => {
    setFormData({ name: '', grade: '', class: '' })
    setEditingStudent(null)
  }

  const loadStudents = async (useCache = true) => {
    try {
      const loadedStudents = await getStudents(useCache)
      setStudents(loadedStudents)
    } catch (error) {
      console.error('加载学生列表失败:', error)
    }
  }

  const openAddForm = () => {
    resetForm()
    setShowForm(true)
  }

  const openEditForm = (student, e) => {
    e.stopPropagation()
    setEditingStudent(student)
    setFormData({
      name: student.name || '',
      grade: student.grade || '',
      class: student.class || ''
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) return
    if (!formData.grade) return

    setSubmitting(true)
    try {
      const classInfo = formData.grade && formData.class
        ? `${formData.grade}·${formData.class}`
        : formData.grade || formData.class

      const studentData = {
        name: formData.name,
        grade: formData.grade,
        class: classInfo
      }

      if (editingStudent) {
        if (USE_MOCK_DATA) {
          updateStudentInStore(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) {
            setCurrentStudent({ ...currentStudent, ...studentData })
          }
        } else {
          await updateStudent(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) {
            setCurrentStudent({ ...currentStudent, ...studentData })
          }
          await loadStudents(false)
        }
      } else {
        if (USE_MOCK_DATA) {
          const newStudent = {
            id: mockStudents.length > 0 ? `student-${mockStudents.length + 1}` : 'student-1',
            ...studentData,
          }
          setStudents([...students, newStudent])
          setCurrentStudent(newStudent)
        } else {
          const result = await createStudent(studentData)
          setCurrentStudent(result)
        }
        onClose()
      }

      setShowForm(false)
      resetForm()
    } catch (error) {
      console.error(editingStudent ? '更新学生失败:' : '添加学生失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (student) => {
    try {
      if (!USE_MOCK_DATA) {
        await deleteStudent(student.id)
      }
      setStudents((Array.isArray(students) ? students : []).filter(s => s.id !== student.id))
      if (currentStudent?.id === student.id) {
        const remaining = (Array.isArray(students) ? students : []).filter(s => s.id !== student.id)
        setCurrentStudent(remaining.length > 0 ? remaining[0] : null)
      }
      setShowDeleteConfirm(null)
    } catch (error) {
      console.error('删除学生失败:', error)
    }
  }

  const isFormValid = formData.name.trim() && formData.grade

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
            className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white rounded-t-xl overflow-hidden z-[10001]"
          >
            <div className="relative px-5 pt-5 pb-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[16px] font-bold text-slate-900">
                  {showForm ? (editingStudent ? '编辑学生' : '添加学生') : '切换学生'}
                </h2>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-gray-50 transition-colors"
                >
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              {!showForm ? (
                <>
                  {/* Student List */}
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto no-scrollbar pb-3">
                    {students.map((student) => (
                      <div
                        key={student.id}
                        onClick={() => {
                          setCurrentStudent(student)
                          onSelectStudent && onSelectStudent(student)
                          onClose()
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer active:opacity-80 ${
                          currentStudent?.id === student.id
                            ? 'border-blue-600 bg-blue-50/50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 ${
                            currentStudent?.id === student.id ? 'bg-blue-600' : 'bg-gray-300'
                          }`}>
                            {student.name?.charAt(0) || '学'}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold text-slate-900">{student.name}</div>
                            {student.class && (
                              <div className="text-[11px] text-gray-400 font-medium">{student.class}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {currentStudent?.id === student.id && (
                            <CheckCircle2 size={18} className="text-blue-600" />
                          )}
                          <button
                            onClick={(e) => openEditForm(student, e)}
                            className="p-1 rounded-full hover:bg-blue-50 transition-colors"
                          >
                            <Pencil size={14} className="text-gray-300 hover:text-blue-600" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowDeleteConfirm(student)
                            }}
                            className="p-1 rounded-full hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} className="text-gray-300 hover:text-red-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Student Button */}
                  <button
                    onClick={openAddForm}
                    className="w-full mt-3 p-3 rounded-xl border border-dashed border-gray-300 flex items-center justify-center gap-1.5 text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-all active:opacity-60"
                  >
                    <Plus size={18} />
                    <span className="text-[13px] font-semibold">添加学生</span>
                  </button>
                </>
              ) : (
                <>
                  {/* Add/Edit Student Form */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[12px] font-medium text-gray-500 mb-1.5">姓名</label>
                      <input
                        ref={nameInputRef}
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="请输入学生姓名"
                        className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-gray-500 mb-1.5">年级 <span className="text-red-500">*</span></label>
                      <select
                        value={formData.grade}
                        onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                        className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all appearance-none"
                        style={{ color: formData.grade ? '#1e293b' : '#9ca3af' }}
                      >
                        <option value="">请选择年级</option>
                        {GRADE_OPTIONS.map(grade => (
                          <option key={grade} value={grade}>{grade}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-gray-500 mb-1.5">班级</label>
                      <input
                        type="text"
                        value={formData.class}
                        onChange={(e) => setFormData({ ...formData, class: e.target.value })}
                        placeholder="请输入班级（选填）"
                        className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                      />
                    </div>
                    <div className="flex gap-3 pt-3">
                      <button
                        onClick={() => { setShowForm(false); resetForm() }}
                        className="flex-1 p-3 rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-500 hover:bg-gray-50 transition-all"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={submitting || !isFormValid}
                        className="flex-1 p-3 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:opacity-80"
                      >
                        {submitting ? (editingStudent ? '保存中...' : '添加中...') : (editingStudent ? '保存' : '确定')}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>

          {/* Delete Confirmation Dialog */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowDeleteConfirm(null)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10002]"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10003] bg-white rounded-xl shadow-lg max-w-[280px] w-[85%] overflow-hidden"
                >
                  <div className="px-5 pt-5 pb-2">
                    <h3 className="text-[16px] font-bold text-slate-900 text-center">确认删除</h3>
                  </div>
                  <div className="px-5 pb-4">
                    <p className="text-[13px] text-slate-600 leading-relaxed text-center">
                      确定要删除学生 <span className="font-semibold text-blue-600">{showDeleteConfirm.name}</span> 吗？此操作不可恢复。
                    </p>
                  </div>
                  <div className="flex border-t border-gray-200">
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="flex-1 py-3.5 text-[14px] font-medium text-slate-600 active:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                    <div className="w-px bg-gray-200" />
                    <button
                      onClick={() => handleDelete(showDeleteConfirm)}
                      className="flex-1 py-3.5 text-[14px] font-semibold text-red-600 active:bg-red-50 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <style>{`
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
        </>
      )}
    </AnimatePresence>
  )
}
