// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  globalPull: vi.fn(),
  actor: { status: 'granted', generation: 1, sessionId: 'session-a', actorKey: 'staff:staff-a', permissions: ['*'] },
  actorListeners: new Set(),
  storePermissions: ['*'],
  details: null,
  generalCursor: 0,
  meta: new Map(),
  customerApplied: [],
  catalogApplied: [],
  salesApplied: [],
  customerResponses: [],
  catalogResponses: [],
  salesResponses: []
}));

const metaKey = (licenseKey, key) => `${licenseKey}:${key}`;

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: (...args) => mocks.rpc(...args) },
  getStableDeviceId: async () => 'test-device',
  getDeviceSecurityToken: async () => 'test-device-token',
  getActorSessionToken: async () => 'test-actor-token'
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      licenseDetails: mocks.details,
      currentDeviceRole: mocks.actor.actorKey?.startsWith('admin:') ? 'admin' : 'staff',
      canAccess: (permission) => mocks.storePermissions.includes('*') || mocks.storePermissions.includes(permission)
    })
  }
}));
vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' },
  actorRuntimeController: {
    getState: () => ({ ...mocks.actor }),
    subscribe: (listener) => {
      mocks.actorListeners.add(listener);
      return () => mocks.actorListeners.delete(listener);
    },
    capture: (permission = null) => {
      const captured = { ...mocks.actor };
      const hasPermission = (requiredPermission) => !requiredPermission
        || captured.permissions.includes('*')
        || captured.permissions.includes(requiredPermission);
      if (!hasPermission(permission)) {
        throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
      }
      return {
        actorKey: captured.actorKey,
        assertCurrent: (requiredPermission = permission) => {
          if (captured.status !== 'granted' || captured.generation !== mocks.actor.generation
            || captured.sessionId !== mocks.actor.sessionId) {
            throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
          }
          if (!hasPermission(requiredPermission)) {
            throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
          }
          return { ...mocks.actor };
        }
      };
    }
  },
  isActorRuntimeError: (error) => String(error?.code || '').startsWith('ACTOR_')
}));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: async () => ({ status: 'pass' }),
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation()
}));
vi.mock('../../tenant/localTenantPolicy', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    LOCAL_TENANT_STATUS: { ...actual.LOCAL_TENANT_STATUS, GRANTED: 'granted' },
    localTenantAccessController: { subscribe: () => () => {} }
  };
});
vi.mock('../syncMetaService', () => ({
  syncMetaService: {
    getMeta: async (key, fallback = null, { licenseKey } = {}) => mocks.meta.get(metaKey(licenseKey, key)) ?? fallback,
    setMeta: async (key, value, { licenseKey } = {}) => {
      mocks.meta.set(metaKey(licenseKey, key), value);
      return true;
    },
    advanceMeta: async (key, value, { licenseKey } = {}) => {
      const next = Math.max(Number(mocks.meta.get(metaKey(licenseKey, key)) || 0), Number(value));
      mocks.meta.set(metaKey(licenseKey, key), next);
      return next;
    },
    getLastChangeSeq: async () => mocks.generalCursor,
    advanceLastChangeSeq: async (value) => {
      mocks.generalCursor = Math.max(mocks.generalCursor, Number(value));
      return mocks.generalCursor;
    },
    setLastChangeSeq: async (value) => { mocks.generalCursor = Number(value); return true; },
    getDeferredReadPending: async () => mocks.meta.get(metaKey(mocks.details.license_key, 'deferred')) === true,
    setDeferredReadPending: async (value) => {
      mocks.meta.set(metaKey(mocks.details.license_key, 'deferred'), Boolean(value));
      return true;
    },
    getDeferredHandlerReads: async (licenseKey) => mocks.meta.get(metaKey(licenseKey, 'deferred_handlers')) || [],
    setDeferredHandlerReads: async (entityTypes, licenseKey) => {
      mocks.meta.set(metaKey(licenseKey, 'deferred_handlers'), [...entityTypes]);
      return true;
    },
    setLastPullAt: async () => true,
    setLastPullError: async () => true,
    setRealtimeStatus: async () => true,
    setSyncEnabled: async () => true
  }
}));
vi.mock('../posSyncClient', () => ({
  buildPosSyncAuthContext: async ({ licenseKey }) => ({
    licenseKey, deviceFingerprint: 'test-device', securityToken: 'test-device-token', staffSessionToken: 'test-actor-token'
  }),
  posSyncClient: { pullSyncEvents: (...args) => mocks.globalPull(...args) }
}));
vi.mock('../syncOutboxService', () => ({
  getCloudSyncProtocolFamilyForEntity: () => null,
  syncOutboxService: {
    resetStuckProcessing: async () => 0,
    getPendingOperations: async () => [],
    observeChanges: () => () => {},
    resumeUpdateRequired: async () => true
  }
}));
vi.mock('../../posRealtime', () => ({
  buildPosRealtimeTopic: () => null,
  startPosRealtimeListener: vi.fn(),
  stopPosRealtimeListener: vi.fn(async () => undefined)
}));
vi.mock('../../Logger', () => ({ default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_TTL: { MEDIUM: 1000, SHORT: 1000 },
  CLOUD_REQUEST_COOLDOWN: { SNAPSHOT: 0, SHORT: 0 },
  CLOUD_REQUEST_TAGS: { CUSTOMERS: 'customers', PRODUCTS: 'products' },
  buildBaseRpcContextFromArgs: () => ({}),
  buildRpcRequestKey: () => 'test-request',
  cloudRequestManager: { request: ({ fn }) => fn() },
  cloudRequestTags: { license: () => 'license', rpc: () => 'rpc' },
  invalidateCloudCacheAfterCustomerMutation: () => undefined,
  invalidateCloudCacheAfterCatalogMutation: () => undefined
}));
vi.mock('../../products/productLocalRepository', () => ({
  productLocalRepository: {
    applyCloudCatalog: async (response) => {
      mocks.catalogApplied.push(response);
      return {
        categories: (response.categories || []).length,
        products: (response.products || []).length,
        batches: (response.batches || []).length,
        rejected: []
      };
    },
    getLocalCatalogForMigration: async () => ({ products: [] })
  }
}));
vi.mock('../../products/productCategoryCloudGate', () => ({
  ensureCloudProductCategory: async () => ({ success: true }),
  getProductCloudConfirmationError: () => null
}));
vi.mock('../../products/productMigrationService', () => ({
  productMigrationService: { runInitialMigrationIfNeeded: async () => ({ success: true }), pullFullSnapshot: async () => ({ success: true }) }
}));
vi.mock('../../products/productLocalCatalogRecovery', () => ({
  productLocalCatalogRecovery: { savePermissionBlockedWarning: async () => ({ success: true }) }
}));
vi.mock('../../products/productConflictService', () => ({ productConflictService: { saveConflict: async () => true } }));
vi.mock('../../auth/productInventoryAuthority', () => ({
  assertProductInventoryMutationCurrent: (_handle, requirements = {}) => {
    const permissions = mocks.actor.permissions || [];
    for (const permission of ['products', 'inventory']) {
      if (requirements[permission] === true && !permissions.includes('*') && !permissions.includes(permission)) {
        throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
      }
    }
    return true;
  },
  assertProductInventoryOperationActorCurrent: () => undefined,
  captureProductInventoryMutation: (requirements = {}) => {
    const permissions = mocks.actor.permissions || [];
    for (const permission of ['products', 'inventory']) {
      if (requirements[permission] === true && !permissions.includes('*') && !permissions.includes(permission)) {
        throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
      }
    }
    return { assertCurrent: () => undefined };
  },
  getProductInventoryMutationRequirements: () => ({})
}));
vi.mock('../../inventory/inventoryEntryService', () => ({
  markCloudPharmacyReceiptRejected: async () => true,
  markInventoryEntrySynced: async () => true
}));
vi.mock('../../customers/customerLocalRepository', () => ({
  customerLocalRepository: {
    applyCloudCustomers: async (customers) => {
      mocks.customerApplied.push(...customers);
      return customers;
    }
  }
}));
vi.mock('../../customers/customerMigrationService', () => ({
  customerMigrationService: { runInitialMigrationIfNeeded: async () => ({ success: true }) }
}));
vi.mock('../syncConflictService', () => ({ syncConflictService: { saveConflict: async () => true } }));
vi.mock('../../salesCloud/salesCloudRepository', () => ({
  salesCloudRepository: {
    pullSalesChanges: async () => mocks.salesResponses.shift() || { success: true, sales: [], latest_change_seq: 0 }
  }
}));
vi.mock('../../salesCloud/salesCloudLocalRepository', () => ({
  salesCloudLocalRepository: {
    applyCloudSalesPayload: async (response) => {
      mocks.salesApplied.push(response);
      return { cached: (response.sales || []).length, patchedLocal: 0 };
    }
  }
}));
vi.mock('../../salesCloud/salesCloudShadowService', () => ({ salesCloudShadowService: { retryPendingShadowSales: async () => 0 } }));

