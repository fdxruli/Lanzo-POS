import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_EXTENSION,
  BACKUP_ITERATIONS,
  BACKUP_PREFIX,
  buildHeader,
  bytesToBase64,
  createBackupFileName,
  createTenantFingerprint,
  parseHeader
} from '../backup/backupFormat';
import {
  deleteBackup,
  GoogleDriveError,
  listBackups,
  uploadBackup
} from '../googleDriveService';

const fixtures = vi.hoisted(() => ({
  tenantContext: null,
  tenantGranted: true,
  actorAccess: null,
  state: null
}));

vi.mock('../tenant/tenantWorkerContext', () => ({
  captureActiveTenantWorkerContext: () => {
    if (!fixtures.tenantGranted || !fixtures.tenantContext) {
      throw new Error('tenant context unavailable');
    }
    return fixtures.tenantContext;
  },
  isActiveTenantWorkerContext: (context) => Boolean(
    fixtures.tenantGranted
    && fixtures.tenantContext
    && context.databaseName === fixtures.tenantContext.databaseName
    && context.generation === fixtures.tenantContext.generation
    && [...context.tenantAliases].sort().join('|')
      === [...fixtures.tenantContext.tenantAliases].sort().join('|')
  )
}));

vi.mock('../auth/actorAccessPolicy', () => ({
  readActorAccess: () => fixtures.actorAccess
}));

vi.mock('../auth/settingsAccessPolicy', () => ({
  evaluateSettingsAccess: ({ actorAccess }) => ({
    isAuthorizedActor: actorAccess?.authorized === true,
    canAccessPermission: (permission) => actorAccess?.authorized === true
      && (actorAccess.isAdmin === true || actorAccess.permissions?.includes(permission) === true)
  })
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => fixtures.state }
}));

const makeTenantContext = (name, databaseName = `LanzoDB_t_${name}`) => ({
  databaseName,
  generation: 1,
  tenantAliases: [`license-id:${name}`, `license-key-sha256:${(name === 'business-b' ? 'b' : 'a').repeat(64)}`]
});

const hashOwnerAlias = async (alias) => {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`lanzo-drive-owner:v1\n${alias}`)
  ));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

const ownerPropertiesFor = async (tenantAliases) => {
  const properties = {};
  for (const alias of tenantAliases) {
    if (alias.startsWith('license-id:')) properties.tenant_license_id = await hashOwnerAlias(alias);
    if (alias.startsWith('license-key-sha256:')) properties.tenant_license_key = await hashOwnerAlias(alias);
  }
  return properties;
};

const response = (data, { status = 200, statusText = 'OK', ok = status >= 200 && status < 300 } = {}) => ({
  ok,
  status,
  statusText,
  json: vi.fn().mockResolvedValue(data)
});

const makeFile = (id, tenantFingerprint, createdAt, ownerProperties = {}, overrides = {}) => ({
  id,
  name: createBackupFileName(new Date(createdAt), tenantFingerprint),
  createdTime: new Date(createdAt).toISOString(),
  appProperties: {
    type: 'lanzo_pos_backup',
    tenant_fingerprint: tenantFingerprint,
    ...ownerProperties
  },
  trashed: false,
  ...overrides
});

const makeLegacyFile = () => ({
  id: 'legacy-file',
  name: `${BACKUP_PREFIX}2024-legacy${BACKUP_EXTENSION}`,
  createdTime: '2024-01-01T00:00:00.000Z',
  appProperties: { type: 'lanzo_pos_backup' },
  trashed: false
});

const createV2Backup = async (tenantContext, date = new Date()) => {
  const tenantFingerprint = await createTenantFingerprint(tenantContext.tenantAliases);
  const ownerProperties = await ownerPropertiesFor(tenantContext.tenantAliases);
  const { prefix, header } = buildHeader({
    createdAt: date.toISOString(),
    reason: 'manual_settings',
    sourceBytes: 0,
    chunkCount: 1,
    schemaVersion: 1,
    tenantFingerprint,
    salt: bytesToBase64(new Uint8Array(16)),
    iterations: BACKUP_ITERATIONS,
    coverage: { complete: true }
  });
  return {
    blob: new Blob([prefix], { type: 'application/octet-stream' }),
    fileName: createBackupFileName(date, tenantFingerprint),
    tenantFingerprint,
    ownerProperties,
    header
  };
};

