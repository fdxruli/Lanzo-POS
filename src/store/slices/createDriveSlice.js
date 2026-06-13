const DRIVE_CONNECTED_KEY = 'lanzo_drive_connected:v1';

function readDriveConnectionFlag() {
  try {
    return localStorage.getItem(DRIVE_CONNECTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistDriveConnectionFlag(isConnected) {
  try {
    if (isConnected) {
      localStorage.setItem(DRIVE_CONNECTED_KEY, 'true');
      return;
    }

    localStorage.removeItem(DRIVE_CONNECTED_KEY);
  } catch {
    // El estado en memoria sigue funcionando cuando localStorage no esta disponible.
  }
}

export const createDriveSlice = (set) => ({
  driveAccessToken: null,
  driveTokenExpiresAt: null,
  isDriveConnected: readDriveConnectionFlag(),
  needsDriveReauth: false,

  connectDrive: ({ accessToken, expiresIn }) => {
    const expiresInSeconds = Number(expiresIn);
    const tokenLifetime = Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600;

    persistDriveConnectionFlag(true);
    set({
      driveAccessToken: accessToken,
      driveTokenExpiresAt: Date.now() + tokenLifetime * 1000,
      isDriveConnected: true,
      needsDriveReauth: false
    });
  },

  clearDriveSession: () => {
    set({
      driveAccessToken: null,
      driveTokenExpiresAt: null
    });
  },

  markDriveNeedsReauth: () => {
    persistDriveConnectionFlag(false);
    set({
      driveAccessToken: null,
      driveTokenExpiresAt: null,
      isDriveConnected: false,
      needsDriveReauth: true
    });
  },

  disconnectDrive: () => {
    persistDriveConnectionFlag(false);
    set({
      driveAccessToken: null,
      driveTokenExpiresAt: null,
      isDriveConnected: false,
      needsDriveReauth: false
    });
  }
});

export { DRIVE_CONNECTED_KEY };
