<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <el-select
        v-model="selectedStudentId"
        placeholder="选择学生"
        size="default"
        style="width: 200px"
        @change="onStudentChange"
      >
        <el-option
          v-for="s in store.students"
          :key="s.id"
          :label="s.name"
          :value="s.id"
        />
      </el-select>

      <el-select
        v-model="selectedTaskId"
        placeholder="选择试卷"
        size="default"
        style="width: 300px; margin-left: 16px"
        :disabled="!store.currentStudent"
        @change="onTaskChange"
      >
        <el-option-group v-if="store.pendingTasks.length > 0" label="待复核">
          <el-option
            v-for="t in store.pendingTasks"
            :key="t.id"
            :label="t.original_name || '未命名试卷'"
            :value="t.id"
          />
        </el-option-group>
        <el-option-group v-if="store.reviewedTasks.length > 0" label="已复核">
          <el-option
            v-for="t in store.reviewedTasks"
            :key="t.id"
            :label="`✓ ${t.original_name || '未命名试卷'}`"
            :value="t.id"
          >
            <span class="task-option">
              <span>✓ {{ t.original_name || '未命名试卷' }}</span>
              <!-- 「自动复核」角标：这份卷是系统批改完自己过掉的，老师没点过 -->
              <span v-if="t._autoReviewed" class="task-option-auto">自动复核</span>
            </span>
          </el-option>
        </el-option-group>
        <!-- 已布置·学生未交卷的重练卷：可查看卷面（只读），但不算待复核 -->
        <el-option-group v-if="store.issuedPapers.length > 0" label="已布置（待学生作答）">
          <el-option
            v-for="t in store.issuedPapers"
            :key="t.id"
            :label="`○ ${t.original_name || '未命名练习卷'}`"
            :value="t.id"
          />
        </el-option-group>
      </el-select>

      <!-- 闸1 欠账全局入口（2026-09-27）：跨学生的「缺元素未入册」待补清单。
           P2 分层不拦卷，但欠账必须常驻可见——补全元素保存即自动入册。
           [2026-09-28 待补入上顶栏] 常驻可点（零欠账=确认无欠账的窗口，不再收进「更多」置灰），
           有欠账时 warning 高亮 + 计数，驱动老师逐题处理。 -->
      <el-tooltip
        :content="pendingGateTip"
        placement="bottom"
      >
        <el-button
          size="default"
          plain
          :type="store.pendingGateTotal > 0 ? 'warning' : 'default'"
          style="margin-left: 16px"
          :loading="pendingGateLoading"
          @click="openPendingGateDialog"
        >
          {{ store.pendingGateTotal > 0 ? `⚠ 待补入 ${store.pendingGateTotal}` : '待补入 0' }}
        </el-button>
      </el-tooltip>
    </div>

    <!-- [header 三合一] 中部：进度 + 本卷缺元素欠账 + 归档态（原上下文条，去重后并入本行） -->
    <div v-if="store.currentTask && store.allQuestions.length > 0 && store.currentPaperReviewable" class="top-bar-center">
      <span class="tb-progress">
        <span class="tb-progress__text">已确认 {{ store.reviewProgress.confirmed }}/{{ store.reviewProgress.total }}</span>
        <el-progress :percentage="reviewProgressPercent" :stroke-width="6" :show-text="false" status="success" class="tb-progress__bar" />
        <span class="tb-progress__pct">{{ reviewProgressPercent }}%</span>
      </span>
      <button v-if="store.reviewProgress.unconfirmed > 0" class="tb-todo" type="button"
        title="切到左栏「待处理」并跳到第一道未确认题" @click="store.jumpToFirstUnconfirmed()">还差 {{ store.reviewProgress.unconfirmed }} 题</button>
      <el-popover v-if="store.gateSkippedQuestions.length > 0" placement="bottom" :width="380" trigger="click" popper-class="gate-skip-popover">
        <template #reference>
          <button class="tb-gate" type="button" title="这些错题因缺图/缺选项等未入册，补全后保存即自动入册">⚠ 缺元素 {{ store.gateSkippedQuestions.length }}</button>
        </template>
        <div class="gate-skip-pop">
          <div class="gate-skip-tip">补全元素并保存后会自动加入错题本；也可在左栏点「⚠」标签逐题处理。</div>
          <div v-for="{ q, idx } in store.gateSkippedQuestions" :key="q.id" class="gate-skip-item" @click="jumpToGateSkip(idx)">
            <div class="gate-skip-head">
              <span class="gate-skip-no">第 {{ q._paperLabel || (idx + 1) }} 题</span>
              <span class="gate-skip-codes">{{ gateIssueLabels(q).join('、') }}</span>
            </div>
            <div class="gate-skip-stem">{{ (q.content || q.parent_stem || '').slice(0, 46) || '（无题干文本）' }}</div>
          </div>
        </div>
      </el-popover>
      <el-tag v-if="archiveState === 'published'" type="success" size="small" effect="plain" class="tb-archive">
        <el-icon><Check /></el-icon><span style="margin-left:4px">已发布</span>
      </el-tag>
      <el-tag v-else-if="archiveState === 'draft'" type="warning" size="small" effect="plain" class="tb-archive">
        <el-icon><Document /></el-icon><span style="margin-left:4px">草稿</span>
      </el-tag>
    </div>

    <div class="top-bar-right">
      <!-- 重练卷不可复核：不展示任何复核动作（完成批改/留底/撤销都拿不到可信数据） -->
      <el-tag v-if="!store.currentPaperReviewable" type="info" effect="plain" class="blocked-tag">
        该卷{{ blockedPaperHint }}，暂无可复核内容
      </el-tag>
      <!-- [2026-09-27 视觉降噪] 低频动作（撤销 / 改批改方式 / 重新处理 / 留底）收进「更多」。
           [2026-09-28 菜单瘦身] 待补入清单已上顶栏常驻，「更多」只剩三类：会话开关 / 沉淀归档 / 低频改卷动作。
           [P0-2 主按钮矩阵 2026-09-27] 页面唯一 primary 随场景切换：
           批改进行中 → primary 是右栏判定区，「完成复核」降为 plain 次要（带 n/m）、「下一份」降为 tertiary；
           全卷已确认 → 「完成复核」升级为唯一 primary（success 实心），「下一份」升为 plain secondary。 -->
      <template v-if="store.currentPaperReviewable">
        <el-dropdown trigger="click" @command="handleMoreCommand">
          <el-button size="default" :disabled="moreBusy">
            ⋯ 更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- [P0-1 判定即过] 会话级开关（默认开）：判定落库后自动跳下一未确认题，出问题可即时关闭退回手动模式 -->
              <el-dropdown-item command="toggle-auto-advance">
                {{ store.autoAdvanceEnabled ? '✓ ' : '' }}判定后自动跳下一题
              </el-dropdown-item>
              <!-- [B2-3 快捷键速查] 与 ? 键打开同一浮层 -->
              <el-dropdown-item command="shortcuts" divided>快捷键速查（?）</el-dropdown-item>
              <el-dropdown-item command="archive" divided :disabled="!canArchive || archiveLoading">留底为答案库</el-dropdown-item>
              <!-- [P0-4 撤销诚实化] 文案必须如实：只回退本页显示，不反向写库。
                   换卷时撤销栈已由 store.selectTask 清空，不存在跨卷误回退。 -->
              <el-dropdown-item command="undo" :disabled="!store.canUndo">回退上次判定（仅本页显示）</el-dropdown-item>
              <el-dropdown-item v-if="canConvertRoute" command="convert" divided>改批改方式</el-dropdown-item>
              <el-dropdown-item command="retry" :disabled="!store.currentTask || retryLoading">重新处理</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <!-- [B2-5] disabled 时解释差哪几题，老师不用去左栏数 -->
        <el-tooltip :content="completeDisabledReason" placement="bottom" :disabled="!completeDisabledReason">
          <span style="display: inline-flex">
            <el-button size="default"
              :type="allConfirmed ? 'success' : 'default'"
              :plain="!allConfirmed"
              :disabled="store.reviewProgress.confirmed !== store.reviewProgress.total || store.reviewProgress.total === 0"
              @click="handleComplete">
              ✓ {{ completeButtonLabel }}
            </el-button>
          </span>
        </el-tooltip>
        <el-button size="default"
          :type="allConfirmed ? 'primary' : 'default'"
          plain
          :disabled="!canNextTask"
          @click="goNextTask">
          ▶ 下一份
        </el-button>
      </template>
    </div>
  </div>

  <!-- 改批改方式（练习册 / 答案库 / 日常作业 互转）—— dryRun 影响面预览 → 确认转换。
       转换成功后由 handleRouteConverted 清空当前复核上下文并跳下一份。 -->
  <ConvertRouteDialog
    v-model="convertRouteVisible"
    :task="convertRouteTask"
    @converted="handleRouteConverted"
  />

  <!-- 错题处理决策门禁 -->
  <el-dialog v-model="store.wrongGateVisible" title="请确认错题处理方式" width="640px" :close-on-click-modal="false">
    <div class="wrong-gate-tip">以下题目已判定为错误，但尚未进入错题本。</div>
    <div class="wrong-gate-note">
      你亲手标「错」的题系统会立即尝试入册，列在这里说明<strong>入册失败</strong>（多因题目元素不完整）；
      AI 判错且你还没逐题确认的题，需要你选择是否加入。
    </div>
    <ul class="wrong-gate-list">
      <li v-for="item in store.wrongGateList" :key="item.questionId" class="wrong-gate-item">
        <div class="wrong-gate-info">
          <span class="wrong-gate-no">第 {{ item.index + 1 }} 题</span>
          <span v-if="store.isQuestionInBook(item.questionId)" class="wrong-gate-badge done">已加入错题本</span>
          <span v-else-if="item.reason === 'incomplete'" class="wrong-gate-badge warn">
            {{ item.source === 'manual' ? '已判错 · 自动入册失败：' : '题目元素不完整：' }}{{ item.issues.join('、') }}
          </span>
          <span v-else class="wrong-gate-badge warn">{{ item.source === 'manual' ? '已判错 · 未成功入册' : '等待处理决定' }}</span>
          <el-select v-if="item.showSkipReasons" v-model="item.skipReason" class="wrong-gate-reason" size="small" placeholder="选择不加入原因" @change="handleSkipBook(item)">
            <el-option v-for="reason in skipReasonOptions" :key="reason.value" :label="reason.label" :value="reason.value" />
          </el-select>
        </div>
        <div class="wrong-gate-actions">
          <template v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'complete'">
            <el-button size="small" type="primary" :loading="item.adding" @click="handleAddToBook(item)">加入错题本</el-button>
            <el-button size="small" :loading="item.skipping" @click="showSkipReasons(item)">本次不加入</el-button>
          </template>
          <el-button v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'incomplete'" size="small" type="warning" @click="store.focusQuestionForEdit(item.questionId)">去编辑或排除</el-button>
        </div>
      </li>
    </ul>
    <template #footer>
      <el-button @click="store.wrongGateVisible = false">稍后处理</el-button>
      <el-button type="success" :disabled="!store.paperAutoComplete.canAutoComplete" @click="handleGateComplete">完成复核</el-button>
    </template>
  </el-dialog>

  <!-- 待补入清单（2026-09-27）：闸1 系统侧自动放行且仍未入册的错题，按学生分组。
       缺元素题点「去补全」直接开编辑面板，保存后后端自动补入；
       低置信题点「去定位」就地拍板。 -->
  <el-dialog v-model="pendingGateVisible" title="待补入错题本的题（自动放行留痕）" width="720px">
    <div class="pending-gate-tip">
      这些错题被记为「本次不加入」（系统放行，非老师否决）。缺元素的补全并保存后会自动加入错题本；
      低置信的按口径需老师拍板（标错即强入，标对即翻篇）。点按钮直接定位到题。
    </div>
    <div v-if="pendingGateLoading" class="pending-gate-loading">加载中…</div>
    <template v-else>
      <div v-for="g in store.pendingGateGroups" :key="g.studentId" class="pending-gate-group">
        <div class="pending-gate-student">{{ g.studentName }}<span class="pending-gate-count">{{ g.items.length }} 题</span></div>
        <div v-for="it in g.items" :key="it.questionId" class="pending-gate-item">
          <div class="pending-gate-info">
            <span class="pending-gate-no">{{ it.taskName }} · 第 {{ it.questionNumber || '?' }}{{ it.subNo ? `(${it.subNo})` : '' }} 题</span>
            <span class="pending-gate-codes">{{ gateItemLabel(it) }}</span>
            <div class="pending-gate-stem">{{ it.content || '（无题干文本）' }}</div>
          </div>
          <el-button
            size="small"
            :type="it.kind === 'missing_element' ? 'warning' : 'primary'"
            plain
            :loading="gateJumpLoading === it.questionId"
            @click="goGateItem(it)"
          >{{ it.kind === 'missing_element' ? '去补全' : '去定位' }}</el-button>
        </div>
      </div>
      <el-empty v-if="store.pendingGateTotal === 0" description="没有待补入的题" :image-size="60" />
    </template>
    <template #footer>
      <!-- 有框却无图的缺图题（多因配图框异步补写错过裁图窗口）：先试自动补裁（零模型成本、判非图形自动丢弃） -->
      <el-button
        v-if="missingFigureCount > 0"
        type="primary"
        plain
        :loading="recropLoading"
        @click="handleFigureRecrop"
      >尝试自动补裁 {{ missingFigureCount }} 道缺图题</el-button>
      <!-- 元素已齐但尚未入册（多因补图脚本直接写库绕过编辑保存）：一键补入跑后端兜底清扫 -->
      <el-button
        v-if="pendingRequeueCount > 0"
        type="success"
        :loading="gateSweepLoading"
        @click="handleGateSweep"
      >一键补入已补全的 {{ pendingRequeueCount }} 题</el-button>
      <el-button @click="pendingGateVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Check, Document } from '@element-plus/icons-vue'
