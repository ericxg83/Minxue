/**
 * 移动端「错误可见化 + 学生写操作禁重试」回归锁（2026-10-04 巡检循环，移动端赛道 lane-m01）
 *
 * 背景（本轮实测核实的四类缺陷，全部曾让老师「点了不知道发生了啥」）：
 *   1. StudentSwitcher 添加/编辑/删除学生失败只进 console——表单静默关闭，
 *      老师以为建好了实际上库里没有；删除失败时确认框卡死且本地列表与库分叉
 *      （先删本地、await 失败被 catch 吞、setShowDeleteConfirm(null) 永不执行）。
 *   2. ImageCropper 用原生 alert 报错——Android WebView 里形态不可控，
 *      仓内移动端统一用 antd-mobile Toast。
 *   3. WorksheetPicker 加载练习册失败被吞——列表空成「暂无已发布的练习册」，
 *      老师误以为真没练习册；设为默认失败无任何反馈。
 *   4. createStudent/updateStudent/deleteStudent 未传 retries=1——apiRequest 默认
 *      3 次尝试，而服务端 POST /students 是纯 INSERT 无去重，5xx/超时重放会造重复学生
 *      （与仓内「写操作不重试」既有约定相悖，见 updateWorksheetAnswer 同款注释）。
 *
 * 反向自检：harness 套在修复前旧文件（_r105q_old/）上必须判红，否则是空锁。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 提取 `export const <name> = ` 到下一个 `export const ` 之间的函数体。 */
function extractFn(src, name) {
  const start = src.indexOf(`export const ${name} =`)
  if (start < 0) return null
  const rest = src.slice(start + name.length + 20)
  const next = rest.indexOf('export const ')
  return next < 0 ? src.slice(start) : src.slice(start, start + name.length + 20 + next)
}

/** 给一个组件源码判断「每个 catch 都有 Toast 反馈」。 */
function catchesWithoutToast(src) {
  const fails = []
  const re = /\bcatch\s*[({]/g
  let m
  while ((m = re.exec(src))) {
    const seg = src.slice(m.index, m.index + 400)
    if (!seg.includes('Toast.show')) fails.push(src.slice(m.index, m.index + 60).split('\n')[0])
  }
  return fails
}

/** 对一组「修复前」文件复用同一套判据，返回违规清单（供反向自检）。 */
export function collectFailures(dir) {
  const file = (rel) => {
    const p = join(dir, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const fails = []

  const sw = file(join('components', 'StudentSwitcher', 'index.jsx'))
  if (sw !== null) {
    for (const line of catchesWithoutToast(sw)) fails.push(`StudentSwitcher: catch 无 Toast 反馈 → ${line}`)
    if (!sw.includes("from 'antd-mobile'")) fails.push('StudentSwitcher: 未引入 antd-mobile Toast')
    const h0 = sw.indexOf('const handleDelete')
    const hd = h0 < 0 ? '' : sw.slice(h0, h0 + 900)
    const iDel = hd.indexOf('await deleteStudent')
    const iLocal = hd.indexOf('setStudents(')
    if (iDel < 0 || iLocal < 0 || iDel > iLocal) {
      fails.push('StudentSwitcher: 删除必须「先服务端成功、后动本地」（setStudents 不得在 await deleteStudent 之前）')
    }
  }

  const crop = file(join('components', 'ImageCropper', 'index.jsx'))
  if (crop !== null) {
    if (/[^.\w]alert\(/.test(crop)) fails.push('ImageCropper: 禁止原生 alert（移动端统一 antd-mobile Toast）')
    if (!crop.includes("from 'antd-mobile'")) fails.push('ImageCropper: 未引入 antd-mobile Toast')
  }

  const ws = file(join('components', 'WorksheetPicker', 'index.jsx'))
  if (ws !== null) {
    const lw = ws.slice(ws.indexOf('const loadWorksheets'), ws.indexOf('const loadDefault'))
    if (!lw.includes('Toast.show')) fails.push('WorksheetPicker: 加载练习册失败必须 Toast')
    const s0 = ws.indexOf('const handleSetDefault')
    const sd = s0 < 0 ? '' : ws.slice(s0, s0 + 500)
    if (!sd.includes('Toast.show')) fails.push('WorksheetPicker: 设为默认失败必须 Toast')
  }

  const api = file(join('services', 'apiService.js'))
  if (api !== null) {
    for (const fn of ['createStudent', 'updateStudent', 'deleteStudent']) {
      const body = extractFn(api, fn)
      if (body === null) { fails.push(`apiService: ${fn} 不见了`); continue }
      if (!/apiRequest\([^]*?\}\s*,\s*1\)/.test(body) && !/, 1\)/.test(body)) {
        fails.push(`apiService: ${fn} 写操作必须传 retries=1（默认 3 次会重放 INSERT/PUT/DELETE）`)
      }
    }
  }

  return fails
}

test('⛔ 移动端错误可见化 + 学生写操作禁重试（当前树必须零违规）', () => {
  const failures = collectFailures(join(ROOT, 'src'))
  assert.deepEqual(
    failures,
    [],
    `\n发现 ${failures.length} 处违规：\n` + failures.map((f) => `  - ${f}`).join('\n')
  )
})

test('锁健全性：判据套修复前旧树必须判红（反向自检）', () => {
  const oldDir = join(ROOT, '_r105q_old', 'src')
  if (!existsSync(oldDir)) return // 旧树未导出时跳过（CI 环境），主锁仍生效
  const probe = collectFailures(oldDir)
  // 实测旧树 12 处（3×catch 无 Toast + 未引 Toast + 删除顺序 + 2×ImageCropper
  // + 2×WorksheetPicker + 3×apiService 重试）；阈值留 1 处余量防格式微调
  assert.ok(probe.length >= 11, `判据套旧树应报 ≥11 处，实际 ${probe.length} —— 锁可能被掏空`)
})
