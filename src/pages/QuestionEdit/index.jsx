import { useState, useEffect } from 'react'
import {
  Button,
  Toast,
  NavBar,
  Input,
  TextArea,
  Radio,
  Dialog
} from 'antd-mobile'
import { useStudentStore, usePendingQuestionStore, useUIStore } from '../../store'
import { mockQuestions } from '../../data/mockData'

// 使用测试数据
const USE_MOCK_DATA = false

export default function QuestionEdit({ questionId, onClose, onSave }) {
  const { currentStudent } = useStudentStore()
  const { pendingQuestions, updatePendingQuestion } = usePendingQuestionStore()
  const { setLoading } = useUIStore()
  
  const [activeTab, setActiveTab] = useState('preview')
  const [question, setQuestion] = useState(null)
  const [formData, setFormData] = useState({
    content: '',
    options: [],
    answer: '',
    analysis: '',
    question_type: 'choice'
  })

  // 加载题目数据
  useEffect(() => {
    if (questionId) {
      loadQuestion()
    }
  }, [questionId])

  const loadQuestion = async () => {
    setLoading(true)
    try {
      if (USE_MOCK_DATA) {
        // 先从 pendingQuestions 中查找（从处理页面同步过来的题目）
        let found = pendingQuestions.find(q => q.id === questionId)
        
        // 如果没找到，再从 mockQuestions 中查找
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
            question_type: found.question_type || 'choice'
          })
        } else {
          Toast.show({ icon: 'fail', content: '未找到题目' })
        }
      } else {
        // 从数据库加载
        // const { data } = await supabase.from('questions').select('*').eq('id', questionId).single()
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
        // 检查是否是 pendingQuestions 中的题目
        const isPendingQuestion = pendingQuestions.some(q => q.id === questionId)
        
        if (isPendingQuestion) {
          // 更新 pendingQuestions
          updatePendingQuestion(questionId, {
            ...formData,
            updated_at: new Date().toISOString()
          })
        } else {
          // 更新 mockQuestions
          const index = mockQuestions.findIndex(q => q.id === questionId)
          if (index !== -1) {
            mockQuestions[index] = {
              ...mockQuestions[index],
              ...formData,
              updated_at: new Date().toISOString()
            }
          }
        }
      } else {
        // 更新数据库
        // await supabase.from('questions').update(formData).eq('id', questionId)
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
    const newOption = ''
    setFormData({
      ...formData,
      options: [...formData.options, newOption]
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

  // 移动选项
  const moveOption = (index, direction) => {
    const newOptions = [...formData.options]
    if (direction === 'up' && index > 0) {
      [newOptions[index], newOptions[index - 1]] = [newOptions[index - 1], newOptions[index]]
    } else if (direction === 'down' && index < newOptions.length - 1) {
      [newOptions[index], newOptions[index + 1]] = [newOptions[index + 1], newOptions[index]]
    }
    setFormData({ ...formData, options: newOptions })
  }

  // 标签页配置
  const tabs = [
    { key: 'preview', label: '题目预览' },
    { key: 'options', label: '选项编辑' },
    { key: 'image', label: '插图' },
    { key: 'answer', label: '答案设置' }
  ]

  if (!question) {
    return (
      <div style={{ padding: '64px 0', textAlign: 'center', color: '#999' }}>
        加载中...
      </div>
    )
  }

  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#f5f5f5',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部导航栏 */}
      <NavBar
        back={null}
        left={<Button fill="none" onClick={onClose}>取消</Button>}
        right={<Button fill="none" color="primary" onClick={handleSave}>保存</Button>}
      >
        编辑题目
      </NavBar>

      {/* 标签页 */}
      <div style={{ 
        background: '#fff', 
        display: 'flex',
        borderBottom: '1px solid #f0f0f0'
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
              color: activeTab === tab.key ? '#1677ff' : '#666',
              borderBottom: activeTab === tab.key ? '2px solid #1677ff' : 'none',
              cursor: 'pointer'
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* 题目预览 / 题目内容编辑 */}
        {(activeTab === 'preview' || activeTab === 'options') && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
              题目内容
            </div>
            <TextArea
              placeholder="请输入题目内容"
              value={formData.content}
              onChange={val => setFormData({ ...formData, content: val })}
              rows={6}
              showCount
              maxLength={500}
            />
          </div>
        )}

        {/* 选项编辑 */}
        {activeTab === 'options' && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
                选项（单选）
              </div>
              <Button size="small" fill="none" style={{ color: '#1677ff' }}>
                批量设置
              </Button>
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
                    background: '#f5f5f5',
                    borderRadius: '8px'
                  }}
                >
                  {/* 拖拽手柄 */}
                  <div style={{ color: '#999', cursor: 'move' }}>
                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                      <path d="M384 192c0-35.2 28.8-64 64-64s64 28.8 64 64-28.8 64-64 64-64-28.8-64-64z"/>
                      <path d="M384 512c0-35.2 28.8-64 64-64s64 28.8 64 64-28.8 64-64 64-64-28.8-64-64z"/>
                      <path d="M384 832c0-35.2 28.8-64 64-64s64 28.8 64 64-28.8 64-64 64-64-28.8-64-64z"/>
                    </svg>
                  </div>
                  
                  {/* 选项标签 */}
                  <span style={{ 
                    width: '24px', 
                    height: '24px', 
                    borderRadius: '50%', 
                    background: '#e6f7ff',
                    color: '#1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  
                  {/* 选项输入 */}
                  <Input
                    value={option}
                    onChange={val => updateOption(index, val)}
                    placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                    style={{ flex: 1, '--font-size': '14px' }}
                  />
                  
                  {/* 删除按钮 */}
                  <div 
                    onClick={() => deleteOption(index)}
                    style={{ color: '#ff4d4f', cursor: 'pointer', padding: '4px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
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
                color: '#1677ff',
                border: '1px dashed #1677ff',
                borderRadius: '8px'
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

        {/* 答案设置 */}
        {activeTab === 'answer' && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '16px', color: '#333' }}>
              正确答案
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {formData.options.map((option, index) => (
                <div 
                  key={index}
                  onClick={() => setFormData({ ...formData, answer: option })}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '12px',
                    padding: '12px',
                    background: formData.answer === option ? '#e6f7ff' : '#f5f5f5',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: formData.answer === option ? '1px solid #1677ff' : '1px solid transparent'
                  }}
                >
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: formData.answer === option ? '4px solid #1677ff' : '2px solid #999',
                    background: '#fff'
                  }} />
                  <span style={{ 
                    width: '24px', 
                    height: '24px', 
                    borderRadius: '50%', 
                    background: formData.answer === option ? '#1677ff' : '#e6f7ff',
                    color: formData.answer === option ? '#fff' : '#1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span style={{ flex: 1, color: '#333' }}>
                    {option || `选项 ${String.fromCharCode(65 + index)}`}
                  </span>
                </div>
              ))}
            </div>

            {/* 解析 */}
            <div style={{ marginTop: '24px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
                题目解析
              </div>
              <TextArea
                placeholder="请输入题目解析（选填）"
                value={formData.analysis}
                onChange={val => setFormData({ ...formData, analysis: val })}
                rows={4}
              />
            </div>
          </div>
        )}

        {/* 插图 */}
        {activeTab === 'image' && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
              题目插图
            </div>
            <div style={{ 
              border: '2px dashed #ddd', 
              borderRadius: '8px', 
              padding: '32px',
              textAlign: 'center',
              color: '#999'
            }}>
              <svg width="48" height="48" viewBox="0 0 1024 1024" fill="#ddd" style={{ marginBottom: '8px' }}>
                <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128z"/>
                <path d="M512 416c-88 0-160 72-160 160s72 160 160 160 160-72 160-160-72-160-160-160zm0 256c-52.8 0-96-43.2-96-96s43.2-96 96-96 96 43.2 96 96-43.2 96-96 96z"/>
              </svg>
              <div>点击上传图片</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>支持 JPG、PNG 格式</div>
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div style={{ 
        background: '#fff', 
        padding: '12px 16px',
        borderTop: '1px solid #f0f0f0',
        display: 'flex',
        gap: '12px'
      }}>
        <Button 
          style={{ flex: 1 }}
          onClick={onClose}
        >
          取消
        </Button>
        <Button 
          color="primary" 
          style={{ flex: 1 }}
          onClick={handleSave}
        >
          保存
        </Button>
      </div>
    </div>
  )
}
