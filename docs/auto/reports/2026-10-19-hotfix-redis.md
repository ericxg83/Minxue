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

## 6. 生产恢复验证（14:16–14:2x，负责人贴 env，本轮补记）

- **负责人 14:16 在 Render 贴上 `REDIS_POOL_URLS`**（注：贴的池子 =
  `redis://…superb-mallard…（主库明文版）` + `rediss://…current-mollusk…`，缺 first-skunk）。
- Render 14:16:48 自动重启，部署 commit `87e0f6d`（看门狗调频 docs 随车）。
- **14:19:39 实测 worker-status：`redis.connected: true` / `worker.available: true`** —— 权威判据通过，
  **生产队列复活，「今晚能用」达成**。
- 重启瞬间主库恰好可用（14:16 探针实弹 GET/DBSIZE 通，DBSIZE=304）⇒ 生产直连主库成功，
  池子尚未被用到；主库再撞墙时 failover 会先跳过死跳的 `redis://` 明文项（对 TLS-only Upstash 必败）
  再落 mollusk —— 兜底成立，仅多耗一跳超时。
- **负责人关键澄清：三个 Upstash 库 = 三个独立账号** ⇒ 各自独立 500K/月，failover 有真实意义
  （修正此前「同账号共享额度」的假设；也解释 mollusk 新账号额度充足）。
- **新发现（重要，勘误口径）**：`/api/quota/status` 的 degraded 是**熔断标记快照、不会自动复测**——
  本地 first-skunk 报「08:48 起超限 329 分钟」、生产主库报「13:38 起超限 35 分钟」，
  而 14:16 外部探针实测**两库 GET/DBSIZE 全通**。⇒ 判断 Redis 真死活，
  **必须用新连接实弹 GET/DBSIZE**（留档探针 `server/_probe_upstash_now.mjs`，只读零写入），
  不能信 quota/status 的旧报错；PING 更不行（超额后仍 PONG）。
- 本地 :4000（13:37 起）当时 `redis.connected:false`：等 startBreakerProbe 轮转（900s/轮、按池序轮转探一个）
  探到可用实例即自动恢复，无需人工。

## 7. 池子优化建议（不阻塞今晚，负责人有空再贴）

理想池（都 `rediss://`、去掉主库重复项、补上 first-skunk 独立账号的 500K）：

```
rediss://default:<first-skunk 的密码>@first-skunk-160324.upstash.io:6379,rediss://default:gQAAAAAAAW-tAAIgcDFhYWIxZmY5MTg3ODI0OWU5YTNlMGIxODNkYzdlN2VjNQ@current-mollusk-94125.upstash.io:6379
```

三个账号三份额度 = 主库 50 万 + 备1 50 万 + 备2 50 万，故障转移链条完整。

## 8. 心跳高峰分化（负责人 14:24 指令，commit `08e8210` 已推送 + 生产 14:33 部署）

> 负责人点破：「看来我说的保活机制和你说的降频是两个事情。降频是影响这个额度的东西，
> 那你也可以高峰的时候密集一点，低峰的时候可以不用。」

- **改造**（server/redisManager.js）：心跳从固定间隔改 **tick 门控**——
  - tick = `REDIS_HEALTH_CHECK_PEAK_MS`（默认 **60s**，纯本地定时器，不烧 Redis）；
  - tick 内 `shouldRunHealthCheck()` 门控：**高峰窗内每 tick 必查 / 低峰每 `REDIS_HEALTH_CHECK_MS` 抽检一次**；
  - `REDIS_HEALTH_CHECK_MS` **语义改为「低峰间隔」，默认 300000 → 1800000**（30 分钟）；
  - `REDIS_PEAK_WINDOWS` 可覆盖高峰窗（默认同看门狗：周一~五 15:00-21:30，北京）。
