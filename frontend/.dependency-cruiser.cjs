/**
 * Architecture fitness rules for the frontend.
 *
 *   npx depcruise --config .dependency-cruiser.cjs src
 *
 * Rules below codify the layering we agreed on:
 *   pages → components → ui (primitives) and services → lib
 * Reverse edges (e.g. a primitive depending on a page) fail the build.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports are forbidden — refactor to break the cycle.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'This module is not used anywhere — consider deleting it.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)test/',
          '(^|/)stories/',
          'vite\\.config\\.',
          'vitest\\.config\\.',
          'playwright\\.config\\.',
          'main\\.tsx$',
          'tailwind\\.config\\.',
          'postcss\\.config\\.',
        ],
      },
      to: {},
    },
    {
      name: 'ui-no-page-imports',
      severity: 'error',
      comment: 'UI primitives must not depend on pages.',
      from: { path: '^src/components/ui/' },
      to: { path: '^src/pages/' },
    },
    {
      name: 'lib-no-page-imports',
      severity: 'error',
      comment: 'Library helpers must not depend on pages or services.',
      from: { path: '^src/lib/' },
      to: { path: '^src/(pages|services)/' },
    },
    {
      name: 'services-no-page-imports',
      severity: 'error',
      comment: 'Service modules must not import from pages.',
      from: { path: '^src/services/' },
      to: { path: '^src/pages/' },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'Production source must not depend on devDependencies.',
      from: { path: '^src/', pathNot: ['\\.(test|spec|stories)\\.'] },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
}
