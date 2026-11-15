/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import Dexie from 'dexie';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_MONITORED_TABLE_NAMES } from '../../services/backup/backupScope';
import {
  base64ToBytes, buildHeader, bytesToBase64, concatBytes, createTenantFingerprint,
  decryptChunk, deriveBackupKey, encryptChunk, parseHeader, readEncryptedChunks
} from '../../services/backup/backupFormat';

import { createCanonicalLanzoDatabase } from '../../services/db/dexie.js';
import { downloadBackup, listBackups } from '../../services/googleDriveService';
import { useAppStore } from '../../store/useAppStore';

const drive = vi.hoisted(() => ({ context: null }));
vi.mock('../../services/tenant/tenantWorkerContext', async (importOriginal) => ({
  ...await importOriginal(),
  captureActiveTenantWorkerContext: () => drive.context,
  isActiveTenantWorkerContext: (captured) => Boolean(drive.context)
    && captured.databaseName === drive.context.databaseName && captured.generation === drive.context.generation
}));
vi.mock('../../services/auth/actorAccessPolicy', async (importOriginal) => ({
  ...await importOriginal(),
  readActorAccess: () => ({
    isAdmin: true, isAuthorizedActor: true, actorType: 'admin', actorId: 'synthetic-admin',
    canAccessPermission: () => true,
    runtimeSnapshot: {
      status: 'granted', actorType: 'admin', actorId: 'synthetic-admin', actorKey: 'admin:synthetic-admin',
      sessionId: 'synthetic-session', generation: 1, deviceRef: 'synthetic-device'
    }
  })
}));

const keyAlias = `license-key-sha256:${'a'.repeat(64)}`;
const idAlias = 'license-id:synthetic-business';
const pin = '12345678';
let sequence = 0;
let authorize;
let progressHook;
let worker;
const openDatabases = [];
const context = (aliases = [keyAlias]) => ({
  databaseName: `LanzoDB_t_t_${crypto.randomUUID().replaceAll('-', '')}`,
  tenantAliases: aliases,
  generation: 1
});

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  // jsdom FileReader is used by dexie-export-import; add the browser Blob API
  // used by the real encryption worker without substituting archive/crypto code.
  Blob.prototype.arrayBuffer ||= function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
  worker = {};
  vi.stubGlobal('self', worker);
  await import('../backup.worker.js');
});

beforeEach(() => { authorize = () => true; progressHook = () => {}; });
afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});

async function command(commandName, payload) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    worker.postMessage = (message) => {
      if (message.type === 'restore-authority') {
        const authorized = authorize(message);
        queueMicrotask(() => worker.onmessage({ data: {
          command: 'restore-authority', requestId: message.requestId, authorized
        } }));
      } else if (message.type === 'progress') progressHook(message);
      else if (message.id === id) {
        if (message.type === 'error') reject(new Error(message.error.code));
        else resolve(message.result);
      }
    };
    worker.onmessage({ data: { id, command: commandName, payload } });
  });
}

async function databaseFor(ctx) {
  const database = createCanonicalLanzoDatabase(ctx.databaseName);
  openDatabases.push(database);
  await database.open();
  await database.table('local_tenant_binding').put({
    key: 'primary', bindingVersion: 1, tenantIdentity: ctx.tenantAliases[0], tenantAliases: ctx.tenantAliases
  });
  return database;
}

