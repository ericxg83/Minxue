import pgPkg from 'pg'
const { Pool } = pgPkg
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { recordDegraded } from '../services/quotaSentinel.js'

// ── 出网流量探针（2026-10-15，临时诊断工具，出网瘦身验收后删除）──
// 背景：老 Neon 项目免费层出网 5.52GB/5GB 被停机；新项目同款烧速 ~370MB/天，约 13 天见底。
// 本探针在 pg 客户端层统计每个查询拉回的字节数，按 SQL 形态聚合落盘，定位流量大户。
// ⛔ 约束：只记录、绝不改变查询行为与返回值；探针自身任何异常全部吞掉。
const EGRESS_REPORT = path.join(import.meta.dirname, '..', '_egress_probe_report.json')
const EGRESS_FLUSH_MS = 60 * 1000
let _egressAgg = {}
let _egressLastFlush = Date.now()

function _egressRecord(sql, res) {
  try {
    let bytes = 0
    if (res && res.rows) bytes = Buffer.byteLength(JSON.stringify(res.rows))
    const key = String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 110) || '__unknown__'
    for (const k of ['__total__', key]) {
      const agg = _egressAgg[k] || (_egressAgg[k] = { count: 0, bytes: 0, rows: 0, last: '' })
      agg.count++
      agg.bytes += bytes
      agg.rows += (res && res.rowCount) || 0
      agg.last = new Date().toISOString()
    }
    if (bytes >= 100 * 1024) console.warn('[egress-probe] ' + (bytes / 1024).toFixed(0) + 'KB ← ' + key.slice(0, 90))
    if (Date.now() - _egressLastFlush > EGRESS_FLUSH_MS) {
      _egressLastFlush = Date.now()
      _egressFlush()
    }
  } catch { /* 探针失败绝不外抛 */ }
}

function _egressFlush() {
  try {
    let prev = { aggregates: {} }
    try { prev = JSON.parse(fs.readFileSync(EGRESS_REPORT, 'utf8')) } catch { }
    const merged = prev.aggregates || {}
    for (const [k, v] of Object.entries(_egressAgg)) {
      if (!merged[k]) merged[k] = { count: 0, bytes: 0, rows: 0, last: '' }
      merged[k].count += v.count
      merged[k].bytes += v.bytes
      merged[k].rows += v.rows
      merged[k].last = v.last
    }
    fs.writeFileSync(EGRESS_REPORT, JSON.stringify({
      updatedAt: new Date().toISOString(),
      since: prev.since || new Date().toISOString(),
      aggregates: merged
    }, null, 2))
    _egressAgg = {}
  } catch { /* 探针失败绝不外抛 */ }
}

function _installEgressProbe() {
  try {
    const proto = pgPkg.Client.prototype
    if (proto.query.__egressPatched) return
    const origQuery = proto.query
    proto.query = function (...args) {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || ''
      const maybeCb = args[args.length - 1]
      if (typeof maybeCb === 'function') {
        args[args.length - 1] = function (err, res) {
          if (!err) _egressRecord(sql, res)
          return maybeCb.call(this, err, res)
        }
        return origQuery.apply(this, args)
      }
      const p = origQuery.apply(this, args)
      return Promise.resolve(p).then(
        (res) => { _egressRecord(sql, res); return res },
        (e) => { throw e }
      )
    }
    proto.query.__egressPatched = true
    process.on('exit', () => _egressFlush())
  } catch { /* 探针失败绝不外抛 */ }
}
_installEgressProbe()
// ── 出网流量探针结束 ──

let _pool = null

/**
 * 强制 IPv4 解析（2026-09-23，卡顿真根因）。
 *
 * DNS 对 Neon 主机名返回的顺序是「4 个 AAAA(IPv6) 在前、3 个 A(IPv4) 在后」
 * （见 server/_diag_dns.mjs 实测）。Node/pg 默认按返回顺序逐个尝试，
 * 而本机到 Neon 的 IPv6 路由不通 → 要等每个 IPv6 地址耗尽 connectionTimeoutMillis，
 * 才轮到 IPv4。表现就是：
 *   - 预览接口长时间卡住（前端「正在聚合错题」不返回）
 *   - 超时后统一报 "Connection terminated due to connection timeout"
 * 与「大 JSONB 传输」是两件独立的事，两者叠加使预览几乎必挂。
 *
 * 这里把 host 解析结果过滤成 IPv4 再交给 net.connect。
 * 若环境确实只有 IPv6（无 A 记录），回退使用原始地址列表，不影响可用性。
 */
const ipv4FirstLookup = (hostname, options, callback) => {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'function' ? {} : (options || {})
  dns.lookup(hostname, { ...opts, all: true, family: 0 }, (err, addresses) => {
    if (err) return cb(err)
    const list = Array.isArray(addresses) ? addresses : [addresses]
    const v4 = list.filter(a => a && a.family === 4)
    const picked = v4.length > 0 ? v4 : list
    if (opts.all) return cb(null, picked)
    const first = picked[0]
    if (!first) return cb(new Error(`DNS 无可用地址：${hostname}`))
    cb(null, first.address, first.family)
  })
}

