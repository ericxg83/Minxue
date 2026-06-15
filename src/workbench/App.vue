<template>
  <div id="workbench-app">
    <TopNavBar />
    <div class="workbench-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import TopNavBar from './components/layout/TopNavBar.vue'
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
  display: flex;
  flex-direction: column;
}

.workbench-content {
  flex: 1;
  overflow: hidden;
}
</style>
