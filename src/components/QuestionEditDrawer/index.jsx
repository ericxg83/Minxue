import { useState, useEffect, useRef } from 'react'
import {
  Button,
  Toast,
  Input,
  TextArea,
  Dialog,
  Mask,
  Image
} from 'antd-mobile'
import { useStudentStore, usePendingQuestionStore, useUIStore, useTaskStore } from '../../store'
import { mockQuestions } from '../../data/mockData'
import ImageCropper from '../../components/ImageCropper'

// 使用测试数据
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

export default function QuestionEditDrawer({ questionId, visible, onClose, onSave }) {
  const { currentStudent } = useStudentStore()
  const { pendingQuestions, updatePendingQuestion } = usePendingQuestionStore()
  const { tasks } = useTaskStore()
  const { setLoading } = useUIStore()

  const [activeTab, setActiveTab] = useState('stem')
  const [question, setQuestion] = useState(null)
  const [formData, setFormData] = useState({
    content: '',
    options: [],
    answer: '',
    analysis: '',
    question_type: 'choice',
    image_url: ''
  })
  const [drawerHeight, setDrawerHeight] = useState(75)
  const [isDragging, setIsDragging] = useState(false)
  const [showCropper, setShowCropper] = useState(false)
  const [cropperImageUrl, setCropperImageUrl] = useState(null)
  const [taskImageUrl, setTaskImageUrl] = useState(null)
  const fileInputRef = useRef(null)
  const startYRef = useRef(0)
  const startHeightRef = useRef(75)

  // 加载题目数据
  useEffect(() => {
    if (questionId && visible) {
      loadQuestion()
    }
  }, [questionId, visible])

  // 重置状态当关闭时
  useEffect(() => {
    if (!visible) {
      setDrawerHeight(75)
      setActiveTab('stem')
      setShowCropper(false)
      setCropperImageUrl(null)
    }
  }, [visible])

  const loadQuestion = async () => {
    setLoading(true)
    try {
      if (USE_MOCK_DATA) {
        let found = pendingQuestions.find(q => q.id === questionId)
        if (!found) {
          found = mockQuestions.find(q => q.id === questionId)
        }

        if (found) {
          setQuestion(found)
          setFormData({
            content: found.content || '',
            options: found.options || [],
            answer: found.answer || '',
            analysis: found.analysis || '',
            question_type: found.question_type || 'choice',
            image_url: found.image_url || ''
          })

          // 加载题目所属试卷的原图
          if (found.task_id) {
            const task = tasks.find(t => t.id === found.task_id)
            if (task?.image_url) {
              setTaskImageUrl(task.image_url)
            }
          }
        } else {
          Toast.show({ icon: 'fail', content: '未找到题目' })
        }
      }
    } catch (error) {
      Toast.show({ icon: 'fail', content: '加载题目失败' })
    } finally {
      setLoading(false)
    }
  }

  // 保存题目
  const handleSave = async () => {
    if (!formData.content.trim()) {
      Toast.show('请输入题目内容')
      return
    }

    setLoading(true)
    try {
      if (USE_MOCK_DATA) {
        const isPendingQuestion = pendingQuestions.some(q => q.id === questionId)

        if (isPendingQuestion) {
          updatePendingQuestion(questionId, {
            ...formData,
            updated_at: new Date().toISOString()
          })
        } else {
          const index = mockQuestions.findIndex(q => q.id === questionId)
          if (index !== -1) {
            mockQuestions[index] = {
              ...mockQuestions[index],
              ...formData,
              updated_at: new Date().toISOString()
            }
          }
        }
      }

      Toast.show({ icon: 'success', content: '保存成功' })
      onSave && onSave({ ...question, ...formData })
      onClose && onClose()
    } catch (error) {
      Toast.show({ icon: 'fail', content: '保存失败' })
    } finally {
      setLoading(false)
    }
  }

  // 添加选项
  const addOption = () => {
    setFormData({
      ...formData,
      options: [...formData.options, '']
    })
  }

  // 更新选项
  const updateOption = (index, value) => {
    const newOptions = [...formData.options]
    newOptions[index] = value
    setFormData({ ...formData, options: newOptions })
  }

  // 删除选项
  const deleteOption = (index) => {
    Dialog.confirm({
      content: '确定删除该选项？',
      onConfirm: () => {
        const newOptions = formData.options.filter((_, i) => i !== index)
        setFormData({ ...formData, options: newOptions })
      }
    })
  }

  // 拖拽开始
  const handleTouchStart = (e) => {
    setIsDragging(true)
    startYRef.current = e.touches[0].clientY
    startHeightRef.current = drawerHeight
  }

  // 拖拽中
  const handleTouchMove = (e) => {
    if (!isDragging) return
    const currentY = e.touches[0].clientY
    const deltaY = startYRef.current - currentY
    const deltaPercent = (deltaY / window.innerHeight) * 100
    let newHeight = startHeightRef.current + deltaPercent

    newHeight = Math.max(40, Math.min(90, newHeight))
    setDrawerHeight(newHeight)
  }

  // 拖拽结束
  const handleTouchEnd = () => {
    setIsDragging(false)
    if (drawerHeight < 50) {
      onClose()
    } else {
      if (drawerHeight < 60) {
        setDrawerHeight(50)
      } else if (drawerHeight > 80) {
        setDrawerHeight(85)
      } else {
        setDrawerHeight(75)
      }
    }
  }

  // 打开裁剪器 - 从试卷裁剪
  const openCropperFromTask = () => {
    if (taskImageUrl) {
      setCropperImageUrl(taskImageUrl)
      setShowCropper(true)
    }
  }

  // 打开文件选择器 - 拍照/上传
  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  // 处理文件选择
  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      Toast.show({ icon: 'fail', content: '请选择图片文件' })
      return
    }

    // 检查文件大小（最大10MB）
    if (file.size > 10 * 1024 * 1024) {
      Toast.show({ icon: 'fail', content: '图片大小不能超过10MB' })
      return
    }

    // 读取文件并打开裁剪器
    const reader = new FileReader()
    reader.onload = (event) => {
      setCropperImageUrl(event.target.result)
      setShowCropper(true)
    }
    reader.readAsDataURL(file)

    // 清空input，允许重复选择同一文件
    e.target.value = ''
  }

  // 处理裁剪完成
  const handleCropConfirm = (croppedImageUrl) => {
    setFormData({ ...formData, image_url: croppedImageUrl })
    setShowCropper(false)
    setCropperImageUrl(null)
    Toast.show({ icon: 'success', content: '插图添加成功' })
  }

  // 标签页配置
  const tabs = [
    { key: 'stem', label: '题干' },
    { key: 'image', label: '插图' },
    { key: 'answer', label: '答案' }
  ]

  if (!visible) return null

  return (
    <>
      {/* 遮罩层 */}
      <Mask
        visible={visible}
        onMaskClick={onClose}
        style={{ '--z-index': 1000 }}
      />

      {/* 抽屉内容 */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${drawerHeight}vh`,
          background: APPLE_COLORS.background,
          borderRadius: '20px 20px 0 0',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          transition: isDragging ? 'none' : 'height 0.3s ease-out',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.1)'
        }}
      >
        {/* 拖拽手柄 */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            padding: '12px 0',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'grab',
            userSelect: 'none'
          }}
        >
          <div style={{
            width: '40px',
            height: '5px',
            background: '#D1D1D6',
            borderRadius: '3px'
          }} />
        </div>

        {/* 头部标题栏 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px 12px',
          borderBottom: `1px solid ${APPLE_COLORS.border}`
        }}>
          <Button fill="none" style={{ color: APPLE_COLORS.textSecondary }} onClick={onClose}>
            取消
          </Button>
          <span style={{ fontSize: '17px', fontWeight: 600, color: APPLE_COLORS.text }}>
            编辑题目
          </span>
          <Button fill="none" style={{ color: APPLE_COLORS.primary, fontWeight: 600 }} onClick={handleSave}>
            保存
          </Button>
        </div>

        {/* 标签页 */}
        <div style={{
          background: APPLE_COLORS.card,
          display: 'flex',
          borderBottom: `1px solid ${APPLE_COLORS.border}`
        }}>
          {tabs.map(tab => (
            <div
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '12px',
                textAlign: 'center',
                fontSize: '14px',
                color: activeTab === tab.key ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
                borderBottom: activeTab === tab.key ? `2px solid ${APPLE_COLORS.primary}` : 'none',
                cursor: 'pointer',
                fontWeight: activeTab === tab.key ? 600 : 400
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {/* 内容区域 - 可滚动 */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          WebkitOverflowScrolling: 'touch'
        }}>
          {/* 题干编辑 - 包含题目内容和选项 */}
          {activeTab === 'stem' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 题目内容 */}
              <div style={{
                background: APPLE_COLORS.card,
                borderRadius: '12px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '12px',
                  color: APPLE_COLORS.text
                }}>
                  题目内容
                </div>
                <TextArea
                  placeholder="请输入题目内容"
                  value={formData.content}
                  onChange={val => setFormData({ ...formData, content: val })}
                  rows={5}
                  showCount
                  maxLength={500}
                  style={{ '--font-size': '15px' }}
                />
              </div>

              {/* 选项编辑 - 仅选择题显示 */}
              {formData.question_type === 'choice' && (
                <div style={{
                  background: APPLE_COLORS.card,
                  borderRadius: '12px',
                  padding: '16px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: APPLE_COLORS.text
                    }}>
                      选项（单选）
                    </div>
                    <span style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary }}>
                      共 {formData.options.length} 个选项
                    </span>
                  </div>

                  {/* 选项列表 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {formData.options.map((option, index) => (
                      <div
                        key={index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '12px',
                          background: APPLE_COLORS.background,
                          borderRadius: '10px'
                        }}
                      >
                        {/* 选项标签 */}
                        <span style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: formData.answer === option ? APPLE_COLORS.success : '#E5E5EA',
                          color: formData.answer === option ? '#fff' : APPLE_COLORS.textSecondary,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          flexShrink: 0
                        }}>
                          {String.fromCharCode(65 + index)}
                        </span>

                        {/* 选项输入 */}
                        <Input
                          value={option}
                          onChange={val => updateOption(index, val)}
                          placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                          style={{ flex: 1, '--font-size': '15px' }}
                        />

                        {/* 删除按钮 */}
                        <div
                          onClick={() => deleteOption(index)}
                          style={{
                            color: APPLE_COLORS.danger,
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <svg width="20" height="20" viewBox="0 0 1024 1024" fill="currentColor">
                            <path d="M864 256H736v-64c0-52.8-43.2-96-96-96H384c-52.8 0-96 43.2-96 96v64H160c-17.6 0-32 14.4-32 32s14.4 32 32 32h704c17.6 0 32-14.4 32-32s-14.4-32-32-32zM384 192h256v64H384V192z"/>
                            <path d="M704 384c-17.6 0-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v448c0 52.8 43.2 96 96 96h320c52.8 0 96-43.2 96-96V416c0-17.6-14.4-32-32-32z"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 添加选项按钮 */}
                  <Button
                    block
                    fill="none"
                    style={{
                      marginTop: '16px',
                      color: APPLE_COLORS.primary,
                      border: `1px dashed ${APPLE_COLORS.primary}`,
                      borderRadius: '10px',
                      height: '44px'
                    }}
                    onClick={addOption}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
                        <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v160H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h160v160c0 17.6 14.4 32 32 32s32-14.4 32-32V544h160c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
                      </svg>
                      添加选项
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 插图 */}
          {activeTab === 'image' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 当前插图预览 */}
              {formData.image_url && (
                <div style={{
                  background: APPLE_COLORS.card,
                  borderRadius: '12px',
                  padding: '16px'
                }}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '12px',
                    color: APPLE_COLORS.text
                  }}>
                    当前插图
                  </div>
                  <div style={{
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: APPLE_COLORS.background
                  }}>
                    <Image
                      src={formData.image_url}
                      alt="题目插图"
                      fit="contain"
                      style={{ width: '100%', maxHeight: '200px' }}
                    />
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    marginTop: '12px'
                  }}>
                    <Button
                      fill="none"
                      style={{
                        flex: 1,
                        color: APPLE_COLORS.danger,
                        border: `1px solid ${APPLE_COLORS.danger}`,
                        borderRadius: '8px'
                      }}
                      onClick={() => setFormData({ ...formData, image_url: '' })}
                    >
                      删除插图
                    </Button>
                    <Button
                      fill="none"
                      style={{
                        flex: 1,
                        color: APPLE_COLORS.primary,
                        border: `1px solid ${APPLE_COLORS.primary}`,
                        borderRadius: '8px'
                      }}
                      onClick={openFilePicker}
                    >
                      拍照替换
                    </Button>
                  </div>
                </div>
              )}

              {/* 从原试卷添加插图 */}
              {!formData.image_url && taskImageUrl && (
                <div style={{
                  background: APPLE_COLORS.card,
                  borderRadius: '12px',
                  padding: '16px'
                }}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '12px',
                    color: APPLE_COLORS.text
                  }}>
                    从原试卷添加插图
                  </div>
                  <div style={{
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: APPLE_COLORS.background,
                    marginBottom: '12px'
                  }}>
                    <Image
                      src={taskImageUrl}
                      alt="试卷原图"
                      fit="contain"
                      style={{ width: '100%', maxHeight: '150px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      color="primary"
                      style={{
                        flex: 1,
                        background: APPLE_COLORS.primary,
                        borderRadius: '10px',
                        height: '44px'
                      }}
                      onClick={openCropperFromTask}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
                          <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                          <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
                        </svg>
                        裁剪试卷插图
                      </span>
                    </Button>
                    <Button
                      fill="none"
                      style={{
                        flex: 1,
                        color: APPLE_COLORS.primary,
                        border: `1px solid ${APPLE_COLORS.primary}`,
                        borderRadius: '10px',
                        height: '44px'
                      }}
                      onClick={openFilePicker}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
                          <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                          <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
                        </svg>
                        拍照上传
                      </span>
                    </Button>
                  </div>
                </div>
              )}

              {/* 无原试卷时的上传选项 */}
              {!formData.image_url && !taskImageUrl && (
                <div style={{
                  background: APPLE_COLORS.card,
                  borderRadius: '12px',
                  padding: '40px',
                  textAlign: 'center'
                }}>
                  <svg width="64" height="64" viewBox="0 0 1024 1024" fill={APPLE_COLORS.textSecondary} style={{ marginBottom: '16px' }}>
                    <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                    <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
                  </svg>
                  <div style={{ fontSize: '16px', color: APPLE_COLORS.text, marginBottom: '8px', fontWeight: 500 }}>
                    暂无插图
                  </div>
                  <div style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary, marginBottom: '20px' }}>
                    该题目未关联试卷，您可以通过拍照添加插图
                  </div>
                  <Button
                    color="primary"
                    style={{
                      background: APPLE_COLORS.primary,
                      borderRadius: '10px',
                      height: '44px',
                      padding: '0 32px'
                    }}
                    onClick={openFilePicker}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                        <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
                      </svg>
                      拍照上传插图
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 答案设置 */}
          {activeTab === 'answer' && (
            <div style={{
              background: APPLE_COLORS.card,
              borderRadius: '12px',
              padding: '16px'
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '12px',
                color: APPLE_COLORS.text
              }}>
                正确答案
              </div>

              {/* 显示AI返回的正确答案 */}
              {formData.answer ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px',
                    background: '#E8F5E9',
                    borderRadius: '10px',
                    border: `1px solid ${APPLE_COLORS.success}`,
                    marginBottom: '16px'
                  }}
                >
                  <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    border: `6px solid ${APPLE_COLORS.success}`,
                    background: '#fff',
                    flexShrink: 0
                  }} />
                  <span style={{ flex: 1, color: APPLE_COLORS.text, fontSize: '15px' }}>
                    {formData.answer}
                  </span>
                </div>
              ) : (
                <div style={{
                  padding: '14px',
                  background: APPLE_COLORS.background,
                  borderRadius: '10px',
                  color: APPLE_COLORS.textSecondary,
                  textAlign: 'center',
                  marginBottom: '16px'
                }}>
                  暂无正确答案
                </div>
              )}

              {/* 解析 */}
              <div>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '12px',
                  color: APPLE_COLORS.text
                }}>
                  题目解析
                </div>
                <TextArea
                  placeholder="请输入题目解析（选填）"
                  value={formData.analysis}
                  onChange={val => setFormData({ ...formData, analysis: val })}
                  rows={6}
                  style={{ '--font-size': '15px' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div style={{
          background: APPLE_COLORS.card,
          padding: '12px 16px 24px',
          borderTop: `1px solid ${APPLE_COLORS.border}`,
          display: 'flex',
          gap: '12px'
        }}>
          <Button
            style={{
              flex: 1,
              height: '44px',
              borderRadius: '10px'
            }}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            color="primary"
            style={{
              flex: 1,
              height: '44px',
              borderRadius: '10px',
              background: APPLE_COLORS.primary
            }}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>
      </div>

      {/* 图片裁剪器 */}
      {showCropper && cropperImageUrl && (
        <ImageCropper
          imageUrl={cropperImageUrl}
          onConfirm={handleCropConfirm}
          onCancel={() => {
            setShowCropper(false)
            setCropperImageUrl(null)
          }}
        />
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  )
}
