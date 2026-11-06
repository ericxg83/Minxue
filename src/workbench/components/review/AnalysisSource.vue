<template>
  <!--
    题目解析（题干行内小入口）

    背景：解析原先散在两处 —— 答案对照卡片下方的「查看解析」折叠区（长解析限高 280px，
    读的时候要来回滚），以及右上角「编辑」表单里的「AI 解析」输入框（要先进编辑态才看得到，
    还容易被误改）。老师想核对 AI 判得对不对时，得先在满屏 UI 里找解析入口。

    形态（2026-09-21 收敛）：与「原卷」入口完全同构 —— 题干标签行内一个小胶囊按钮
    （图标 + 「解析」），点击弹出对话框看完整解析，走 MathRender 渲染 KaTeX 公式。

    2026-10-15 改为**恒亮**（方案 A，负责人拍板）：练习册/答案库管线的题只有参考答案、
    没有解析（答案库表本就没有 analysis 列，批改管线为省额度跳过引擎），旧口径
    「无解析不渲染按钮」让按钮时有时无，老师误以为这道题「不该有解析」。
    现在：库里没解析时点开现场生成（POST /questions/:id/ensure-analysis），
    生成失败时弹窗内给明确文案，落库后所有视图共享、下次秒开。
    2026-11-06：点「解析」必须顺带把参考答案补齐 —— 后端生成解析后写 answer 并重判，
    或（已有解析但答案为空时）直接从解析文本反填答案；前端同步 store + 清缓存，
    老师一次点击就能接着批改对错，不必再走「AI 重解析」那一整套流程。

    同日入口收敛（负责人拍板）：顶部常驻的「AI 重解析」按钮与此处作用重复，已撤。
    · 本胶囊是唯一主入口，按状态变形：都有 → 「查看解析」；缺任一项 → 「解析并补答案」；
      重算在途 → 显示进度。
    · 低频的「强制重算」降为弹窗内一行次级文字链，emit('recompute') 交给父组件
      handleRecomputeAnswer，仍走 /recompute-answer ⇒ 跨页在途恢复、答案库直查、
      降级提示、结论横幅全部原样保留，零能力损失。
  -->
  <span v-if="q" class="ana-link">
    <el-tooltip :content="entryTip" placement="top" :show-after="200">
      <button type="button" class="ana-link__btn" @click="openViewer">
        <el-icon v-if="recomputing" :size="12" class="is-loading"><Loading /></el-icon>
        <el-icon v-else :size="12"><Reading /></el-icon>
        <span>{{ entryLabel }}</span>
      </button>
    </el-tooltip>

    <el-dialog
      v-model="viewerVisible"
      :title="generating ? (needsFullSolve ? '正在生成解析…' : '正在同步参考答案…') : '题目解析'"
      width="56%"
      top="8vh"
      append-to-body
      destroy-on-close
    >
      <div class="ana-src__body">
        <!-- 生成中：引擎要把题解一遍（难题实测可达 1~2 分钟），必须让老师知道在干什么、大概多久。
             已有解析只做「反填参考答案」时不烧引擎，文案不能说成「正在解答本题」。 -->
        <div v-if="generating" class="ana-src__state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ busyText }}</span>
        </div>
        <!-- 参考答案补齐成功：明确告诉老师可以直接批改对错了，别让他再去找「AI 重解析」 -->
        <el-alert
          v-if="syncNote"
          type="success"
          :title="syncNote"
          :closable="false"
          show-icon
          class="ana-src__alert"
        />
        <!-- 抽不出可核对的答案时必须给下一步动作，不能让老师面对一个「点了没反应」的按钮 -->
        <el-alert
          v-if="syncWarn"
          type="warning"
          :title="syncWarn"
          :closable="false"
          show-icon
          class="ana-src__alert"
        />
        <!-- 引擎答案与旧参考答案打架：后端已自动对齐并重判，这里讲清楚，裁决权仍在老师 -->
        <el-alert
          v-if="mismatchTip"
          type="warning"
          :title="mismatchTip"
          :closable="false"
          show-icon
          class="ana-src__alert"
        />
        <!-- 失败给明确文案（后端已区分「题干为空 / 缺配图 / 作图题 / AI 自述不会 / 引擎不可用」），
             不给一个点了没反应的入口，也不静默 -->
        <el-alert
          v-if="genError"
          type="error"
          :title="genError"
          :closable="false"
          show-icon
          class="ana-src__alert"
        />
        <MathRender v-if="analysis" :content="analysis" autoDetect />
      </div>

      <!-- 低频动作：补图后重看、或觉得参考答案不对时才用，不占常驻位置。
           仍由父组件 handleRecomputeAnswer 走 /recompute-answer，在途恢复等能力不丢。 -->
      <template #footer>
        <div class="ana-src__footer">
          <button
            type="button"
            class="ana-src__recompute"
            :disabled="recomputing"
            @click="requestRecompute"
          >
            <el-icon v-if="recomputing" class="is-loading"><Loading /></el-icon>
            {{ recomputing ? `重新计算中 ${recomputeJob?.elapsed ?? 0}s…` : '重新计算' }}
          </button>
          <span class="ana-src__footer-hint">补图后重看，或觉得参考答案不对时用</span>
        </div>
      </template>
    </el-dialog>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { hasUsableAnalysis } from '../../../utils/reviewDecision'
