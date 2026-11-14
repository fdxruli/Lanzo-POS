import {
  canAccessTenantOwnedRuntimeCache,
  LOCAL_TENANT_STATUS,
  localTenantAccessController
} from '../../services/tenant/localTenantPolicy';
import { captureActiveTenantWorkerContext } from '../../services/tenant/tenantWorkerContext';

const DRIVE_SESSION_KEY = 'lanzo_drive_session:v1';

export function clearPersistedDriveSession() {
  try {
    sessionStorage.removeItem(DRIVE_SESSION_KEY);
  } catch {
    // El estado en memoria sigue funcionando cuando sessionStorage no esta disponible.
  }
}

function getCurrentDriveTenantBinding() {
  if (!canAccessTenantOwnedRuntimeCache()) return null;
  const tenantState = localTenantAccessController.getState();
  if (!tenantState.enabled) return 'unscoped-development-session';
  if (tenantState.status !== LOCAL_TENANT_STATUS.GRANTED) return null;

  try {
    return captureActiveTenantWorkerContext().databaseName;
  } catch {
    return null;
  }
}

function readPersistedDriveSession(tenantBinding) {
  if (!tenantBinding) return { session: null, expired: false };

  try {
    const serializedSession = sessionStorage.getItem(DRIVE_SESSION_KEY);
    if (!serializedSession) return { session: null, expired: false };

    const { accessToken, expiresAt, tenantBinding: persistedTenantBinding } = JSON.parse(serializedSession);
    const normalizedExpiresAt = Number(expiresAt);
    if (
      typeof accessToken !== 'string'
      || !accessToken
      || !Number.isFinite(normalizedExpiresAt)
      || typeof persistedTenantBinding !== 'string'
    ) {
      clearPersistedDriveSession();
      return { session: null, expired: false };
    }

    if (persistedTenantBinding !== tenantBinding) {
      clearPersistedDriveSession();
      return { session: null, expired: false };
    }

    if (normalizedExpiresAt <= Date.now()) {
      clearPersistedDriveSession();
      return { session: null, expired: true };
    }

    return {
      session: {
        accessToken,
        expiresAt: normalizedExpiresAt,
        tenantBinding: persistedTenantBinding
      },
      expired: false
    };
  } catch {
    clearPersistedDriveSession();
    return { session: null, expired: false };
  }
}

function persistDriveSession(accessToken, expiresAt, tenantBinding) {
  if (!tenantBinding || !canAccessTenantOwnedRuntimeCache()) return;

  try {
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken,
      expiresAt,
      tenantBinding
    }));
  } catch {
    // El estado en memoria sigue funcionando cuando sessionStorage no esta disponible.
  }
}

export const createDriveSlice = (set) => {
  const tenantBinding = getCurrentDriveTenantBinding();
  const { session, expired } = readPersistedDriveSession(tenantBinding);

  return {
    driveAccessToken: session?.accessToken || null,
    driveTokenExpiresAt: session?.expiresAt || null,
    driveTenantBinding: session?.tenantBinding || null,
    isDriveConnected: Boolean(session),
    needsDriveReauth: expired,

    refreshDriveSession: () => {
      const currentTenantBinding = getCurrentDriveTenantBinding();
      const refreshed = readPersistedDriveSession(currentTenantBinding);
      set({
        driveAccessToken: refreshed.session?.accessToken || null,
        driveTokenExpiresAt: refreshed.session?.expiresAt || null,
        driveTenantBinding: refreshed.session?.tenantBinding || null,
        isDriveConnected: Boolean(refreshed.session),
        needsDriveReauth: refreshed.expired
      });
    },

    connectDrive: ({ accessToken, expiresIn }) => {
      const currentTenantBinding = getCurrentDriveTenantBinding();
      if (!currentTenantBinding || typeof accessToken !== 'string' || !accessToken) {
        set({
          driveAccessToken: null,
          driveTokenExpiresAt: null,
          driveTenantBinding: null,
          isDriveConnected: false,
          needsDriveReauth: false
        });
        return false;
      }

      const expiresInSeconds = Number(expiresIn);
      const tokenLifetime = Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600;
      const expiresAt = Date.now() + tokenLifetime * 1000;

      persistDriveSession(accessToken, expiresAt, currentTenantBinding);
      set({
        driveAccessToken: accessToken,
        driveTokenExpiresAt: expiresAt,
        driveTenantBinding: currentTenantBinding,
        isDriveConnected: true,
        needsDriveReauth: false
      });
      return true;
    },

    lockDriveSession: () => {
      // Logout hides the tenant-owned token without deleting it. Rehydration
      // requires the persisted binding to match the currently granted tenant.
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        driveTenantBinding: null,
        isDriveConnected: false,
        needsDriveReauth: false
      });
    },

    clearDriveSession: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        driveTenantBinding: null,
        isDriveConnected: false
      });
    },

    markDriveNeedsReauth: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        driveTenantBinding: null,
        isDriveConnected: false,
        needsDriveReauth: true
      });
    },

    disconnectDrive: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        driveTenantBinding: null,
        isDriveConnected: false,
        needsDriveReauth: false
      });
    }
  };
};

export { DRIVE_SESSION_KEY };
