import { useState, useRef } from 'react'
import { Popup, Badge, Button, Toast, Dialog } from 'antd-mobile'
import { useStudentStore, useTaskStore, useWrongQuestionStore, usePendingQuestionStore, useExamStore } from '../../store'
import { mockStudents, mockTasks, mockQuestions, mockWrongQuestions } from '../../data/mockData'

const USE_MOCK_DATA = true

// 苹果风格颜色
const APPLE_COLORS = {
  primary: '#007AFF',
  success: '#34C759',
  danger: '#FF3B30',
  warning: '#FF9500',
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E5E5EA'
}

// 年级选项
const GRADE_OPTIONS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

// 格式化数字：超过99显示"99+"，0或负数返回null（不显示徽章）
const formatCount = (count) => {
  if (count <= 0) return null
  if (count > 99) return '99+'
  return String(count)
}

export default function StudentSwitcher({ visible, onClose, badgeType }) {
  const { students, currentStudent, setCurrentStudent, addStudent } = useStudentStore()
  const { tasks } = useTaskStore()
  const { wrongQuestions } = useWrongQuestionStore()
  const { pendingQuestions } = usePendingQuestionStore()
  const { exams } = useExamStore()
  
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [formData, setFormData] = useState({ 
    name: '', 
    grade: '', 
    class: '', 
    remark: '',
    avatar: '' 
  })
  const fileInputRef = useRef(null)

  // 从 localStorage 获取已加入错题本的题目ID
  const getAddedToWrongBookIds = (studentId) => {
    try {
      const stored = localStorage.getItem(`addedToWrongBook_${studentId}`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  }

  // 计算指定类型下每个学生的任务数量
  const getStudentTaskCount = (studentId) => {
    switch (badgeType) {
      case 'failed': {
        // 只从 store 中的 tasks 统计，因为 mock 数据可能已被删除
        // store 中的 tasks 是真实状态，已删除的任务不会在这里
        return tasks.filter(t => t.student_id === studentId && t.status === 'failed').length
      }
      case 'pending': {
        // 只从 store 中的 pendingQuestions 统计该学生的疑似错题
        // 并过滤掉已加入错题本的题目，保持和列表一致
        const addedIds = getAddedToWrongBookIds(studentId)
        return pendingQuestions.filter(q => 
          q.student_id === studentId && 
          (q.status === 'wrong' || !q.is_correct) &&
          !addedIds.has(q.id)
        ).length
      }
      case 'grading': {
        // 从 exams store 中统计该学生未批改的试卷数量
        return exams.filter(e => e.student_id === studentId && e.status === 'ungraded').length
      }
      case 'wrongbook': {
        // 从 wrongQuestions store 中统计该学生未掌握的错题数量（status !== 'mastered'）
        return wrongQuestions.filter(wq => wq.student_id === studentId && wq.status !== 'mastered').length
      }
      default:
        return 0
    }
  }

  // 获取提示文案
  const getBadgeHint = () => {
    switch (badgeType) {
      case 'failed':
        return '数字表示该学生失败的试卷数量'
      case 'pending':
        return '数字表示该学生待确认的题目数量'
      case 'grading':
        return '数字表示该学生待批改的题目数量'
      case 'wrongbook':
        return '数字表示该学生未掌握的错题数量'
      default:
        return ''
    }
  }

  // 获取徽章颜色
  const getBadgeColor = () => {
    switch (badgeType) {
      case 'failed':
        return APPLE_COLORS.danger
      case 'pending':
        return APPLE_COLORS.primary
      case 'grading':
        return APPLE_COLORS.success
      case 'wrongbook':
        return APPLE_COLORS.danger
      default:
        return APPLE_COLORS.primary
    }
  }

  // 处理头像上传
  const handleAvatarUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      setFormData({ ...formData, avatar: event.target.result })
      Toast.show({ icon: 'success', content: '头像上传成功' })
    }
    reader.readAsDataURL(file)
  }

  // 保存学生
  const handleSave = () => {
    if (!formData.name.trim()) {
      Toast.show({ icon: 'fail', content: '请输入学生姓名' })
      return
    }

    // 组合班级信息
    const classInfo = formData.grade && formData.class 
      ? `${formData.grade}·${formData.class}`
      : formData.grade || formData.class

    const newStudent = {
      id: `student-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: formData.name.trim(),
      class: classInfo,
      avatar: formData.avatar,
      remark: formData.remark,
      created_at: new Date().toISOString()
    }

    // 添加到 store
    addStudent(newStudent)
    
    // 如果是 mock 模式，也添加到 mockStudents
    if (USE_MOCK_DATA) {
      mockStudents.push(newStudent)
    }

    Toast.show({ icon: 'success', content: '添加成功' })
    
    // 重置表单并关闭弹窗
    setFormData({ name: '', grade: '', class: '', remark: '', avatar: '' })
    setShowAddStudent(false)
  }

  // 取消添加
  const handleCancel = () => {
    Dialog.confirm({
      title: '取消添加',
      content: '确定要取消添加学生吗？已填写的内容将不会保存。',
      confirmText: '确定',
      cancelText: '继续填写',
      onConfirm: () => {
        setFormData({ name: '', grade: '', class: '', remark: '', avatar: '' })
        setShowAddStudent(false)
      }
    })
  }

  const studentList = USE_MOCK_DATA ? mockStudents : students
  const badgeColor = getBadgeColor()

  return (
    <>
      {/* 学生切换弹窗 - 苹果风格 */}
      <Popup
        visible={visible && !showAddStudent}
        onMaskClick={onClose}
        position="bottom"
        bodyStyle={{
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          minHeight: '300px',
          maxHeight: '70vh',
          background: APPLE_COLORS.card
        }}
      >
        <div style={{ padding: '16px' }}>
          {/* 标题 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <span style={{ fontSize: '20px', fontWeight: 600, color: APPLE_COLORS.text }}>切换学生</span>
            <span 
              onClick={onClose}
              style={{ fontSize: '28px', color: APPLE_COLORS.textSecondary, cursor: 'pointer', lineHeight: 1 }}
            >
              ×
            </span>
          </div>

          {/* 学生列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {studentList.map(student => {
              const count = getStudentTaskCount(student.id)
              const isCurrent = currentStudent?.id === student.id

              return (
                <div
                  key={student.id}
                  onClick={() => {
                    setCurrentStudent(student)
                    onClose()
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    borderRadius: '12px',
                    background: isCurrent ? '#E8F4FD' : APPLE_COLORS.background,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {/* 头像 */}
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: isCurrent ? 'linear-gradient(135deg, #E8F4FD 0%, #D6EBFA 100%)' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                    boxShadow: isCurrent ? '0 2px 8px rgba(0,122,255,0.15)' : 'none'
                  }}>
                    {student.avatar ? (
                      <img src={student.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 1024 1024" fill={isCurrent ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary}>
                        <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160zM128 800h768c0-52.8-43.2-96-96-96h-32c-11.2 0-22.4 2.4-32.8 6.4-40 16-84.8 25.6-130.4 28.8-11.2 0.8-22.4 1.2-33.6 1.2s-22.4-0.4-33.6-1.2c-45.6-3.2-90.4-12.8-130.4-28.8-10.4-4-21.6-6.4-32.8-6.4h-32c-52.8 0-96 43.2-96 96z"/>
                      </svg>
                    )}
                  </div>

                  {/* 姓名和班级 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '16px', fontWeight: isCurrent ? 600 : 500, color: APPLE_COLORS.text }}>
                      {student.name}
                    </div>
                    <div style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary, marginTop: '2px' }}>
                      {student.class || '暂无班级'}
                    </div>
                  </div>

                  {/* 数量徽章 - 仅当数量大于0时显示 */}
                  {count > 0 && (
                    <Badge 
                      content={formatCount(count)} 
                      style={{ 
                        '--right': '0',
                        '--top': '0',
                        '--padding': '2px 8px',
                        '--font-size': '13px',
                        '--color': badgeColor,
                        '--background': badgeColor + '15',
                        borderRadius: '12px',
                        minWidth: '24px'
                      }}
                    >
                      <span style={{ 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        background: badgeColor
                      }} />
                    </Badge>
                  )}

                  {/* 右箭头 */}
                  <svg width="18" height="18" viewBox="0 0 1024 1024" fill={isCurrent ? APPLE_COLORS.primary : APPLE_COLORS.border} style={{ flexShrink: 0 }}>
                    <path d="M384 128l384 384-384 384"/>
                  </svg>
                </div>
              )
            })}
          </div>

          {/* 添加学生按钮 - 苹果风格 */}
          <div style={{ marginTop: '16px' }}>
            <Button
              block
              fill="none"
              style={{
                border: '2px dashed ' + APPLE_COLORS.primary,
                borderRadius: '12px',
                padding: '16px',
                color: APPLE_COLORS.primary,
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: '#F0F7FF'
              }}
              onClick={() => setShowAddStudent(true)}
            >
              <svg width="22" height="22" viewBox="0 0 1024 1024" fill="currentColor">
                <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
                <path d="M544 320H480v160H320v64h160v160h64V544h160v-64H544z"/>
              </svg>
              添加学生
            </Button>
          </div>

          {/* 提示文案 */}
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            background: APPLE_COLORS.background, 
            borderRadius: '10px',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary }}>
              {getBadgeHint()}
            </span>
          </div>
        </div>
      </Popup>

      {/* 添加学生弹窗 - 苹果风格 */}
      <Popup
        visible={showAddStudent}
        onMaskClick={() => {}}
        position="right"
        bodyStyle={{
          width: '100vw',
          height: '100vh',
          background: APPLE_COLORS.background
        }}
      >
        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarUpload}
        />

        {/* 顶部导航栏 - 苹果风格 */}
        <div style={{ 
          background: APPLE_COLORS.card, 
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid ' + APPLE_COLORS.border
        }}>
          <Button 
            fill="none" 
            style={{ color: APPLE_COLORS.textSecondary, fontSize: '16px' }}
            onClick={handleCancel}
          >
            取消
          </Button>
          <span style={{ fontSize: '18px', fontWeight: 600, color: APPLE_COLORS.text }}>添加学生</span>
          <Button 
            fill="none" 
            style={{ color: APPLE_COLORS.primary, fontSize: '16px', fontWeight: 600 }}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>

        {/* 表单内容 */}
        <div style={{ padding: '16px' }}>
          {/* 头像上传 - 苹果风格 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            marginBottom: '24px' 
          }}>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                border: '2px dashed ' + APPLE_COLORS.border,
                background: formData.avatar ? 'transparent' : APPLE_COLORS.background,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                overflow: 'hidden'
              }}
            >
              {formData.avatar ? (
                <img 
                  src={formData.avatar} 
                  alt="头像" 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                />
              ) : (
                <>
                  <svg width="36" height="36" viewBox="0 0 1024 1024" fill={APPLE_COLORS.textSecondary} style={{ marginBottom: '4px' }}>
                    <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128zM512 832c-88 0-160-72-160-160s72-160 160-160 160 72 160 160-72 160-160 160zm0-256c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z"/>
                  </svg>
                  <span style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary }}>点击上传头像</span>
                </>
              )}
            </div>
          </div>

          {/* 表单字段 - 苹果风格 */}
          <div style={{ background: APPLE_COLORS.card, borderRadius: '12px', overflow: 'hidden' }}>
            {/* 姓名 */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '16px',
              borderBottom: '1px solid ' + APPLE_COLORS.border
            }}>
              <span style={{ width: '70px', fontSize: '16px', color: APPLE_COLORS.text, fontWeight: 500 }}>姓名</span>
              <input
                type="text"
                placeholder="请输入学生姓名"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px',
                  color: APPLE_COLORS.text,
                  background: 'transparent'
                }}
              />
            </div>

            {/* 年级 */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '16px',
              borderBottom: '1px solid ' + APPLE_COLORS.border
            }}>
              <span style={{ width: '70px', fontSize: '16px', color: APPLE_COLORS.text, fontWeight: 500 }}>年级</span>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px',
                  color: formData.grade ? APPLE_COLORS.text : APPLE_COLORS.textSecondary,
                  background: 'transparent',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">请选择年级</option>
                {GRADE_OPTIONS.map(grade => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
              <svg width="18" height="18" viewBox="0 0 1024 1024" fill={APPLE_COLORS.textSecondary}>
                <path d="M512 704l-256-256h512z"/>
              </svg>
            </div>

            {/* 班级 */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '16px',
              borderBottom: '1px solid ' + APPLE_COLORS.border
            }}>
              <span style={{ width: '70px', fontSize: '16px', color: APPLE_COLORS.text, fontWeight: 500 }}>班级</span>
              <input
                type="text"
                placeholder="请输入班级"
                value={formData.class}
                onChange={(e) => setFormData({ ...formData, class: e.target.value })}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px',
                  color: APPLE_COLORS.text,
                  background: 'transparent'
                }}
              />
            </div>

            {/* 备注 */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '16px'
            }}>
              <span style={{ width: '70px', fontSize: '16px', color: APPLE_COLORS.text, fontWeight: 500 }}>备注</span>
              <input
                type="text"
                placeholder="请输入备注（选填）"
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px',
                  color: APPLE_COLORS.text,
                  background: 'transparent'
                }}
              />
            </div>
          </div>
        </div>
      </Popup>
    </>
  )
}
