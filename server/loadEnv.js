/**
 * 环境变量加载 —— **必须是入口文件的第一个 import**。
 *
 * 为什么单独成一个文件（2026-09-21 事故）：
 *   ESM 的静态 import 会在**模块体执行之前**全部求值。原先各入口把
 *   `dotenv.config()` 写在模块体里（`index.js:59`、`worker.js:6`），
 *   于是第 4–56 行 import 进来的模块（`config/ai.js`、`services/aiJudgeService.js`、
 *   `routes/worksheets.js`、`worker.js` …）在读取 `process.env` 时 dotenv **还没跑**
 *   → 一律拿到 `undefined`，静默走硬编码默认值。
 *
 *   实测后果（本地复现 `_t_envorder.mjs`）：
 *     `process.env.ANSWER_ENGINE_VENDOR` = "Bailian"（.env 里写了）
 *     `ANSWER_ENGINE.VENDOR`             = "SenseNova"（模块级读到的默认值）
 *   —— 也就是**答案引擎切 Bailian 一直没生效**，后端跑的是 SenseNova:deepseek-v4-pro。
 *
 *   为什么之前没被发现：验证脚本用 `await import()` **动态导入**（在 dotenv 之后），
 *   拿到的配置是对的；只有真正走静态 import 的入口是错的。
 *   「验证通过、线上没换」是最危险的偏差，所以这个文件的作用不只是修 bug，
 *   也是把「env 必须先加载」这条不变量固化成结构，而不是靠人记得写在第几行。
 *
 *   线上（Render）不受影响：平台先把环境变量注入 `process.env` 再启动 node。
 *   这个 bug 只在「本地用 .env 启动」时出现 —— 属于 dev/prod 不一致。
 *
 * 用法：入口文件第一行写 `import './loadEnv.js'`，早于任何其他 import。
 * 重复加载是安全的（`dotenv.config()` 不覆盖已存在的变量）。
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(here, '.env') })
