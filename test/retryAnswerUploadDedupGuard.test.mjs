/**
 * 回归锁：错题重练答卷上传的「关联失败不重传」守卫（r319）
 *
 * 背景（真实缺陷）：
 *   RetryTask/index.jsx 的 handleUpload 先上传答卷（建批改 task），再 PATCH /link 关联。
 *   旧代码在 link 失败时只弹通用「上传失败，请重试」，且重试会重新上传同图——
 *   当客户端算不出内容 hash（crypto.subtle 不可用）时服务端不去重，会建出重复 task；
 *   即便 hash 算得出，重试也白传一次大图，且任务永远卡在「待批改」无法自愈。
 * 修复：用 uploadedRef 记住已建 task id，link 失败时复用、跳过重传，并区分两种失败文案。
 *
 * 锁型：源码级 fail-closed（与 test/sourceLockKit 同族，但这里用内联合成坏样本做反向自检，
 *       不调 git 避免 Windows EBUSY）。判据只盯「结构不变量」，不受缩进/换行影响。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src', 'pages', 'RetryTask', 'index.jsx')
const src = readFileSync(SRC, 'utf8')

const DECL = 'const uploadedRef = useRef'
const CALL = 'taskService.uploadRetryAnswer('
const CLEAR = 'uploadedRef.current = null'
const CATCH_ANCHOR = "console.error('上传答卷失败:'"
const FINALLY_ANCHOR = 'finally {'

/** 收集源码锁判据（fail-closed）。传入任意 src 字符串，返回 fails 数组。 */
function collectFailures(s) {
  const fails = []

  // ① 必须有守卫 ref 声明
  if (s.indexOf(DECL) < 0) fails.push('缺少 uploadedRef 守卫声明（' + DECL + '）')

  // ② uploadRetryAnswer 必须在「ref 为空才上传」的 else 分支内
  //    —— 即「声明」与「调用」之间必须同时出现 uploadedRef.current 守卫与 else 分支
  const callIdx = s.indexOf(CALL)
  if (callIdx < 0) {
    fails.push('找不到 ' + CALL + ' 调用')
  } else if (s.indexOf(DECL) >= 0) {
    const seg = s.slice(s.indexOf(DECL), callIdx)
    if (!seg.includes('uploadedRef.current')) fails.push('uploadRetryAnswer 调用未被 uploadedRef 守卫包住（会无条件重传）')
    if (!seg.includes('else')) fails.push('uploadRetryAnswer 调用不在「ref 为空才上传」的 else 分支内')
  }

  // ③ 成功关联后必须清空 ref，否则下次上传会错误复用旧 task id
  if (!s.includes(CLEAR)) fails.push('成功关联后未清空 uploadedRef（会复用错误 task id）')

  // ④ catch 必须区分「上传失败」与「关联失败」：引入 linkingFailed 区分变量
  //   注意：finally { 在文件里不止一个（loadTask 也有），必须从 catch 锚点之后找
  const cIdx = s.indexOf(CATCH_ANCHOR)
  const fIdx = cIdx >= 0 ? s.indexOf(FINALLY_ANCHOR, cIdx) : -1
  if (cIdx < 0 || fIdx < 0) {
    fails.push('找不到 handleUpload 的 catch/finally 区间')
  } else {
    const catchSeg = s.slice(cIdx, fIdx)
    if (!catchSeg.includes('uploadedRef.current')) fails.push('catch 未区分「上传失败」与「关联失败」（未读 uploadedRef）')
    if (!catchSeg.includes('linkingFailed')) fails.push('catch 未区分「上传失败」与「关联失败」（未引入 linkingFailed 区分变量）')
  }

  return fails
}

// 真实修复后的源码：必须全绿
test('RetryTask 上传守卫：真实源码 0 失败', () => {
  const fails = collectFailures(src)
  assert.deepEqual(fails, [], '真实源码不应有失败：\n' + fails.join('\n'))
})

// 反向自检 B：模拟「修复前」代码（无 uploadedRef 守卫，link 失败即重传）
const BAD_BEFORE_FIX = `
export default function RetryTask() {
  const handleUpload = async () => {
    setUploading(true)
    try {
      const res = await taskService.uploadRetryAnswer(taskId, files)
      const created = (res.tasks || []).filter((t) => !t.error)
      if (created.length === 0) throw new Error('上传失败')
      const firstTaskId = created[0].id
      await apiRequest('/retry-tasks/'+taskId+'/link', { method:'PATCH', body: JSON.stringify({retryTaskId:firstTaskId}) })
      files.forEach((p) => p.url && URL.revokeObjectURL(p.url))
      setPendingFiles([])
      Toast.show({ icon:'success', content:'答卷已上传，开始批改' })
      await loadTask()
    } catch (e) {
      console.error('上传答卷失败:', e)
      Toast.show({ icon:'fail', content: e.message || '上传失败，请重试' })
    } finally {
      setUploading(false)
    }
  }
}
`
test('反向自检：修复前代码必须被判红（守卫缺失）', () => {
  const fails = collectFailures(BAD_BEFORE_FIX)
  assert.ok(fails.length > 0, '修复前代码必须被锁判红，否则是空锁；实际 0 失败')
  assert.ok(fails.some(f => f.includes('uploadedRef')), '必须点名守卫缺失')
})

// 反向自检 C：守卫已加，但成功路径忘记清空 ref（会复用错误 task id）
const BAD_FORGOT_CLEAR = src
  .replace(CLEAR, '/* ref 未清空 */')
test('反向自检：成功路径漏清空 ref 必须被判红', () => {
  const fails = collectFailures(BAD_FORGOT_CLEAR)
  assert.ok(fails.some(f => f.includes('清空 uploadedRef')), '漏清空 ref 必须被锁判红；实际：' + fails.join(' | '))
})

// 反向自检 D：catch 未区分关联失败（把区分变量退化成 false，退回到通用文案）
const BAD_NO_DISTINGUISH = src
  .replaceAll('linkingFailed', 'false')
test('反向自检：catch 未区分关联失败必须被判红', () => {
  const fails = collectFailures(BAD_NO_DISTINGUISH)
  assert.ok(fails.some(f => f.includes('linkingFailed')), 'catch 未引入 linkingFailed 区分变量必须被锁判红；实际：' + fails.join(' | '))
})
