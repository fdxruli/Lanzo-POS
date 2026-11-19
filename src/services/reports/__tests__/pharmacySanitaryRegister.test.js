import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  state: { status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 's1' },
  stores: { menu: [], sales: [], deleted_sales: [], inventory_events: [], waste_logs: [] }
}));

vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: mocks.auth }));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { getState: () => mocks.state }
}));
vi.mock('../../db/dexie', () => ({
  STORES: { MENU: 'menu', SALES: 'sales', DELETED_SALES: 'deleted_sales', INVENTORY_EVENTS: 'inventory_events', WASTE: 'waste_logs' },
  db: {
    isOpen: () => true,
    table: (name) => ({
      toArray: async () => mocks.stores[name] || [],
      bulkGet: async (ids) => ids.map((id) => (mocks.stores[name] || []).find((row) => row.id === id)),
      toCollection: () => ({
        filter: (predicate) => ({
          limit: (limit) => ({ toArray: async () => (mocks.stores[name] || []).filter(predicate).slice(0, limit) })
        })
      }),
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
  pageSanitaryRows, buildSanitaryCsv, collectSanitaryExport, getSanitaryRegisterPage,
  sanitaryMissingUnitLabel, sanitaryUnitSourceLabel
} from '../pharmacySanitaryRegister';

import { formatBusinessDateTimeInput, formatBusinessInstant, parseBusinessDateTimeInput } from '../../../utils/businessTime';

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
  mocks.stores = { menu: [], sales: [], deleted_sales: [], inventory_events: [], waste_logs: [] };
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

  it('uses the Mérida calendar window and preserves the declared instant and expiry in CSV', async () => {
    const timezone = 'America/Merida';
    const day = { from: '2026-11-18', to: '2026-11-18' };
    const declared = parseBusinessDateTimeInput('2026-11-18T20:15', timezone);
    expect(declared.toISOString()).toBe('2026-11-19T02:15:00.000Z');
    expect(formatBusinessDateTimeInput(declared, timezone)).toBe('2026-11-18T20:15');
    const row = item('inventory:merida', {
      occurredAt: '2026-11-19T02:17:00+00:00', receiptAt: declared.toISOString()
    });
    expect(formatBusinessInstant(row.occurredAt, timezone, {
      dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23'
    })).toMatch(/18\/11\/26.*20:17/);
    expect(sanitaryFilters(day, timezone)).toMatchObject({
      dateFrom: '2026-11-18T06:00:00.000Z', dateTo: '2026-11-19T06:00:00.000Z'
    });
    mocks.rpc.mockResolvedValue({ data: { success: true, rows: [row], hasMore: false }, error: null });
    const rows = await collectSanitaryExport({ licenseKey: 'QA', cloud: true, actorIdentity, filters: day, timezone });
    expect(mocks.rpc).toHaveBeenCalledWith('pos_get_pharmacy_sanitary_register_v1', expect.objectContaining({
      p_date_from: '2026-11-18T06:00:00.000Z', p_date_to: '2026-11-19T06:00:00.000Z'
    }));
    expect(rows[0]).toMatchObject({ id: row.id, unit: null, unitSource: 'cloud_not_returned', traceStatus: 'incomplete' });
    const csv = buildSanitaryCsv(rows);
    expect(csv).toContain('Fecha y hora de recepción declarada (ISO 8601)');
    expect(csv).toContain('"2026-11-19T02:17:00+00:00","2026-11-19T02:15:00.000Z"');
    expect(csv).toContain('"2027-10-30"');
    expect(csv).toContain('"Unidad histórica no devuelta por la consulta Cloud"');
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

  it('keeps the sale movement filter invalid until the Cloud contract advertises version 2', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: true, rows: [], hasMore: false }, error: null });
    const legacy = await getSanitaryRegisterPage({ cloud: true, licenseKey: 'QA', actorIdentity, filters });
    expect(legacy.supportedMovementTypes).not.toContain('sale');

    mocks.rpc.mockResolvedValue({ data: {
      success: true, rows: [], hasMore: false, contractVersion: 2,
      supportedMovementTypes: ['receipt', 'dispensation', 'sale', 'waste', 'return', 'adjustment', 'other']
    }, error: null });
    const current = await getSanitaryRegisterPage({ cloud: true, licenseKey: 'QA', actorIdentity, filters });
    expect(current.supportedMovementTypes).toContain('sale');
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
    mocks.stores.menu = [{ id: 'p1', name: 'Amoxicilina', barcode: '750123', unit: 'caja',
      metadata: { pharmacy: { kind: 'medicine' } } }];
    mocks.stores.inventory_events = [
      { id: 'inventory-entry:op1', type: 'INVENTORY_ENTRY', operationId: 'op1',
        productId: 'p1', batchId: 'b1', delta: 5, timestamp: '2026-11-11T12:00:00.000Z',
        manufacturerBatchId: 'M1', expiryDate: '2027-01-01', synced: false,
        metadata: { baseUnit: 'pieza', pharmacyReceipt: { documentReference: 'FAC-1' } } },
      { id: 'inventory-entry:op2', type: 'INVENTORY_ENTRY', operationId: 'op2',
        productId: 'p1', batchId: 'b1', delta: 5, timestamp: '2026-11-11T13:00:00.000Z',
        manufacturerBatchId: 'M1', expiryDate: '2027-01-01', synced: false,
        metadata: { pharmacyReceipt: { documentReference: 'FAC-2' } } }
    ];
    mocks.stores.sales = [{
      id: 'sale1', timestamp: '2026-11-11T14:00:00.000Z', status: 'closed',
      items: [{ productId: 'p1', name: 'Amoxicilina', quantity: 1, batchId: 'b1',
        unit: 'cápsula', pharmacyDispensationV1: { version: 1, reference: 'RX-1' } }]
    }];
    mocks.stores.waste_logs = [{
      id: 'w1', timestamp: '2026-11-11T15:00:00.000Z',
      productId: 'p1', productName: 'Amoxicilina', batchId: 'b1', quantity: 1
    }];
    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters });
    expect(page.rows).toHaveLength(4);
    expect(page.rows.filter((r) => r.movementType === 'receipt')).toHaveLength(2);
    expect(page.rows.find((r) => r.operationId === 'op1')).toMatchObject({ unit: 'pieza', unitSource: 'operation_snapshot' });
    expect(page.rows.find((r) => r.operationId === 'op2')).toMatchObject({
      unit: 'caja', unitSource: 'current_catalog', traceStatus: 'incomplete'
    });
    expect(page.rows.find((r) => r.movementType === 'dispensation').syncStatus)
      .toBe('local_not_cloud_confirmed');
    expect(page.rows.find((r) => r.movementType === 'dispensation')).toMatchObject({
      unit: 'cápsula', unitSource: 'operation_snapshot'
    });
    expect(page.source).toBe('local_device');
    const csv = buildSanitaryCsv(page.rows);
    expect(csv).toContain('"Fuente unidad"');
    expect(csv).toContain('"caja","Catálogo actual (no histórico)"');
    expect(sanitaryUnitSourceLabel(page.rows.find((row) => row.operationId === 'op1'))).toBe('Registro de operación');
  });

  it('keeps missing local units visible as an incomplete traceability incidence', async () => {
    mocks.stores.menu = [{ id: 'p1', name: 'Amoxicilina', metadata: { pharmacy: { kind: 'medicine' } } }];
    mocks.stores.inventory_events = [{
      id: 'inventory-entry:missing-unit', type: 'INVENTORY_ENTRY', operationId: 'missing-unit', productId: 'p1',
      batchId: 'b1', delta: 5, timestamp: '2026-11-11T12:00:00.000Z', manufacturerBatchId: 'M1',
      expiryDate: '2027-01-01', metadata: { pharmacyReceipt: { documentReference: 'FAC-1' } }
    }];
    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters });
    expect(page.rows[0]).toMatchObject({ unit: null, unitSource: 'not_recorded', traceStatus: 'incomplete' });
    expect(sanitaryMissingUnitLabel(page.rows[0])).toBe('unidad no registrada');
    expect(sanitaryIncidences(page.rows[0])).toContain('Unidad de medida no registrada');
  });

  it('labels a current Cloud catalog unit separately from an absent Cloud historical unit', async () => {
    mocks.stores.menu = [{ id: 'p1', unit: 'frasco' }];
    mocks.rpc.mockResolvedValue({ data: { success: true, rows: [item('cloud-current', { productId: 'p1' })], hasMore: false }, error: null });
    const current = await getSanitaryRegisterPage({ cloud: true, licenseKey: 'QA', actorIdentity, filters });
    expect(current.rows[0]).toMatchObject({
      unit: 'frasco', unitSource: 'current_catalog', traceStatus: 'incomplete'
    });
    expect(sanitaryIncidences(current.rows[0])).toContain('Unidad del catálogo actual, no dato histórico');

    mocks.stores.menu = [];
    mocks.rpc.mockResolvedValue({ data: { success: true, rows: [item('cloud-missing')], hasMore: false }, error: null });
    const missing = await getSanitaryRegisterPage({ cloud: true, licenseKey: 'QA', actorIdentity, filters });
    expect(missing.rows[0]).toMatchObject({ unit: null, unitSource: 'cloud_not_returned', traceStatus: 'incomplete' });
    expect(sanitaryMissingUnitLabel(missing.rows[0])).toBe('unidad no devuelta por Cloud');
  });

  it('keeps real local batch allocations as rows under one sale and exports source references', async () => {
    mocks.stores.menu = [{ id: 'medicine-1', name: 'MUSE-FAR-FINAL MULTILOTE A',
      metadata: { pharmacy: { kind: 'medicine' } } }];
    mocks.stores.inventory_events = [{
      id: 'evt-sale-product-1', type: 'INVENTORY_DEDUCTION', saleId: 'sale-multi',
      productId: 'medicine-1', delta: -15, timestamp: '2026-11-11T14:00:00.000Z'
    }];
    mocks.stores.sales = [{
      id: 'sale-multi', folio: 'V-000005', timestamp: '2026-11-11T14:00:00.000Z', status: 'closed',
      items: [
        { lineId: 'line-a', productId: 'medicine-1', name: 'MUSE-FAR-FINAL MULTILOTE A',
          quantity: 10, stockDeducted: 10,
          batchesUsed: [{ batchId: 'batch-a', ingredientId: 'medicine-1', quantity: 10, batchSku: 'SKU-A', expiryDate: '2028-06-30' }] },
        { lineId: 'line-b', productId: 'medicine-1', name: 'MUSE-FAR-FINAL MULTILOTE A',
          quantity: 5, stockDeducted: 5,
          batchesUsed: [{ batchId: 'batch-b', ingredientId: 'medicine-1', quantity: 5, batchSku: 'SKU-B', expiryDate: '2028-12-31' }] }
      ]
    }];

    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters, limit: 100 });
    const sales = page.rows.filter((row) => row.movementType === 'sale');
    expect(sales).toHaveLength(2);
    expect(sales.map((row) => [row.saleId, row.saleItemId, row.batchId, row.quantity])).toEqual([
      ['sale-multi', 'line-b', 'batch-b', 5],
      ['sale-multi', 'line-a', 'batch-a', 10]
    ]);
    expect(sales.every((row) => row.traceStatus === 'incomplete')).toBe(true);
    expect(sales.every((row) => row.sourceMovementIds[0] === 'evt-sale-product-1')).toBe(true);
    expect(sales.every((row) => row.documentReference === null)).toBe(true);

    const csv = buildSanitaryCsv(sales);
    expect(csv).toContain('"ID movimiento origen","Referencia de venta"');
    expect(csv).toContain('"sale"');
    expect(csv).toContain('"V-000005"');
    expect(csv).toContain('"batch-a"');
    expect(csv).toContain('"batch-b"');
    expect(csv).toContain('"evt-sale-product-1","V-000005"');
  });

  it('does not duplicate a documented local prescription and excludes products classified as other', async () => {
    mocks.stores.menu = [
      { id: 'medicine-1', name: 'Medicamento', metadata: { pharmacy: { kind: 'medicine' } } },
      { id: 'general-1', name: 'Producto general', metadata: { pharmacy: { kind: 'other' } } }
    ];
    mocks.stores.inventory_events = [
      { id: 'evt-rx-and-sale', type: 'INVENTORY_DEDUCTION', saleId: 'sale-rx', productId: 'medicine-1', delta: -2, timestamp: '2026-11-11T14:00:00.000Z' },
      { id: 'evt-general', type: 'INVENTORY_DEDUCTION', saleId: 'sale-general', productId: 'general-1', delta: -1, timestamp: '2026-11-11T14:01:00.000Z' }
    ];
    mocks.stores.sales = [
      { id: 'sale-rx', timestamp: '2026-11-11T14:00:00.000Z', status: 'closed', items: [
        { lineId: 'rx-line', productId: 'medicine-1', name: 'Medicamento', quantity: 1, stockDeducted: 1,
          batchId: 'batch-rx', pharmacyDispensationV1: { version: 1, reference: 'RX-1' } },
        { lineId: 'sale-line', productId: 'medicine-1', name: 'Medicamento', quantity: 1, stockDeducted: 1,
          batchesUsed: [{ batchId: 'batch-sale', ingredientId: 'medicine-1', quantity: 1 }] }
      ] },
      { id: 'sale-general', timestamp: '2026-11-11T14:01:00.000Z', status: 'closed', items: [
        { lineId: 'general-line', productId: 'general-1', name: 'Producto general', quantity: 1, stockDeducted: 1,
          batchId: 'batch-general' }
      ] }
    ];

    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters, limit: 100 });
    expect(page.rows.filter((row) => row.saleId === 'sale-rx' && row.movementType === 'dispensation')).toHaveLength(1);
    expect(page.rows.filter((row) => row.saleId === 'sale-rx' && row.movementType === 'sale')).toMatchObject([
      { saleItemId: 'sale-line', batchId: 'batch-sale', quantity: 1 }
    ]);
    expect(page.rows.some((row) => row.saleId === 'sale-general')).toBe(false);
  });

  it('keeps archived cancelled local sales visible with limited coverage and a review warning', async () => {
    mocks.stores.menu = [{ id: 'medicine-1', name: 'Medicamento',
      metadata: { pharmacy: { kind: 'medicine' } } }];
    mocks.stores.inventory_events = [{
      id: 'evt-cancelled-sale', type: 'INVENTORY_DEDUCTION', saleId: 'sale-cancelled',
      productId: 'medicine-1', delta: -2, timestamp: '2026-11-11T14:00:00.000Z'
    }];
    mocks.stores.deleted_sales = [{
      id: 'sale-cancelled', timestamp: '2026-11-11T14:00:00.000Z', status: 'cancelled',
      items: [{ lineId: 'line-1', productId: 'medicine-1', quantity: 2, stockDeducted: 2 }]
    }];

    const page = await getSanitaryRegisterPage({ cloud: false, actorIdentity, filters });
    const sale = page.rows.find((row) => row.movementType === 'sale');
    expect(sale).toMatchObject({ saleId: 'sale-cancelled', saleStatus: 'cancelled', quantity: 2, traceStatus: 'incomplete' });
    expect(sanitaryIncidences(sale)).toContain('Venta cancelada; revisar la devolución asociada');
    expect(sanitaryIncidences(sale)).toContain('La salida local no conserva una asignación de lote verificable');
    expect(mocks.stores.deleted_sales).toHaveLength(1);
  });

  it('denies establishment-wide register to Staff without global audit permission', () => {
    mocks.state = {
      status: 'granted', actorType: 'staff', actorId: 'staff-1', sessionId: 's2',
      permissions: { reports: true }
    };
    expect(() => assertSanitaryReader('staff:staff-1:s2')).toThrow('Sesión o permiso');
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
