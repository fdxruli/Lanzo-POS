import baseConfig from './vite.config.js';
import { defineConfig } from 'vite';

const resolvedBase = await (typeof baseConfig === 'function'
  ? baseConfig({ mode: 'test', command: 'serve' })
  : baseConfig);

export default defineConfig({
  ...resolvedBase,
  test: {
    ...resolvedBase.test,
    reporters: [
      'default',
      './scripts/diagnostics/pr378/reporter.mjs',
      ['json', { outputFile: process.env.PR378_DIAGNOSTIC_JSON_PATH }],
    ],
    logHeapUsage: true,
  },
});
