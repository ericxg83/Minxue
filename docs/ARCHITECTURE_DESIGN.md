# PC工作台优化架构设计文档

## 一、项目背景与目标

### 现状分析
- **PC工作台** (`src/workbench/`): 已有试卷入库基础功能，包含：
  - 双栏对比布局（左侧原始图片，右侧识别结果）
  - 题目编辑、置信度提示、分页导航
  - 基于 Vue3 + Pinia 的状态管理 (`paperStore.js`)
  - 导出Word、完成校对等功能（部分待实现）

- **移动端错题本** (`src/pages/WrongBook/index.jsx`): 完善的错题管理功能，包含：
  - 多学生切换支持
  - 掌握状态管理（未掌握/有点掌握/完全掌握）
  - 多维度筛选（科目/时间/错次/标签/分类）
  - 批量选择、组卷、打印
  - 基于 React 的组件实现（需迁移到 Vue3）

### 优化目标
1. **试卷入库功能**（以卷为单位）：将纸质试卷数字化，支持题目提取和打印预览，不涉及学生作答和错题逻辑
2. **错题编辑功能**（以题为单位）：沿用移动端现有逻辑，在PC端直观地浏览和修改错题
3. **逻辑独立**：两个功能数据模型和业务流程完全独立，UI可切换或并列显示
4. **PC端增强**：支持分页、筛选、搜索、题目高亮、键盘快捷键等编辑便利功能

---

## 二、技术架构设计

### 2.1 整体架构

```
src/workbench/
├── main.js                           # PC工作台入口
├── App.vue                           # 主应用组件
├── router/                           # 路由配置
│   └── index.js                      # 定义试卷入库和错题本路由
├── views/
│   ├── ExamWorkbench.vue             # 试卷入库工作台（现有优化）
│   ├── WrongBookWorkbench.vue        # 错题本工作台（新建）
│   └── WorkbenchLayout.vue           # 共享工作台布局
├── components/
│   ├── paper/                        # 试卷入库相关组件
│   │   ├── QuestionBlock.vue         # 题目块组件
│   │   ├── TextBlock.vue             # 文本块组件
│   │   ├── SectionBlock.vue          # 章节块组件
│   │   ├── ImageBlock.vue            # 图片块组件
│   │   ├── TableBlock.vue            # 表格块组件
│   │   └── PrintPreview.vue          # 打印预览组件
│   ├── wrongbook/                    # 错题本相关组件
│   │   ├── WrongQuestionCard.vue     # 错题卡片组件
│   │   ├── StudentSwitcher.vue       # 学生切换器
│   │   ├── StatusTabs.vue            # 掌握状态标签
│   │   ├── FilterPanel.vue           # 筛选面板
│   │   └── QuestionEditDialog.vue    # 题目编辑对话框
│   └── shared/                       # 共享组件
│       ├── SearchBar.vue             # 搜索栏
│       ├── PaginationBar.vue         # 分页栏
│       └── ModeSwitcher.vue          # 模式切换器（试卷入库/错题本）
├── stores/
│   ├── paperStore.js                 # 试卷入库状态管理（优化现有）
│   ├── wrongBookStore.js             # 错题本状态管理（新建，沿用移动端逻辑）
│   └── workbenchStore.js             # 工作台共享状态（新建）
├── api/
│   ├── paperApi.js                   # 试卷入库API（优化现有）
│   └── wrongBookApi.js               # 错题本API（新建，复用移动端API）
└── utils/
    ├── searchHelper.js               # 搜索工具函数
    ├── highlightHelper.js            # 高亮工具函数
    └── exportHelper.js               # 导出工具函数
```

### 2.2 数据模型设计

