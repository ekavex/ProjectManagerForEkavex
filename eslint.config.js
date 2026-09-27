// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/api/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    // The API and everything that runs under Node needs the Node globals.
    files: ['apps/api/**', 'packages/**', 'e2e/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The web app runs in a browser.
    files: ['apps/web/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.es2023 } },
  },
  {
    // Scripts, seeds and tests are command-line tools: printing is how they report.
    files: [
      '**/scripts/**',
      '**/prisma/seed.ts',
      '**/tests/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'e2e/**',
    ],
    rules: { 'no-console': 'off' },
  },
);
