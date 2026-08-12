import { canAccessTenantOwnedRuntimeCache } from '../../services/tenant/localTenantPolicy';

const DRIVE_SESSION_KEY = 'lanzo_drive_session:v1';

export function clearPersistedDriveSession() {
  try {
    sessionStorage.removeItem(DRIVE_SESSION_KEY);
  } catch {
    // El estado en memoria sigue funcionando cuando sessionStorage no esta disponible.
  }
}

function readPersistedDriveSession() {
  if (!canAccessTenantOwnedRuntimeCache()) return { session: null, expired: false };

  try {
    const serializedSession = sessionStorage.getItem(DRIVE_SESSION_KEY);
    if (!serializedSession) return { session: null, expired: false };

    const { accessToken, expiresAt } = JSON.parse(serializedSession);
    const normalizedExpiresAt = Number(expiresAt);
    if (
      typeof accessToken !== 'string'
      || !accessToken
      || !Number.isFinite(normalizedExpiresAt)
    ) {
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
        expiresAt: normalizedExpiresAt
      },
      expired: false
    };
  } catch {
    clearPersistedDriveSession();
    return { session: null, expired: false };
  }
}

function persistDriveSession(accessToken, expiresAt) {
  if (!canAccessTenantOwnedRuntimeCache()) return;

  try {
    sessionStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({
      accessToken,
      expiresAt
    }));
  } catch {
    // El estado en memoria sigue funcionando cuando sessionStorage no esta disponible.
  }
}

export const createDriveSlice = (set) => {
  const { session, expired } = readPersistedDriveSession();

  return {
    driveAccessToken: session?.accessToken || null,
    driveTokenExpiresAt: session?.expiresAt || null,
    isDriveConnected: Boolean(session),
    needsDriveReauth: expired,

    refreshDriveSession: () => {
      const refreshed = readPersistedDriveSession();
      set({
        driveAccessToken: refreshed.session?.accessToken || null,
        driveTokenExpiresAt: refreshed.session?.expiresAt || null,
        isDriveConnected: Boolean(refreshed.session),
        needsDriveReauth: refreshed.expired
      });
    },

    connectDrive: ({ accessToken, expiresIn }) => {
      if (!canAccessTenantOwnedRuntimeCache()) {
        set({
          driveAccessToken: null,
          driveTokenExpiresAt: null,
          isDriveConnected: false,
          needsDriveReauth: false
        });
        return false;
      }

      const expiresInSeconds = Number(expiresIn);
      const tokenLifetime = Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600;
      const expiresAt = Date.now() + tokenLifetime * 1000;

      persistDriveSession(accessToken, expiresAt);
      set({
        driveAccessToken: accessToken,
        driveTokenExpiresAt: expiresAt,
        isDriveConnected: true,
        needsDriveReauth: false
      });
      return true;
    },

    lockDriveSession: () => {
      // Logout/mismatch hides the tenant-owned token without deleting it. It
      // can be rehydrated only after the same sticky tenant is granted again.
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        isDriveConnected: false,
        needsDriveReauth: false
      });
    },

    clearDriveSession: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        isDriveConnected: false
      });
    },

    markDriveNeedsReauth: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        isDriveConnected: false,
        needsDriveReauth: true
      });
    },

    disconnectDrive: () => {
      clearPersistedDriveSession();
      set({
        driveAccessToken: null,
        driveTokenExpiresAt: null,
        isDriveConnected: false,
        needsDriveReauth: false
      });
    }
  };
};

export { DRIVE_SESSION_KEY };
