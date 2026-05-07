import { create } from 'zustand'
import { subscribeToTaskUpdates, startTaskPolling } from '../services/taskService'
import cacheManager from '../utils/cacheManager'

export const useStudentStore = create((set, get) => ({
  currentStudent: null,
  students: [],
  loading: false,
  initialized: false,

  setCurrentStudent: (student) => {
    cacheManager.session.set('current_student_id', student?.id)
    set({ currentStudent: student })
  },

  setStudents: (students) => set({ students, initialized: true, loading: false }),

  addStudent: (student) => set((state) => ({
    students: [...state.students, student]
  })),

  updateStudent: (id, updates) => set((state) => ({
    students: state.students.map(s =>
      s.id === id ? { ...s, ...updates } : s
    )
  })),

  removeStudent: (id) => set((state) => ({
    students: state.students.filter(s => s.id !== id),
    currentStudent: state.currentStudent?.id === id ? null : state.currentStudent
  })),

  setLoading: (loading) => set({ loading })
}))

export const useTaskStore = create((set, get) => ({
  currentTask: null,
  tasks: [],
  processingTasks: [],
  loading: false,
  initialized: false,
  _unsubRealtime: null,
  _unsubPolling: null,

  setCurrentTask: (task) => set({ currentTask: task }),

  setTasks: (tasks) => set({ tasks, initialized: true, loading: false }),

  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks]
  })),

  addTasks: (newTasks) => set((state) => ({
    tasks: [...newTasks, ...state.tasks]
  })),

  updateTaskStatus: (taskId, status, result = null) => set((state) => ({
    tasks: state.tasks.map(t =>
      t.id === taskId ? { ...t, status, result: result || t.result, updated_at: new Date().toISOString() } : t
    )
  })),

  updateTaskFromServer: (serverTask) => set((state) => {
    const existing = state.tasks.find(t => t.id === serverTask.id)
    if (existing) {
      return {
        tasks: state.tasks.map(t =>
          t.id === serverTask.id ? { ...t, ...serverTask } : t
        )
      }
    }
    return {
      tasks: [serverTask, ...state.tasks]
    }
  }),

  syncTasksFromServer: (serverTasks) => set((state) => {
    const taskMap = new Map()
    for (const st of serverTasks) {
      taskMap.set(st.id, { ...st })
    }
    for (const t of state.tasks) {
      if (!taskMap.has(t.id)) {
        taskMap.set(t.id, t)
      }
    }
    return { tasks: Array.from(taskMap.values()) }
  }),

  addToProcessing: (task) => set((state) => ({
    processingTasks: [...state.processingTasks, task]
  })),

  removeFromProcessing: (taskId) => set((state) => ({
    processingTasks: state.processingTasks.filter(t => t.id !== taskId)
  })),

  setLoading: (loading) => set({ loading }),

  startRealtimeSync: () => {
    const state = get()
    if (state._unsubRealtime) return

    const unsub = subscribeToTaskUpdates((updatedTask) => {
      get().updateTaskFromServer(updatedTask)
    })

    set({ _unsubRealtime: unsub })
  },

  stopRealtimeSync: () => {
    const state = get()
    if (state._unsubRealtime) {
      state._unsubRealtime()
      set({ _unsubRealtime: null })
    }
  },

  startPolling: (studentId, intervalMs = 8000) => {
    const state = get()
    if (state._unsubPolling) return

    const unsub = startTaskPolling(studentId, (serverTasks) => {
      get().syncTasksFromServer(serverTasks)
    }, intervalMs)

    set({ _unsubPolling: unsub })
  },

  stopPolling: () => {
    const state = get()
    if (state._unsubPolling) {
      state._unsubPolling()
      set({ _unsubPolling: null })
    }
  },

  cleanup: () => {
    const state = get()
    if (state._unsubRealtime) state._unsubRealtime()
    if (state._unsubPolling) state._unsubPolling()
    set({ _unsubRealtime: null, _unsubPolling: null })
  }
}))

