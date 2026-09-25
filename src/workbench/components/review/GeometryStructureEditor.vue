<template>
  <el-dialog
    :model-value="modelValue"
    title="手工绘制几何图（人工确认结构 → 确定性出清晰矢量图）"
    width="900px"
    top="5vh"
    append-to-body
    @update:model-value="v => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="gse-tip">
      在配图上<b>点顶点、连边</b>；边可选<b>线段</b>或<b>直线</b>（直线会向两端延长，画平行线 l₁/l₂/l₃ 用）；<b>标注</b>模式可在图上放文字。坐标自动等比渲染，无需精确。
    </div>

    <div class="gse-body">
      <div class="gse-canvas-wrap">
        <div class="gse-toolbar">
          <el-radio-group v-model="mode" size="small">
            <el-radio-button value="add">加点</el-radio-button>
            <el-radio-button value="link">连线</el-radio-button>
            <el-radio-button value="label">标注</el-radio-button>
            <el-radio-button value="move">拖动</el-radio-button>
          </el-radio-group>
          <el-checkbox v-if="mode === 'link'" v-model="linkAsLine" size="small">画成直线(两端延长)</el-checkbox>
          <el-input v-if="mode === 'label'" v-model="labelText" size="small" style="width:120px" placeholder="如 l₁" />
          <span class="gse-hint">{{ hint }}</span>
          <el-button size="small" text :disabled="!points.length" @click="loadDraft">载入模型草稿</el-button>
        </div>

        <div class="gse-stage" ref="stageRef">
          <img v-if="cropUrl" :src="cropUrl" class="gse-img" alt="配图" @load="onImgLoad" />
          <div v-else class="gse-noimg">无配图可参照，可直接在画布上点顶点</div>
          <svg class="gse-svg" :viewBox="`0 0 ${W} ${H}`" :style="{ width: W + 'px', height: H + 'px' }" @click="onStageClick">
            <line
              v-for="(s, i) in segments" :key="'s' + i"
              :x1="ex(s).x1" :y1="ex(s).y1" :x2="ex(s).x2" :y2="ex(s).y2"
              class="gse-seg" @click.stop="removeSegment(i)"
            />
            <g v-for="p in points" :key="p.label">
              <circle
                :cx="p.x" :cy="p.y" r="7"
                :class="['gse-pt', { 'gse-pt-active': linkStart === p.label || selected === p.label }]"
                @pointerdown.stop="onPtDown(p, $event)" @click.stop="onPtClick(p)"
              />
              <text :x="p.x + 10" :y="p.y - 8" class="gse-label">{{ p.label }}</text>
            </g>
            <text v-for="(l, i) in labels" :key="'lb' + i" :x="l.x" :y="l.y" class="gse-textlabel" @click.stop="removeLabel(i)">{{ l.text }}</text>
          </svg>
        </div>
      </div>

      <div class="gse-side">
        <div class="gse-side-title">顶点（{{ points.length }}）</div>
        <div v-for="p in points" :key="'r' + p.label" class="gse-row">
          <el-input v-model="p.label" size="small" class="gse-lbl" @change="onRename(p)" />
          <el-button size="small" text type="danger" @click="removePoint(p.label)">删</el-button>
        </div>
        <div class="gse-side-title" style="margin-top:10px;">边（{{ segments.length }}）</div>
        <div v-for="(s, i) in segments" :key="'e' + i" class="gse-row">
          <span class="gse-segtxt" @click="s.extend = !s.extend" :title="'点击切换 线段/直线'">{{ s.from }}—{{ s.to }}{{ s.extend ? ' (直线)' : '' }}</span>
          <el-button size="small" text type="danger" @click="removeSegment(i)">删</el-button>
        </div>
        <div class="gse-side-title" style="margin-top:10px;">标注（{{ labels.length }}）</div>
        <div v-for="(l, i) in labels" :key="'lr' + i" class="gse-row">
          <el-input v-model="l.text" size="small" class="gse-lbl" />
          <el-button size="small" text type="danger" @click="removeLabel(i)">删</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="points.length < 2" @click="save">生成清晰图并保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { getGeometryStructure, saveGeometryStructure } from '../../../services/apiService'

const props = defineProps({ modelValue: Boolean, question: Object })
const emit = defineEmits(['update:modelValue', 'saved'])

const W = ref(400), H = ref(300)
const cropUrl = ref('')
const points = reactive([])    // {label,x,y}
const segments = reactive([])  // {from,to,extend?}
const labels = reactive([])    // {x,y,text}
const mode = ref('add')
const linkStart = ref(null)
const selected = ref(null)
const linkAsLine = ref(false)
const labelText = ref('l₁')
const saving = ref(false)

const pt = (label) => points.find(p => p.label === label)
const hint = computed(() => ({
  add: '点击空白处添加顶点',
  link: linkStart.value ? `起点 ${linkStart.value} → 再点一个点连线` : '点击第一个顶点',
  label: '点击图上位置放文字（左侧可改内容）',
  move: '拖动顶点调整位置',
}[mode.value]))

