import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
const selectors = [
  'src/services/instance/__tests__',
  'src/services/auth/__tests__', 'src/services/tenant/__tests__', 'src/services/db/__tests__',
  'src/pwa/__tests__', 'src/architecture/__tests__', 'src/services/financial/__tests__',
  'src/services/sync/__tests__/syncOutboxService', 'src/services/sync/__tests__/posSyncBootstrap',
  'src/components/common/__tests__/PosApplicationBootstrap', 'src/components/common/__tests__/DatabaseRecoveryGate',
  'src/__tests__/main.initialRecoveryBootstrap.test.jsx', 'src/store/slices/license/__tests__/licenseBootstrapCoordinator.test.js',
  'src/store/slices/license/__tests__/licenseAdminActions.localRecovery.test.js',
  'src/components/common/__tests__/StaffLoginModal.verification.test.jsx',
  'src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js',
  'src/services/cash', 'src/services/__test__/db/salesRepository.test.js',
  'src/services/__test__/sales/splitOrderService.test.js', 'src/services/__tests__/layawayFinancialService.test.js',
  'src/services/salesCloud/__tests__/salesCloudFinancialRetry.integration.test.js',
  'src/services/inventory/__tests__/inventoryEntryService',
];
writeFileSync(join(out, 'selectors.json'), JSON.stringify(selectors, null, 2));
const args = ['node_modules/vitest/vitest.mjs', 'run', ...selectors, '--maxWorkers=2', '--reporter=json', `--outputFile=${join(out, 'regressions.json')}`];
const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
writeFileSync(join(out, 'regressions.log.gz'), gzipSync(`${r.stdout || ''}\n${r.stderr || ''}`));
writeFileSync(join(out, 'exit.json'), JSON.stringify({ command: [process.execPath, ...args], exitCode: r.status, error: r.error?.message }, null, 2));
process.exitCode = r.status ?? 1;
