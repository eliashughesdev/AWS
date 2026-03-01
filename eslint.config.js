import neostandard from 'neostandard'

export default [
  ...neostandard({ ts: true }),
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  {
    rules: {
      // Codebase uses no space before function parens
      '@stylistic/space-before-function-paren': 'off',
      // Allow quoted properties (e.g., 'Content-Type')
      '@stylistic/quote-props': 'off',
      // Handled by TypeScript
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Allow hasOwnProperty calls
      'no-prototype-builtins': 'off',
      // Allow lowercase constructors
      'new-cap': 'off',
      // TODO: fix these remaining issues
      '@stylistic/no-multiple-empty-lines': 'off',
      '@stylistic/object-curly-newline': 'off',
      '@stylistic/object-curly-spacing': 'off',
    }
  }
]
