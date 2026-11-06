import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActorRuntimeController } from '../auth/actorRuntimeController';
import { readBotBusinessData } from '../botReadService';

const mocks = vi.hoisted(() => ({ controller: null, overview: vi.fn(), credit: vi.fn(), lowStock: vi.fn(), expiration: vi.fn() }));
vi.mock('../auth/actorRuntimeController', async original => ({ ...(await original()), actorRuntimeController: { capture: (...args) => mocks.controller.capture(...args) } }));
vi.mock('../reports/reportsRepository', () => ({ reportsRepository: { getOverviewReport: mocks.overview, getCustomerCreditReport: mocks.credit } }));
vi.mock('../inventoryAnalysis', () => ({ getLowStockProductsReport: mocks.lowStock, getExpiringProductsReport: mocks.expiration }));

const timeframe = { label: 'hoy', dateFrom: '2026-11-06T00:00:00.000Z', dateTo: '2026-11-06T23:59:59.999Z', start: new Date('2026-11-06'), end: new Date('2026-11-07') };
let tenant;
const grant = (actorType = 'admin', permissions = []) => {
  mocks.controller.beginAuthentication({ actorType });
  mocks.controller.grant({ actorType, actorId: 'actor', sessionId: 'session', permissions, authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString() });
};
const local = (sales = []) => ({ success: true, source: { mode: 'local' }, sales });
const sale = { status: 'closed', timestamp: '2026-11-06T12:00:00Z', total: 80, subtotal: 100, items: [{ id: 'a', name: 'Prueba', price: 100, quantity: 1, lineTotal: 80, cost: 40 }] };
beforeEach(() => {
  vi.clearAllMocks();
  tenant = { opaqueId: 'A', databaseName: 'LanzoDB_t_A', generation: 1 };
  mocks.controller = createActorRuntimeController({ getTenantAuthority: () => tenant });
  grant(); mocks.overview.mockResolvedValue(local([sale])); mocks.credit.mockResolvedValue({ success: true, source: { mode: 'local' }, top_debtors: [] });
});
describe('Bot authorized business reads', () => {
  it('reuses the financial policy for discounts, sale states and monetary precision', async () => {
    mocks.overview.mockResolvedValue(local([sale, { ...sale, status: 'cancelled' }, { ...sale, status: 'open' }]));
    const answer = await readBotBusinessData('profit_report', timeframe);
    expect(answer.message).toContain('40.00');
    expect(answer.message).toContain('estimada');
    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'license', dateFrom: timeframe.dateFrom }));
  });
  it('never calls reports for Staff without reports permission', async () => {
    mocks.controller = createActorRuntimeController({ getTenantAuthority: () => tenant }); grant('staff', ['pos']);
    expect((await readBotBusinessData('sales_report', timeframe)).title).toBe('Consulta protegida');
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it('requires the module permission in addition to reports for customer data', async () => {
    mocks.controller = createActorRuntimeController({ getTenantAuthority: () => tenant }); grant('staff', ['reports']);
    expect((await readBotBusinessData('customer_debt', timeframe)).title).toBe('Consulta protegida');
    expect(mocks.credit).not.toHaveBeenCalled();
  });
  it('requests the current Staff scope and rejects a business-wide local fallback', async () => {
    mocks.controller = createActorRuntimeController({ getTenantAuthority: () => tenant }); grant('staff', ['reports']);
    expect((await readBotBusinessData('sales_report', timeframe)).message).toContain('no separa');
    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'mine' }));
  });
  it('discards the result when tenant changes during the service read', async () => {
    mocks.overview.mockImplementation(async () => { tenant = { opaqueId: 'B', databaseName: 'LanzoDB_t_B', generation: 2 }; return local([sale]); });
    const answer = await readBotBusinessData('sales_report', timeframe);
    expect(answer.title).toBe('Datos no confirmados'); expect(answer.message).not.toContain('80.00');
  });
  it('discards a result when the actor locks during reading', async () => {
    mocks.overview.mockImplementation(async () => { mocks.controller.lock('test'); return local([sale]); });
    expect((await readBotBusinessData('sales_report', timeframe)).title).toBe('Datos no confirmados');
  });
  it('does not convert an exception or absent cloud metrics into zero', async () => {
    mocks.overview.mockRejectedValueOnce(new Error('Database error'));
    const failure = await readBotBusinessData('sales_report', timeframe);
    expect(failure.retryable).toBe(true); expect(failure.message).not.toMatch(/\$0/);
    mocks.overview.mockResolvedValue({ success: true, source: { mode: 'cloud_final' }, overview: {} });
    expect((await readBotBusinessData('sales_report', timeframe)).title).toBe('Datos no confirmados');
  });
  it('explains an empty local dataset and missing costs without claiming profit', async () => {
    mocks.overview.mockResolvedValueOnce(local());
    expect((await readBotBusinessData('sales_report', timeframe)).title).toContain('Sin ventas');
    mocks.overview.mockResolvedValue(local([{ ...sale, items: [{ ...sale.items[0], cost: null }] }]));
    expect((await readBotBusinessData('profit_report', timeframe)).message).toContain('Faltan costos');
  });
  it('uses cloud final net metrics and preserves stale/source warnings', async () => {
    mocks.overview.mockResolvedValue({ success: true, source: { mode: 'cache', stale: true, warnings: ['Operaciones pendientes'] }, overview: { net_sales_total: 123.45 } });
    const answer = await readBotBusinessData('sales_report', timeframe);
    expect(answer.message).toContain('123.45'); expect(answer.tips.join(' ')).toContain('desactualizado'); expect(answer.tips).toContain('Operaciones pendientes');
  });
  it('prefers the official cents contract over the legacy customer debt field', async () => {
    mocks.credit.mockResolvedValue({ success: true, source: { mode: 'cloud' }, top_debtors: [{ name: 'Cliente de prueba', debt_cents: 1250, debt: 999 }] });
    const answer = await readBotBusinessData('customer_debt', timeframe);
    expect(answer.message).toContain('12.50'); expect(answer.message).not.toContain('999');
  });
  it('uses strict inventory reads and distinguishes failure from no matches', async () => {
    mocks.lowStock.mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValueOnce([]);
    expect((await readBotBusinessData('low_stock', timeframe)).retryable).toBe(true);
    expect(mocks.lowStock).toHaveBeenCalledWith({ limit: 5, throwOnError: true });
    expect((await readBotBusinessData('low_stock', timeframe)).message).toContain('no encontró');
  });
  it('reuses the existing local product aggregation for a complete local period', async () => {
    const answer = await readBotBusinessData('top_products', timeframe);
    expect(answer.message).toContain('Prueba: 1 unidades');
  });
  it('never computes a cloud ranking from incomplete pages', async () => {
    mocks.overview.mockResolvedValue({ success: true, source: { mode: 'cloud_final' }, overview: {} });
    expect((await readBotBusinessData('top_products', timeframe)).message).toContain('ranking completo');
  });
  it('refuses cached local data for Staff even when the source mode says cache', async () => {
    mocks.controller = createActorRuntimeController({ getTenantAuthority: () => tenant }); grant('staff', ['reports']);
    mocks.overview.mockResolvedValue({ success: true, source: { mode: 'cache', local: ['all'] }, overview: { net_sales_total: 99999 } });
    const answer = await readBotBusinessData('sales_report', timeframe);
    expect(answer.title).toBe('Datos no confirmados'); expect(answer.message).not.toContain('99999');
  });
  it('does not expose a response after cancellation', async () => {
    const controller = new AbortController();
    mocks.overview.mockImplementation(async () => { controller.abort(); return local([sale]); });
    await expect(readBotBusinessData('sales_report', timeframe, { signal: controller.signal })).rejects.toMatchObject({ code: 'BOT_CANCELLED' });
  });
});
