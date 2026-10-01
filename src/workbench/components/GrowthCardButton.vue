<template>
  <el-button type="success" size="default" :loading="loading" @click="open">
    家长成长卡
  </el-button>
  <el-dialog v-model="visible" title="本周成长卡（保存图片后可微信转发家长）" width="470px" append-to-body>
    <div ref="cardRef" class="growth-card" v-loading="loading">
      <div class="growth-card__head">
        <div class="growth-card__avatar">{{ (studentName || '学')[0] }}</div>
        <div>
          <div class="growth-card__name">{{ studentName || '同学' }}</div>
          <div class="growth-card__period">{{ periodText }}</div>
        </div>
      </div>
      <div class="growth-card__grid">
        <div class="growth-card__cell">
          <div class="growth-card__num">{{ data?.stats?.newWrongCount ?? '—' }}</div>
          <div class="growth-card__label">新入册错题</div>
        </div>
        <div class="growth-card__cell growth-card__cell--good">
          <div class="growth-card__num">{{ data?.stats?.masteredCount ?? '—' }}</div>
          <div class="growth-card__label">消灭错题</div>
        </div>
        <div class="growth-card__cell">
          <div class="growth-card__num">{{ data?.stats?.accuracy ? data.stats.accuracy + '%' : '—' }}</div>
          <div class="growth-card__label">练习正确率</div>
        </div>
      </div>
      <div class="growth-card__row">
        <span>重练任务</span>
        <strong>{{ data?.stats?.completedTasks ?? 0 }} / {{ data?.stats?.totalTasks ?? 0 }} 完成</strong>
      </div>
      <div class="growth-card__foot">敏学 · 老师本周观察 · {{ today }}</div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="exporting" :disabled="!data" @click="exportPng">保存图片</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import html2canvas from 'html2canvas'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import { getWeeklyReport } from '../../services/apiService.js'

// 家长成长卡（提案 2，2026-10-01）：复用既有 /weekly-report/:studentId 聚合接口，
// 只读渲染为一张可转发的紧凑卡片图。零写链路、零批改链路改动。
// 色板全部取自工作台既有用色（#6366f1 主色 / #16a34a 成功 / slate 灰阶），不引入新色值。
const props = defineProps({
  studentId: { type: String, default: '' },
  studentName: { type: String, default: '' }
})

const visible = ref(false)
const loading = ref(false)
const exporting = ref(false)
const data = ref(null)
const cardRef = ref(null)
const periodText = ref('')
const today = dayjs().format('YYYY-MM-DD')

async function open() {
  if (!props.studentId) {
    ElMessage.warning('请先选择学生')
    return
  }
  loading.value = true
  visible.value = true
  data.value = null
  try {
    const resp = await getWeeklyReport(props.studentId, { mode: 'week', offset: 0 })
    if (!resp?.success) throw new Error(resp?.error || '获取周数据失败')
    data.value = resp
    const p = resp.period || {}
    periodText.value = p.start && p.end
      ? `${p.start} ~ ${p.end}${p.weekNum ? ` · 第 ${p.weekNum} 周` : ''}`
      : '本周'
  } catch (e) {
    ElMessage.error(`获取周数据失败：${e?.message || '未知错误'}`)
    visible.value = false
  } finally {
    loading.value = false
  }
}

async function exportPng() {
  if (!cardRef.value) return
  exporting.value = true
  try {
    const canvas = await html2canvas(cardRef.value, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    saveAs(blob, `成长卡-${props.studentName || '学生'}-${dayjs().format('MMDD')}.png`)
  } catch (e) {
    ElMessage.error('生成图片失败：' + (e?.message || '未知错误'))
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.growth-card {
  width: 400px;
  margin: 0 auto;
  padding: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: linear-gradient(180deg, #eef2ff 0%, #ffffff 34%);
}
.growth-card__head { display: flex; align-items: center; gap: 12px; }
.growth-card__avatar {
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #6366f1; color: #fff; font-size: 18px; font-weight: 600;
}
.growth-card__name { font-size: 17px; font-weight: 600; color: #1e293b; }
.growth-card__period { font-size: 12px; color: #64748b; margin-top: 2px; }
.growth-card__grid { display: flex; gap: 10px; margin: 18px 0 14px; }
.growth-card__cell {
  flex: 1; text-align: center; padding: 14px 4px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.growth-card__cell--good { background: #f0fdf4; border-color: #bbf7d0; }
.growth-card__num { font-size: 26px; font-weight: 700; color: #1e293b; }
.growth-card__cell--good .growth-card__num { color: #16a34a; }
.growth-card__label { font-size: 12px; color: #64748b; margin-top: 4px; }
.growth-card__row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-radius: 10px;
  background: #f8fafc; border: 1px solid #e2e8f0;
  font-size: 13px; color: #1e293b;
}
.growth-card__foot {
  margin-top: 16px; padding-top: 12px; border-top: 1px dashed #e2e8f0;
  font-size: 11px; color: #94a3b8; text-align: center;
}
</style>
