# Redis 配额事故热修复报告（2026-10-19 13:0x–13:5x，负责人指令插入轮，commit `defbd6d` 已推送）

> **轮型说明**：负责人深夜指令「修熔断卡死 + 降频 + mollusk 挂第三备份 + 推送 + 今晚必须能用」。
> 按 r270 先例为**指令插入轮，不认领锁**（当时锁 `finished/307`，r307 会话已于 13:18 收线，
> 期间落地了 c424c10 = r305-P-A glob 修复、8332815 = 带入 r305/r306 两轮文书）。
> 本轮全程未碰其任何在制文件，提交用显式 pathspec 零串车。

## 0. 结论速览

| 事项 | 状态 |
|---|---|
| 熔断卡死（根因缺陷） | ✅ 已修：自愈回探（commit `defbd6d`，已推送+生产已部署 13:38） |
| 心跳降频（烧速 1/5） | ✅ 已修：60s→300s，env 可调 |
| 第三备份 current-mollusk | ✅ 本地已接线并实测落在它身上；**生产差负责人一步（Render 面板粘贴）** |
| 本地队列 | ✅ 实测恢复（taskQueue 就绪，当前实例 = backup_2/mollusk） |
| 生产队列 | ⚠️ 新码已上线，惰性初始化；**保证今晚可用需负责人贴 1 行 env**（见 §4） |

## 1. 根因链（比「配额用完」更深一层）

r305 发现双库配额耗尽 ⇒ 队列停摆。但本轮 13:06 探针发现**备库 first-skunk 已恢复**（PING/GET 正常）
而队列仍死 ⇒ 追出真正的结构性缺陷（`server/redisManager.js`）：

- `markQuotaExhausted` 一旦标记实例，只等**每月 1 号** `scheduleMonthlyReset` 解除（:83-100）；
- `getAvailableClient` 永远跳过被熔断实例（:274），健康检查只 ping「未熔断」实例 ⇒ **被熔断实例额度
  恢复后也永远无法归队**；
- 实测时间线：first-skunk 10:15 被熔断 → 13:06 额度实际已恢复 → 但系统仍当它死库 ⇒ 队列白停摆。

即：**事故持续的主因不是「没有可用额度」，而是「有额度也回不了队」。**

## 2. 修复内容（commit `defbd6d`，3 文件 +243/−1）

### 2.1 熔断自愈回探（修「卡死」）
- `startBreakerProbe`：默认 **15 分钟**（`REDIS_BREAKER_PROBE_MS` 可覆盖），仅当存在被熔断实例时
  才发命令（正常运行零开销）；每轮按池顺序轮转探**一个**实例。
- 探针用**真实数据命令** `GET __redis_breaker_selfheal_probe__`（不存在的 key，null 返回，零写入）——
  ⚠️ 不能用 PING：Upstash 超额后 PING 仍 PONG，连接级探活对配额天然失明。
- 命令成功 ⇒ `resetQuotaExhausted(id)` 归队 + 触发新回调 `onQuotaRecovered`；
  仍超额 ⇒ 保持熔断，下轮再试。
- `queue.js` 注册 `onQuotaRecovered`：**仅队列坏死态（从未初始化成功）才 rebuildQueue**；
  队列健康时恢复实例只是重新入池等下次故障转移，不打断当前健康连接。

### 2.2 心跳降频（负责人批准的「降频」）
- 健康检查 `healthCheckIntervalMs` 60s→**300s**（`REDIS_HEALTH_CHECK_MS` 可覆盖），
  健康检查烧量降为 1/5（每实例 ~43K/月 → ~8.6K/月）。

### 2.3 第三备份接线（server/.env，gitignored 不入库）
- `REDIS_POOL_URLS = first-skunk（备1）, current-mollusk（备2）`，池顺序 = 主库 superb-mallard → 备1 → 备2，
  完全按负责人「mollusk 挂第三备份」指令。
- 用户给的 URL 是 `redis://`，已归一为 `rediss://`（与 first-skunk 一致；代码本就强制 TLS，双保险）。
- mollusk 实测：PING/SET/GET/DEL 全通，dbsize=0 全新空库。

## 3. 验证（四道闸 + 实弹链路）

| 项 | 实测值 |
|---|---|
| ① npm test | **2555 pass / 0 fail**（含新锁 6 条；r307 已修 glob，探针红不复存在） |
| ② eslint | **0 errors / 131 warnings**（基线无新增） |
| ③④ 构建/冒烟 | 豁免：0 个 src/ 前端文件（r303 先例） |
| 新锁反向自检 | 旧版三层全判红：import 缺 `RedisManager` 导出（新锁文件在旧版直接 import 红）｜旧版 `healthCheckIntervalMs=60000` ≠ 断言 300000｜旧版调 `probeMarkedInstances` TypeError |
| **实弹故障转移**（探针进程走真实 initQueue，不建任务/不调 AI/不写业务表） | 池 3/3 连接 → 主库 BullMQ 命令撞配额墙→熔断 → 备1 也撞墙（余量在刀口上）→ **落 backup_2（mollusk），taskQueue 就绪**；8s 收敛后 `current=upstash_backup_2`、熔断名单=[primary, backup_1] |
| 自愈回探生效确认 | 日志 `[Redis:BreakerProbe] 已启动 (间隔: 900s)`；心跳 `[Redis:HealthCheck] 已启动 (间隔: 300s)` |

## 4. 生产状态与「今晚能用」的最后一步

- **`defbd6d` 已部署生产**：prod bootAt 2026-10-19T05:38:11Z、commit=defbd6d（13:38 北京，推送后 1 分钟自动部署）。
- 生产队列是**惰性初始化**（首次建任务才拉起），当前 `available:false` 无报错 = 未初始化，不代表坏。
- **⚠️ 待负责人一个动作（我没有 Render 面板权限）**：
  Render Dashboard → minxue-api → Environment → `REDIS_POOL_URLS` 值改为：
  ```
  <现有 first-skunk 那串>,rediss://default:gQAAAAAAAW-tAAIgcDFhYWIxZmY5MTg3ODI0OWU5YTNlMGIxODNkYzdlN2VjNQ@current-mollusk-94125.upstash.io:6379
  ```
  （若面板里没有 REDIS_POOL_URLS 这个键就新建它）→ 保存自动重部署。
  贴完之后：生产首次建任务 → 主库熔断 → 直接落 mollusk（全新 50 万）→ **今晚稳**。
- 兜底：即使不贴，自愈回探也会在 first-skunk/主库额度窗口恢复时自动救活生产队列
  （first-skunk 今日已演示过「月中恢复」；主库最迟 11-01 月初重置）——但**今晚**不保证，所以还是建议贴。

## 5. 遗留与移交

- 主库 superb-mallard / 备1 first-skunk 目前都在熔断名单，等自愈回探救活（不需要人管）。
- mollusk 成为当前唯一活库 ⇒ 它承担全部队列流量（~50 万/月内无忧）。
- r305-P-B 关闭条件：负责人贴完 Render env + 生产实测 redis.connected → 下一轮巡查确认后正式关闭。
- r305-P-C 部分缓解（心跳 1/5），BullMQ 轮询烧速与「是否上付费层」维持原提案待拍板。
- ⚠️ 备1 在配额边界上「能通/不能通」飘（10:15 断、13:06 通、13:39 又断）——自愈机制对这种飘态
  正好是对症药（每 15 分钟试一次，通就归队），无需人工干预。
