/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_STORAGE_UNAVAILABLE_MESSAGE,
  DATABASE_RECOVERY_CODES,
  classifyDatabaseError,
  normalizeBrowserStorageError
} from '../databaseRecoveryState';
import {
  INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX,
  preflightIndexedDbCapability,
  resetIndexedDbCapabilityPreflightForTests
} from '../indexedDbCapabilityPreflight';

const deleteDatabase = (databaseName) => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(databaseName);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve();
});

afterEach(() => {
  resetIndexedDbCapabilityPreflightForTests();
  vi.restoreAllMocks();
});

describe('browser IndexedDB capability preflight', () => {
  it('proves a real native open/write/read transaction and cleans only its temporary database', async () => {
    const result = await preflightIndexedDbCapability();
    const databases = await indexedDB.databases();

    expect(result).toEqual({ status: 'pass' });
    expect(databases.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(`^${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_`)])
    );
  });

  it('normalizes the observed Dexie DatabaseClosedError wrapping native UnknownError', () => {
    const nativeError = new DOMException('Internal error.', 'UnknownError');
    const dexieError = new Error(`DatabaseClosedError: ${nativeError.name} ${nativeError.message}`);
    dexieError.name = 'DatabaseClosedError';
    dexieError.inner = nativeError;

    const normalized = normalizeBrowserStorageError(dexieError);

    expect(normalized).toMatchObject({
      name: 'BrowserStorageUnavailableError',
      code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE,
      message: BROWSER_STORAGE_UNAVAILABLE_MESSAGE,
      cause: dexieError
    });
    expect(classifyDatabaseError(normalized)).toMatchObject({
      structural: false,
      browserStorageUnavailable: true,
      code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE
    });
  });

  it('normalizes a serialized Dexie wrapper when the error name is only in the message', () => {
    const dexieError = new Error('DatabaseClosedError: UnknownError Internal error.');

    expect(normalizeBrowserStorageError(dexieError)).toMatchObject({
      code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE,
      cause: dexieError
    });
  });

  it('fails locally before any activation RPC when native IndexedDB throws UnknownError', async () => {
    const nativeError = new DOMException('Internal error.', 'UnknownError');
    const factory = {
      open: vi.fn(() => { throw nativeError; })
    };

    await expect(preflightIndexedDbCapability({
      factory,
      databaseName: `${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_unavailable`
    }))
      .rejects.toMatchObject({
        code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE,
        cause: nativeError
      });

    expect(factory.open).toHaveBeenCalledTimes(1);
  });

  it('shares concurrent probes and releases the failed operation for a safe retry', async () => {
    const nativeError = new DOMException('Internal error.', 'UnknownError');
    const factory = {
      open: vi.fn()
        .mockImplementationOnce(() => { throw nativeError; })
        .mockImplementation((...args) => indexedDB.open(...args)),
      deleteDatabase: vi.fn((...args) => indexedDB.deleteDatabase(...args))
    };

    const databaseName = `${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_retry`;
    const first = preflightIndexedDbCapability({ factory, databaseName });
    const duplicate = preflightIndexedDbCapability({ factory, databaseName });
    expect(duplicate).toBe(first);
    await expect(first).rejects.toMatchObject({
      code: DATABASE_RECOVERY_CODES.BROWSER_STORAGE_UNAVAILABLE
    });

    await expect(preflightIndexedDbCapability({
      factory,
      databaseName
    })).resolves.toEqual({ status: 'pass' });
    expect(factory.open).toHaveBeenCalledTimes(2);
    expect(factory.deleteDatabase).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['InvalidStateError', 'Invalid state.'],
    ['AbortError', 'The transaction was aborted.'],
    ['QuotaExceededError', 'The quota was exceeded.']
  ])('does not over-classify a standalone %s as browser-wide unavailability', (name, message) => {
    const error = new DOMException(message, name);
    expect(normalizeBrowserStorageError(error)).toBeNull();
    expect(classifyDatabaseError(error)).toMatchObject({
      structural: false,
      code: null
    });
  });

  it('keeps the structural unsupported-version classification separate', () => {
    const error = new Error('La base fue creada por una versión más reciente.');
    error.code = DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION;

    expect(normalizeBrowserStorageError(error)).toBeNull();
    expect(classifyDatabaseError(error)).toMatchObject({
      structural: true,
      code: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      retryable: false
    });
  });

  it('does not touch named Lanzo tenant databases', async () => {
    const tenantName = 'LanzoDB_t_existing-tenant';
    const request = indexedDB.open(tenantName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('menu', { keyPath: 'id' });
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    await expect(preflightIndexedDbCapability()).resolves.toEqual({ status: 'pass' });
    expect((await indexedDB.databases()).map(({ name }) => name)).toContain(tenantName);
    await deleteDatabase(tenantName);
  });

  it('confines caller-provided names to the dedicated probe namespace', async () => {
    const factory = {
      open: vi.fn((...args) => indexedDB.open(...args)),
      deleteDatabase: vi.fn((...args) => indexedDB.deleteDatabase(...args))
    };

    await expect(preflightIndexedDbCapability({ factory, databaseName: 'LanzoDB_t_business' }))
      .resolves.toEqual({ status: 'pass' });

    expect(factory.open.mock.calls[0][0]).toMatch(
      new RegExp(`^${INDEXED_DB_CAPABILITY_PROBE_DATABASE_PREFIX}_`)
    );
    expect(factory.open).not.toHaveBeenCalledWith('LanzoDB_t_business');
    expect(factory.deleteDatabase).not.toHaveBeenCalledWith('LanzoDB_t_business');
  });
});
