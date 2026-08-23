<template>
  <div id="workbench-app">
    <TopNavBar />
    <div class="workbench-content">
      <router-view />
    </div>
    <div v-if="showDesktopNotice" class="desktop-notice" role="status">
      <div class="desktop-notice__panel">
        <div class="desktop-notice__eyebrow">教师工作台</div>
        <h2>建议使用电脑处理</h2>
        <p>批改、错题整理和讲义备课需要较宽的操作空间。请在电脑端打开当前页面，处理效率更高。</p>
        <el-button type="primary" @click="showDesktopNotice = false">继续查看</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
const showDesktopNotice = ref(false)
const updateViewportNotice = () => { showDesktopNotice.value = Boolean(route.meta.requiresPC && window.innerWidth < 1200) }
onMounted(() => { updateViewportNotice(); window.addEventListener("resize", updateViewportNotice) })
onUnmounted(() => window.removeEventListener("resize", updateViewportNotice))
import TopNavBar from './components/layout/TopNavBar.vue'
</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  height: 100%;
}

.desktop-notice { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: flex-start; justify-content: center; padding: 72px 20px 20px; background: rgba(15, 23, 42, 0.28); pointer-events: none; }
.desktop-notice__panel { width: min(420px, 100%); padding: 24px; border: 1px solid var(--wb-border); border-radius: 12px; background: var(--wb-bg-card); box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16); pointer-events: auto; }
.desktop-notice__eyebrow { color: var(--wb-primary); font-size: 12px; font-weight: 600; }
.desktop-notice h2 { margin: 8px 0; color: var(--wb-text); font-size: 20px; }
.desktop-notice p { margin: 0 0 18px; color: var(--wb-text-secondary); font-size: 13px; line-height: 1.7; }

#workbench-app {
  min-height: 100vh;
  background: var(--wb-bg);
}


.workbench-content {
  min-height: 100vh;
  padding-left: 232px;
  padding-top: 64px;
}
@media (max-width: 900px) { .workbench-content { padding-left: 68px; } }
</style>