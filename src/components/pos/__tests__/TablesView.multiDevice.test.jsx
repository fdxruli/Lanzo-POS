// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ database: null, app: null, list: vi.fn(), generation: 1 }));
vi.mock('../../../services/db', () => ({
  STORES: { SALES: 'sales' },
  db: { table: (name) => fixture.database.table(name), transaction: (...args) => fixture.database.transaction(...args) }
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(fixture.app), { getState: () => fixture.app })
}));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({ useActiveOrders: { getState: () => ({}) } }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({ status: 'granted', actorKey: 'admin:qa', generation: fixture.generation,
    tenant: { opaqueId: 'tenant-qa', databaseName: 'qa', generation: 1 } })
}));
vi.mock('../../../services/auth/actorRuntimeController', () => ({ actorRuntimeController: {
  capture: () => {
    const generation = fixture.generation;
    return { actorKey: 'admin:qa', tenant: { opaqueId: 'tenant-qa', databaseName: 'qa', generation: 1 },
      assertCurrent: () => { if (generation !== fixture.generation) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' }); } };
  }
} }));
vi.mock('../../../services/auth/salesPermissionPolicy', () => ({ canPerformRefunds: () => false }));
vi.mock('../../../services/sync/syncConstants', () => ({
  getLicenseKeyFromDetails: (license) => license?.key,
  isRestaurantOrdersCloudEnabled: (license) => license?.cloud === true
}));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({ restaurantOrdersRepository: {
  getRestaurantOrders: (...args) => fixture.list(...args)
} }));
vi.mock('../../../hooks/restaurant/useRestaurantOrderCloudStatus', () => ({
  RESTAURANT_CLOUD_STATUS_EVENT: 'lanzo:restaurant-orders-cloud-updated',
  buildRestaurantCloudStatusSummary: (order) => ({ items: order?.items || [], status: order?.fulfillmentStatus || 'pending',
    statusLabel: 'En cocina', isCancelled: order?.fulfillmentStatus === 'cancelled', hasCancelledItems: false }),
  getRestaurantOrderCloudStatusSnapshot: vi.fn(),
  useRestaurantOrderCloudStatus: () => ({ items: [], isCloudStatusEnabled: false, getItemStatusLabel: () => 'Pendiente' })
}));
vi.mock('../../../services/restaurant/restaurantOrderAccountAdjustment', () => ({
  applyKitchenCancelledItemsAdjustment: () => ({ success: true, changed: false }),
  persistKitchenCancelledItemsAdjustment: vi.fn()
}));
vi.mock('../../../services/utils', () => ({ showMessageModal: vi.fn(), showConfirmModal: vi.fn() }));

import TablesView from '../TablesView';
import { useActiveTablesCount } from '../../../hooks/pos/useActiveTablesCount';
import { useRestaurantActiveTables } from '../../../hooks/restaurant/useRestaurantActiveTables';

const remote = (id = 'order-A') => ({ id: `cloud-${id}`, localOrderId: id, tableLabel: 'Mesa QA-19',
  status: 'pending', fulfillmentStatus: 'pending', paymentStatus: 'unpaid', total: 120, subtotal: 120,
  updatedAt: '2026-10-05T10:00:00.000Z', items: [] });

beforeEach(async () => {
  fixture.generation = 1;
  fixture.database = new Dexie(`qa19-device-b-${crypto.randomUUID()}`);
  fixture.database.version(1).stores({ sales: 'id,status' });
  await fixture.database.open();
  fixture.app = { licenseDetails: { key: 'license-qa', cloud: true, valid: true },
    currentDeviceRole: 'admin', canAccess: () => true };
  fixture.list.mockReset().mockResolvedValue({ success: true, orders: [remote()] });
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); fixture.database.close(); await fixture.database.delete(); });