function nextLabel() {
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!points.some(p => p.label === c)) return c }
  let n = 1; while (points.some(p => p.label === 'P' + n)) n++; return 'P' + n
}
// 预览：直线模式的边在图上按 14% 向两端延长显示
function ex(s) {
  const a = pt(s.from), b = pt(s.to)
  if (!a || !b) return { x1: 0, y1: 0, x2: 0, y2: 0 }
  if (!s.extend) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, k = 0.14
  return { x1: a.x - dx * k, y1: a.y - dy * k, x2: b.x + dx * k, y2: b.y + dy * k }
}
function onImgLoad(e) {
  const img = e.target
  if (img.naturalWidth) { const sc = Math.min(600 / img.naturalWidth, 470 / img.naturalHeight, 1); W.value = Math.round(img.naturalWidth * sc); H.value = Math.round(img.naturalHeight * sc) }
}
function svgPoint(evt) {
  const rect = evt.currentTarget.getBoundingClientRect()
  return { x: Math.round((evt.clientX - rect.left) / rect.width * W.value), y: Math.round((evt.clientY - rect.top) / rect.height * H.value) }
}
function onStageClick(evt) {
  const { x, y } = svgPoint(evt)
  if (mode.value === 'add') { points.push({ label: nextLabel(), x, y }) }
  else if (mode.value === 'label') { labels.push({ x, y, text: labelText.value || 'l' }) }
}
function onPtClick(p) {
  if (mode.value !== 'link') { selected.value = p.label; return }
  if (!linkStart.value) { linkStart.value = p.label; return }
  if (linkStart.value !== p.label) {
    const exists = segments.some(s => (s.from === linkStart.value && s.to === p.label) || (s.from === p.label && s.to === linkStart.value))
    if (!exists) segments.push({ from: linkStart.value, to: p.label, extend: linkAsLine.value })
  }
  linkStart.value = null
}
let dragging = null
function onPtDown(p, evt) { if (mode.value !== 'move') return; dragging = p; window.addEventListener('pointermove', onDragMove); window.addEventListener('pointerup', onDragEnd) }
function onDragMove(evt) {
  if (!dragging) return
  const stage = document.querySelector('.gse-svg'); if (!stage) return
  const rect = stage.getBoundingClientRect()
  dragging.x = Math.round((evt.clientX - rect.left) / rect.width * W.value)
  dragging.y = Math.round((evt.clientY - rect.top) / rect.height * H.value)
}
function onDragEnd() { dragging = null; window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragEnd) }
function removePoint(label) { const i = points.findIndex(p => p.label === label); if (i >= 0) points.splice(i, 1); for (let j = segments.length - 1; j >= 0; j--) if (segments[j].from === label || segments[j].to === label) segments.splice(j, 1); if (linkStart.value === label) linkStart.value = null }
function removeSegment(i) { segments.splice(i, 1) }
function removeLabel(i) { labels.splice(i, 1) }
function onRename(p) { if (!p.label) p.label = nextLabel() }

function applyStructure(st) {
  if (!st || !Array.isArray(st.points)) return
  points.splice(0, points.length, ...st.points.map(p => ({ label: p.label || '', x: Math.round(p.x ?? p.position?.x ?? 0), y: Math.round(p.y ?? p.position?.y ?? 0) })))
  segments.splice(0, segments.length, ...(Array.isArray(st.segments) ? st.segments.map(s => ({ from: s.from || s.start, to: s.to || s.end, extend: !!s.extend })) : []))
  labels.splice(0, labels.length, ...(Array.isArray(st.labels) ? st.labels.filter(l => l && l.text != null).map(l => ({ x: Math.round(l.x ?? 0), y: Math.round(l.y ?? 0), text: String(l.text) })) : []))
}
async function onOpen() {
  points.splice(0); segments.splice(0); labels.splice(0); linkStart.value = null
  cropUrl.value = props.question?.geometry_image_url || ''
  try { const d = await getGeometryStructure(props.question?.id); if (d?.cropUrl) cropUrl.value = d.cropUrl; applyStructure(d?.structure) } catch { /* 无草稿 */ }
}
async function loadDraft() {
  try { const d = await getGeometryStructure(props.question?.id); if (d?.structure?.points?.length) { applyStructure(d.structure); ElMessage.success('已载入模型草稿，请在图上修正') } else ElMessage.info('该题暂无模型草稿，请手工描点') } catch { ElMessage.error('载入草稿失败') }
}
async function save() {
  if (points.length < 2) return
  saving.value = true
  try {
    const structure = {
      points: points.map(p => ({ label: p.label, x: p.x, y: p.y })),
      segments: segments.filter(s => pt(s.from) && pt(s.to)).map(s => ({ from: s.from, to: s.to, extend: !!s.extend })),
      labels: labels.map(l => ({ x: l.x, y: l.y, text: l.text })),
    }
    const res = await saveGeometryStructure(props.question.id, structure)
    if (res?.success) { ElMessage.success('已生成清晰几何图'); emit('saved', { questionId: props.question.id, svg: res.svg, url: res.url }); emit('update:modelValue', false) }
    else ElMessage.error(res?.error || '生成失败')
  } catch (e) { ElMessage.error('保存失败：' + (e?.message || '网络错误')) } finally { saving.value = false }
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
.gse-textlabel { font-size: 15px; fill: #000; font-style: italic; cursor: pointer; }
.gse-side { width: 200px; flex-shrink: 0; max-height: 500px; overflow-y: auto; }
.gse-side-title { font-size: 13px; color: #606266; font-weight: 600; margin-bottom: 6px; }
.gse-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; font-size: 13px; }
.gse-lbl { width: 96px; }
.gse-segtxt { cursor: pointer; color: #409eff; }
</style>
