<template>
  <el-dialog
    :model-value="modelValue"
    title="手工绘制几何图（人工确认结构 → 确定性出清晰矢量图）"
    width="860px"
    top="6vh"
    append-to-body
    @update:model-value="v => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="gse-tip">
      在配图上<b>点顶点、连边</b>；被文本闸门误判"无法重绘"的题，人工确认后即可出真·清晰矢量图。
      坐标会自动等比渲染，无需精确。
    </div>

    <div class="gse-body">
      <!-- 左：图上编辑画布 -->
      <div class="gse-canvas-wrap">
        <div class="gse-toolbar">
          <el-radio-group v-model="mode" size="small">
            <el-radio-button label="add">加点</el-radio-button>
            <el-radio-button label="link">连线</el-radio-button>
            <el-radio-button label="move">拖动</el-radio-button>
          </el-radio-group>
          <span class="gse-hint">
            {{ mode === 'add' ? '点击空白处添加顶点' : mode === 'link' ? (linkStart ? `起点 ${linkStart} → 再点一个点连线` : '点击第一个顶点') : '拖动顶点调整位置' }}
          </span>
          <el-button size="small" text :disabled="!points.length" @click="loadDraft">载入模型草稿</el-button>
        </div>

        <div class="gse-stage" ref="stageRef">
          <img v-if="cropUrl" :src="cropUrl" class="gse-img" alt="配图" @load="onImgLoad" />
          <div v-else class="gse-noimg">无配图可参照，可直接在画布上点顶点</div>
          <svg
            class="gse-svg"
            :viewBox="`0 0 ${W} ${H}`"
            :style="{ width: W + 'px', height: H + 'px' }"
            @click="onStageClick"
          >
            <line
              v-for="(s, i) in segments" :key="'s' + i"
              :x1="pt(s.from)?.x" :y1="pt(s.from)?.y" :x2="pt(s.to)?.x" :y2="pt(s.to)?.y"
              class="gse-seg" @click.stop="removeSegment(i)"
            />
            <g v-for="p in points" :key="p.label">
              <circle
                :cx="p.x" :cy="p.y" r="7"
                :class="['gse-pt', { 'gse-pt-active': linkStart === p.label || selected === p.label }]"
                @pointerdown.stop="onPtDown(p, $event)"
                @click.stop="onPtClick(p)"
              />
              <text :x="p.x + 10" :y="p.y - 8" class="gse-label">{{ p.label }}</text>
            </g>
          </svg>
        </div>
      </div>

      <!-- 右：顶点/边列表 -->
      <div class="gse-side">
        <div class="gse-side-title">顶点（{{ points.length }}）</div>
        <div v-for="p in points" :key="'r' + p.label" class="gse-pt-row">
          <el-input v-model="p.label" size="small" class="gse-lbl" @change="onRename(p)" />
          <el-button size="small" text type="danger" @click="removePoint(p.label)">删</el-button>
        </div>
        <div class="gse-side-title" style="margin-top:12px;">边（{{ segments.length }}）</div>
        <div v-for="(s, i) in segments" :key="'e' + i" class="gse-seg-row">
          <span>{{ s.from }} — {{ s.to }}</span>
          <el-button size="small" text type="danger" @click="removeSegment(i)">删</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="points.length < 2" @click="save">
        生成清晰图并保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { getGeometryStructure, saveGeometryStructure } from '../../../services/apiService'

const props = defineProps({ modelValue: Boolean, question: Object })
const emit = defineEmits(['update:modelValue', 'saved'])

const W = ref(400), H = ref(300)
const cropUrl = ref('')
const points = reactive([])   // {label,x,y}
const segments = reactive([]) // {from,to}
const mode = ref('add')
const linkStart = ref(null)
const selected = ref(null)
const saving = ref(false)

const pt = (label) => points.find(p => p.label === label)
const nextLabel = () => {
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i)
    if (!points.some(p => p.label === c)) return c
  }
  let n = 1; while (points.some(p => p.label === 'P' + n)) n++
  return 'P' + n
}

function onImgLoad(e) {
  const img = e.target
  if (img.naturalWidth) {
    const scale = Math.min(560 / img.naturalWidth, 460 / img.naturalHeight, 1)
    W.value = Math.round(img.naturalWidth * scale)
    H.value = Math.round(img.naturalHeight * scale)
  }
}

function svgPoint(evt) {
  const rect = evt.currentTarget.getBoundingClientRect()
  return {
    x: Math.round((evt.clientX - rect.left) / rect.width * W.value),
    y: Math.round((evt.clientY - rect.top) / rect.height * H.value),
  }
}

function onStageClick(evt) {
  if (mode.value !== 'add') return
  const { x, y } = svgPoint(evt)
  points.push({ label: nextLabel(), x, y })
}

