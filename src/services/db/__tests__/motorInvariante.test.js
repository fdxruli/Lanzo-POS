/**
 * MOTOR INVARIANTE V4.1 - Test Suite
 *
 * Criterios de Aceptación:
 * 1. Test de Hook Enforcement: activeStockStatus se calcula correctamente vía hooks
 * 2. Test de Evitación de Fugas: saveDataSafe lanza error en tablas críticas
 * 3. Integridad en Cancelaciones: restoreStockFromCancellation funciona correctamente
 * 4. Consistencia de Índices: Consultas por [categoryId+activeStockStatus] funcionan
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, STORES } from '../dexie';
import { productsRepository } from '../products';
import { saveDataSafe } from '../index';

describe('Motor Invariante V4.1', () => {
  // Limpiar la base de datos antes de cada test
  beforeEach(async () => {
    await db.open();
    // Limpiar tablas de test
    await db.table(STORES.MENU).clear();
    await db.table(STORES.PRODUCT_BATCHES).clear();
    await db.table(STORES.DELETED_SALES).clear();
    await db.table(STORES.SALES).clear();
  });

  afterEach(async () => {
    // No cerramos aquí para mantener el contexto entre tests relacionados
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITERIO 1: Test de Hook Enforcement
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Hook Enforcement - activeStockStatus', () => {
    it('debe calcular activeStockStatus=1 cuando stock pasa de 0 a 5 vía hook', async () => {
      const productId = 'test-hook-001';

      // Crear producto con stock 0
      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Test Product',
        name_lower: 'test product',
        stock: 0,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Verificar estado inicial
      let product = await db.table(STORES.MENU).get(productId);
      expect(product.activeStockStatus).toBe(0);

      // Simular llegada de stock (como en una cancelación)
      await db.table(STORES.MENU).update(productId, { stock: 5 });

      // Verificar que el hook calculó correctamente
      product = await db.table(STORES.MENU).get(productId);
      expect(product.activeStockStatus).toBe(1); // No 0, no undefined
    });

    it('debe calcular activeStockStatus=0 cuando isActive=false aunque tenga stock', async () => {
      const productId = 'test-hook-002';

      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Inactive Product',
        name_lower: 'inactive product',
        stock: 10,
        isActive: false,
        createdAt: new Date().toISOString()
      });

      const product = await db.table(STORES.MENU).get(productId);
      expect(product.activeStockStatus).toBe(0);
    });

    it('debe ignorar intentos de setear activeStockStatus manualmente en hooks', async () => {
      const productId = 'test-hook-003';

      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Guard Test',
        name_lower: 'guard test',
        stock: 5,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Intentar evadir el hook setando activeStockStatus manualmente (valor incorrecto)
      await db.table(STORES.MENU).update(productId, {
        stock: 0,
        activeStockStatus: 1 // Intento malicioso de mantenerlo como "activo con stock"
      });

      // El hook debería haber sobrescrito este valor
      const product = await db.table(STORES.MENU).get(productId);
      expect(product.activeStockStatus).toBe(0); // Calculado correctamente
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITERIO 2: Test de Evitación de Fugas
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Evitación de Fugas - saveDataSafe', () => {
    it('debe lanzar error si se usa saveDataSafe en MENU', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        saveDataSafe(STORES.MENU, { id: 'test-x', stock: 10, name: 'Test' })
      ).rejects.toThrow('saveDataSafe prohibido');

      consoleSpy.mockRestore();
    });

    it('debe lanzar error si se usa saveDataSafe en PRODUCT_BATCHES', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        saveDataSafe(STORES.PRODUCT_BATCHES, { id: 'batch-x', stock: 10 })
      ).rejects.toThrow('saveDataSafe prohibido');

      consoleSpy.mockRestore();
    });

    it('debe permitir saveDataSafe en otras tablas (ej. CUSTOMERS)', async () => {
      // Este test asume que CUSTOMERS no tiene la guardia
      // Si CUSTOMERS también tiene restricciones, ajustar la tabla usada
      const result = await saveDataSafe(STORES.CUSTOMERS, {
        id: 'cust-test-001',
        name: 'Test Customer',
        phone: '1234567890'
      });

      expect(result).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITERIO 3: Integridad en Cancelaciones
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Integridad en Cancelaciones - restoreStockFromCancellation', () => {
    it('debe restaurar stock de productos simples correctamente', async () => {
      const productId = 'prod-cancel-001';

      // Setup: Producto con stock 1
      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Producto Cancelable',
        name_lower: 'producto cancelable',
        stock: 1,
        isActive: true,
        trackStock: true,
        createdAt: new Date().toISOString()
      });

      // Verificar que aparece en índice de activos con stock
      let activeProducts = await db.table(STORES.MENU)
        .where('activeStockStatus')
        .equals(1)
        .toArray();
      expect(activeProducts).toHaveLength(1);

      // Simular deducción de venta
      await db.table(STORES.MENU).update(productId, { stock: 0 });

      // Verificar que desaparece del índice
      activeProducts = await db.table(STORES.MENU)
        .where('activeStockStatus')
        .equals(1)
        .toArray();
      expect(activeProducts).toHaveLength(0);

      // Restaurar stock vía cancelación
      const items = [{
        id: 'sale-item-001',
        parentId: productId,
        quantity: 1,
        stockDeducted: 1
      }];

      const result = await productsRepository.restoreStockFromCancellation(items);

      expect(result.restored).toHaveLength(1);
      expect(result.restored[0].type).toBe('product');
      expect(result.restored[0].newStock).toBe(1);

      // Verificar que vuelve a aparecer en el índice (activeStockStatus=1)
      activeProducts = await db.table(STORES.MENU)
        .where('activeStockStatus')
        .equals(1)
        .toArray();
      expect(activeProducts).toHaveLength(1);
      expect(activeProducts[0].id).toBe(productId);
    });

    it('debe restaurar stock de lotes y sincronizar producto padre', async () => {
      const productId = 'prod-batch-parent-001';
      const batchId = 'batch-001';

      // Setup: Producto padre con lote
      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Producto con Lotes',
        name_lower: 'producto con lotes',
        stock: 5,
        isActive: true,
        hasBatches: true,
        createdAt: new Date().toISOString()
      });

      await db.table(STORES.PRODUCT_BATCHES).put({
        id: batchId,
        productId: productId,
        sku: 'BATCH-SKU-001',
        stock: 5,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Simular deducción de venta con lotes
      await db.table(STORES.PRODUCT_BATCHES).update(batchId, { stock: 0, isActive: false });
      await db.table(STORES.MENU).update(productId, { stock: 0 });

      // Restaurar stock vía cancelación
      const items = [{
        id: 'sale-item-002',
        parentId: productId,
        batchesUsed: [{
          batchId: batchId,
          quantity: 5,
          productId: productId
        }]
      }];

      const result = await productsRepository.restoreStockFromCancellation(items);

      // Verificar restauración del lote
      const batchRestores = result.restored.filter(r => r.type === 'batch');
      expect(batchRestores).toHaveLength(1);
      expect(batchRestores[0].newStock).toBe(5);

      // Verificar que el lote tiene activeStockStatus=1
      const batch = await db.table(STORES.PRODUCT_BATCHES).get(batchId);
      expect(batch.activeStockStatus).toBe(1);
      expect(batch.isActive).toBe(true);

      // Verificar que el producto padre tiene stock correcto
      const product = await db.table(STORES.MENU).get(productId);
      expect(product.stock).toBe(5);
      expect(product.activeStockStatus).toBe(1);
    });

    it('conserva el costo actual del lote y valora la restauracion con el costo historico', async () => {
      const productId = 'prod-historical-cost-001';
      const batchId = 'batch-historical-cost-001';

      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Producto con costo actualizado',
        name_lower: 'producto con costo actualizado',
        stock: 2,
        isActive: true,
        hasBatches: true,
        createdAt: new Date().toISOString()
      });

      await db.table(STORES.PRODUCT_BATCHES).put({
        id: batchId,
        productId,
        stock: 2,
        cost: 15,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      const result = await productsRepository.restoreStockFromCancellation([{
        id: 'sale-item-historical-cost-001',
        batchesUsed: [{
          batchId,
          quantity: 3,
          cost: 10
        }]
      }]);

      const restoredBatch = await db.table(STORES.PRODUCT_BATCHES).get(batchId);

      expect(restoredBatch.stock).toBe(5);
      expect(restoredBatch.cost).toBe(15);
      expect(result.restoredInventoryValue).toBe(30);
      expect(result.restored.find(entry => entry.type === 'batch')?.restorationValue).toBe(30);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITERIO 4: Consistencia de Índices
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Consistencia de Índices - [categoryId+activeStockStatus]', () => {
    it('debe mantener consistencia del índice compuesto tras cancelación', async () => {
      const categoryId = 'cat-test-001';
      const productId = 'prod-index-001';

      // Crear producto en categoría
      await db.table(STORES.MENU).put({
        id: productId,
        name: 'Producto Indexado',
        name_lower: 'producto indexado',
        categoryId: categoryId,
        stock: 10,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Verificar que aparece en consulta por índice compuesto
      let productsInCategory = await db.table(STORES.MENU)
        .where('[categoryId+activeStockStatus]')
        .equals([categoryId, 1])
        .toArray();
      expect(productsInCategory).toHaveLength(1);

      // Reducir stock a 0
      await db.table(STORES.MENU).update(productId, { stock: 0 });

      // Verificar que desaparece del índice (activeStockStatus=0)
      productsInCategory = await db.table(STORES.MENU)
        .where('[categoryId+activeStockStatus]')
        .equals([categoryId, 1])
        .toArray();
      expect(productsInCategory).toHaveLength(0);

      // Restaurar stock vía cancelación
      await productsRepository.restoreStockFromCancellation([{
        id: 'sale-item-003',
        parentId: productId,
        quantity: 10,
        stockDeducted: 10
      }]);

      // Verificar que vuelve a aparecer (activeStockStatus=1)
      productsInCategory = await db.table(STORES.MENU)
        .where('[categoryId+activeStockStatus]')
        .equals([categoryId, 1])
        .toArray();
      expect(productsInCategory).toHaveLength(1);
      expect(productsInCategory[0].id).toBe(productId);
    });
  });
});

/**
 * Notas de implementación:
 *
 * 1. Para ejecutar estos tests:
 *    npm test src/services/db/__tests__/motorInvariante.test.js
 *
 * 2. Los tests usan una base de datos Dexie real en memoria (mock)
 *    para garantizar que los hooks se disparen correctamente.
 *
 * 3. Si algún test falla, verificar:
 *    - Que los hooks en dexie.js estén registrados correctamente
 *    - Que saveDataSafe tenga la guardia implementada
 *    - Que restoreStockFromCancellation use db.table().put() (no update parcial)
 */
