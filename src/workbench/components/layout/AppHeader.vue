<template>
  <header class="app-header">
    <div class="context"><span>{{ meta[0] }}</span><small>{{ meta[1] }}</small></div>
    <div class="actions">
      <button id="bell-btn" type="button" aria-label="通知" @click.stop="toggle"><el-icon><Bell /></el-icon><i v-if="count">{{ count }}</i></button>
      <button type="button" aria-label="帮助中心" aria-haspopup="dialog" @click.stop="helpOpen = true"><el-icon><QuestionFilled /></el-icon></button>
    </div>
  </header>
  <Teleport to="body"><div v-if="show" id="notification-dropdown" class="notification-dropdown" @click.stop><NotificationList @close="show = false" /></div></Teleport>
  <!-- 帮助中心：此前只有一颗无 handler 的按钮，点了毫无反应。
       内容只讲「这个系统怎么用」的既有入口与快捷键，不新增功能。 -->
  <el-dialog v-model="helpOpen" title="帮助中心" width="560px" append-to-body>
    <div class="help-body">
      <section>
        <h3>每天的主流程</h3>
        <ol>
          <li>手机上「上传今天的作业」，AI 自动识别与判题。</li>
          <li>电脑「批改中心」处理待复核：<kbd>Space</kbd> 标对、<kbd>X</kbd> 标错，判定后自动跳下一题。</li>
          <li>整卷确认后 <kbd>Enter</kbd> 完成复核，再按 <kbd>T</kbd> 接下一份（跨学生连续处理）。</li>
          <li>「学习诊断」看薄弱点，「错题管理」搜题或按知识点组卷。</li>
        </ol>
      </section>
      <section>
        <h3>复核台快捷键</h3>
        <table class="help-keys">
          <tbody>
            <tr><td><kbd>Space</kbd> / <kbd>X</kbd></td><td>标对 / 标错（自动跳下一道未确认题）</td></tr>
            <tr><td><kbd>E</kbd></td><td>编辑本题（编辑态 <kbd>S</kbd> 保存、<kbd>Esc</kbd> 取消）</td></tr>
            <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>上一题 / 下一题（只导航，不判定）</td></tr>
            <tr><td><kbd>T</kbd> / <kbd>Shift</kbd>+<kbd>T</kbd></td><td>下一份 / 上一份待复核试卷</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>撤销上一次判定（仅本页显示）</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>命令面板：跳题 / 下一份 / 完成复核</td></tr>
            <tr><td><kbd>?</kbd></td><td>复核台内快捷键速查</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3>几个容易踩的点</h3>
        <ul>
          <li>「待复核」是<b>待老师确认的卷数</b>，与铃铛里的未读通知数不是一回事。</li>
          <li>重练卷要等学生交答卷后才进复核队列；没交的卷只在「待学生作答」里可见。</li>
          <li>作业只能在手机 App 上传，工作台没有上传入口。</li>
        </ul>
      </section>
    </div>
  </el-dialog>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Bell, QuestionFilled } from '@element-plus/icons-vue'
import { useNotificationStore } from '../../stores/notificationStore'
import NotificationList from './NotificationList.vue'

const route = useRoute()
const store = useNotificationStore()
const show = ref(false)
const helpOpen = ref(false)
const routes = {
  '/': ['工作台', '今日教学概览'],
  '/grade': ['批改中心', '统一处理作业与重练任务'],
  '/weekly-report': ['学习诊断', '从数据发现问题并安排下一步'],
  '/worksheets': ['练习册', '管理练习册内容与答案状态'],
  '/students': ['学生管理', '查看学生状态并进入学习记录'],
  '/weekend-ppt': ['周末班课件', '按年级聚合共性错题，出课件与白板讲题']
}
const meta = computed(() => Object.entries(routes).find(([path]) => path === '/' ? route.path === '/' : route.path.startsWith(path))?.[1] || ['教师工作台', '敏学教学工作系统'])
const count = computed(() => store.totalCount > 99 ? '99+' : store.totalCount || '')
const toggle = () => { show.value = !show.value; if (show.value) store.fetchSummary() }
const close = event => { if (!event.target.closest('#notification-dropdown') && !event.target.closest('#bell-btn')) show.value = false }
onMounted(() => { store.startPolling(); document.addEventListener('click', close) })
onUnmounted(() => { store.stopPolling(); document.removeEventListener('click', close) })
</script>
<style scoped>
.app-header{display:flex;align-items:center;justify-content:space-between;height:var(--wb-header-height);flex:0 0 var(--wb-header-height);box-sizing:border-box;padding:0 28px;background:rgba(255,255,255,.94);border-bottom:1px solid var(--wb-border);backdrop-filter:blur(16px)}
.context{display:flex;align-items:baseline;gap:10px}.context span{color:var(--wb-text);font-size:14px;font-weight:650}.context small{color:var(--wb-text-tertiary);font-size:12px}
.actions{display:flex;gap:4px}.actions button{position:relative;display:grid;width:34px;height:34px;place-items:center;color:var(--wb-text-secondary);background:transparent;border:0;border-radius:8px;cursor:pointer}.actions button:hover{color:var(--wb-text);background:var(--wb-bg-hover)}
.actions i{position:absolute;top:1px;right:0;min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;color:#fff;font:600 9px/15px sans-serif;background:var(--wb-danger);border-radius:8px}
.notification-dropdown{position:fixed;top:54px;right:22px;z-index:2100;overflow:hidden;background:#fff;border:1px solid var(--wb-border);border-radius:10px;box-shadow:var(--wb-shadow-lg)}

/* ── 帮助中心浮层（与快捷键浮层同字号，不引入新 token） ── */
.help-body { display: flex; flex-direction: column; gap: var(--wb-space-4); }
.help-body h3 {
  margin: 0 0 var(--wb-space-2);
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
}
.help-body ol,
.help-body ul {
  margin: 0;
  padding-left: 18px;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  line-height: 1.9;
}
.help-keys { width: 100%; border-collapse: collapse; }
.help-keys td {
  padding: 6px 8px;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  border-bottom: 1px solid var(--wb-border-light);
}
.help-keys td:first-child { width: 150px; white-space: nowrap; color: var(--wb-text); }
.help-keys kbd,
.help-body kbd {
  display: inline-block;
  min-width: 20px;
  padding: 1px 6px;
  color: var(--wb-text);
  font-family: inherit;
  font-size: var(--wb-fs-caption);
  text-align: center;
  background: var(--wb-bg-elevated);
  border: 1px solid var(--wb-border);
  border-radius: 4px;
}
</style>
