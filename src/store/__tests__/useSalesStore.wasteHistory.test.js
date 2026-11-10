import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/database', () => ({
  STORES: { SALES: 'sales', WASTE: 'waste' },
  loadDataPaginated: vi.fn()
}));
vi.mock('../../services/salesService', () => ({
  cancelSale: vi.fn(),
  moveCancelledSaleToTrash: vi.fn()
}));
vi.mock('../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), log: vi.fn() }
}));

import { loadDataPaginated } from '../../services/database';
import { useSalesStore } from '../useSalesStore';

const rows = (count) => Array.from({ length: count }, (_, i) => ({
  id: `merma-${i}`,
  timestamp: new Date(Date.UTC(2026, 10, 9) - i * 1000).toISOString(),
  lossAmount: i + 1
}));

const mockLocalPages = (records) => {
  loadDataPaginated.mockImplementation(async (store, { limit, cursor }) => {
    if (store === 'sales') return { data: [], nextCursor: null };
    const eligible = records.filter((row) => !cursor || row.timestamp < cursor);
    const page = eligible.slice(0, limit);
    return { data: page, nextCursor: page.length === limit ? page.at(-1).timestamp : null };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useSalesStore.setState({
    sales: [],
    wasteLogs: [],
    wasteCursorStack: [null],
    currentWastePageIndex: 0,
    hasMoreWaste: false,
    isWasteLoading: false,
    wasteLoaded: false,
    wasteError: null,
    wasteContextKey: null,
    wasteRequestId: 0,
    isLoading: false
  });
});

describe('historial local de mermas', () => {
  it('muestra páginas de 50 sin duplicados y detecta si quedan registros', async () => {
    mockLocalPages(rows(52));
    const store = useSalesStore.getState();
    store.setWasteContext('negocio-a');
    await store.loadRecentSales();
    expect(useSalesStore.getState().wasteLogs).toHaveLength(50);
    expect(useSalesStore.getState().hasMoreWaste).toBe(true);

    await store.fetchWastePage('next');
    expect(useSalesStore.getState().currentWastePageIndex).toBe(1);
    expect(useSalesStore.getState().wasteLogs.map((x) => x.id)).toEqual(['merma-50', 'merma-51']);
    expect(useSalesStore.getState().hasMoreWaste).toBe(false);

    await store.fetchWastePage('prev');
    expect(useSalesStore.getState().currentWastePageIndex).toBe(0);
    expect(useSalesStore.getState().wasteLogs.map((x) => x.id)).toEqual(rows(50).map((x) => x.id));
    expect(useSalesStore.getState().hasMoreWaste).toBe(true);
    expect(loadDataPaginated).toHaveBeenCalledWith('waste', expect.objectContaining({ limit: 51 }));
  });

  it('no ofrece una página inexistente cuando hay exactamente 50 registros', async () => {
    mockLocalPages(rows(50));
    useSalesStore.getState().setWasteContext('negocio-a');
    await useSalesStore.getState().loadRecentSales();
    expect(useSalesStore.getState().hasMoreWaste).toBe(false);
    expect(useSalesStore.getState().wasteLoaded).toBe(true);
  });

  it('distingue un fallo de lectura del historial vacío y permite reintentar', async () => {
    loadDataPaginated.mockImplementation(async (store) => {
      if (store === 'sales') return { data: [], nextCursor: null };
      throw new Error('falla local');
    });
    useSalesStore.getState().setWasteContext('negocio-a');
    await useSalesStore.getState().loadRecentSales();
    expect(useSalesStore.getState().wasteLoaded).toBe(false);
    expect(useSalesStore.getState().wasteError).toContain('No se pudo consultar');
    expect(useSalesStore.getState().wasteLogs).toEqual([]);

    mockLocalPages(rows(1));
    await useSalesStore.getState().fetchWastePage('current');
    expect(useSalesStore.getState().wasteError).toBeNull();
    expect(useSalesStore.getState().wasteLoaded).toBe(true);
    expect(useSalesStore.getState().wasteLogs).toHaveLength(1);
  });

  it('no reaplica una lectura antigua al cambiar de negocio o actor', async () => {
    let resolveWaste;
    loadDataPaginated.mockImplementation((store) => (
      store === 'sales'
        ? Promise.resolve({ data: [], nextCursor: null })
        : new Promise((resolve) => { resolveWaste = resolve; })
    ));
    useSalesStore.getState().setWasteContext('negocio-a');
    const pending = useSalesStore.getState().loadRecentSales();
    useSalesStore.getState().setWasteContext('negocio-b');
    resolveWaste({ data: rows(1), nextCursor: null });
    await pending;
    expect(useSalesStore.getState().wasteContextKey).toBe('negocio-b');
    expect(useSalesStore.getState().wasteLogs).toEqual([]);
    expect(useSalesStore.getState().wasteLoaded).toBe(false);
  });
});