#### 试卷入库数据模型 (Paper)
```javascript
{
  id: string,                    // 试卷ID
  name: string,                  // 试卷名称
  subject: string,               // 科目
  grade: string,                 // 年级
  examType: string,              // 考试类型
  status: 'draft' | 'reviewing' | 'completed',  // 状态
  pages: [{
    pageNo: number,              // 页码
    originalImage: string,       // 原始图片URL
    layoutBlocks: [{             // 布局块
      type: 'title' | 'subtitle' | 'question' | 'text' | 'section' | 'image' | 'table' | 'footer',
      content: string,
      confidence: number,        // 识别置信度
      options?: string[],        // 选择题选项
      caption?: string,          // 图片说明
      src?: string,              // 图片URL
      // ... 其他字段
    }]
  }],
  createdAt: string,
  updatedAt: string
}
```

#### 错题本数据模型 (WrongQuestion) - 沿用移动端
```javascript
{
  id: string,                    // 错题记录ID
  student_id: string,            // 学生ID
  question_id: string,           // 题目ID
  question: {                    // 题目详情
    id: string,
    content: string,
    subject: string,
    category: string,
    answer_source: 'recognized' | 'blank',
    is_correct: boolean | null,
    wrong_count: number,
    ai_tags: string[],
    manual_tags: string[],
    // ... 移动端已有字段
  },
  status: 'pending' | 'partial' | 'mastered',  // 掌握状态
  added_at: string,
  created_at: string,
  task_id: string,               // 来源任务ID
  task_deleted: boolean          // 原试卷是否已删除
}
```

### 2.3 状态管理设计

#### paperStore.js (优化现有)
```javascript
export const usePaperStore = defineStore('paper', () => {
  // 状态
  const paperInfo = ref({...})
  const pages = ref([])
  const currentPageIndex = ref(0)
  const recognitionStatus = ref('idle')
  const recognitionProgress = ref(0)
  const selectedQuestions = ref([])  // 新增：选中的题目
  
  // 操作
  function setPaperInfo(info) {...}
  function setPages(pageList) {...}
  function setCurrentPage(index) {...}
  function updateBlock(pageIndex, blockIndex, data) {...}
  function selectQuestion(question) {...}  // 新增
  function toggleQuestionSelection(question) {...}  // 新增
  function clearQuestionSelection() {...}  // 新增
  function getQuestionCount() {...}
  function getLowConfCount() {...}
  function getImageBlocks(pageIndex) {...}
  
  return {...}
})
```

