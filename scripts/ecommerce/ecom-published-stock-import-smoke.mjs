import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const importOrder = process.argv[2];
assert.ok(['store-first', 'service-first'].includes(importOrder), 'IMPORT_ORDER_REQUIRED');

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [react()],
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] }
});

let exitCode = 0;
try {
  let storeModule;
  let serviceModule;
  if (importOrder === 'store-first') {
    storeModule = await server.ssrLoadModule('/src/store/useAppStore.js');
    serviceModule = await server.ssrLoadModule('/src/services/ecommerce/ecommercePublishedStockAlertService.js');
  } else {
    serviceModule = await server.ssrLoadModule('/src/services/ecommerce/ecommercePublishedStockAlertService.js');
    storeModule = await server.ssrLoadModule('/src/store/useAppStore.js');
  }

  assert.equal(typeof serviceModule.createEcommercePublishedStockAlertService, 'function');
  const state = storeModule.useAppStore.getState();
  assert.equal(typeof state.loadEcommercePublishedStockAlerts, 'function');
  assert.equal(typeof state.invalidateEcommercePublishedStockAlerts, 'function');

  const service = serviceModule.createEcommercePublishedStockAlertService({
    getState: () => ({
      licenseDetails: { license_key: 'isolated-smoke-license' },
      currentDeviceRole: 'admin',
      deviceFingerprint: 'isolated-smoke-device'
    }),
    getPortal: async () => ({ success: true, portal: { status: 'published' } }),
    getPublishedProducts: async () => ({ success: true, products: [] })
  });
  const result = await service.evaluatePublishedProductStockAlerts();
  assert.equal(result.success, true);
  assert.equal(result.publishedCount, 0);

  process.stdout.write(`ECOM_STOCK_ALERT_IMPORT_ORDER_PASS:${importOrder}\n`);
} catch (error) {
  exitCode = 1;
  console.error(error);
}

await Promise.race([
  server.close().catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 250))
]);
process.exit(exitCode);