const details = {
  license_key: 'TENANT-A',
  features: { cloud_pos_sync: true, cloud_sales_sync_base: true }
};
const CUSTOMER_SEQ = 'customers_last_change_seq';
const PRODUCT_SEQ = 'products_catalog_last_change_seq';
const DEFERRED_HANDLERS = 'deferred_handlers';
const flush = async () => { for (let attempt = 0; attempt < 100; attempt += 1) await Promise.resolve(); };

let orchestrator;

const globalPage = (fields = {}) => ({
  success: true,
  events: [],
  latestChangeSeq: mocks.generalCursor,
  serverLatestChangeSeq: mocks.generalCursor,
  hasMore: false,
  syncDeferred: false,
  ...fields
});

const customerRecord = (id, name = 'Recovered') => ({
  id, name, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  server_version: 1, credit_limit: '0.00'
});

const customerEnvelope = ({ seq, customers = [], deferred = false }) => ({
  data: {
    contract_version: 2,
    endpoint: 'pos_pull_customer_changes_v2',
    family: 'customer_directory',
    tenant_id: 'tenant-A',
    customer_projections: customers.map((customer) => ({
      customer_id: customer.id,
      status: 'NOT_INCLUDED',
      debt_cents: null,
      source: 'test_projection',
      projection_version: 1
    })),
    cursor: { change_seq: seq, has_more: false },
    ...(deferred ? { sync_deferred: true } : {}),
    payload: { customers, latest_change_seq: seq, has_more: false }
  },
  error: null
});