async function fixture(aliases = [keyAlias], excludedBrowserState = null) {
  const source = context(aliases);
  const database = await databaseFor(source);
  const rows = {
    categories: { id: 'category', name: 'Prueba' },
    menu: { id: 'product', category_id: 'category', stock: 7 },
    product_batches: { id: 'batch', product_id: 'product', stock: 7 },
    customers: { id: 'customer', name: 'Sintético' },
    sales: { id: 'sale', customer_id: 'customer', caja_id: 'cash', total: 125 },
    customer_ledger: { id: 'payment', customer_id: 'customer', sale_id: 'sale', amount: 25 },
    cajas: { id: 'cash', estado: 'cerrada', deviceId: 'origin-secret' },
    movimientos_caja: { id: 'movement', caja_id: 'cash', cash_session_id: 'cash', sale_id: 'sale' },
    sequences: { id: 'sale_folio', value: 12 }
  };
  for (const [name, row] of Object.entries(rows)) await database.table(name).put(row);
  await database.table('company').put({ id: 'excluded-source' });
  await command('unlock', { pin, salt: bytesToBase64(new Uint8Array(16).fill(3)), iterations: 1000 });
  const backup = await command('backup', { context: source, excludedBrowserState });
  return { source, file: backup.blob, rows, fileName: backup.fileName, header: backup.header };
}

// Re-authenticate synthetic fixtures with the original PIN to exercise policy
// failures independently of AES-GCM failures. Never used on real files.
async function rewriteFixture(file, { headerChanges = {}, sourceName, legacy = false, mutateArchive } = {}) {
  const { header, headerBytes, dataOffset } = await parseHeader(file);
  const { key } = await deriveBackupKey(pin, base64ToBytes(header.salt), header.iterations);
  const parts = [];
  for await (const chunk of readEncryptedChunks(file, dataOffset)) {
    parts.push(await decryptChunk(key, headerBytes, chunk.index, chunk.iv, chunk.cipherBytes));
  }
  const archive = JSON.parse(new TextDecoder().decode(concatBytes(...parts)));
  if (sourceName) archive.data.databaseName = sourceName;
  if (legacy) {
    const allowed = ['menu', 'sales', 'customers'];
    archive.data.tables = archive.data.tables.filter((table) => allowed.includes(table.name));
    archive.data.data = archive.data.data.filter((table) => allowed.includes(table.tableName));
  }
  mutateArchive?.(archive);
  const plain = new TextEncoder().encode(JSON.stringify(archive));
  const next = buildHeader({ ...header, ...headerChanges, sourceBytes: plain.byteLength, chunkCount: 1,
    ...(legacy ? { version: 1, format: 'LANZOBK1', archiveVersion: 1 } : {}) });
  let prefix = next.prefix;
  if (legacy) {
    prefix = prefix.slice();
    prefix.set(new TextEncoder().encode('LANZOBK1'));
  }
  return new Blob([prefix, await encryptChunk(key, next.headerBytes, 0, plain)]);
}

