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
/** 每晚必备份的核心表（顺序 = 备份顺序，越核心越靠前）——非空才算备份成立 */
export const TABLES = ['students', 'tasks', 'wrong_questions', 'questions', 'knowledge_mastery']

/**
 * 重要补充表（2026-10-20，负责人授权修 r289-P-A）：备但**不参与「非空才算成功」判据**。
 *
 * 背景：原来只备5 张核心表（共 29 张public 表）。Neon 真停过（r289 记录），若核心表之外
 *   的关键关联/资源表没备，库崩后恢复会缺它们——例如 question_knowledge（题目↔知识点关联）
 *   丢失 ⇒ 掌握度关联全废；knowledge_points（知识点树）丢失 ⇒ 整个诊断体系崩。
 *
 * ⛔ 为什么单独分级而不是直接塞进 TABLES：assessBackupResult 把 TABLES 每张表都当
 *    「核心表，0 行即失败」。新增的补充表**允许阶段性为空**（业务尚未产生该表数据时），
 *    若塞进 TABLES 会让备份天天误判失败。故分两级：TABLES 判成败，EXTRA_TABLES 只备不管。
 *
 * 选表依据（2026-10-20 生产库实测行数 + server 代码引用文件数）：
 *   question_knowledge   688 行 / 78 处引用  —— 题目↔知识点关联，掌握度计算依赖
 *   knowledge_points     98 行 / 104 处引用 —— 知识点树，诊断体系根基
 *   question_assets     255 行 / 175 处引用 —— 题目图片/资源映射
 *   judgements           974 行 / 100 处引用 —— 判题记录
 *   kp_relations          28 行 / 22 处引用  —— 知识点上下位关系
 *   generated_exams                / 86 处引用  —— 生成卷元数据（当前 1 行）
 *   resources                     / 44 处引用 —— 资源元数据（当前 1 行）
 *
 * 刻意不备：wrong_questions_backup_*（一次性快照，共 206 行）/ question_cache（可再生缓存）
 *   / schema_migrations（迁移 lineage 由代码管）/ 各类 *_legacy / 0 行的 handout·teaching 系列
 *   （等真有业务数据再纳入）。
 */
export const EXTRA_TABLES = [
  'question_knowledge',
  'knowledge_points',
  'question_assets',
  'judgements',
  'kp_relations',
  'generated_exams',
  'resources',
]

/** 全部要备份的表 = 核心表 + 补充表（dailyBackup.mjs 遍历用） */
export const ALL_TABLES = [...TABLES, ...EXTRA_TABLES]

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
export function parseSnapshotDir(name) {
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
    const at = parseSnapshotDir(name)
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
 * ⚠️ 判空以 **TABLES 这份核心清单为准**，不是以 manifest 里实际写了哪些键为准：
 *    半途失败会留下「只导了 2 张表」的快照，此时缺的那些表同样算**没备份上**。
 *    ⚠️ **EXTRA_TABLES（补充表）不参与本判据**（2026-10-20 新增两级备份）：
 *    补充表允许阶段性为空，纳入判据会让备份因「某补充表暂无数据」误判失败。
 *    补充表备没备、有几行，都看 manifest.tables 里有没有这个键，不影响 ok。
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
