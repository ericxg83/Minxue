# 敏学 · 国内部署手册

## 0. 先说清楚：要搬哪几样

从沙箱实测，`minxue.pages.dev` 本身没挂（返回 200 + 真页面），你「打不开」是**国内网络到不了 Cloudflare Pages / Render / Neon**。

要彻底在国内稳定打开，必须把这 3 样都迁到国内，**存储和 AI 不用动**：

| 组件 | 现在在哪 | 国内可达？ | 怎么处理 |
|---|---|---|---|
| 前端静态资源 | Cloudflare Pages (`*.pages.dev`) | ❌ 被墙 | 迁到国内主机，挂你的域名 |
| 后端服务 | Render (`minxue-api.onrender.com`) | ❌ 不稳 | 迁到国内 ECS |
| 数据库 | Neon（新加坡） | ❌ 国内连不上 | 迁到国内 PostgreSQL |
| Redis（队列） | Upstash（国外） | ❌ 不稳 | 国内 ECS 自带 / 云 Redis |
| 对象存储 OSS | **阿里云 上海** | ✅ 本来就在国内 | **不动** |
| AI 供应商 | 魔搭 / 智谱 / 商汤（国内直连） | ✅ | **不动** |

> 只迁前端、后端还留 Render = 页面能开但接口全超时，等于没迁。后端和库必须一起搬。

---

## 1. 前置条件（你拍板/准备）

1. **域名 ICP 备案（必须）**。国内主机用自定义域名对外提供网站，管局强制要求备案；
   且国内 CDN/对象存储绑自定义域名也得先备案。在域名所在云厂商（阿里云/腾讯云）控制台提交，
   个人备案约 **1–2 周**。备案期间可先把 ECS + 服务跑起来用 IP 验证，但对外域名必须备案后生效。
2. **一台国内 ECS**（或轻量应用服务器）。建议：2 核 2G 起步，Ubuntu 22.04，
   **¥80–120/月**。阿里云 ECS 共享型 / 腾讯云轻量应用服务器都行。系统选 Ubuntu，因为本方案用 Docker。
3. **云账号 + 能开 80/443 入站防火墙**（安全组放行）。

> 不推荐「函数计算 FC / 云函数 SCF」：本系统有常驻 BullMQ worker（批改/几何/重绘队列）+ Chromium 渲染，
> 函数计算的短生命周期实例跑不稳，ECS 是正确选择。

---

## 2. 在 ECS 上准备 Docker

```bash
# Ubuntu
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
# 把当前用户加入 docker 组（免 sudo，重登生效）
sudo usermod -aG docker $USER
```

---

## 3. 把代码和构建产物弄到 ECS

两种方式任选：

**方式 A（推荐，ECS 上直接构建）：**
```bash
git clone <你的仓库地址> Minxue_App_V3 && cd Minxue_App_V3
cd deploy
# 构建前端
npm install && npm run build      # 产物在 ../dist，正好被 compose 挂进 nginx
```

**方式 B（开发机构建后传）：** 本地 `npm install && npm run build` 得到 `dist/`，
把整个 `deploy/` 目录（含 `dist/`）scp 到 ECS。

---

## 4. 配生产环境变量

```bash
cd deploy
cp .env.production.example .env.production
nano .env.production     # 填 OSS 密钥、AI 密钥、ALLOWED_ORIGIN=https://你的域名
```
数据库和 Redis 的连接串**不用填**——`docker-compose.yml` 已用容器内部主机名 `db` / `redis` 强制覆盖。

同时改 `docker-compose.yml` 里两处 `CHANGE_ME_DB_PASSWORD` 为强密码（db 服务和 app 服务的 environment 各一处，要一致）。

---

## 5. 拿 HTTPS 证书（有域名后做）

国内云厂商「SSL 证书」服务可免费申请 DV 证书，DNS 验证几分钟下发：
- 阿里云：SSL 证书控制台 → 免费证书 → 申请 → 下载 Nginx 格式（fullchain.pem / privkey.pem）
- 腾讯云：SSL 证书 → 申请免费证书 → 下载 Nginx 格式