import { useReviewStore } from '../../stores/reviewStore'
import { retryTask, saveTaskAsAnswerKey, TASK_ROUTE_CONVERT_ENABLED } from '../../../services/apiService'
import ConvertRouteDialog from './ConvertRouteDialog.vue'
import { WRONG_BOOK_SKIP_REASONS } from '../../../utils/reviewDecision'
import { RETRY_PAPER_STATE } from '../../utils/retryPaperState'
import { checkQuestionCompleteness } from '../../../utils/questionCompleteness.js'

const store = useReviewStore()
const route = useRoute()
const router = useRouter()

// 「改批改方式」：上传时选错批改方式的纠正入口（练习册 / 答案库 / 日常作业 互转）。
// 2026-09-22 产品拍板开放（P1「一键转日常批改重批」）：
//   - 只对普通作业复核显示（重练卷题目行共用原作业，后端直接拒绝，不展示入口）；
//   - 转换会清空题目/判题/错题并重跑，对话框内 dryRun 预演影响面，确认后才执行；
//   - 转换成功 = 当前复核上下文失效（试卷被清空重建并入队），需重新加载任务并跳到下一份。
const routeConvertEnabled = TASK_ROUTE_CONVERT_ENABLED
const convertRouteVisible = ref(false)
const convertRouteLoading = ref(false)
// 当前复核卷是否允许改批改方式：普通作业（非重练卷）且卷可复核。
// task_type 来自后端 /api/tasks/student/:id 返回的原始字段（workbook / exam / homework）。
const canConvertRoute = computed(() => {
  const t = store.currentTask
  if (!t?.id) return false
  if (!store.currentPaperReviewable) return false
  if (!routeConvertEnabled) return false
  if (t.generated_exam_id) return false
  return true
})
const openConvertRoute = () => {
  if (!store.currentTask?.id) return
  convertRouteVisible.value = true
}
// 对话框期望 { id, name, taskType, worksheetId } —— 与 GradeCenterWorkbench 传入的 selectedTask 同构。
const convertRouteTask = computed(() => {
  const t = store.currentTask
  if (!t?.id) return null
  return {
    id: t.id,
    name: t.original_name || '未命名作业',
    taskType: t.task_type || 'homework',
    worksheetId: t.worksheet_id || null,
  }
})
// 转换成功后的收尾：试卷已被清空重建并重新入队（status → pending/processing），
// 当前正在复核的题目全部是旧数据 → 重新拉取任务列表并自动跳到下一份待复核卷。
const handleRouteConverted = async () => {
  convertRouteVisible.value = false
  if (store.currentStudent?.id) {
    await store.loadStudentTasks(store.currentStudent.id)
    await store.autoSelectPendingTask()
  }
}

