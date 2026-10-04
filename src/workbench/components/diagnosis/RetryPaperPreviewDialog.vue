<template>
  <el-dialog
    v-model="visible"
    class="retry-preview"
    width="720px"
    :close-on-click-modal="false"
    append-to-body
    @open="load"
  >
    <template #header>
      <div class="rp-head">
        <strong class="rp-head__title">{{ dialogTitle }}</strong>
        <span class="rp-head__sub">{{ dialogSubtitle }}</span>
      </div>
    </template>

    <!-- ── 加载 / 失败 / 空 ─────────────────────────────────── -->
    <div v-if="loading" class="rp-state">正在读取这名学生的错题…</div>
    <div v-else-if="loadError" class="rp-state is-error">
      <span>{{ loadError }}</span>
      <el-button text type="primary" @click="load">重试</el-button>
    </div>
    <div v-else-if="!scopedItems.length" class="rp-state">
      没有符合条件的错题了 —— 这些题可能刚被标记为「完全掌握」。
    </div>

    <!-- ── 题目列表 ─────────────────────────────────────────── -->
    <template v-else>
      <div class="rp-bar">
        <label class="rp-bar__check">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected"
            @change="toggleAll"
          />
          <span>全选</span>
        </label>
        <button type="button" class="rp-bar__link" @click="selectedKeys = []">清空</button>
        <span class="rp-bar__count">
          已选 <b>{{ selectedItems.length }}</b> / {{ scopedItems.length }} 道
          <em v-if="overCap">· 一次 {{ selectedItems.length }} 道偏多，可先取消一些</em>
        </span>
      </div>

      <ul class="rp-list">
        <li v-for="item in scopedItems" :key="item.key" :class="{ 'is-off': !selectedKeySet.has(item.key) }">
          <label class="rp-row">
            <input
              type="checkbox"
              :checked="selectedKeySet.has(item.key)"
              @change="toggleOne(item.key)"
            />
            <span class="rp-row__meta">
              <b v-if="item.questionId">{{ item.questionId.slice(0, 6) }}</b>
              <b v-else class="is-warn">未关联</b>
              <em v-if="item.errorCount > 1">错 {{ item.errorCount }} 次</em>
            </span>
            <span class="rp-row__stem">{{ item.stem }}</span>
            <span class="rp-row__tags">
              <i v-if="item.subject">{{ item.subject }}</i>
              <i v-if="item.errorType" :class="['is-error', toneOf(item.errorType)]">{{ item.errorType }}</i>
              <i v-if="!item.questionId" class="is-warn">练习册自包含题</i>
            </span>
          </label>
        </li>
      </ul>

      <p v-if="droppedCount" class="rp-note">
        其中 {{ droppedCount }} 道是练习册自包含错题，尚未关联到题库题目，进不了重练批改链路 —— 已自动排除。
      </p>
    </template>

    <template #footer>
      <div class="rp-foot">
        <span class="rp-foot__hint">{{ footHint }}</span>
        <el-button :disabled="creating" @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!canSubmit" @click="submit">
          生成重练卷<template v-if="selectedItems.length">（{{ selectedItems.length }}）</template>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 专项重练卷 · 预览弹窗（r142）
 *
 * 起因（负责人 2026-10-05 原话）：从学习诊断页看到「49 道计算错误」后，
 * 点「去错题清单」跳到学生档案页 —— 「没有很顺手的页面，体验很差」。
 * 理想是像移动端错题本那样：勾题 → 预览 → 我确定就好。
 *
 * ⛔ 为什么不新造管线：本组件只做「预筛 + 勾选 + 确认」这一段，
 *    组卷与出纸**原样复用** PC 错题清单（WrongBookCenterRedesign.createRetry）
 *    已在用的那三件套，两条链路收敛到同一个出口：
 *      createGeneratedExam + buildExamBaseName/buildExamNameWithSeq + exportWrongBookPDF
 *    （后端路由、命名口径、PDF 引擎、二维码 URL 都只此一份，禁在这里另写一份。）
 *
 * scope 三种（对应诊断页三条动作）：
 *   error-cause 按错因（error_type 全等）
 *   repeat     反复错（error_count >= 2）
 *   basic      已答对 1 次（lifecycle_status ∈ review_1 / review_2）
 *   ——「只放行 lifecycle=new」是**重练自动选题**的口径；
 *      这里是人手挑题组卷，老师明确勾的就是要练的，不受该限制。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getWrongQuestionsByStudent, createGeneratedExam, getGeneratedExamsByStudent, getStudentById } from '../../../services/apiService'
