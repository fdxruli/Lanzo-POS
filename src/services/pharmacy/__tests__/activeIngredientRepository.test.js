import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  currentLicenseKey: null, cloudEnabled: false, db: null,
  cloudUpsert: vi.fn(), enqueueOperation: vi.fn()
}));

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
    ? {
      license_key: harness.currentLicenseKey,
      features: harness.cloudEnabled ? { cloud_pos_sync: true, cloud_products_sync: true } : {}
    } : null })
} }));
vi.mock('../../auth/productInventoryAuthority', () => ({
  captureProductInventoryMutation: () => ({ assertCurrent: () => {} }),
  assertProductInventoryMutationCurrent: () => {},
  actorOriginFromHandle: () => ({ actorKey: 'admin:test' })
}));
vi.mock('../../products/productCloudRepository', () => ({
  productCloudRepository: { upsertActiveIngredient: harness.cloudUpsert }
}));
vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: { enqueueOperation: harness.enqueueOperation }
}));

import { activeIngredientRepository } from '../activeIngredientRepository';

describe('activeIngredientRepository local persistence', () => {
  beforeEach(async () => {
    harness.currentLicenseKey = null;
    harness.cloudEnabled = false;
    harness.cloudUpsert.mockReset();
    harness.enqueueOperation.mockReset();
    if (harness.db.isOpen()) harness.db.close();
    await harness.db.delete();
    await harness.db.open();
  });
  afterAll(async () => {
    if (harness.db?.isOpen()) harness.db.close();
    await harness.db?.delete();
  });

  it('resolves simultaneous case, whitespace, accent, and Unicode variants to one local identity', async () => {
    const variants = [
      'Paracetamol',
      'paracetamol',
      'PARACETAMOL',
      '  Paracetamol  ',
      'Paracetamól',
      'Paracetamo\u0301l'
    ];
    const created = await Promise.all(variants.map((name) => activeIngredientRepository.create(name)));
    const first = created[0];

    expect(new Set(created.map(({ id }) => id)).size).toBe(1);
    expect(await harness.db.table('active_ingredients').count()).toBe(1);
    expect(await activeIngredientRepository.list()).toHaveLength(1);
    expect(await activeIngredientRepository.getByNameKey('paracetamol')).toMatchObject({
      id: first.id, nameKey: 'paracetamol', businessKey: harness.db.name
    });

    const differentIngredient = await activeIngredientRepository.create('Paracetamol XR');
    expect(differentIngredient.id).not.toBe(first.id);
    expect(await harness.db.table('active_ingredients').count()).toBe(2);

    const product = { id: 'product-paracetamol', metadata: { pharmacy: { composition: {
      version: 1, activeIngredients: [{ activeIngredientId: first.id, name: first.name,
        amount: 500, unit: 'mg', basisAmount: 1, basisUnit: 'tableta' }]
    } } } };
    await harness.db.table('menu').put(product);
    harness.db.close();
    await harness.db.open();
    const persisted = await harness.db.table('active_ingredients').get(first.id);
    expect(persisted).toMatchObject({ id: first.id, nameKey: 'paracetamol' });
    expect(variants.some((name) => name.trim() === persisted.name)).toBe(true);
    expect((await harness.db.table('menu').get(product.id)).metadata.pharmacy.composition.activeIngredients[0])
      .toMatchObject({ activeIngredientId: first.id, amount: 500 });
  });

  it('reuses the preferred existing identity without deleting a legacy equivalent row', async () => {
    await harness.db.table('active_ingredients').bulkPut([
      {
        id: 'ai-canonical', businessKey: harness.db.name, name: 'Paracetamol',
        nameKey: 'paracetamol', isActive: true, createdAt: '2026-11-27T18:40:00.000Z'
      },
      {
        id: 'ai-legacy-accent', businessKey: harness.db.name, name: 'Paracetamól',
        nameKey: 'paracetamól', isActive: true, createdAt: '2026-11-27T23:19:00.000Z'
      }
    ]);

    await expect(activeIngredientRepository.create('Paracetamo\u0301l')).resolves.toMatchObject({
      id: 'ai-canonical', name: 'Paracetamol'
    });
    await expect(activeIngredientRepository.getByNameKey('paracetamól')).resolves.toMatchObject({
      id: 'ai-legacy-accent', name: 'Paracetamól'
    });
    await expect(activeIngredientRepository.getByNameEquivalenceKey('Paracetamól')).resolves.toMatchObject({
      id: 'ai-canonical', name: 'Paracetamol'
    });
    expect(await harness.db.table('active_ingredients').count()).toBe(2);
  });

  it('reconciles a local identity to the cloud ID in products and pending sync payloads', async () => {
    harness.currentLicenseKey = 'license-cloud-a';
    harness.cloudEnabled = true;
    const localId = 'ai-local-paracetamol';
    const cloudId = 'ai-cloud-paracetamol';
    const product = {
      id: 'product-local-combination',
      metadata: { pharmacy: { composition: { version: 1, activeIngredients: [
        { activeIngredientId: localId, name: 'Paracetamól' },
        { activeIngredientId: 'ai-other', name: 'Clavulanato' }
      ] } } }
    };
    const otherProduct = {
      id: 'product-other-ingredient',
      metadata: { pharmacy: { composition: { version: 1, activeIngredients: [
        { activeIngredientId: 'ai-other', name: 'Clavulanato' }
      ] } } }
    };
    await harness.db.table('active_ingredients').put({
      id: localId, businessKey: harness.db.name, name: 'Paracetamól',
      nameKey: 'paracetamól', isActive: true, syncStatus: 'pending'
    });
    await harness.db.table('menu').bulkPut([product, otherProduct]);
    await harness.db.table('sync_outbox').bulkPut([
      { id: 'pending-product', entityType: 'product', status: 'pending', payload: { product } },
      { id: 'completed-product', entityType: 'product', status: 'completed', payload: { product } }
    ]);

    await activeIngredientRepository.applyCloudRecord({
      id: cloudId, client_id: localId, name: 'Paracetamól', name_key: 'paracetamól',
      is_active: true, server_version: 1
    }, { localId });

    expect(await harness.db.table('active_ingredients').get(localId)).toBeUndefined();
    expect(await harness.db.table('active_ingredients').get(cloudId)).toMatchObject({
      id: cloudId, businessKey: 'license-cloud-a', clientIds: [localId]
    });
    expect((await harness.db.table('menu').get(product.id)).metadata.pharmacy.composition.activeIngredients)
      .toEqual([
        { activeIngredientId: cloudId, name: 'Paracetamól' },
        { activeIngredientId: 'ai-other', name: 'Clavulanato' }
      ]);
    expect(await harness.db.table('menu').get(otherProduct.id)).toEqual(otherProduct);
    expect((await harness.db.table('sync_outbox').get('pending-product')).payload.product.metadata.pharmacy.composition.activeIngredients[0])
      .toMatchObject({ activeIngredientId: cloudId, name: 'Paracetamól' });
    expect((await harness.db.table('sync_outbox').get('completed-product')).payload.product.metadata.pharmacy.composition.activeIngredients[0])
      .toMatchObject({ activeIngredientId: localId, name: 'Paracetamól' });
  });

  it('creates a new accented cloud identity with the F01 persistent name key', async () => {
    harness.currentLicenseKey = 'license-cloud-a';
    harness.cloudEnabled = true;

    const ingredient = await activeIngredientRepository.create('Cafeína');

    expect(ingredient).toMatchObject({
      name: 'Cafeína', nameKey: 'cafeína', businessKey: 'license-cloud-a', syncStatus: 'pending'
    });
    expect(await activeIngredientRepository.getById(ingredient.id)).toMatchObject({
      id: ingredient.id, syncStatus: 'pending', nameKey: 'cafeína'
    });
    expect(harness.cloudUpsert).toHaveBeenCalledWith(expect.objectContaining({
      activeIngredient: expect.objectContaining({ id: ingredient.id, name: 'Cafeína', nameKey: 'cafeína' })
    }));
    expect(harness.enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'active_ingredient', entityId: ingredient.id,
      payload: { activeIngredient: expect.objectContaining({ nameKey: 'cafeína' }), expectedVersion: null }
    }));
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