const setActorPermissions = (permissions) => {
  mocks.actor = { ...mocks.actor, permissions: [...permissions], generation: mocks.actor.generation + 1 };
  mocks.storePermissions = [...permissions];
  [...mocks.actorListeners].forEach((listener) => listener({ ...mocks.actor }));
};

const start = async () => {
  await orchestrator.start({ licenseDetails: details, reason: 'initial_bootstrap' });
  await flush();
};

beforeEach(async ({ task }) => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.details = details;
  mocks.actor = { status: 'granted', generation: 1, sessionId: 'session-a', actorKey: 'admin:admin-a', permissions: ['*'] };
  mocks.storePermissions = ['*'];
  mocks.actorListeners.clear();
  mocks.generalCursor = 175;
  mocks.meta.clear();
  mocks.meta.set(metaKey('TENANT-A', CUSTOMER_SEQ), 175);
  mocks.meta.set(metaKey('TENANT-A', PRODUCT_SEQ), 175);
  mocks.customerApplied = [];
  mocks.catalogApplied = [];
  mocks.salesApplied = [];
  mocks.customerResponses = [];
  mocks.catalogResponses = [];
  mocks.salesResponses = [];
  mocks.globalPull.mockImplementation(async () => globalPage());
  mocks.rpc.mockImplementation(async (rpcName, args) => {
    if (rpcName === 'pos_fin01_sync_contract_v1') {
      return { data: {
        contract_version: 2,
        server_status: 'SUPPORTED',
        tenant_id: 'tenant-A',
        capabilities: args.p_capabilities,
        endpoint_families: ['customer_directory'],
        endpoints: ['pos_pull_customer_changes_v2']
      }, error: null };
    }
    if (rpcName === 'pos_pull_customer_changes_v2') {
      return mocks.customerResponses.shift() || customerEnvelope({ seq: args.p_since_change_seq });
    }
    if (rpcName === 'pos_pull_product_catalog_changes') {
      return { data: mocks.catalogResponses.shift() || { success: true, products: [], latest_change_seq: args.p_since_change_seq }, error: null };
    }
    throw new Error(`Unexpected RPC in focused test: ${rpcName}`);
  });

  ({ posSyncOrchestrator: orchestrator } = await import('../posSyncOrchestrator'));
  if (task.name.includes('sales registered first')) {
    await import('../../salesCloud/salesCloudSyncHandler');
    await import('../../products/productSyncHandler');
  } else {
    await import('../../products/productSyncHandler');
    await import('../../salesCloud/salesCloudSyncHandler');
  }
  await import('../../customers/customerSyncHandler');
});

