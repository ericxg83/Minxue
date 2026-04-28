import { create } from 'zustand/vanilla'
import { persist } from 'zustand/middleware'

const store = create(
  persist(
    (set) => ({
      students: [{ id: '1' }, { id: 'invalid' }],
    }),
    {
      name: 'test-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.students = state.students.filter(s => s.id === '1')
          console.log('in onRehydrateStorage:', state.students)
        }
      }
    }
  )
)

console.log('after init:', store.getState().students)
