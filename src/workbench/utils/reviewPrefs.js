/**
 * 复核台「会话偏好」的本地持久化（2026-11-26）
 *
 * 两个开关都必须「关掉后刷新仍保持关闭」，否则老师的设置像没生效一样：
 *   · autoAdvanceEnabled   判定后自动跳下一题（store 用它决定跳题与自动完成复核）
 *   · autoNextPaperEnabled 完成复核后自动接下一份（2026-11-26 负责人拍板）
 *
 * 这里只做两件事：读默认值、写回最新值；判据本身仍在 store，不另造一套。
 */

const KEY_AUTO_ADVANCE = 'minxue.workbench.review.autoAdvance'
const KEY_AUTO_NEXT = 'minxue.workbench.review.autoNextPaper'

/** 「判定后自动跳下一题」默认开启（P0-1 判定即过） */
export const AUTO_ADVANCE_DEFAULT = true
/** 「完成复核后自动接下一份」默认开启 */
export const AUTO_NEXT_DEFAULT = true

export const readAutoAdvance = () => readFlag(KEY_AUTO_ADVANCE, AUTO_ADVANCE_DEFAULT)
export const writeAutoAdvance = (enabled) => writeFlag(KEY_AUTO_ADVANCE, enabled)

export const readAutoNextPaper = () => readFlag(KEY_AUTO_NEXT, AUTO_NEXT_DEFAULT)
export const writeAutoNextPaper = (enabled) => writeFlag(KEY_AUTO_NEXT, enabled)

function readFlag(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === '1'
  } catch {
    // 隐私模式 / 存储被禁用：退回默认值，不影响批改主流程
    return fallback
  }
}

function writeFlag(key, enabled) {
  try {
    localStorage.setItem(key, enabled ? '1' : '0')
  } catch {
    /* 存不下就只在本会话生效，不必打扰老师 */
  }
}
