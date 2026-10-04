<template>
  <el-button type="success" size="default" :loading="loading" @click="open">
    家长分享卡
  </el-button>
  <el-dialog v-model="visible" title="家长分享卡（原图发家长 · 转发版名字打码）" width="480px" append-to-body>
    <div v-loading="loading" class="share-card-wrap">
      <el-segmented v-model="variant" :options="variantOptions" class="variant-switch" :disabled="loading" @change="loadPng" />
      <img v-if="pngUrl" :src="pngUrl" class="share-card-img" alt="家长分享卡预览" />
      <div v-else-if="!loading" class="share-card-empty">生成失败或该时段暂无学习数据</div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="exporting" :disabled="!pngUrl" @click="savePng">保存图片</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'

// 家长分享卡（2026-10-04 升级，替换旧 html2canvas 成长卡）：
// 服务端按「敏学成长中心」品牌渲染 750×1334 竖版 PNG（Playwright 截图），
// 数据与周报完全同源（fetchStudentWeeklyReport）。两态：
//   - 转发版（默认）：姓名/头像打码烘焙进图片，适合发群/朋友圈；
//   - 原图：全名，单独发给家长本人。
// 图片不落 OSS、不落库，即用即生成。旧版三个数字的紧凑卡被本卡完整覆盖。
const props = defineProps({
  studentId: { type: String, default: '' },
  studentName: { type: String, default: '' },
  mode: { type: String, default: 'week' },
  offset: { type: Number, default: 0 }
})

const visible = ref(false)
const loading = ref(false)
const exporting = ref(false)
const variant = ref('masked')
const pngUrl = ref('')
const variantOptions = [
  { label: '转发版（名字打码）', value: 'masked' },
  { label: '原图（全名）', value: 'full' }
]
let pngBlob = null

watch(visible, (v) => {
  if (!v) releaseUrl()
})

async function open() {
  if (!props.studentId) {
    ElMessage.warning('请先选择学生')
    return
  }
  variant.value = 'masked'
  visible.value = true
  await loadPng()
}

async function loadPng() {
  releaseUrl()
  loading.value = true
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const resp = await fetch(`${API_BASE}/share-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: props.studentId,
        mode: props.mode,
        offset: props.offset,
        maskName: variant.value === 'masked'
      })
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || `生成失败（${resp.status}）`)
    }
    pngBlob = await resp.blob()
    pngUrl.value = URL.createObjectURL(pngBlob)
  } catch (e) {
    pngBlob = null
    ElMessage.error(e?.message || '分享卡生成失败')
  } finally {
    loading.value = false
  }
}

function releaseUrl() {
  if (pngUrl.value) URL.revokeObjectURL(pngUrl.value)
  pngUrl.value = ''
  pngBlob = null
}

async function savePng() {
  if (!pngBlob) return
  exporting.value = true
  try {
    const suffix = variant.value === 'masked' ? '转发版' : '原图'
    saveAs(pngBlob, `分享卡-${props.studentName || '学生'}-${suffix}-${dayjs().format('MMDD')}.png`)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.share-card-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-height: 220px;
}
.variant-switch {
  flex-shrink: 0;
}
.share-card-img {
  width: 340px;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
.share-card-empty {
  padding: 60px 0;
  color: var(--wb-text-tertiary, #94a3b8);
  font-size: 13px;
}
</style>
