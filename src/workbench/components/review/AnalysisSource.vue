<template>
  <!--
    题目解析（题干行内小入口）

    背景：解析原先散在两处 —— 答案对照卡片下方的「查看解析」折叠区（长解析限高 280px，
    读的时候要来回滚），以及右上角「编辑」表单里的「AI 解析」输入框（要先进编辑态才看得到，
    还容易被误改）。老师想核对 AI 判得对不对时，得先在满屏 UI 里找解析入口。

    形态（2026-09-21 收敛）：与「原卷」入口完全同构 —— 题干标签行内一个小胶囊按钮
    （图标 + 「解析」），点击弹出对话框看完整解析，走 MathRender 渲染 KaTeX 公式。
    无解析时不渲染按钮（宁可不显示，也不给一个点开是空的入口）。
  -->
  <span v-if="hasAnalysis" class="ana-link">
    <el-tooltip content="查看这道题的完整解析" placement="top" :show-after="200">
      <button type="button" class="ana-link__btn" @click="openViewer">
        <el-icon :size="12"><Reading /></el-icon>
        <span>解析</span>
      </button>
    </el-tooltip>

    <el-dialog
      v-model="viewerVisible"
      title="题目解析"
      width="56%"
      top="8vh"
      append-to-body
      destroy-on-close
    >
      <div class="ana-src__body">
        <MathRender :content="analysis" autoDetect />
      </div>
    </el-dialog>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { Reading } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'

const props = defineProps({
  question: { type: Object, default: null }
})

const store = useReviewStore()
const q = computed(() => props.question || store.currentReviewQuestion)

// 解析文本。trim 后为空视为「无解析」—— 后端偶有写空串的历史数据，
// 空白解析点开只会是一张空白弹窗，不如不显示入口。
const analysis = computed(() => String(q.value?.analysis || '').trim())
const hasAnalysis = computed(() => analysis.value.length > 0)

const viewerVisible = ref(false)
const openViewer = () => { viewerVisible.value = true }

// 切题即收起弹窗：否则翻到下一题时，弹窗还挂着上一题的解析，容易被当成当前题的
// （批改场景里老师是连续翻题的，串题比看不见更危险）。
watch(() => q.value?.id, () => { viewerVisible.value = false })
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
</style>
