# 敏学系统架构

## 系统组成

敏学由移动端、PC 教师工作台、Express 后端、异步任务、数据库、对象存储和 AI/OCR 能力组成。

- 移动端位于 `src/`，使用 React 18、Vite 和 Zustand。
- PC 教师工作台位于 `src/workbench/`，使用 Vue 3、Pinia 和 Element Plus。
- 后端位于 `server/`，主要入口为 `server/index.js`。
- 批改异步任务由 `server/queue.js`、`server/worker.js` 和 BullMQ/Redis 处理。
- 数据库存储使用 PostgreSQL/Neon。
- 图片和文件使用阿里 OSS。
- AI/OCR 能力由后端配置和 Worker 调用。

## 后端结构

后端同时存在两种 API 形态：

1. `server/index.js` 中的历史内联 API。
2. `server/routes/` 中逐步拆分的新模块。

两种形态不能默认视为完全等价。修改 API 时需要确认实际路由、调用方和兼容行为。

## 异步处理

作业批改主要由 Worker 执行。Redis/BullMQ 可用时，任务进入队列；在 Redis 不可用的场景，系统存在同步调用 Worker 的处理路径。

批改完成后，知识点关联和掌握度同步通常以后台非阻塞方式执行，因此相关结果具有最终一致性特征。

## 数据库演进

项目包含数据库 Schema 和多次迁移。静态 Schema 与实际迁移链存在差异，数据库相关行为需要结合实际迁移顺序和运行结构理解。

`tasks`、`questions`、`wrong_questions` 等核心表经历过软删除、外键行为调整和自包含错题支持等演进，不能只依据早期 Schema 判断当前行为。

## 前端调用

移动端 React 和 PC Vue 都可能调用公共后端 API。修改公共接口、任务状态或数据写入后，需要同时检查两端调用以及前端缓存失效逻辑。

## 核心边界

作业批改、错题、知识点掌握度、练习册答案库、组卷重练和讲义持久化结构共同构成核心业务链路。它们之间存在数据和状态依赖，修改任一部分都需要分析关联影响。