// ReviewWorkspace 提供的 archiveState：hidden / draft / published
//   draft → 首次复核（resource 还是 draft），点"完成复核"会触发留底确认
//   published → 已留底，直接提交
const archiveState = inject('archiveState', ref('hidden'))

// [header 三合一] 进度 + 本卷缺元素欠账（原 ReviewWorkspace 上下文条，并入单条 header）
const reviewProgressPercent = computed(() => {
  const total = Number(store.reviewProgress.total) || 0
  const count = Number(store.reviewProgress.confirmed) || 0
  return total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0
})
const GATE_ISSUE_LABELS = {
  [store.COMPLETENESS_CODES.missing_figure]: '缺配图',
  [store.COMPLETENESS_CODES.missing_options]: '缺选项',
  [store.COMPLETENESS_CODES.missing_answer]: '缺答案',
  [store.COMPLETENESS_CODES.invalid_type]: '题型未定',
  [store.COMPLETENESS_CODES.stem_only]: '疑似题干行',
}
const gateIssueLabels = (q) => {
  const { codes } = checkQuestionCompleteness(q)
  return codes.map(c => GATE_ISSUE_LABELS[c] || c)
}
const jumpToGateSkip = (idx) => {
  const q = store.allQuestions[idx]
  if (q) store.focusQuestionForEdit(q.id)
}