const readMultipartMetadata = async (body) => {
  const content = await body.text();
  const start = content.indexOf('\r\n\r\n') + 4;
  const end = content.indexOf('\r\n--', start);
  return JSON.parse(content.slice(start, end));
};

let driveFiles;
let nextId;
let clock;
let fetchMock;
let mode;
let concurrentUploadCount;
let concurrentUploadBarrier;
let releaseConcurrentUploads;

function installDriveMock() {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (requestUrl, options = {}) => {
    const url = new URL(requestUrl);
    if (options.method === 'POST') {
      if (mode === 'upload_401') {
        return response({ error: { message: 'Invalid Credentials' } }, {
          status: 401,
          statusText: 'Unauthorized',
          ok: false
        });
      }
      if (mode === 'upload_failure') {
        return response({ error: { message: 'Upload failed' } }, {
          status: 500,
          statusText: 'Internal Server Error',
          ok: false
        });
      }
      const metadata = await readMultipartMetadata(options.body);
      const file = {
        id: `new-${nextId++}`,
        name: metadata.name,
        createdTime: new Date(clock += 1_000).toISOString(),
        appProperties: metadata.appProperties,
        mimeType: 'application/octet-stream',
        trashed: false
      };
      driveFiles.push(file);
      if (mode === 'concurrent_uploads') {
        concurrentUploadCount += 1;
        if (concurrentUploadCount === 2) releaseConcurrentUploads();
        await concurrentUploadBarrier;
      }
      if (mode === 'actor_invalidated_after_upload') {
        fixtures.actorAccess = { authorized: false, isAdmin: false, permissions: [] };
      }
      if (mode === 'tenant_invalidated_after_upload') {
        fixtures.tenantContext = makeTenantContext('business-b');
      }
      return response(file);
    }

    if (options.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      const index = driveFiles.findIndex((file) => file.id === id);
      if (index < 0) {
        return response({ error: { message: 'Not found' } }, {
          status: 404,
          statusText: 'Not Found',
          ok: false
        });
      }
      driveFiles.splice(index, 1);
      return { ok: true, status: 204, statusText: 'No Content' };
    }

    if (options.method === 'GET' && url.pathname !== '/drive/v3/files') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      const file = driveFiles.find((candidate) => candidate.id === id);
      return file
        ? response(file)
        : response({ error: { message: 'Not found' } }, { status: 404, statusText: 'Not Found', ok: false });
    }

    if (options.method === 'GET' && url.pathname === '/drive/v3/files') {
      if (mode === 'list_failure') {
        return response({ error: { message: 'List failed' } }, {
          status: 500,
          statusText: 'Internal Server Error',
          ok: false
        });
      }
      if (mode === 'list_401') {
        return response({ error: { message: 'Invalid Credentials' } }, {
          status: 401,
          statusText: 'Unauthorized',
          ok: false
        });
      }
      if (mode === 'list_incomplete') return response({ incompleteSearch: true, files: [] });
      if (mode === 'list_missing_files') return response({ nextPageToken: 'next-page' });
      if (mode === 'list_ambiguous') return response({ files: [makeLegacyFile()] });
      if (mode === 'list_second_page_failure' && url.searchParams.has('pageToken')) {
        return response({ error: { message: 'Second page failed' } }, {
          status: 403,
          statusText: 'Forbidden',
          ok: false
        });
      }

      const query = url.searchParams.get('q') || '';
      const ownerClauses = [...query.matchAll(/key='(tenant_license_id|tenant_license_key)' and value='([a-f0-9]{64})'/gi)]
        .map(([, key, value]) => [key, value]);
      const scopedFiles = driveFiles
        .filter((file) => file.appProperties?.type === 'lanzo_pos_backup'
          && ownerClauses.some(([key, value]) => file.appProperties?.[key] === value)
          && file.trashed !== true)
        .sort((left, right) => Date.parse(right.createdTime) - Date.parse(left.createdTime));
      const pageToken = url.searchParams.get('pageToken');
      if (mode === 'list_two_pages') {
        return pageToken
          ? response({ files: scopedFiles.slice(1) })
          : response({ files: scopedFiles.slice(0, 1), nextPageToken: 'next-page' });
      }
      if (mode === 'list_second_page_failure') {
        return response({ files: scopedFiles.slice(0, 1), nextPageToken: 'next-page' });
      }
      return response({ files: scopedFiles });
    }

    throw new Error(`Unexpected Drive request ${options.method} ${requestUrl}`);
  });
}

