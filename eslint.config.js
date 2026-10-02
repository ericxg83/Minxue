/**
 * ESLint flat config（ESLint v9）。
 *
 * 为什么现在才补：`npm run lint` 脚本自始存在，但仓库从未有过 eslint.config.js
 * 或 .eslintrc.*，ESLint v9 直接报错退出——这条验证闸是空转的。夜间巡检依赖
 * 「lint / build / test 三闸」，其中 lint 必须先真的能跑，否则它给不出任何信号，
 * 还会给出「已经检查过了」的假安心。
 *
 * 取舍：只开「能指向真实缺陷」的规则，不开风格类。
 * 理由是一个每晚自动跑的巡检门，噪声多于信号就会被整体忽略，那比没有更危险。
 * 已知未覆盖：.vue / .ts / .tsx 未纳入——仓库没装 eslint-plugin-vue 与
 * typescript-eslint，教师工作台（src/workbench/**.vue 的模板层）目前是 lint 盲区，
 * 已在 nightly-audit 报告里作为固定缺口登记，不能当作「已检查」。
 * 注意 .vue 的 <script> 与 .ts/.tsx 同理不被本配置解析，但 .js 状态库
 * （src/workbench/stores/*.js）在闸内，首轮已抓到 no-undef 与重复键真缺陷。
 *
 * 修改纪律：放宽本文件任何规则、或往 ignores 里新增源码目录，等同于放宽门禁，
 * 必须与夜间巡检棘轮基线一并说明并经负责人确认。
 */
import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  {
    // 生成产物、构建快照、历史副本、一次性诊断脚本，一律不进闸。
    //
    // 为什么不靠 .gitignore 那套写法：仓库里 dist_gatefix/ dist_tmcheck/ dist_verify/
    // dist.old-*/ 这类构建快照目录用下划线或点分隔，`dist-*/**` 完全匹配不到，
    // 首轮实测 22.6 万个 error 里 98% 来自这些压缩产物，真信号会被彻底淹没。
    //
    // `**/_*` 是仓库既有约定（.gitignore 同步声明）：下划线开头 = 一次性排障产物，
    // 不承载产品逻辑，包括 _live_bundle.js / _online_main.js（线上产物比对件，
    // 各 2638 error）与 server/_diag_*.mjs 系列。
    //
    // 警惕：1/ 2/ 3/ 是被 git 跟踪的历史 App.tsx 副本（1078/1468/1775 行），这里
    // 只为 lint 排除；全局文本搜索仍会命中，巡检定位真实入口时必须先确认路径。
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-*/**',
      'dist_*/**',
      'dist.old-*/**',
      'dist_nightly_*/**',
      'dist-app/**',
      '__nightly_lint.json',
      'build/**',
      'android/**',
      'ios/**',
      'patches/**',
      'public/**',
      'external/**',
      '_scan/**',
      'deliverables/**',
      'multimodal_exam_engine/**',
      '1/**',
      '2/**',
      '3/**',
      'tmp/**',
      '**/_*',
      '**/._*',
      // Vite 编译配置时落盘的临时产物（.gitignore 里是 *.timestamp-*）
      'vite.config.js.timestamp-*.mjs',
      '.claude/**',
      '.impeccable/**',
      '.trae/**',
      '.cursor/**',
      '.arts/**',
      '.pai/**',
      '.workbuddy/**',
      '.workbuddy-ai/**',
      '.qoder/**',
      '.agents/**',
      '.github/**',
      '.codex-skill-staging/**',
      'impeccable-skill/**',
      'coverage/**'
    ]
  },

  js.configs.recommended,

  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2023,
        // vite.config.js 里 define 注入的编译期常量，非 lint 疏漏
        __WORKBENCH_BUNDLED__: 'readonly'
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      react,
      'react-hooks': reactHooks
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // ── 指向真实缺陷 ────────────────────────────────────────────────
      'no-undef': 'error',
      'no-unused-expressions': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': ['error', 'except-parens'],
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-unreachable': 'error',
      'require-atomic-updates': 'off',
      'no-var': 'error',

      // 全角空格：只查代码结构位置，字符串/模板/注释里的中文排版空格是内容不是缺陷，
      // 否则 OCR 与讲义模板相关代码会恒定刷出几十个假阳性。
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true }
      ],
      // 正则里的多余转义：可读性问题不是缺陷，首轮源码内 96 处，降为警告
      'no-useless-escape': 'warn',
      'no-empty': ['error', { allowEmptyCatch: false }],

      // ── 变量未使用：warning，不当作门禁 ─────────────────────────────
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true
        }
      ],

      // ── React：只开会造成运行时错误或渲染错误的双子 ────────────────
      'react/jsx-key': 'error',
      // jsx-uses-vars（2026-10-02 提案6，负责人批准）：JSX 中使用的导入计入"已使用"。
      // 缺它会导致移动端 265 处假阳性（Suspense 判死但 JSX 用了 14 次），
      // 真死代码被假警报淹没——此规则让 linter 更准，不是放宽门禁。
      'react/jsx-uses-vars': 'error',
      'react/no-unescaped-entities': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps 属于「可优化」而非「有 bug」，不设门禁，避免噪声淹没真信号
      'react-hooks/exhaustive-deps': 'off',

      // ── recommended 里明确关掉的噪声项（保持基线可读）────────────────
      'no-console': 'off',
      'no-debugger': 'error'
    }
  },

  {
    // 一次性脚本目录：仓库约定用 gitignore 排除，_ 前缀那批已整体 ignore，
    // 这里只放宽 server/scripts 与 scripts 下数据修复脚本的噪声规则。
    files: ['server/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    rules: {
      'no-empty': 'off',
      'no-process-exit': 'off'
    }
  }
]