afterEach(async () => {
  await orchestrator.stop({ preserveStatus: true });
  await flush();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('real incremental handlers propagate deferred reads to the central recovery timer', () => {
  it.each(['catalog registered first', 'sales registered first'])('inventory movement dispatch: an isolated notification wakes catalog and sales delta readers (%s)', async () => {
    mocks.catalogResponses.push({
      success: true, products: [{ id: 'product-movement', stock: 7, server_version: 2 }],
      batches: [{ id: 'batch-movement', product_id: 'product-movement', stock: 7, server_version: 2 }],
      latest_change_seq: 177
    });
    mocks.salesResponses.push({ success: true, sales: [{ id: 'sale-movement' }], latest_change_seq: 177 });
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'inventory_movement', entity_id: 'movement-177', change_seq: 177,
        metadata: { product_id: 'product-movement', batch_id: 'batch-movement', sale_id: 'sale-movement' } }],
      latestChangeSeq: 177, serverLatestChangeSeq: 177
    }));
    await start();
    await orchestrator.pullIncremental('isolated_inventory_notification');
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.catalogApplied[0].products[0].stock).toBe(7);
    expect(mocks.generalCursor).toBe(177);
  });

  it('inventory movement dispatch: a combined page calls each delta reader once', async () => {
    const events = ['product_batch', 'sale_item', 'inventory_movement', 'product', 'sale', 'sale_payment']
      .map((entity_type, i) => ({ entity_type, change_seq: 176 + i }));
    mocks.catalogResponses.push({ success: true, products: [{ id: 'p', stock: 7 }], latest_change_seq: 181 });
    mocks.salesResponses.push({ success: true, sales: [{ id: 's' }], latest_change_seq: 181 });
    mocks.globalPull.mockResolvedValueOnce(globalPage({ events, latestChangeSeq: 181 }));
    await start();
    await orchestrator.pullIncremental('combined_inventory_page');
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.generalCursor).toBe(181);
  });

  it('inventory movement dispatch: catalog deferred survives sales completion and recovers without Broadcast', async () => {
    mocks.catalogResponses.push(
      { success: true, products: [], latest_change_seq: 175, sync_deferred: true },
      { success: true, products: [{ id: 'p', stock: 7 }], latest_change_seq: 177 }
    );
    mocks.salesResponses.push({ success: true, sales: [{ id: 's' }], latest_change_seq: 177 });
    mocks.globalPull.mockResolvedValueOnce(globalPage({ events: [{ entity_type: 'inventory_movement', change_seq: 177 }], latestChangeSeq: 177 }))
      .mockResolvedValueOnce(globalPage());
    await start();
    await orchestrator.pullIncremental('catalog_interrupted');
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.generalCursor).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product']);
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(mocks.catalogApplied.at(-1).products).toEqual([{ id: 'p', stock: 7 }]);
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
  });

  it('inventory movement dispatch: sales deferred survives catalog completion and recovers without Broadcast', async () => {
    mocks.catalogResponses.push({ success: true, products: [{ id: 'p', stock: 7 }], latest_change_seq: 177 });
    mocks.salesResponses.push(
      { success: true, sales: [], latest_change_seq: 0, sync_deferred: true },
      { success: true, sales: [{ id: 's' }], latest_change_seq: 177 }
    );
    mocks.globalPull.mockResolvedValueOnce(globalPage({ events: [{ entity_type: 'inventory_movement', change_seq: 177 }], latestChangeSeq: 177 }))
      .mockResolvedValueOnce(globalPage());
    await start();
    await orchestrator.pullIncremental('sales_interrupted');
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.generalCursor).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['sale']);
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(mocks.salesApplied.at(-1).sales).toEqual([{ id: 's' }]);
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
  });

  it('inventory movement dispatch: inventory-only Staff updates stock without sales access and restores POS later', async () => {
    setActorPermissions(['inventory']);
    mocks.catalogResponses.push({ success: true, products: [{ id: 'p', stock: 7 }], latest_change_seq: 177 });
    mocks.globalPull.mockResolvedValueOnce(globalPage({ events: [{ entity_type: 'inventory_movement', change_seq: 177 }], latestChangeSeq: 177 }));
    await start();
    await orchestrator.pullIncremental('staff_inventory_only');
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.salesApplied).toHaveLength(0);
    expect(mocks.generalCursor).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['sale']);
    mocks.salesResponses.push({ success: true, sales: [{ id: 's' }], latest_change_seq: 177 });
    setActorPermissions(['inventory', 'pos']);
    await flush();
    expect(mocks.salesApplied.at(-1).sales).toEqual([{ id: 's' }]);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
  });

  it('inventory movement dispatch: expands old durable movement markers to both consumers on restart', async () => {
    mocks.meta.set(metaKey('TENANT-A', DEFERRED_HANDLERS), ['inventory_movement']);
    mocks.catalogResponses.push({ success: true, products: [{ id: 'p', stock: 7 }], latest_change_seq: 177 });
    mocks.salesResponses.push({ success: true, sales: [], latest_change_seq: 0, sync_deferred: true });
    await start();
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product', 'sale']);
    await orchestrator.pullIncremental('legacy_marker_recovery');
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['sale']);
  });

  it('recovers a deferred customer RPC automatically with the real customer handler and no Broadcast', async () => {
    mocks.customerResponses.push(customerEnvelope({ seq: 175, deferred: true }));
    mocks.customerResponses.push(customerEnvelope({ seq: 177, customers: [customerRecord('customer-177')] }));
    mocks.globalPull
      .mockResolvedValueOnce(globalPage({ events: [{ entity_type: 'customer', change_seq: 177 }], latestChangeSeq: 175, serverLatestChangeSeq: 177 }))
      .mockResolvedValueOnce(globalPage());
    await start();

    await orchestrator.pullIncremental('customer_deferred');

    expect(mocks.generalCursor).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', CUSTOMER_SEQ))).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['customer']);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.globalPull).toHaveBeenCalledTimes(2);
    expect(mocks.customerApplied).toEqual([expect.objectContaining({ id: 'customer-177', name: 'Recovered' })]);
    expect(mocks.meta.get(metaKey('TENANT-A', CUSTOMER_SEQ))).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(false);
  });

  it('recovers a deferred catalog RPC automatically with the real catalog handler', async () => {
    mocks.catalogResponses.push(
      { success: true, products: [], latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true },
      { success: true, products: [{ id: 'product-177', name: 'Recovered' }], latest_change_seq: 177 }
    );
    mocks.globalPull
      .mockResolvedValueOnce(globalPage({ events: [{ entity_type: 'product', change_seq: 177 }], latestChangeSeq: 175, serverLatestChangeSeq: 177 }))
      .mockResolvedValueOnce(globalPage());
    await start();

    await orchestrator.pullIncremental('catalog_deferred');
    expect(mocks.generalCursor).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product']);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.catalogApplied).toHaveLength(2);
    expect(mocks.catalogApplied.at(-1).products).toEqual([{ id: 'product-177', name: 'Recovered' }]);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
    expect(mocks.globalPull).toHaveBeenCalledTimes(2);
  });

  it('lets POS-only Staff read catalog prices and stock through the real handler', async () => {
    setActorPermissions(['pos']);
    mocks.catalogResponses.push({
      success: true,
      products: [{ id: 'product-pos', name: 'Cafe', price: 12.5, stock: 7 }],
      batches: [{ id: 'batch-pos', product_id: 'product-pos', quantity: 7 }],
      latest_change_seq: 176
    });
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'product', change_seq: 176 }],
      latestChangeSeq: 176,
      serverLatestChangeSeq: 176
    }));
    await start();

    await orchestrator.pullIncremental('staff_pos_catalog_read');

    expect(mocks.rpc).toHaveBeenCalledWith('pos_pull_product_catalog_changes', expect.objectContaining({
      p_since_change_seq: 175
    }));
    expect(mocks.catalogApplied.at(-1).products).toEqual([
      expect.objectContaining({ id: 'product-pos', price: 12.5, stock: 7 })
    ]);
    expect(mocks.catalogApplied.at(-1).batches).toEqual([
      expect.objectContaining({ id: 'batch-pos', quantity: 7 })
    ]);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(176);
  });

  it('lets inventory-only Staff read catalog changes through the real handler', async () => {
    setActorPermissions(['inventory']);
    mocks.catalogResponses.push({
      success: true,
      products: [{ id: 'product-inventory', name: 'Stock item', price: 8.25, stock: 3 }],
      latest_change_seq: 176
    });
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'product', change_seq: 176 }],
      latestChangeSeq: 176,
      serverLatestChangeSeq: 176
    }));
    await start();

    await orchestrator.pullIncremental('staff_inventory_catalog_read');

    expect(mocks.rpc).toHaveBeenCalledWith('pos_pull_product_catalog_changes', expect.objectContaining({
      p_since_change_seq: 175
    }));
    expect(mocks.catalogApplied.at(-1).products).toEqual([
      expect.objectContaining({ id: 'product-inventory', price: 8.25, stock: 3 })
    ]);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(176);
  });

  it('does not request catalog changes when Staff has none of the SQL read permissions', async () => {
    setActorPermissions(['customers']);
    mocks.catalogResponses.push({
      success: true,
      products: [{ id: 'restricted-product', price: 4, stock: 2 }],
      latest_change_seq: 176
    });
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'product', change_seq: 176 }],
      latestChangeSeq: 176,
      serverLatestChangeSeq: 176
    }));
    await start();

    await orchestrator.pullIncremental('staff_without_catalog_read_permission');

    expect(mocks.rpc).not.toHaveBeenCalledWith('pos_pull_product_catalog_changes', expect.anything());
    expect(mocks.catalogApplied).toEqual([]);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product']);
    expect(mocks.generalCursor).toBe(176);
  });

  it('recovers a deferred catalog read for POS-only Staff through the central timer', async () => {
    setActorPermissions(['pos']);
    mocks.catalogResponses.push(
      { success: true, products: [], latest_change_seq: 175, server_latest_change_seq: 177, sync_deferred: true },
      { success: true, products: [{ id: 'product-pos-177', price: 19.5, stock: 5 }], latest_change_seq: 177 }
    );
    mocks.globalPull
      .mockResolvedValueOnce(globalPage({
        events: [{ entity_type: 'product', change_seq: 177 }],
        latestChangeSeq: 175,
        serverLatestChangeSeq: 177
      }))
      .mockResolvedValueOnce(globalPage());
    await start();

    await orchestrator.pullIncremental('staff_pos_catalog_deferred');

    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(175);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product']);
    expect(orchestrator.getStatus().deferredPullScheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.catalogApplied.at(-1).products).toEqual([
      expect.objectContaining({ id: 'product-pos-177', price: 19.5, stock: 5 })
    ]);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
    expect(mocks.globalPull).toHaveBeenCalledTimes(2);
  });

  it('refreshes the deferred catalog handler when a SQL read permission is granted', async () => {
    setActorPermissions(['customers']);
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'product', change_seq: 176 }],
      latestChangeSeq: 176,
      serverLatestChangeSeq: 176
    }));
    await start();

    await orchestrator.pullIncremental('catalog_permission_missing');

    expect(mocks.rpc).not.toHaveBeenCalledWith('pos_pull_product_catalog_changes', expect.anything());
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['product']);

    mocks.catalogResponses.push({
      success: true,
      products: [{ id: 'product-restored', price: 14, stock: 2 }],
      latest_change_seq: 176
    });
    mocks.globalPull.mockResolvedValueOnce(globalPage());
    setActorPermissions(['customers', 'pos']);
    await flush();

    expect(mocks.rpc).toHaveBeenCalledWith('pos_pull_product_catalog_changes', expect.objectContaining({
      p_since_change_seq: 175
    }));
    expect(mocks.catalogApplied.at(-1).products).toEqual([
      expect.objectContaining({ id: 'product-restored', price: 14, stock: 2 })
    ]);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(176);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
  });

  it('keeps catalog writes restricted to products permission when POS or inventory grants read access', async () => {
    const { productCloudRepository } = await import('../../products/productCloudRepository');

    for (const permission of ['pos', 'inventory']) {
      setActorPermissions([permission]);
      await expect(productCloudRepository.upsertProduct({
        licenseKey: 'TENANT-A',
        product: { id: `product-write-${permission}`, name: 'Read only', price: 1 },
        idempotencyKey: `write-${permission}`
      })).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    }

    expect(mocks.rpc).not.toHaveBeenCalledWith('pos_upsert_product', expect.anything());
  });

  it('keeps a deferred customer marker while the real catalog handler finishes', async () => {
    mocks.customerResponses.push(
      customerEnvelope({ seq: 175, deferred: true }),
      customerEnvelope({ seq: 177, customers: [customerRecord('customer-177')] })
    );
    mocks.catalogResponses.push({ success: true, products: [{ id: 'product-176' }], latest_change_seq: 176 });
    mocks.globalPull
      .mockResolvedValueOnce(globalPage({ events: [
        { entity_type: 'customer', change_seq: 176 },
        { entity_type: 'product', change_seq: 176 }
      ], latestChangeSeq: 176, serverLatestChangeSeq: 177 }))
      .mockResolvedValueOnce(globalPage());
    await start();

    await orchestrator.pullIncremental('independent_entities');

    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['customer']);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(176);
    expect(mocks.meta.get(metaKey('TENANT-A', CUSTOMER_SEQ))).toBe(175);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(mocks.meta.get(metaKey('TENANT-A', CUSTOMER_SEQ))).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', PRODUCT_SEQ))).toBe(176);
    expect(mocks.customerApplied.map((row) => row.id)).toEqual(['customer-177']);
    expect(mocks.catalogApplied).toHaveLength(1);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
  });

  it('lets POS Staff process authorized sales without querying restricted customer data', async () => {
    setActorPermissions(['pos']);
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [
        { entity_type: 'customer', change_seq: 177 },
        { entity_type: 'sale', change_seq: 177 }
      ], latestChangeSeq: 177, serverLatestChangeSeq: 177
    }));
    mocks.salesResponses.push({ success: true, sales: [{ id: 'sale-177' }], latest_change_seq: 177 });
    await start();

    await orchestrator.pullIncremental('staff_limited_permissions');

    expect(mocks.rpc).not.toHaveBeenCalledWith('pos_pull_customer_changes_v2', expect.anything());
    expect(mocks.customerApplied).toEqual([]);
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['customer']);
    expect(mocks.generalCursor).toBe(177);
  });

  it('retains the customer read skip during revocation and refreshes it after permission is restored', async () => {
    setActorPermissions(['pos', 'customers']);
    await start();
    setActorPermissions(['pos']);
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'customer', change_seq: 177 }, { entity_type: 'sale', change_seq: 177 }],
      latestChangeSeq: 177, serverLatestChangeSeq: 177
    }));
    mocks.salesResponses.push({ success: true, sales: [{ id: 'sale-177' }], latest_change_seq: 177 });

    await orchestrator.pullIncremental('permission_revoked');

    expect(mocks.rpc).not.toHaveBeenCalledWith('pos_pull_customer_changes_v2', expect.anything());
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual(['customer']);
    expect(mocks.salesApplied).toHaveLength(1);
    expect(mocks.customerApplied).toEqual([]);

    mocks.customerResponses.push(customerEnvelope({ seq: 177, customers: [customerRecord('customer-177', 'After grant')] }));
    mocks.globalPull.mockResolvedValueOnce(globalPage());
    setActorPermissions(['pos', 'customers']);
    await flush();

    expect(mocks.customerApplied).toEqual([expect.objectContaining({ id: 'customer-177', name: 'After grant' })]);
    expect(mocks.meta.get(metaKey('TENANT-A', CUSTOMER_SEQ))).toBe(177);
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS))).toEqual([]);
    expect(orchestrator.getStatus().pullInProgress).toBe(false);
  });

  it('keeps the current Production RPC behavior when the deferred field is absent', async () => {
    mocks.customerResponses.push(customerEnvelope({ seq: 175, customers: [customerRecord('customer-175', 'Existing')] }));
    mocks.globalPull.mockResolvedValueOnce(globalPage({
      events: [{ entity_type: 'customer', change_seq: 175 }], latestChangeSeq: 175
    }));
    await start();

    await orchestrator.pullIncremental('production_compatibility');
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();

    expect(mocks.customerApplied).toEqual([expect.objectContaining({ id: 'customer-175', name: 'Existing' })]);
    expect(mocks.globalPull).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'pos_fin01_sync_contract_v1')).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'pos_pull_customer_changes_v2')).toHaveLength(1);
    expect(orchestrator.getStatus()).toMatchObject({ deferredPullPending: false, deferredPullScheduled: false });
    expect(mocks.meta.get(metaKey('TENANT-A', DEFERRED_HANDLERS)) || []).toEqual([]);
  });
});
