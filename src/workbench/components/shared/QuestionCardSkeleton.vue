<template>
  <div class="question-card-skeleton">
    <div class="skeleton-header">
      <div class="skeleton-checkbox"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-badge"></div>
    </div>
    <div class="skeleton-content">
      <div class="skeleton-line long"></div>
      <div class="skeleton-line medium"></div>
    </div>
    <div class="skeleton-tags">
      <div class="skeleton-tag"></div>
      <div class="skeleton-tag"></div>
    </div>
    <div class="skeleton-footer">
      <div class="skeleton-line short"></div>
      <div class="skeleton-actions"></div>
    </div>
  </div>
</template>

<script setup>
// Pure presentational component
</script>

<style scoped>
.question-card-skeleton {
  background: #fff;
  border-radius: var(--wb-radius-md);
  padding: 16px;
  box-shadow: var(--wb-shadow-sm);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.skeleton-checkbox {
  width: 16px;
  height: 16px;
  border-radius: var(--wb-radius-xs);
  background: linear-gradient(90deg, var(--wb-bg-hover) 25%, var(--wb-border) 50%, var(--wb-bg-hover) 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

.skeleton-line {
  height: 14px;
  border-radius: var(--wb-radius-xs);
  background: linear-gradient(90deg, var(--wb-bg-hover) 25%, var(--wb-border) 50%, var(--wb-bg-hover) 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

.skeleton-line.short {
  width: 100px;
}

.skeleton-line.medium {
  width: 60%;
}

.skeleton-line.long {
  width: 100%;
}

.skeleton-badge {
  width: 60px;
  height: 20px;
  border-radius: var(--wb-radius-sm);
  background: linear-gradient(90deg, var(--wb-bg-hover) 25%, var(--wb-border) 50%, var(--wb-bg-hover) 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
  margin-left: auto;
}

.skeleton-content {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-tags {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.skeleton-tag {
  width: 60px;
  height: 22px;
  border-radius: var(--wb-radius-xs);
  background: linear-gradient(90deg, var(--wb-bg-hover) 25%, var(--wb-border) 50%, var(--wb-bg-hover) 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

.skeleton-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.skeleton-actions {
  width: 80px;
  height: 14px;
  border-radius: var(--wb-radius-xs);
  background: linear-gradient(90deg, var(--wb-bg-hover) 25%, var(--wb-border) 50%, var(--wb-bg-hover) 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

@keyframes loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
