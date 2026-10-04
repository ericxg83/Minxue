/**
 * 回归锁（2026-10-04，第 129 轮）：PC 工作台「静默失败 / 失败伪装成空态」缺陷类。
 *
 * 缺陷类（与移动端 r105q–r111q 修的是同一类，但 PC 侧此前没扫过）：
 *   ① 写操作（删/发布/撤回/创建）失败后只 console.error —— 老师点了按钮界面毫无反应；
 *   ② 加载失败后列表保持空 —— 页面渲染「暂无 XXX」空态，把「请求失败」伪装成「真的没有数据」；
 *   ③ 内层 catch 把异常吞掉，外层 catch 的可见提示永不触发 —— 失败被伪装成「没有内容」。
 *
 * 本锁为源码级（.vue 模板层无 eslint-plugin-vue 覆盖，靠本锁补位）。
 *
 * ⛔ 反向自检设计（沿用 r113q 的教训）：**不依赖 git**。
 *    每条规则都内联一份「旧版坏样本」，断言同一判据在坏样本上必须判红 ——
 *    否则历史修复合入 HEAD 后，从 HEAD 重导的旧树会 0 红误报，锁就变成空锁。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const FILES = {
  exam: read('src/workbench/views/ExamWorkbench.vue'),
  weekly: read('src/workbench/views/WeeklyReportWorkbench.vue'),
  wrong: read('src/workbench/views/WrongBookCenterRedesign.vue'),
}

// r137（负责人裁决）：原FILES.handout（HandoutPreview.vue「我的讲义」编辑页）
// 及其两条规则随页面删除；「讲义子系统不得回流」的守卫在 dataPageMerge.test.mjs 。

/** 取锚点之后的窗口：把断言限定在某个函数体内，避免整文件里别处的 ElMessage.error 造成误判通过 */
function windowAfter(src, anchor, size = 700) {
  const i = String(src).indexOf(anchor)
  return i < 0 ? null : String(src).slice(i, i + size)
}

// ── 规则表 ────────────────────────────────────────────────────────────────
// probe(src) → true 表示「失败可见化已就位」
// bad        → 该规则对应的「旧版坏样本」，probe(bad) 必须为 false（证明判据非空转）
const RULES = [
  {
    id: 'exam-loadExams-加载失败不伪装空态',
    probe: (s) =>
      /const loadError = ref\(''\)/.test(s) &&
      /v-if="!loading && loadError"/.test(s) &&
      /import EmptyState from '\.\.\/components\/ui\/EmptyState\.vue'/.test(s) &&
      /loadError\.value = e\?\.message \|\| '加载失败'/.test(s),
    bad: `
      const exams = ref([])
      const loading = ref(false)
      const loadExams = async () => {
        loading.value = true
        try { exams.value = await getResources({ type: 'exam' }) }
        catch (e) { console.error('加载试卷答案库失败:', e) }
        loading.value = false
      }
      <!-- 模板 --><el-empty v-if="!loading && exams.length === 0" description="暂无试卷答案库，请先在 AI 批改复审中心审核后存档" />
    `,
  },
  {
    id: 'exam-handleDelete-删除失败必须提示',
    probe: (s) => {
      const w = windowAfter(s, 'const handleDelete = async (row) =>', 400)
      return w !== null && /ElMessage\.error\(/.test(w)
    },
    bad: `
      const handleDelete = async (row) => {
        try {
          await deleteResource(row.id)
          loadExams()
        } catch (e) {
          console.error('删除失败:', e)
        }
      }
    `,
  },
  {
    id: 'exam-handleToggleStatus-发布撤回失败必须提示',
    probe: (s) => {
      const w = windowAfter(s, 'const handleToggleStatus = async (row) =>', 500)
      return w !== null && /ElMessage\.error\(/.test(w)
    },
    bad: `
      const handleToggleStatus = async (row) => {
        try {
          const newStatus = row.status === 'published' ? 'draft' : 'published'
          await updateResource(row.id, { status: newStatus })
          loadExams()
        } catch (e) {
          console.error('切换状态失败:', e)
        }
      }
    `,
  },
  {
    id: 'exam-handleCreate-创建失败必须提示',
    probe: (s) => {
      const w = windowAfter(s, 'const handleCreate = async () =>', 500)
      return w !== null && /ElMessage\.error\(/.test(w)
    },
    bad: `
      const handleCreate = async () => {
        if (!createForm.value.name) return
        creating.value = true
        try {
          await createResource({ ...createForm.value, type: 'exam' })
          showCreateDialog.value = false
          loadExams()
        } catch (e) {
          console.error('创建失败:', e)
        }
        creating.value = false
      }
    `,
  },
  {
    id: 'weekly-loadSummary-加载失败不伪装「暂无可诊断的学生数据」',
    probe: (s) =>
      /const summaryError = ref\(''\)/.test(s) &&
      /summaryError\.value = e\?\.message \|\| '加载失败'/.test(s) &&
      /v-else-if="summaryError"/.test(s),
    bad: `
      const summaryData = ref(null)
      const loadingSummary = ref(false)
      async function loadSummary() {
        loadingSummary.value = true
        try {
          const data = await getAllWeeklyReports({ mode: periodMode.value, offset: periodOffset.value })
          if (data.success) summaryData.value = data
        } catch (e) {
          console.warn('加载周统计失败:', e)
        } finally {
          loadingSummary.value = false
        }
      }
      <!-- 模板 --><EmptyState v-else-if="!attentionReports.length" title="暂无可诊断的学生数据" description="当前周期还没有已完成的批改数据，可以切换时间范围后重试。" />
    `,
  },
  {
    id: 'wrong-removeQuestion-移除失败必须提示（不得静默回滚）',
    probe: (s) => {
      const w = windowAfter(s, 'async function removeQuestion(item)', 900)
      return w !== null && /else \{[\s\S]{0,200}ElMessage\.error\(/.test(w)
    },
    bad: `
      async function removeQuestion(item) { try { await ElMessageBox.confirm('移除后，这道题将不再出现在当前学生的错题列表中。', '移除错题', { confirmButtonText: '确认移除', cancelButtonText: '取消', type: 'warning' }); if (await wrongBookStore.deleteQuestion(item.id)) { selectedQuestion.value = null; ElMessage.success('错题已移除') } } catch {} }
    `,
  },
]

const SOURCE_OF = {
  'exam-loadExams-加载失败不伪装空态': () => FILES.exam,
  'exam-handleDelete-删除失败必须提示': () => FILES.exam,
  'exam-handleToggleStatus-发布撤回失败必须提示': () => FILES.exam,
  'exam-handleCreate-创建失败必须提示': () => FILES.exam,
  'weekly-loadSummary-加载失败不伪装「暂无可诊断的学生数据」': () => FILES.weekly,
  'wrong-removeQuestion-移除失败必须提示（不得静默回滚）': () => FILES.wrong,
}

for (const rule of RULES) {
  test(`[合规] ${rule.id}`, () => {
    assert.ok(
      rule.probe(SOURCE_OF[rule.id]()),
      `${rule.id}：失败可见化缺失（写操作静默失败 / 加载失败被伪装成空态）`
    )
  })

  test(`[反向自检] ${rule.id} 的判据在旧版坏样本上必须判红`, () => {
    assert.equal(
      rule.probe(rule.bad),
      false,
      `${rule.id}：判据在旧版坏样本上仍然通过 —— 这是一把空锁`
    )
  })
}