import { exportWrongBookPDF } from '../../../utils/wrongBookPdfExporter'
import { buildRetryTaskUrl } from '../../../utils/retryTaskUrl'
import { buildExamBaseName, buildExamNameWithSeq } from '../../../domain/examNaming'
import { normalizeWrongItems, inScope, pickDefaults, errorTypeTone, toExamQuestionIds } from './retryPaperScope'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  studentId: { type: String, default: '' },
  // { kind: 'error-cause' | 'repeat' | 'basic', errorType?: string }
  scope: { type: Object, default: null }
})
const emit = defineEmits(['created', 'update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const loadError = ref('')
const creating = ref(false)
const studentName = ref('')
const picked = ref([]) // 归一化后的候选题目
const selectedKeys = ref([])

/** 组卷引擎与周报再测卷同口径（RETRY_CAP 30）；只提示不拦 —— 老师明确勾的就是要练的 */
const overCap = computed(() => selectedItems.value.length > 30)

const dialogTitle = computed(() => {
  if (props.scope?.kind === 'error-cause') return `专项重练卷 · ${props.scope.errorType || '同类错因'}`
  if (props.scope?.kind === 'repeat') return '专项重练卷 · 反复出错'
  if (props.scope?.kind === 'basic') return '重练卷 · 基本掌握再验证'
  return '专项重练卷'
})

const dialogSubtitle = computed(() => {
  const who = studentName.value || '这名学生'
  const n = picked.value.length
  return n ? `${who} · 命中 ${n} 道，默认全选，可取消不练的` : `${who} · 正在筛题`
})

const footHint = computed(() => {
  if (loading.value) return '读取中…'
  if (!selectedItems.value.length) return '至少选 1 道才能组卷'
  return '确认后直接生成卷子并下载 PDF，学生扫码即可作答'
})

// 预筛/ 勾选 / 排除的语义全在retryPaperScope.js（纯函数，可真跑单测）
const scopedItems = computed(() => picked.value.filter((it) => inScope(it, props.scope)))
const selectedKeySet = computed(() => new Set(selectedKeys.value))
const selectedItems = computed(() => scopedItems.value.filter((it) => selectedKeySet.value.has(it.key)))
const allSelected = computed(() => scopedItems.value.length > 0 && selectedItems.value.length === scopedItems.value.length)
const someSelected = computed(() => selectedItems.value.length > 0 && !allSelected.value)
// 预筛命中但组不进卷的题数（练习册自包含错题）—— 必须让老师看见，口径才不失真
const droppedCount = computed(() => toExamQuestionIds(scopedItems.value).dropped)
const canSubmit = computed(() => toExamQuestionIds(selectedItems.value).questionIds.length > 0 && !creating.value)

async function load() {
  if (!props.studentId) {
    loadError.value = '没有拿到学生信息，请先在页头选择学生'
    picked.value = []
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const list = await getWrongQuestionsByStudent(props.studentId, false)
    picked.value = normalizeWrongItems(list)
    selectedKeys.value = pickDefaults(picked.value, props.scope)
    // 学生名用于卷面标题与 PDF 文件名；取不到不阻断（回落到「学生」）
    if (!studentName.value) {
      const s = await getStudentById(props.studentId).catch(() => null)
      studentName.value = s?.name || ''
    }
  } catch (e) {
    loadError.value = `错题读取失败：${e.message || '网络异常'}`
    picked.value = []
  } finally {
    loading.value = false
  }
}

function toggleAll(e) {
  selectedKeys.value = e.target.checked ? scopedItems.value.map((it) => it.key) : []
}
function toggleOne(key) {
  const next = new Set(selectedKeySet.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = [...next]
}

async function submit() {
  const { questionIds, dropped } = toExamQuestionIds(selectedItems.value)
  if (!questionIds.length) {
    ElMessage.warning('所选题里没有能组卷的题目（练习册自包含错题尚未关联到题库题目）')
    return
  }
  creating.value = true
  try {
    const existing = await getGeneratedExamsByStudent(props.studentId, false).catch(() => [])
    // 卷名基名从候选题取学科（错题行已归一化出 subject，与错题清单同一份数据）
    const baseName = buildExamBaseName(selectedItems.value)
    const examName = buildExamNameWithSeq(baseName, existing, props.studentId)
    const exam = await createGeneratedExam({ student_id: props.studentId, name: examName, question_ids: questionIds })
    if (!exam?.id) throw new Error('创建重练卷失败')
    // PDF 失败不回滚组卷：卷已入「最近重练」，老师可从历史重打
    let paperMessage = ''
    try {
      const paper = await exportWrongBookPDF({
        studentId: props.studentId,
        studentName: studentName.value || '学生',
        questionIds,
        title: `${studentName.value || '学生'} - ${examName}`,
        showAnswers: false,
        qrContent: buildRetryTaskUrl(exam.id)
      })
      paperMessage = paper?.message || ''
    } catch (paperError) {
      console.error('[RetryPaperPreview] 重练卷 PDF 生成失败:', paperError?.message || paperError)
      paperMessage = `PDF 生成失败：${paperError?.message || '未知错误'}（卷已建好，可从学生档案「最近重练」重打）`
    }
    const dropped = selectedItems.value.length - validItems.length
    ElMessage.success(`已生成重练卷「${exam.name}」，共 ${questionIds.length} 题${dropped ? `（${dropped} 道未关联题目已剔除）` : ''}${paperMessage ? ' · ' + paperMessage : ''}`)
    emit('created', exam)
    visible.value = false
  } catch (error) {
    ElMessage.error(error.message || '创建重练卷失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

// 换学生/换 scope 时重置勾选，避免把上一位的选中带到这一位
watch(() => [props.modelValue, props.studentId, props.scope?.kind, props.scope?.errorType], () => {
  if (props.modelValue) {
    selectedKeys.value = []
    studentName.value = ''
  }
})
</script>

<style scoped>
.rp-head{display:flex;flex-direction:column;gap:3px}
.rp-head__title{font-size:16px;font-weight:650;color:var(--wb-text)}
.rp-head__sub{font-size:12px;color:var(--wb-text-secondary)}
.rp-state{display:flex;align-items:center;justify-content:center;gap:10px;padding:48px 0;color:var(--wb-text-secondary);font-size:13px}
.rp-state.is-error{color:var(--wb-status-danger-fg)}
.rp-bar{display:flex;align-items:center;gap:14px;padding:0 2px 10px;border-bottom:1px solid var(--wb-border-light)}
.rp-bar__check,.rp-bar__link{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
.rp-bar__link{border:0;background:none;padding:0;color:var(--wb-status-info-fg);font-weight:550}
.rp-bar__count{margin-left:auto;color:var(--wb-text-secondary);font-size:12px}
.rp-bar__count b{color:var(--wb-text);font-size:14px;font-variant-numeric:tabular-nums}
.rp-bar__count em{font-style:normal;margin-left:6px;color:var(--wb-status-warning-fg)}
.rp-list{max-height:46vh;overflow-y:auto;margin:0;padding:0;list-style:none}
.rp-list li{border-bottom:1px solid var(--wb-border-light)}
.rp-list li:last-child{border-bottom:0}
.rp-list li.is-off{opacity:.5}
.rp-row{display:grid;grid-template-columns:auto 88px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 2px;cursor:pointer}
.rp-row:hover{background:var(--wb-bg-hover)}
.rp-row__meta{display:flex;flex-direction:column;gap:2px;color:var(--wb-text-tertiary);font-size:10px;font-variant-numeric:tabular-nums}
.rp-row__meta b{font-weight:550;color:var(--wb-text-secondary)}
.rp-row__meta b.is-warn{color:var(--wb-status-warning-fg)}
.rp-row__stem{color:var(--wb-text);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-row__tags{display:flex;gap:6px;flex-shrink:0}
.rp-row__tags i{padding:1px 7px;border-radius:var(--wb-radius-pill);background:var(--wb-bg-elevated);color:var(--wb-text-secondary);font-size:10px;font-style:normal}
.rp-row__tags i.is-error{background:var(--wb-status-danger-bg);color:var(--wb-status-danger-fg)}
.rp-row__tags i.is-warning{background:var(--wb-status-warning-bg);color:var(--wb-status-warning-fg)}
.rp-row__tags i.is-primary{background:var(--wb-status-info-bg);color:var(--wb-status-info-fg)}
.rp-row__tags i.is-warn{background:var(--wb-status-warning-bg);color:var(--wb-status-warning-fg)}
.rp-note{margin:10px 0 0;padding:8px 12px;border-radius:var(--wb-radius-sm);background:var(--wb-status-warning-bg);color:var(--wb-text-secondary);font-size:11px;line-height:1.6}
.rp-foot{display:flex;align-items:center;gap:10px}
.rp-foot__hint{margin-right:auto;color:var(--wb-text-tertiary);font-size:11px}
</style>
