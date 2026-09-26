import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
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

  // 棘轮档：类型感知的「Promise 必须被消费」检查（R32）
  // 存在理由：`confirmInquiry(...)` / `cancelInquiry(...)` 这类写操作只返回 Promise，
  // 调用方不 await 就直接弹成功提示，等于在替用户伪造结果；tsc 抓不到，只有类型推断
  // 才能判定「这个调用的返回值被丢掉了」。全仓一次性开启的代价已实测（HEAD 10ac8f8 上
  // 该规则 78 处命中，非测试代码 55 处：src/pages 27、store 8、App/main 8、其余 12，
  // 详见风险登记册 R32），故按文件逐个纳入：新页面补齐后加进 files 即可，
  // 未列出的文件不受影响，已列出的文件回归即红。
  {
    files: ['src/pages/quotation/compare/index.tsx', 'src/pages/inquiry/detail/index.tsx'],
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
);
