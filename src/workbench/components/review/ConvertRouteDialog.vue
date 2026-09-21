<template>
  <el-dialog
    :model-value="modelValue"
    title="改批改方式"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <!-- 功能关闭时（apiService.TASK_ROUTE_CONVERT_ENABLED=false）只给说明，不给任何可操作控件 -->
    <p v-if="!enabled" class="cr-disabled">{{ disabledHint }}如需使用请先开启功能开关。</p>
    <template v-if="task && enabled">
      <p class="cr-tip">
        当前：<strong>{{ currentLabel }}</strong>
        <span v-if="currentWorksheetName">（{{ currentWorksheetName }}）</span>
      </p>
      <p class="cr-warn">
        转换会<strong>清空这份作业的现有题目、判题与已入册错题</strong>，按新方式重新识别批改；
        已发布的几何重绘图会被一并清除，需要重新重绘。老师已确认过的结论无法保留。
      </p>

      <el-radio-group v-model="target" class="cr-targets">
        <el-radio v-for="t in TARGETS" :key="t.value" :value="t.value" :disabled="t.value === currentType">
          <span class="cr-radio-label">{{ t.label }}</span>
          <span class="cr-radio-desc">{{ t.desc }}</span>
        </el-radio>
      </el-radio-group>

      <!-- 方向性代价：练习册方向会丢题干，必须在选目标时就讲清楚 -->
      <p v-if="targetNote" class="cr-note">{{ targetNote }}</p>

      <div v-if="target === 'workbook'" class="cr-pick">
        <label>选择练习册</label>
        <el-select v-model="worksheetId" placeholder="请选择练习册" filterable class="cr-select">
          <el-option v-for="w in worksheets" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <p v-if="!worksheets.length" class="cr-empty">暂无可用练习册（需先在练习册管理里解析完成）</p>
      </div>

      <div v-if="target === 'exam'" class="cr-pick">
        <label>选择答案库资源</label>
        <el-select v-model="resourceId" placeholder="请选择答案库" filterable class="cr-select">
          <el-option v-for="r in resources" :key="r.id" :label="r.name" :value="r.id" />
        </el-select>
        <p v-if="!resources.length" class="cr-empty">暂无可用答案库资源</p>
      </div>

      <!-- 影响面：后端 dryRun 返回，未选完目标资源时不发请求 -->
      <div v-if="planning" class="cr-planning">正在预演转换影响…</div>
      <div v-else-if="planError" class="cr-error">{{ planError }}</div>
      <div v-else-if="plan" class="cr-impact">
        <p class="cr-impact-head">转换影响（预演）</p>
        <ul>
          <li>删除题目 <strong>{{ plan.impact.questions }}</strong> 道<span v-if="plan.impact.placeholderQuestions">
            （其中 {{ plan.impact.placeholderQuestions }} 道是「第 N 题」占位题干）</span></li>
          <li>删除错题本记录 <strong>{{ plan.impact.wrongQuestions }}</strong> 条、判题记录 {{ plan.impact.judgements }} 条</li>
          <li v-if="plan.impact.assets">连带删除题目资产 {{ plan.impact.assets }} 条<span
            v-if="plan.impact.publishedRedraws">（含已发布重绘图 {{ plan.impact.publishedRedraws }} 条）</span></li>
          <li v-if="plan.impact.workbookAnswerCount !== null && plan.impact.workbookAnswerCount !== undefined">
            该练习册现有答案 <strong>{{ plan.impact.workbookAnswerCount }}</strong> 条</li>
          <li v-if="plan.nameChange">任务名还原为 <strong>{{ plan.nameChange.to }}</strong>（重跑后由卷面标题覆盖）</li>
        </ul>
        <ul v-if="plan.warnings.length" class="cr-warnings">
          <li v-for="(w, i) in plan.warnings" :key="i">{{ w }}</li>
        </ul>
      </div>
    </template>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="!enabled || !canSubmit"
        @click="handleConvert"
      >
        确认转换并重新批改
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { convertTaskRoute, getWorksheets, getResources, TASK_ROUTE_CONVERT_ENABLED, TASK_ROUTE_CONVERT_DISABLED_HINT } from '../../../services/apiService'

// ⚠️ 高危功能：转换会清空该作业的题目/判题/已入册错题并连带删掉已发布几何重绘图。
// 2026-09-21 起默认关闭（前端置灰 + 后端 403），恢复需前后端开关同时打开。
const enabled = TASK_ROUTE_CONVERT_ENABLED
const disabledHint = TASK_ROUTE_CONVERT_DISABLED_HINT

// 老师发现「上传时选错批改方式」后的纠正入口。三种方式互转：
//   日常作业（完整 OCR + AI 判题）/ 练习册（预埋答案对题号）/ 答案库（资源答案）。
// 后端口径见 server/utils/taskRoute.js：重练卷禁止转；转非练习册路线时 worksheet_id
// 与 resource_id 必须一起清（否则会被兜底成答案库管线，用同一本练习册再错一次）。
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null }, // { id, name, taskType, worksheetId }
})
const emit = defineEmits(['update:modelValue', 'converted'])

const TARGETS = [
  { value: 'homework', label: '日常作业', desc: 'AI 识别题目并自行判题，不依赖答案库' },
  { value: 'workbook', label: '练习册批改', desc: '按所选练习册的预埋答案按题号批改' },
  { value: 'exam', label: '答案库批改', desc: '按所选答案库资源的答案批改' },
]

const TYPE_LABELS = {
  workbook: '练习册批改',
  exam: '答案库批改',
  homework: '日常作业',
}

