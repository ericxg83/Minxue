<template>
  <div class="top-navbar">
    <div class="top-navbar__left">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" class="logo-icon" width="24" height="24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="logo-text">敏学成长工作台</span>
      </div>
    </div>

    <div class="top-navbar__center">
      <div
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ 'nav-item--active': isActive(item), 'nav-item--disabled': item.disabled }"
        @click="handleNavClick(item)"
      >
        <el-icon class="nav-item__icon"><component :is="item.icon" /></el-icon>
        <span class="nav-item__text">{{ item.label }}</span>
        <span v-if="item.disabled" class="dev-badge">开发中</span>
      </div>
    </div>

    <div class="top-navbar__right">
      <div id="bell-btn" class="header-icon-btn" title="通知" @click.stop="toggleNotifications">
        <el-icon :class="{ 'bell-ring': notificationStore.hasNotifications }"><Bell /></el-icon>
        <span v-if="displayCount > 0" class="header-badge">{{ displayCount }}</span>
      </div>
      <div class="header-icon-btn" title="帮助中心">
        <el-icon><QuestionFilled /></el-icon>
        <span class="header-icon-label">帮助中心</span>
      </div>
      <div class="header-user">
        <el-avatar :size="32" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" />
        <span class="header-user-name">管理员</span>
        <el-icon class="header-dropdown-icon"><ArrowDown /></el-icon>
      </div>
    </div>
  </div>

  <!-- Notification Dropdown -->
  <Teleport to="body">
    <div v-if="showNotifications" id="notification-dropdown" class="notification-dropdown" @click.stop>
      <NotificationList @close="showNotifications = false" />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Bell, QuestionFilled, ArrowDown,
  DocumentChecked, Collection, Clock, UploadFilled, DataAnalysis
} from '@element-plus/icons-vue'
import { useNotificationStore } from '../../stores/notificationStore'
import NotificationList from './NotificationList.vue'

const router = useRouter()
const route = useRoute()
const notificationStore = useNotificationStore()
const showNotifications = ref(false)

const displayCount = computed(() => {
  const n = notificationStore.totalCount
  return n > 0 ? (n > 99 ? '99+' : n) : 0
})

function toggleNotifications() {
  showNotifications.value = !showNotifications.value
  if (showNotifications.value) {
    notificationStore.fetchSummary()
  }
}

function onDocumentClick(e) {
  const dropdown = document.getElementById('notification-dropdown')
  const bell = document.getElementById('bell-btn')
  if (showNotifications.value && dropdown && !dropdown.contains(e.target) && bell && !bell.contains(e.target)) {
    showNotifications.value = false
  }
}

onMounted(() => {
  notificationStore.startPolling()
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  notificationStore.stopPolling()
  document.removeEventListener('click', onDocumentClick)
})

const navItems = [
  { key: 'proofread',       label: '题目校对', path: '/',                icon: 'DocumentChecked' },
{ key: 'wrong-book',      label: '错题本',   path: '/wrongbook',        icon: 'Collection' },
  { key: 'exam-history',    label: '组卷历史', path: '/exam-history',     icon: 'Clock' },
  { key: 'weekly-report',   label: '诊断报告', path: '/weekly-report',    icon: 'DataAnalysis' },
  { key: 'exam-import',     label: '试卷入库', path: '/paper',            icon: 'UploadFilled',disabled: true },
]

const isActive = (item) => {
  if (item.path === '/') return route.path === '/'
  return route.path.startsWith(item.path)
}

const handleNavClick = (item) => {
  if (item.disabled) return
  if (route.path !== item.path) {
    router.push(item.path)
  }
}
</script>

<style scoped>
.top-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 24px;
  background: var(--wb-bg-card);
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
  z-index: 100;
}

/* ── Left: Logo ── */
.top-navbar__left {
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  width: 24px;
  height: 24px;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--wb-text);
}

/* ── Center: Navigation Items ── */
.top-navbar__center {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--wb-text-secondary);
  transition: background 0.2s ease, color 0.2s ease;
  position: relative;
  user-select: none;
}

.nav-item:hover {
  background: var(--wb-bg-hover);
  color: var(--wb-text);
}

.nav-item--active {
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
  font-weight: 500;
}

.nav-item--active::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: var(--wb-primary);
}

.nav-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.nav-item--disabled:hover {
  background: transparent;
}

.nav-item__icon {
  font-size: 18px;
}

.nav-item__text {
  white-space: nowrap;
}

/* ── Right: User Area ── */
.top-navbar__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  color: var(--wb-text-secondary);
  font-size: 14px;
  transition: background 0.2s ease, color 0.2s ease;
  position: relative;
}

.header-icon-btn:hover {
  background: var(--wb-bg-hover);
  color: var(--wb-text);
}

.header-icon-btn .el-icon {
  font-size: 18px;
}

.header-badge {
  position: absolute;
  top: 0;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  background: var(--wb-danger);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  font-weight: 600;
}

.header-icon-label {
  font-size: 13px;
}

.header-user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: background 0.2s ease;
}

.header-user:hover {
  background: var(--wb-bg-hover);
}

.header-user-name {
  font-size: 13px;
  color: var(--wb-text);
  font-weight: 500;
}

.header-dropdown-icon {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}

/* ── Dev Badge ── */
.dev-badge {
  display: inline-block;
  padding: 1px 8px;
  background: var(--wb-warning-soft);
  color: var(--wb-warning);
  font-size: 10px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
  border: 1px solid #FDE68A;
  line-height: 18px;
}

/* ── Notification Dropdown ── */
.notification-dropdown {
  position: fixed;
  top: 60px;
  right: 20px;
  z-index: 2000;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

/* ── Bell Icon Ring Animation ── */
@keyframes bell-ring {
  0%   { transform: rotate(0) scale(1); }
  15%  { transform: rotate(18deg) scale(1.1); }
  30%  { transform: rotate(-12deg) scale(1.05); }
  45%  { transform: rotate(8deg); }
  60%  { transform: rotate(-4deg); }
  75%  { transform: rotate(2deg); }
  100% { transform: rotate(0) scale(1); }
}

.header-icon-btn .el-icon.bell-ring {
  color: var(--wb-primary);
  animation: bell-ring 0.6s ease-in-out;
}
</style>
