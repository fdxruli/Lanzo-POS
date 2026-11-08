// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  actor: null,
  historyRequests: [],
  getOverviewReport: vi.fn(),
  getSalesFinalHistory: vi.fn(),
  reportMode: { cloudSalesFinal: true, cloudReports: true, online: true },
  features: { activeRubros: [], hasWaste: false },
  loadStats: vi.fn(async () => {}),
  loadRecentSales: vi.fn(async () => {}),
  fetchSalesPage: vi.fn(),
  loadRecycleBin: vi.fn(async () => {}),
  loadWastePage: vi.fn(),
  salesState: null,
  statsState: null
}));

vi.mock('../../hooks/useBotScreenContext', () => ({ usePublishBotScreen: vi.fn() }));
vi.mock('../../hooks/useFeatureConfig', () => ({ useFeatureConfig: () => harness.features }));
vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({ useActorRuntimeSnapshot: () => harness.actor }));
vi.mock('../../services/auth/refundsActorAuthorization', () => ({ captureRefundsActorHandle: vi.fn() }));
vi.mock('../../services/database', () => ({
  loadData: vi.fn(async () => []),
  STORES: { CUSTOMERS: 'customers' }
}));
vi.mock('../../services/db/reporting', () => ({
  reportingService: { getDashboardReport: vi.fn(async () => ({ sales: [], wasteLogs: [], menu: [] })) }
}));
vi.mock('../../services/reports/reportsRepository', () => ({
  REPORT_SYNC_UPDATED_EVENT: 'reports-sync-updated',
  reportsRepository: {
    getReportMode: () => harness.reportMode,
    getOverviewReport: harness.getOverviewReport,
    getSalesFinalHistory: harness.getSalesFinalHistory
  }
}));
vi.mock('../../services/Logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), log: vi.fn() } }));
vi.mock('../../services/utils', () => ({ showConfirmModal: vi.fn(), showMessageModal: vi.fn() }));
vi.mock('../../services/sales/cancelSaleCore', () => ({
  CANCELLATION_ACTIONS: { RESTOCK: 'RESTOCK', WASTE: 'WASTE', NO_RETURN: 'NO_RETURN' }
}));

vi.mock('../../store/useStatsStore', () => ({ useStatsStore: (selector) => selector(harness.statsState) }));
vi.mock('../../store/useSalesStore', () => ({ useSalesStore: (selector) => selector(harness.salesState) }));
vi.mock('../../store/useRecycleBinStore', () => ({
  useRecycleBinStore: (selector) => selector({ loadRecycleBin: harness.loadRecycleBin })
}));
vi.mock('../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector({ menu: [] })
}));

vi.mock('../../components/dashboard/StatsGrid', () => ({ default: () => null }));
vi.mock('../../components/dashboard/CloudFinalStatsGrid', () => ({
  default: ({ creditHistoryReport, reportData, period, onPeriodChange }) => (
    <div>
      <output data-testid="credit-scope">{creditHistoryReport?.scope || 'unavailable'}</output>
      <output data-testid="stats-period">{period}</output>
      <output data-testid="stats-net-sales">{reportData?.overview?.net_sales_total ?? 'unavailable'}</output>
      <button type="button" onClick={() => onPeriodChange('last7')}>Ver 7 días</button>
      <button type="button" onClick={() => onPeriodChange('today')}>Ver Hoy</button>
    </div>
  )
}));
vi.mock('../../components/dashboard/SalesHistory', () => ({
  default: ({ onNext, hasMore, currentPageIndex }) => (
    <div data-testid="sales-history">
      <output data-testid="history-page">{currentPageIndex}</output>
      <button type="button" onClick={onNext} disabled={!hasMore}>Siguiente página</button>
    </div>
  )
}));
vi.mock('../../components/dashboard/RecycleBin', () => ({ default: () => null }));
vi.mock('../../components/dashboard/RestockSuggestion', () => ({ default: () => null }));
vi.mock('../../components/dashboard/OperationalDiagnostics', () => ({ default: () => null }));
vi.mock('../../components/dashboard/WasteHistory', () => ({ default: () => null }));
vi.mock('../../components/dashboard/ExpirationAlert', () => ({ default: () => null }));
vi.mock('../../components/dashboard/SaleCancellationModal', () => ({ default: () => null }));

import DashboardPage from '../DashboardPage';

const dateRange = {
  date_from: '2026-10-09T12:00:00.000Z',
  date_to: '2026-11-08T12:00:00.000Z'
};