import { ensureQuestionAnalysis, clearStudentCaches } from '../../../services/apiService'
import { Reading, Loading } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'

const props = defineProps({
  question: { type: Object, default: null }
})
// 强制重算仍由父组件 QuestionDetailPanel.handleRecomputeAnswer 执行：那上面绑着
// 跨页在途恢复 / 答案库直查 / 降级提示 / 结论横幅，本组件只负责把动作递过去。
const emit = defineEmits(['recompute'])

const store = useReviewStore()
const q = computed(() => props.question || store.currentReviewQuestion)

// 解析文本。trim 后为空视为「无解析」—— 后端偶有写空串的历史数据，
// 空白解析点开只会是一张空白弹窗，不如走「现场生成」。
// ⚠️ 判据走共享实现 utils/reviewDecision.hasUsableAnalysis，不要在此另写：
//   本地曾只判 `trim().length > 0`，结果 2026-09-22 重批留下的占位串
//   'AI重批生成 2026-09-22'（引擎解析被脚本丢弃后的占位，全库 210 条）照样点亮按钮，
//   老师点开只看到一句废话。占位串题现在表现为「点开重新生成覆盖」，正是修复路径。
// localAnalysis：本次会话刚生成、还没同步回题目列表对象时的本地兜底（store 按题号
//   id 现查同步，切学生后列表里可能找不到那一行，弹窗不能因此白屏）。
// ⚠️ store 里的解析优先：重新计算会写入新解析，若本地兜底文本仍压在上面，
//   老师会看到「答案更新了、解析还是旧的」。
const localAnalysis = ref('')
const analysis = computed(() => {
  const stored = String(q.value?.analysis || '').trim()
  if (stored && hasUsableAnalysis(q.value)) return stored
  return localAnalysis.value
})
const hasAnalysis = computed(() => analysis.value.length > 0)
const hasAnswer = computed(() => !!String(q.value?.answer || '').trim())

// 重算在途状态存在 store（按题目 ID 建档），切题 / 整页重载回来都还在，
// 主入口与弹窗内次级动作共用这一份，禁止再起组件级 ref。
const recomputeJob = computed(() => store.recomputeJobFor(q.value?.id))
const recomputing = computed(() => !!recomputeJob.value?.loading)

// 入口按状态变形：老师不用再猜「解析」和「AI 重解析」该点哪个。
const entryLabel = computed(() => {
  if (recomputing.value) return `重算中 ${recomputeJob.value?.elapsed ?? 0}s…`
  if (hasAnalysis.value && hasAnswer.value) return '查看解析'
  return '解析并补答案'
})
const entryTip = computed(() => {
  if (recomputing.value) return '这道题正在重新计算，完成后会自动更新参考答案与解析'
  if (hasAnalysis.value && hasAnswer.value) return '查看这道题的完整解析'
  if (!hasAnalysis.value) return '这道题还没有解析，点开由 AI 现场生成并补齐参考答案'
  return '解析已有但参考答案为空，点开自动补齐并重新判对错'
})
const requestRecompute = () => {
  if (recomputing.value) return
  emit('recompute')
}

const viewerVisible = ref(false)
// 按需生成三态（2026-10-15 方案 A）
const generating = ref(false)
const genError = ref('')
const mismatchTip = ref('')
const syncNote = ref('')
const syncWarn = ref('')
// 本次点击是否需要引擎现解（动作前快照）：库里已有解析时只做「从解析反填参考答案」，
// 不烧引擎、文案也不同。⛔ 不能在生成成功后回读 hasAnalysis —— 那时 store 已被改写，
// 判据恒为假（派生状态位必须取动作前快照）。
const needsFullSolve = ref(false)
const busyText = computed(() => needsFullSolve.value
  ? 'AI 正在解答本题并撰写解析，约 10~60 秒，请稍候…'
  : '正在从解析中提取参考答案并重新判对错…')

const openViewer = async () => {
  genError.value = ''
  mismatchTip.value = ''
  syncNote.value = ''
  syncWarn.value = ''
  viewerVisible.value = true
  // 强制重算在途时只展示弹窗，不再并发发一个 ensure-analysis：两条链路会同时
  // 写 answer / analysis 并各自重判，结果谁后落库谁说了算。
  if (recomputing.value) return
  // 只有「解析有 / 答案也有」才是纯查看，秒开不请求。
  // 答案为空时必须再走一次同步：否则老师看到解析末尾写着「答案为 8 − √19」，
  // 参考答案栏却还是空的（历史上报障后只能另找「AI 重解析」，现在已收敛）。
  if (hasAnalysis.value && hasAnswer.value) return
  if (generating.value) return // 防重入（弹窗互斥下理论到不了，双保险）
  needsFullSolve.value = !hasAnalysis.value
  await generate()
}

