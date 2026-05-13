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

  // Rule: the lower layers (store/domain/sources/services/transport/util) must
  // not import the legacy facade. They should depend on peer modules under
  // src/ directly so the layered architecture stays acyclic.
  //
  // src/http/ is intentionally exempt — it's the public entry point and the
  // integration tests mock dataService.js as a single boundary. Migrating
  // those mocks to per-module paths is a separate refactor.
  {
    files: [
      'src/store/**/*.js',
      'src/domain/**/*.js',
      'src/sources/**/*.js',
      'src/services/**/*.js',
      'src/transport/**/*.js',
      'src/util/**/*.js'
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '../../dataService.js',
          message: 'Import from the peer module under src/ instead. The dataService.js facade is for legacy callers and HTTP routes only; lower layers should not depend on it.'
        }, {
          name: '../../../dataService.js',
          message: 'Import from the peer module under src/ instead. The dataService.js facade is for legacy callers and HTTP routes only; lower layers should not depend on it.'
        }]
      }]
    }
  }
];
