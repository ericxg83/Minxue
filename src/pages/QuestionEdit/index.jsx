import { useState, useEffect, useCallback } from 'react'
import { Button, Toast, Input, TextArea, Dialog, Mask } from 'antd-mobile'
import { useStudentStore, useUIStore, useWrongQuestionStore } from '../../store'
import { updateQuestion, updateQuestionTags, uploadImage } from '../../services/apiService'
import { mockQuestions } from '../../data/mockData'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'

const USE_MOCK_DATA = false

const TABS = [
  { key: 'stem', label: '题干' },
  { key: 'answer', label: '答案' },
  { key: 'tags', label: '标签' }
]

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
  const [cropArea, setCropArea] = useState({ x: 0, y: 0 })
  const [cropZoom, setCropZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [uploading, setUploading] = useState(false)
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
    // Reset input so same file can be re-selected
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCropImageSrc(ev.target.result)
      setCropArea({ x: 0, y: 0 })
      setCropZoom(1)
      setCroppedAreaPixels(null)
      setShowCrop(true)
    }
    reader.readAsDataURL(file)
  }

  const handleCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleCropConfirm = async () => {
    if (!cropImageSrc || !croppedAreaPixels) return

    setUploading(true)
    try {
      // Create canvas and draw the cropped region
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = cropImageSrc
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = reject
      })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = croppedAreaPixels.width
      canvas.height = croppedAreaPixels.height
      ctx.drawImage(
        image,
        croppedAreaPixels.x, croppedAreaPixels.y,
        croppedAreaPixels.width, croppedAreaPixels.height,
        0, 0,
        croppedAreaPixels.width, croppedAreaPixels.height
      )

      // Convert canvas to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('生成图片失败')

      // Upload to OSS
      const file = new File([blob], 'question_image.jpg', { type: 'image/jpeg' })
      const url = await uploadImage(file)

      setDisplayImageUrl(url)
      setImageRemoved(false)
      setShowCrop(false)
      setCropImageSrc('')
      Toast.show({ icon: 'success', content: '图片上传成功' })
    } catch (error) {
      console.error('裁剪/上传失败:', error)
      Toast.show({ icon: 'fail', content: '图片处理失败' })
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
          // 错题本的更新通过 onSave 回调处理
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
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
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
                  </div>
                </div>
                {/* Image upload area */}
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
                    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
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
                        display: 'flex', gap: '8px', marginTop: '8px',
                        justifyContent: 'center'
                      }}>
                        <label style={{
                          fontSize: '12px', color: '#2563EB', cursor: 'pointer',
                          padding: '4px 12px', borderRadius: '6px',
                          background: '#EFF6FF', fontWeight: 500
                        }}>
                          裁剪替换
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileSelected}
                            style={{ display: 'none' }}
                          />
                        </label>
                        <span
                          onClick={handleRemoveImage}
                          style={{
                            fontSize: '12px', color: '#EF4444', cursor: 'pointer',
                            padding: '4px 12px', borderRadius: '6px',
                            background: '#FEF2F2', fontWeight: 500
                          }}
                        >
                          删除配图
                        </span>
                      </div>
                    </div>
                  ) : (
                    <label style={{ cursor: 'pointer', display: 'block' }}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelected}
                        style={{ display: 'none' }}
                      />
                      <div style={{ color: '#6B7280' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" style={{ margin: '0 auto 8px', display: 'block' }}>
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <div style={{ fontSize: '14px', fontWeight: 500, color: '#2563EB' }}>添加配图</div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>支持 JPG / PNG / WebP，可选</div>
                      </div>
                    </label>
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

      {/* ── Image Crop Dialog ── */}
      {showCrop && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50000,
          display: 'flex', flexDirection: 'column',
          background: '#000'
        }}>
          <div style={{
            flex: 1, position: 'relative',
            paddingTop: 'env(safe-area-inset-top, 0px)'
          }}>
            <Cropper
              image={cropImageSrc}
              crop={cropArea}
              zoom={cropZoom}
              aspect={4 / 3}
              cropShape="rect"
              showGrid={true}
              onCropChange={setCropArea}
              onZoomChange={setCropZoom}
              onCropComplete={handleCropComplete}
              style={{
                containerStyle: { background: '#000' },
                cropAreaStyle: { border: '2px solid #fff', color: 'rgba(255,255,255,0.3)' },
                mediaStyle: { maxHeight: '100%' }
              }}
            />
          </div>
          {/* Zoom slider */}
          <div style={{
            padding: '12px 20px', background: '#111',
            display: 'flex', alignItems: 'center', gap: '12px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/>
            </svg>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={cropZoom}
              onChange={e => setCropZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#2563EB' }}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </div>
          {/* Bottom buttons */}
          <div style={{
            padding: '16px 20px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            background: '#111', display: 'flex', gap: '12px'
          }}>
            <button
              onClick={handleCropCancel}
              style={{
                flex: 1, padding: '12px', borderRadius: '10px',
                border: '1px solid #333', background: 'transparent',
                color: '#fff', fontSize: '15px', fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              onClick={handleCropConfirm}
              disabled={uploading}
              style={{
                flex: 1, padding: '12px', borderRadius: '10px',
                border: 'none', background: uploading ? '#5B8DEF' : '#2563EB',
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              {uploading ? '上传中...' : '确认裁剪'}
            </button>
          </div>
        </div>
      )}
    </Mask>
  )
}