describe('QA-19 multi-device table discovery', () => {
  it('keeps the shared table count stable while the modal opens and closes with another consumer mounted', async () => {
    const cloudOrders = [
      ...Array.from({ length: 30 }, (_, index) => remote(`active-${index}`)),
      ...Array.from({ length: 6 }, (_, index) => ({
        ...remote(`cancelled-${index}`), fulfillmentStatus: 'cancelled'
      }))
    ];
    fixture.list.mockResolvedValue({ success: true, orders: cloudOrders });
    const { result } = renderHook(() => useActiveTablesCount(true));
    const modal = render(<TablesView show onClose={vi.fn()} />);

    await waitFor(() => {
      expect(result.current.activeTablesCount).toBe(30);
      expect(result.current.kitchenRejectedOpenCount).toBe(6);
    });
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2));
    expect(fixture.list.mock.calls.map(([args]) => args.force)).toEqual([false, false]);

    modal.rerender(<TablesView show={false} onClose={vi.fn()} />);
    expect(result.current.activeTablesCount + result.current.kitchenRejectedOpenCount).toBe(36);
    modal.rerender(<TablesView show onClose={vi.fn()} />);
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(3));
    expect(result.current.activeTablesCount + result.current.kitchenRejectedOpenCount).toBe(36);

    fixture.list.mockClear().mockResolvedValue({ success: true, orders: [...cloudOrders, remote('new-table')] });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar mesas' }));
    await waitFor(() => expect(result.current.activeTablesCount + result.current.kitchenRejectedOpenCount).toBe(37));
    expect(fixture.list.mock.calls.some(([args]) => args.force === true)).toBe(true);
    expect(fixture.list.mock.calls.some(([args]) => args.force === false)).toBe(true);
  });

  it('treats stale reads as neutral and preserves the last good count on real errors', async () => {
    const initialOrders = [
      ...Array.from({ length: 30 }, (_, index) => remote(`stable-active-${index}`)),
      ...Array.from({ length: 6 }, (_, index) => ({
        ...remote(`stable-cancelled-${index}`), fulfillmentStatus: 'cancelled'
      }))
    ];
    fixture.list.mockResolvedValue({ success: true, orders: initialOrders });
    const { result } = renderHook(() => useRestaurantActiveTables());
    await waitFor(() => expect(result.current.active + result.current.kitchenRejected).toBe(36));

    const stale = Object.assign(new Error('discarded generation'), { code: 'CLOUD_REQUEST_RESPONSE_STALE' });
    fixture.list.mockReset().mockRejectedValue(stale);
    window.dispatchEvent(new CustomEvent('lanzo:restaurant-orders-cloud-updated'));
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.tables).toHaveLength(36));
    expect(result.current.warning).toBe('');

    fixture.list.mockReset().mockRejectedValue(new Error('network unavailable'));
    window.dispatchEvent(new CustomEvent('lanzo:restaurant-orders-cloud-updated'));
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.warning).toBe('No se pudieron actualizar las mesas de otros dispositivos.'));
    expect(result.current.tables).toHaveLength(36);

    const nextOrders = [...initialOrders, remote('new-after-refresh')];
    fixture.list.mockReset().mockResolvedValue({ success: true, orders: nextOrders });
    await act(async () => { await result.current.refresh({ force: true }); });
    await waitFor(() => expect(result.current.tables).toHaveLength(37));
    expect(fixture.list).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('Device B with empty Dexie discovers Device A table from Cloud', async () => {
    expect(await fixture.database.table('sales').count()).toBe(0);
    render(<TablesView show onClose={vi.fn()} />);
    expect(await screen.findByText('Mesa QA-19')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 en servicio')).toBeTruthy());
    expect(fixture.list).toHaveBeenCalled();
  });

  it('badge counts three Cloud-only tables and deduplicates a local counterpart', async () => {
    fixture.list.mockResolvedValue({ success: true, orders: ['order-A', 'order-B', 'order-C'].map(remote) });
    await fixture.database.table('sales').put({ id: 'order-A', status: 'open', tableData: 'Local A', total: 120 });
    const { result } = renderHook(() => useActiveTablesCount(true));
    await waitFor(() => expect(result.current.activeTablesCount).toBe(3));
    expect(result.current.kitchenRejectedOpenCount).toBe(0);
  });

  it('keeps pending local table visible while Cloud refresh is loading and after failure', async () => {
    let rejectCloud;
    fixture.list.mockImplementation(() => new Promise((resolve, reject) => { rejectCloud = reject; }));
    await fixture.database.table('sales').put({ id: 'pending', status: 'open', tableData: 'Mesa pendiente', items: [], total: 20 });
    render(<TablesView show />);
    expect(await screen.findByText('Mesa pendiente')).toBeTruthy();
    await waitFor(() => expect(rejectCloud).toBeTypeOf('function'));
    await act(async () => rejectCloud(new Error('network')));
    expect(await screen.findByText('No se pudieron actualizar las mesas de otros dispositivos.')).toBeTruthy();
    expect(screen.getByText('Mesa pendiente')).toBeTruthy();
  });

  it('Free reads only Dexie, including live writes, without a Cloud notice or RPC', async () => {
    fixture.app.licenseDetails.cloud = false;
    const { result } = renderHook(() => useActiveTablesCount(true));
    await act(async () => fixture.database.table('sales').put({ id: 'free', status: 'open', tableData: 'Mesa Free' }));
    await waitFor(() => expect(result.current.activeTablesCount).toBe(1));
    render(<TablesView show />);
    expect(await screen.findByText('Mesa Free')).toBeTruthy();
    expect(fixture.list).not.toHaveBeenCalled();
    expect(screen.queryByText('Actualizar mesas')).toBeNull();
  });

  it('offline shows only local cache with an explicit notice', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await fixture.database.table('sales').put({ id: 'cached', status: 'open', tableData: 'Mesa cache', items: [] });
    render(<TablesView show />);
    expect(await screen.findByText('Mesa cache')).toBeTruthy();
    expect(await screen.findByText('Sin conexión. Se muestran únicamente las mesas disponibles en este dispositivo.')).toBeTruthy();
    expect(fixture.list).not.toHaveBeenCalled();
  });

  it('preserves explicit paid evidence through failure and offline without deleting the origin or its reservations', async () => {
    await fixture.database.table('sales').put({ id: 'order-A', status: 'open', tableData: 'Mesa origen', items: [], total: 120 });
    fixture.list.mockResolvedValue({ success: true, orders: [{ ...remote(), paymentStatus: 'paid' }] });
    render(<TablesView show />);
    await waitFor(async () => expect(await fixture.database.table('sales').get('order-A')).toMatchObject({
      status: 'open', restaurantCloudTerminalState: 'terminal', total: 120
    }));
    expect(screen.queryByText('Mesa origen')).toBeNull();
    fixture.list.mockResolvedValue({ success: false, orders: [] });
    fireEvent.click(screen.getByText('Actualizar mesas'));
    expect(await screen.findByText('No se pudieron actualizar las mesas de otros dispositivos.')).toBeTruthy();
    expect(screen.queryByText('Mesa origen')).toBeNull();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText('Sin conexión. Se muestran únicamente las mesas disponibles en este dispositivo.')).toBeTruthy();
    expect(screen.queryByText('Mesa origen')).toBeNull();
  });

  it('refresh and search cover Cloud-only tables; cancelled kitchen rows appear in one section', async () => {
    fixture.list.mockResolvedValue({ success: true, orders: [remote(), { ...remote('cancelled'), tableLabel: 'Mesa rechazada', fulfillmentStatus: 'cancelled' }] });
    render(<TablesView show />);
    expect(await screen.findByText('Mesa rechazada')).toBeTruthy();
    expect(screen.getByText('1 en servicio')).toBeTruthy();
    expect(screen.getByText('1 rechazadas')).toBeTruthy();
    expect(screen.getAllByText('Mesa rechazada')).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Buscar mesa u orden...'), { target: { value: 'QA-19' } });
    expect(screen.getByText('Mesa QA-19')).toBeTruthy();
    expect(screen.queryByText('Mesa rechazada')).toBeNull();
    fixture.list.mockResolvedValue({ success: true, orders: [] });
    fireEvent.click(screen.getByText('Actualizar mesas'));
    await waitFor(() => expect(screen.queryByText('Mesa QA-19')).toBeNull());
  });

  it('discards a Cloud response from a previous actor generation', async () => {
    let resolveOld;
    fixture.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<TablesView show />);
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    fixture.generation += 1;
    fixture.list.mockResolvedValue({ success: true, orders: [] });
    view.rerender(<TablesView show />);
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2));
    await act(async () => resolveOld({ success: true, orders: [remote()] }));
    expect(screen.queryByText('Mesa QA-19')).toBeNull();
  });

  it('Staff without read permissions does not discover Cloud tables', async () => {
    fixture.app.currentDeviceRole = 'staff';
    fixture.app.canAccess = () => false;
    render(<TablesView show />);
    expect(await screen.findByText('No hay mesas activas en este momento.')).toBeTruthy();
    expect(fixture.list).not.toHaveBeenCalled();
  });

  it('does not expose a previously hydrated Cloud cache to Staff without permissions', async () => {
    await fixture.database.table('sales').put({ id: 'shadow', status: 'open', tableData: 'Mesa privada',
      restaurantCloudHydrated: true, reservationAuthority: 'cloud' });
    fixture.app.currentDeviceRole = 'staff';
    fixture.app.canAccess = () => false;
    const { result } = renderHook(() => useActiveTablesCount(true));
    render(<TablesView show />);
    await waitFor(() => expect(screen.getByText('No hay mesas activas en este momento.')).toBeTruthy());
    expect(screen.queryByText('Mesa privada')).toBeNull();
    expect(result.current.activeTablesCount).toBe(0);
    expect(fixture.list).not.toHaveBeenCalled();
  });
});
