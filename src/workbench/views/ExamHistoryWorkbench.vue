<template>
  <div class="placeholder-page">
    <div class="placeholder-card">
      <el-icon :size="64"><Clock /></el-icon>
      <h2>组卷历史</h2>
      <p class="placeholder-subtitle">功能开发中，敬请期待</p>
      <div class="placeholder-divider"></div>
      <div class="placeholder-features">
        <div class="feature-item">
          <el-icon><Document /></el-icon>
          <span>历史试卷回顾</span>
        </div>
        <div class="feature-item">
          <el-icon><TrendCharts /></el-icon>
          <span>成绩趋势分析</span>
        </div>
        <div class="feature-item">
          <el-icon><FolderOpened /></el-icon>
          <span>试卷归档管理</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Clock, Document, TrendCharts, FolderOpened } from '@element-plus/icons-vue'
</script>

<style scoped>
.placeholder-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}

.placeholder-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 60px 80px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  color: #c0c4cc;
}

.placeholder-card h2 {
  margin: 0;
  font-size: 22px;
  color: #303133;
}

.placeholder-subtitle {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.placeholder-divider {
  width: 100%;
  height: 1px;
  background: #ebeef5;
  margin: 8px 0;
}

.placeholder-features {
  display: flex;
  gap: 32px;
  margin-top: 8px;
}

.feature-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.feature-item .el-icon {
  font-size: 28px;
  color: #409eff;
}
</style>
