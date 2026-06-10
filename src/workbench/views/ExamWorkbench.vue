<template>
  <div class="workbench-container">
    <!-- ===== 顶部工具栏 ===== -->
    <header class="workbench-header">
      <div class="header-left">
        <el-button type="info" plain @click="handleBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <div class="paper-info">
          <h2 class="paper-title">{{ paperStore.paperInfo.name || '未命名试卷' }}</h2>
          <p class="paper-meta">
            共 {{ paperStore.getQuestionCount() }} 题 · 
            识别完成 {{ getRecognitionRate() }}% · 
            低置信度 {{ paperStore.getLowConfCount() }} 处
          </p>
        </div>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="handleExportWord">
          <el-icon><Document /></el-icon>
          导出Word
        </el-button>
        <el-button type="success" @click="handleFinalize">
          <el-icon><CircleCheck /></el-icon>
          完成校对
        </el-button>
      </div>
    </header>

    <!-- 提示信息 -->
    <div class="tip-bar" v-if="paperStore.getLowConfCount() > 0">
      <el-icon class="tip-icon"><WarningFilled /></el-icon>
      <span>提示：请重点校对低置信度题目内容及图片位置，知识有误可手动修改</span>
    </div>

    <!-- ===== 双栏对比区域 ===== -->
    <main class="workbench-main">
      <!-- 左栏：原始图片 -->
      <div class="left-panel">
        <div class="panel-header">
          <span class="panel-title">原始图片</span>
          <div class="zoom-controls">
            <el-button size="small" @click="zoomOut">
              <el-icon><Minus /></el-icon>
            </el-button>
            <span class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</span>
            <el-button size="small" @click="zoomIn">
              <el-icon><Plus /></el-icon>
            </el-button>
            <el-button size="small" @click="resetZoom">
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </div>
        </div>
        <div class="image-container" @wheel="handleWheel">
          <div 
            class="image-wrapper" 
            :style="{ transform: `scale(${zoomLevel})` }"
            @mousedown="startDrag"
            @mousemove="drag"
            @mouseup="stopDrag"
            @mouseleave="stopDrag"
          >
            <img 
              v-if="currentPage?.originalImage" 
              :src="currentPage.originalImage" 
              :alt="`第${currentPage.pageNo}页`"
              class="original-image"
              draggable="false"
            />
          </div>
        </div>
      </div>

      <!-- 右栏：识别结果 -->
      <div class="right-panel">
        <div class="panel-header">
          <span class="panel-title">识别结果</span>
          <el-button text type="primary" size="small">
            <el-icon><EditPen /></el-icon>
            全文校对
          </el-button>
        </div>
        <div class="content-scroll">
          <div class="paper-content">
            <!-- 标题 -->
            <div v-if="titleBlocks.length > 0" class="title-section">
              <div v-for="(block, i) in titleBlocks" :key="i" class="title-block">
                <span 
                  class="editable-text title-text"
                  :class="{ 'low-conf': block.confidence < 0.7 }"
                  @click="handleBlockEdit(block)"
                >{{ block.content }}</span>
                <el-tooltip v-if="block.confidence < 0.7" :content="`置信度: ${Math.round(block.confidence * 100)}%`">
                  <el-icon class="warning-icon"><WarningFilled /></el-icon>
                </el-tooltip>
              </div>
            </div>

            <!-- 副标题 -->
            <div v-if="subtitleBlocks.length > 0" class="subtitle-section">
              <span 
                v-for="(block, i) in subtitleBlocks" 
                :key="i"
                class="editable-text subtitle-text"
                @click="handleBlockEdit(block)"
              >{{ block.content }}</span>
            </div>

            <!-- 分隔线 -->
            <div class="divider"></div>

            <!-- 题目内容 -->
            <div class="questions-section">
              <div 
                v-for="(block, idx) in contentBlocks" 
                :key="idx"
                class="block-item"
              >
                <QuestionBlock 
                  v-if="block.type === 'question'"
                  :block="block"
                  :page-no="currentPage?.pageNo"
                  :block-index="getBlockIndex(block)"
                  @edit="handleBlockEdit"
                />
                <TextBlock 
                  v-else-if="block.type === 'text'"
                  :block="block"
                  :page-no="currentPage?.pageNo"
                  :block-index="getBlockIndex(block)"
                  @edit="handleBlockEdit"
                />
                <SectionBlock 
                  v-else-if="block.type === 'section'"
                  :block="block"
                  :page-no="currentPage?.pageNo"
                  :block-index="getBlockIndex(block)"
                  @edit="handleBlockEdit"
                />
                <ImageBlock 
                  v-else-if="block.type === 'image'"
                  :block="block"
                  :page-no="currentPage?.pageNo"
                  :block-index="getBlockIndex(block)"
                />
                <TableBlock 
                  v-else-if="block.type === 'table'"
                  :block="block"
                  :page-no="currentPage?.pageNo"
                  :block-index="getBlockIndex(block)"
                  @edit="handleBlockEdit"
                />
              </div>
            </div>

            <!-- 页脚 -->
            <div v-if="footerBlocks.length > 0" class="footer-section">
              {{ footerBlocks.map(b => b.content).join(' ') }}
            </div>
            <div v-else class="footer-section">- {{ currentPage?.pageNo }} -</div>
          </div>
        </div>

        <!-- 底部图形处理区域 -->
        <div v-if="imageBlocks.length > 0" class="image-section">
          <div class="image-section-header">
            共保留 {{ imageBlocks.length }} 处图形
            （题{{ getImageQuestionNumbers().join('、题') }}）
          </div>
          <div class="image-thumbnails">
            <div 
              v-for="(img, i) in imageBlocks" 
              :key="i"
              class="thumbnail-card"
              :class="{ 'success': img.src, 'warning': !img.src }"
            >
              <div class="thumbnail-image-wrapper">
                <img v-if="img.src" :src="img.src" :alt="img.caption" class="thumbnail-image" />
                <div v-else class="thumbnail-placeholder">
                  <el-icon><Picture /></el-icon>
                  <span>[图: 待插入]</span>
                </div>
                <el-tag 
                  v-if="img.src" 
                  size="small" 
                  type="success" 
                  class="status-tag"
                >识别成功</el-tag>
              </div>
              <div class="thumbnail-info">
                <div class="thumbnail-caption">{{ img.caption || `图形${i + 1}` }}</div>
                <div class="thumbnail-actions">
                  <el-button size="small" text>查看大图</el-button>
                  <el-button size="small" text type="primary">替换图片</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- ===== 分页导航 ===== -->
    <footer v-if="paperStore.pages.length > 1" class="workbench-footer">
      <el-button 
        @click="handlePrevPage" 
        :disabled="paperStore.currentPageIndex === 0"
      >上一页</el-button>
      <span class="page-indicator">
        第 {{ paperStore.currentPageIndex + 1 }} / {{ paperStore.pages.length }} 页
      </span>
      <el-button 
        @click="handleNextPage" 
        :disabled="paperStore.currentPageIndex === paperStore.pages.length - 1"
      >下一页</el-button>
    </footer>

    <!-- 编辑对话框 -->
    <el-dialog 
      v-model="editDialogVisible" 
      title="编辑内容" 
      width="600px"
      append-to-body
    >
      <el-input 
        v-model="editContent" 
        type="textarea" 
        :rows="6"
        placeholder="请输入内容..."
      />
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { usePaperStore } from '../store/paperStore'
import { ArrowLeft, Document, CircleCheck, WarningFilled, Minus, Plus, FullScreen, EditPen, Picture } from '@element-plus/icons-vue'
import QuestionBlock from '../components/QuestionBlock.vue'
import TextBlock from '../components/TextBlock.vue'
import SectionBlock from '../components/SectionBlock.vue'
import ImageBlock from '../components/ImageBlock.vue'
import TableBlock from '../components/TableBlock.vue'
import { exportPaperWord, confirmPaper } from '../api/paperApi'
import { ElMessage } from 'element-plus'
import { saveAs } from 'file-saver'

