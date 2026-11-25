/* ESLint 8 legacy config. Lints the TypeScript sources only; dist/ is build output. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    // The SiYuan API returns loosely shaped JSON and the code types much of it as `any`
    // (about 260 uses when this config was added). Flag new ones without failing the run.
    '@typescript-eslint/no-explicit-any': 'warn',
    // Handlers must keep the base class's execute(args, context) signature even when a tool
    // ignores one; the underscore marks that as deliberate.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
