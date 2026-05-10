import { useEffect, useState, useRef } from 'react'
import {
  Button,
  Toast,
  Empty,
  Dialog,
  Input,
  NavBar,
  SwipeAction
} from 'antd-mobile'
import { useStudentStore, useUIStore } from '../../store'
import { getStudents, createStudent, updateStudent, deleteStudent, uploadImage } from '../../services/apiService'
import ImageCropper from '../../components/ImageCropper'

const GRADE_OPTIONS = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

const USE_MOCK_DATA = false

export default function Students() {
  const { students, setStudents, currentStudent, setCurrentStudent, updateStudent: updateStudentInStore, addStudent: addStudentInStore, removeStudent: removeStudentFromStore } = useStudentStore()
  const { setLoading, setCurrentPage } = useUIStore()
  
  const [loading, setLocalLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showAddPage, setShowAddPage] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    grade: '',
    class: '',
    remark: '',
    avatar: ''
  })
  const [cropperImage, setCropperImage] = useState(null)  // 裁剪器显示的图片
  const fileInputRef = useRef(null)

  useEffect(() => {
    console.log('Students 组件挂载')
    if (!USE_MOCK_DATA) {
      loadStudents()
    }
  }, [])

  let loadCount = 0
  const loadStudents = async (useCache = true) => {
    loadCount++
    console.log(`loadStudents 被调用 (第 ${loadCount} 次)`)
    setLocalLoading(true)
    setLoading(true)
    
    try {
      const data = await getStudents(useCache)
      console.log('从 Supabase 加载的学生数据:', data)
      console.log('Supabase 返回的学生数量:', data?.length || 0)
      if (data && data.length > 0) {
        setStudents(data)
      } else {
        console.warn('Supabase 中没有学生数据')
      }
    } catch (error) {
      console.error('加载失败:', error)
      Toast.show({
        icon: 'fail',
        content: '加载学生列表失败'
      })
    } finally {
      setLocalLoading(false)
      setLoading(false)
    }
  }

  // 筛选学生
  const filteredStudents = (Array.isArray(students) ? students : []).filter(student => {
    if (!searchKeyword) return true
    return student.name?.toLowerCase().includes(searchKeyword.toLowerCase())
  })

  // 选择学生并返回
  const handleSelect = (student) => {
    setCurrentStudent(student)
    Toast.show({
      icon: 'success',
      content: `已切换到 ${student.name}`
    })
    // 返回上一页
    setCurrentPage('home')
  }

  // 打开添加页面
  const openAddPage = () => {
    setFormData({ name: '', grade: '', class: '', remark: '', avatar: '' })
    setEditingStudent(null)
    setShowAddPage(true)
  }

  // 打开编辑页面
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

  // 处理头像上传 - 先打开裁剪器
  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      // 读取文件为 base64，用于裁剪器显示
      const reader = new FileReader()
      reader.onload = (event) => {
        setCropperImage(event.target.result)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      Toast.show({ icon: 'fail', content: '图片读取失败' })
    }
  }

  // 裁剪完成后的处理
  const handleCropComplete = async (croppedImage) => {
    setCropperImage(null)
    setFormData({ ...formData, avatar: croppedImage })
    Toast.show({ icon: 'success', content: '头像设置成功' })
  }

  // 取消裁剪
  const handleCropCancel = () => {
    setCropperImage(null)
    // 清空文件输入，允许再次选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 保存学生
  const handleSave = async () => {
    if (!formData.name.trim()) {
      Toast.show('请输入学生姓名')
      return
    }
    if (!formData.grade) {
      Toast.show('请选择年级')
      return
    }

    setLoading(true)
    
    try {
      // 组合班级信息
      const classInfo = formData.grade && formData.class 
        ? `${formData.grade}·${formData.class}`
        : formData.grade || formData.class

      const studentData = {
        ...formData,
        class: classInfo
      }

      if (editingStudent) {
        if (USE_MOCK_DATA) {
          const updatedStudent = { ...editingStudent, ...studentData, updated_at: new Date().toISOString() }
          updateStudentInStore(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) {
            setCurrentStudent(updatedStudent)
          }
        } else {
          await updateStudent(editingStudent.id, studentData)
          if (currentStudent?.id === editingStudent.id) {
            setCurrentStudent({ ...currentStudent, ...studentData })
          }
          await loadStudents(false)
        }
        Toast.show({ icon: 'success', content: '更新成功' })
      } else {
        console.log('USE_MOCK_DATA 值:', USE_MOCK_DATA, '准备创建学生')
        if (USE_MOCK_DATA) {
          const newStudent = {
            ...studentData,
            id: `student-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            created_at: new Date().toISOString()
          }
          addStudentInStore(newStudent)
          setCurrentStudent(newStudent)
        } else {
          console.log('进入 Supabase 创建学生流程')
          console.log('正在创建学生:', studentData)
          try {
            const created = await createStudent(studentData)
            console.log('Supabase 返回的创建结果:', created)
            if (created) {
              addStudentInStore(created)
              setCurrentStudent(created)
            }
            await loadStudents(false)
          } catch (err) {
            console.error('创建学生时出错:', err)
            throw err
          }
        }
        Toast.show({ icon: 'success', content: '添加成功' })
      }
      
      setShowAddPage(false)
    } catch (error) {
      console.error('保存失败:', error)
      const errorMessage = error?.message || error?.error?.message || '保存失败，请重试'
      Toast.show({ icon: 'fail', content: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  // 删除学生 - 带确认对话框
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
          if (currentStudent?.id === student.id) {
            setCurrentStudent(null)
          }
        } else {
            // Supabase 模式
            await deleteStudent(student.id)
            if (currentStudent?.id === student.id) {
              setCurrentStudent(null)
            }
            // 重新加载学生列表
            await loadStudents(false)
          }
          Toast.show({ icon: 'success', content: '删除成功' })
        } catch (error) {
          console.error('删除失败:', error)
          Toast.show({ icon: 'fail', content: '删除失败，请重试' })
        } finally {
          setLoading(false)
        }
      }
    })
  }

  // 渲染学生列表页面
  const renderStudentList = () => (
    <div style={{ padding: '0', background: '#f5f5f5', minHeight: '100%', paddingBottom: '80px' }}>
      {/* 顶部标题栏 */}
      <div style={{ 
        background: '#fff', 
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>切换学生</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button fill="none" style={{ color: '#666' }}>
            <svg width="20" height="20" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M464 144c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
              <path d="M464 464c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
              <path d="M464 784c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
            </svg>
          </Button>
        </div>
      </div>

      {/* 搜索框 */}
      <div style={{ padding: '12px 16px', background: '#fff', borderBottom: '1px solid #f5f5f5' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          background: '#f5f5f5', 
          borderRadius: '20px',
          padding: '8px 16px'
        }}>
          <svg width="18" height="18" viewBox="0 0 1024 1024" fill="#999" style={{ marginRight: '8px' }}>
            <path d="M832 800l-128-128c35.2-41.6 56-96 56-156.8 0-132.8-107.2-240-240-240s-240 107.2-240 240 107.2 240 240 240c60.8 0 115.2-20.8 156.8-56l128 128c9.6 9.6 24 9.6 33.6 0 9.6-9.6 9.6-24 0-33.6zM320 515.2c0-99.2 80-179.2 179.2-179.2s179.2 80 179.2 179.2-80 179.2-179.2 179.2-179.2-80-179.2-179.2z"/>
          </svg>
          <Input
            placeholder="搜索学生姓名"
            value={searchKeyword}
            onChange={val => setSearchKeyword(val)}
            style={{ '--font-size': '14px', background: 'transparent' }}
          />
        </div>
      </div>

      {/* 我的学生标题 */}
      <div style={{ padding: '16px', fontSize: '14px', color: '#999' }}>
        我的学生 ({filteredStudents.length})
      </div>

      {/* 学生列表 - 带左滑删除 */}
      <div style={{ padding: '0 12px' }}>
        {filteredStudents.length === 0 ? (
          <Empty description="暂无学生" style={{ padding: '64px 0' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredStudents.map((student) => (
              <SwipeAction
                key={student.id}
                rightActions={[
                  {
                    key: 'delete',
                    text: '删除',
                    color: '#ff4d4f',
                    onClick: () => handleDelete(student)
                  }
                ]}
              >
                <div
                  onClick={() => handleSelect(student)}
                  style={{
                    background: '#fff',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    border: currentStudent?.id === student.id ? '2px solid #1677ff' : '2px solid transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      background: '#e6f7ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden'
                    }}>
                      {student.avatar ? (
                        <img src={student.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#1677ff">
                          <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160z"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#333' }}>
                        {student.name}
                      </div>
                      <div style={{ fontSize: '13px', color: '#999', marginTop: '2px' }}>
                        {student.class || '暂无班级'}
                      </div>
                    </div>
                  </div>
                  
                  {/* 右侧操作区 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* 编辑按钮 */}
                    <Button
                      fill="none"
                      size="small"
                      onClick={(e) => openEditPage(student, e)}
                      style={{ color: '#1677ff', padding: '4px 8px' }}
                    >
                      编辑
                    </Button>
                    
                    {/* 删除按钮 */}
                    <Button
                      fill="none"
                      size="small"
                      onClick={(e) => handleDelete(student, e)}
                      style={{ color: '#ff4d4f', padding: '4px 8px' }}
                    >
                      删除
                    </Button>
                    
                    {/* 当前选中标记 */}
                    {currentStudent?.id === student.id && (
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#1677ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#fff">
                          <path d="M912 224l-48-48-400 400-176-176-48 48 224 224z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </SwipeAction>
            ))}
          </div>
        )}
      </div>

      {/* 底部添加按钮 */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100
      }}>
        <Button 
          color="primary" 
          onClick={openAddPage}
          style={{ 
            borderRadius: '24px', 
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#fff">
            <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
            <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v160H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h160v160c0 17.6 14.4 32 32 32s32-14.4 32-32V544h160c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
          </svg>
          添加学生
        </Button>
      </div>
    </div>
  )

  // 渲染添加/编辑页面
  const renderAddPage = () => (
    <div style={{ padding: '0', background: '#f5f5f5', minHeight: '100%' }}>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleAvatarUpload}
      />

      {/* 顶部导航栏 */}
      <NavBar
        back={null}
        left={<Button fill="none" onClick={() => setShowAddPage(false)}>取消</Button>}
        right={<Button fill="none" color="primary" onClick={handleSave}>保存</Button>}
      >
        {editingStudent ? '编辑学生' : '添加学生'}
      </NavBar>

      {/* 头像上传 */}
      <div style={{ 
        background: '#fff', 
        padding: '32px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        borderBottom: '1px solid #f5f5f5'
      }}>
        <div 
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            overflow: 'hidden',
            border: '2px dashed #ddd'
          }}
        >
          {formData.avatar ? (
            <img src={formData.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <>
              <svg width="32" height="32" viewBox="0 0 1024 1024" fill="#999">
                <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
              </svg>
              <span style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>点击上传头像</span>
            </>
          )}
        </div>
      </div>

      {/* 表单 */}
      <div style={{ background: '#fff' }}>
        {/* 姓名 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '16px',
          borderBottom: '1px solid #f5f5f5'
        }}>
          <span style={{ width: '80px', fontSize: '15px', color: '#333' }}>姓名</span>
          <Input
            placeholder="请输入学生姓名"
            value={formData.name}
            onChange={val => setFormData({ ...formData, name: val })}
            style={{ flex: 1, '--font-size': '15px' }}
          />
        </div>

        {/* 年级 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '16px',
          borderBottom: '1px solid #f5f5f5'
        }}>
          <span style={{ width: '80px', fontSize: '15px', color: '#333' }}>年级<span style={{ color: '#ff4d4f' }}>*</span></span>
          <select
            value={formData.grade}
            onChange={e => setFormData({ ...formData, grade: e.target.value })}
            style={{ 
              flex: 1, 
              fontSize: '15px', 
              border: 'none',
              background: 'transparent',
              color: formData.grade ? '#333' : '#999'
            }}
          >
            <option value="">请选择年级</option>
            {GRADE_OPTIONS.map(grade => (
              <option key={grade} value={grade}>{grade}</option>
            ))}
          </select>
        </div>

        {/* 班级 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '16px',
          borderBottom: '1px solid #f5f5f5'
        }}>
          <span style={{ width: '80px', fontSize: '15px', color: '#333' }}>班级</span>
          <Input
            placeholder="请输入班级（如：1班）"
            value={formData.class}
            onChange={val => setFormData({ ...formData, class: val })}
            style={{ flex: 1, '--font-size': '15px' }}
          />
        </div>

        {/* 备注 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          padding: '16px',
          borderBottom: '1px solid #f5f5f5'
        }}>
          <span style={{ width: '80px', fontSize: '15px', color: '#333', marginTop: '8px' }}>备注</span>
          <textarea
            placeholder="请输入备注（选填）"
            value={formData.remark}
            onChange={e => setFormData({ ...formData, remark: e.target.value })}
            style={{ 
              flex: 1, 
              fontSize: '15px', 
              border: 'none',
              background: 'transparent',
              resize: 'none',
              minHeight: '80px',
              fontFamily: 'inherit'
            }}
          />
        </div>
      </div>

      {/* 删除按钮（编辑模式） */}
      {editingStudent && (
        <div style={{ padding: '16px', marginTop: '24px' }}>
          <Button
            block
            color="danger"
            fill="outline"
            onClick={(e) => handleDelete(editingStudent, e)}
          >
            删除学生
          </Button>
        </div>
      )}

      {/* 头像裁剪器 */}
      {cropperImage && (
        <ImageCropper
          image={cropperImage}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )

  return showAddPage ? renderAddPage() : renderStudentList()
}