#### wrongBookStore.js (新建)
```javascript
export const useWrongBookStore = defineStore('wrongBook', () => {
  // 状态 - 完全沿用移动端逻辑
  const wrongQuestions = ref([])
  const selectedQuestions = ref([])
  const currentStudent = ref(null)
  const filters = ref({
    status: 'all',           // pending | partial | mastered | all
    questionType: 'all',     // wrong | unanswered | all
    subject: 'all',
    time: 'all',
    errorCount: 'all',
    tag: 'all',
    category: 'all'
  })
  const sortBy = ref('time_desc')
  const searchQuery = ref('')
  const currentPage = ref(1)
  const pageSize = ref(20)
  
  // 计算属性
  const filteredQuestions = computed(() => {
    // 沿用移动端筛选逻辑
    return wrongQuestions.value
      .filter(wq => wq.student_id === currentStudent.value?.id)
      .filter(wq => {
        // 状态筛选
        if (filters.value.status !== 'all' && wq.status !== filters.value.status) return false
        // 科目筛选
        if (filters.value.subject !== 'all' && wq.subject !== filters.value.subject) return false
        // 时间筛选
        if (filters.value.time !== 'all') {
          if (!isWithinTimeRange(wq.added_at || wq.created_at, filters.value.time)) return false
        }
        // 错次筛选
        if (filters.value.errorCount !== 'all') {
          if (!matchErrorCount(wq.error_count || 1, filters.value.errorCount)) return false
        }
        // 标签筛选
        if (filters.value.tag !== 'all') {
          const question = wq.question || wq
          const tags = question.tags_source === 'manual'
            ? (question.manual_tags || [])
            : (question.ai_tags || [])
          if (!tags.includes(filters.value.tag)) return false
        }
        // 搜索筛选
        if (searchQuery.value) {
          const q = wq.question || wq
          const content = q.content || ''
          if (!content.toLowerCase().includes(searchQuery.value.toLowerCase())) return false
        }
        return true
      })
      .sort((a, b) => {
        // 沿用移动端排序逻辑
        switch (sortBy.value) {
          case 'time_desc': return new Date(b.added_at || b.created_at) - new Date(a.added_at || a.created_at)
          case 'time_asc': return new Date(a.added_at || a.created_at) - new Date(b.added_at || b.created_at)
          case 'error_desc': return (b.error_count || 1) - (a.error_count || 1)
          case 'error_asc': return (a.error_count || 1) - (b.error_count || 1)
          case 'subject': return (a.subject || '').localeCompare(b.subject || '', 'zh')
          default: return 0
        }
      })
  })
  
  const paginatedQuestions = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    return filteredQuestions.value.slice(start, start + pageSize.value)
  })
  
  const totalPages = computed(() => Math.ceil(filteredQuestions.value.length / pageSize.value))
  
  // 操作 - 沿用移动端API
  async function loadWrongQuestions(studentId) {...}
  function toggleSelection(wq) {...}
  function clearSelection() {...}
  function selectAll() {...}
  async function updateStatus(wqId, status) {...}
  async function deleteQuestion(wqId) {...}
  function setFilter(key, value) {...}
  function resetFilters() {...}
  function setSearchQuery(query) {...}
  function setCurrentPage(page) {...}
  function setPageSize(size) {...}
  
  return {...}
})
```

#### workbenchStore.js (新建)
```javascript
export const useWorkbenchStore = defineStore('workbench', () => {
  const currentMode = ref('paper')  // 'paper' | 'wrongbook' | 'split'
  const isSplitMode = ref(false)
  
  function setMode(mode) {
    currentMode.value = mode
  }
  
  function toggleSplitMode() {
    isSplitMode.value = !isSplitMode.value
  }
  
  return {
    currentMode,
    isSplitMode,
    setMode,
    toggleSplitMode
  }
})
```

---

## 三、UI/UX 设计

### 3.1 布局设计

