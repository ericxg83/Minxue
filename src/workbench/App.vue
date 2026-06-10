<template>
  <div id="workbench-app">
    <template v-if="isPC">
      <router-view />
    </template>
    <template v-else>
      <div class="mobile-hint">
        <h2>️ 请使用电脑浏览器访问</h2>
        <p>试卷入库 PC 工作台需要屏幕宽度 ≥ 1200px</p>
        <p>当前宽度：{{ windowWidth }}px</p>
        <a href="/" class="back-link">返回移动端</a>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const windowWidth = ref(window.innerWidth)
const isPC = ref(window.innerWidth >= 1200)

const handleResize = () => {
  windowWidth.value = window.innerWidth
  isPC.value = window.innerWidth >= 1200
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  height: 100%;
}

#workbench-app {
  height: 100vh;
  overflow: hidden;
}

.mobile-hint {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  text-align: center;
  padding: 20px;
}

.mobile-hint h2 {
  font-size: 24px;
  color: #333;
  margin-bottom: 16px;
}

.mobile-hint p {
  font-size: 14px;
  color: #666;
  margin: 4px 0;
}

.back-link {
  display: inline-block;
  margin-top: 24px;
  padding: 10px 24px;
  background: #2563eb;
  color: #fff;
  border-radius: 8px;
  text-decoration: none;
  font-size: 14px;
}
</style>
