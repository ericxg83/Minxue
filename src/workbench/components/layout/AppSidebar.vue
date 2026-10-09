<template>
  <aside class="app-sidebar">
    <button class="brand" type="button" @click="go('/')">
      <span class="brand-mark">敏</span>
      <span>
        <strong>敏学</strong>
        <small>教师工作台</small>
      </span>
    </button>
    <nav aria-label="主导航">
      <section v-for="group in navGroups" :key="group.label" class="nav-group">
        <div v-if="group.label" class="group-label">{{ group.label }}</div>
        <button
          v-for="item in group.items"
          :key="item.path"
          type="button"
          :class="['nav-link', { 'is-active': isActive(item.path) }]"
          @click="go(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <span v-if="badgeFor(item.path) > 0" class="nav-badge">{{ badgeFor(item.path) }}</span>
        </button>
      </section>
    </nav>
    <div class="sidebar-footer">
      <div class="avatar">师</div>
      <span>
        <strong>管理员</strong>
        <small>教学负责人</small>
      </span>
      <el-icon><MoreFilled /></el-icon>
    </div>
  </aside>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { Collection, DataAnalysis, DocumentChecked, Files, HomeFilled, MoreFilled, Notebook, Tickets, User } from '@element-plus/icons-vue'
import { useNotificationStore } from '../../stores/notificationStore'

const route = useRoute()
const router = useRouter()
const noti = useNotificationStore()

// r101（历史裁决）：试卷答案库 / 我的考法库曾降为「练习册管理」二级项收纳。
// r16x（负责人裁决，2026-10-06）：练习册本体 / 答案数据 / 考法素材是三个不同对象，
// 非父子关系——改回平级独立入口，仅按职责分组（教学工作 / 教学资源）。
// r137（负责人裁决）：「我的讲义」属伪需求，入口与页面一并下线。
const navGroups = [
  { label: '', items: [{ label: '工作台', path: '/', icon: HomeFilled }] },
  {
    label: '教学工作',
    items: [
      { label: '批改中心', path: '/grade', icon: DocumentChecked },
      { label: '学习诊断', path: '/weekly-report', icon: DataAnalysis },
      { label: '学生管理', path: '/students', icon: User }
    ]
  },
  {
    label: '教学资源',
    items: [
      { label: '练习册管理', path: '/worksheets', icon: Notebook },
      { label: '试卷答案库', path: '/paper', icon: Tickets },
      { label: '我的考法库', path: '/question-bank', icon: Collection },
      { label: '周末班课件', path: '/weekend-ppt', icon: Files }
    ]
  }
]

const isActive = (path) => (path === '/' ? route.path === '/' : route.path.startsWith(path))
const go = (path) => { if (route.path !== path) router.push(path) }

// 活数据徽标（r16x+2）：直接复用全局 notificationStore 轮询（AppHeader 已启动），不新增请求。
// 批改中心=待人工复核卷数，学习诊断=今日新增错题数；其余入口暂无现成计数，不加。
// ⛔ 批改中心徽标必须用 pendingReviewPapers（口径与页内 chip 同源）；
//    用 pendingReview（未读通知数）会出现「徽标 1 / 页面 7」（2026-10-09 事故）。
const badgeFor = (path) => {
  if (path === '/grade') {
    return noti.summary?.pendingReviewPapers ?? noti.summary?.pendingReview ?? 0
  }
  if (path === '/weekly-report') return noti.summary?.todayNewWrongQuestions || 0
  return 0
}
</script>

<style scoped>
.app-sidebar {
  /* 深色侧栏局部 token（r16x+2）：不动全局主题，仅本组件生效 */
  --sd-bg: #1b1a33;
  --sd-text: rgba(255, 255, 255, 0.92);
  --sd-text-dim: rgba(255, 255, 255, 0.66);
  --sd-text-faint: rgba(255, 255, 255, 0.42);
  --sd-hover: rgba(255, 255, 255, 0.06);
  --sd-active-bg: linear-gradient(90deg, rgba(99, 102, 241, 0.24), rgba(99, 102, 241, 0.08));
  --sd-active-icon: #a5b4fc;
  --sd-line: rgba(255, 255, 255, 0.08);
  --sd-badge-bg: rgba(255, 255, 255, 0.13);
  --sd-badge-text: #e0e7ff;

  display: flex;
  width: var(--wb-sidebar-width);
  height: 100vh;
  flex: 0 0 var(--wb-sidebar-width);
  box-sizing: border-box;
  flex-direction: column;
  padding: 18px 12px 14px;
  background: var(--sd-bg);
  border-right: 1px solid var(--sd-line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 4px 11px 20px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.brand-mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 9px;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.45);
}
.brand strong,
.brand small,
.sidebar-footer strong,
.sidebar-footer small {
  display: block;
}
.brand strong {
  color: var(--sd-text);
  font-size: 15px;
}
.brand small {
  margin-top: 2px;
  color: var(--sd-text-faint);
  font-size: 10px;
}
nav {
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid var(--sd-line);
}
.nav-group + .nav-group {
  margin-top: 20px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 7px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 40px;
  padding: 0 11px;
  color: var(--sd-text-dim);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: 0.16s;
}
.nav-link:hover {
  color: var(--sd-text);
  background: var(--sd-hover);
}
.nav-link.is-active {
  color: var(--sd-text);
  font-weight: 600;
  background: var(--sd-active-bg);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.28);
}
.nav-link.is-active .el-icon {
  /* 深色背景下 active 图标统一继承白色，避免与背景色混叠 */
  color: inherit;
}
.nav-link .el-icon {
  font-size: 17px;
}
.nav-badge {
  display: grid;
  min-width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0 5px;
  place-items: center;
  color: var(--sd-badge-text);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  background: var(--sd-badge-bg);
  border-radius: 9999px;
}
.sidebar-footer {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 9px;
  margin-top: 12px;
  padding: 12px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px var(--sd-line);
}
.avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: #c7d2fe;
  font-weight: 650;
  background: rgba(99, 102, 241, 0.28);
  border-radius: 50%;
}
.sidebar-footer strong {
  color: var(--sd-text);
  font-size: 12px;
}
.sidebar-footer small {
  margin-top: 2px;
  color: var(--sd-text-faint);
  font-size: 10px;
}
.sidebar-footer > .el-icon {
  color: var(--sd-text-faint);
}
</style>