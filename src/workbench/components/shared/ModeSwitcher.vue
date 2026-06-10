<template>
  <div class="mode-switcher">
    <el-radio-group v-model="currentMode" size="default" @change="handleModeChange">
      <el-radio-button value="paper">
        <el-icon><Document /></el-icon>
        试卷入库
      </el-radio-button>
      <el-radio-button value="wrongbook">
        <el-icon><EditPen /></el-icon>
        错题编辑
      </el-radio-button>
    </el-radio-group>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { Document, EditPen } from '@element-plus/icons-vue'

const workbenchStore = useWorkbenchStore()

const currentMode = computed({
  get: () => workbenchStore.currentMode,
  set: (val) => workbenchStore.setMode(val)
})

const handleModeChange = (mode) => {
  workbenchStore.setMode(mode)
}
</script>

<style scoped>
.mode-switcher {
  display: flex;
  align-items: center;
}

.mode-switcher :deep(.el-radio-button) {
  margin-right: 0;
}

.mode-switcher :deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
}

.mode-switcher :deep(.el-icon) {
  font-size: 16px;
}
</style>
