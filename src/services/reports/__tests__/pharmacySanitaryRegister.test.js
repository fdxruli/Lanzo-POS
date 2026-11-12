import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  state: { status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 's1' },
  stores: { menu: [], sales: [], inventory_events: [], waste_logs: [] }
}));

vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: mocks.auth }));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { getState: () => mocks.state }
}));
vi.mock('../../db/dexie', () => ({
  STORES: { MENU: 'menu', SALES: 'sales', INVENTORY_EVENTS: 'inventory_events', WASTE: 'waste_logs' },
  db: {
    isOpen: () => true,
    table: (name) => ({
      toArray: async () => mocks.stores[name] || [],
      where: () => ({
        between: () => ({
          limit: () => ({ toArray: async () => mocks.stores[name] || [] })
        })
      })
    })
  }
}));
vi.mock('../../../utils/pharmacyClassification', () => ({
  getPharmacyClassification: (product) => ({
    recorded: Boolean(product?.metadata?.pharmacy),
    kind: product?.metadata?.pharmacy?.kind || 'other'
  })
}));

import {
  SANITARY_EXPORT_LIMIT, assertSanitaryReader, sanitaryFilters, sanitaryIncidences,
  pageSanitaryRows, buildSanitaryCsv, collectSanitaryExport, getSanitaryRegisterPage
} from '../pharmacySanitaryRegister';

const filters = { from: '2026-11-10', to: '2026-11-12', search: '',
  movementType: '', batchId: '', traceStatus: '' };
const actorIdentity = 'admin:admin-1:s1';
const item = (id, opts = {}) => ({
  id, operationId: id, occurredAt: '2026-11-11T12:00:00.000Z',
  movementType: 'receipt', productName: 'Amoxicilina',
  productId: 'p1', quantity: 5, batchId: 'b1', expiryDate: '2027-10-30',
  documentReference: 'FAC-QA', traceStatus: 'complete', source: 'cloud',
  nameSource: 'sale_snapshot', classificationAtOperation: 'IV', ...opts
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 's1' };
  mocks.stores = { menu: [], sales: [], inventory_events: [], waste_logs: [] };
  mocks.auth.mockResolvedValue({
    licenseKey: 'QA', deviceFingerprint: 'device-1',
    securityToken: 'secret', staffSessionToken: null
  });
});

