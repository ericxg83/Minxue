# 敏学App V3 轻量化秒开方案实施计划

## 一、现状分析

### 1.1 技术栈
- **前端**: React 18 + Vite + Tailwind CSS + Zustand + Framer Motion
- **后端**: Express.js + Multer + BullMQ (Redis)
- **数据库**: Supabase (PostgreSQL + Storage)
- **状态管理**: Zustand (纯内存，无持久化)
- **缓存**: 已有 localStorage 缓存层（supabaseService.js）

### 1.2 现有缓存机制
- 已有基于 localStorage 的缓存读写工具（readCache/writeCache）
- 缓存有效期：学生15分钟、任务5分钟、试卷10分钟、题目5分钟、错题5分钟
- 已有缓存失效机制（invalidateCache）
- **问题**: 页面切换时未优先读取缓存，而是直接请求数据库

### 1.3 数据流问题
- 当前页面切换是串行加载（先加载任务→再加载题目）
- 无预加载机制
- 无骨架屏，用户感知等待明显
- 图片存储在 Supabase Storage，国内访问速度一般

---

## 二、目标架构

### 2.1 数据存储分层
| 数据类型 | 存储方案 | 说明 |
|---------|---------|------|
| 学生列表 | Neon PostgreSQL | 动态数据，免费额度充足 |
| 任务列表 | Neon PostgreSQL | 动态数据，高频读写 |
| 题目列表 | Neon PostgreSQL | 动态数据，关联查询多 |
| 错题本 | Neon PostgreSQL | 动态数据，需要关联查询 |
| 生成试卷记录 | Neon PostgreSQL | 动态数据 |
| 作业图片 | 阿里OSS | 静态文件，CDN加速 |
| 试卷PDF | 阿里OSS | 静态文件，生成后直传 |

### 2.2 前端缓存策略
| 数据类型 | 缓存位置 | 有效期 | 策略 |
|---------|---------|--------|------|
| 学生列表 | localStorage | 15分钟 | 先读缓存，后台更新 |
| 任务列表 | localStorage | 10分钟 | 先读缓存，后台更新 |
| 题目列表 | localStorage | 5分钟 | 先读缓存，后台更新 |
| 错题本 | localStorage | 5分钟 | 先读缓存，后台更新 |
| 试卷列表 | localStorage | 10分钟 | 先读缓存，后台更新 |
| 页面状态 | sessionStorage | 会话级 | 页面切换保留状态 |

---

## 三、实施步骤

### Phase 1: 数据库迁移（Neon + OSS）

#### 3.1.1 Neon PostgreSQL 配置
1. 注册 Neon 免费账号，创建项目
2. 创建数据库表结构（与现有 Supabase 兼容）
3. 配置连接池和连接字符串
4. **文件变更**:
   - 新建 `server/config/neon.js` - Neon 客户端配置
   - 新建 `server/services/neonService.js` - 数据访问层
   - 修改 `server/config/supabase.js` - 保留兼容层

#### 3.1.2 阿里 OSS 配置
1. 注册阿里云账号，开通 OSS 免费额度
2. 创建 Bucket，配置 CDN 加速域名
3. 配置跨域访问规则
4. **文件变更**:
   - 新建 `server/config/oss.js` - OSS 客户端配置
   - 新建 `server/services/ossService.js` - 文件上传/下载服务
   - 修改 `server/index.js` - 上传接口改为直传 OSS

#### 3.1.3 后端服务改造
1. 将所有数据库操作从 Supabase SDK 迁移到 Neon (pg)
2. 文件上传从 Supabase Storage 迁移到阿里 OSS
3. 保持 API 接口不变，确保前端无感迁移
4. **文件变更**:
   - 修改 `server/services/supabaseService.js` → 改为 `neonService.js`
   - 修改 `server/index.js` - 更新导入和文件处理逻辑
   - 修改 `server/worker.js` - 更新任务处理器

### Phase 2: 前端缓存层强化

#### 3.2.1 缓存管理器封装
1. 新建统一的缓存管理器，支持：
   - 分级缓存（内存 → localStorage → sessionStorage）
   - 自动过期清理
   - 缓存版本控制（防止数据结构变更导致错误）
   - 压缩存储（大数组使用 LZ-string 压缩）
2. **文件变更**:
   - 新建 `src/utils/cacheManager.js`

#### 3.2.2 数据预加载引擎
1. 实现页面数据预加载：
   - 根据当前页面预测下一页面
   - 后台静默加载（requestIdleCallback）
   - 优先级队列管理
2. **文件变更**:
   - 新建 `src/utils/preloadEngine.js`

