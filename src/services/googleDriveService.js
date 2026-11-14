import { evaluateSettingsAccess } from './auth/settingsAccessPolicy';
import { readActorAccess } from './auth/actorAccessPolicy';
import {
  BACKUP_EXTENSION,
  createTenantFingerprint,
  getTenantBackupPrefix,
  parseHeader
} from './backup/backupFormat';
import {
  captureActiveTenantWorkerContext,
  isActiveTenantWorkerContext
} from './tenant/tenantWorkerContext';
import { useAppStore } from '../store/useAppStore';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,appProperties,mimeType';
const BACKUP_APP_PROPERTY = 'lanzo_pos_backup';
const TENANT_APP_PROPERTY = 'tenant_fingerprint';
const TENANT_LICENSE_ID_PROPERTY = 'tenant_license_id';
const TENANT_LICENSE_KEY_PROPERTY = 'tenant_license_key';
const MAX_DRIVE_BACKUPS = 14;

const DRIVE_ERROR_MESSAGES = {
  NETWORK: 'No se pudo conectar con Google Drive. Revisa tu conexión a internet e inténtalo de nuevo.',
  AUTH: 'La sesión de Google Drive expiró. Reconecta tu cuenta e inténtalo de nuevo.',
  RATE_LIMIT: 'Google Drive alcanzó temporalmente el límite de solicitudes. Espera unos minutos e inténtalo de nuevo. Si el problema continúa, contacta a soporte.',
  FORBIDDEN: 'Google Drive rechazó la operación. Revisa los permisos de la cuenta y, si el problema continúa, contacta a soporte.',
  TEMPORARY: 'Google Drive no está disponible temporalmente. Inténtalo de nuevo en unos minutos.',
  CONTEXT: 'La licencia o la sesión cambió. Vuelve a iniciar la operación con el negocio y usuario autorizados.',
  BACKUP_PERMISSION: 'El usuario actual no tiene permiso para administrar respaldos.',
  INVALID_BACKUP: 'No se pudo verificar que el archivo cifrado pertenezca al negocio activo.',
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

const isValidTenantFingerprint = (fingerprint) => /^[a-f0-9]{64}$/i.test(String(fingerprint || ''));

async function createDriveOwnerProperties(tenantAliases) {
  const aliases = [...new Set((tenantAliases || []).filter((alias) => typeof alias === 'string'))];
  const licenseIds = aliases.filter((alias) => alias.startsWith('license-id:'));
  const licenseKeys = aliases.filter((alias) => alias.startsWith('license-key-sha256:'));
  if (
    aliases.length === 0
    || aliases.length !== licenseIds.length + licenseKeys.length
    || licenseIds.length > 1
    || licenseKeys.length > 1
    || licenseIds.some((alias) => alias.length <= 'license-id:'.length)
    || licenseKeys.some((alias) => !/^license-key-sha256:[a-f0-9]{64}$/i.test(alias))
  ) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_TENANT_IDENTITY_INVALID'
    });
  }

  const encoder = new TextEncoder();
  const opaqueAliasHash = async (alias) => {
    const digest = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`lanzo-drive-owner:v1\n${alias}`)
    ));
    return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
  };
  const ownerProperties = {};
  if (licenseIds.length) ownerProperties[TENANT_LICENSE_ID_PROPERTY] = await opaqueAliasHash(licenseIds[0]);
  if (licenseKeys.length) ownerProperties[TENANT_LICENSE_KEY_PROPERTY] = await opaqueAliasHash(licenseKeys[0]);
  return ownerProperties;
}

function getCurrentDriveAccess(token, expectedFingerprint = null) {
  const state = useAppStore.getState();
  const hasCurrentToken = Boolean(token && state.driveAccessToken === token && state.isDriveConnected === true);
  const expiresAt = Number(state.driveTokenExpiresAt);

  if (!hasCurrentToken || !Number.isFinite(expiresAt)) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.CONTEXT, { code: 'DRIVE_SESSION_STALE' });
  }

  if (expiresAt <= Date.now()) {
    state.markDriveNeedsReauth?.();
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.AUTH, { code: 'AUTH_REQUIRED' });
  }

  let tenantContext;
  try {
    tenantContext = captureActiveTenantWorkerContext();
  } catch (cause) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.CONTEXT, {
      code: 'BACKUP_TENANT_CONTEXT_STALE',
      cause
    });
  }

  if (
    !isActiveTenantWorkerContext(tenantContext)
    || state.driveTenantBinding !== tenantContext.databaseName
  ) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.CONTEXT, { code: 'BACKUP_TENANT_CONTEXT_STALE' });
  }

  const actorAccess = readActorAccess(state);
  const settingsAccess = evaluateSettingsAccess({
    actorAccess,
    isDev: import.meta.env.DEV
  });
  if (!settingsAccess.isAuthorizedActor || !settingsAccess.canAccessPermission('settings_backup')) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.BACKUP_PERMISSION, {
      code: 'BACKUP_PERMISSION_REQUIRED'
    });
  }

  return { state, tenantContext, expectedFingerprint };
}

