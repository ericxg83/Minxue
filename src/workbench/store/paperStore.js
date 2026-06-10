import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

export const usePaperStore = defineStore('paper', () => {
  const paperInfo = ref({
    name: '',
    subject: '',
    grade: '',
    examType: ''
  })

  const pages = ref([])
  const currentPageIndex = ref(0)
  const recognitionStatus = ref('idle') // idle, processing, done, error
  const recognitionProgress = ref(0)

  const setPaperInfo = (info) => {
    paperInfo.value = info
  }

  const setPages = (pageList) => {
    pages.value = pageList
  }

  const setCurrentPage = (index) => {
    if (index >= 0 && index < pages.value.length) {
      currentPageIndex.value = index
    }
  }

  const updateBlock = (pageIndex, blockIndex, data) => {
    if (pages.value[pageIndex] && pages.value[pageIndex].layoutBlocks) {
      pages.value[pageIndex].layoutBlocks[blockIndex] = {
        ...pages.value[pageIndex].layoutBlocks[blockIndex],
        ...data
      }
    }
  }

  const getQuestionCount = () => {
    let count = 0
    pages.value.forEach(page => {
      if (page.layoutBlocks) {
        count += page.layoutBlocks.filter(b => b.type === 'question').length
      }
    })
    return count
  }

  const getLowConfCount = () => {
    let count = 0
    pages.value.forEach(page => {
      if (page.layoutBlocks) {
        count += page.layoutBlocks.filter(b => b.confidence !== undefined && b.confidence < 0.7).length
      }
    })
    return count
  }

  const getImageBlocks = (pageIndex) => {
    const page = pages.value[pageIndex]
    if (!page || !page.layoutBlocks) return []
    return page.layoutBlocks.filter(b => b.type === 'image')
  }

  return {
    paperInfo,
    pages,
    currentPageIndex,
    recognitionStatus,
    recognitionProgress,
    setPaperInfo,
    setPages,
    setCurrentPage,
    updateBlock,
    getQuestionCount,
    getLowConfCount,
    getImageBlocks
  }
})
