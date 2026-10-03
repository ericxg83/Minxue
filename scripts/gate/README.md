# 闸门④冒烟工具（循环任务常驻）

四道闸第④道「真机级冒烟」的标准工具。临时件（根目录 `_*`）会话间即失，2016-10-04 r96 起
改用本目录常驻版，避免每轮重写。

## 前置（都踩过坑，见 docs/auto/HANDOFF.md 第二-1 条与 backlog r94/r95 节）

```bash
# 1. 后端（Redis=Memurai 服务常驻 6379，一般不用管；后端会话间会被系统回收）
node server/index.js > _backend.log 2>&1 &

# 2. 隔离构建（⛔ 三个环境变量都别省：VITE_API_URL=/api 防烤入生产 API base；
#    MSYS_NO_PATHCONV=1 防 Git Bash 把 /api 改写成 C:/Program Files/Git/api）
MSYS_NO_PATHCONV=1 VITE_API_URL=/api CODEBUDDY_SAFE_DELETE_ENABLED=0 \
  npx vite build --outDir dist_nightly_$(date +%Y%m%d)rNN

# 3. 预览（⛔ 必带 --outDir，不带服务的是陈旧 dist/）
npx vite preview --port 5227 --strictPort --outDir dist_nightly_$(date +%Y%m%d)rNN &
```

## 跑法

```bash
node scripts/gate/cert_probe.mjs http://127.0.0.1:5227   # 先跑：零外部 origin、零 requestfailed
node scripts/gate/render_smoke.mjs http://127.0.0.1:5227 # 再跑：双端真渲染 8 项全 PASS
```

- `cert_probe` 若发现 `minxue-api.onrender.com` ⇒ 产物烤入了生产 base，重建（步骤 2）。
- 服务对象验明：curl 新产物 main chunk 应回 `Content-Type: text/javascript`；
  不存在的路径回 200 + `text/html` 是 SPA fallback（假 200，别被骗）。
- Windows 杀不净的 preview 子进程：`netstat -ano | grep :PORT` 找 PID → `taskkill //F //PID`。