function onPtClick(p) {
  if (mode.value !== 'link') { selected.value = p.label; return }
  if (!linkStart.value) { linkStart.value = p.label; return }
  if (linkStart.value !== p.label) {
    const exists = segments.some(s =>
      (s.from === linkStart.value && s.to === p.label) || (s.from === p.label && s.to === linkStart.value))
    if (!exists) segments.push({ from: linkStart.value, to: p.label })
  }
  linkStart.value = null
}

// 拖动顶点
let dragging = null
function onPtDown(p, evt) {
  if (mode.value !== 'move') return
  dragging = p
  evt.currentTarget.setPointerCapture?.(evt.pointerId)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(evt) {
  if (!dragging) return
  const svg = evt.currentTarget.querySelector ? null : null
  const stage = document.querySelector('.gse-svg')
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  dragging.x = Math.round((evt.clientX - rect.left) / rect.width * W.value)
  dragging.y = Math.round((evt.clientY - rect.top) / rect.height * H.value)
}
function onDragEnd() { dragging = null; window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragEnd) }

function removePoint(label) {
  const i = points.findIndex(p => p.label === label)
  if (i >= 0) points.splice(i, 1)
  for (let j = segments.length - 1; j >= 0; j--) {
    if (segments[j].from === label || segments[j].to === label) segments.splice(j, 1)
  }
  if (linkStart.value === label) linkStart.value = null
}
function removeSegment(i) { segments.splice(i, 1) }
function onRename(p) { if (!p.label) p.label = nextLabel() }

async function onOpen() {
  points.splice(0); segments.splice(0); linkStart.value = null
  cropUrl.value = props.question?.geometry_image_url || ''
  try {
    const d = await getGeometryStructure(props.question?.id)
    if (d?.cropUrl) cropUrl.value = d.cropUrl
    applyStructure(d?.structure)
  } catch { /* 无草稿即可 */ }
}
function applyStructure(st) {
  if (!st || !Array.isArray(st.points)) return
  points.splice(0, points.length, ...st.points.map(p => ({ label: p.label || nextLabel(), x: Math.round(p.x ?? p.position?.x ?? 0), y: Math.round(p.y ?? p.position?.y ?? 0) })))
  segments.splice(0, segments.length, ...(Array.isArray(st.segments) ? st.segments.map(s => ({ from: s.from || s.start, to: s.to || s.end })) : []))
}
async function loadDraft() {
  try {
    const d = await getGeometryStructure(props.question?.id)
    if (d?.structure?.points?.length) { applyStructure(d.structure); ElMessage.success('已载入模型草稿，请在图上修正') }
    else ElMessage.info('该题暂无模型草稿，请手工描点')
  } catch { ElMessage.error('载入草稿失败') }
}

async function save() {
  if (points.length < 2) return
  saving.value = true
  try {
    const structure = {
      points: points.map(p => ({ label: p.label, x: p.x, y: p.y })),
      segments: segments.filter(s => pt(s.from) && pt(s.to)).map(s => ({ from: s.from, to: s.to })),
    }
    const res = await saveGeometryStructure(props.question.id, structure)
    if (res?.success) {
      ElMessage.success('已生成清晰几何图')
      emit('saved', { questionId: props.question.id, svg: res.svg, url: res.url })
      emit('update:modelValue', false)
    } else {
      ElMessage.error(res?.error || '生成失败')
    }
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || '网络错误'))
  } finally { saving.value = false }
}
</script>

<style scoped>
.gse-tip { font-size: 13px; color: #606266; margin-bottom: 8px; }
.gse-body { display: flex; gap: 14px; }
.gse-canvas-wrap { flex: 1; min-width: 0; }
.gse-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
.gse-hint { font-size: 12px; color: #909399; }
.gse-stage { position: relative; border: 1px solid #dcdfe6; border-radius: 4px; overflow: hidden; background: #fafafa; line-height: 0; }
.gse-img { display: block; max-width: 100%; }
.gse-noimg { width: 400px; height: 300px; display: flex; align-items: center; justify-content: center; color: #c0c4cc; font-size: 13px; }
.gse-svg { position: absolute; left: 0; top: 0; cursor: crosshair; }
.gse-seg { stroke: #409eff; stroke-width: 2; cursor: pointer; }
.gse-pt { fill: #f56c6c; stroke: #fff; stroke-width: 1.5; cursor: pointer; }
.gse-pt-active { fill: #67c23a; }
.gse-label { font-size: 14px; fill: #303133; font-weight: 600; pointer-events: none; user-select: none; }
.gse-side { width: 190px; flex-shrink: 0; max-height: 480px; overflow-y: auto; }
.gse-side-title { font-size: 13px; color: #606266; font-weight: 600; margin-bottom: 6px; }
.gse-pt-row, .gse-seg-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; font-size: 13px; }
.gse-lbl { width: 90px; }
</style>
