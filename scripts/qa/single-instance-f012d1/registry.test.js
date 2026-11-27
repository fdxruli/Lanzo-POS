// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';

it('records registration order through actual cold commercial auto-bootstrap imports', async () => {
  vi.resetModules();
  const { default: logger } = await import('../../../src/services/Logger');
  const log = vi.spyOn(logger, 'log');
  try {
    // Starting with the orchestrator is NOT equivalent to commercial cold
    // import order (it exposed an existing cycle). Start at the actual auto root.
    await import('../../../src/services/sync/posSyncBootstrapAutoCoordinator');
    const { posSyncOrchestrator: pos } = await import('../../../src/services/sync/posSyncOrchestrator');
    const sourceNames = {
      Products: 'productSyncHandler', Customers: 'customerSyncHandler',
      CustomerCredit: 'customerCreditSyncHandler', Cash: 'cashSyncHandler',
      SalesCloud: 'salesCloudSyncHandler', Layaways: 'layawaySyncHandler',
      RestaurantOrders: 'restaurantOrdersSyncHandler'
    };
    let pending = [];
    const calls = [];
    for (const [message] of log.mock.calls) {
      const text = String(message);
      const registration = text.match(/^\[PosSync\] Handler registrado para entidad: (\w+)$/);
      if (registration) pending.push(registration[1]);
      const group = text.match(/^\[(\w+)\/Sync\] Handler /);
      if (group && sourceNames[group[1]]) {
        calls.push(...pending.map(entity => ({ entity, handler: sourceNames[group[1]] })));
        pending = [];
      }
    }
    const effective = Object.fromEntries(calls.map(call => [call.entity, call.handler]));
    expect(calls).toHaveLength(19); expect(pending).toEqual([]);
    // Movement notifications fan out at read dispatch, never through competing
    // lifecycle/Outbox registrations. Detect any duplicate registry owner.
    expect(new Set(calls.map(call => call.entity)).size).toBe(calls.length);
    expect(Object.keys(effective).sort()).toEqual(pos.getStatus().handlers.sort());
    expect(effective).not.toHaveProperty('inventory_movement');
    expect(effective).toMatchObject({
      category: 'productSyncHandler',
      active_ingredient: 'productSyncHandler',
      product: 'productSyncHandler',
      product_batch: 'productSyncHandler',
      inventory_entry: 'productSyncHandler',
      sale: 'salesCloudSyncHandler',
      sale_item: 'salesCloudSyncHandler',
      sale_payment: 'salesCloudSyncHandler',
      sale_cancellation: 'salesCloudSyncHandler',
      layaway: 'layawaySyncHandler',
      layaway_payment: 'layawaySyncHandler',
      layaway_inventory_reservation: 'layawaySyncHandler'
    });
    expect(new Set(Object.values(effective)).size).toBe(7);
    mkdirSync('scripts/qa/single-instance-f012d1/evidence', { recursive: true });
    writeFileSync('scripts/qa/single-instance-f012d1/evidence/registrations.json', JSON.stringify({
      entry: 'cold posSyncBootstrapAutoCoordinator module graph, no start or activation',
      provenance: 'Actual registry logs, correlated with synchronous source-module registration groups; registry keys cross-checked directly.',
      calls, effective,
      limit: 'Actual auto root cold import order. No duplicate entity registration observed. Inventory movement read fan-out is verified independently in posSyncOrchestrator.realHandlers.test.js; no universal hot-registration claim.'
    }, null, 2));
  } finally { log.mockRestore(); }
});
