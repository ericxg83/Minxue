<template>
  <div class="exam-import-workbench">
    <div class="main-layout">
      <!-- 第一栏：主内容区 -->
      <section class="placeholder-main">
        <div class="placeholder-card">
          <div class="placeholder-card__icon">
            <el-icon :size="64"><Files /></el-icon>
          </div>
          <div class="placeholder-card__title">试卷入库</div>
          <div class="placeholder-card__subtitle">正在开发中</div>
          <div class="placeholder-card__divider"></div>
          <div class="placeholder-card__features">
            <div class="feature-item">
              <el-icon><Upload /></el-icon>
              <span>试卷上传</span>
            </div>
            <div class="feature-item">
              <el-icon><View /></el-icon>
              <span>OCR识别</span>
            </div>
            <div class="feature-item">
              <el-icon><EditPen /></el-icon>
              <span>自动切题</span>
            </div>
            <div class="feature-item">
              <el-icon><FolderOpened /></el-icon>
              <span>题库入库</span>
            </div>
            <div class="feature-item">
              <el-icon><Connection /></el-icon>
              <span>智能分类</span>
            </div>
          </div>
          <div class="placeholder-card__footer">敬请期待</div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { Files, Upload, View, FolderOpened, Connection, EditPen } from '@element-plus/icons-vue'
</script>

<style scoped>
/* ===== CSS Variables ===== */
.exam-import-workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Placeholder Main ===== */
.placeholder-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.placeholder-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  padding: 48px 64px;
  text-align: center;
  max-width: 480px;
  width: 100%;
}

.placeholder-card__icon {
  color: #C9CDD4;
  margin-bottom: 20px;
}

.placeholder-card__title {
  font-size: 20px;
  font-weight: 600;
  color: #1D2129;
  margin-bottom: 8px;
}

.placeholder-card__subtitle {
  font-size: 15px;
  color: #86909C;
  margin-bottom: 24px;
}

.placeholder-card__divider {
  width: 60px;
  height: 2px;
  background: #E5E6EB;
  margin: 0 auto 24px;
  border-radius: 1px;
}

.placeholder-card__features {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 32px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #F9FAFB;
  border-radius: 8px;
  font-size: 13px;
  color: #4E5969;
  justify-content: flex-start;
}

.feature-item .el-icon {
  color: #1677FF;
  font-size: 16px;
  flex-shrink: 0;
}

.placeholder-card__footer {
  font-size: 12px;
  color: #C9CDD4;
  letter-spacing: 2px;
}
</style>
