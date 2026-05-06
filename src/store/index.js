import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStudentStore = create(
  persist(
    (set, get) => ({
      currentStudent: null,
      students: [],
      
      setCurrentStudent: (student) => set({ currentStudent: student }),
      
      setStudents: (students) => set({ students }),
      
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
    }),
    {
      name: 'minxue-student-store',
      partialize: (state) => ({
        currentStudent: state.currentStudent,
        students: state.students
      })
    }
  )
)

export const useTaskStore = create(
  persist(
    (set, get) => ({
      currentTask: null,
      tasks: [],
      processingTasks: [],
      
      setCurrentTask: (task) => set({ currentTask: task }),
      
      setTasks: (tasks) => set({ tasks }),
      
      addTask: (task) => set((state) => ({
        tasks: [task, ...state.tasks]
      })),
      
      updateTaskStatus: (taskId, status, result = null) => set((state) => ({
        tasks: state.tasks.map(t => 
          t.id === taskId ? { ...t, status, result, updated_at: new Date().toISOString() } : t
        )
      })),
      
      addToProcessing: (task) => set((state) => ({
        processingTasks: [...state.processingTasks, task]
      })),
      
      removeFromProcessing: (taskId) => set((state) => ({
        processingTasks: state.processingTasks.filter(t => t.id !== taskId)
      }))
    }),
    {
      name: 'minxue-task-store',
      partialize: (state) => ({
        tasks: state.tasks
      })
    }
  )
)

export const useWrongQuestionStore = create((set, get) => ({
  wrongQuestions: [],
  selectedQuestions: [],
  
  setWrongQuestions: (questions) => set((state) => ({ 
    wrongQuestions: typeof questions === 'function' ? questions(state.wrongQuestions) : questions 
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

export const usePendingQuestionStore = create((set, get) => ({
  pendingQuestions: [],
  
  setPendingQuestions: (questions) => set({ pendingQuestions: questions }),
  
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
  
  clearPendingQuestions: () => set({ pendingQuestions: [] })
}))

export const useExamStore = create((set, get) => ({
  exams: [],
  generatedExams: [],
  initializedStudents: new Set(),
  
  setExams: (exams) => set({ exams }),
  
  setGeneratedExams: (generatedExams) => set({ generatedExams }),
  
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
      name: 'minxue-ui-store',
      partialize: (state) => ({
        currentPage: state.currentPage
      })
    }
  )
)
