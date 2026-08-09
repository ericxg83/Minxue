import { useState, useRef, useCallback, useEffect } from 'react'
import dayjs from 'dayjs'
import { useTaskStore, useStudentStore } from '../store'
import { useToast } from '../components/ToastProvider'
import { taskService } from '../services/taskService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from '../services/aiService'
import { detectQRCode, groupFilesByQRCode, isRetryPaperQRCode } from '../services/qrDetectionService'
import { uploadImage, createTask, addWrongQuestions, clearStudentCaches, invalidateCache } from '../services/apiService'
import { __pendingUploadStore } from '../features/upload/pendingUploadStore'

export function useUploadFlow({ loadTasks, isInitializing }) {
  const Toast = useToast()
  const { currentStudent } = useStudentStore()
  const { tasks, addTask, updateTaskStatus: updateTaskInStore, setTasks } = useTaskStore()

  // loadTasks 每次渲染都是新引用，用 ref 存储避免上传队列 effect 反复触发
  const loadTasksRef = useRef(loadTasks)
  loadTasksRef.current = loadTasks

  // ── 上传流程 state ──
  const [uploading, setUploading] = useState(false)
  const [uploadingTasks, setUploadingTasks] = useState([])
  const [uploadQueue, setUploadQueue] = useState([])
  const [isUploading, setIsUploading] = useState(false)

  // 上传类型 state + ref 镜像（避开 React 18 批处理时序）
  const [pendingFlow, setPendingFlow] = useState(null) // 'workbook' | 'exam' | null
  const [selectedWorksheetId, setSelectedWorksheetId] = useState(null)
  const [flowSubject, setFlowSubject] = useState('数学')
  const [selectedExamResourceId, setSelectedExamResourceId] = useState(null)
  const [showUploadOptions, setShowUploadOptions] = useState(false)
  const [showWorksheetPicker, setShowWorksheetPicker] = useState(false)
  const [showExamChoice, setShowExamChoice] = useState(false)
  const [examChoiceFiles, setExamChoiceFiles] = useState([])
  const [availableExamResources, setAvailableExamResources] = useState([])
  const [homeworkChoiceFiles, setHomeworkChoiceFiles] = useState([])

  const pendingFlowRef = useRef(null)
  const selectedWorksheetIdRef = useRef(null)
  const selectedExamResourceIdRef = useRef(null)
  const flowSubjectRef = useRef('数学')
  pendingFlowRef.current = pendingFlow
  selectedWorksheetIdRef.current = selectedWorksheetId
  selectedExamResourceIdRef.current = selectedExamResourceId
  flowSubjectRef.current = flowSubject

  // ── 多图暂存区 ──
  const [showStaging, setShowStaging] = useState(false)
  const [stagingFiles, setStagingFiles] = useState([]) // [{ file, url, name }]
  const [stagingType, setStagingType] = useState(null) // 'regular' | 'workbook' | 'wrong_retry'
  const [stagingUploading, setStagingUploading] = useState(false)
  const cameraInputRef = useRef(null)
  const albumInputRef = useRef(null)

  const stagingRef = useRef([])
  stagingRef.current = stagingFiles
  const stagingTypeRef = useRef(null)
  stagingTypeRef.current = stagingType
  const homeworkChoiceRef = useRef([])
  homeworkChoiceRef.current = homeworkChoiceFiles

  const toPreviews = (files) =>
    Array.from(files).map((f) => ({
      file: f,
      url: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
      name: f.name
    }))

  const handleStagingSelectFiles = (e) => {
    const previews = toPreviews(e.target.files || [])
    if (e.target && 'value' in e.target) e.target.value = ''
    if (previews.length === 0) return
    setStagingFiles((prev) => [...prev, ...previews])
  }

  const removeStagingFile = (idx) => {
    setStagingFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      if (prev[idx]?.url) URL.revokeObjectURL(prev[idx].url)
      return next
    })
  }

  const clearStaging = () => {
    stagingFiles.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url) })
    setStagingFiles([])
    setStagingType(null)
    setStagingUploading(false)
    setShowStaging(false)
  }

  const openStaging = (type) => {
    setStagingType(type)
    setStagingFiles([])
    setShowStaging(true)
  }

  // 提交暂存区（构造合成事件传给 handleFileSelect）
  const handleSubmitStaging = async () => {
    const files = stagingRef.current
    if (files.length === 0) return
    setStagingUploading(true)
    try {
      if (stagingTypeRef.current === 'homework') {
        setShowStaging(false)
        setHomeworkChoiceFiles(files.map(p => p.file))
        setShowWorksheetPicker(true)
        return
      }

      if (stagingTypeRef.current === 'regular') {
        try {
          const resp = await fetch('/api/resources?type=exam')
          const data = await resp.json()
          const resources = (data.resources || []).filter(r => r.answer_count > 0)
          if (resources.length > 0) {
            setShowStaging(false)
            setExamChoiceFiles(files.map(p => p.file))
            setAvailableExamResources(resources)
            setShowExamChoice(true)
            return
          }
        } catch (e) {
          console.warn('检测答案库失败，继续普通上传:', e)
        }
      }

      const dt = new DataTransfer()
      files.forEach((p) => dt.items.add(p.file))
      setShowStaging(false)
      await handleFileSelect({ target: { files: dt.files } })
    } catch (err) {
      console.error('暂存区提交失败:', err)
    } finally {
      setStagingUploading(false)
    }
  }

  const clearPendingUploadFlow = useCallback(() => {
    setPendingFlow(null)
    setSelectedWorksheetId(null)
    setSelectedExamResourceId(null)
    setFlowSubject('数学')
  }, [])

  // 日常作业：选择练习册后上传
  const handleUploadAsWorkbook = async (worksheetId) => {
    setPendingFlow('workbook')
    setSelectedWorksheetId(worksheetId)
    pendingFlowRef.current = 'workbook'
    selectedWorksheetIdRef.current = worksheetId
    __pendingUploadStore.worksheetId = worksheetId
    __pendingUploadStore.examResourceId = null
    __pendingUploadStore.subject = flowSubject
    const dt = new DataTransfer()
    homeworkChoiceFiles.forEach(f => dt.items.add(f))
    setHomeworkChoiceFiles([])
    await handleFileSelect({ target: { files: dt.files } })
  }

  // 日常作业：未知来源→AI批改
  const handleUploadAsRegular = async () => {
    setPendingFlow(null)
    pendingFlowRef.current = null
    selectedWorksheetIdRef.current = null
    __pendingUploadStore.worksheetId = null
    __pendingUploadStore.examResourceId = null
    const dt = new DataTransfer()
    homeworkChoiceFiles.forEach(f => dt.items.add(f))
    setHomeworkChoiceFiles([])
    await handleFileSelect({ target: { files: dt.files } })
  }

  // 普通试卷：使用已有答案库
  const handleUploadWithExamResource = async (resourceId, resourceName) => {
    setShowExamChoice(false)
    setPendingFlow('exam')
    setSelectedExamResourceId(resourceId)
    pendingFlowRef.current = 'exam'
    selectedExamResourceIdRef.current = resourceId
    __pendingUploadStore.worksheetId = null
    __pendingUploadStore.examResourceId = resourceId
    __pendingUploadStore.subject = flowSubject
    const dt = new DataTransfer()
    examChoiceFiles.forEach(f => dt.items.add(f))
    setExamChoiceFiles([])
    await handleFileSelect({ target: { files: dt.files } })
  }

  // 普通试卷：全新 AI 批改
  const handleUploadFreshExam = async () => {
    setShowExamChoice(false)
    setPendingFlow(null)
    setSelectedExamResourceId(null)
    pendingFlowRef.current = null
    selectedExamResourceIdRef.current = null
    __pendingUploadStore.worksheetId = null
    __pendingUploadStore.examResourceId = null
    const dt = new DataTransfer()
    examChoiceFiles.forEach(f => dt.items.add(f))
    setExamChoiceFiles([])
    await handleFileSelect({ target: { files: dt.files } })
  }

  // 处理上传队列
  useEffect(() => {
    if (uploadQueue.length > 0 && !isUploading && !isInitializing && currentStudent?.id) {
      processUploadQueue()
    }
  }, [uploadQueue, isUploading, isInitializing, currentStudent?.id])

  const processUploadQueue = async () => {
    if (uploadQueue.length === 0 || isUploading || !currentStudent?.id) return
    setIsUploading(true)
    const filesToUpload = [...uploadQueue]
    setUploadQueue([])
    try {
      await uploadViaBackend(filesToUpload)
    } finally {
      setIsUploading(false)
    }
  }

  // 触发上传（指定拍摄模式）
  const triggerUpload = (capture) => {
    const input = document.getElementById('file-input')
    if (!input) return
    if (capture) {
      input.setAttribute('capture', 'environment')
    } else {
      input.removeAttribute('capture')
    }
    input.setAttribute('multiple', 'multiple')
    input.click()
    setShowUploadOptions(false)
  }

  // Upload file handler with QR detection
  const handleFileSelect = async (e) => {
    try {
      const files = Array.from(e.target.files)
      if (files.length === 0) return
      if (e.target && 'value' in e.target) e.target.value = ''

      setShowUploadOptions(false)

      const duplicateFiles = []
      const newFiles = []
      const safeTasks = tasks || []

      for (const file of files) {
        const localDuplicate = safeTasks.find(t =>
          t.original_name === file.name &&
          t.student_id === currentStudent?.id
        )
        if (localDuplicate) {
          duplicateFiles.push(file)
        } else {
          newFiles.push(file)
        }
      }

      if (duplicateFiles.length > 0) {
        Toast.show({ message: `${duplicateFiles.length} 个文件已存在，已自动跳过`, type: 'error' })
      }

      if (newFiles.length === 0) return

      if (isInitializing) {
        Toast.show({ message: `正在初始化，已缓存 ${newFiles.length} 个文件，稍后自动上传...`, type: 'success', duration: 2000 })
        setUploadQueue(prev => [...prev, ...newFiles])
        return
      }

      if (!currentStudent || !currentStudent?.id) {
        Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
        return
      }

      setUploading(true)

      const flow = pendingFlowRef.current
      if (flow === 'workbook') {
        await uploadRegularHomework(newFiles)
        clearPendingUploadFlow()
      } else if (flow === 'exam') {
        await uploadRegularHomework(newFiles)
        clearPendingUploadFlow()
      } else {
        const qrToast = Toast.show({ message: '正在检测二维码...', type: 'loading', duration: 0 })

        const filesWithQR = []
        for (const file of newFiles) {
          const qrContent = await detectQRCode(file)
          filesWithQR.push({ file, qrContent })
        }
        qrToast.dismiss()

        const groupedFiles = groupFilesByQRCode(filesWithQR)

        for (const group of groupedFiles) {
          if (group.isRetryPaper && group.qrContent && isRetryPaperQRCode(group.qrContent)) {
            await uploadRetryPaperGroup(group.files, group.qrContent)
          } else {
            await uploadRegularHomework(group.files)
          }
        }

        clearPendingUploadFlow()
      }

      setUploading(false)
    } catch (err) {
      console.error('上传出错:', err)
      Toast.show({ message: `上传出错: ${err.message}`, type: 'error', duration: 5000 })
      setUploading(false)
    }
  }

  // 错题重练卷（多页合并一个任务）
  const uploadRetryPaperGroup = async (files, qrContent) => {
    const retryToast = Toast.show({ message: `检测到错题重练卷，正在上传 ${files.length} 页...`, type: 'loading', duration: 0 })

    let tempTask
    try {
      tempTask = {
        id: `temp-retry-${Date.now()}`,
        student_id: currentStudent.id,
        original_name: `错题重练_${qrContent}_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}`,
        task_type: 'retry_paper',
        retry_paper_id: qrContent,
        pages: files.map((file, index) => ({
          id: `page-${index + 1}`,
          image_url: URL.createObjectURL(file),
          file_name: file.name,
          page_number: index + 1
        })),
        status: 'pending',
        created_at: new Date().toISOString(),
        isRetryPaper: true
      }

      addTask(tempTask)
      setUploadingTasks(prev => [...prev, tempTask.id])

      const result = await taskService.uploadFiles(currentStudent.id, files, {
        taskType: 'retry_paper',
        retryPaperId: qrContent
      })

      if (result.success && result.tasks && result.tasks.length > 0) {
        const updatedTask = result.tasks[0]
        updateTaskInStore(tempTask.id, 'processing', {
          id: updatedTask.id,
          generatedExamId: updatedTask.generated_exam_id
        })
        processTask(updatedTask)
      }

      retryToast.dismiss()
      Toast.show({ message: `错题重练卷上传成功！`, type: 'success', duration: 2000 })
    } catch (error) {
      console.error('uploadRetryPaperGroup Error:', error)
      if (tempTask) updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
      retryToast.dismiss()
      Toast.show({ message: '错题重练卷上传失败', type: 'error', duration: 3000 })
    } finally {
      retryToast.dismiss()
      if (tempTask) setUploadingTasks(prev => prev.filter(id => id !== tempTask.id))
    }
  }

  // 普通作业 — 多图一任务
  const uploadRegularHomework = async (fileOrFiles) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]
    try {
      await uploadViaBackend(files)
    } catch (error) {
      console.error('uploadRegularHomework Error:', error)
      Toast.show({ message: `作业上传失败: ${error.message}`, type: 'error', duration: 3000 })
    }
  }

  // Upload via backend API — 多图一任务
  const uploadViaBackend = async (files) => {
    const pendingFlowEffective = pendingFlowRef.current
    const worksheetIdEffective = __pendingUploadStore.worksheetId || selectedWorksheetIdRef.current || selectedWorksheetId
    const examResourceIdEffective = __pendingUploadStore.examResourceId || selectedExamResourceIdRef.current || selectedExamResourceId
    const subjectEffective = __pendingUploadStore.subject !== '数学' ? __pendingUploadStore.subject : (flowSubjectRef.current || flowSubject)

    const isWorkbook = pendingFlowEffective === 'workbook' && worksheetIdEffective
    const isExam = pendingFlowEffective === 'exam' && examResourceIdEffective
    const firstFile = files[0]
    const taskName = files.length > 1
      ? `${firstFile.name || '作业'} 等${files.length}页`
      : (firstFile.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`)

    const tempTask = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      student_id: currentStudent.id,
      image_url: URL.createObjectURL(firstFile),
      original_name: taskName,
      task_type: isWorkbook ? 'workbook' : (isExam ? 'exam' : 'homework'),
      pages: files.map((file, index) => ({
        id: `page-${index + 1}`,
        image_url: URL.createObjectURL(file),
        file_name: file.name,
        page_number: index + 1
      })),
      status: 'pending',
      result: { progress: 0 },
      created_at: new Date().toISOString(),
      is_temp: true,
      ...(isWorkbook && { worksheet_id: worksheetIdEffective }),
      ...(isExam && { resource_id: examResourceIdEffective })
    }
    addTask(tempTask)

    clearStudentCaches(currentStudent.id)
    Toast.show({ message: files.length > 1 ? `已添加 ${files.length} 张图片，正在上传...` : '已添加 1 个文件，正在上传...', type: 'success', duration: 2000 })

    let successCount = 0
    let failedCount = 0
    let realTaskId = null

    try {
      const options = {}
      if (isWorkbook) {
        options.worksheetId = worksheetIdEffective
        options.taskType = 'workbook'
        options.subject = subjectEffective
      } else if (isExam) {
        options.resourceId = examResourceIdEffective
        options.taskType = 'exam'
        options.subject = subjectEffective
      }
      const result = await taskService.uploadFiles(currentStudent.id, files, options)
      const taskResult = (result.tasks || []).find(t => !t.error) || (result.tasks || [])[0]

      if (taskResult && !taskResult.error) {
        successCount = 1
        realTaskId = taskResult.id
        if (isWorkbook) __pendingUploadStore.worksheetId = null
        if (isExam) __pendingUploadStore.examResourceId = null
        updateTaskInStore(tempTask.id, 'processing', { progress: 0 })
        setTasks(prev => prev.map(t =>
          t.id === tempTask.id ? { ...taskResult, status: 'processing', pages: taskResult.images || tempTask.pages, is_temp: false } : t
        ))
      } else {
        failedCount = 1
        const errorMsg = taskResult?.message || taskResult?.error || '上传失败'
        updateTaskInStore(tempTask.id, 'failed', { error: errorMsg })
      }
    } catch (error) {
      console.error('uploadViaBackend exception:', error)
      failedCount = 1
      updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
    }

    if (successCount > 0) {
      invalidateCache('tasks', currentStudent.id)
      loadTasksRef.current().then(() => {
        if (realTaskId) {
          updateTaskInStore(realTaskId, 'processing', { progress: 0 })
        }
      })
    }

    if (failedCount > 0) {
      Toast.show({ message: '上传失败', type: 'error', duration: 3000 })
    } else if (successCount > 0) {
      Toast.show({ message: files.length > 1 ? `${files.length} 张图片已合并为一个任务` : '上传成功', type: 'success', duration: 2000 })
    }
  }

  // Upload via frontend (fallback)
  const uploadViaFrontend = async (files) => {
    for (const file of files) {
      try {
        setUploading(true)
        const uploadToast = Toast.show({ message: '正在上传...', type: 'loading', duration: 0 })

        const imageUrl = await uploadImage(file, 'homework')
        const task = await createTask({
          student_id: currentStudent.id,
          image_url: imageUrl,
          original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
          task_type: 'homework',
          status: 'pending'
        })

        addTask(task)
        uploadToast.dismiss()
        processTask(task)
      } catch (error) {
        console.error('上传失败:', error)
        Toast.show({ message: '上传失败，请重试', type: 'error' })
      } finally {
        setUploading(false)
      }
    }
  }

  // Process task (AI recognition)
  const processTask = async (task) => {
    const recognizeToast = Toast.show({ message: '正在识别题目...', type: 'loading', duration: 0 })
    try {
      updateTaskInStore(task.id, 'processing')

      const compressedImage = await compressImage(task.image_url)
      const result = await recognizeQuestions(compressedImage)

      if (result.questions && result.questions.length > 0) {
        const questions = result.questions.map((q, idx) => ({
          task_id: task.id,
          student_id: currentStudent.id,
          content: q.content,
          options: q.options || [],
          answer: q.answer,
          analysis: q.analysis,
          question_type: q.question_type || 'choice',
          subject: q.subject,
          is_correct: q.is_correct,
          status: q.is_correct ? 'pending' : 'wrong',
          image_url: q.image_url,
          ai_tags: q.ai_tags || [],
          tags_source: 'ai'
        }))

        await saveRecognitionResult(task.id, currentStudent.id, questions)
        updateTaskInStore(task.id, 'done', result)

        const wrongQuestions = questions.filter(q => !q.is_correct)
        if (wrongQuestions.length > 0) {
          await addWrongQuestions(currentStudent.id, wrongQuestions.map(q => q.id))
        }

        recognizeToast.dismiss()
        Toast.show({ message: '识别完成，共 ' + questions.length + ' 道题，' + wrongQuestions.length + ' 道错题', type: 'success', duration: 2000 })
      } else {
        updateTaskInStore(task.id, 'failed', { error: '未识别到题目' })
        recognizeToast.dismiss()
        Toast.show({ message: '未识别到题目，请重新上传', type: 'error' })
      }
    } catch (error) {
      console.error('识别失败:', error)
      updateTaskInStore(task.id, 'failed', { error: error.message })
      recognizeToast.dismiss()
      Toast.show({ message: '识别失败，请重试', type: 'error' })
    }
  }

  return {
    // 上传类型 / flow
    pendingFlow, setPendingFlow,
    selectedWorksheetId, setSelectedWorksheetId,
    selectedExamResourceId, setSelectedExamResourceId,
    flowSubject, setFlowSubject,
    clearPendingUploadFlow,

    // 上传入口
    showUploadOptions, setShowUploadOptions,
    showWorksheetPicker, setShowWorksheetPicker,
    triggerUpload,
    handleFileSelect,
    uploading, uploadingTasks,
    uploadQueue, isUploading,

    // 暂存区
    showStaging, stagingFiles, stagingType, stagingUploading,
    cameraInputRef, albumInputRef,
    openStaging, clearStaging,
    handleStagingSelectFiles, removeStagingFile,
    handleSubmitStaging,
    homeworkChoiceFiles, homeworkChoiceRef,
    handleUploadAsWorkbook, handleUploadAsRegular,

    // 答案库选择
    showExamChoice, setShowExamChoice,
    examChoiceFiles, setExamChoiceFiles,
    availableExamResources,
    handleUploadWithExamResource, handleUploadFreshExam
  }
}