- **烧速账**：心跳三实例 ~77K/月 → **~38K/月**（高峰密 60s、低峰稀 30min 的加权）。
- **高峰窗判定下沉 `server/lib/peakWindows.mjs`（唯一实现）**，watchdogCadence.mjs 改兼容 re-export。
  两个硬约束实测钉死：
  1. **Render `rootDir: server`，scripts/ 不在生产镜像** ⇒ 运行时核心绝不能 import scripts/dev/*
     （否则生产 ERR_MODULE_NOT_FOUND 整个服务起不来）；
  2. **Render 机器是 UTC 时区** ⇒ isPeak 改「UTC 毫秒 + 固定偏移（+480，env `PEAK_TZ_OFFSET_MIN`）」
     时区无关判定——北京机器（看门狗）与 UTC 机器（生产）对同一绝对时刻判定一致。
- **回归锁更新**：redisBreakerSelfHeal「降频配置」条改写为高峰分化断言（默认值 + 门控高峰必查/
  低峰抽检 + env 覆盖 + 自定义窗口）；watchdogCadence 新增时区无关性条（绝对 UTC 时刻跨日边界）。
  **npm test 2562/2562**｜eslint 0e｜0 个 src/ 文件豁免构建冒烟。
- **生产实证**：`08e8210` 14:33:34 部署，`redis.connected:true`（health ok 本身即证明 peakWindows
  在生产可解析——import 路径若错服务直接起不来）。
- **⚠️ r305-P-C 仍开放（头号待拍板）**：心跳只占烧速小头——13:06 额度重置后 66 分钟烧穿 50 万
  ≈ 126 req/s，心跳与 BullMQ drainDelay=60s 都解释不了，真凶未归因（疑轮询/重连风暴/Events 类）。
  需 prod 侧实测 Redis 命令速率定位后，再拍「降频 or 付费层」。

## 9. 真凶结案（14:4x–14:5x 实测，勘误 §1/§6 的「月中恢复」叙事）

**结论：不存在疯烧的代码。账号①②的 50 万/月是被三周的正常用量正常烧完的；今天所有「通了又断」都是 Upstash 超额后软封锁的飘态（时通时断），不是额度重置。**

三条铁证：

1. **mollusk（账号③）68 分钟只收了 41 条命令**（INFO stats `total_commands_processed=41`，建库 13:45 → 采样 14:53）
   = 0.6 req/min ≈ **月耗 2.6 万**，对 50 万/月额度绰绰有余（还叠加批改高峰突发也在月耗 10 万量级以内）。
   同一时刻本地上面的队列在正常干活（DBSIZE 3→15）⇒ 系统稳态烧速就是低。
2. **`quota/status` 的 Usage 冻结在 500003 不动**：13:38 报 500003，14:12 还是 500003。若 13:06 后真有
   「66 分钟 × 126 req/s」的疯烧，usage 应冲到百万级——停在超额点不动 = 超额后几乎没有成功请求 = 没有东西在持续猛打。
3. **代码侧理论账**：心跳（旧 60s 时代 ~43K/月/实例）+ BullMQ drainDelay 60s/stalledInterval 5min
   （< 10 req/min）+ 任务处理突发 ⇒ 三周 ~50 万/月正常烧完，量级完全吻合；重连风暴有界
   （retryStrategy 最多 5 次）。

**勘误**：§1/§6 所述「13:06 额度已恢复（月中重置）」与「13:06 重置后 66 分钟烧穿 50 万（126 req/s）」
**不成立**——13:06 与 14:16 的「通」都是软封锁的**放行窗口**（本探针恰好赶上），不是重置；
14:38 起主库/备1 持续拒连 = 封锁收紧。r306 memory 里「额度月中恢复」同此勘误。
（`startBreakerProbe` 的设计不受影响：无论「恢复」来自重置还是放行窗口，探针都能自动归队。）

**烧速账修正后**：旧心跳 60s 时代三实例 ~130K/月是账号①②烧穿的最大单一贡献项；
本轮高峰分化（高峰 60s/低峰 30min）后 ~38K/月，叠加 mollusk 独立账号，**到 11-01 自然月重置前
mollusk 单独扛完全够**；11-01 后三账号 150 万/月 + 三棒 failover 分摊，结构性充裕。
r305-P-C 的「付费层」选项优先级显著下降（维持观察，若 mollusk 月耗异常再议）。

## §9 终局验证（15:01-15:13）——三棒链条全绿，r305-P-B 正式关闭

负责人 15:01 前贴好 `REDIS_POOL_URLS`。为破「env 贴了但 connected:false」的可观测性僵局，
本轮新增 `GET /api/diagnostics/redis-pool`（commit `861df68`，暴露 `redisManager.getStats()`，
不含 URL/密码；顺带修复 index.js 此前未导入 redisManager 的问题）。部署后 15:13:39 实测：

```
total:3  connected:1  current:upstash_backup_2
quotaExhausted: [upstash_primary, upstash_backup_1]
upstash_primary(priority1): connected=false, 熔断   ← superb-mallard 账号①，超额
upstash_backup_1(priority2): connected=false, 熔断  ← first-skunk 账号②，超额
upstash_backup_2(priority3): connected=true         ← mollusk 账号③，接管服务
worker-status: available=true, redis.connected=true
```

- **负责人贴的池子串完全正确**：`total:3` 证明两条 `rediss://` 备库链接全部解析入池；
- **故障转移端到端工作**：主库/备1 被真实配额错误标记熔断（非误标），mollusk 自动接管；
- 15:04 短暂的 `connected:false` 是 boot 后惰性初始化 + 重试退避（primary/first-skunk 各 ~30s）的时序，
  非配置错误——这正是新增池子端点的价值：状态一查便知，不再靠猜；
- 遗留自动兜底：主库/备1 由 `startBreakerProbe`（900s）持续回探，11-01 额度重置自动归队，无需人工。