const selectedStudentId = ref('')
const selectedTaskId = ref('')
const retryLoading = ref(false)
const skipReasonOptions = WRONG_BOOK_SKIP_REASONS

// 当 store 中 currentStudent 变化时同步下拉框（immediate：remount 时 store 为单例，
// 需立即回填本地选择，避免下拉显示空「选择学生」）
watch(() => store.currentStudent?.id, (id) => {
  selectedStudentId.value = id || ''
}, { immediate: true })

// 人工标「错」但强入错题本失败 → 及时告诉老师，别等最后复核门禁才发现。
// 队列由 store 累积，这里逐条弹出后清空（同一时刻可能连续标了几题）。
watch(() => store.wrongBookNotices.length, (len) => {
  if (!len) return
  for (const notice of store.wrongBookNotices) {
    const no = notice.index >= 0 ? `第 ${notice.index + 1} 题` : '该题'
    ElMessage({
      type: 'warning',
      message: `${no}已判为错误，但${notice.message}。请补全后重试，或在完成复核时处理。`,
      duration: 5000,
      showClose: true
    })
  }
  store.clearWrongBookNotices()
})

// 逐题改到最后一道时触发的「自动完成复核」落库失败 → 必须让老师看到失败。
// 这条路径没有按钮点击事件可以 catch，故由 store 抛到队列、这里消费。
watch(() => store.saveError, (err) => {
  if (!err) return
  ElMessage.error(`试卷状态保存失败：${err.message}。题目判定已保留，请重新点击「${store.reviewConfig.completeLabel}」重试。`)
  store.saveError = null
})

// [2026-09-20 方案A] 零人工项自动完成复核成功 → 轻提示（store 只记录，这里弹提示）。
// 进卷时整卷无需老师处理（无待判/未判定/处理中、无未入册错题门禁）即自动完成，
// 老师看到提示后可翻看刚复核完的卷面、留底或点「下一份」。
watch(() => store.autoReviewNotice, (notice) => {
  if (!notice) return
  ElMessage.success(`「${notice.taskName}」无需人工处理，已自动完成复核`)
  store.autoReviewNotice = null
})

// [2026-09-23 P2] 门禁分层：系统侧缺项（缺图/缺选项/题型非法）被自动记为
// 「本次不加入错题本」，不再拦卷。必须给老师一条可见提示——否则老师只会发现
// "这几题怎么没进错题本"，无法区分是系统故障还是老师自己点过（铁律 #11 不许静默）。
const GATE_ISSUE_LABEL = {
  missing_figure: '缺配图',
  missing_options: '缺选项',
  invalid_type: '题型未定',
}
watch(() => store.autoGateResolved, (info) => {
  if (!info) return
  const parts = (info.issues || []).map(i => GATE_ISSUE_LABEL[i] || i)
  const detail = parts.length ? `（${parts.join('、')}）` : ''
  ElMessage.warning(
    `${info.count} 道错题因题目元素缺失${detail}未加入错题本，已自动记录「本次不加入」；本题已标在页面上方「缺元素未入册」，补全后可用顶栏「待补入」清单找回`
  )
  store.clearAutoGateResolved()
})

// 当 store 中 currentTask 变化时同步下拉框
watch(() => store.currentTask?.id, (id) => {
  selectedTaskId.value = id || ''
}, { immediate: true })

const canNextTask = computed(() => {
  if (store.pendingTasks.length === 0) return false
  if (!store.currentTask) return false
  // 复核完后 currentTask.status='reviewed' 已不在 pendingTasks 中，
  // 但老师仍可手动点"下一份"跳到下一份待复核试卷。
  if (store.currentTask.status === 'reviewed') return true
  const idx = store.pendingTasks.findIndex(t => t.id === store.currentTask.id)
  return idx >= 0 && idx < store.pendingTasks.length - 1
})

// 「更多」下拉：命令分发到原有 handler，动作本身零改动
const moreBusy = computed(() => retryLoading.value || archiveLoading.value)