async function assertDriveOperation(token, expectedFingerprint = null) {
  const scope = getCurrentDriveAccess(token, expectedFingerprint);
  const tenantFingerprint = await createTenantFingerprint(scope.tenantContext.tenantAliases);
  const ownerProperties = await createDriveOwnerProperties(scope.tenantContext.tenantAliases);
  if (
    !isValidTenantFingerprint(tenantFingerprint)
    || (expectedFingerprint && tenantFingerprint !== expectedFingerprint)
  ) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.CONTEXT, {
      code: 'BACKUP_TENANT_CONTEXT_STALE'
    });
  }

  // Hashing is asynchronous. Recheck actor, tenant and token immediately
  // before every Drive request so an obsolete callback cannot keep using them.
  const currentScope = getCurrentDriveAccess(token, tenantFingerprint);
  if (
    currentScope.tenantContext.databaseName !== scope.tenantContext.databaseName
    || currentScope.tenantContext.generation !== scope.tenantContext.generation
    || [...currentScope.tenantContext.tenantAliases].sort().join('\n')
      !== [...scope.tenantContext.tenantAliases].sort().join('\n')
  ) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.CONTEXT, {
      code: 'BACKUP_TENANT_CONTEXT_STALE'
    });
  }

  return { ...currentScope, tenantFingerprint, ownerProperties };
}

async function assertSuccessfulResponse(response, token = null) {
  if (response.ok) return;

  const { message: technicalMessage, reasons } = await parseErrorResponse(response);
  if (response.status === 401) {
    const state = useAppStore.getState();
    if (!token || state.driveAccessToken === token) state.markDriveNeedsReauth?.();
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

async function driveFetch(url, options, token, expectedFingerprint) {
  const scope = await assertDriveOperation(token, expectedFingerprint);
  // Keep the final context check adjacent to fetch; the API request itself
  // cannot be rolled back if the active tenant changes after it is sent.
  getCurrentDriveAccess(token, scope.tenantFingerprint);

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

function isBackupFileForTenant(file, ownerProperties) {
  const appProperties = file?.appProperties;
  const fileFingerprint = appProperties?.[TENANT_APP_PROPERTY];
  const ownerKeys = [TENANT_LICENSE_ID_PROPERTY, TENANT_LICENSE_KEY_PROPERTY];
  const sharesKnownAlias = ownerKeys.some((key) => (
    ownerProperties[key] && appProperties?.[key] === ownerProperties[key]
  ));
  const hasInvalidOrConflictingAlias = ownerKeys.some((key) => (
    appProperties?.[key] !== undefined
      && (
        !isValidTenantFingerprint(appProperties[key])
        || (ownerProperties[key] && appProperties[key] !== ownerProperties[key])
      )
  ));
  return appProperties?.type === BACKUP_APP_PROPERTY
    && isValidTenantFingerprint(fileFingerprint)
    && sharesKnownAlias
    && !hasInvalidOrConflictingAlias
    && typeof file?.name === 'string'
    && file.name.startsWith(getTenantBackupPrefix(fileFingerprint))
    && file.name.endsWith(BACKUP_EXTENSION)
    && Number.isFinite(Date.parse(file.createdTime))
    && file.trashed !== true;
}

function compareNewestFirst(left, right) {
  const timeDifference = Date.parse(right.createdTime) - Date.parse(left.createdTime);
  return timeDifference || String(left.id).localeCompare(String(right.id));
}

function buildTenantQuery(ownerProperties) {
  const ownerClauses = Object.entries(ownerProperties).map(([key, value]) => (
    `appProperties has { key='${key}' and value='${value}' }`
  ));
  if (ownerClauses.length === 0) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_TENANT_IDENTITY_INVALID'
    });
  }
  return `appProperties has { key='type' and value='${BACKUP_APP_PROPERTY}' }`
    + ` and (${ownerClauses.join(' or ')})`
    + ' and trashed = false';
}

