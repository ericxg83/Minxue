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
    「无解析不渲染按钮（宁可不显示，也不给一个点开是空的入口）」让按钮时有时无，
    老师误以为这道题「不该有解析」。现在：库里没解析时点开现场生成
    （POST /questions/:id/ensure-analysis，后端只写解析列、绝不动参考答案与判题结论，
    生成失败时弹窗内给明确文案——「点开是空的入口」这一顾虑由错误态承接），
    落库后所有视图共享、下次秒开。
  -->
  <span v-if="q" class="ana-link">
    <el-tooltip :content="hasAnalysis ? '查看这道题的完整解析' : '这道题还没有解析，点开由 AI 现场生成'" placement="top" :show-after="200">
      <button type="button" class="ana-link__btn" @click="openViewer">
        <el-icon :size="12"><Reading /></el-icon>
        <span>解析</span>
      </button>
    </el-tooltip>

    <el-dialog
      v-model="viewerVisible"
      :title="generating ? '正在生成解析…' : '题目解析'"
      width="56%"
      top="8vh"
      append-to-body
      destroy-on-close
    >
      <div class="ana-src__body">
        <!-- 生成中：引擎要把题解一遍（难题实测可达 1~2 分钟），必须让老师知道在干什么、大概多久 -->
        <div v-if="generating" class="ana-src__state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>AI 正在解答本题并撰写解析，约 10~60 秒，请稍候…</span>
        </div>
        <template v-else>
          <!-- 引擎解析与参考答案打架时不吞矛盾：提示条讲清楚，裁决权在老师 -->
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
        </template>
      </div>
    </el-dialog>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { hasUsableAnalysis } from '../../../utils/reviewDecision'
import { ensureQuestionAnalysis } from '../../../services/apiService'
import { Reading, Loading } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'

const props = defineProps({
  question: { type: Object, default: null }
})

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
const localAnalysis = ref('')
const analysis = computed(() => {
  if (localAnalysis.value) return localAnalysis.value
  const t = String(q.value?.analysis || '').trim()
  return hasUsableAnalysis(q.value) ? t : ''
})
const hasAnalysis = computed(() => analysis.value.length > 0)

const viewerVisible = ref(false)
// 按需生成三态（2026-10-15 方案 A）
const generating = ref(false)
const genError = ref('')
const mismatchTip = ref('')

const openViewer = async () => {
  genError.value = ''
  mismatchTip.value = ''
  viewerVisible.value = true
  // 库里已有可用解析：直接看（秒开路径，与旧版行为一致）
  if (hasAnalysis.value) return
  if (generating.value) return // 防重入（弹窗互斥下理论到不了，双保险）
  await generate()
}

const generate = async () => {
  generating.value = true
  try {
    const resp = await ensureQuestionAnalysis(q.value.id)
    if (resp?.analysis) {
      localAnalysis.value = resp.analysis
      // 同步回 store 的题目对象（按 id 现查）：其它视图与下次打开共享同一份
      store.applyGeneratedAnalysis(q.value.id, resp.analysis)
      if (resp.answer_mismatch) {
        mismatchTip.value = `注意：AI 解析得出的答案（${resp.engine_answer}）与当前参考答案（${resp.existing_answer}）不一致。参考答案以答案库 / 原判定为准，请自行核对`
      }
    } else {
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

// 切题即收起弹窗并复位生成态：否则翻到下一题时，弹窗还挂着上一题的解析，容易被当成当前题的
// （批改场景里老师是连续翻题的，串题比看不见更危险）。
watch(() => q.value?.id, () => {
  viewerVisible.value = false
  generating.value = false
  genError.value = ''
  mismatchTip.value = ''
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
</style>