describe('V2 worker portability with real encryption and Dexie', () => {
  it('writes excluded browser-state counts into V2 coverage and keeps empty coverage complete', async () => {
    const partial = await fixture([keyAlias], {
      inspectionComplete: true,
      counts: {
        activeOrders: 2,
        unsavedCart: 0,
        unfinishedInventoryAdjustments: 0,
        pendingOrderClosures: 1,
        otherPendingBusinessState: 0
      },
      privateOrderPayload: 'must-not-enter-the-backup'
    });

    expect(partial.header.coverage).toMatchObject({
      complete: false,
      status: 'partial',
      excludedBrowserState: {
        activeOrders: 2,
        unsavedCart: 0,
        unfinishedInventoryAdjustments: 0,
        pendingOrderClosures: 1,
        otherPendingBusinessState: 0
      },
      partialReasons: ['pending_browser_operations_excluded']
    });
    expect(JSON.stringify(partial.header.coverage)).not.toContain('must-not-enter-the-backup');
    const parsed = await parseHeader(partial.file);
    const { key } = await deriveBackupKey(pin, base64ToBytes(parsed.header.salt), parsed.header.iterations);
    const plaintext = [];
    for await (const chunk of readEncryptedChunks(partial.file, parsed.dataOffset)) {
      plaintext.push(await decryptChunk(key, parsed.headerBytes, chunk.index, chunk.iv, chunk.cipherBytes));
    }
    expect(new TextDecoder().decode(concatBytes(...plaintext))).not.toContain('must-not-enter-the-backup');

    const complete = await fixture([keyAlias], {
      inspectionComplete: true,
      counts: {
        activeOrders: 0,
        unsavedCart: 0,
        unfinishedInventoryAdjustments: 0,
        pendingOrderClosures: 0,
        otherPendingBusinessState: 0
      }
    });
    expect(complete.header.coverage.complete).toBe(true);
    expect(complete.header.coverage.partialReasons).toEqual([]);
  });

  it('recovers an encrypted copy via mocked Drive into B and rejects it in another business', async () => {
    const { source, file, rows, fileName, header } = await fixture();
    openDatabases.find((database) => database.name === source.databaseName).close();
    await Dexie.delete(source.databaseName);
    const target = context([keyAlias, idAlias]);
    const destination = await databaseFor(target);
    drive.context = target;
    useAppStore.setState({
      driveAccessToken: 'synthetic-token', isDriveConnected: true,
      driveTokenExpiresAt: Date.now() + 3_600_000, driveTenantBinding: target.databaseName
    });
    const hexDigest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    const metadata = {
      id: 'synthetic-drive-copy', name: fileName, createdTime: header.createdAt,
      size: String(file.size), version: '1', mimeType: 'application/octet-stream', trashed: false,
      capabilities: { canDownload: true }, sha256Checksum: await hexDigest(await file.arrayBuffer()),
      appProperties: {
        type: 'lanzo_pos_backup', tenant_fingerprint: header.tenantFingerprint,
        tenant_license_key: await hexDigest(new TextEncoder().encode(`lanzo-drive-owner:v1\n${keyAlias}`))
      }
    };
    const fetchMock = vi.fn(async (requestUrl) => {
      const url = new URL(requestUrl);
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => url.pathname.endsWith('/files') ? { files: [metadata] } : metadata,
        blob: async () => file
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const listed = await listBackups('synthetic-token');
    const downloaded = await downloadBackup('synthetic-token', listed.files[0]);
    const preview = await command('inspect', { file: downloaded, pin, context: target });
    expect(preview.destinationHasBusinessData).toBe(false);
    expect(preview.sourceTableCounts.sales).toBe(1);
    await command('restore', { file: downloaded, pin, context: target });
    for (const [name, row] of Object.entries(rows)) {
      expect(await destination.table(name).count()).toBe(1);
      if (name === 'cajas') expect(await destination.table(name).get(row.id)).toMatchObject({ id: 'cash', estado: 'cerrada' });
      else expect(await destination.table(name).get(row.id)).toMatchObject(row);
    }
    expect(await Dexie.getDatabaseNames()).not.toContain(source.databaseName);
    expect((await Dexie.getDatabaseNames()).filter((name) => name.includes('_backup_stage_'))).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).searchParams.get('alt') === 'media')).toBe(true);
    const foreign = context(['license-id:another-business']);
    const foreignDatabase = await databaseFor(foreign);
    for (const operation of ['inspect', 'restore']) {
      await expect(command(operation, { file: downloaded, pin, context: foreign })).rejects.toThrow('BACKUP_TENANT_MISMATCH');
    }
    expect(await foreignDatabase.table('sales').count()).toBe(0);
    expect(await foreignDatabase.table('menu').count()).toBe(0);
  });

  it.each([false, true])('restores A → B with original PIN and enriched aliases=%s', async (enriched) => {
    const { source, file, rows } = await fixture();
    const origin = openDatabases.find((database) => database.name === source.databaseName);
    origin.close();
    await Dexie.delete(source.databaseName);
    const target = context(enriched ? [keyAlias, idAlias] : [keyAlias]);
    const database = await databaseFor(target);
    await database.table('company').put({ id: 'destination-only' });
    expect(source.databaseName).not.toBe(target.databaseName);
    const preview = await command('inspect', { file, pin, context: target });
    expect(preview.sourceTableCounts.sales).toBe(1);
    expect(preview.destinationHasBusinessData).toBe(false);
    const result = await command('restore', {
      file, pin, context: target, expectedDestinationHasBusinessData: false
    });
    expect(result.restored).toBe(true);
    for (const [name, row] of Object.entries(rows)) {
      const restored = await database.table(name).get(row.id);
      if (name === 'cajas') expect(restored).toMatchObject({ id: 'cash', estado: 'cerrada' });
      else expect(restored).toMatchObject(row);
    }
    expect((await database.table('cajas').get('cash')).deviceId).toBeUndefined();
    expect(await database.table('company').toArray()).toEqual([{ id: 'destination-only' }]);
    for (const name of BACKUP_MONITORED_TABLE_NAMES) expect(await database.table(name).count()).toBe(0);
    expect((await Dexie.getDatabaseNames()).filter((name) => name.includes('_backup_stage_'))).toEqual([]);
    expect(await Dexie.getDatabaseNames()).not.toContain(source.databaseName);
  });

  it('preserves same physical database compatibility', async () => {
    const { source, file } = await fixture([idAlias, keyAlias]);
    const preview = await command('inspect', { file, pin, context: source });
    expect(preview.destinationHasBusinessData).toBe(true);
    expect((await command('restore', { file, pin, context: source, expectedDestinationHasBusinessData: true })).restored).toBe(true);
  });

  it('also accepts the historical license-id singleton when the current verified set is enriched', async () => {
    const { file } = await fixture([idAlias]);
    const target = context([idAlias, keyAlias]);
    const database = await databaseFor(target);
    expect((await command('inspect', { file, pin, context: target })).sourceTableCounts.sales).toBe(1);
    await command('restore', { file, pin, context: target });
    expect(await database.table('sales').get('sale')).toMatchObject({ customer_id: 'customer', total: 125 });
  });

  it('does not infer an unknown historical alias from a full-set fingerprint', async () => {
    const { file } = await fixture([idAlias, keyAlias]);
    const target = context([keyAlias]);
    const database = await databaseFor(target);
    await expect(command('restore', { file, pin, context: target })).rejects.toThrow('BACKUP_TENANT_MISMATCH');
    expect(await database.table('sales').count()).toBe(0);
  });

  it('rejects an authenticated foreign fingerprint and an invalid physical source', async () => {
    const { file } = await fixture();
    const target = context();
    const database = await databaseFor(target);
    const foreign = await rewriteFixture(file, {
      headerChanges: { tenantFingerprint: await createTenantFingerprint(['license-id:foreign']) }
    });
    const invalidSource = await rewriteFixture(file, { sourceName: 'LanzoDB1' });
    const invalidCoverage = await rewriteFixture(file, { headerChanges: { coverage: { tableCounts: {} } } });
    for (const operation of ['inspect', 'restore']) {
      await expect(command(operation, { file: foreign, pin, context: target })).rejects.toThrow('BACKUP_TENANT_MISMATCH');
      await expect(command(operation, { file: invalidSource, pin, context: target })).rejects.toThrow('BACKUP_DATABASE_MISMATCH');
      await expect(command(operation, { file: invalidCoverage, pin, context: target })).rejects.toThrow('BACKUP_COVERAGE_MANIFEST_MISMATCH');
    }
    expect(await database.table('sales').count()).toBe(0);
  });

  it('preserves V1 same-device recovery and refuses V1 portability', async () => {
    const { source, file } = await fixture([idAlias]);
    const legacy = await rewriteFixture(file, { legacy: true, headerChanges: {
      dbName: source.databaseName, tenantIdentity: idAlias
    } });
    expect((await command('inspect', { file: legacy, pin, context: source })).formatVersion).toBe(1);
    expect((await command('restore', {
      file: legacy, pin, context: source, expectedDestinationHasBusinessData: true
    })).partial).toBe(true);
    const target = context([idAlias]);
    const database = await databaseFor(target);
    await expect(command('inspect', { file: legacy, pin, context: target })).rejects.toThrow('BACKUP_TENANT_DATABASE_MISMATCH');
    await expect(command('restore', { file: legacy, pin, context: target })).rejects.toThrow('BACKUP_TENANT_DATABASE_MISMATCH');
    expect(await database.table('sales').count()).toBe(0);
  });

  it.each([
    ['foreign business', ['license-id:foreign']],
    ['unknown key', [`license-key-sha256:${'b'.repeat(64)}`]],
    ['ambiguous aliases', [keyAlias, idAlias, 'license-id:contradiction']],
    ['unsupported alias', [keyAlias, 'unknown:alias']]
  ])('rejects %s with a known PIN without writes', async (_, aliases) => {
    const { file } = await fixture();
    const target = context(aliases);
    const database = await databaseFor(target);
    for (const operation of ['inspect', 'restore']) {
      await expect(command(operation, { file, pin, context: target })).rejects.toThrow('BACKUP_TENANT_MISMATCH');
    }
    expect(await database.table('sales').count()).toBe(0);
  });

  it('rejects a contradictory local binding even when a key alias matches', async () => {
    const { file } = await fixture();
    const target = context([keyAlias, idAlias]);
    const database = await databaseFor(target);
    await database.table('local_tenant_binding').put({
      key: 'primary', bindingVersion: 1, tenantIdentity: keyAlias, tenantAliases: [keyAlias, 'license-id:foreign']
    });
    await expect(command('restore', { file, pin, context: target })).rejects.toThrow('BACKUP_TENANT_MISMATCH');
    expect(await database.table('sales').count()).toBe(0);
  });

  it('rejects wrong PIN, damaged ciphertext and an altered fingerprint', async () => {
    const { file } = await fixture();
    const target = context();
    const database = await databaseFor(target);
    await expect(command('inspect', { file, pin: '87654321', context: target })).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
    const damaged = new Uint8Array(await file.arrayBuffer());
    damaged[damaged.length - 1] ^= 1;
    await expect(command('restore', { file: new Blob([damaged]), pin, context: target })).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const index = text.indexOf('"tenantFingerprint":"') + '"tenantFingerprint":"'.length;
    bytes[index] = bytes[index] === 97 ? 98 : 97;
    await expect(command('restore', { file: new Blob([bytes]), pin, context: target })).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
    expect(await database.table('sales').count()).toBe(0);
  });

  it('rejects pending financial operations without replacing business data', async () => {
    const { file } = await fixture();
    const target = context();
    const database = await databaseFor(target);
    await database.table('financial_intents').put({ id: 'pending', status: 'PENDING' });
    await expect(command('restore', { file, pin, context: target })).rejects.toThrow('BACKUP_RESTORE_PENDING_OPERATIONS');
    expect(await database.table('sales').count()).toBe(0);
    expect(await database.table('financial_intents').count()).toBe(1);
  });

  it('keeps the destination intact and cleans staging when an authenticated archive fails import', async () => {
    const { file } = await fixture();
    const target = context();
    const database = await databaseFor(target);
    await database.table('menu').put({ id: 'old', name: 'Conservar' });
    const broken = await rewriteFixture(file, { mutateArchive: (archive) => {
      archive.data.data.find((table) => table.tableName === 'sales').rows[0].id = { invalidIndexedDbKey: true };
    } });
    await expect(command('restore', {
      file: broken, pin, context: target, expectedDestinationHasBusinessData: true
    })).rejects.toThrow();
    expect(await database.table('menu').toArray()).toEqual([{ id: 'old', name: 'Conservar' }]);
    expect(await database.table('sales').count()).toBe(0);
    expect((await Dexie.getDatabaseNames()).filter((name) => name.includes('_backup_stage_'))).toEqual([]);
  });

  it.each([2, 3])('revocation at authority checkpoint %s prevents writes or rolls them back', async (revokeAt) => {
    const { file } = await fixture();
    const target = context();
    const database = await databaseFor(target);
    let checks = 0;
    authorize = () => ++checks < revokeAt;
    await expect(command('restore', { file, pin, context: target })).rejects.toThrow('BACKUP_TENANT_CONTEXT_STALE');
    expect(await database.table('sales').count()).toBe(0);
    expect(await database.table('cajas').count()).toBe(0);
  });
});
