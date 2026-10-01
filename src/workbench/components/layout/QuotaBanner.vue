<template>
  <div v-if="degraded.length" class="quota-banner" role="alert">
    <span class="quota-banner__icon">⚠️</span>
    <span class="quota-banner__text">
      系统降级运行：{{ text }}。相关功能将排队或不可用，恢复后本提示自动消失。
    </span>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

// 配额哨兵顶栏横幅（提案 1，2026-10-01）：轮询 GET /api/quota/status，
// 有供应商降级时显示、恢复自动消失。
// 设计约束：拉取失败（如本地后端未启动、登录过期）一律静默隐藏——
// 横幅只在后端明确报告降级时出现，绝不误报。
const POLL_MS = 60 * 1000
const degraded = ref([])
const text = ref('')
let timer = null

const SUPPLIER_LABEL = {
  neon: 'Neon 数据库',
  redis: 'Redis 缓存',
  modelscope: '魔搭视觉通道',
  sensenova: 'SenseNova 视觉通道',
  gemini: 'Gemini 视觉通道',
  bailian: '百炼通道',
  kimi: 'Kimi 通道',
  doubao: '豆包通道'
}

const refresh = async () => {
  try {
    const resp = await fetch('/api/quota/status', { headers: { Accept: 'application/json' } })
    if (!resp.ok) { degraded.value = []; return }
    const payload = await resp.json()
    const list = payload?.data?.degraded || []
    degraded.value = list
    text.value = list
      .map(e => `${SUPPLIER_LABEL[e.supplier] || e.supplier}（已持续 ${e.minutes} 分钟）`)
      .join('、')
  } catch {
    degraded.value = []
  }
}

onMounted(() => { refresh(); timer = setInterval(refresh, POLL_MS) })
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.quota-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-bottom: 1px solid var(--el-color-warning-light-5);
}
.quota-banner__text { flex: 1; }
</style>
