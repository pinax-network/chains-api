// ESLint flat config (eslint 10+).
//
// Minimal setup: the only real rule today is `no-restricted-imports` on
// `src/**/*.js`, which prevents new code from importing the legacy
// `dataService.js` facade. New code should depend on the per-domain
// modules under `src/` directly so the facade can eventually be deleted.
//
// To run: `npm run lint`. CI runs it via the test workflow.

export default [
  {
    ignores: [
      'node_modules/**',
      'graphify-out/**',
      '.cache/**',
      'coverage/**',
      'public/**'
    ]
  },

  // Rule: nothing under src/ may import the legacy dataService.js facade.
  // Routes should depend on per-domain modules under src/ directly; lower
  // layers (store/domain/sources/services) likewise. The integration tests
  // mock each src/ path individually via vi.hoisted() so this constraint
  // doesn't break test setup.
  {
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '../../dataService.js',
          message: 'Import from the peer module under src/ instead. dataService.js is a thin re-export facade for legacy callers only; new code should not depend on it.'
        }, {
          name: '../../../dataService.js',
          message: 'Import from the peer module under src/ instead. dataService.js is a thin re-export facade for legacy callers only; new code should not depend on it.'
        }]
      }]
    }
  }
];