const paperStore = usePaperStore()

// 缩放相关
const zoomLevel = ref(1)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const imageOffset = ref({ x: 0, y: 0 })

// 编辑对话框
const editDialogVisible = ref(false)
const editContent = ref('')
const editingBlock = ref(null)

// 当前页面
const currentPage = computed(() => paperStore.pages[paperStore.currentPageIndex])

// 各类区块
const titleBlocks = computed(() => currentPage.value?.layoutBlocks?.filter(b => b.type === 'title') || [])
const subtitleBlocks = computed(() => currentPage.value?.layoutBlocks?.filter(b => b.type === 'subtitle') || [])
const footerBlocks = computed(() => currentPage.value?.layoutBlocks?.filter(b => b.type === 'footer') || [])
const contentBlocks = computed(() => 
  currentPage.value?.layoutBlocks?.filter(b => 
    b.type !== 'title' && b.type !== 'subtitle' && b.type !== 'footer'
  ) || []
)
const imageBlocks = computed(() => paperStore.getImageBlocks(paperStore.currentPageIndex))

// 方法
const getRecognitionRate = () => {
  const page = currentPage.value
  if (!page || !page.layoutBlocks) return 98
  const total = page.layoutBlocks.length
  const lowConf = page.layoutBlocks.filter(b => b.confidence < 0.7).length
  return Math.round(((total - lowConf) / total) * 100)
}

