import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useWorkbenchStore = defineStore('workbench', () => {
  const currentMode = ref('paper')  // 'paper' | 'wrongbook'

  function setMode(mode) {
    currentMode.value = mode
  }

  return {
    currentMode,
    setMode
  }
})