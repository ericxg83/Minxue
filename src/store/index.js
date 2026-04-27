import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 学生状态管理
export const useStudentStore = create(
  persist(
    (set, get) => ({
      // 当前选中的学生
      currentStudent: null,
      // 学生列表
      students: [],
      
      // 设置当前学生
      setCurrentStudent: (student) => set({ currentStudent: student }),
      
      // 设置学生列表
      setStudents: (students) => set({ students }),
      
      // 添加学生
      addStudent: (student) => set((state) => ({
        students: [...state.students, student]
      })),
      
      // 更新学生
      updateStudent: (id, updates) => set((state) => ({
        students: state.students.map(s => 
          s.id === id ? { ...s, ...updates } : s
        )
      })),
      
      // 删除学生
      removeStudent: (id) => set((state) => ({
        students: state.students.filter(s => s.id !== id),
        currentStudent: state.currentStudent?.id === id ? null : state.currentStudent
      }))
    }),
    {
      name: 'student-storage',
      // 自定义存储逻辑，过滤掉无效的 mock 数据
      partialize: (state) => ({
        currentStudent: state.currentStudent,
        students: state.students
      }),
      // 加载时过滤掉无效的 mock 数据（ID 不是 UUID 格式的）
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 过滤掉 ID 不是 UUID 格式的学生（mock 数据）
          const validStudents = state.students.filter(s => {
            const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id)
            return isValidUUID
          })
          
          // 如果当前选中的学生也是无效的，重置为 null
          const isCurrentValid = state.currentStudent && 
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.currentStudent.id)
          
          state.students = validStudents
          if (!isCurrentValid) {
            state.currentStudent = null
          }
          
          console.log('Store 重新加载，过滤后的学生数量:', validStudents.length)
        }
      }
    }
  )
)

// 任务状态管理
export const useTaskStore = create(
  persist(
    (set, get) => ({
      // 当前任务
      currentTask: null,
      // 任务列表
      tasks: [],
      // 处理中的任务
      processingTasks: [],
      
      // 设置当前任务
      setCurrentTask: (task) => set({ currentTask: task }),
      
      // 设置任务列表
      setTasks: (tasks) => set({ tasks }),
      
      // 添加任务
      addTask: (task) => set((state) => ({
        tasks: [task, ...state.tasks]
      })),
      
      // 更新任务状态
      updateTaskStatus: (taskId, status, result = null) => set((state) => ({
        tasks: state.tasks.map(t => 
          t.id === taskId ? { ...t, status, result, updated_at: new Date().toISOString() } : t
        )
      })),
      
      // 添加到处理队列
      addToProcessing: (task) => set((state) => ({
        processingTasks: [...state.processingTasks, task]
      })),
      
      // 从处理队列移除
      removeFromProcessing: (taskId) => set((state) => ({
        processingTasks: state.processingTasks.filter(t => t.id !== taskId)
      }))
    }),
    {
      name: 'task-storage'
    }
  )
)

// 错题本状态管理
export const useWrongQuestionStore = create((set, get) => ({
  // 错题列表
  wrongQuestions: [],
  // 选中的错题（用于打印）
  selectedQuestions: [],
  
  // 设置错题列表
  setWrongQuestions: (questions) => set({ wrongQuestions: questions }),
  
  // 添加错题
  addWrongQuestion: (question) => set((state) => ({
    wrongQuestions: [question, ...state.wrongQuestions]
  })),
  
  // 批量添加错题
  addWrongQuestions: (questions) => set((state) => ({
    wrongQuestions: [...questions, ...state.wrongQuestions]
  })),
  
  // 更新错题状态
  updateWrongQuestion: (id, updates) => set((state) => ({
    wrongQuestions: state.wrongQuestions.map(q => 
      q.id === id ? { ...q, ...updates } : q
    )
  })),
  
  // 更新错题掌握状态（批改用）
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
  
  // 删除错题
  removeWrongQuestion: (id) => set((state) => ({
    wrongQuestions: state.wrongQuestions.filter(q => q.id !== id),
    selectedQuestions: state.selectedQuestions.filter(q => q.id !== id)
  })),
  
  // 设置选中的错题
  setSelectedQuestions: (questions) => set({ selectedQuestions: questions }),
  
  // 切换选中状态
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
  
  // 清空选中
  clearSelection: () => set({ selectedQuestions: [] })
}))

// 待确认题目状态管理
export const usePendingQuestionStore = create(
  persist(
    (set, get) => ({
      // 待确认题目列表
      pendingQuestions: [],
      
      // 设置待确认题目列表
      setPendingQuestions: (questions) => set({ pendingQuestions: questions }),
      
      // 添加待确认题目
      addPendingQuestion: (question) => set((state) => ({
        pendingQuestions: [question, ...state.pendingQuestions]
      })),
      
      // 批量添加待确认题目
      addPendingQuestions: (questions) => set((state) => ({
        pendingQuestions: [...questions, ...state.pendingQuestions]
      })),
      
      // 更新待确认题目状态
      updatePendingQuestion: (id, updates) => set((state) => ({
        pendingQuestions: state.pendingQuestions.map(q => 
          q.id === id ? { ...q, ...updates } : q
        )
      })),
      
      // 删除待确认题目
      removePendingQuestion: (id) => set((state) => ({
        pendingQuestions: state.pendingQuestions.filter(q => q.id !== id)
      })),
      
      // 清空待确认题目
      clearPendingQuestions: () => set({ pendingQuestions: [] })
    }),
    {
      name: 'pending-question-storage'
    }
  )
)

// 试卷状态管理
export const useExamStore = create(
  persist(
    (set, get) => ({
      // 试卷列表
      exams: [],
      
      // 已初始化的学生ID集合
      initializedStudents: new Set(),
      
      // 设置试卷列表
      setExams: (exams) => set({ exams }),
      
      // 添加试卷
      addExam: (exam) => set((state) => ({
        exams: [exam, ...state.exams]
      })),
      
      // 更新试卷状态
      updateExamStatus: (examId, status, gradedAt = null) => set((state) => ({
        exams: state.exams.map(e => 
          e.id === examId ? { ...e, status, graded_at: gradedAt || new Date().toISOString() } : e
        )
      })),
      
      // 删除试卷
      removeExam: (examId) => set((state) => ({
        exams: state.exams.filter(e => e.id !== examId)
      })),
      
      // 标记学生已初始化
      markStudentInitialized: (studentId) => set((state) => ({
        initializedStudents: new Set([...state.initializedStudents, studentId])
      })),
      
      // 检查学生是否已初始化
      isStudentInitialized: (studentId) => {
        return get().initializedStudents.has(studentId)
      }
    }),
    {
      name: 'exam-storage',
      partialize: (state) => ({ exams: state.exams })
    }
  )
)

// 全局 UI 状态管理
export const useUIStore = create((set) => ({
  // 当前页面 - 默认进入处理页面
  currentPage: 'processing',
  // 加载状态
  loading: false,
  // 全局提示
  toast: null,

  // 设置当前页面
  setCurrentPage: (page) => set({ currentPage: page }),

  // 设置加载状态
  setLoading: (loading) => set({ loading }),

  // 显示提示
  showToast: (message, type = 'info') => set({ toast: { message, type } }),

  // 隐藏提示
  hideToast: () => set({ toast: null })
}))