// [P0-2 主按钮矩阵 2026-09-27] 全卷已确认 = 派生态（口径与 questionConfirmationMap 同源），
// 驱动顶栏「完成复核 / 下一份」的主次切换；右栏完成态用的是同一口径（QuestionDetailPanel.allConfirmed）。
const allConfirmed = computed(() =>
  store.reviewProgress.total > 0 &&
  store.reviewProgress.confirmed === store.reviewProgress.total
)
const completeButtonLabel = computed(() => {
  const label = store.reviewConfig.completeLabel
  return allConfirmed.value
    ? `${label} · 就绪`
    : `${label} (${store.reviewProgress.confirmed}/${store.reviewProgress.total})`
})

// [B2-5] 完成复核 disabled 的原因：还差几题、差的是前几道（最多列 3 道，其余用 …）
const completeDisabledReason = computed(() => {
  const { confirmed, total, unconfirmed } = store.reviewProgress
  if (total === 0 || confirmed === total) return ''
  const missing = []
  store.allQuestions.forEach((q, i) => {
    if (missing.length < 3 && store.questionConfirmationMap[q.id] === false) {
      missing.push(i + 1)
    }
  })
  return `还差 ${unconfirmed} 题（第 ${missing.join('、')}${unconfirmed > missing.length ? '…' : ''} 题），逐题确认后即可完成`
})

const handleMoreCommand = (cmd) => {
  if (cmd === 'undo') handleUndoLast()
  else if (cmd === 'toggle-auto-advance') {
    // [P0-1 判定即过] 会话级开关（默认开）：判定落库后自动跳下一未确认题，出问题可即时关闭退回手动模式
    store.autoAdvanceEnabled = !store.autoAdvanceEnabled
    ElMessage.info(store.autoAdvanceEnabled
      ? '已开启：判定后自动跳到下一道待确认题'
      : '已关闭：判定后停留当前题，用「下一题」或 → 手动前进')
  }
  else if (cmd === 'convert') openConvertRoute()
  else if (cmd === 'retry') handleRetryTask()
  else if (cmd === 'archive') handleArchive()
  // [B2-3] 快捷键速查浮层（与 ? 键同源）
  else if (cmd === 'shortcuts') store.shortcutsVisible = true
}

// [2026-09-28 待补入上顶栏] 常驻按钮 tooltip：有欠账报数量，零欠账说明是确认窗口
const pendingGateTip = computed(() =>
  store.pendingGateTotal > 0
    ? `${store.pendingGateTotal} 道错题因缺元素/低置信未入错题本，点击逐题处理`
    : '当前无待补入错题（点击查看跨学生清单，需先选择学生）'
)

// 重练卷不可复核时顶栏的提示文案（与 ReviewWorkspace 的空态说明保持一致）
const blockedPaperHint = computed(() =>
  store.currentPaperState === RETRY_PAPER_STATE.GRADING ? 'AI 正在识别与判题' : '学生还没有提交答卷'
)

// 「留底为答案库」按钮启用条件：仅 exam 任务 + 已完成复核（status='reviewed'）+ 当前 task 有 resource_id。
// 留底是把 task 答案沉淀进答案库资源的动作，复核完成才有可信答案可沉淀。
// reviewAllDone 时 currentTask 已被清空，store.lastArchivableTask 会 fallback 到当前学生最新一份已复核 exam 任务，
// 保证老师"刚复核完"的那份还能操作。
const canArchive = computed(() => !!store.lastArchivableTask)
const archiveLoading = ref(false)

const onStudentChange = async (studentId) => {
  const student = store.students.find(s => s.id === studentId)
  if (!student) return
  store.setCurrentStudent(student)
  await store.loadStudentTasks(studentId)
  // 仅自动打开「待复核」试卷；无则展示空状态（已复核试卷可手动从下拉查看）
  const target = await store.autoSelectPendingTask()
  selectedTaskId.value = target?.id || ''
}

const onTaskChange = async (taskId) => {
  const task = store.studentTasks.find(t => t.id === taskId)
  if (!task) return
  await store.selectTask(task)
}

const goNextTask = async () => {
  const next = store.nextTask()
  if (next) {
    selectedTaskId.value = next.id
    await store.selectTask(next)
  } else {
    ElMessage.info('已处理完所有待复核试卷')
  }
}

// [B2-1] 上一份（Shift+T / 完成态按钮的对称导航）：与 goNextTask 同口径反向
const goPrevTask = async () => {
  const prev = store.prevTask()
  if (prev) {
    selectedTaskId.value = prev.id
    await store.selectTask(prev)
  } else {
    ElMessage.info('这已经是第一份待复核试卷')
  }
}

// 完成批改
const handleComplete = async () => {
  // 门禁 → 完成复核 → 自动跳下一份
  // 先等在途复核写入落库并按库中错题本重算，避免"已入册还让老师再确认一次"
  const list = await store.prepareWrongGate()
  if (list.length > 0) {
    store.openWrongGate(list)
    return
  }
  await doComplete()
}

// 真正执行完成复核：store 不再自动跳下一份，让老师选择「留底为答案库」或「下一份」。
const doComplete = async () => {
  try {
    await store.completeTaskReview()
    ElMessage.success('试卷复核完成，已保存')
    const tip = store.pendingTasks.length > 0
      ? '可在「更多」菜单留底为答案库，或点「下一份」继续处理'
      : '可在「更多」菜单留底为答案库；当前学生已无待复核试卷'
    ElMessage.info(tip)
  } catch (err) {
    // 落库失败时绝不能提示成功：completeTaskReview 现在会把服务端错误原样抛出，
    // 这里把真实原因展示给老师（过去一律吞掉 → 界面说成功、库里没写）。
    console.error('保存失败:', err)
    const detail = err?.response?.data?.error || err?.message || ''
    ElMessage.error(detail ? `保存失败：${detail}` : '保存失败，请重试')
  }
}

