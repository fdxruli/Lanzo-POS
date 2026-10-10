import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAppStore } from '../../store/useAppStore';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../../services/sync/syncConstants';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';
import { buildRestaurantActiveTables, countRestaurantActiveTables, fetchRestaurantTableDiscoveryOrders, getRestaurantCloudTableState, rememberRestaurantTableTerminalStates } from '../../services/restaurant/restaurantActiveTables';
import { RESTAURANT_CLOUD_STATUS_EVENT } from '../../services/restaurant/restaurantCloudStatusSummary';
import { isCloudRequestResponseStale } from '../../services/cloud/cloudRequestErrors';
import { recoverRestaurantFalseTerminalMarker } from '../../services/restaurant/restaurantTerminalStateRecovery';
import { useActiveOrders } from '../pos/useActiveOrders';

const readLocalTables = () => db.table(STORES.SALES).where('status').equals(SALE_STATUS.OPEN).toArray();
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const offlineNotice = 'Sin conexión. Se muestran únicamente las mesas disponibles en este dispositivo.';
const cloudNotice = 'No se pudieron actualizar las mesas de otros dispositivos.';
const READ_PERMISSIONS = ['orders', 'pos', 'kitchen', 'kds'];

export function useRestaurantActiveTables({ enabled = true } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const canAccess = useAppStore((state) => state.canAccess);
  const actor = useActorRuntimeSnapshot();
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const tenantId = actor?.tenant?.opaqueId || null;
  const hasPermission = currentDeviceRole !== 'staff'
    || (typeof canAccess === 'function' && READ_PERMISSIONS.some((permission) => canAccess(permission)));
  const runtimeHasPermission = actor?.actorType !== 'staff'
    || READ_PERMISSIONS.some((permission) => actor.permissions?.includes(permission));
  const hasCloudPlan = Boolean(licenseKey && licenseDetails?.valid !== false && isRestaurantOrdersCloudEnabled(licenseDetails));
  const allowCloudCache = !hasCloudPlan || (actor?.status === 'granted' && hasPermission && runtimeHasPermission);
  const cloudEnabled = Boolean(enabled && hasCloudPlan && allowCloudCache);
  const scope = JSON.stringify([licenseKey, tenantId, actor?.tenant?.generation, actor?.generation,
    actor?.actorKey, actor?.sessionId, cloudEnabled]);
  const [data, setData] = useState({ scope: null, localSales: [], cloudOrders: [], isLoading: false, warning: '', error: '' });
  const requests = useRef({ sequence: 0 });

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!enabled) return { success: true, skipped: true };
    const request = ++requests.current.sequence;
    let handle;
    let recoveryWarning = '';
    try {
      if (cloudEnabled) handle = actorRuntimeController.capture();
      let localSales = await readLocalTables();
      handle?.assertCurrent();
      if (request !== requests.current.sequence) return { success: false, code: 'CLOUD_REQUEST_RESPONSE_STALE' };
      setData((previous) => ({ scope, localSales,
        cloudOrders: previous.scope === scope ? previous.cloudOrders : [],
        isLoading: cloudEnabled && online(), warning: '', error: '' }));
      if (!cloudEnabled || !online()) {
        setData((previous) => ({ ...previous, cloudOrders: previous.cloudOrders.filter((row) => getRestaurantCloudTableState(row) === 'terminal'), isLoading: false,
          warning: cloudEnabled ? offlineNotice : '' }));
        return { success: true, skipped: !cloudEnabled, source: online() ? 'local' : 'offline' };
      }
      const response = await fetchRestaurantTableDiscoveryOrders({ repository: restaurantOrdersRepository,
        licenseKey, actorHandle: handle, force });
      handle.assertCurrent();
      if (request !== requests.current.sequence) return { success: false, code: 'CLOUD_REQUEST_RESPONSE_STALE' };
      if (isCloudRequestResponseStale(response)) {
        setData((previous) => previous.scope === scope ? { ...previous, isLoading: false } : previous);
        return response;
      }
      let projectedCloudOrders = response?.success === false ? [] : response.orders;
      if (response?.success !== false) {
        await useActiveOrders.getState().recoverRestaurantCancellationCleanup(response.orders);
        handle.assertCurrent();
        const assertScopedActor = () => {
          handle.assertCurrent();
          if (request !== requests.current.sequence) throw Object.assign(new Error('CLOUD_REQUEST_RESPONSE_STALE'), { code: 'CLOUD_REQUEST_RESPONSE_STALE' });
        };
        const scopedActorHandle = { tenant: handle.tenant, assertCurrent: assertScopedActor };
        const recoveredCloudOrders = [];
        await rememberRestaurantTableTerminalStates({ database: db, stores: STORES, localSales, licenseKey, tenantId,
          cloudOrders: response.orders, actorHandle: scopedActorHandle });
        for (const sale of localSales) {
          if (sale?.restaurantCloudTerminalState !== 'terminal') continue;
          const recovery = await recoverRestaurantFalseTerminalMarker({
            database: db, stores: STORES, licenseKey, localOrderId: sale.id, actorHandle: scopedActorHandle
          });
          if (recovery.code === 'ACTOR_CONTEXT_STALE' || recovery.code === 'CLOUD_REQUEST_RESPONSE_STALE') {
            throw Object.assign(new Error(recovery.code), { code: recovery.code });
          }
          if (recovery.success && recovery.order) recoveredCloudOrders.push(recovery.order);
          if (!recovery.success && recoveryWarning === '') recoveryWarning = recovery.message || cloudNotice;
        }
        assertScopedActor();
        projectedCloudOrders = [...response.orders, ...recoveredCloudOrders];
        localSales = await readLocalTables();
        assertScopedActor();
        if (request !== requests.current.sequence) return { success: false, code: 'CLOUD_REQUEST_RESPONSE_STALE' };
      }
      setData((previous) => ({ ...previous, localSales: response?.success === false ? previous.localSales : localSales, cloudOrders: response?.success === false
        ? previous.cloudOrders : projectedCloudOrders,
        isLoading: false, warning: response?.success === false ? cloudNotice : recoveryWarning }));
      return response;
    } catch (error) {
      if (request !== requests.current.sequence) return { success: false, code: 'CLOUD_REQUEST_RESPONSE_STALE' };
      // An expired handle may never publish Cloud data, including errors, to a
      // newly authenticated actor. The scoped projection clears it on render.
      try { handle?.assertCurrent(); } catch { return { success: false, code: 'CLOUD_REQUEST_RESPONSE_STALE' }; }
      if (isCloudRequestResponseStale(error)) {
        setData((previous) => previous.scope === scope ? { ...previous, isLoading: false } : previous);
        return { success: false, code: error?.code || 'CLOUD_REQUEST_RESPONSE_STALE' };
      }
      setData((previous) => ({ ...previous, scope, isLoading: false,
        localSales: previous.scope === scope ? previous.localSales : [],
        cloudOrders: previous.scope === scope ? previous.cloudOrders : [],
        warning: cloudEnabled ? cloudNotice : '', error: cloudEnabled ? '' : error?.message || 'Error al cargar las mesas activas.' }));
      return { success: false, code: error?.code, message: error?.message };
    }
  }, [cloudEnabled, enabled, licenseKey, scope, tenantId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const requestState = requests.current;
    refresh({ force: false });
    const subscription = liveQuery(readLocalTables).subscribe({
      next: (localSales) => setData((previous) => previous.scope === scope ? { ...previous, localSales } : previous),
      error: () => {}
    });
    const update = () => { refresh({ force: false }); };
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    window.addEventListener(RESTAURANT_CLOUD_STATUS_EVENT, update);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++requestState.sequence;
      subscription.unsubscribe();
      window.removeEventListener(RESTAURANT_CLOUD_STATUS_EVENT, update);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, refresh, scope]);

  const current = enabled && data.scope === scope ? data : null;
  const tables = useMemo(() => buildRestaurantActiveTables({ localSales: (current?.localSales || [])
    .filter((sale) => allowCloudCache || !sale.restaurantCloudHydrated),
    cloudOrders: current?.cloudOrders || [], cloudEnabled, licenseKey, tenantId }),
  [allowCloudCache, cloudEnabled, current?.cloudOrders, current?.localSales, licenseKey, tenantId]);
  const counts = countRestaurantActiveTables(tables);
  return { tables, ...counts, refresh, cloudEnabled, isLoading: Boolean(current?.isLoading),
    warning: current?.warning || '', error: current?.error || '' };
}
