import { db, STORES } from '../db/dexie';
import { reportingService } from '../db/reporting';
import { reportsMapper } from './reportsMapper';

const sum = (rows = [], selector = (row) => row) => rows.reduce((total, row) => total + (Number(selector(row)) || 0), 0);

const inventoryValue = (menu = []) => sum(menu, (product) => Math.max(Number(product.stock || 0) - Number(product.committedStock || 0), 0) * Number(product.cost || 0));

const buildLocalOverview = ({ sales = [], wasteLogs = [], menu = [], customers = [], layawayFinancial = {} } = {}) => ({
  sales_total: sum(sales, (sale) => sale.total),
  sales_count: sales.length,
  waste_total: sum(wasteLogs, (log) => log.lossAmount || log.amount || log.cost),
  waste_count: wasteLogs.length,
  customers_total: customers.length,
  customers_with_debt: customers.filter((customer) => Number(customer.debt || 0) > 0).length,
  debt_total: sum(customers, (customer) => customer.debt),
  products_active: menu.filter((product) => product.isActive !== false).length,
  products_without_stock: menu.filter((product) => product.isActive !== false && product.trackStock !== false && Number(product.stock || 0) <= 0).length,
  inventory_value_approx: inventoryValue(menu),
  // Kept for older report consumers; the explicit fields below distinguish the
  // payment record from cash that has a verifiable Caja movement.
  layaway_payments_collected: Number(layawayFinancial.layawayCashCollected ?? layawayFinancial.layawayPaymentsCollected ?? 0),
  layaway_payments_recorded: Number(layawayFinancial.layawayPaymentsRecorded || 0),
  layaway_cash_collected: Number(layawayFinancial.layawayCashCollected ?? layawayFinancial.layawayPaymentsCollected ?? 0),
  layaway_pending_advances: Number(layawayFinancial.layawayPendingAdvances || 0),
  unlinked_technical_payments: Number(layawayFinancial.unlinkedTechnicalPayments?.length || 0),
  unlinked_technical_payments_amount: Number(layawayFinancial.unlinkedTechnicalPaymentsAmount || 0),
  probable_legacy_cash_matches: Number(layawayFinancial.probableLegacyCashMatches?.length || 0),
  probable_legacy_cash_backing_amount: Number(layawayFinancial.probableLegacyCashBackingAmount || 0),
  invalid_cash_movement_links: Number(layawayFinancial.paymentsWithInvalidCashMovementLink?.length || 0),
  invalid_cash_movement_links_amount: Number(layawayFinancial.paymentsWithInvalidCashMovementLinkAmount || 0),
  unverified_historical_payments: Number(layawayFinancial.unverifiedHistoricalPayments?.length || 0),
  unverified_historical_payments_amount: Number(layawayFinancial.unverifiedHistoricalPaymentsAmount || 0),
  layaway_completed_revenue: Number(layawayFinancial.layawayCompletedRevenue || 0),
  layaway_completed_cost: Number(layawayFinancial.layawayCompletedCost || 0),
  layaway_completed_gross_profit: Number(layawayFinancial.layawayCompletedGrossProfit || 0),
  layaway_refunds: Number(layawayFinancial.layawayRefunds || 0),
  layaway_retained_penalties: Number(layawayFinancial.layawayRetainedPenalties || 0)
});

export const reportsLocalRepository = {
  async getOverviewReport(filters = {}) {
    const report = await reportingService.getDashboardReport({
      rangoFechas: filters.rangoFechas || filters.dateRange || null,
      rubros: filters.rubros || [],
      incluirCanceladas: false,
      incluirMermas: true,
      incluirProductos: true,
      incluirClientes: true
    });

    return reportsMapper.normalizeLocalOverview({
      ...report,
      overview: buildLocalOverview(report)
    });
  },

  async getCashReport() {
    if (!db.isOpen()) await db.open();
    const [sessions, movements] = await Promise.all([
      db.table(STORES.CAJAS).toArray(),
      db.table(STORES.MOVIMIENTOS_CAJA).toArray()
    ]);

    return reportsMapper.normalizeReportPayload({
      success: true,
      generated_at: new Date().toISOString(),
      summary: {
        open_sessions: sessions.filter((session) => session.estado === 'abierta' || session.status === 'open').length,
        closed_sessions: sessions.filter((session) => session.estado === 'cerrada' || session.status === 'closed').length,
        movement_count: movements.length
      },
      sessions,
      movements,
      source: { mode: 'local', official: [], local: ['cash'], warnings: ['Caja local de este dispositivo.'] }
    }, { mode: 'local' });
  },

  async getCustomerCreditReport() {
    if (!db.isOpen()) await db.open();
    const customers = await db.table(STORES.CUSTOMERS).toArray();
    const ledger = await db.table(STORES.CUSTOMER_LEDGER).toArray().catch(() => []);

    return reportsMapper.normalizeReportPayload({
      success: true,
      generated_at: new Date().toISOString(),
      summary: {
        debt_total: sum(customers, (customer) => customer.debt),
        customers_total: customers.length,
        customers_with_debt: customers.filter((customer) => Number(customer.debt || 0) > 0).length
      },
      top_debtors: customers.filter((customer) => Number(customer.debt || 0) > 0).sort((a, b) => Number(b.debt || 0) - Number(a.debt || 0)).slice(0, 25),
      ledger,
      source: { mode: 'local', official: [], local: ['customer_credit'], warnings: ['Credito local de este dispositivo.'] }
    }, { mode: 'local' });
  },

  async getProductCatalogReport() {
    if (!db.isOpen()) await db.open();
    const menu = await db.table(STORES.MENU).toArray();
    return reportsMapper.normalizeReportPayload({
      success: true,
      generated_at: new Date().toISOString(),
      summary: {
        products_active: menu.filter((product) => product.isActive !== false).length,
        products_inactive: menu.filter((product) => product.isActive === false).length,
        products_without_stock: menu.filter((product) => product.isActive !== false && product.trackStock !== false && Number(product.stock || 0) <= 0).length,
        inventory_value_approx: inventoryValue(menu)
      },
      inventory: menu,
      source: { mode: 'local', official: [], local: ['products'], warnings: ['Catalogo local de este dispositivo.'] }
    }, { mode: 'local' });
  },

  async getTimeseriesReport() {
    return reportsMapper.normalizeReportPayload({ success: true, generated_at: new Date().toISOString(), rows: [], source: { mode: 'local', official: [], local: ['sales', 'waste'], warnings: ['Series locales limitadas al dispositivo.'] } }, { mode: 'local' });
  }
};

export default reportsLocalRepository;