export const useWrongQuestionStore = create((set, get) => ({
  wrongQuestions: [],
  selectedQuestions: [],
  loading: false,
  initialized: false,

  setWrongQuestions: (questions) => set((state) => ({
    wrongQuestions: typeof questions === 'function' ? questions(state.wrongQuestions) : questions,
    initialized: true,
    loading: false
  })),

  addWrongQuestion: (question) => set((state) => ({
    wrongQuestions: [question, ...state.wrongQuestions]
  })),

  addWrongQuestions: (questions) => set((state) => ({
    wrongQuestions: [...questions, ...state.wrongQuestions]
  })),

  updateWrongQuestion: (id, updates) => set((state) => ({
    wrongQuestions: state.wrongQuestions.map(q =>
      q.id === id ? { ...q, ...updates } : q
    )
  })),

  updateWrongQuestionStatus: (id, status) => set((state) => ({
    wrongQuestions: state.wrongQuestions.map(q =>
      q.id === id ? {
        ...q,
        status,
        last_graded_at: new Date().toISOString(),
        grade_count: (q.grade_count || 0) + 1
      } : q
    )
  })),

  removeWrongQuestion: (id) => set((state) => ({
    wrongQuestions: state.wrongQuestions.filter(q => q.id !== id),
    selectedQuestions: state.selectedQuestions.filter(q => q.id !== id)
  })),

  setSelectedQuestions: (questions) => set({ selectedQuestions: questions }),

  toggleSelection: (question) => set((state) => {
    const exists = state.selectedQuestions.find(q => q.id === question.id)
    if (exists) {
      return {
        selectedQuestions: state.selectedQuestions.filter(q => q.id !== question.id)
      }
    }
    return {
      selectedQuestions: [...state.selectedQuestions, question]
    }
  }),

  clearSelection: () => set({ selectedQuestions: [] }),

  setLoading: (loading) => set({ loading })
}))

export const usePendingQuestionStore = create((set, get) => ({
  pendingQuestions: [],
  loading: false,
  initialized: false,

  setPendingQuestions: (questions) => set({
    pendingQuestions: questions,
    initialized: true,
    loading: false
  }),

  addPendingQuestion: (question) => set((state) => ({
    pendingQuestions: [question, ...state.pendingQuestions]
  })),

  addPendingQuestions: (questions) => set((state) => ({
    pendingQuestions: [...questions, ...state.pendingQuestions]
  })),

  updatePendingQuestion: (id, updates) => set((state) => ({
    pendingQuestions: state.pendingQuestions.map(q =>
      q.id === id ? { ...q, ...updates } : q
    )
  })),

  removePendingQuestion: (id) => set((state) => ({
    pendingQuestions: state.pendingQuestions.filter(q => q.id !== id)
  })),

  clearPendingQuestions: () => set({ pendingQuestions: [] }),

  setLoading: (loading) => set({ loading })
}))

export const useExamStore = create((set, get) => ({
  exams: [],
  generatedExams: [],
  loading: false,
  initialized: false,
  initializedStudents: new Set(),

  setExams: (exams) => set({ exams }),

  setGeneratedExams: (generatedExams) => set({
    generatedExams,
    initialized: true,
    loading: false
  }),

  addExam: (exam) => set((state) => ({
    exams: [exam, ...state.exams]
  })),

  addGeneratedExam: (exam) => set((state) => ({
    generatedExams: [exam, ...state.generatedExams]
  })),

  updateExamStatus: (examId, status, gradedAt = null) => set((state) => ({
    exams: state.exams.map(e =>
      e.id === examId ? { ...e, status, graded_at: gradedAt || new Date().toISOString() } : e
    )
  })),

  removeExam: (examId) => set((state) => ({
    exams: state.exams.filter(e => e.id !== examId)
  })),

  setLoading: (loading) => set({ loading }),

  markStudentInitialized: (studentId) => set((state) => ({
    initializedStudents: new Set([...state.initializedStudents, studentId])
  })),

  isStudentInitialized: (studentId) => {
    return get().initializedStudents.has(studentId)
  }
}))

export const useUIStore = create((set) => ({
  currentPage: 'processing',
  loading: false,
  toast: null,
  pageLoading: {
    processing: false,
    pending: false,
    wrongbook: false,
    exam: false
  },

  setCurrentPage: (page) => set({ currentPage: page }),

  setLoading: (loading) => set({ loading }),

  setPageLoading: (page, loading) => set((state) => ({
    pageLoading: { ...state.pageLoading, [page]: loading }
  })),

  showToast: (message, type = 'info') => set({ toast: { message, type } }),

  hideToast: () => set({ toast: null })
}))
