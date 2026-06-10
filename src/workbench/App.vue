<template>
  <div id="workbench-app">
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  // 屏幕宽度检测：小于1200px跳转到移动端
  if (window.innerWidth < 1200) {
    window.location.href = '/'
  }
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
</style>
