import { spawnSync } from 'node:child_process';

const validations = [
  {
    key: 'specific_lint',
    command: 'npx',
    args: [
      'eslint',
      'src/pages/SettingsPage.jsx',
      'src/pages/settingsPageAccess.js',
      'src/services/ecommerce/ecommerceAdminService.js',
      'src/pages/__tests__/settingsPageAccess.test.js',
      'src/services/ecommerce/__tests__/ecommerceAdminService.test.js'
    ]
  },
  {
    key: 'specific_tests',
    command: 'npx',
    args: [
      'vitest',
      'run',
      'src/pages/__tests__/settingsPageAccess.test.js',
      'src/services/ecommerce/__tests__/ecommerceAdminService.test.js'
    ]
  },
  {
    key: 'global_lint',
    command: 'npm',
    args: ['run', 'lint']
  },
  {
    key: 'global_tests',
    command: 'npm',
    args: ['run', 'test:ci']
  },
  {
    key: 'production_build',
    command: 'npx',
    args: ['vite', 'build']
  }
];

const results = {};

for (const validation of validations) {
  console.log(`\n===== ECOM.FE.ADMIN.1.1.1 ${validation.key} =====`);
  const result = spawnSync(validation.command, validation.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: 'true'
    },
    stdio: 'inherit'
  });

  results[validation.key] = Number.isInteger(result.status) ? result.status : 1;
  console.log(`===== ${validation.key} exit=${results[validation.key]} =====`);
}

console.log(`ECOM_FE_ADMIN_1_1_1_VALIDATION_SUMMARY=${JSON.stringify(results)}`);

process.exitCode = [
  results.specific_lint,
  results.specific_tests,
  results.production_build
].some((status) => status !== 0) ? 1 : 0;
