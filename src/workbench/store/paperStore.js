import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

export const usePaperStore = defineStore('paper', () => {
  // 试卷信息
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
  
  // 新增：选中的题目（用于批量操作）
  const selectedBlocks = ref([])
  
  // 新增：搜索关键词
  const searchQuery = ref('')
  
  // 新增：高亮关键词
  const highlightKeyword = ref('')

  // 获取所有题目块
  const allQuestionBlocks = computed(() => {
    const blocks = []
    pages.value.forEach((page, pageIndex) => {
      if (page.layoutBlocks) {
        page.layoutBlocks.forEach((block, blockIndex) => {
          if (block.type === 'question') {
            blocks.push({
              ...block,
              pageIndex,
              blockIndex
            })
          }
        })
      }
    })
    return blocks
  })

  // 搜索过滤后的题目
  const filteredQuestionBlocks = computed(() => {
    if (!searchQuery.value) return allQuestionBlocks.value
    
    const query = searchQuery.value.toLowerCase()
    return allQuestionBlocks.value.filter(block => {
      const content = block.content || ''
      const options = (block.options || []).join(' ')
      return content.toLowerCase().includes(query) || 
             options.toLowerCase().includes(query)
    })
  })

  const setPaperInfo = (info) => {
    paperInfo.value = info
  }

  const setPages = (pageList) => {
    pages.value = pageList
    currentPageIndex.value = 0
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

  // 新增：选择题目块
  const selectBlock = (block) => {
    if (!selectedBlocks.value.find(b => 
      b.pageIndex === block.pageIndex && b.blockIndex === block.blockIndex
    )) {
      selectedBlocks.value = [...selectedBlocks.value, block]
    }
  }

  // 新增：取消选择题目块
  const deselectBlock = (block) => {
    selectedBlocks.value = selectedBlocks.value.filter(b => 
      !(b.pageIndex === block.pageIndex && b.blockIndex === block.blockIndex)
    )
  }

  // 新增：切换选择状态
  const toggleBlockSelection = (block) => {
    const exists = selectedBlocks.value.find(b => 
      b.pageIndex === block.pageIndex && b.blockIndex === block.blockIndex
    )
    if (exists) {
      deselectBlock(block)
    } else {
      selectBlock(block)
    }
  }

  // 新增：全选当前页题目
  const selectAllOnCurrentPage = () => {
    const currentPage = pages.value[currentPageIndex.value]
    if (!currentPage || !currentPage.layoutBlocks) return
    
    currentPage.layoutBlocks.forEach((block, blockIndex) => {
      if (block.type === 'question') {
        selectBlock({ ...block, pageIndex: currentPageIndex.value, blockIndex })
      }
    })
  }

  // 新增：清空选择
  const clearBlockSelection = () => {
    selectedBlocks.value = []
  }

  // 新增：设置搜索关键词
  const setSearchQuery = (query) => {
    searchQuery.value = query
    highlightKeyword.value = query
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
    selectedBlocks,
    searchQuery,
    highlightKeyword,
    allQuestionBlocks,
    filteredQuestionBlocks,
    setPaperInfo,
    setPages,
    setCurrentPage,
    updateBlock,
    selectBlock,
    deselectBlock,
    toggleBlockSelection,
    selectAllOnCurrentPage,
    clearBlockSelection,
    setSearchQuery,
    getQuestionCount,
    getLowConfCount,
    getImageBlocks
  }
})
