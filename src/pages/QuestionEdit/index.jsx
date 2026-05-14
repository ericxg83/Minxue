import { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Toast, Input, TextArea, Dialog, Mask } from 'antd-mobile'
import { useStudentStore, useUIStore, useWrongQuestionStore } from '../../store'
import { updateQuestion, updateQuestionTags, uploadImage, getTaskById } from '../../services/apiService'
import { mockQuestions } from '../../data/mockData'
import RectCropper from '../../components/RectCropper'

const USE_MOCK_DATA = false

const TABS = [
  { key: 'stem', label: '题干' },
  { key: 'answer', label: '答案' },
  { key: 'tags', label: '标签' }
]

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], filename, { type: mime })
}

export default function QuestionEdit({ questionId, onClose, onSave }) {
  const { currentStudent } = useStudentStore()
  const { setLoading } = useUIStore()
  const { wrongQuestions } = useWrongQuestionStore()

  const [activeTab, setActiveTab] = useState('stem')
  const [question, setQuestion] = useState(null)
  const [isFromWrongBook, setIsFromWrongBook] = useState(false)
  const [displayImageUrl, setDisplayImageUrl] = useState('')
  const [aiTags, setAiTags] = useState([])
  const [manualTags, setManualTags] = useState([])
  const [tagsSource, setTagsSource] = useState('ai')
  const [newTagInput, setNewTagInput] = useState('')
  const [imageRemoved, setImageRemoved] = useState(false)
  const [showCrop, setShowCrop] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState('')
  const [uploading, setUploading] = useState(false)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [loadingTaskImage, setLoadingTaskImage] = useState(false)
  const [formData, setFormData] = useState({
    content: '',
    options: [],
    answer: '',
    student_answer: '',
    analysis: '',
    question_type: 'choice'
  })

  const cleanOptionPrefix = (options) => {
    return (options || []).map(opt => {
      const cleaned = String(opt).replace(/^[A-Da-d][、.\.\s]*/, '').trim()
      return cleaned
    })
  }

  useEffect(() => {
    if (questionId) {
      loadQuestion()
    }
  }, [questionId])

  const loadQuestion = async () => {
    setLoading(true)
    try {
      let found = null
      let isWrongBook = false

      const wrongBookItem = wrongQuestions.find(wq => wq.question_id === questionId || (wq.question && wq.question.id === questionId))
      if (wrongBookItem) {
        found = wrongBookItem.question || wrongBookItem
        isWrongBook = true
      }

      if (!found) {
        found = mockQuestions.find(q => q.id === questionId)
      }

      if (found) {
        setIsFromWrongBook(isWrongBook)
        setQuestion(found)
        setDisplayImageUrl(found.image_url || '')
        setImageRemoved(false)
        setAiTags(found.ai_tags || [])
        setManualTags(found.manual_tags || [])
        setTagsSource(found.tags_source || 'ai')
        setFormData({
          content: found.content || '',
          options: cleanOptionPrefix(found.options || []),
          answer: found.answer || '',
          student_answer: found.student_answer || '',
          analysis: found.analysis || '',
          question_type: found.question_type || 'choice'
        })
      } else {
        Toast.show({ icon: 'fail', content: '未找到题目' })
      }
    } catch (error) {
      Toast.show({ icon: 'fail', content: '加载题目失败' })
    } finally {
      setLoading(false)
    }
  }

  const getTypeLabel = () => {
    const map = { choice: '选择题', fill: '填空题', answer: '解答题' }
    return map[formData.question_type] || '选择题'
  }

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!file.type.startsWith('image/')) {
      Toast.show({ icon: 'fail', content: '请选择图片文件' })
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      setCropImageSrc(ev.target.result)
      setShowCrop(true)
      setShowSourcePicker(false)
    }
    reader.onerror = () => {
      Toast.show({ icon: 'fail', content: '图片读取失败' })
    }
    reader.readAsDataURL(file)
  }

  const handleAddImageClick = () => {
    setShowSourcePicker(true)
  }

  const handleCropFromTask = async () => {
    if (!question?.task_id) {
      Toast.show({ icon: 'fail', content: '未找到原试卷信息' })
      return
    }
    setLoadingTaskImage(true)
    setShowSourcePicker(false)
    try {
      const task = await getTaskById(question.task_id)
      if (!task?.image_url) {
        Toast.show({ icon: 'fail', content: '原试卷无图片' })
        return
      }
      setCropImageSrc(task.image_url)
      setShowCrop(true)
    } catch (error) {
      console.error('获取原试卷图片失败:', error)
      Toast.show({ icon: 'fail', content: '获取原试卷失败' })
    } finally {
      setLoadingTaskImage(false)
    }
  }

  const handleCropFromUpload = () => {
    setShowSourcePicker(false)
    const fileInput = document.getElementById('question-image-file-input')
    if (fileInput) {
      fileInput.click()
    }
  }

  const handleCropConfirm = async (dataUrl) => {
    if (!dataUrl) return
    setUploading(true)
    try {
      const file = dataURLtoFile(dataUrl, 'question_image.jpg')
      const url = await uploadImage(file)
      setDisplayImageUrl(url)
      setImageRemoved(false)
      setShowCrop(false)
      setCropImageSrc('')
      Toast.show({ icon: 'success', content: '图片裁剪上传成功' })
    } catch (error) {
      console.error('裁剪/上传失败:', error)
      Toast.show({ icon: 'fail', content: '图片处理失败: ' + error.message })
    } finally {
      setUploading(false)
    }
  }

  const handleCropCancel = () => {
    setShowCrop(false)
    setCropImageSrc('')
  }

  const handleRemoveImage = () => {
    Dialog.confirm({
      content: '确定删除配图？',
      confirmText: '删除',
      cancelText: '取消',
      onConfirm: () => {
        setDisplayImageUrl('')
        setImageRemoved(true)
      }
    })
  }

  const getEffectiveTags = () => {
    return tagsSource === 'manual' ? manualTags : aiTags
  }

  const handleAddTag = () => {
    const trimmed = newTagInput.trim()
    if (!trimmed) return
    if (!manualTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      setManualTags([...manualTags, trimmed])
      setTagsSource('manual')
    }
    setNewTagInput('')
  }

  const handleRemoveTag = (tagToRemove) => {
    setManualTags(manualTags.filter(t => t !== tagToRemove))
    setTagsSource('manual')
  }

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  const handleSave = async () => {
    if (!formData.content.trim()) {
      Toast.show('请输入题目内容')
      return
    }

    setLoading(true)
    try {
      const updatedData = {
        ...formData,
        ai_tags: aiTags,
        manual_tags: manualTags,
        tags_source: tagsSource,
        image_url: imageRemoved ? '' : (displayImageUrl || question?.image_url || ''),
        updated_at: new Date().toISOString()
      }

      if (USE_MOCK_DATA) {
        if (isFromWrongBook) {
        } else {
          const index = mockQuestions.findIndex(q => q.id === questionId)
          if (index !== -1) {
            mockQuestions[index] = {
              ...mockQuestions[index],
              ...updatedData
            }
          }
        }
      }

      try {
        await updateQuestion(questionId, updatedData)
      } catch (dbError) {
        console.error('更新数据库失败:', dbError)
      }

      if (tagsSource === 'manual' && manualTags.length > 0) {
        try {
          await updateQuestionTags(questionId, manualTags)
        } catch (tagError) {
          console.error('更新标签失败:', tagError)
        }
      }

      Toast.show({ icon: 'success', content: '保存成功' })
      onSave && onSave({ ...question, ...updatedData })
      onClose && onClose()
    } catch (error) {
      Toast.show({ icon: 'fail', content: '保存失败' })
    } finally {
      setLoading(false)
    }
  }

  const addOption = () => {
    setFormData({
      ...formData,
      options: [...formData.options, '']
    })
  }

  const updateOption = (index, value) => {
    const newOptions = [...formData.options]
    newOptions[index] = value
    setFormData({ ...formData, options: newOptions })
  }

  const deleteOption = (index) => {
    Dialog.confirm({
      content: '确定删除该选项？',
      onConfirm: () => {
        const newOptions = formData.options.filter((_, i) => i !== index)
        setFormData({ ...formData, options: newOptions })
      }
    })
  }

  const effectiveTags = getEffectiveTags()

  if (!question) {
    return (
      <Mask visible={true} disableBodyScroll opacity="thin">
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '85vh',
          background: '#F5F7FA',
          borderRadius: '12px 12px 0 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6B7280',
          fontSize: '13px'
        }}>
          加载中...
        </div>
      </Mask>
    )
  }

  return (
    <Mask
      visible={true}
      disableBodyScroll
      opacity="thin"
    >
      <input
        id="question-image-file-input"
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '85vh',
        background: '#F5F7FA',
        borderRadius: '12px 12px 0 0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{
          background: '#fff',
          padding: '12px 16px',
          textAlign: 'center',
          borderBottom: '1px solid #E5E7EB',
          fontSize: '15px',
          fontWeight: 600,
          color: '#111827'
        }}>
          编辑题目
        </div>

        <div style={{
          background: '#fff',
          display: 'flex',
          borderBottom: '1px solid #E5E7EB'
        }}>
          {TABS.map(tab => (
            <div
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '10px',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: 500,
                color: activeTab === tab.key ? '#2563EB' : '#6B7280',
                position: 'relative',
                cursor: 'pointer'
              }}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '20px',
                  height: '2px',
                  background: '#2563EB',
                  borderRadius: '1px'
                }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
          {activeTab === 'stem' && (
            <>
              <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '12px'
              }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>题目内容</span>
                  <span style={{
                    marginLeft: '8px',
                    fontSize: '11px',
                    color: '#2563EB',
                    background: '#EFF6FF',
                    padding: '1px 6px',
                    borderRadius: '4px'
                  }}>
                    {getTypeLabel()}
                  </span>
                </div>
                <TextArea
                  placeholder="请输入题目内容"
                  value={formData.content}
                  onChange={val => setFormData({ ...formData, content: val })}
                  rows={4}
                  showCount
                  maxLength={500}
                  style={{
                    '--font-size': '13px',
                    '--placeholder-color': '#9CA3AF'
                  }}
                />

                <div style={{
                  marginTop: '12px',
                  border: `2px dashed ${displayImageUrl ? '#2563EB' : '#D1D5DB'}`,
                  borderRadius: '12px',
                  padding: displayImageUrl ? '12px' : '20px',
                  textAlign: 'center',
                  background: displayImageUrl ? '#F8FAFF' : '#FAFAFA',
                  transition: 'all 0.2s'
                }}>
                  {displayImageUrl ? (
                    <div style={{ width: '100%' }}>
                      <img
                        src={displayImageUrl}
                        alt="题目配图"
                        style={{
                          width: '100%',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          borderRadius: '8px',
                          display: 'block',
                          background: '#F5F7FA'
                        }}
                      />
                      <div style={{
                        display: 'flex', gap: '8px', marginTop: '10px',
                        justifyContent: 'center', flexWrap: 'wrap'
                      }}>
                        <Button
                          size="small"
                          color="primary"
                          fill="outline"
                          onClick={handleAddImageClick}
                          style={{ borderRadius: '6px', fontSize: '12px', height: '32px' }}
                        >
                          裁剪替换
                        </Button>
                        <Button
                          size="small"
                          color="danger"
                          fill="outline"
                          onClick={handleRemoveImage}
                          style={{ borderRadius: '6px', fontSize: '12px', height: '32px' }}
                        >
                          删除配图
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={handleAddImageClick}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" style={{ margin: '0 auto 8px', display: 'block' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: '#2563EB' }}>添加配图</div>
                      <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>支持裁剪上传，可选</div>
                    </div>
                  )}
                </div>
              </div>

              {formData.question_type === 'choice' && (
                <div style={{
                  background: '#fff',
                  borderRadius: '12px',
                  padding: '12px',
                  marginTop: '12px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>选项 (单选)</span>
                    <span
                      onClick={addOption}
                      style={{
                        fontSize: '13px',
                        color: '#2563EB',
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      + 添加选项
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {formData.options.map((option, index) => (
                      <div
                        key={index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px'
                        }}
                      >
                        <span style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: '#EFF6FF',
                          color: '#2563EB',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                          fontWeight: 600,
                          flexShrink: 0
                        }}>
                          {String.fromCharCode(65 + index)}
                        </span>
                        <Input
                          value={option}
                          onChange={val => updateOption(index, val)}
                          placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                          style={{ flex: 1, '--font-size': '14px' }}
                        />
                        <div
                          onClick={() => deleteOption(index)}
                          style={{
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 1024 1024" fill="#EF4444">
                            <path d="M864 256H736v-64c0-52.8-43.2-96-96-96H384c-52.8 0-96 43.2-96 96v64H160c-17.6 0-32 14.4-32 32s14.4 32 32 32h704c17.6 0 32-14.4 32-32s-14.4-32-32-32zM384 192h256v64H384V192z"/>
                            <path d="M704 384c-17.6 0-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v384c0 17.6-14.4 32-32 32s-32-14.4-32-32V416c0-17.6-14.4-32-32-32s-32 14.4-32 32v448c0 52.8 43.2 96 96 96h320c52.8 0 96-43.2 96-96V416c0-17.6-14.4-32-32-32z"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'answer' && (
            <>
              <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  paddingBottom: '12px',
                  borderBottom: '1px solid #F3F4F6'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#F5F7FA',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#6B7280">
                      <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160z"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '2px' }}>学生答案</div>
                    <div style={{ fontSize: '14px', color: '#111827' }}>
                      {formData.student_answer || '未作答'}
                      {isFromWrongBook && <span style={{ color: '#9CA3AF', fontSize: '11px' }}> (错误记录)</span>}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  paddingTop: '12px'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#EFF6FF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#2563EB">
                      <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
                      <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v160H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h160v160c0 17.6 14.4 32 32 32s32-14.4 32-32V544h160c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', color: '#2563EB', marginBottom: '2px', fontWeight: 500 }}>正确答案</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                      {formData.answer || '未设置'}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '12px'
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
                  题目解析 (选填)
                </div>
                <TextArea
                  placeholder="请输入详细的 AI 解析内容或手动编辑解析内容..."
                  value={formData.analysis}
                  onChange={val => setFormData({ ...formData, analysis: val })}
                  rows={4}
                  style={{
                    '--font-size': '13px',
                    '--placeholder-color': '#9CA3AF'
                  }}
                />
              </div>
            </>
          )}

          {activeTab === 'tags' && (
            <div style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '12px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563EB" stroke="#2563EB" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>知识点标签</span>
                </div>
                <span style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '8px',
                  background: tagsSource === 'ai' ? '#EFF6FF' : '#FFFBEB',
                  color: tagsSource === 'ai' ? '#2563EB' : '#F59E0B'
                }}>
                  {tagsSource === 'ai' ? 'AI 生成' : '人工修正'}
                </span>
              </div>

              {aiTags.length > 0 && tagsSource === 'manual' && (
                <div style={{
                  marginBottom: '10px',
                  paddingBottom: '10px',
                  borderBottom: '1px solid #F3F4F6'
                }}>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>AI 原始标签</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {aiTags.map((tag, index) => (
                      <span
                        key={index}
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          background: '#F5F7FA',
                          color: '#6B7280'
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {effectiveTags.map((tag, index) => (
                  <span
                    key={index}
                    style={{
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: tagsSource === 'ai' ? '#EFF6FF' : '#FFFBEB',
                      color: tagsSource === 'ai' ? '#2563EB' : '#F59E0B'
                    }}
                  >
                    {tag}
                    {tagsSource === 'manual' && (
                      <span
                        onClick={() => handleRemoveTag(tag)}
                        style={{
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          marginLeft: '2px'
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor">
                          <path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9c-4.4 5.2-.7 13.1 6.1 13.1h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z"/>
                        </svg>
                      </span>
                    )}
                  </span>
                ))}
                {effectiveTags.length === 0 && (
                  <span style={{ fontSize: '13px', color: '#6B7280' }}>暂无标签</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Input
                  value={newTagInput}
                  onChange={val => setNewTagInput(val)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="输入标签后按回车添加"
                  style={{ flex: 1, '--font-size': '13px' }}
                />
                <Button
                  size="small"
                  color="primary"
                  onClick={handleAddTag}
                  disabled={!newTagInput.trim()}
                  style={{ borderRadius: '6px', fontSize: '12px' }}
                >
                  添加
                </Button>
              </div>
              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px' }}>
                添加或删除标签后将自动切换为"人工修正"模式
              </div>
            </div>
          )}
        </div>

        <div style={{
          background: '#fff',
          padding: '12px',
          borderTop: '1px solid #E5E7EB',
          display: 'flex',
          gap: '10px'
        }}>
          <Button
            style={{
              flex: 1,
              height: '38px',
              fontSize: '13px',
              borderRadius: '8px',
              background: '#F3F4F6',
              color: '#111827',
              fontWeight: 500
            }}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            color="primary"
            style={{
              flex: 1,
              height: '38px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              background: '#2563EB'
            }}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>
      </div>

      {/* Source Picker Dialog */}
      {showSourcePicker && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 40000,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          background: 'rgba(0,0,0,0.5)'
        }}>
          <div onClick={() => setShowSourcePicker(false)} style={{ flex: 1 }} />
          <div style={{
            background: '#fff', borderRadius: '16px 16px 0 0',
            padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#111827', textAlign: 'center', marginBottom: '20px' }}>
              选择配图来源
            </div>

            {question?.task_id && (
              <div
                onClick={handleCropFromTask}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '16px', borderRadius: '12px',
                  background: '#F5F7FA', marginBottom: '12px',
                  cursor: 'pointer', transition: 'background 0.2s'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: '#EFF6FF', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>从原试卷裁剪</div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>从原试卷图片中截取本题区域</div>
                </div>
                {loadingTaskImage && (
                  <div style={{ fontSize: '12px', color: '#2563EB' }}>加载中...</div>
                )}
              </div>
            )}

            <div
              onClick={handleCropFromUpload}
              style={{
                display: 'flex', alignItems: 'center', gap: '16px',
                padding: '16px', borderRadius: '12px',
                background: '#F5F7FA', marginBottom: '8px',
                cursor: 'pointer', transition: 'background 0.2s'
              }}
            >
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: '#FEF2F2', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>拍摄或上传裁剪</div>
                <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>拍照或从相册选择图片进行裁剪</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <span
                onClick={() => setShowSourcePicker(false)}
                style={{ fontSize: '14px', color: '#6B7280', cursor: 'pointer', padding: '8px 16px' }}
              >
                取消
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Image Crop Dialog */}
      {showCrop && (
        <RectCropper
          image={cropImageSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
          theme="light"
        />
      )}
    </Mask>
  )
}