const cloudOverview = {
  success: true,
  scope: 'mine',
  dateRange,
  source: { mode: 'cloud_final', final: true, stale: false },
  overview: { net_sales_total: 20, net_sales_count: 1 }
};

const renderDashboard = (actor) => {
  harness.actor = actor;
  harness.getOverviewReport.mockResolvedValue(cloudOverview);
  harness.getSalesFinalHistory.mockImplementation(async (filters) => {
    harness.historyRequests.push(filters);
    return {
      success: true,
      scope: filters.scope,
      dateRange,
      source: { mode: 'cloud_final', final: true, stale: false },
      rows: [{ id: `${filters.scope}-${filters.offset}` }],
      totalCount: 51,
      offset: filters.offset,
      hasMore: filters.offset === 0
    };
  });

  return render(
    <MemoryRouter initialEntries={['/ventas?tab=stats']}>
      <DashboardPage />
    </MemoryRouter>
  );
};

const expectExactReportRange = (request) => {
  expect(request).toMatchObject({ dateFrom: dateRange.date_from, dateTo: dateRange.date_to });
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.historyRequests = [];
  harness.reportMode = { cloudSalesFinal: true, cloudReports: true, online: true };
  harness.features = { activeRubros: [], hasWaste: false };
  harness.statsState = { stats: {}, loadStats: harness.loadStats, isLoading: false };
  harness.salesState = {
    sales: [],
    loadRecentSales: harness.loadRecentSales,
    fetchSalesPage: harness.fetchSalesPage,
    hasMoreSales: false,
    currentSalesPageIndex: 0,
    isSalesLoading: false,
    deleteSale: vi.fn(),
    archiveCancelledSale: vi.fn(),
    isLoading: false,
    wasteLogs: [],
    fetchWastePage: harness.loadWastePage,
    hasMoreWaste: false,
    currentWastePageIndex: 0,
    isWasteLoading: false
  };
});

afterEach(cleanup);

