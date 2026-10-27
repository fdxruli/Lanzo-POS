import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
const out = resolve(process.argv[2] || 'scripts/qa/single-instance-f011/evidence');
mkdirSync(out, { recursive: true });
const selectors = [
  'src/services/auth/__tests__', 'src/services/tenant/__tests__', 'src/services/db/__tests__',
  'src/pwa/__tests__', 'src/services/financial/__tests__', 'src/services/sync/__tests__/syncOutboxService',
  'src/services/sync/__tests__/posSyncBootstrap', 'src/components/common/__tests__/PosApplicationBootstrap',
  'src/__tests__/main.initialRecoveryBootstrap.test.jsx', 'src/store/slices/license/__tests__/licenseBootstrapCoordinator.test.js',
  'src/store/slices/license/__tests__/licenseAdminActions.localRecovery.test.js',
  'src/components/common/__tests__/StaffLoginModal.verification.test.jsx',
  'src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js',
];
writeFileSync(join(out, 'selectors.json'), JSON.stringify(selectors, null, 2));
const args = ['node_modules/vitest/vitest.mjs', 'run', ...selectors, '--maxWorkers=2', '--reporter=json', `--outputFile=${join(out, 'regressions.json')}`];
const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 25 * 1024 * 1024 });
writeFileSync(join(out, 'regressions.log.gz'), gzipSync(`${result.stdout || ''}\n${result.stderr || ''}`));
writeFileSync(join(out, 'regressions-exit.json'), JSON.stringify({ command: [process.execPath, ...args], exitCode: result.status, error: result.error?.message }, null, 2));
process.exitCode = result.status ?? 1;