#### 整体布局
```
┌─────────────────────────────────────────────────────────┐
│ 顶部工具栏：模式切换器 | 搜索 | 用户信息                  │
├────────────────────┬────────────────────────────────────┤
│ 左侧面板           │ 右侧编辑/预览区域                   │
│                   │                                    │
│ • 试卷入库模式:    │ • 双栏对比（原图 vs 识别结果）      │
│   - 试卷列表       │ • 题目编辑对话框                    │
│   - 题目导航       │ • 打印预览                          │
│                   │                                    │
│ • 错题本模式:      │ • 错题本模式:                       │
│   - 学生切换器     │ • 错题详情编辑                      │
│   - 状态统计卡片   │ • 掌握状态更新                      │
│   - 筛选面板       │ • 批量操作工具栏                    │
│   - 错题列表       │                                    │
│   - 分页控件       │                                    │
├────────────────────┴────────────────────────────────────┤
│ 底部状态栏：操作提示 | 快捷键帮助                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 模式切换器 (ModeSwitcher)
- **试卷入库** 模式：专注于试卷数字化和题目提取
- **错题本** 模式：专注于错题浏览、编辑和状态管理
- **分屏** 模式（可选）：左右同时显示两个功能

### 3.3 快捷键支持
| 快捷键 | 试卷入库模式 | 错题本模式 |
|--------|-------------|-----------|
| Ctrl+F | 搜索题目内容 | 搜索错题内容 |
| Ctrl+S | 保存当前编辑 | 保存错题修改 |
| Ctrl+P | 打印预览 | 打印选中错题 |
| ←/→ | 上一页/下一页 | 上一页/下一页 |
| Ctrl+A | 全选当前页题目 | 全选筛选错题 |
| Esc | 取消选择/关闭对话框 | 取消选择/关闭对话框 |

---

## 四、关键技术点

### 4.1 错题逻辑迁移（React → Vue3）
移动端错题本使用 React，需要将其核心逻辑迁移到 Vue3：
1. **状态管理**：从 React hooks 迁移到 Pinia stores
2. **组件通信**：从 props/callbacks 迁移到 provide/inject 或 events
3. **筛选逻辑**：直接复用移动端 `filteredQuestions` 的计算逻辑
4. **API调用**：复用 `apiService.js` 中已有的错题API

### 4.2 搜索与高亮
- **搜索**：实现全文搜索，支持题目内容、知识点标签等
- **高亮**：使用 `mark.js` 或自定义实现关键词高亮
- **性能优化**：使用 Web Worker 处理大量数据的搜索

### 4.3 打印预览
- 复用移动端 `pdfGenerator.js` 的逻辑
- PC端增加 A4 纸张预览、分页预览功能
- 支持导出 Word/PDF

### 4.4 数据一致性
- **错题数据源**：PC端和移动端共用同一套 API 和数据模型
- **状态同步**：PC端修改错题状态后，移动端实时反映
- **离线支持**：PC端支持离线编辑，网络恢复后自动同步

---

## 五、实施步骤

### Phase 1: 基础架构搭建 (3-4天)
1. 创建 `wrongBookStore.js` 状态管理
2. 创建 `workbenchStore.js` 工作台状态
3. 优化 `paperStore.js` 增加选择功能
4. 创建共享组件（搜索栏、分页栏、模式切换器）

### Phase 2: 试卷入库优化 (2-3天)
1. 优化 `ExamWorkbench.vue` 布局
2. 添加搜索、筛选、高亮功能
3. 实现打印预览组件
4. 完善导出功能

### Phase 3: 错题本PC端 (4-5天)
1. 创建 `WrongBookWorkbench.vue` 主视图
2. 实现错题卡片、筛选面板、状态切换等组件
3. 迁移移动端筛选和排序逻辑
4. 实现批量操作和打印功能

### Phase 4: 整合与测试 (2-3天)
1. 整合两个功能到统一工作台
2. 测试数据一致性（PC端 vs 移动端）
3. 性能优化（虚拟滚动、懒加载）
4. 用户体验优化（快捷键、动画）

---

## 六、API 接口清单

### 试卷入库相关
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/papers` | GET | 获取试卷列表 |
| `/api/papers/:id` | GET | 获取试卷详情 |
| `/api/papers` | POST | 创建新试卷 |
| `/api/papers/:id` | PUT | 更新试卷信息 |
| `/api/papers/:id/blocks` | PUT | 更新题目块 |
| `/api/papers/:id/export` | POST | 导出试卷 |
| `/api/papers/:id/finalize` | POST | 完成校对 |

### 错题本相关（复用移动端API）
| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/wrong-questions/:studentId` | GET | 获取学生错题列表 |
| `/api/wrong-questions/:id` | PUT | 更新错题状态 |
| `/api/wrong-questions/:id` | DELETE | 删除错题 |
| `/api/wrong-questions/batch` | PUT | 批量更新错题 |
| `/api/exams` | POST | 创建组卷 |
| `/api/exams/:id/print` | POST | 打印试卷 |

---

## 七、注意事项

1. **数据模型一致性**：PC端和移动端必须使用相同的数据模型
2. **API复用**：错题相关API完全复用移动端实现
3. **状态独立**：两个功能的 Pinia stores 完全独立，避免耦合
4. **渐进式迁移**：先保证功能可用，再逐步优化性能
5. **测试覆盖**：确保核心逻辑有单元测试覆盖
6. **类型安全**：建议添加 JSDoc 或 TypeScript 类型定义