async function listBackupsForTenant(token, tenantFingerprint) {
  const tenantScope = await assertDriveOperation(token, tenantFingerprint);
  const files = [];
  const pageTokens = new Set();
  const fileIds = new Set();
  let pageToken = '';

  do {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set('q', buildTenantQuery(tenantScope.ownerProperties));
    url.searchParams.set('orderBy', 'createdTime desc');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('fields', 'nextPageToken,incompleteSearch,files(id,name,createdTime,appProperties,trashed)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await driveFetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, token, tenantFingerprint);
    await assertSuccessfulResponse(response, token);

    let page;
    try {
      page = await response.json();
    } catch (cause) {
      throw new GoogleDriveError('DRIVE_LIST_INCOMPLETE', {
        code: 'DRIVE_LIST_INCOMPLETE',
        technicalMessage: cause?.message || String(cause),
        cause
      });
    }

    if (
      !page
      || !Array.isArray(page.files)
      || page.incompleteSearch === true
      || (page.nextPageToken !== null
        && page.nextPageToken !== undefined
        && typeof page.nextPageToken !== 'string')
    ) {
      throw new GoogleDriveError('DRIVE_LIST_INCOMPLETE', { code: 'DRIVE_LIST_INCOMPLETE' });
    }

    for (const file of page.files) {
      if (!file || typeof file.id !== 'string' || !file.id || fileIds.has(file.id)) {
        throw new GoogleDriveError('DRIVE_LIST_INCOMPLETE', { code: 'DRIVE_LIST_INCOMPLETE' });
      }

      // The exact query should exclude other tenants and legacy files. If a
      // response contradicts it, abort the whole cleanup instead of guessing.
      if (!isBackupFileForTenant(file, tenantScope.ownerProperties)) {
        throw new GoogleDriveError('DRIVE_LIST_AMBIGUOUS', { code: 'DRIVE_LIST_AMBIGUOUS' });
      }

      fileIds.add(file.id);
      files.push(file);
    }

    const nextPageToken = page.nextPageToken || '';
    if (nextPageToken && (nextPageToken === pageToken || pageTokens.has(nextPageToken))) {
      throw new GoogleDriveError('DRIVE_LIST_INCOMPLETE', { code: 'DRIVE_LIST_INCOMPLETE' });
    }
    if (nextPageToken) pageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (pageToken);

  return { files: files.sort(compareNewestFirst) };
}

/**
 * Lists only current-tenant LANZO backups. Untagged legacy files are excluded.
 */
export async function listBackups(token) {
  const scope = await assertDriveOperation(token);
  return listBackupsForTenant(token, scope.tenantFingerprint);
}

/**
 * Deletes one file only after re-reading and verifying its current owner tag.
 */
export async function deleteBackup(token, fileId, tenantFingerprint) {
  if (!isValidTenantFingerprint(tenantFingerprint) || typeof fileId !== 'string' || !fileId) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_IDENTITY_INVALID'
    });
  }

  const tenantScope = await assertDriveOperation(token, tenantFingerprint);
  const metadataUrl = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
  metadataUrl.searchParams.set('fields', 'id,name,createdTime,appProperties,trashed');
  const metadataResponse = await driveFetch(metadataUrl.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  }, token, tenantFingerprint);
  await assertSuccessfulResponse(metadataResponse, token);

  let file;
  try {
    file = await metadataResponse.json();
  } catch (cause) {
    throw new GoogleDriveError('DRIVE_FILE_OWNERSHIP_UNVERIFIED', {
      code: 'DRIVE_FILE_OWNERSHIP_UNVERIFIED',
      cause
    });
  }
  if (file?.id !== fileId || !isBackupFileForTenant(file, tenantScope.ownerProperties)) {
    throw new GoogleDriveError('DRIVE_FILE_OWNERSHIP_UNVERIFIED', {
      code: 'DRIVE_FILE_OWNERSHIP_UNVERIFIED'
    });
  }

  const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  }, token, tenantFingerprint);
  await assertSuccessfulResponse(response, token);
  return true;
}