const generate = async () => {
  generating.value = true
  const questionId = q.value?.id
  const studentId = store.currentStudent?.id
  // 动作前快照：调用成功后 store 里的 answer 已被改写，事后再判「原来是不是空」恒为假
  const answerWasEmpty = !String(q.value?.answer || '').trim()
  try {
    const resp = await ensureQuestionAnalysis(questionId)
    if (resp?.analysis) {
      localAnalysis.value = resp.analysis
      // 同步回 store 的题目对象（按 id 现查）：解析 + 参考答案 + 判定 + 异常标注一次到位，
      // 否则库里写了、页面还显示空答案和旧的「缺配图」警告。
      store.applyGeneratedAnalysis(questionId, resp)
    }
    if (resp?.answer_synced && resp?.answer) {
      syncNote.value = `参考答案已自动补齐：${String(resp.answer).slice(0, 40)}，现在可以直接批改对错了`
      // ⛔ 徽标/列表缓存与 store 不是同一份数据：写库成功后必须一并失效，
      //   否则侧栏「待处理」角标会滞留到 TTL 到期（口径同 handleRecomputeAnswer）。
      if (studentId) clearStudentCaches(studentId)
    } else if (answerWasEmpty && !resp?.answer) {
      // 解析里没有可核对的答案标记 / 被闸拦下：给出可行动诊断，别让按钮看起来坏了
      syncWarn.value = '解析已就绪，但没能从解析里提取出可核对的参考答案。请直接点参考答案栏手填，或点下方「重新计算」'
    }
    if (resp?.answer_mismatch) {
      mismatchTip.value = `AI 解出的答案（${resp.engine_answer}）与原参考答案（${resp.existing_answer}）不一致，已自动更新参考答案并重新判对错，请核对`
    }
    if (!resp?.analysis && !resp?.answer_synced) {
      genError.value = '生成完成但没有返回解析内容，请稍后重试'
    }
  } catch (err) {
    // 后端错误体挂在 err.message（httpCore 已把服务端 message 提为错误信息），
    // 文案本身已是「可行动诊断」（补题干 / 补配图 / 稍后重试），直接展示不另加工。
    genError.value = err?.message || '生成解析失败，请稍后重试'
  } finally {
    generating.value = false
  }
}

// 重算收尾后清掉上一轮「生成解析失败 / 抽不出答案」的旧提示：答案已经补上了，
// 弹窗里还挂着过时的错误条会自相矛盾（结论由面板的常驻横幅与 toast 承接）。
watch(() => recomputeJob.value?.loading, (loading, prev) => {
  if (prev === true && loading === false) {
    genError.value = ''
    syncWarn.value = ''
    syncNote.value = ''
    mismatchTip.value = ''
  }
})

// 切题即收起弹窗并复位生成态：否则翻到下一题时，弹窗还挂着上一题的解析，容易被当成当前题的
// （批改场景里老师是连续翻题的，串题比看不见更危险）。
watch(() => q.value?.id, () => {
  viewerVisible.value = false
  generating.value = false
  genError.value = ''
  mismatchTip.value = ''
  syncNote.value = ''
  syncWarn.value = ''
  needsFullSolve.value = false
  localAnalysis.value = ''
})
</script>

<style scoped>
/* 行内小入口：与 OriginalPaperSource 的「原卷」按钮同一套尺寸/配色，视觉上成对出现 */
.ana-link {
  display: inline-flex;
  align-items: center;
}
.ana-link__btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs, 4px);
  background: #fff;
  color: var(--wb-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.ana-link__btn:hover {
  color: var(--wb-primary);
  border-color: var(--wb-primary);
  background: var(--wb-primary-mist, rgba(99, 102, 241, 0.06));
}
.ana-link__btn:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 1px;
}

/* ── 解析弹窗 ── */
.ana-src__body {
  max-height: 62vh;
  overflow-y: auto;
  padding: 14px 16px;
  background: var(--wb-bg-hover, #f7f8fa);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm, 6px);
  color: var(--wb-text);
  font-size: var(--wb-fs-body, 14px);
  line-height: 1.8;
}
/* 生成中状态：居中一行（旋转图标 + 进度说明） */
.ana-src__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 0;
  color: var(--wb-text-tertiary, #6b7280);
  font-size: 13px;
}
.ana-src__alert {
  margin-bottom: 10px;
}

/* 弹窗底部的低频动作：文字链形态，不与主入口抢视觉层级 */
.ana-src__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
}
.ana-src__recompute {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--wb-primary);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.ana-src__recompute:hover:not(:disabled) {
  text-decoration: underline;
}
.ana-src__recompute:disabled {
  color: var(--wb-text-tertiary, #9ca3af);
  cursor: default;
}
.ana-src__footer-hint {
  color: var(--wb-text-tertiary, #9ca3af);
  font-size: 11px;
}
</style>
