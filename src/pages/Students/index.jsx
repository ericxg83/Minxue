import { useEffect, useState, useRef } from 'react'
import { Button, Toast, Empty, Dialog } from 'antd-mobile'
import { useStudentStore, useUIStore } from '../../store'
import { getStudents, createStudent, updateStudent, deleteStudent, uploadImage } from '../../services/apiService'
import ImageCropper from '../../components/ImageCropper'
import { User, Plus, Pencil, Trash2, Check, Search, X, ArrowLeft, Camera, ChevronRight } from 'lucide-react'

const GRADE_OPTIONS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

const USE_MOCK_DATA = false

export default function Students() {
  const { students, setStudents, currentStudent, setCurrentStudent, updateStudent: updateStudentInStore, addStudent: addStudentInStore, removeStudent: removeStudentFromStore } = useStudentStore()
  const { setLoading, setCurrentPage } = useUIStore()

  const [loading, setLocalLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showAddPage, setShowAddPage] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [formData, setFormData] = useState({ name: '', grade: '', class: '', remark: '', avatar: '' })
  const [cropperImage, setCropperImage] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!USE_MOCK_DATA) loadStudents()
  }, [])

  let loadCount = 0
  const loadStudents = async (useCache = true) => {
    loadCount++
    setLocalLoading(true)
    setLoading(true)
    try {
      const data = await getStudents(useCache)
      if (data && data.length > 0) setStudents(data)
    } catch (error) {
      Toast.show({ icon: 'fail', content: '加载学生列表失败' })
    } finally {
      setLocalLoading(false)
      setLoading(false)
    }
  }

  const filteredStudents = (Array.isArray(students) ? students : []).filter(student => {
    if (!searchKeyword) return true
    return student.name?.toLowerCase().includes(searchKeyword.toLowerCase())
  })

  const handleSelect = (student) => {
    setCurrentStudent(student)
    Toast.show({ icon: 'success', content: `已切换到 ${student.name}` })
    setCurrentPage('home')
  }

  const openAddPage = () => {
    setFormData({ name: '', grade: '', class: '', remark: '', avatar: '' })
    setEditingStudent(null)
    setShowAddPage(true)
  }

  const openEditPage = (student, e) => {
    e.stopPropagation()
    setFormData({
      name: student.name || '',
      grade: student.grade || '',
      class: student.class || '',
      remark: student.remark || '',
      avatar: student.avatar || ''
    })
    setEditingStudent(student)
    setShowAddPage(true)
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const reader = new FileReader()
      reader.onload = (event) => setCropperImage(event.target.result)
      reader.readAsDataURL(file)
    } catch (error) {
      Toast.show({ icon: 'fail', content: '图片读取失败' })
    }
  }

  const handleCropComplete = async (croppedImage) => {
    setCropperImage(null)
    setFormData({ ...formData, avatar: croppedImage })
    Toast.show({ icon: 'success', content: '头像设置成功' })
  }

  const handleCropCancel = () => {
    setCropperImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSave = async () => {
    if (!formData.name.trim()) { Toast.show('请输入学生姓名'); return }
    if (!formData.grade) { Toast.show('请选择年级'); return }

    setLoading(true)
    try {
      const classInfo = formData.grade && formData.class
        ? `${formData.grade}·${formData.class}`
        : formData.grade || formData.class

      const studentData = { ...formData, class: classInfo }

      if (editingStudent) {
        if (USE_MOCK_DATA) {
          updateStudentInStore(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) setCurrentStudent({ ...currentStudent, ...studentData })
        } else {
          await updateStudent(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) setCurrentStudent({ ...currentStudent, ...studentData })
          await loadStudents(false)
        }
        Toast.show({ icon: 'success', content: '更新成功' })
      } else {
        if (USE_MOCK_DATA) {
          const newStudent = { ...studentData, id: `student-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, created_at: new Date().toISOString() }
          addStudentInStore(newStudent)
          setCurrentStudent(newStudent)
        } else {
          const created = await createStudent(studentData)
          if (created) { addStudentInStore(created); setCurrentStudent(created) }
          await loadStudents(false)
        }
        Toast.show({ icon: 'success', content: '添加成功' })
      }
      setShowAddPage(false)
    } catch (error) {
      Toast.show({ icon: 'fail', content: error?.message || '保存失败，请重试' })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (student, e) => {
    if (e) e.stopPropagation()
    Dialog.confirm({
      title: '删除确认',
      content: `确定要删除学生「${student.name}」吗？此操作不可恢复。`,
      confirmText: '确定删除',
      cancelText: '取消',
      onConfirm: async () => {
        setLoading(true)
        try {
          if (USE_MOCK_DATA) {
            removeStudentFromStore(student.id)
            if (currentStudent?.id === student.id) setCurrentStudent(null)
          } else {
            await deleteStudent(student.id)
            if (currentStudent?.id === student.id) setCurrentStudent(null)
            await loadStudents(false)
          }
          Toast.show({ icon: 'success', content: '删除成功' })
        } catch (error) {
          Toast.show({ icon: 'fail', content: '删除失败，请重试' })
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const renderStudentList = () => (
    <div style={{ minHeight: '100%', paddingBottom: '80px' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b" style={{ borderColor: 'rgba(232,229,224,0.5)' }}>
        <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <button onClick={() => setCurrentPage('home')} className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            <ArrowLeft size={18} />
            返回
          </button>
          <h1 className="text-[17px] font-bold" style={{ color: 'var(--text)' }}>切换学生</h1>
          <div className="w-10" />
        </div>
      </div>

      {/* Search */}
      <div className="max-w-lg mx-auto px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            placeholder="搜索学生姓名"
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-xl text-[13px] border-0 outline-none"
            style={{ background: 'var(--bg-mist)' }}
          />
        </div>
      </div>

      {/* Count */}
      <div className="max-w-lg mx-auto px-4 pb-1">
        <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
          我的学生 · {filteredStudents.length}
        </p>
      </div>

      {/* Student List */}
      <div className="max-w-lg mx-auto px-4 space-y-2">
        {filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
              <User size={28} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <p className="mt-4" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>暂无学生</p>
            <p className="mt-1" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>点击下方按钮添加学生</p>
          </div>
        ) : (
          filteredStudents.map((student) => {
            const isCurrent = currentStudent?.id === student.id
            return (
              <div
                key={student.id}
                onClick={() => handleSelect(student)}
                className="card flex items-center justify-between active:scale-[0.99] transition-all"
                style={{
                  padding: '14px',
                  cursor: 'pointer',
                  borderColor: isCurrent ? 'var(--primary)' : 'var(--border)',
                  background: isCurrent ? 'var(--primary-mist)' : 'var(--bg-card)',
                }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={{ background: 'var(--primary-soft)' }}>
                    {student.avatar ? (
                      <img src={student.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={18} style={{ color: 'var(--primary)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {student.name}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {student.class || '暂无班级'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => openEditPage(student, e)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                    style={{ background: 'var(--bg-secondary)' }}
                  >
                    <Pencil size={13} style={{ color: 'var(--text-secondary)' }} />
                  </button>

                  {isCurrent && (
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
                      <Check size={14} className="text-white" />
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Floating Add Button */}
      <button
        onClick={openAddPage}
        className="fixed flex items-center justify-center z-40 active:scale-90 transition-all"
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, var(--primary) 0%, #60A5FA 100%)',
          boxShadow: '0 4px 16px rgba(59,130,246,0.35)',
          bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          right: '24px',
        }}
      >
        <Plus size={24} strokeWidth={3} className="text-white" />
      </button>
    </div>
  )

  const renderAddPage = () => (
    <div style={{ minHeight: '100%' }}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />

      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b" style={{ borderColor: 'rgba(232,229,224,0.5)' }}>
        <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <button onClick={() => setShowAddPage(false)} className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
          <h1 className="text-[17px] font-bold" style={{ color: 'var(--text)' }}>
            {editingStudent ? '编辑学生' : '添加学生'}
          </h1>
          <button
            onClick={handleSave}
            className="text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
          >
            保存
          </button>
        </div>
      </div>

      {/* Avatar */}
      <div className="flex justify-center pt-6 pb-4">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative cursor-pointer group"
        >
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden transition-all ring-1 ring-black/5" style={{ background: 'var(--bg-mist)' }}>
            {formData.avatar ? (
              <img src={formData.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <Camera size={28} style={{ color: 'var(--text-tertiary)' }} />
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)', boxShadow: '0 2px 8px rgba(59,130,246,0.3)' }}>
            <Plus size={12} className="text-white" strokeWidth={3} />
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-lg mx-auto px-4 space-y-3">
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border)' }}>
          {/* Name */}
          <div className="flex items-center px-4 py-3.5">
            <span className="text-[13px] font-semibold w-16 shrink-0" style={{ color: 'var(--text)' }}>姓名</span>
            <input
              placeholder="请输入学生姓名"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="flex-1 text-[13px] border-0 outline-none bg-transparent"
              style={{ color: 'var(--text)' }}
            />
          </div>

          {/* Grade */}
          <div className="flex items-center px-4 py-3.5">
            <span className="text-[13px] font-semibold w-16 shrink-0" style={{ color: 'var(--text)' }}>
              年级<span style={{ color: 'var(--danger)' }}>*</span>
            </span>
            <select
              value={formData.grade}
              onChange={e => setFormData({ ...formData, grade: e.target.value })}
              className="flex-1 text-[13px] border-0 bg-transparent outline-none"
              style={{ color: formData.grade ? 'var(--text)' : 'var(--text-tertiary)' }}
            >
              <option value="">请选择年级</option>
              {GRADE_OPTIONS.map(grade => (<option key={grade} value={grade}>{grade}</option>))}
            </select>
            <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
          </div>

          {/* Class */}
          <div className="flex items-center px-4 py-3.5">
            <span className="text-[13px] font-semibold w-16 shrink-0" style={{ color: 'var(--text)' }}>班级</span>
            <input
              placeholder="如：1班"
              value={formData.class}
              onChange={e => setFormData({ ...formData, class: e.target.value })}
              className="flex-1 text-[13px] border-0 outline-none bg-transparent"
              style={{ color: 'var(--text)' }}
            />
          </div>

          {/* Remark */}
          <div className="flex items-start px-4 py-3.5">
            <span className="text-[13px] font-semibold w-16 shrink-0 pt-0.5" style={{ color: 'var(--text)' }}>备注</span>
            <textarea
              placeholder="选填"
              value={formData.remark}
              onChange={e => setFormData({ ...formData, remark: e.target.value })}
              className="flex-1 text-[13px] border-0 bg-transparent resize-none outline-none"
              style={{ color: 'var(--text)', minHeight: '44px', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {editingStudent && (
          <button
            onClick={(e) => handleDelete(editingStudent, e)}
            className="w-full py-3 rounded-2xl text-[14px] font-medium transition-colors active:scale-[0.98]"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            删除学生
          </button>
        )}
      </div>

      {cropperImage && (
        <ImageCropper image={cropperImage} onCropComplete={handleCropComplete} onCancel={handleCropCancel} />
      )}
    </div>
  )

  return showAddPage ? renderAddPage() : renderStudentList()
}