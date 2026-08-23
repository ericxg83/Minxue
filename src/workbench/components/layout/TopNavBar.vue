<template>
  <aside class="workbench-sidebar">
    <div class="brand-lockup">
      <span class="brand-mark">敏</span>
      <span class="brand-copy"><strong>敏学</strong><small>教师工作台</small></span>
    </div>
    <div class="nav-section-label">今天的工作</div>
    <nav class="sidebar-nav" aria-label="主导航">
      <template v-for="item in navItems" :key="item.key">
        <button v-if="!item.children" type="button" class="nav-item" :class="{ 'nav-item--active': isActive(item) }" @click="handleNavClick(item)">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
        </button>
        <div v-else class="nav-group">
          <div class="nav-section-label nav-section-label--group">{{ item.label }}</div>
          <button v-for="child in item.children" :key="child.key" type="button" class="nav-item" :class="{ 'nav-item--active': isActive(child) }" @click="handleNavClick(child)">
            <el-icon><component :is="child.icon" /></el-icon><span>{{ child.label }}</span>
          </button>
        </div>
      </template>
    </nav>
    <div class="sidebar-footer"><span class="status-dot"></span><span>系统运行正常</span></div>
  </aside>

  <header class="top-navbar">
    <div class="top-navbar__context"><span class="context-kicker">教师工作台</span><span class="context-separator">/</span><strong>{{ currentSection }}</strong></div>
    <div class="top-navbar__right">
      <button id="bell-btn" type="button" class="header-icon-btn" title="通知" aria-label="通知" @click.stop="toggleNotifications">
        <el-icon :class="{ 'bell-ring': notificationStore.hasNotifications }"><Bell /></el-icon><span v-if="displayCount > 0" class="header-badge">{{ displayCount }}</span>
      </button>
      <button type="button" class="header-icon-btn header-help" title="帮助中心"><el-icon><QuestionFilled /></el-icon><span>帮助</span></button>
      <button type="button" class="header-user"><el-avatar :size="30" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" /><span class="header-user-name">管理员</span><el-icon class="header-dropdown-icon"><ArrowDown /></el-icon></button>
    </div>
  </header>

  <Teleport to="body">
    <div v-if="showNotifications" id="notification-dropdown" class="notification-dropdown" @click.stop>
      <NotificationList @close="showNotifications = false" />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Bell, QuestionFilled, ArrowDown, DocumentChecked, Collection, DataAnalysis, Notebook, Reading, HomeFilled } from '@element-plus/icons-vue'
import { useNotificationStore } from '../../stores/notificationStore'
import NotificationList from './NotificationList.vue'

const router = useRouter()
const route = useRoute()
const notificationStore = useNotificationStore()
const showNotifications = ref(false)
const displayCount = computed(() => { const n = notificationStore.totalCount; return n > 0 ? (n > 99 ? '99+' : n) : 0 })
const navItems = [
  { key: 'dashboard', label: '工作台', path: '/', icon: 'HomeFilled' },
  { key: 'teaching', label: '批改中心', icon: 'DocumentChecked', children: [{ key: 'grade', label: '批改中心', path: '/grade', icon: 'DocumentChecked' }] },
  { key: 'learning', label: '学生学习', icon: 'Collection', children: [{ key: 'weekly-report', label: '学习诊断', path: '/weekly-report', icon: 'DataAnalysis' }, { key: 'wrong-book', label: '错题', path: '/wrongbook', icon: 'Collection' }, { key: 'growth', label: '成长报告', path: '/growth', icon: 'DataAnalysis' }] },
  { key: 'resources', label: '教学资源', icon: 'Notebook', children: [{ key: 'handouts', label: '我的讲义', path: '/handouts', icon: 'Reading' }, { key: 'worksheets', label: '练习册', path: '/worksheets', icon: 'Notebook' }, { key: 'question-bank', label: '题库', path: '/question-bank', icon: 'Collection' }] }
]
const isActive = (item) => { if (item.path === '/') return route.path === '/'; if (item.path) return route.path.startsWith(item.path); return item.children?.some(child => isActive(child)) ?? false }
const currentSection = computed(() => { const active = navItems.flatMap(item => item.children || item).find(item => isActive(item)); return active?.label || '工作台' })
const handleNavClick = (item) => { if (item.children || route.path === item.path) return; router.push(item.path) }
const toggleNotifications = () => { showNotifications.value = !showNotifications.value; if (showNotifications.value) notificationStore.fetchSummary() }
const onDocumentClick = (event) => { const dropdown = document.getElementById('notification-dropdown'); const bell = document.getElementById('bell-btn'); if (showNotifications.value && dropdown && !dropdown.contains(event.target) && bell && !bell.contains(event.target)) showNotifications.value = false }
onMounted(() => { notificationStore.startPolling(); document.addEventListener('click', onDocumentClick) })
onUnmounted(() => { notificationStore.stopPolling(); document.removeEventListener('click', onDocumentClick) })
</script>

