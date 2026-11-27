import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ currentLicenseKey: null, db: null }));

vi.mock('../../db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const db = new Dexie('pharmacy-active-ingredient-repository-tests');
  db.version(1).stores({
    active_ingredients: 'id, &[businessKey+nameKey], nameKey, businessKey, isActive, syncStatus, updatedAt',
    menu: 'id',
    sync_outbox: 'id, entityType, status'
  });
  harness.db = db;
  return { db, STORES: { ACTIVE_INGREDIENTS: 'active_ingredients', MENU: 'menu' } };
});
vi.mock('../../../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ licenseDetails: harness.currentLicenseKey
    ? { license_key: harness.currentLicenseKey } : null })
} }));
vi.mock('../../auth/productInventoryAuthority', () => ({
  captureProductInventoryMutation: () => ({ assertCurrent: () => {} }),
  assertProductInventoryMutationCurrent: () => {},
  actorOriginFromHandle: () => ({ actorKey: 'admin:test' })
}));
vi.mock('../../products/productCloudRepository', () => ({ productCloudRepository: {} }));
vi.mock('../../sync/syncOutboxService', () => ({ syncOutboxService: { enqueueOperation: vi.fn() } }));

import { activeIngredientRepository } from '../activeIngredientRepository';

describe('activeIngredientRepository local persistence', () => {
  beforeEach(async () => {
    harness.currentLicenseKey = null;
    if (harness.db.isOpen()) harness.db.close();
    await harness.db.delete();
    await harness.db.open();
  });
  afterAll(async () => {
    if (harness.db?.isOpen()) harness.db.close();
    await harness.db?.delete();
  });

  it('resolves simultaneous case and whitespace variants to one stable local identity', async () => {
    const [first, second] = await Promise.all([
      activeIngredientRepository.create('Paracetamol'),
      activeIngredientRepository.create('  PARACETAMOL  ')
    ]);

    expect(first.id).toBe(second.id);
    expect(await harness.db.table('active_ingredients').count()).toBe(1);
    expect(await activeIngredientRepository.list()).toHaveLength(1);
    expect(await activeIngredientRepository.getByNameKey('paracetamol')).toMatchObject({
      id: first.id, nameKey: 'paracetamol', businessKey: harness.db.name
    });

    const product = { id: 'product-paracetamol', metadata: { pharmacy: { composition: {
      version: 1, activeIngredients: [{ activeIngredientId: first.id, name: first.name,
        amount: 500, unit: 'mg', basisAmount: 1, basisUnit: 'tableta' }]
    } } } };
    await harness.db.table('menu').put(product);
    harness.db.close();
    await harness.db.open();
    expect(await harness.db.table('active_ingredients').get(first.id)).toMatchObject({ name: 'Paracetamol' });
    expect((await harness.db.table('menu').get(product.id)).metadata.pharmacy.composition.activeIngredients[0])
      .toMatchObject({ activeIngredientId: first.id, amount: 500 });
  });

  it('scopes matching names to the active business', async () => {
    const firstBusiness = await activeIngredientRepository.create('Paracetamol');
    harness.currentLicenseKey = 'license-business-b';
    const secondBusiness = await activeIngredientRepository.create('Paracetamol');

    expect(firstBusiness.id).not.toBe(secondBusiness.id);
    expect(await activeIngredientRepository.list()).toEqual([expect.objectContaining({ businessKey: 'license-business-b' })]);
    harness.currentLicenseKey = null;
    expect(await activeIngredientRepository.list()).toEqual([expect.objectContaining({ id: firstBusiness.id })]);
  });
});
