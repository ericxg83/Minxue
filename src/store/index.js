import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { startTaskPolling } from '../services/taskService'

export const useStudentStore = create((set, get) => ({
  currentStudent: null,
  students: [],
  
  setCurrentStudent: (student) => set({ currentStudent: student }),
  
  setStudents: (students) => set({ students: Array.isArray(students) ? students : [] }),
  
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
  }))
}))

export const useTaskStore = create((set, get) => ({
  currentTask: null,
  tasks: [],
  processingTasks: [],
  _unsubPolling: null,
  
  setCurrentTask: (task) => set({ currentTask: task }),
  
  setTasks: (tasks) => set({ tasks: Array.isArray(tasks) ? tasks : [] }),
  
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
    // 浅比较：如果服务器数据和当前数据一致，不触发重渲染
    if (state.tasks.length === serverTasks.length) {
      let unchanged = true
      for (let i = 0; i < state.tasks.length; i++) {
        if (state.tasks[i].id !== serverTasks[i]?.id ||
            state.tasks[i].status !== serverTasks[i]?.status ||
            state.tasks[i].updated_at !== serverTasks[i]?.updated_at) {
          unchanged = false
          break
        }
      }
      if (unchanged) return state // 无变化，跳过 set
    }

    const taskMap = new Map()
    for (const st of serverTasks) {
      taskMap.set(st.id, st) // ⚡ 不再解构创建新对象，保留引用
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
    if (state._unsubPolling) state._unsubPolling()
    set({ _unsubPolling: null })
  }
}))

// 错题本状态管理 - 纯内存，无本地存储
export const useWrongQuestionStore = create((set, get) => ({
  wrongQuestions: [],
  selectedQuestions: [],
  
  setWrongQuestions: (questions) => set((state) => ({ 
    wrongQuestions: typeof questions === 'function' ? questions(state.wrongQuestions) : (Array.isArray(questions) ? questions : [])
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
  
  clearSelection: () => set({ selectedQuestions: [] })
}))

// 试卷状态管理 - 纯内存，无本地存储
export const useExamStore = create((set, get) => ({
  exams: [],
  generatedExams: [],
  initializedStudents: new Set(),
  
  setExams: (exams) => set({ exams }),
  
  setGeneratedExams: (generatedExams) => set({ generatedExams: Array.isArray(generatedExams) ? generatedExams : [] }),
  
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
  
  markStudentInitialized: (studentId) => set((state) => ({
    initializedStudents: new Set([...state.initializedStudents, studentId])
  })),
  
  isStudentInitialized: (studentId) => {
    return get().initializedStudents.has(studentId)
  }
}))

// 全局 UI 状态管理
// currentPage 持久化到 sessionStorage：刷新后停留在当前底部 tab（首页/错题本/组卷历史），
// 关闭标签页后清空、下次进入回到默认首页。loading/toast 为瞬态，不持久化。
export const useUIStore = create(
  persist(
    (set) => ({
      currentPage: 'processing',
      loading: false,
      toast: null,

      setCurrentPage: (page) => set({ currentPage: page }),

      setLoading: (loading) => set({ loading }),

      showToast: (message, type = 'info') => set({ toast: { message, type } }),

      hideToast: () => set({ toast: null })
    }),
    {
      name: 'minxue-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ currentPage: state.currentPage })
    }
  )
)