// [P0-1 完成引导 2026-09-27] 右栏完成态按钮经 ReviewWorkspace 转发到这里：
// 复用同一 handleComplete（含错题门禁）与 goNextTask（维护下拉选中态），不复制业务逻辑。
defineExpose({ handleComplete, goNextTask, goPrevTask })

// 错题清单弹窗中「加入错题本」
const handleAddToBook = async (item) => {
  item.adding = true
  try {
    const result = await store.addQuestionToBook(item.questionId)
    const added = result?.added?.length || 0
    const skipped = result?.skipped?.length || 0
    const already = result?.alreadyExists?.length || 0
    if (added > 0) {
      ElMessage.success(skipped > 0 ? `已加入 ${added} 题，${skipped} 题信息不完整被跳过` : '已加入错题本')
    } else if (skipped > 0) {
      ElMessage.warning('题目信息不完整，无法加入错题本，请先补全题干/答案/选项')
    } else if (already > 0) {
      // 库里已有记录（人工标错时后端已强入），这里只是把界面状态对齐，不算异常
      ElMessage.info('这道题已在错题本中，无需重复添加')
    } else {
      ElMessage.info('未产生变更，请稍后重试')
    }
  } catch (error) {
    ElMessage.error(error.message || '加入错题本失败，请重试')
  } finally {
    item.adding = false
  }
}

const showSkipReasons = (item) => {
  item.showSkipReasons = !item.showSkipReasons
  if (!item.showSkipReasons) item.skipReason = ''
}

const handleSkipBook = async (item) => {
  if (!item.skipReason || item.skipping) return
  item.skipping = true
  try {
    await store.markWrongNoBook(item.questionId, item.skipReason)
    item.showSkipReasons = false
    ElMessage.success('已记录本次不加入错题本')
  } catch (error) {
    item.skipReason = ''
    ElMessage.error(error.message || '保存处理决定失败，请重试')
  } finally {
    item.skipping = false
  }
}

const handleGateComplete = async () => {
  // 进到这里说明弹窗里已无待拍板项（弹窗是闸1 的最后一道口），
  // 与卷级 L0 判据同源校验：还有未判出题时不放行，避免"点完弹窗"绕过 L2。
  if (!store.paperAutoComplete.canAutoComplete) return
  store.wrongGateVisible = false
  await doComplete()
}

// ── 待补入清单（2026-09-27）：闸1 欠账全局入口 ──
const pendingGateVisible = ref(false)
const pendingGateLoading = ref(false)
const gateJumpLoading = ref('')
const GATE_CODE_LABEL = {
  missing_figure: '缺配图',
  missing_options: '缺选项',
  missing_answer: '缺答案',
  invalid_type: '题型未定',
  stem_only: '疑似题干行',
}
const gateCodeLabel = (c) => GATE_CODE_LABEL[c] || c
// 按欠账类型给描述：缺元素（去补全即自动入册）/ 低置信（需拍板）/
// 元素已齐待补入（下次保存或重判链路自动入册，也可手动标错立即强入）
const gateItemLabel = (it) => {
  if (it.kind === 'missing_element') return (it.missingCodes || []).map(gateCodeLabel).join('、')
  if (it.kind === 'low_confidence') return `低置信 ${it.confidence ?? '?'} · 需拍板`
  return '元素已齐 · 待自动补入'
}

const withGateLoading = async (fn) => {
  pendingGateLoading.value = true
  try { await fn() } finally { pendingGateLoading.value = false }
}
const openPendingGateDialog = () => {
  pendingGateVisible.value = true
  withGateLoading(() => store.loadGatePending())
}

// 元素已齐、但因补图走脚本写库而绕过 PUT 补入钩子的题 → 一键补入（后端幂等清扫）
const gateSweepLoading = ref(false)
const pendingRequeueCount = computed(() =>
  store.pendingGateGroups.reduce((n, g) =>
    n + g.items.filter(it => it.kind === 'pending_requeue').length, 0)
)
const handleGateSweep = async () => {
  gateSweepLoading.value = true
  try {
    const r = await store.runGateSweep()
    if (r.added > 0) ElMessage.success(`已补入 ${r.added} 题到错题本`)
    else if (r.complete > 0) ElMessage.warning(`${r.complete} 题元素已齐但未能自动入册（多为低置信需拍板），请逐题处理`)
    else ElMessage.info('没有可一键补入的题')
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e?.message || '补入失败，请重试')
  } finally {
    gateSweepLoading.value = false
  }
}

// 缺图题（有合格框却无图）→ 自动补裁（后端重跑生产裁图，像素收紧判非图形自动丢弃）
const recropLoading = ref(false)
const missingFigureCount = computed(() =>
  store.pendingGateGroups.reduce((n, g) =>
    n + g.items.filter(it => (it.missingCodes || []).includes('missing_figure')).length, 0)
)
const handleFigureRecrop = async () => {
  recropLoading.value = true
  try {
    const r = await store.runFigureRecrop()
    const rescued = r.cropped + (r.inherited || 0)
    if (rescued > 0) ElMessage.success(`自动补回 ${r.cropped} 张裁图 + ${r.inherited || 0} 道继承兄弟配图，能入册的已自动入错题本`)
    else if (r.scanned > 0) ElMessage.warning(`${r.scanned} 道缺图题的框经收紧判定均不是干净图形（多为压在文字/手写上），未补裁以免误导，请人工补图或走视觉重定位`)
    else ElMessage.info('没有可自动补裁的缺图题')
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e?.message || '补裁失败，请重试')
  } finally {
    recropLoading.value = false
  }
}

