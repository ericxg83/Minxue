import { useState, useEffect } from 'react'
import { Button, Toast, Input, TextArea, Dialog, Mask } from 'antd-mobile'
import { useStudentStore, usePendingQuestionStore, useUIStore, useWrongQuestionStore } from '../../store'
import { updateQuestion, updateQuestionTags } from '../../services/apiService'
import { mockQuestions } from '../../data/mockData'

const USE_MOCK_DATA = false

const TABS = [
  { key: 'stem', label: '题干' },
  { key: 'answer', label: '答案' },
  { key: 'tags', label: '标签' }
]

export default function QuestionEdit({ questionId, onClose, onSave }) {
  const { currentStudent } = useStudentStore()
  const { pendingQuestions, updatePendingQuestion } = usePendingQuestionStore()
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
        found = pendingQuestions.find(q => q.id === questionId)
      }

      if (!found) {
        found = mockQuestions.find(q => q.id === questionId)
      }
      
      if (found) {
        setIsFromWrongBook(isWrongBook)
        setQuestion(found)
        setDisplayImageUrl('')
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

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setDisplayImageUrl(ev.target.result)
    }
    reader.readAsDataURL(file)
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
        updated_at: new Date().toISOString()
      }

      if (USE_MOCK_DATA) {
        const isPendingQuestion = pendingQuestions.some(q => q.id === questionId)
        
        if (isPendingQuestion) {
          updatePendingQuestion(questionId, updatedData)
        } else if (isFromWrongBook) {
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
          background: '#F5F5F7',
          borderRadius: '12px 12px 0 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: '14px'
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
        background: '#F5F5F7',
        borderRadius: '12px 12px 0 0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{
          background: '#fff',
          padding: '16px',
          textAlign: 'center',
          borderBottom: '1px solid #E5E5EA',
          fontSize: '17px',
          fontWeight: 600,
          color: '#1C1C1E'
        }}>
          编辑题目
        </div>

        <div style={{
          background: '#fff',
          display: 'flex',
          borderBottom: '1px solid #E5E5EA'
        }}>
          {TABS.map(tab => (
            <div
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '12px',
                textAlign: 'center',
                fontSize: '15px',
                fontWeight: 500,
                color: activeTab === tab.key ? '#007AFF' : '#8E8E93',
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
                  height: '3px',
                  background: '#007AFF',
                  borderRadius: '2px'
                }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {activeTab === 'stem' && (
            <>
              <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '12px'
              }}>
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#1C1C1E' }}>题目内容</span>
                  <span style={{
                    marginLeft: '8px',
                    fontSize: '12px',
                    color: '#007AFF',
                    background: '#E8F4FD',
                    padding: '2px 8px',
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
                      rows={6}
                      showCount
                      maxLength={500}
                      style={{
                        '--font-size': '14px',
                        '--placeholder-color': '#C7C7CC'
                      }}
                    />
                  </div>
                </div>
                <div style={{ marginTop: '12px', textAlign: 'right' }}>
                  <label style={{
                    fontSize: '13px',
                    color: '#007AFF',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}>
                    {displayImageUrl ? '更换图片' : '上传图片'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
                {displayImageUrl && (
                  <div style={{
                    marginTop: '12px',
                    width: '100px',
                    height: '100px',
                    borderRadius: '8px',
                    background: '#F5F5F7',
                    overflow: 'hidden'
                  }}>
                    <img src={displayImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>

              {formData.question_type === 'choice' && (
                <div style={{
                  background: '#fff',
                  borderRadius: '12px',
                  padding: '16px',
                  marginTop: '12px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px'
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#1C1C1E' }}>选项 (单选)</span>
                    <span
                      onClick={addOption}
                      style={{
                        fontSize: '14px',
                        color: '#007AFF',
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      + 添加选项
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                          background: '#E8F4FD',
                          color: '#007AFF',
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
                          <svg width="18" height="18" viewBox="0 0 1024 1024" fill="#FF3B30">
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
                padding: '16px',
                marginBottom: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid #F0F0F0'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#F5F5F7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#8E8E93">
                      <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160z"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', color: '#8E8E93', marginBottom: '4px' }}>学生答案</div>
                    <div style={{ fontSize: '15px', color: '#1C1C1E' }}>
                      {formData.student_answer || '未作答'}
                      {isFromWrongBook && <span style={{ color: '#8E8E93', fontSize: '12px' }}> (错误记录)</span>}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  paddingTop: '16px'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#E8F4FD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="#007AFF">
                      <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
                      <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v160H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h160v160c0 17.6 14.4 32 32 32s32-14.4 32-32V544h160c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', color: '#007AFF', marginBottom: '4px', fontWeight: 500 }}>正确答案</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1C1C1E' }}>
                      {formData.answer || '未设置'}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                background: '#fff',
                borderRadius: '12px',
                padding: '16px'
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1C1C1E', marginBottom: '12px' }}>
                  题目解析 (选填)
                </div>
                <TextArea
                  placeholder="请输入详细的 AI 解析内容或手动编辑解析内容..."
                  value={formData.analysis}
                  onChange={val => setFormData({ ...formData, analysis: val })}
                  rows={6}
                  style={{
                    '--font-size': '14px',
                    '--placeholder-color': '#C7C7CC'
                  }}
                />
              </div>
            </>
          )}

          {activeTab === 'tags' && (
            <div style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '16px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#007AFF" stroke="#007AFF" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                  </svg>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#1C1C1E' }}>知识点标签</span>
                </div>
                <span style={{
                  fontSize: '12px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: tagsSource === 'ai' ? '#E8F4FD' : '#FFF7E6',
                  color: tagsSource === 'ai' ? '#007AFF' : '#FA8C16'
                }}>
                  {tagsSource === 'ai' ? 'AI 生成' : '人工修正'}
                </span>
              </div>

              {aiTags.length > 0 && tagsSource === 'manual' && (
                <div style={{
                  marginBottom: '12px',
                  paddingBottom: '12px',
                  borderBottom: '1px solid #F0F0F0'
                }}>
                  <div style={{ fontSize: '12px', color: '#8E8E93', marginBottom: '8px' }}>AI 原始标签</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {aiTags.map((tag, index) => (
                      <span
                        key={index}
                        style={{
                          fontSize: '12px',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          background: '#F5F5F7',
                          color: '#8E8E93'
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                {effectiveTags.map((tag, index) => (
                  <span
                    key={index}
                    style={{
                      fontSize: '13px',
                      padding: '6px 12px',
                      borderRadius: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: tagsSource === 'ai' ? '#E8F4FD' : '#FFF7E6',
                      color: tagsSource === 'ai' ? '#007AFF' : '#FA8C16'
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
                  <span style={{ fontSize: '13px', color: '#8E8E93' }}>暂无标签</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Input
                  value={newTagInput}
                  onChange={val => setNewTagInput(val)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="输入标签后按回车添加"
                  style={{ flex: 1, '--font-size': '14px' }}
                />
                <Button
                  size="small"
                  color="primary"
                  onClick={handleAddTag}
                  disabled={!newTagInput.trim()}
                  style={{ borderRadius: '8px' }}
                >
                  添加
                </Button>
              </div>
              <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '8px' }}>
                添加或删除标签后将自动切换为"人工修正"模式
              </div>
            </div>
          )}
        </div>

        <div style={{
          background: '#fff',
          padding: '16px',
          borderTop: '1px solid #E5E5EA',
          display: 'flex',
          gap: '12px'
        }}>
          <Button
            style={{
              flex: 1,
              height: '44px',
              fontSize: '16px',
              borderRadius: '8px',
              background: '#F5F5F7',
              color: '#1C1C1E',
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
              height: '44px',
              fontSize: '16px',
              fontWeight: 600,
              borderRadius: '8px',
              background: '#007AFF'
            }}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>
      </div>
    </Mask>
  )
}