describe('Dashboard Cloud final scope and history pagination', () => {
  it.each([
    ['Admin', { status: 'granted', actorType: 'admin', actorId: 'admin-a', sessionId: 'session-a', permissions: ['*'] }, 'license'],
    ['Staff with audit permission', { status: 'granted', actorType: 'staff', actorId: 'staff-audit', sessionId: 'session-a', permissions: ['reports', 'reports_global'] }, 'license']
  ])('%s keeps the authorized license history while credit uses mine across pagination', async (_label, actor, visibleScope) => {
    renderDashboard(actor);

    expect(await screen.findByTestId('credit-scope')).toHaveTextContent('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Historial y Papelera' }));
    expect(await screen.findByTestId('sales-history')).toBeVisible();
    await waitFor(() => expect(harness.historyRequests).toHaveLength(2));

    const financeRequest = harness.historyRequests.find((request) => request.scope === 'mine');
    const visibleRequest = harness.historyRequests.find((request) => request.scope === visibleScope);
    expect(financeRequest).toMatchObject({ scope: 'mine', limit: 50, offset: 0 });
    expect(visibleRequest).toMatchObject({ scope: visibleScope, limit: 50, offset: 0 });
    expectExactReportRange(financeRequest);
    expect(visibleRequest.dateFrom).toBeTruthy();
    expect(visibleRequest.dateTo).toBeTruthy();
    expect(visibleRequest.dateFrom).not.toBe(dateRange.date_from);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Siguiente página' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
    await waitFor(() => expect(screen.getByTestId('history-page')).toHaveTextContent('1'));
    await waitFor(() => expect(harness.historyRequests).toHaveLength(3));

    expect(harness.historyRequests[2]).toMatchObject({ scope: visibleScope, limit: 50, offset: 50 });
    expect(harness.historyRequests[2]).toMatchObject({ dateFrom: visibleRequest.dateFrom, dateTo: visibleRequest.dateTo });
    expect(harness.getOverviewReport).toHaveBeenCalledTimes(1);
    expect(harness.historyRequests.filter((request) => request.scope === 'mine' && request.offset === 0)).toHaveLength(1);
    expect(harness.historyRequests.some((request) => request.scope === 'mine' && request.offset === 50)).toBe(false);
  });

  it('keeps the visible history query separate and never requests license scope for staff without audit permission', async () => {
    const actor = {
      status: 'granted', actorType: 'staff', actorId: 'staff-basic', sessionId: 'session-a', permissions: ['reports']
    };
    renderDashboard(actor);

    expect(await screen.findByTestId('credit-scope')).toHaveTextContent('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Historial y Papelera' }));
    expect(await screen.findByTestId('sales-history')).toBeVisible();
    await waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(harness.historyRequests[0]).toMatchObject({ scope: 'mine', limit: 50, offset: 0 });
    expect(harness.historyRequests[0].dateFrom).toBeTruthy();
    expect(harness.historyRequests[1]).toMatchObject({ scope: 'mine', limit: 50, offset: 0 });
    expect(harness.historyRequests[1].dateFrom).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Siguiente página' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente página' }));
    await waitFor(() => expect(harness.historyRequests).toHaveLength(3));
    expect(harness.historyRequests[2]).toMatchObject({ scope: 'mine', limit: 50, offset: 50 });
    expect(harness.historyRequests.some((request) => request.scope === 'license')).toBe(false);
    expect(harness.getOverviewReport).toHaveBeenCalledTimes(1);
  });

  it('cambia el período Cloud sin alterar el filtro ni la página del historial visible', async () => {
    const actor = { status: 'granted', actorType: 'admin', actorId: 'admin-a', sessionId: 'session-a', permissions: ['*'] };
    renderDashboard(actor);
    await waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    const visibleInitial = harness.historyRequests.find((request) => request.scope === 'license');
    expect(screen.getByTestId('stats-period')).toHaveTextContent('today');

    fireEvent.click(screen.getByRole('button', { name: 'Ver 7 días' }));
    await waitFor(() => expect(harness.getOverviewReport).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('stats-period')).toHaveTextContent('last7');
    expect(harness.getOverviewReport.mock.calls[0][0]).toMatchObject({ scope: 'mine' });
    expect(harness.getOverviewReport.mock.calls[1][0].dateFrom).not.toBe(harness.getOverviewReport.mock.calls[0][0].dateFrom);
    expect(harness.historyRequests.filter((request) => request.scope === 'license')).toHaveLength(1);
    expect(harness.historyRequests.find((request) => request.scope === 'license')).toMatchObject(visibleInitial);
  });

  it('no deja que una respuesta lenta de otro período reemplace el actual', async () => {
    const actor = { status: 'granted', actorType: 'admin', actorId: 'admin-a', sessionId: 'session-a', permissions: ['*'] };
    renderDashboard(actor);
    await waitFor(() => expect(screen.getByTestId('stats-net-sales')).toHaveTextContent('20'));
    let resolveOld;
    harness.getOverviewReport.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    harness.getOverviewReport.mockImplementationOnce(async () => ({ ...cloudOverview, overview: { net_sales_total: 70 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver 7 días' }));
    await waitFor(() => expect(harness.getOverviewReport).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Ver Hoy' }));
    await waitFor(() => expect(screen.getByTestId('stats-net-sales')).toHaveTextContent('70'));
    resolveOld({ ...cloudOverview, overview: { net_sales_total: 7 } });
    await waitFor(() => expect(screen.getByTestId('stats-net-sales')).toHaveTextContent('70'));
  });

  it('keeps a failed credit reconciliation request separate from the visible sales history request', async () => {
    harness.actor = {
      status: 'granted', actorType: 'staff', actorId: 'staff-basic', sessionId: 'session-a', permissions: ['reports']
    };
    harness.getOverviewReport.mockResolvedValue(cloudOverview);
    harness.getSalesFinalHistory.mockRejectedValue(new Error('history unavailable'));

    render(
      <MemoryRouter initialEntries={['/ventas?tab=stats']}>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('credit-scope')).toHaveTextContent('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Historial y Papelera' }));
    expect(await screen.findByTestId('sales-history')).toBeVisible();
    await waitFor(() => expect(harness.getSalesFinalHistory).toHaveBeenCalledTimes(2));
    expect(harness.getSalesFinalHistory.mock.calls.every(([filters]) => (
      filters.scope === 'mine' && filters.offset === 0
    ))).toBe(true);
  });

  it('does not reuse a history snapshot when no actor session is granted', async () => {
    renderDashboard({ status: 'locked', actorId: null, sessionId: null, permissions: [], generation: 2 });

    fireEvent.click(await screen.findByRole('button', { name: 'Historial y Papelera' }));
    await waitFor(() => expect(harness.getSalesFinalHistory).toHaveBeenCalledTimes(1));

    expect(harness.getSalesFinalHistory).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mine', limit: 50, offset: 0 }),
      { cacheContextKey: null }
    );
  });
});
