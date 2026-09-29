import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import playwright from 'eslint-plugin-playwright';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/.venv/**',
      '**/.venv',
      'coverage/**',
      '.git/**',
      'vite.config.js',
      'vite.config.d.ts',
      '*.tsbuildinfo',
      '.trae/**',
      'src/vite-env.d.ts',
    ],
  },

  // 基础推荐
  js.configs.recommended,
  tseslint.configs.recommended,

  // React 相关
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Prettier 兼容（关闭与 Prettier 冲突的格式规则）
  prettierConfig,

  // 项目自定义规则
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // 棘轮档（R32 的历史形态，现已被下方全量档全覆盖）：类型感知的「Promise 必须被消费」检查
  // 存在理由：`confirmInquiry(...)` / `cancelInquiry(...)` 这类写操作只返回 Promise，
  // 调用方不 await 就直接弹成功提示，等于在替用户伪造结果；tsc 抓不到，只有类型推断
  // 才能判定「这个调用的返回值被丢掉了」。
  // 当年按文件逐个纳入的代价读数是历史事实，保留在这里：HEAD 10ac8f8 上该规则 78 处命中、
  // 非测试代码 55 处（src/pages 27、store 8、App/main 8、其余 12，详见风险登记册 R32）。
  // 注意：本档的 `files` 名单**已不再决定适用域**——下方全量档覆盖整棵 src/，
  // 这里只保留"这三页先纳入"的决策记录；删掉它不会让任何文件脱离检查。
  {
    files: [
      'src/pages/quotation/compare/index.tsx',
      'src/pages/inquiry/detail/index.tsx',
      'src/pages/supplier/detail/index.tsx',
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // 全量档（R32 收口）：整棵 src/ —— 生产代码与 src/**/__tests__ 一并纳入。
  // 落地代价实测：22 文件 72 处（非测试 49、测试 23；按"去掉 void 后与改前逐字相同"能严格
  // 配上的 68 处 + 2 处 `if (…) void navigate(…)` + excel.ts 被 prettier 拆行的 2 处）。
  // 牙已验过两极性：往 src/ 放一行裸 `Promise.resolve(1);` → eslint rc=1 点名本规则；
  // 同一行加 `void` → rc=0。19 处 navigate() 是 react-router 的类型假阳性
  // （`navigate` 声明为返回 `void | Promise<void>`），本机插件的 checkThenables 默认已 false
  // 仍开火，只能按现状 `void`。
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // R45：e2e 侧的 Playwright 规范档（选型与实测命中面见风险登记册九度复评《技术选型》一节）。
  // 决策依据不是文档而是现算读数：整包 flat/recommended 在今天的 e2e/ 上报
  // 14 条（0 error / 14 warning，7 个文件），而本仓 lint 门是 `--max-warnings=0` ⇒ 14 条今天全算红。
  // 逐条读完分三类：真债→改测试（no-conditional-expect / no-force-option / no-conditional-in-test
  // 的命中点，个别确属"按实测选断言"的形状就地 eslint-disable 写理由）；
  // 下面这三条**关档**，因为它们要禁的正是本仓已经用对照验过的写法：
  //   · no-wait-for-timeout —— 把写请求挂住之后必须真的等一会儿才构成"窗口"，
  //     换成 web-first 等待等于窗口不存在（`toast-impersonation.spec.ts` 的承重对照量过：
  //     没有这个撑窗，删掉注入用例照样绿）。
  //   · prefer-to-have-count —— 它把一次性 `count()` 读数改回 `toHaveCount(0)`，
  //     而后者是重试型 matcher，会被"出现过又淡掉"的提示在淡出之后凑成 0（本轮真实踩过）。
  //   · no-skipped-test —— 本仓唯一的 skip 带布局条件与理由（窄屏没有批量入口），
  //     禁掉它等于把"哪些格子只在桌面可测"这条信息藏起来。
  // 其余 recommended 规则今天命中 0（含 missing-playwright-await / no-networkidle /
  // no-element-handle / no-eval / valid-expect / no-unsafe-references 等），接进来即绿并棘住后续写法。
  {
    files: ['e2e/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-wait-for-timeout': 'off',
      'playwright/prefer-to-have-count': 'off',
      'playwright/no-skipped-test': 'off',
    },
  },
);