// 点按钮：复用 loadTaskById（反查学生 → 切学生 → 选卷，与 Dashboard 深链同口径）。
// 题目数据由 selectTask 重拉，gate_auto_skipped 标记随后端返回，不依赖清单旧快照。
// 缺元素题直接打开编辑面板（补图入口）；低置信/待补入题只定位，由老师就地拍板。
const goGateItem = async (it) => {
  gateJumpLoading.value = it.questionId
  try {
    const ok = await store.loadTaskById(it.taskId)
    if (!ok) {
      ElMessage.error('未找到这份作业（可能已被删除）')
      return
    }
    if (String(store.currentStudent?.id || '') !== String(it.studentId)) {
      ElMessage.error('作业归属学生与清单不一致，请刷新清单后重试')
      return
    }
    selectedTaskId.value = it.taskId
    pendingGateVisible.value = false
    const idx = store.allQuestions.findIndex(q => q.id === it.questionId)
    if (idx >= 0) {
      if (it.kind === 'missing_element') {
        store.focusQuestionForEdit(it.questionId)
      } else {
        store.jumpToQuestion(idx)
      }
    } else {
      ElMessage.warning('该题不在当前卷的题目列表中（可能已被删除或排除），请在原卷中确认')
    }
  } finally {
    gateJumpLoading.value = ''
  }
}

// 进入工作台即拉一次欠账总数（常驻角标）；切学生后重拉，
// 保证刚补完的题不从清单里"复活"（补入是后端异步链路，以库为准）。
// 首页引导深链（2026-09-27）：Dashboard「错题待补入」行带 ?gate=1 进页，
// 自动打开待补入清单弹窗并回写 URL（刷新不重复弹，不拦常规进卷）。
onMounted(() => {
  store.loadGatePending()
  if (String(route.query.gate || '') === '1') {
    openPendingGateDialog()
    router.replace({ query: { ...route.query, gate: undefined } })
  }
})
watch(() => store.currentStudent?.id, () => { store.loadGatePending() })

// 「补全即补入」成功（QuestionDetailPanel 保存后回传）→ 当场告知并刷新清单。
watch(() => store.gateRequeueNotice, (n) => {
  if (!n) return
  ElMessage.success('题目元素已补全，该题已自动加入错题本')
  store.clearGateRequeueNotice()
  store.loadGatePending()
})

// 「📌 留底为答案库」手动按钮：调 save-as-answer-key 把当前 task 的答案沉淀到资源。
// 与"完成复核"解耦——后者只更新 task.status，前者显式触发答案库覆写。
// task 来源用 store.lastArchivableTask：复核中拿 currentTask；reviewAllDone 时 fallback 到最新已复核任务。
// 复用 task.original_name 作为资源名，老师可在弹窗里修改。
// resource_id 允许为 null：server 在 save-as-answer-key 内部会自动新建 resource_type='exam' 资源。
const handleArchive = async () => {
  const t = store.lastArchivableTask
  if (!t?.id) return
  let name = t.original_name || '未命名试卷'
  try {
    const { value } = await ElMessageBox.prompt(
      '将当前这份试卷的答案写入答案库，可修改资源名称。',
      '📌 留底为答案库',
      {
        inputValue: name,
        inputPlaceholder: '资源名称',
        confirmButtonText: '确认留底',
        cancelButtonText: '取消',
        inputValidator: (val) => (val && val.trim() ? true : '资源名不能为空'),
      }
    )
    name = (value || '').trim() || name
  } catch {
    return
  }
  archiveLoading.value = true
  try {
    await saveTaskAsAnswerKey(t.id, {
      name,
      subject: t.subject || null,
      grade: t.grade || null,
    })
    ElMessage.success(`已留底：${name}`)
  } catch (err) {
    const msg = err?.response?.data?.error || err?.message || '留底失败，请重试'
    ElMessage.error(msg)
  } finally {
    archiveLoading.value = false
  }
}

// 回退最近一次人工判定（仅回退前端内存状态，不反向写库）
// [P0-4 撤销诚实化] toast 明示「数据库记录未变」，避免老师误以为错题本等已落库事实被回退。
const handleUndoLast = () => {
  const prev = store.undoLastReview()
  if (prev) {
    ElMessage({ type: 'info', message: '已回退显示；该题在数据库中的记录未变，重新判定会覆盖', duration: 2600 })
  }
}

// 重新处理当前试卷
const handleRetryTask = async () => {
  if (!store.currentTask?.id) return
  try {
    await ElMessageBox.confirm(
      '重新处理会清空当前识别结果并重新走 OCR + 批改流程，是否继续？',
      '确认重新处理',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  retryLoading.value = true
  try {
    await retryTask(store.currentTask.id)
    ElMessage.success('已重新提交处理队列，请稍后刷新或重新选择该试卷')
    if (store.currentStudent?.id) {
      await store.loadStudentTasks(store.currentStudent.id)
    }
  } catch (err) {
    console.error('重新处理失败:', err)
    ElMessage.error('重新处理失败: ' + (err.message || '未知错误'))
  } finally {
    retryLoading.value = false
  }
}
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.top-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.top-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 置信阈值 chip 已删（2026-09-27 视觉降噪）：阈值语义由左栏 slider 独自承载 */

.back-btn {
  font-size: 13px;
  color: var(--wb-text-secondary) !important;
}
.exam-mode-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--wb-text);
  margin-left: 4px;
}