export const getPool = () => {
  if (!_pool) {
    const connectionString = process.env.NEON_DATABASE_URL
    
    if (!connectionString) {
      throw new Error('数据库未配置：缺少 NEON_DATABASE_URL 环境变量')
    }
    
    _pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      // 2026-10-04 提案⑮（负责人批准）：保底留 1 条热连接，消掉「空闲后首个请求」的建连惩罚。
      // 实测（生产库只读，_diag_pool_min_1004.mjs 对照实验，各含 2 轮 15s 静置）：
      //   不设 min → 静置后首查 513ms；min:1 → 78ms。差 435ms（6.6 倍）。
      // 端到端佐证：/api/wrong-questions/student/:id 热连接 0.315s，
      //   静置 15s 后首个请求 0.668s，之后回落 0.266s。
      // 这正是「隔一段时间打开 App 要重新加载、而且要很久」的根因之一。
      // 为什么敢留：① keepAlive 已开且初始延迟 10s，TCP 层持续探针能识别被掐断的连接；
      // ② 下方已挂 error 监听，池会剔除异常连接并打日志。
      // ⛔ 已知的残留风险（负责人知情后选择只加 min、不加重试）：
      //   query() 没有重试，若这条保底连接恰好在两次使用之间被静默掐断，
      //   该次请求会直接抛错给用户，表现为「偶发一次失败」。若线上真出现，
      //   下一步是给 query() 加「仅对连接类错误重试一次」的保护（会触及错误语义，需另行拍板）。
      min: 1,
      // 见上方 ipv4FirstLookup 注释：绕开本机不通的 IPv6 优先顺序
      lookup: ipv4FirstLookup,
      // ── 2026-09-23 卡顿排查(P0)：本地→Neon(新加坡 AWS) 连接不稳/高 RTT 的缓解 ──
      // keepAlive 让空闲 TCP 周期发探针，及时剔除被中间网络(NAT/防火墙)静默关闭的连接，
      // 避免复用已死连接时抛 "Connection terminated unexpectedly"。
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      // 新加坡 RTT ~500ms + Neon serverless 冷唤醒，原 5s 建连超时太短 → 频繁
      // "timeout exceeded when trying to connect"，放宽到 20s 让连接能建起来。
      connectionTimeoutMillis: 20000,
      // 空闲 30s→10s：更快回收被中间设备关闭的连接，避免被复用成死连接。
      idleTimeoutMillis: 10000
    })

    _pool.on('error', (err) => {
      console.error('Neon 数据库连接池错误:', err)
    })
  }
  return _pool
}

export const query = async (text, params) => {
  const start = Date.now()
  try {
    const pool = getPool()
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    if (duration > 100) {
      console.debug('慢查询:', { text: text.substring(0, 50), duration, rows: result.rowCount })
    }
    return result
  } catch (error) {
    console.error('数据库查询错误:', error)
    // 配额哨兵（提案 1）：额度类错误上报水位（如 53000 exceeded the quota），只记录、不改重试语义
    if (/quota|exceed|53000|too many|429|limit/i.test(error?.message || '')) {
      recordDegraded('neon', { kind: 'quota', detail: String(error?.message || 'database error').slice(0, 200) })
    }
    throw error
  }
}

export const transaction = async (callback) => {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const TABLES = {
  STUDENTS: 'students',
  TASKS: 'tasks',
  QUESTIONS: 'questions',
  WRONG_QUESTIONS: 'wrong_questions',
  GENERATED_EXAMS: 'generated_exams',
  QUESTION_CACHE: 'question_cache',
  JUDGEMENTS: 'judgements',
  QUESTION_ASSETS: 'question_assets',
  WORKSHEETS: 'worksheets',
  WORKSHEET_ANSWERS: 'worksheet_answers',
  STUDENT_WORKSHEET_SETTINGS: 'student_worksheet_settings',
  RESOURCES: 'resources',
  RESOURCE_ANSWERS: 'resource_answers',
  ERROR_TYPES: 'error_types',
  KNOWLEDGE_POINTS: 'knowledge_points',
  QUESTION_KNOWLEDGE: 'question_knowledge',
  KNOWLEDGE_MASTERY: 'knowledge_mastery',
  VARIANT_QUESTIONS: 'variant_questions'
}

export const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed'
}

export const QUESTION_STATUS = {
  PENDING: 'pending',
  WRONG: 'wrong',
  MASTERED: 'mastered'
}

export const WRONG_STATUS = {
  PENDING: 'pending',
  MASTERED: 'mastered'
}

export const LIFECYCLE_STATUS = {
  NEW: 'new',
  REVIEW_1: 'review_1',
  REVIEW_2: 'review_2',
  MASTERED: 'mastered'
}

export const getQuestionsByTask = async (taskId) => {
  // 过滤掉被老师「排除」的题（review_status='exclude'），与前端 reviewStore.js
  // splice 语义一致：老师点了排除这题就从本份试卷里消失，下次进入也不再出现。
  const { rows } = await query(
    `SELECT * FROM ${TABLES.QUESTIONS} WHERE task_id = $1 AND (review_status IS NULL OR review_status != 'exclude') ORDER BY created_at`,
    [taskId]
  )
  return rows
}

