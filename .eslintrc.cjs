/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/src-tauri/target/**',
    '**/src-tauri/gen/**',
    '**/android/**',
    '**/ios/**',
    '**/*.config.js',
    '**/*.config.ts',
    '**/*.d.ts',
    '**/pnpm-lock.yaml',
  ],
  rules: {
    // 允许显式 any（逐步收紧）
    '@typescript-eslint/no-explicit-any': 'off',
    // 未使用变量只警告，避免历史代码阻塞
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // 允许 require（部分配置文件需要）
    '@typescript-eslint/no-var-requires': 'off',
    // 类型导入不强求
    '@typescript-eslint/consistent-type-imports': 'off',
    // console 只警告
    'no-console': 'off',
    // 优先使用 const
    'prefer-const': 'warn',
  },
  overrides: [
    {
      files: ['*.tsx', '*.jsx'],
      plugins: ['react', 'react-hooks'],
      extends: [
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
      ],
      settings: {
        react: {
          version: 'detect',
        },
      },
      rules: {
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/display-name': 'off',
        'react/no-unescaped-entities': 'off',
      },
    },
    {
      files: ['*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'],
      env: {
        jest: true,
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
