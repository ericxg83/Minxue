import { useState, useRef, useCallback, useEffect } from 'react'
import dayjs from 'dayjs'
import { useTaskStore, useStudentStore } from '../store'
import { useToast } from '../components/ToastProvider'
import { taskService } from '../services/taskService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from '../services/aiService'
import { detectQRCode, parseRetryExamId } from '../services/qrDetectionService'
import { compressImagesForUpload, describeUploadFailure } from '../utils/imageUtils'
import { apiRequest, uploadImage, createTask, addWrongQuestions, clearStudentCaches, invalidateCache } from '../services/apiService'
import { takePhotoFiles, pickPhotoFiles, isNativeCameraAvailable, describeCameraError } from '../services/nativeCamera'
import { warmUpConnection, getNetworkHealth, resetNetworkHealth } from '../services/httpCore'
import { __pendingUploadStore } from '../features/upload/pendingUploadStore'

export function useUploadFlow({ loadTasks, isInitializing }) {
  const Toast = useToast()
  const { currentStudent } = useStudentStore()
  const { tasks, addTask, updateTaskStatus: updateTaskInStore, updateTaskFromServer, setTasks } = useTaskStore()

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
  const [cameraBusy, setCameraBusy] = useState(false) // 原生相机/相册打开中
  const cameraInputRef = useRef(null)
  const albumInputRef = useRef(null)

  // 2026-09-02 修复：handleFileSelect 路径连点上传的并发锁。
  // setUploading/setIsUploading 都是 React state，在事件回调里连点两次时
  // 第二次读到的是上一次闭包里的旧值（仍是 false），无法拦住。改用 ref 持锁，
  // 同步立即可见，第二次直接 return。
  const uploadLockRef = useRef(false)

  const stagingRef = useRef([])
  stagingRef.current = stagingFiles
  const stagingTypeRef = useRef(null)
  stagingTypeRef.current = stagingType
  // 组卷历史「上传答卷」：本次暂存绑定到的 generated_exam UUID（stagingType='retry_bound' 时有效）
  const retryBoundExamIdRef = useRef(null)
  const homeworkChoiceRef = useRef([])
  homeworkChoiceRef.current = homeworkChoiceFiles

  // HEIC 预览：Android WebView file.type 经常是空 → 退化靠扩展名判断。
  // 浏览器原 <img> 解不开 HEIC 会显示 broken image（onError 兜底），但不至于白屏。
  // 真 HEIC 上传给后端，fixFileIfNeeded needsHeicTranscode 走 heic-decode 转 jpg。
  const isHeic = (f) =>
    (f?.type || '').match(/^image\/(heic|heif)$/i) || /\.(heic|heif)$/i.test(f?.name || '')

  const toPreviews = (files) =>
    Array.from(files).map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      isHeic: isHeic(f),
      name: f.name
    }))

  const handleStagingSelectFiles = (e) => {
    const previews = toPreviews(e.target.files || [])
    if (e.target && 'value' in e.target) e.target.value = ''
    if (previews.length === 0) return
    setStagingFiles((prev) => [...prev, ...previews])
  }

  // ── 拍照 / 相册入口 ──
  // 原生平台走 @capacitor/camera：WebView 的 <input capture> 会被 BridgeActivity
  // 的文件选择器吞掉，点"拍照"也只会打开相册。Web 端保留原来的 input 行为。
  const appendStagingFiles = (files) => {
    if (!files || files.length === 0) return
    setStagingFiles((prev) => [...prev, ...toPreviews(files)])
  }

  const runNativePicker = async (picker) => {
    if (cameraBusy) return
    setCameraBusy(true)
    try {
      const files = await picker()
      appendStagingFiles(files)
    } catch (e) {
      const msg = describeCameraError(e)
      // 用户主动取消不算错误，静默返回
      if (msg) Toast.show({ message: msg, type: 'error', duration: 3000 })
    } finally {
      setCameraBusy(false)
    }
  }

  const onStagingCamera = () => {
    if (!isNativeCameraAvailable()) {
      cameraInputRef.current?.click()
      return
    }
    runNativePicker(takePhotoFiles)
  }

  const onStagingAlbum = () => {
    if (!isNativeCameraAvailable()) {
      albumInputRef.current?.click()
      return
    }
    runNativePicker(() => pickPhotoFiles(20))
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
    retryBoundExamIdRef.current = null
  }

  const openStaging = (type) => {
    setStagingType(type)
    setStagingFiles([])
    setShowStaging(true)
  }

  // 组卷历史「上传答卷」主入口：已选定这份卷(examId)，上传的所有页直接绑到该 examId 走重练批改。
  const openStagingForRetry = (examId) => {
    retryBoundExamIdRef.current = examId
    setStagingType('retry_bound')
    setStagingFiles([])
    setShowStaging(true)
  }

  // 提交暂存区（构造合成事件传给 handleFileSelect）
  const handleSubmitStaging = async () => {
    const files = stagingRef.current
    if (files.length === 0) return
    setStagingUploading(true)
    try {
      if (stagingTypeRef.current === 'retry_bound') {
        const examId = retryBoundExamIdRef.current
        if (!examId) {
          Toast.show({ message: '未定位到这份重练卷，请重新选择', type: 'error' })
          return
        }
        setShowStaging(false)
        await uploadRetryPaperGroup(files.map(p => p.file), examId)
        retryBoundExamIdRef.current = null
        return
      }

      if (stagingTypeRef.current === 'homework') {
        setShowStaging(false)
        setHomeworkChoiceFiles(files.map(p => p.file))
        setShowWorksheetPicker(true)
        return
      }

      if (stagingTypeRef.current === 'regular') {
        try {
          // 必须用 exam-papers：它只返回 teacher_verified/official_verified 的答案库。
          // 旧的 /api/resources?type=exam 不过滤审核状态，会把 AI 批改自动沉淀的 ai_draft
          // 草稿（可能含"计算错误"这类脏答案）也列进选择器，绕过 PC 后台的人工确认。
          //
          // 必须走 apiRequest：原来是裸 fetch('/api/...')，相对路径在 Web 端由 vite
          // dev proxy 兜住，打包进 App 后却打到 https://localhost/api/... → 必然失败，
          // 且被下面的 catch 静默吞掉，用户永远看不到答案库选择弹窗。
          const data = await apiRequest('/resources/exam-papers')
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
    __pendingUploadStore.worksheetId = null
    __pendingUploadStore.worksheetName = null
    __pendingUploadStore.examResourceId = null
    __pendingUploadStore.examResourceName = null
  }, [])

  // 日常作业：选择练习册后上传
  const handleUploadAsWorkbook = async (worksheetId, worksheetName) => {
    setPendingFlow('workbook')
    setSelectedWorksheetId(worksheetId)
    pendingFlowRef.current = 'workbook'
    selectedWorksheetIdRef.current = worksheetId
    __pendingUploadStore.worksheetId = worksheetId
    __pendingUploadStore.worksheetName = worksheetName || null
    __pendingUploadStore.examResourceId = null
    __pendingUploadStore.examResourceName = null
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
    __pendingUploadStore.worksheetName = null
    __pendingUploadStore.examResourceId = null
    __pendingUploadStore.examResourceName = null
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
    __pendingUploadStore.worksheetName = null
    __pendingUploadStore.examResourceId = resourceId
    __pendingUploadStore.examResourceName = resourceName || null
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
    __pendingUploadStore.worksheetName = null
    __pendingUploadStore.examResourceId = null
    __pendingUploadStore.examResourceName = null
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
    // 2026-09-10 修复：队列项在「选文件时」就绑定学生 id。
    // 之前队列只存 File，初始化完成后用"当时的" currentStudent 上传，
    // 若期间学生被切走（如初始化后台刷新覆盖），作业就会归到错误学生名下。
    const queuedItems = [...uploadQueue]
    setUploadQueue([])
    try {
      const queuedStudentId = queuedItems.find(i => i?.studentId)?.studentId || currentStudent?.id
      if (!queuedStudentId) {
        Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
        return
      }
      await uploadViaBackend(queuedItems.map(i => i?.file ?? i), queuedStudentId)
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
    // 2026-09-02：ref-based 并发锁，挡住"连点上传"导致的重复任务 + 重复错题。
    // setUploading 是 React state，连点时第二次读到的还是 false → 拦不住。
    if (uploadLockRef.current) {
      console.warn('[Upload] 已有上传任务进行中，忽略本次点击')
      if (e.target && 'value' in e.target) e.target.value = ''
      return
    }
    uploadLockRef.current = true
    try {
      const files = Array.from(e.target.files)
      if (files.length === 0) {
        uploadLockRef.current = false
        return
      }
      if (e.target && 'value' in e.target) e.target.value = ''

      setShowUploadOptions(false)

      const duplicateFiles = []
      const newFiles = []
      const safeTasks = tasks || []

      for (const file of files) {
        // 任务名已改为练习册名/科目+时间，不再含文件名，去重按任务内的图片文件名匹配
        const localDuplicate = safeTasks.find(t =>
          t.student_id === currentStudent?.id &&
          (t.original_name === file.name ||
            (Array.isArray(t.images) && t.images.some(img => img.file_name === file.name)) ||
            (Array.isArray(t.pages) && t.pages.some(p => p.file_name === file.name)))
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
        // 队列项绑定选文件那一刻的学生 id：初始化完成后按快照归属，不用"当时的" currentStudent
        setUploadQueue(prev => [...prev, ...newFiles.map(f => ({ file: f, studentId: currentStudent?.id || null }))])
        return
      }

      if (!currentStudent || !currentStudent?.id) {
        Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
        return
      }

      // 2026-09-10 修复：归属学生在「提交时」锁定为快照，后续压缩/网络等待期间
      // 即使 currentStudent 再变化（如后台刷新覆盖），这次上传仍归到提交时的学生。
      const studentSnapshotId = currentStudent.id

      setUploading(true)

      const flow = pendingFlowRef.current
      if (flow === 'workbook') {
        await uploadRegularHomework(newFiles, studentSnapshotId)
        clearPendingUploadFlow()
      } else if (flow === 'exam') {
        await uploadRegularHomework(newFiles, studentSnapshotId)
        clearPendingUploadFlow()
      } else {
        const qrToast = Toast.show({ message: '正在检测二维码...', type: 'loading', duration: 0 })

        const filesWithQR = []
        for (const file of newFiles) {
          const qrContent = await detectQRCode(file)
          filesWithQR.push({ file, examId: parseRetryExamId(qrContent) })
        }
        qrToast.dismiss()

        // 整批绑定一份 examId：一次上传内任一页识别到重练码，即视为"同一份卷的多页"，
        // 全部绑到那个 examId 走重练批改。反面/内页没有码不再被拆去日常批改。
        const distinctIds = [...new Set(filesWithQR.map(f => f.examId).filter(Boolean))]

        if (distinctIds.length === 1) {
          await uploadRetryPaperGroup(newFiles, distinctIds[0])
        } else if (distinctIds.length > 1) {
          Toast.show({ message: '一次上传里检测到多份重练卷，请分开上传', type: 'error', duration: 3500 })
        } else {
          await uploadRegularHomework(newFiles, studentSnapshotId)
        }

        clearPendingUploadFlow()
      }

      setUploading(false)
    } catch (err) {
      console.error('上传出错:', err)
      Toast.show({ message: `上传出错: ${err.message}`, type: 'error', duration: 5000 })
      setUploading(false)
    } finally {
      uploadLockRef.current = false
    }
  }

  // 错题重练卷（整批多页合并为一个重练批改任务，examId = 裸 generated_exam UUID）
  const uploadRetryPaperGroup = async (files, examId) => {
    const retryToast = Toast.show({ message: `检测到错题重练卷，正在上传 ${files.length} 页...`, type: 'loading', duration: 0 })

    let tempTask
    try {
      tempTask = {
        id: `temp-retry-${Date.now()}`,
        student_id: currentStudent.id,
        original_name: `错题重练_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}`,
        task_type: 'wrong_retry',
        generated_exam_id: examId,
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

      const result = await taskService.uploadRetryAnswer(examId, files)

      if (result.success && result.tasks && result.tasks.length > 0) {
        const updatedTask = result.tasks[0]
        updateTaskInStore(tempTask.id, 'processing', {
          id: updatedTask.id,
          generatedExamId: updatedTask.generated_exam_id || examId
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
  const uploadRegularHomework = async (fileOrFiles, studentIdOverride = null) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]
    try {
      await uploadViaBackend(files, studentIdOverride)
    } catch (error) {
      console.error('uploadRegularHomework Error:', error)
      Toast.show({ message: describeUploadFailure(error), type: 'error', duration: 4000 })
    }
  }

  // 失败行 upsert：保证"上传失败"一定在列表里可见、可重试，
  // 而不是只剩一个几秒后消失的 toast（图片此时已无从找回入口）。
  // 落库文案用人类可读版本：列表的失败分类会把 "timeout" 误判成"AI 服务响应超时"。
  const upsertFailedTemp = (tempTask, error) => {
    // 尽量传原始错误对象：describeUploadFailure 靠 httpCore 打的 code 判断失败类型，
    // 只传字符串会退化成按文案正则猜，容易误判。
    const readable = describeUploadFailure(error)
    const raw = typeof error === 'string' ? error : (error?.message || String(error || ''))
    updateTaskFromServer({ ...tempTask, status: 'failed', error: readable, result: { error: readable, rawError: raw } })
  }

  // 客户端重传：temp 任务服务端没有记录，/api/tasks/retry 无从下手；
  // 靠 temp 上保留的 File 引用原样重走一次上传管道。
  const retryTempUpload = async (taskId) => {
    // 用户点重试就是一个明确的新意图，先把"连接失效"计数清零，
    // 否则上一次失败残留的计数会让后续所有请求都走"先预热"的慢路径。
    resetNetworkHealth()
    const temp = (Array.isArray(tasks) ? tasks : []).find(t => t.id === taskId)
    const files = temp?.__files
    if (!temp || !Array.isArray(files) || files.length === 0) {
      Toast.show({ message: '原图片已丢失，请重新拍照上传', type: 'error', duration: 3000 })
      setTasks(prev => prev.filter(t => t.id !== taskId))
      return
    }
    const opts = temp.__options || {}
    if (opts.worksheetId) {
      setPendingFlow('workbook')
      pendingFlowRef.current = 'workbook'
      setSelectedWorksheetId(opts.worksheetId)
      selectedWorksheetIdRef.current = opts.worksheetId
      __pendingUploadStore.worksheetId = opts.worksheetId
      __pendingUploadStore.worksheetName = opts.worksheetName || null
      __pendingUploadStore.subject = opts.subject || '数学'
    } else if (opts.resourceId) {
      setPendingFlow('exam')
      pendingFlowRef.current = 'exam'
      setSelectedExamResourceId(opts.resourceId)
      selectedExamResourceIdRef.current = opts.resourceId
      __pendingUploadStore.examResourceId = opts.resourceId
      __pendingUploadStore.subject = opts.subject || '数学'
    } else {
      setPendingFlow(null)
      pendingFlowRef.current = null
    }
    // 先移除旧行，重传会生成新的 temp 任务
    setTasks(prev => prev.filter(t => t.id !== taskId))
    // 重传沿用 temp 任务创建时的学生归属，不能跟着当前选中的学生走
    await uploadViaBackend(files, temp.student_id)
  }

  // Upload via backend API — 多图一任务
  // 2026-09-10 修复：新增 studentIdOverride——作业归属只认「提交/入队时」锁定的学生快照。
  // 曾经的事故：App 初始化的后台学生刷新会在用户拍照期间把 currentStudent 静默切回
  // 上次的学生，这里读到被覆盖后的 id，陆晨曦的作业被归到蔡怡希名下。
  const uploadViaBackend = async (rawFiles, studentIdOverride = null) => {
    const studentId = studentIdOverride || currentStudent?.id
    if (!studentId) {
      Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
      return
    }

    const pendingFlowEffective = pendingFlowRef.current
    const worksheetIdEffective = __pendingUploadStore.worksheetId || selectedWorksheetIdRef.current || selectedWorksheetId
    const worksheetNameEffective = __pendingUploadStore.worksheetName
    const examResourceIdEffective = __pendingUploadStore.examResourceId || selectedExamResourceIdRef.current || selectedExamResourceId
    const examResourceNameEffective = __pendingUploadStore.examResourceName
    const subjectEffective = __pendingUploadStore.subject !== '数学' ? __pendingUploadStore.subject : (flowSubjectRef.current || flowSubject)

    const isWorkbook = pendingFlowEffective === 'workbook' && worksheetIdEffective
    const isExam = pendingFlowEffective === 'exam' && examResourceIdEffective

    // 上传前压缩：压缩失败一律回退原图，绝不因为压缩环节丢用户的作业
    let files = rawFiles
    try {
      const packed = await compressImagesForUpload(rawFiles)
      if (packed.savedBytes > 0) {
        console.debug(`[Upload] 图片压缩：减少 ${(packed.savedBytes / 1024 / 1024).toFixed(1)}MB`)
        files = packed.files
      }
    } catch (e) {
      console.warn('[Upload] 图片压缩跳过:', e?.message)
    }

    // 任务名用用户在内页选的名字（练习册/答案库），无名可取时用 科目+时间；
    // 相机文件名（IMG_xxx.jpg）对用户没有辨识度，列表里全靠它分不清是哪份作业。
    const timeLabel = dayjs().format('MM/DD HH:mm')
    const taskName = isWorkbook && worksheetNameEffective
      ? `${subjectEffective} · ${worksheetNameEffective}`
      : isExam && examResourceNameEffective
        ? examResourceNameEffective
        : `${subjectEffective || '数学'}作业 ${timeLabel}`

    const tempTask = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      student_id: studentId,
      image_url: URL.createObjectURL(files[0]),
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
      // 客户端重传所需：File 引用 + 上传通道上下文（服务端没有该记录，服务端 retry 用不了）
      __files: files,
      __options: {
        worksheetId: isWorkbook ? worksheetIdEffective : null,
        worksheetName: isWorkbook ? worksheetNameEffective : null,
        resourceId: isExam ? examResourceIdEffective : null,
        subject: subjectEffective
      },
      ...(isWorkbook && { worksheet_id: worksheetIdEffective }),
      ...(isExam && { resource_id: examResourceIdEffective })
    }
    addTask(tempTask)

    clearStudentCaches(studentId)
    // 不再用 success 样式提示"正在上传"——用户会把绿色的"已添加"误读成上传成功
    const uploadToast = Toast.show({ message: files.length > 1 ? `正在上传 ${files.length} 张图片...` : '正在上传...', type: 'loading', duration: 0 })

    let successCount = 0
    let failedCount = 0
    let realTaskId = null
    let failureText = '上传失败'
    let wasDedup = false  // 2026-09-02：服务端命中已有 task 时弹"已上传过"提示

    try {
      const options = { taskName }
      if (isWorkbook) {
        options.worksheetId = worksheetIdEffective
        options.taskType = 'workbook'
        options.subject = subjectEffective
      } else if (isExam) {
        options.resourceId = examResourceIdEffective
        options.taskType = 'exam'
        options.subject = subjectEffective
      }
      const result = await taskService.uploadFiles(studentId, files, options)
      const taskResult = (result.tasks || []).find(t => !t.error) || (result.tasks || [])[0]

      if (taskResult && !taskResult.error) {
        successCount = 1
        realTaskId = taskResult.id
        if (taskResult._dedup) wasDedup = true
        if (isWorkbook) { __pendingUploadStore.worksheetId = null; __pendingUploadStore.worksheetName = null }
        if (isExam) { __pendingUploadStore.examResourceId = null; __pendingUploadStore.examResourceName = null }
        // 2026-09-02：服务端命中同 hash 已有 task（_dedup=true）时，让 store 把 tempTask
        // 直接合并到旧 task，而不是当作新批改处理——避免重复触发 UI 动效和误以为再次批改。
        if (taskResult._dedup) {
          setTasks(prev => prev.map(t =>
            t.id === tempTask.id ? { ...taskResult, status: taskResult.status || 'done', pages: taskResult.images || tempTask.pages, is_temp: false, _reusedFromExisting: true } : t
          ))
        } else {
          updateTaskInStore(tempTask.id, 'processing', { progress: 0 })
          setTasks(prev => prev.map(t =>
            t.id === tempTask.id ? { ...taskResult, status: 'processing', pages: taskResult.images || tempTask.pages, is_temp: false } : t
          ))
        }
      } else {
        failedCount = 1
        const errorMsg = taskResult?.message || taskResult?.error || '上传失败'
        failureText = describeUploadFailure(errorMsg)
        upsertFailedTemp(tempTask, errorMsg)
      }
    } catch (error) {
      console.error('uploadViaBackend exception:', error)
      failedCount = 1
      // 2026-09-02：409 EXISTING_FAILED_TASK — 用户上传的试卷已有同 hash 的失败任务，
      // 直接弹"已上传过"提示，不要把它当通用网络错误处理。
      if (error.code === 'EXISTING_FAILED_TASK') {
        failureText = error.message || '这份试卷之前上传过但批改失败，请到任务列表重试上次任务'
      } else {
        failureText = describeUploadFailure(error)
      }
      upsertFailedTemp(tempTask, error)
    }

    if (successCount > 0) {
      invalidateCache('tasks', studentId)
      loadTasksRef.current().then(() => {
        if (realTaskId) {
          updateTaskInStore(realTaskId, 'processing', { progress: 0 })
        }
      })
    }

    if (failedCount > 0) {
      uploadToast.dismiss()
      Toast.show({ message: failureText, type: 'error', duration: 4000 })
    } else if (successCount > 0) {
      uploadToast.dismiss()
      // 2026-09-02：服务端命中已有 task（_dedup=true）时弹"已上传过"提示，
      // 避免用户以为又批了一次；非 dedup 走原来的"上传成功"提示。
      if (wasDedup) {
        Toast.show({ message: '已上传过相同的试卷，已复用上次批改结果', type: 'success', duration: 2500 })
      } else {
        Toast.show({ message: files.length > 1 ? `${files.length} 张图片已合并为一个任务` : '上传成功', type: 'success', duration: 2000 })
      }
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
          // 判题域硬规则：is_correct === null 是"AI 未判定"，不是错。
          // 原先用 q.is_correct 的真值性分桶，null 会被当成 wrong 送进错题本。
          status: q.is_correct === false ? 'wrong' : 'pending',
          image_url: q.image_url,
          ai_tags: q.ai_tags || [],
          tags_source: 'ai'
        }))

        await saveRecognitionResult(task.id, currentStudent.id, questions)
        updateTaskInStore(task.id, 'done', result)

        // 只有明确判错的题进错题本；判不出来的题等老师复核，不能自动入册
        const wrongQuestions = questions.filter(q => q.is_correct === false)
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
    retryTempUpload,
    uploading, uploadingTasks,
    uploadQueue, isUploading,

    // 暂存区
    showStaging, stagingFiles, stagingType, stagingUploading,
    cameraInputRef, albumInputRef,
    openStaging, openStagingForRetry, clearStaging,
    handleStagingSelectFiles, removeStagingFile,
    onStagingCamera, onStagingAlbum, cameraBusy,
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
