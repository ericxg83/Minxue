/**
 * 数据保险库——纯函数小工具（被 scripts/dailyBackup.mjs 使用）
 * ───────────────────────────────────────────────────────────────────────
 * 这里刻意只放**不碰数据库、不写磁盘**的纯计算：快照目录命名、过期轮换、
 * 「这次备份到底成不成立」的判定。目的是让 dailyBackup.mjs 的成功/失败
 * 口径能被单测**真跑**验证，而不是靠读代码猜。
 *
 * ⚠️ 目录名一律用本地日历日（Asia/Shanghai），不用 toISOString()。
 *    生产容器在 UTC+8：本地 00:00~08:00 之间 toISOString() 印的是**昨天**
 *    （r148/r151/r155/r157 连清四轮的同类漏网）。备份快照的目录名必须和
 *    它自己的轮换判断在同一时区口径下，否则会出现「目录写着 10-06、
 *    30 天后才被按 10-05 算年龄」这类错位。
 */
import { toLocalYmd } from '../server/utils/period.js'

/** 快照落盘根目录（本地磁盘，不是 OSS） */
export const BACKUP_ROOT = 'D:/Minxue_Backup'
/** 保留最近多少份快照 */
export const KEEP_DAYS = 30
/** 每晚必备份的核心表（顺序 = 备份顺序，越核心越靠前） */
export const TABLES = ['students', 'tasks', 'wrong_questions', 'questions', 'knowledge_mastery']

/** 快照目录名的合法形态：YYYY-MM-DD */
const DIR_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 本份快照该叫哪一天（本地日历日）。
 * 注入 now 便于单测断言，跟 toLocalYmd 同一个实现。
 */
export function snapshotDirName(now = new Date()) {
  return toLocalYmd(now)
}

/**
 * 快照目录名 → 本地零点的时刻；不是合法目录名则返回 null。
 * 与 snapshotDirName 保持同口径（+08:00），故命名与年龄判断不会互相错位。
 */
export function parseSnapshotDir(name, now = new Date()) {
  if (!DIR_RE.test(name)) return null
  const [y, m, d] = name.split('-').map(Number)
  // 用本地构造（new Date(y, m-1, d)），避免按 UTC 解析又退一天
  const at = new Date(y, m - 1, d)
  return Number.isNaN(at.getTime()) ? null : at
}

/** 目录名是否是合法快照目录（用于轮换时跳过非快照目录） */
export function isSnapshotDirName(name) {
  return DIR_RE.test(name)
}

/**
 * 该删哪些旧快照（返回目录名数组）。
 * 只认本地日历日算年龄，非快照目录（比如乱塞进来的文件）一律不碰。
 */
export function planExpiredSnapshots(entries, now = new Date(), keepDays = KEEP_DAYS) {
  const expired = []
  for (const name of entries ?? []) {
    const at = parseSnapshotDir(name, now)
    if (!at) continue
    const ageDays = (now.getTime() - at.getTime()) / 86400000
    if (ageDays > keepDays) expired.push(name)
  }
  return expired.sort()
}

/**
 * 备份结果成不成立。
 *
 * ⛔ 关键口径：**任何一张核心表 0 行都算备份不成立。
 *    备份是「出事时唯一能救命的东西」，连错库 / 库空了就导出一堆空 JSON 还
 *    打一句「完成」，等于谎报平安（2026-10-05 实测 dailyBackup.mjs 就是这个行为）。
 *
 * ⚠️ 判空以 **TABLES 这份清单为准**，不是以 manifest 里实际写了哪些键为准：
 *    半途失败会留下「只导了 2 张表」的快照，此时缺的那些表同样算**没备份上**。
 *
 * @param {{tables: Record<string, number>}} manifest
 * @returns {{ok: boolean, emptyTables: string[]}}
 */
export function assessBackupResult(manifest) {
  const tables = (manifest && typeof manifest.tables === 'object' && manifest.tables) || {}
  const emptyTables = TABLES.filter((t) => {
    const n = tables[t]
    return typeof n !== 'number' || n <= 0
  })
  return { ok: emptyTables.length === 0, emptyTables }
}