const target = ref('homework')
const worksheetId = ref(null)
const resourceId = ref(null)
const worksheets = ref([])
const resources = ref([])
const plan = ref(null)
const planning = ref(false)
const planError = ref('')
const submitting = ref(false)
const loaded = ref(false)

// 三个方向的代价不对称，选目标时先讲清楚（后端 describeRouteRisk 会在预演里再核一次实数）。
const TARGET_NOTES = {
  workbook: '⚠️ 转练习册会丢题干：练习册路线只从卷面识别题号与手写答案，题干改由该册答案库回填，题号对不上的题会落成「第 N 题」占位符。',
  exam: '答案库路线按所选资源的答案批改，题干仍来自卷面识别；请确保这份卷确实是所选资源。',
  homework: '日常作业路线完整识别题干后由 AI 判题，不依赖答案库，是信息量最全的方式。',
}
const targetNote = computed(() => TARGET_NOTES[target.value] || '')

const currentType = computed(() => {
  const t = props.task?.taskType
  return t === 'workbook' || t === 'exam' ? t : 'homework'
})
const currentLabel = computed(() => TYPE_LABELS[currentType.value] || '日常作业')
const currentWorksheetName = computed(() => {
  if (currentType.value !== 'workbook') return ''
  return worksheets.value.find(w => w.id === props.task?.worksheetId)?.name || ''
})

// 目标没选完资源时不发预演请求（后端会直接 400）
const targetReady = computed(() => {
  if (target.value === 'workbook') return !!worksheetId.value
  if (target.value === 'exam') return !!resourceId.value
  return true
})
const canSubmit = computed(() => !!props.task?.id && targetReady.value && !!plan.value && !planning.value && !submitting.value)

const reset = async () => {
  if (!enabled) return // 关闭态不发任何请求（dryRun 也会被后端 403）
  plan.value = null
  planError.value = ''
  worksheetId.value = null
  resourceId.value = null
  // 默认选中「与当前不同」的目标：老师点进来就是要换一种方式
  target.value = currentType.value === 'homework' ? 'workbook' : 'homework'
  if (!loaded.value) {
    loaded.value = true
    try {
      const [ws, rs] = await Promise.all([
        getWorksheets().catch(() => []),
        getResources({ type: 'exam' }).catch(() => []),
      ])
      worksheets.value = Array.isArray(ws) ? ws : []
      resources.value = Array.isArray(rs) ? rs : []
    } catch (e) {
      console.warn('[ConvertRoute] 资源列表加载失败:', e?.message)
    }
  }
}

let planToken = 0
const runPlan = async () => {
  if (!props.task?.id || !targetReady.value) {
    plan.value = null
    return
  }
  const token = ++planToken
  planning.value = true
  planError.value = ''
  try {
    const data = await convertTaskRoute(props.task.id, {
      target: target.value,
      worksheetId: worksheetId.value,
      resourceId: resourceId.value,
      dryRun: true,
    })
    if (token !== planToken) return
    // 后端 noop（已经是该方式）返回 200 + { code:'noop' }
    if (data?.code && data.code !== 'ok') {
      plan.value = null
      planError.value = data.error || '无法转换'
      return
    }
    plan.value = data
  } catch (e) {
    if (token !== planToken) return
    plan.value = null
    planError.value = e?.message || '预演失败'
  } finally {
    if (token === planToken) planning.value = false
  }
}

const handleConvert = async () => {
  if (!enabled || !canSubmit.value) return
  submitting.value = true
  try {
    await convertTaskRoute(props.task.id, {
      target: target.value,
      worksheetId: worksheetId.value,
      resourceId: resourceId.value,
      dryRun: false,
    })
    ElMessage.success('已改批改方式，正在重新识别批改')
    emit('converted')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error('转换失败: ' + (e?.message || '未知错误'))
  } finally {
    submitting.value = false
  }
}

watch(() => props.modelValue, (v) => { if (v) reset() })
watch([target, worksheetId, resourceId], () => { runPlan() })
</script>

<style scoped>
.cr-tip { margin: 0 0 8px; font-size: 13px; color: var(--wb-text-secondary, #5b6472); }
.cr-warn {
  margin: 0 0 14px; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.6;
  background: var(--wb-bg-warning-soft, #fff7e6); color: var(--wb-text-warning, #8a5a00);
}
.cr-targets { display: flex; flex-direction: column; gap: 6px; }
.cr-radio-label { font-weight: 600; }
.cr-radio-desc { display: block; font-size: 12px; color: var(--wb-text-secondary, #5b6472); }
.cr-pick { margin-top: 14px; }
.cr-pick label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
.cr-select { width: 100%; }
.cr-empty { margin: 6px 0 0; font-size: 12px; color: var(--wb-text-secondary, #5b6472); }
.cr-note {
  margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.7;
  background: var(--wb-bg-subtle, #f6f7f9); color: var(--wb-text-secondary, #5b6472);
}
.cr-planning, .cr-error { margin-top: 14px; font-size: 12px; color: var(--wb-text-secondary, #5b6472); }
.cr-error { color: var(--wb-text-danger, #c0392b); }
.cr-impact {
  margin-top: 14px; padding: 10px 12px; border-radius: 6px;
  background: var(--wb-bg-subtle, #f6f7f9); font-size: 12px; line-height: 1.7;
}
.cr-impact-head { margin: 0 0 4px; font-weight: 600; }
.cr-impact ul { margin: 0; padding-left: 18px; }
.cr-warnings { margin-top: 6px !important; color: var(--wb-text-warning, #8a5a00); }
.cr-disabled {
  margin: 0; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.7;
  background: var(--wb-bg-subtle, #f6f7f9); color: var(--wb-text-secondary, #5b6472);
}
</style>