describe('pharmacy sanitary register', () => {
  it('rejects invalid or excessively wide date ranges before reading', () => {
    expect(() => sanitaryFilters({ from: '2026-01-01', to: '2026-11-12' })).toThrow();
    expect(() => sanitaryFilters({ from: '2026-11-12', to: '2026-11-10' })).toThrow();
    expect(sanitaryFilters(filters).dateTo).toBeTruthy();
  });

  it('retains two legitimate equal-quantity receptions and deduplicates by stable identity only', () => {
    const f = sanitaryFilters(filters);
    const rows = [item('inventory:a'), item('inventory:b'), item('inventory:a')];
    const page = pageSanitaryRows(rows, f);
    expect(page.rows.map((r) => r.id)).toEqual(['inventory:b', 'inventory:a']);
    expect(page.hasMore).toBe(false);
  });

  it('applies search, movement, batch, period and deterministic cursor', () => {
    const f = sanitaryFilters({ ...filters, search: 'amoxi', movementType: 'receipt', batchId: 'b1' });
    const rows = [
      item('b', { occurredAt: '2026-11-11T13:00:00.000Z' }),
      item('a'), item('c', { productName: 'Ibuprofeno' }),
      item('d', { batchId: 'another' }), item('x', { movementType: 'dispensation' }),
      item('old', { occurredAt: '2026-11-01T12:00:00.000Z' })
    ];
    const first = pageSanitaryRows(rows, f, null, 1);
    expect(first.rows.map((r) => r.id)).toEqual(['b']);
    expect(first.hasMore).toBe(true);
    const second = pageSanitaryRows(rows, f, first.nextCursor, 1);
    expect(second.rows.map((r) => r.id)).toEqual(['a']);
    expect(second.hasMore).toBe(false);
  });

  it('does not turn missing historical proof into a confirmed incidence', () => {
    expect(sanitaryIncidences(item('x', {
      classificationAtOperation: null, nameSource: 'current_catalog'
    }))).toContain('Clasificación histórica no comprobada');
    expect(sanitaryIncidences(item('y', {
      movementType: 'dispensation', saleStatus: 'cancelled', documentReference: null
    }))).toContain('Estado de venta requiere revisión');
  });

  it('escapes formula injection and Excel punctuation without altering row identities', () => {
    const csv = buildSanitaryCsv([item('=1+1', {
      productName: '\t=HYPERLINK("https://example.test")',
      documentReference: 'FAC,"QA"\n2', notes: '@evil'
    })]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'\t=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"FAC,""QA""\n2"');
    expect(csv).toContain('"\'@evil"');
  });

  it('reads local receipts, prescription lines, and waste with source labels', async () => {
    mocks.stores.menu = [{ id: 'p1', name: 'Amoxicilina', barcode: '750123',
      metadata: { pharmacy: { kind: 'medicine' } } }];
    mocks.stores.inventory_events = [
      { id: 'inventory-entry:op1', type: 'INVENTORY_ENTRY', operationId: 'op1',
        productId: 'p1', batchId: 'b1', delta: 5, timestamp: '2026-11-11T12:00:00.000Z',
        manufacturerBatchId: 'M1', expiryDate: '2027-01-01', synced: false,
        metadata: { pharmacyReceipt: { documentReference: 'FAC-1' } } },
      { id: 'inventory-entry:op2', type: 'INVENTORY_ENTRY', operationId: 'op2',
        productId: 'p1', batchId: 'b1', delta: 5, timestamp: '2026-11-11T13:00:00.000Z',
        manufacturerBatchId: 'M1', expiryDate: '2027-01-01', synced: false,
        metadata: { pharmacyReceipt: { documentReference: 'FAC-2' } } }
    ];
    mocks.stores.sales = [{
      id: 'sale1', timestamp: '2026-11-11T14:00:00.000Z', status: 'closed',
      items: [{ productId: 'p1', name: 'Amoxicilina', quantity: 1, batchId: 'b1',
        pharmacyDispensationV1: { version: 1, reference: 'RX-1' } }]
    }];
    mocks.stores.waste_logs = [{
      id: 'w1', timestamp: '2026-11-11T15:00:00.000Z',
      productId: 'p1', productName: 'Amoxicilina', batchId: 'b1', quantity: 1
    }];
    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters });
    expect(page.rows).toHaveLength(4);
    expect(page.rows.filter((r) => r.movementType === 'receipt')).toHaveLength(2);
    expect(page.rows.find((r) => r.movementType === 'dispensation').syncStatus)
      .toBe('local_not_cloud_confirmed');
    expect(page.source).toBe('local_device');
  });

  it('rejects revoked actors and explicitly failed Cloud responses', async () => {
    mocks.state = { status: 'denied' };
    expect(() => assertSanitaryReader(actorIdentity)).toThrow();
    mocks.state = { status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 's1' };
    mocks.rpc.mockResolvedValue({ data: { success: false }, error: null });
    await expect(getSanitaryRegisterPage({
      cloud: true, licenseKey: 'QA', actorIdentity, filters
    })).rejects.toThrow('incompleto');
  });

  it('exports multiple Cloud pages without dropping distinct records', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { success: true, rows: [item('a')], hasMore: true }, error: null })
      .mockResolvedValueOnce({ data: { success: true, rows: [item('b')], hasMore: false }, error: null });
    const rows = await collectSanitaryExport({ cloud: true, licenseKey: 'QA', actorIdentity, filters });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[1][1].p_before_id).toBe('a');
    expect(SANITARY_EXPORT_LIMIT).toBe(2000);
  });
});