function cleanupPendingReason(error) {
  if (error?.code === 'AUTH_REQUIRED') return 'reauth_required';
  if (error?.code === 'BACKUP_PERMISSION_REQUIRED') return 'permission_required';
  if (error?.code === 'BACKUP_TENANT_CONTEXT_STALE' || error?.code === 'DRIVE_SESSION_STALE') {
    return 'context_changed';
  }
  if (String(error?.code || '').startsWith('DRIVE_LIST_')) return 'listing_incomplete';
  return 'cleanup_failed';
}

async function cleanupTenantBackups(token, tenantFingerprint, uploadedFileId) {
  const { files } = await listBackupsForTenant(token, tenantFingerprint);
  if (!files.some((file) => file.id === uploadedFileId)) {
    throw new GoogleDriveError('DRIVE_UPLOAD_NOT_VISIBLE_IN_LIST', {
      code: 'DRIVE_UPLOAD_NOT_VISIBLE_IN_LIST'
    });
  }

  const keep = new Set(files.slice(0, MAX_DRIVE_BACKUPS).map((file) => file.id));
  // A just-confirmed upload always remains protected, even if Drive returns
  // surprising ordering during concurrent uploads.
  keep.add(uploadedFileId);
  const expiredFiles = files.filter((file) => !keep.has(file.id));
  let deletedCount = 0;
  // Drive has no atomic list-and-delete operation. Stop on the first conflict;
  // a concurrent same-tenant run may leave more than 14 files until a retry.
  for (const file of expiredFiles) {
    await deleteBackup(token, file.id, tenantFingerprint);
    deletedCount += 1;
  }

  return { deletedCount };
}

/**
 * Uploads the current V2 encrypted backup and reports upload and retention
 * separately. Cleanup is best-effort and can never turn a confirmed upload
 * into an upload failure.
 */
export async function uploadBackup(token, fileBlob, fileName) {
  const initialScope = await assertDriveOperation(token);
  if (!(fileBlob instanceof Blob)) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_IDENTITY_INVALID'
    });
  }

  let header;
  try {
    ({ header } = await parseHeader(fileBlob));
  } catch (cause) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_IDENTITY_INVALID',
      cause
    });
  }

  const tenantFingerprint = initialScope.tenantFingerprint;
  if (
    header.version !== 2
    || header.tenantFingerprint !== tenantFingerprint
    || !isValidTenantFingerprint(header.tenantFingerprint)
    || typeof fileName !== 'string'
    || !fileName.startsWith(getTenantBackupPrefix(tenantFingerprint))
    || !fileName.endsWith(BACKUP_EXTENSION)
  ) {
    throw new GoogleDriveError(DRIVE_ERROR_MESSAGES.INVALID_BACKUP, {
      code: 'BACKUP_IDENTITY_INVALID'
    });
  }

  const boundary = createBoundary();
  const metadata = {
    name: fileName,
    appProperties: {
      type: BACKUP_APP_PROPERTY,
      [TENANT_APP_PROPERTY]: tenantFingerprint,
      ...initialScope.ownerProperties
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
  }, token, tenantFingerprint);

  await assertSuccessfulResponse(response, token);
  let uploadedFile = null;
  try {
    uploadedFile = await response.json();
  } catch {
    // A successful HTTP response confirms the upload; missing response fields
    // only mean cleanup cannot safely identify it yet.
  }

  if (
    !uploadedFile?.id
    || !isBackupFileForTenant(uploadedFile, initialScope.ownerProperties)
  ) {
    return {
      uploadStatus: 'confirmed',
      uploadedFile: uploadedFile?.id ? uploadedFile : null,
      cleanupStatus: 'pending',
      cleanupReason: 'upload_metadata_unavailable'
    };
  }

  try {
    const cleanup = await cleanupTenantBackups(token, tenantFingerprint, uploadedFile.id);
    return {
      uploadStatus: 'confirmed',
      uploadedFile,
      cleanupStatus: 'completed',
      deletedCount: cleanup.deletedCount
    };
  } catch (error) {
    return {
      uploadStatus: 'confirmed',
      uploadedFile,
      cleanupStatus: 'pending',
      cleanupReason: cleanupPendingReason(error)
    };
  }
}