放到 `deploy/certs/` 下（文件名对应 `nginx.conf` 里的路径）：
```
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```
> 想抢先验证又没证书：按 `nginx.conf` 顶部注释，临时注释 443 server、把 80 的 `return 302` 删掉并加 `root`，
> 用 http 先跑通，之后再换回 HTTPS。

---

## 6. 启动

```bash
cd deploy
docker compose up -d --build
docker compose ps          # 四个服务都 Healthy/Up
docker compose logs -f app # 看后端启动日志，确认 48 个迁移跑完、监听 3001
```

---

## 7. 数据迁移：从 Neon 迁到新 PostgreSQL

> ⚠️ 高风险操作，先备份、且**保留 Neon 不动**直到验证通过。
> 这步需要一台能同时连 Neon 和 ECS 的机器（你的开发机即可，开发机有 Neon 的访问权限）。

```bash
# (1) 导出 Neon（在开发机，NEON_DATABASE_URL 用现有值）
pg_dump "$NEON_DATABASE_URL" -Fc -f minxue_$(date +%F).dump

# (2) 传到 ECS
scp minxue_*.dump 你的ECS:/tmp/

# (3) 在 ECS 上恢复到 compose 的 db 容器
docker compose cp /tmp/minxue_*.dump db:/tmp/mig.dump
docker compose exec db pg_restore -U minxue -d minxue --clean --if-exists /tmp/mig.dump
```
恢复后后端启动时 `runMigrations` 会自动对齐（迁移表已记录，幂等，不会再跑）。

> 验证数据到位：`docker compose exec db psql -U minxue -d minxue -c "\dt"` 看表，
> 抽查 `select count(*) from students;` 等。

---

## 8. 域名解析

在你的 DNS 控制台把域名 A 记录指向 **ECS 公网 IP**（不是 Cloudflare 的 IP 了）：
```
A  @         <ECS公网IP>
A  www       <ECS公网IP>
```
国内云厂商 DNS 一般几分钟生效。

---

## 9. 验证清单

1. 浏览器开 `https://你的域名` → 应显示「敏学成长工作台」移动端首页。
2. 开 `https://你的域名/workbench` → PC 工作台。
3. 进一个学生 → 上传一张作业图 → 走完 OCR + 批改（验证后端、队列、OSS、AI 全链路）。
4. 出一份重练卷 PDF / 周报（验证 Chromium + 中文字体渲染正常，中文不能是方块）。
5. `docker compose logs app | grep -i error` 无异常。

---

## 10. 收尾 / 不再需要的东西

- **Render keepalive 不再需要**：ECS 7×24 常驻，没有 Render 免费实例 sleep 问题。
  原 `.github/workflows/keepalive.yml` 可保留也可删（它只 ping Render，迁完后无意义）。
- **Cloudflare Pages 可保留作备份**：验证通过后，pages.dev 仍可访问；ECS 出问题可临时切回。
  等稳定一段时间再考虑下线 Cloudflare。
- **Neon / Render 先别删**：保留 1–2 周作为回滚备份，确认无误再退订。

---

## 11. 回滚方案

若 ECS 出问题：把 DNS A 记录指回 Cloudflare（或临时用 `https://minxue.pages.dev`），
数据仍在 Neon（未删），即可恢复旧链路。前端代码无需改动（同源 /api 设计两边一致）。

---

## 12. 成本与风险小结

- 成本：ECS ¥80–120/月 + 域名 ¥几十/年（OSS/AI 已有，不新增）。比 Render+Neon 免费档贵，但换来国内稳定可达。
- 风险点：
  1. **Chromium 首次构建需联网**下载二进制（Dockerfile 已包含系统库 + 中文字体，构建时自动下）；
     若某环境拉不到，PDF 渲染会报错——这是唯一需首次部署实测验证的点。
  2. **备案未完成前域名不能对外**——先用 IP + 自签/云证书验证。
  3. **数据迁移先备份**：pg_dump 成功前不要动 Neon。
- 未做、需你确认的事项：云厂商选择（阿里云/腾讯云）、是否托管 RDS 还是自管 Postgres（本方案自管，最省成本）。