describe('googleDriveService', () => {
  beforeEach(() => {
    const tenantContext = makeTenantContext('business-a');
    fixtures.tenantContext = tenantContext;
    fixtures.tenantGranted = true;
    fixtures.actorAccess = {
      authorized: true,
      isAdmin: true,
      permissions: []
    };
    fixtures.state = {
      driveAccessToken: 'access-token',
      driveTokenExpiresAt: Date.now() + 3_600_000,
      driveTenantBinding: tenantContext.databaseName,
      isDriveConnected: true,
      needsDriveReauth: false,
      markDriveNeedsReauth: vi.fn(() => {
        fixtures.state.driveAccessToken = null;
        fixtures.state.driveTenantBinding = null;
        fixtures.state.driveTokenExpiresAt = null;
        fixtures.state.isDriveConnected = false;
        fixtures.state.needsDriveReauth = true;
      })
    };
    driveFiles = [];
    nextId = 1;
    clock = Date.now();
    mode = '';
    concurrentUploadCount = 0;
    concurrentUploadBarrier = null;
    releaseConcurrentUploads = null;
    installDriveMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads V2 encrypted backups with an opaque business fingerprint in appProperties', async () => {
    const backup = await createV2Backup(fixtures.tenantContext);
    const result = await uploadBackup('access-token', backup.blob, backup.fileName);

    expect(result).toMatchObject({
      uploadStatus: 'confirmed',
      cleanupStatus: 'completed',
      deletedCount: 0
    });
    expect(await parseHeader(backup.blob)).toMatchObject({
      header: { version: 2, tenantFingerprint: backup.tenantFingerprint }
    });

    const [uploadUrl, options] = fetchMock.mock.calls[0];
    expect(uploadUrl).toContain('uploadType=multipart');
    expect(options.headers.Authorization).toBe('Bearer access-token');
    expect(options.headers['Content-Type']).toMatch(/^multipart\/related; boundary=lanzo_pos_boundary_/);
    const metadata = await readMultipartMetadata(options.body);
    expect(metadata.appProperties).toEqual({
      type: 'lanzo_pos_backup',
      tenant_fingerprint: backup.tenantFingerprint,
      ...backup.ownerProperties
    });
    expect(JSON.stringify(metadata)).not.toContain('LICENSE-A');
    expect(JSON.stringify(metadata)).not.toContain('license-key-sha256');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('q')).toContain(
      `key='tenant_license_id' and value='${backup.ownerProperties.tenant_license_id}'`
    );
  });

  it('retains up to 14 A backups without deleting B backups or unowned legacy files', async () => {
    const contextA = fixtures.tenantContext;
    const backupA = await createV2Backup(contextA);
    const contextB = makeTenantContext('business-b');
    const backupB = await createV2Backup(contextB);
    const legacy = makeLegacyFile();
    fixtures.tenantContext = contextB;
    fixtures.state.driveTenantBinding = contextB.databaseName;
    const uploadedB = await uploadBackup('access-token', backupB.blob, backupB.fileName);
    fixtures.tenantContext = contextA;
    fixtures.state.driveTenantBinding = contextA.databaseName;
    driveFiles.push(legacy);

    for (let index = 0; index < 15; index += 1) {
      const date = new Date(Date.now() + index);
      const fileName = createBackupFileName(date, backupA.tenantFingerprint);
      await uploadBackup('access-token', backupA.blob, fileName);
    }

    const retainedA = driveFiles.filter((file) => (
      file.appProperties?.tenant_fingerprint === backupA.tenantFingerprint
    ));
    expect(retainedA).toHaveLength(14);
    expect(driveFiles.some((file) => file.id === uploadedB.uploadedFile.id)).toBe(true);
    expect(driveFiles.some((file) => file.id === 'legacy-file')).toBe(true);
    expect(fetchMock.mock.calls.filter(([, request]) => request.method === 'DELETE')).toHaveLength(1);
  });

  it('does not list or delete when the upload fails', async () => {
    mode = 'upload_failure';
    const backup = await createV2Backup(fixtures.tenantContext);

    await expect(uploadBackup('access-token', backup.blob, backup.fileName))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it.each([
    ['list_incomplete', 'listing_incomplete'],
    ['list_missing_files', 'listing_incomplete'],
    ['list_ambiguous', 'listing_incomplete'],
    ['list_second_page_failure', 'cleanup_failed']
  ])(
    'keeps the upload confirmed and avoids deletion when listing is incomplete (%s)',
    async (listMode, expectedReason) => {
      mode = listMode;
      const backup = await createV2Backup(fixtures.tenantContext);
      driveFiles.push(makeFile('old-a', backup.tenantFingerprint, Date.now() - 100_000, backup.ownerProperties));

      const result = await uploadBackup('access-token', backup.blob, backup.fileName);

      expect(result).toMatchObject({
        uploadStatus: 'confirmed',
        cleanupStatus: 'pending',
        cleanupReason: expectedReason
      });
      expect(driveFiles.some((file) => file.id === 'old-a')).toBe(true);
      expect(fetchMock.mock.calls.some(([, request]) => request.method === 'DELETE')).toBe(false);
    }
  );

  it('keeps the upload confirmed if listing fails after the upload', async () => {
    mode = 'list_failure';
    const backup = await createV2Backup(fixtures.tenantContext);
    driveFiles.push(makeFile('old-a', backup.tenantFingerprint, Date.now() - 100_000, backup.ownerProperties));

    const result = await uploadBackup('access-token', backup.blob, backup.fileName);

    expect(result.uploadStatus).toBe('confirmed');
    expect(result.cleanupStatus).toBe('pending');
    expect(result.cleanupReason).toBe('cleanup_failed');
    expect(driveFiles.some((file) => file.id === 'old-a')).toBe(true);
  });

  it('keeps upload success and requests reconnection when the token expires during cleanup', async () => {
    mode = 'list_401';
    const backup = await createV2Backup(fixtures.tenantContext);

    const result = await uploadBackup('access-token', backup.blob, backup.fileName);

    expect(result).toMatchObject({
      uploadStatus: 'confirmed',
      cleanupStatus: 'pending',
      cleanupReason: 'reauth_required'
    });
    expect(fixtures.state.markDriveNeedsReauth).toHaveBeenCalledOnce();
    expect(fixtures.state.needsDriveReauth).toBe(true);
  });

  it('marks a rejected expired token for reconnection without claiming an upload', async () => {
    mode = 'upload_401';
    const backup = await createV2Backup(fixtures.tenantContext);

    await expect(uploadBackup('access-token', backup.blob, backup.fileName))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });

    expect(fixtures.state.markDriveNeedsReauth).toHaveBeenCalledOnce();
    expect(fixtures.state).toMatchObject({
      driveAccessToken: null,
      driveTenantBinding: null,
      isDriveConnected: false,
      needsDriveReauth: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks upload when the tenant or actor context is already invalid', async () => {
    const backup = await createV2Backup(fixtures.tenantContext);
    fixtures.tenantGranted = false;
    await expect(uploadBackup('access-token', backup.blob, backup.fileName))
      .rejects.toMatchObject({ code: 'BACKUP_TENANT_CONTEXT_STALE' });
    expect(fetchMock).not.toHaveBeenCalled();

    fixtures.tenantGranted = true;
    fixtures.actorAccess = { authorized: true, isAdmin: false, permissions: [] };
    await expect(uploadBackup('access-token', backup.blob, backup.fileName))
      .rejects.toMatchObject({ code: 'BACKUP_PERMISSION_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['actor_invalidated_after_upload', 'tenant_invalidated_after_upload'])(
    'does not continue cleanup after the %s context changes',
    async (invalidationMode) => {
      mode = invalidationMode;
      const backup = await createV2Backup(fixtures.tenantContext);
      driveFiles.push(makeFile('old-a', backup.tenantFingerprint, Date.now() - 100_000, backup.ownerProperties));

      const result = await uploadBackup('access-token', backup.blob, backup.fileName);

      expect(result.uploadStatus).toBe('confirmed');
      expect(result.cleanupStatus).toBe('pending');
      expect(result.cleanupReason).toBe(invalidationMode.startsWith('actor') ? 'permission_required' : 'context_changed');
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(driveFiles.some((file) => file.id === 'old-a')).toBe(true);
    }
  );

  it('preserves foreign files during concurrent uploads for the same tenant', async () => {
    const contextA = fixtures.tenantContext;
    const backupA = await createV2Backup(contextA);
    const contextB = makeTenantContext('business-b');
    const backupB = await createV2Backup(contextB);
    for (let index = 0; index < 14; index += 1) {
      driveFiles.push(makeFile(`old-a-${index}`, backupA.tenantFingerprint, Date.now() - 100_000 + index, backupA.ownerProperties));
    }
    driveFiles.push(makeFile('business-b-backup', backupB.tenantFingerprint, Date.now() - 200_000, backupB.ownerProperties));
    mode = 'concurrent_uploads';
    concurrentUploadBarrier = new Promise((resolve) => { releaseConcurrentUploads = resolve; });

    const [first, second] = await Promise.all([
      uploadBackup('access-token', backupA.blob, createBackupFileName(new Date(Date.now() + 1), backupA.tenantFingerprint)),
      uploadBackup('access-token', backupA.blob, createBackupFileName(new Date(Date.now() + 2), backupA.tenantFingerprint))
    ]);

    expect(first.uploadStatus).toBe('confirmed');
    expect(second.uploadStatus).toBe('confirmed');
    expect(driveFiles.some((file) => file.id === 'business-b-backup')).toBe(true);
    const retainedA = driveFiles.filter((file) => file.appProperties?.tenant_fingerprint === backupA.tenantFingerprint);
    expect(retainedA.length).toBeGreaterThanOrEqual(14);
    expect(retainedA.length).toBeLessThanOrEqual(16);
    expect(driveFiles.filter((file) => file.id.startsWith('new-'))).toHaveLength(2);
  });

  it('requires verified tenant metadata before deleting a file', async () => {
    const backup = await createV2Backup(fixtures.tenantContext);
    const foreign = makeFile('foreign-file', backup.tenantFingerprint, Date.now() - 10_000, backup.ownerProperties, {
      appProperties: { type: 'lanzo_pos_backup', tenant_fingerprint: 'b'.repeat(64) }
    });
    driveFiles.push(foreign);

    await expect(deleteBackup('access-token', foreign.id, backup.tenantFingerprint))
      .rejects.toMatchObject({ code: 'DRIVE_FILE_OWNERSHIP_UNVERIFIED' });
    expect(driveFiles.some((file) => file.id === foreign.id)).toBe(true);
    expect(fetchMock.mock.calls.filter(([, request]) => request.method === 'DELETE')).toHaveLength(0);
  });

  it('keeps the V2 tenant fingerprint stable across device contexts for the same license', async () => {
    const aliases = ['license-id:business-a', `license-key-sha256:${'a'.repeat(64)}`];
    const first = await createTenantFingerprint(aliases);
    const second = await createTenantFingerprint([...aliases].reverse());
    const otherDevice = {
      ...makeTenantContext('business-a', 'LanzoDB_t_other-device'),
      tenantAliases: aliases
    };
    fixtures.tenantContext = otherDevice;
    fixtures.state.driveTenantBinding = otherDevice.databaseName;
    const backup = await createV2Backup(otherDevice);

    expect(first).toBe(second);
    expect(backup.tenantFingerprint).toBe(first);
    const result = await uploadBackup('access-token', backup.blob, backup.fileName);
    expect(result.uploadStatus).toBe('confirmed');
    expect(driveFiles[0].appProperties.tenant_fingerprint).toBe(first);
  });

  it('retains by a stable license alias when V2 aliases are enriched later', async () => {
    const keyAlias = `license-key-sha256:${'a'.repeat(64)}`;
    const offlineContext = {
      databaseName: 'LanzoDB_t_business-a',
      generation: 1,
      tenantAliases: [keyAlias]
    };
    fixtures.tenantContext = offlineContext;
    fixtures.state.driveTenantBinding = offlineContext.databaseName;
    const offlineBackup = await createV2Backup(offlineContext);
    const firstUpload = await uploadBackup('access-token', offlineBackup.blob, offlineBackup.fileName);

    const onlineContext = {
      ...offlineContext,
      generation: 2,
      tenantAliases: ['license-id:business-a', keyAlias]
    };
    fixtures.tenantContext = onlineContext;
    const onlineBackup = await createV2Backup(onlineContext);
    const secondUpload = await uploadBackup('access-token', onlineBackup.blob, onlineBackup.fileName);

    expect(offlineBackup.tenantFingerprint).not.toBe(onlineBackup.tenantFingerprint);
    expect(firstUpload.uploadedFile.appProperties.tenant_license_key)
      .toBe(secondUpload.uploadedFile.appProperties.tenant_license_key);
    expect(driveFiles.some((file) => file.id === firstUpload.uploadedFile.id)).toBe(true);
    expect(secondUpload.cleanupStatus).toBe('completed');

    fixtures.tenantContext = offlineContext;
    const listedFromOfflineIdentity = await listBackups('access-token');
    expect(listedFromOfflineIdentity.files.map((file) => file.id)).toEqual([
      secondUpload.uploadedFile.id,
      firstUpload.uploadedFile.id
    ]);
  });

  it('lists all pages for the verified tenant and marks a 401 response for reauthentication', async () => {
    const backup = await createV2Backup(fixtures.tenantContext);
    driveFiles.push(makeFile('owned', backup.tenantFingerprint, Date.now() - 10_000, backup.ownerProperties));
    const listed = await listBackups('access-token');
    expect(listed.files.map((file) => file.id)).toEqual(['owned']);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('orderBy')).toBe('createdTime desc');

    mode = 'list_failure';
    // Restore a current token after the prior list and simulate Google's auth rejection.
    fixtures.state.driveAccessToken = 'expired-token';
    fixtures.state.driveTokenExpiresAt = Date.now() + 3_600_000;
    fetchMock.mockImplementationOnce(async () => response({ error: { message: 'Invalid Credentials' } }, {
      status: 401,
      statusText: 'Unauthorized',
      ok: false
    }));
    await expect(listBackups('expired-token')).rejects.toBeInstanceOf(GoogleDriveError);
    expect(fixtures.state.markDriveNeedsReauth).toHaveBeenCalled();
  });

  it('combines every successful page before exposing the listed backups', async () => {
    const backup = await createV2Backup(fixtures.tenantContext);
    driveFiles.push(makeFile('owned-newer', backup.tenantFingerprint, Date.now(), backup.ownerProperties));
    driveFiles.push(makeFile('owned-older', backup.tenantFingerprint, Date.now() - 10_000, backup.ownerProperties));
    mode = 'list_two_pages';

    const listed = await listBackups('access-token');

    expect(listed.files.map((file) => file.id)).toEqual(['owned-newer', 'owned-older']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next-page');
  });
});
