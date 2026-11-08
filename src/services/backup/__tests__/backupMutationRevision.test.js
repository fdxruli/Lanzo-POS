/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installBackupMutationTracking,
  readBackupMutationRevision
} from '../backupMutationRevision';

describe('backup mutation revision', () => {
  const databases = new Set();
  afterEach(async () => {
    localStorage.clear();
    await Promise.all([...databases].map(async (databaseName) => Dexie.delete(databaseName)));
    databases.clear();
  });

  it('changes on an edit even when the table row count stays the same', async () => {
    const databaseName = `LanzoDB_t_t_${crypto.randomUUID().replaceAll('-', '')}`;
    databases.add(databaseName);
    const database = new Dexie(databaseName);
    database.version(1).stores({ menu: 'id' });
    await database.open();
    installBackupMutationTracking(database);

    await database.table('menu').add({ id: 'p1', name: 'Producto', price: 10 });
    const afterCreate = readBackupMutationRevision(databaseName);
    await database.table('menu').update('p1', { price: 12 });
    const afterEdit = readBackupMutationRevision(databaseName);

    expect(await database.table('menu').count()).toBe(1);
    expect(afterCreate).toBeTruthy();
    expect(afterEdit).toBeTruthy();
    expect(afterEdit).not.toBe(afterCreate);
    database.close();
  });

  it('leaves revision unavailable when browser storage cannot persist it', async () => {
    const databaseName = `LanzoDB_t_t_${crypto.randomUUID().replaceAll('-', '')}`;
    const blockedStorage = { setItem: () => { throw new DOMException('Blocked', 'SecurityError'); } };
    expect(readBackupMutationRevision(databaseName, blockedStorage)).toBeNull();
  });
});
