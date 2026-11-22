import { useEffect, useState, useSyncExternalStore } from 'react';
import { actorRuntimeController } from '../services/auth/actorRuntimeController';
import { TenantRuntimeError } from '../services/db/tenantRuntimeRouter';
import {
  getNativeTenantReconnect,
  subscribeLocalDatabaseActivity
} from '../services/db/databaseRuntime';

export const useCatalogReconnect = (loadFirstPage, view) => {
  const reconnect = useSyncExternalStore(subscribeLocalDatabaseActivity, getNativeTenantReconnect);
  const [read, setRead] = useState(null);
  const currentRead = read?.reconnect === reconnect && (read.ready || read.view === view) ? read : null;
  const restored = currentRead?.ready === true;

  useEffect(() => {
    if (reconnect?.status !== 'ready' || restored) return;
    let active = true;

    const assertCurrent = () => {
      if (!active || getNativeTenantReconnect() !== reconnect) {
        throw new TenantRuntimeError('TENANT_RUNTIME_STALE_HANDLE');
      }
      actorRuntimeController.assertCurrent(reconnect.actor);
    };
    const refresh = async () => {
      if (!active || getNativeTenantReconnect() !== reconnect) return;
      let ready = false;
      try {
        assertCurrent();
        ready = await loadFirstPage({ includeCategories: true, assertCurrent });
      } catch {
        ready = false;
      }
      if (active && getNativeTenantReconnect() === reconnect) setRead({ reconnect, view, ready });
    };
    // Let the page's usual mount effects run before starting the fresh read.
    void Promise.resolve().then(refresh);
    return () => { active = false; };
  }, [reconnect, loadFirstPage, restored, view]);

  return {
    reconnect,
    catalogLoading: Boolean(reconnect && reconnect.status !== 'failed' && !currentRead),
    catalogUnavailable: reconnect?.status === 'failed' || currentRead?.ready === false
  };
};
