import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const smokeScript = fileURLToPath(new URL('../../../../scripts/ecommerce/ecom-published-stock-import-smoke.mjs', import.meta.url));

const runIsolatedImportOrder = (importOrder) => spawnSync(
  process.execPath,
  [smokeScript, importOrder],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: process.env
  }
);

describe('published stock alert module initialization', () => {
  it.each(['store-first', 'service-first'])('supports %s in repeated isolated Node processes', (importOrder) => {
    for (let run = 0; run < 2; run += 1) {
      const result = runIsolatedImportOrder(importOrder);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(`ECOM_STOCK_ALERT_IMPORT_ORDER_PASS:${importOrder}`);
    }
  }, 30_000);
});