<style scoped>
.workbench-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 100; display: flex; width: 232px; flex-direction: column; padding: 22px 14px 16px; background: var(--wb-bg-card); border-right: 1px solid var(--wb-border-light); }
.brand-lockup { display: flex; align-items: center; gap: 10px; padding: 0 10px 28px; }
.brand-mark { display: grid; width: 32px; height: 32px; place-items: center; color: #fff; background: var(--wb-primary); border-radius: 11px; font-size: 16px; font-weight: 700; box-shadow: 0 5px 12px rgba(49, 87, 213, .2); }
.brand-copy { display: flex; flex-direction: column; gap: 1px; color: var(--wb-text); }.brand-copy strong { font-size: 15px; letter-spacing: .02em; }.brand-copy small { color: var(--wb-text-tertiary); font-size: 11px; }
.nav-section-label { padding: 0 11px 8px; color: var(--wb-text-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .08em; }.nav-section-label--group { padding-top: 22px; }.sidebar-nav { overflow-y: auto; }
.nav-item { display: flex; align-items: center; width: 100%; gap: 10px; margin: 2px 0; padding: 10px 11px; color: var(--wb-text-secondary); background: transparent; border: 0; border-radius: 10px; cursor: pointer; font-size: 13px; text-align: left; transition: .18s ease; }.nav-item:hover { color: var(--wb-text); background: var(--wb-bg-hover); }.nav-item--active { color: var(--wb-primary); background: var(--wb-primary-mist); font-weight: 600; }.nav-item .el-icon { width: 18px; font-size: 16px; }
.sidebar-footer { display: flex; align-items: center; gap: 7px; margin-top: auto; padding: 12px 11px 0; color: var(--wb-text-tertiary); border-top: 1px solid var(--wb-border-light); font-size: 11px; }.status-dot { width: 6px; height: 6px; background: var(--wb-success); border-radius: 50%; }
.top-navbar { position: fixed; top: 0; right: 0; left: 232px; z-index: 90; display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0 30px; background: rgba(255, 255, 255, .9); border-bottom: 1px solid var(--wb-border-light); backdrop-filter: blur(14px); }.top-navbar__context { display: flex; align-items: center; gap: 9px; color: var(--wb-text); font-size: 13px; }.context-kicker, .context-separator { color: var(--wb-text-tertiary); }.top-navbar__right { display: flex; align-items: center; gap: 8px; }
.header-icon-btn { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 9px; color: var(--wb-text-secondary); background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: 12px; }.header-icon-btn:hover, .header-user:hover { color: var(--wb-text); background: var(--wb-bg-hover); }.header-icon-btn .el-icon { font-size: 17px; }.header-badge { position: absolute; top: 0; right: 2px; min-width: 16px; height: 16px; padding: 0 5px; color: #fff; background: var(--wb-danger); border-radius: 10px; font-size: 10px; font-weight: 600; line-height: 16px; text-align: center; }.header-user { display: flex; align-items: center; gap: 7px; padding: 4px 8px; color: var(--wb-text); background: transparent; border: 0; border-radius: 9px; cursor: pointer; }.header-user-name { font-size: 12px; font-weight: 600; }.header-dropdown-icon { color: var(--wb-text-tertiary); font-size: 12px; }.notification-dropdown { position: fixed; top: 72px; right: 24px; z-index: 2000; overflow: hidden; background: #fff; border-radius: 12px; box-shadow: var(--wb-shadow-lg); }
@keyframes bell-ring { 0% { transform: rotate(0) scale(1); } 15% { transform: rotate(18deg) scale(1.1); } 30% { transform: rotate(-12deg) scale(1.05); } 45% { transform: rotate(8deg); } 60% { transform: rotate(-4deg); } 75% { transform: rotate(2deg); } 100% { transform: rotate(0) scale(1); } }.header-icon-btn .el-icon.bell-ring { color: var(--wb-primary); animation: bell-ring .6s ease-in-out; }
@media (max-width: 900px) { .workbench-sidebar { width: 68px; padding-inline: 8px; }.brand-lockup { justify-content: center; padding-inline: 0; }.brand-copy, .nav-section-label, .nav-item span, .sidebar-footer span:not(.status-dot) { display: none; }.nav-item { justify-content: center; padding: 11px; }.top-navbar { left: 68px; padding-inline: 18px; }.header-help span, .header-user-name, .header-dropdown-icon { display: none; } }
</style>
