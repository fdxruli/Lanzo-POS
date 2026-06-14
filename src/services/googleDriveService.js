import { useAppStore } from '../store/useAppStore';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const BACKUP_APP_PROPERTY = 'lanzo_pos_backup';
const MAX_DRIVE_BACKUPS = 14;

const DRIVE_ERROR_MESSAGES = {
  NETWORK: 'No se pudo conectar con Google Drive. Revisa tu conexión a internet e inténtalo de nuevo.',
  AUTH: 'La sesión de Google Drive expiró. Reconecta tu cuenta e inténtalo de nuevo.',
  RATE_LIMIT: 'Google Drive alcanzó temporalmente el límite de solicitudes. Espera unos minutos e inténtalo de nuevo. Si el problema continúa, contacta a soporte.',
  FORBIDDEN: 'Google Drive rechazó la operación. Revisa los permisos de la cuenta y, si el problema continúa, contacta a soporte.',
  TEMPORARY: 'Google Drive no está disponible temporalmente. Inténtalo de nuevo en unos minutos.',
  UNKNOWN: 'No fue posible completar la operación en Google Drive. Inténtalo de nuevo y, si el problema continúa, contacta a soporte.'
};

export class GoogleDriveError extends Error {
  constructor(message, { status = null, code = 'UNKNOWN', technicalMessage = '', cause } = {}) {
    super(message);
    this.name = 'GoogleDriveError';
    this.status = status;
    this.code = code;
    this.technicalMessage = technicalMessage;
    this.cause = cause;
  }
}

function createBoundary() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return `lanzo_pos_boundary_${suffix}`;
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json();
    return {
      message: data?.error?.message || data?.message || response.statusText,
      reasons: (data?.error?.errors || [])
        .flatMap((error) => error?.reason ? [error.reason] : [])
    };
  } catch {
    return {
      message: response.statusText,
      reasons: []
    };
  }
}

async function assertSuccessfulResponse(response) {
  if (response.ok) return;

  const { message: technicalMessage, reasons } = await parseErrorResponse(response);
  if (response.status === 401) {
    useAppStore.getState().markDriveNeedsReauth();
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.AUTH, {
      status: response.status,
      code: 'AUTH_REQUIRED',
      technicalMessage
    });
  }

  const isRateLimitError = response.status === 429 || reasons.some((reason) => (
    /rateLimitExceeded|dailyLimitExceeded|quotaExceeded/i.test(reason)
  ));

  if (isRateLimitError) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.RATE_LIMIT, {
      status: response.status,
      code: 'RATE_LIMIT',
      technicalMessage
    });
  }

  if (response.status === 403) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.FORBIDDEN, {
      status: response.status,
      code: 'FORBIDDEN',
      technicalMessage
    });
  }

  if (response.status === 408 || response.status >= 500) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.TEMPORARY, {
      status: response.status,
      code: 'SERVICE_UNAVAILABLE',
      technicalMessage
    });
  }

  throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.UNKNOWN, {
    status: response.status,
    technicalMessage
  });
}

async function driveFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (cause) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.NETWORK, {
      code: 'NETWORK_ERROR',
      technicalMessage: cause?.message || String(cause),
      cause
    });
  }
}

/**
 * Uploads a POS backup using Google Drive's multipart/related protocol.
 */
export async function uploadBackup(token, fileBlob, fileName) {
  const boundary = createBoundary();
  const metadata = {
    name: fileName,
    appProperties: {
      type: BACKUP_APP_PROPERTY
    }
  };
  const fileContentType = fileBlob.type || 'application/octet-stream';
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${fileContentType}\r\n\r\n`,
    fileBlob,
    `\r\n--${boundary}--\r\n`
  ], {
    type: `multipart/related; boundary=${boundary}`
  });

  const response = await driveFetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  await assertSuccessfulResponse(response);
  const uploadedBackup = await response.json();
  const { files = [] } = await listBackups(token);
  const expiredBackups = files.slice(MAX_DRIVE_BACKUPS);

  for (const backup of expiredBackups) {
    await deleteBackup(token, backup.id);
  }

  return uploadedBackup;
}

/**
 * Lists backups created by Lanzo, newest first.
 */
export async function listBackups(token) {
  const query = "appProperties has { key='type' and value='lanzo_pos_backup' }";
  const files = [];
  let pageToken = '';

  do {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('orderBy', 'createdTime desc');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,createdTime)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await driveFetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await assertSuccessfulResponse(response);
    const page = await response.json();
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return { files };
}

/**
 * Deletes a backup by its Google Drive file ID.
 */
export async function deleteBackup(token, fileId) {
  const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  await assertSuccessfulResponse(response);
  return true;
}