#### 3.2.3 并行请求封装
1. 封装统一的 API 请求层：
   - 自动缓存优先
   - 并行请求（Promise.all）
   - 请求去重（相同请求合并）
   - 后台刷新（stale-while-revalidate 模式）
2. **文件变更**:
   - 新建 `src/services/apiService.js`
   - 修改 `src/services/supabaseService.js` - 接入新缓存层

### Phase 3: 前端组件优化

#### 3.3.1 骨架屏组件
1. 为每个页面创建骨架屏：
   - `src/components/Skeleton/ProcessingSkeleton.jsx`
   - `src/components/Skeleton/PendingSkeleton.jsx`
   - `src/components/Skeleton/WrongBookSkeleton.jsx`
   - `src/components/Skeleton/ExamSkeleton.jsx`
2. **文件变更**:
   - 新建骨架屏组件目录

#### 3.3.2 页面级加载状态管理
1. 修改每个页面组件：
   - 优先从缓存渲染（立即显示）
   - 后台请求更新数据
   - 骨架屏 → 缓存数据 → 最新数据 的平滑过渡
2. **文件变更**:
   - 修改 `src/App.jsx` - 重构数据加载逻辑
   - 修改 `src/store/index.js` - 添加加载状态

#### 3.3.3 图片懒加载与OSS CDN
1. 所有图片使用懒加载（loading="lazy"）
2. 图片 URL 统一通过 CDN 域名访问
3. 缩略图与原图分离

### Phase 4: 请求优化

#### 3.4.1 首次加载并行化
1. 应用初始化时并行请求：
   ```javascript
   const [students, initialData] = await Promise.all([
     getStudents(),
     preloadInitialData()
   ])
   ```

#### 3.4.2 页面切换预加载
1. 底部导航 hover/click 时预加载目标页面数据
2. 使用 `requestIdleCallback` 在空闲时预加载

#### 3.4.3 数据变更主动刷新
1. 上传/确认/生成试卷后：
   - 立即更新本地缓存
   - 触发后台数据同步
   - 通知其他页面刷新

### Phase 5: 环境配置与部署

#### 3.5.1 环境变量
```bash
# Neon 数据库
NEON_DATABASE_URL=postgresql://...

# 阿里 OSS
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=minxue-app
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
OSS_CDN_DOMAIN=https://cdn.minxue.app

# 前端
VITE_API_URL=/api
VITE_OSS_CDN_DOMAIN=https://cdn.minxue.app
```

#### 3.5.2 部署配置
- 前端: Vercel/Cloudflare Pages（免费）
- 后端: Render/Railway（免费）
- 数据库: Neon（免费）
- 存储: 阿里 OSS（免费额度）

---

## 四、文件变更清单

### 新增文件
```
server/
  config/
    neon.js              # Neon 数据库配置
    oss.js               # 阿里 OSS 配置
  services/
    neonService.js       # Neon 数据访问层
    ossService.js        # OSS 文件服务

src/
  utils/
    cacheManager.js      # 统一缓存管理器
    preloadEngine.js     # 预加载引擎
  components/
    Skeleton/
      ProcessingSkeleton.jsx
      PendingSkeleton.jsx
      WrongBookSkeleton.jsx
      ExamSkeleton.jsx
```

### 修改文件
```
server/
  index.js               # 更新上传接口，使用OSS
  worker.js              # 更新数据库操作
  services/
    supabaseService.js   # 逐步替换为neonService

src/
  App.jsx                # 重构数据加载，添加骨架屏
  store/index.js         # 添加加载状态
  services/
    supabaseService.js   # 接入新缓存层
    apiService.js        # 新增统一API层
  config/
    supabase.js          # 添加Neon兼容
```

---

## 五、性能指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 首屏加载时间 | ~2-3s | <0.5s（缓存命中） |
| 页面切换时间 | ~1-2s | <0.3s（缓存命中） |
| 数据展示延迟 | ~1-2s | <0.5s |
| 图片加载时间 | ~2-5s | <1s（CDN加速） |
| 上传后数据可见 | ~3-5s | <1s |

---

## 六、风险控制

1. **数据迁移风险**: 保留 Supabase 作为备份，双写一段时间
2. **缓存一致性**: 实现缓存版本号机制，自动清理过期缓存
3. **OSS 成本**: 监控流量，设置告警
4. **Neon 限制**: 免费版有连接数限制，使用连接池

---

## 七、实施优先级

1. **P0（立即）**: 前端缓存层强化 + 骨架屏
2. **P1（本周）**: 并行请求优化 + 预加载
3. **P2（下周）**: Neon 数据库迁移
4. **P3（下下周）**: 阿里 OSS 迁移 + CDN
