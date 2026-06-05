const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', '.npm-cache/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['src/renderer.js', 'src/x-capture-preload.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