const getBlockIndex = (block) => {
  return currentPage.value?.layoutBlocks?.indexOf(block) ?? -1
}

const getImageQuestionNumbers = () => {
  return imageBlocks.value.map((img, i) => {
    const m = img.caption?.match(/第(\d+)/)
    return m ? m[1] : (i + 1)
  })
}

// 缩放控制
const zoomIn = () => { zoomLevel.value = Math.min(3, zoomLevel.value + 0.1) }
const zoomOut = () => { zoomLevel.value = Math.max(0.3, zoomLevel.value - 0.1) }
const resetZoom = () => { zoomLevel.value = 1; imageOffset.value = { x: 0, y: 0 } }

const handleWheel = (e) => {
  e.preventDefault()
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

const startDrag = (e) => {
  isDragging.value = true
  dragStart.value = { x: e.clientX - imageOffset.value.x, y: e.clientY - imageOffset.value.y }
}

const drag = (e) => {
  if (!isDragging.value) return
  imageOffset.value = {
    x: e.clientX - dragStart.value.x,
    y: e.clientY - dragStart.value.y
  }
}

const stopDrag = () => { isDragging.value = false }

// 分页
const handlePrevPage = () => paperStore.setCurrentPage(paperStore.currentPageIndex - 1)
const handleNextPage = () => paperStore.setCurrentPage(paperStore.currentPageIndex + 1)

// 编辑
const handleBlockEdit = (block) => {
  editingBlock.value = block
  editContent.value = block.content
  editDialogVisible.value = true
}

const handleSaveEdit = () => {
  if (editingBlock.value) {
    const pageIndex = paperStore.currentPageIndex
    const blockIndex = getBlockIndex(editingBlock.value)
    paperStore.updateBlock(pageIndex, blockIndex, { content: editContent.value })
    ElMessage.success('保存成功')
  }
  editDialogVisible.value = false
}

// 导出
const handleExportWord = async () => {
  try {
    // TODO: 实现导出逻辑
    ElMessage.info('导出功能开发中...')
  } catch (err) {
    ElMessage.error('导出失败')
  }
}

const handleFinalize = async () => {
  try {
    // TODO: 实现确认入库逻辑
    ElMessage.success('校对完成')
  } catch (err) {
    ElMessage.error('操作失败')
  }
}

const handleBack = () => {
  window.location.href = '/'
}

// 初始化（开发用，后续从API获取）
onMounted(() => {
  // 模拟数据
  paperStore.setPaperInfo({
    name: '2024年初三数学期中考试卷',
    subject: '数学',
    grade: '初三',
    examType: '期中'
  })
  
  paperStore.setPages([
    {
      pageNo: 1,
      originalImage: 'https://picsum.photos/800/1200',
      layoutBlocks: [
        { type: 'title', content: '2024年初三数学期中考试卷', confidence: 0.98 },
        { type: 'subtitle', content: '考试时间：120分钟  满分：150分', confidence: 0.95 },
        { type: 'section', content: '一、选择题（每题3分，共30分）', confidence: 0.99 },
        { type: 'question', content: '1. 下列计算正确的是（ ）', options: ['A. 2+3=5', 'B. 2×3=6', 'C. 2-3=1', 'D. 2÷3=1'], confidence: 0.97 },
        { type: 'image', content: '', caption: '二次函数图像', src: 'https://picsum.photos/300/200', confidence: 0.93 },
        { type: 'question', content: '2. 如图，三角形ABC中，∠A=60°，则∠B+∠C=（ ）', options: ['A. 100°', 'B. 110°', 'C. 120°', 'D. 130°'], confidence: 0.92 },
        { type: 'image', content: '', caption: '三角形ABC', src: null, confidence: 0.85 },
        { type: 'text', content: '注意事项：请考生认真审题，仔细作答。', confidence: 0.90 },
        { type: 'footer', content: '第 1 页 共 4 页', confidence: 0.99 }
      ]
    }
  ])
})
</script>

<style scoped>
.workbench-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* 顶部工具栏 */
.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.paper-title {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.paper-meta {
  font-size: 12px;
  color: #9ca3af;
  margin: 4px 0 0;
}

.header-right {
  display: flex;
  gap: 8px;
}

/* 提示栏 */
.tip-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  font-size: 12px;
  color: #92400e;
}

.tip-icon {
  color: #d97706;
}

/* 主内容区 */
.workbench-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-panel {
  width: 50%;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.right-panel {
  width: 50%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* 面板头部 */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.panel-title {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-level {
  font-size: 12px;
  color: #6b7280;
  min-width: 40px;
  text-align: center;
}

/* 图片容器 */
.image-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.image-wrapper {
  transition: transform 0.1s ease;
  cursor: grab;
}

.image-wrapper:active {
  cursor: grabbing;
}

.original-image {
  max-width: 100%;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* 内容滚动区 */
.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.paper-content {
  max-width: 560px;
  margin: 0 auto;
}

/* 标题样式 */
.title-section {
  text-align: center;
  margin-bottom: 4px;
}

.title-block {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.title-text {
  font-size: 17px;
  font-weight: 700;
  color: #111827;
}

.subtitle-section {
  text-align: center;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
}

.editable-text {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.editable-text:hover {
  background: #eff6ff;
}

.low-conf {
  color: #d97706 !important;
}

.warning-icon {
  color: #d97706;
  font-size: 12px;
}

.divider {
  margin: 0 0 16px;
  border-bottom: 1.5px solid #333;
}

/* 底部图形区 */
.image-section {
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  background: #fafafa;
}

.image-section-header {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  margin-bottom: 8px;
}

.image-thumbnails {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.thumbnail-card {
  flex-shrink: 0;
  width: 160px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid;
  background: #fff;
}

.thumbnail-card.success {
  border-color: #86efac;
}

.thumbnail-card.warning {
  border-color: #fde68a;
}

.thumbnail-image-wrapper {
  position: relative;
}

.thumbnail-image {
  width: 100%;
  max-height: 100px;
  object-fit: contain;
}

.thumbnail-placeholder {
  width: 100%;
  height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-bottom: 1px dashed #fde68a;
  background: #fffbeb;
  color: #d97706;
  font-size: 10px;
}

.status-tag {
  position: absolute;
  top: 4px;
  right: 4px;
}

.thumbnail-info {
  padding: 8px;
}

.thumbnail-caption {
  font-size: 10px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumbnail-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

/* 底部导航 */
.workbench-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.page-indicator {
  font-size: 14px;
  color: #6b7280;
}

.footer-section {
  text-align: center;
  margin-top: 24px;
  font-size: 11px;
  color: #9ca3af;
  border-top: 1px solid #e5e7eb;
  padding-top: 8px;
}
</style>
