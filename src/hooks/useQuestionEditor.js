import { useState } from 'react'
import { useToast } from '../components/ToastProvider'
import { updateQuestion, uploadImage, getTaskById } from '../services/apiService'

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

// 错题编辑：题干/选项/答案/解析/标签编辑 + 图片裁剪来源选择
export function useQuestionEditor({ wrongQuestions, setWrongQuestions }) {
  const Toast = useToast()

  const [showQuestionEditor, setShowQuestionEditor] = useState(false)
  const [editingQuestionItem, setEditingQuestionItem] = useState(null)
  const [editTab, setEditTab] = useState('stem')
  const [editForm, setEditForm] = useState({ content: '', options: [], answer: '', analysis: '', image_url: '', student_answer: '', question_type: 'choice' })
  const [editTags, setEditTags] = useState([])
  const [editNewTag, setEditNewTag] = useState('')
  const [showEditSourcePicker, setShowEditSourcePicker] = useState(false)
  const [loadingTaskImage, setLoadingTaskImage] = useState(false)
  const [showImageCrop, setShowImageCrop] = useState(false)
  const [cropImage, setCropImage] = useState(null)
  const [uploadingCrop, setUploadingCrop] = useState(false)

  const handleOpenEditor = (wq) => {
    const question = wq.question || wq
    setEditingQuestionItem(wq)
    setEditForm({
      content: question.content || '',
      options: question.options || [],
      answer: question.answer || '',
      analysis: question.analysis || '',
      image_url: question.image_url || '',
      student_answer: question.student_answer || '',
      question_type: question.question_type || 'choice'
    })
    const tags = question.tags_source === 'manual'
      ? (question.manual_tags || [])
      : (question.ai_tags || [])
    setEditTags([...tags])
    setEditNewTag('')
    setEditTab('stem')
    setShowQuestionEditor(true)
  }

  const updateEditForm = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }))
  }

  const handleOpenEditSourcePicker = () => {
    setShowEditSourcePicker(true)
  }

  const handleEditFileSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (e.target && 'value' in e.target) e.target.value = ''
    if (!file.type.startsWith('image/')) {
      Toast.show({ message: '请选择图片文件', type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCropImage(ev.target.result)
      setShowImageCrop(true)
      setShowEditSourcePicker(false)
    }
    reader.onerror = () => {
      Toast.show({ message: '图片读取失败', type: 'error' })
    }
    reader.readAsDataURL(file)
  }

  const handleCropFromTask = async () => {
    const question = editingQuestionItem?.question || editingQuestionItem
    if (!question?.task_id) {
      Toast.show({ message: '未找到原试卷信息', type: 'error' })
      return
    }
    setLoadingTaskImage(true)
    setShowEditSourcePicker(false)
    try {
      const task = await getTaskById(question.task_id)
      if (!task?.image_url) {
        Toast.show({ message: '原试卷无图片', type: 'error' })
        return
      }
      setCropImage(task.image_url)
      setShowImageCrop(true)
    } catch (error) {
      console.error('获取原试卷图片失败:', error)
      Toast.show({ message: '获取原试卷失败', type: 'error' })
    } finally {
      setLoadingTaskImage(false)
    }
  }

  const handleCropFromUpload = () => {
    setShowEditSourcePicker(false)
    const el = document.getElementById('edit-image-file-input')
    if (el) el.click()
  }

  const handleCropConfirm = async (dataUrl) => {
    if (!dataUrl) return
    setUploadingCrop(true)
    try {
      const file = dataURLtoFile(dataUrl, 'question_image.jpg')
      const url = await uploadImage(file)
      updateEditForm('image_url', url)
      setShowImageCrop(false)
      setCropImage(null)
      Toast.show({ message: '图片裁剪上传成功', type: 'success' })
    } catch (error) {
      console.error('裁剪/上传失败:', error)
      Toast.show({ message: '图片处理失败', type: 'error' })
    } finally {
      setUploadingCrop(false)
    }
  }

  const handleCropCancel = () => {
    setShowImageCrop(false)
    setCropImage(null)
  }

  const addEditOption = () => {
    setEditForm(prev => ({ ...prev, options: [...prev.options, ''] }))
  }

  const updateEditOption = (index, value) => {
    setEditForm(prev => {
      const newOptions = [...prev.options]
      newOptions[index] = value
      return { ...prev, options: newOptions }
    })
  }

  const removeEditOption = (index) => {
    setEditForm(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }))
  }

  const handleAddEditTag = () => {
    const trimmed = editNewTag.trim()
    if (!trimmed || editTags.includes(trimmed)) return
    setEditTags([...editTags, trimmed])
    setEditNewTag('')
  }

  const handleRemoveEditTag = (tag) => {
    setEditTags(editTags.filter(t => t !== tag))
  }

  const handleSaveEdit = async () => {
    if (!editForm.content.trim()) {
      Toast.show({ message: '请输入题目内容', type: 'error' })
      return
    }
    const question = editingQuestionItem.question || editingQuestionItem
    const updatedData = {
      content: editForm.content,
      options: editForm.options,
      answer: editForm.answer,
      analysis: editForm.analysis,
      image_url: editForm.image_url,
      question_type: editForm.question_type,
      manual_tags: editTags,
      tags_source: 'manual',
      updated_at: new Date().toISOString()
    }
    try {
      await updateQuestion(question.id, updatedData)
      setWrongQuestions(wrongQuestions.map(wq => {
        if (wq.id === editingQuestionItem.id) {
          return { ...wq, question: { ...(wq.question || wq), ...updatedData } }
        }
        return wq
      }))
      setShowQuestionEditor(false)
      setEditingQuestionItem(null)
      Toast.show({ message: '保存成功', type: 'success' })
    } catch (error) {
      console.error('保存失败:', error)
      Toast.show({ message: '保存失败', type: 'error' })
    }
  }

  return {
    showQuestionEditor, setShowQuestionEditor,
    editingQuestionItem,
    editTab, setEditTab,
    editForm, updateEditForm,
    editTags, editNewTag, setEditNewTag,
    handleAddEditTag, handleRemoveEditTag,
    showEditSourcePicker, setShowEditSourcePicker,
    loadingTaskImage,
    showImageCrop, cropImage,
    handleOpenEditor,
    handleOpenEditSourcePicker,
    handleEditFileSelected,
    handleCropFromTask, handleCropFromUpload,
    handleCropConfirm, handleCropCancel,
    addEditOption, updateEditOption, removeEditOption,
    handleSaveEdit
  }
}