/* ── 错题拦截清单弹窗 ── */
/* ── 待补入清单（2026-09-27）：闸1 欠账全局入口弹窗 ── */
.pending-gate-tip {
  font-size: 13px;
  color: var(--wb-text-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}
.pending-gate-loading {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--wb-text-tertiary);
}
.pending-gate-group { margin-bottom: 14px; }
.pending-gate-student {
  font-size: 13px;
  font-weight: 700;
  color: var(--wb-text);
  padding: 4px 0;
  border-bottom: 1px solid var(--wb-border, #e2e8f0);
}
.pending-gate-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-warning);
}
.pending-gate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 4px;
}
.pending-gate-info { min-width: 0; }
.pending-gate-no { font-size: 12px; font-weight: 600; color: var(--wb-text); }
.pending-gate-codes { margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--wb-danger, #DC2626); }
.pending-gate-stem {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wrong-gate-tip {
  font-size: 13px;
  color: var(--wb-text-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}
.wrong-gate-note {
  margin-bottom: 14px;
  padding: 9px 11px;
  color: var(--wb-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  background: var(--wb-warning-soft);
  border-left: 3px solid var(--wb-warning);
  border-radius: var(--wb-radius-xs);
}.wrong-gate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
}
.wrong-gate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  margin-bottom: 8px;
  background: var(--wb-bg-hover);
}
.wrong-gate-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.wrong-gate-no {
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text);
}
.wrong-gate-badge {
  font-size: 12px;
  line-height: 1.5;
}
.wrong-gate-badge.warn {
  color: var(--wb-warning);
}
.wrong-gate-badge.done {
  color: var(--wb-success);
  font-weight: 600;
}
.wrong-gate-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.wrong-gate-reason { width: 220px; margin-top: 4px; }
@media (max-width: 640px) {
  .wrong-gate-item { align-items: stretch; flex-direction: column; }
  .wrong-gate-actions { justify-content: flex-end; }
  .wrong-gate-reason { width: 100%; }
}


.top-bar { height: 58px; padding: 0 20px; background: var(--wb-bg-card); border-bottom: 1px solid var(--wb-border); }
.top-bar-left { gap: 8px; min-width: 0; }
.top-bar-left :deep(.el-select:first-child) { width: 150px !important; }
.top-bar-left :deep(.el-select:nth-child(2)) { width: 260px !important; margin-left: 0 !important; }
.top-bar-right { gap: 6px; }
.top-bar-right :deep(.el-button) { min-height: 30px; padding: 6px 10px; border-radius: 6px; font-size: 12px; }
.top-bar-right :deep(.el-button--success) { color: #fff; background: var(--wb-success); border-color: var(--wb-success); }
.top-bar-right :deep(.el-button--primary) { color: #fff; background: var(--wb-primary); border-color: var(--wb-primary); }
.top-bar-right :deep(.el-button--warning) { color: var(--wb-warning); background: var(--wb-warning-soft); border-color: var(--wb-warning-soft); }
/* ── [header 三合一] 中部进度/欠账/归档（复用现有 token，不新增视觉变量） ── */
.top-bar-center { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tb-progress { display: flex; align-items: center; gap: 8px; color: var(--wb-text-secondary); font-size: 12px; }
.tb-progress__bar { width: 120px; }
.tb-progress__pct { color: var(--wb-text); font-weight: 650; font-variant-numeric: tabular-nums; }
.tb-todo {
  padding: 2px 10px; border: 1px solid var(--wb-warning-soft); border-radius: 999px;
  background: var(--wb-warning-soft); color: var(--wb-warning); font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.tb-gate {
  padding: 2px 10px; border: 1px solid var(--wb-danger-soft, #FEE2E2); border-radius: 999px;
  background: var(--wb-danger-soft, #FEE2E2); color: var(--wb-danger, #DC2626); font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.tb-archive { display: inline-flex; align-items: center; }
.gate-skip-pop .gate-skip-tip { font-size: 12px; color: var(--wb-text-tertiary); padding-bottom: 6px; }
.gate-skip-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.gate-skip-item:hover { background: var(--wb-bg-hover, #F3F4F6); }
.gate-skip-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.gate-skip-no { font-weight: 700; color: var(--wb-text); }
.gate-skip-codes { color: var(--wb-danger, #DC2626); font-weight: 600; }
.gate-skip-stem { font-size: 12px; color: var(--wb-text-tertiary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1280px) { .tb-progress__bar { display: none; } }
/* ── 重练卷不可复核时的顶栏提示 ──
   替代原复核动作按钮：这批卷没有学生答卷，任何「完成批改 / 留底」都没有可信数据可写 */
.blocked-tag {
  height: 28px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
}

@media (max-width: 1200px) { .top-bar-right :deep(.el-button) { padding: 6px 8px; } }
@media (max-width: 900px) { .top-bar { align-items: flex-start; height: auto; min-height: 58px; flex-direction: column; gap: 8px; padding: 10px 14px; } .top-bar-right { width: 100%; overflow-x: auto; padding-bottom: 2px; } }

/* ── 试卷下拉里的「自动复核」角标 ── */
.task-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task-option-auto {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 3px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 11px;
  line-height: 16px;
}
</style>
