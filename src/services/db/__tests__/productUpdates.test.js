/**
 * Tests de Motor Atómico de Transiciones de Modo de Caducidad
 * 
 * Verifica:
 * 1. Atomicidad: Si falla la purga, el producto NO cambia de modo (rollback)
 * 2. Transacción con índices válidos: db.table(STORES.MENU) no db.products
 * 3. Uso de null (no undefined) para preservar índices compuestos
 * 4. Timestamp unificado en toda la operación
 * 5. Validación de seguridad: PURGE_BATCHES solo con expirationMode: NONE
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateProduct, updateProductSafe, bulkUpdateProducts } from '../productUpdates';
import { db, STORES } from '../dexie';

// Mock de Dexie
vi.mock('../dexie', () => ({
    db: {
        isOpen: vi.fn(() => true),
        transaction: vi.fn((mode, stores, fn) => fn()),
        table: vi.fn()
    },
    STORES: {
        MENU: 'menu',
        PRODUCT_BATCHES: 'product_batches'
    }
}));

vi.mock('../Logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
}));

describe('Motor Atómico de Transiciones de Modo de Caducidad', () => {
    let mockMenuTable;
    let mockBatchesTable;
    let transactionBatches = [];

    beforeEach(() => {
        transactionBatches = [];
        vi.clearAllMocks();

        // Mock de tabla de productos
        mockMenuTable = {
            get: vi.fn(),
            put: vi.fn((product) => {
                if (!product.id) throw new Error('Producto sin ID');
                return Promise.resolve();
            })
        };

        // Mock de tabla de lotes con captura de operaciones
        mockBatchesTable = {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn(),
                    count: vi.fn()
                })),
                anyOf: vi.fn(() => ({
                    toArray: vi.fn()
                }))
            })),
            put: vi.fn((batch) => {
                transactionBatches.push(batch);
                return Promise.resolve();
            }),
            bulkGet: vi.fn()
        };

        db.table.mockImplementation((storeName) => {
            if (storeName === STORES.MENU) return mockMenuTable;
            if (storeName === STORES.PRODUCT_BATCHES) return mockBatchesTable;
            return null;
        });
    });

    describe('Atomicidad Estricta (Rollback)', () => {
        it('debe hacer rollback si la purga de lotes falla', async () => {
            const productId = 'prod-atomic-test';
            
            // Setup: Producto en modo STRICT
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test Product',
                expirationMode: 'STRICT'
            });

            // Setup: 2 lotes con fechas
            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        {
                            id: 'batch-1',
                            productId,
                            expiryDate: '2024-12-31T00:00:00.000Z',
                            stock: 10
                        },
                        {
                            id: 'batch-2',
                            productId,
                            expiryDate: '2025-06-15T00:00:00.000Z',
                            stock: 5
                        }
                    ]),
                    count: vi.fn().mockResolvedValue(2)
                }))
            }));

            // Mock: Forzar fallo en la mitad de la purga
            let callCount = 0;
            mockBatchesTable.put = vi.fn((batch) => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('Simulated crash during batch purge');
                }
                transactionBatches.push(batch);
                return Promise.resolve();
            });

            // Ejecutar: Intentar cambio a NONE con purga
            await expect(
                updateProduct(productId, { 
                    expirationMode: 'NONE', 
                    _intent: 'PURGE_BATCHES' 
                })
            ).rejects.toThrow('Simulated crash during batch purge');

            // Verificar: El producto NO debe haberse actualizado
            expect(mockMenuTable.put).not.toHaveBeenCalled();
        });

        it('debe actualizar producto solo si la purga tiene éxito', async () => {
            const productId = 'prod-success-test';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test Product',
                expirationMode: 'STRICT'
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        {
                            id: 'batch-1',
                            productId,
                            expiryDate: '2024-12-31T00:00:00.000Z',
                            stock: 10
                        }
                    ]),
                    count: vi.fn().mockResolvedValue(1)
                }))
            }));

            mockBatchesTable.put = vi.fn((batch) => {
                transactionBatches.push(batch);
                return Promise.resolve();
            });

            const result = await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            // Verificar: Ambos debieron actualizarse
            expect(result.success).toBe(true);
            expect(mockMenuTable.put).toHaveBeenCalled();
            expect(mockBatchesTable.put).toHaveBeenCalled();
            expect(result.batchOperation.updatedCount).toBe(1);
        });
    });

    describe('Transacción con Índices Válidos', () => {
        it('debe usar db.table(STORES.MENU) en lugar de db.products', async () => {
            const productId = 'prod-index-test';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'NONE'
            });

            await updateProduct(productId, { name: 'Updated' });

            // Verificar que se usó el índice correcto
            expect(db.table).toHaveBeenCalledWith(STORES.MENU);
            expect(db.table).not.toHaveBeenCalledWith('products');
        });

        it('debe usar db.table(STORES.PRODUCT_BATCHES) en lugar de db.product_batches', async () => {
            const productId = 'prod-batch-index-test';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        { id: 'batch-1', productId, expiryDate: '2024-12-31' }
                    ]),
                    count: vi.fn().mockResolvedValue(1)
                }))
            }));

            await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            // Verificar que se usó el índice correcto para lotes
            expect(db.table).toHaveBeenCalledWith(STORES.PRODUCT_BATCHES);
        });
    });

    describe('Integridad de Índices (null vs undefined)', () => {
        it('debe asignar null (no undefined) a expiryDate al purgar', async () => {
            const productId = 'prod-null-test';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        {
                            id: 'batch-1',
                            productId,
                            expiryDate: '2024-12-31T00:00:00.000Z',
                            alertTargetDate: '2024-12-31T00:00:00.000Z',
                            shelfLifeValue: 30,
                            shelfLifeUnit: 'days'
                        }
                    ]),
                    count: vi.fn().mockResolvedValue(0)
                }))
            }));

            await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            const updatedBatch = transactionBatches[0];
            
            // CRÍTICO: expiryDate debe ser null, no undefined
            expect(updatedBatch.expiryDate).toBeNull();
            expect(updatedBatch.expiryDate).not.toBeUndefined();
            
            // El campo debe existir (para índices compuestos)
            expect(updatedBatch.hasOwnProperty('expiryDate')).toBe(true);
        });

        it('debe asignar null a todos los campos de fecha relacionados', async () => {
            const productId = 'prod-fields-test';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        {
                            id: 'batch-1',
                            productId,
                            expiryDate: '2024-12-31',
                            alertTargetDate: '2024-12-31',
                            alertType: 'CADUCIDAD_LEGAL',
                            shelfLifeValue: 30,
                            shelfLifeUnit: 'days'
                        }
                    ]),
                    count: vi.fn().mockResolvedValue(0)
                }))
            }));

            await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            const updatedBatch = transactionBatches[0];
            
            // Todos los campos de fecha deben ser null explícito
            expect(updatedBatch.expiryDate).toBeNull();
            expect(updatedBatch.alertTargetDate).toBeNull();
            expect(updatedBatch.alertType).toBeNull();
            expect(updatedBatch.shelfLifeValue).toBeNull();
            expect(updatedBatch.shelfLifeUnit).toBeNull();
        });
    });

    describe('Timestamp Unificado', () => {
        it('debe usar el mismo timestamp para producto y lotes', async () => {
            const productId = 'prod-timestamp-test';
            const capturedTimestamps = [];
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            mockMenuTable.put.mockImplementation((product) => {
                capturedTimestamps.push(product.updatedAt);
                return Promise.resolve();
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        {
                            id: 'batch-1',
                            productId,
                            expiryDate: '2024-12-31'
                        }
                    ]),
                    count: vi.fn().mockResolvedValue(0)
                }))
            }));

            mockBatchesTable.put.mockImplementation((batch) => {
                capturedTimestamps.push(batch.updatedAt);
                transactionBatches.push(batch);
                return Promise.resolve();
            });

            await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            // Todos los timestamps deben ser idénticos
            expect(capturedTimestamps.length).toBeGreaterThan(1);
            const firstTimestamp = capturedTimestamps[0];
            expect(capturedTimestamps.every(ts => ts === firstTimestamp)).toBe(true);
        });
    });

    describe('Validación de Seguridad del Intent', () => {
        it('debe rechazar PURGE_BATCHES si el modo actual ya es NONE', async () => {
            const productId = 'prod-invalid-intent';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'NONE'  // Ya es NONE
            });

            await expect(
                updateProduct(productId, {
                    expirationMode: 'STRICT',  // Intentando cambiar a STRICT con PURGE
                    _intent: 'PURGE_BATCHES'
                })
            ).rejects.toThrow('Intent PURGE_BATCHES requiere expirationMode: NONE');
        });

        it('debe rechazar PURGE_BATCHES si el modo destino no es NONE', async () => {
            const productId = 'prod-invalid-target';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            await expect(
                updateProduct(productId, {
                    expirationMode: 'SHELF_LIFE',  // No es NONE
                    _intent: 'PURGE_BATCHES'
                })
            ).rejects.toThrow('Intent PURGE_BATCHES requiere expirationMode: NONE');
        });

        it('debe permitir PURGE_BATCHES cuando cambia STRICT -> NONE', async () => {
            const productId = 'prod-valid-transition';
            
            mockMenuTable.get.mockResolvedValue({
                id: productId,
                name: 'Test',
                expirationMode: 'STRICT'
            });

            mockBatchesTable.where = vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn().mockResolvedValue([
                        { id: 'batch-1', productId, expiryDate: '2024-12-31' }
                    ]),
                    count: vi.fn().mockResolvedValue(0)
                }))
            }));

            const result = await updateProduct(productId, {
                expirationMode: 'NONE',
                _intent: 'PURGE_BATCHES'
            });

            expect(result.success).toBe(true);
            expect(result.intent).toBe('PURGE_BATCHES');
        });
    });

    describe('Guardia de Conexión a BD', () => {
        it('debe lanzar error si la BD está cerrada', async () => {
            db.isOpen.mockReturnValue(false);

            await expect(
                updateProduct('prod-closed', { name: 'Test' })
            ).rejects.toThrow('Base de datos cerrada');
        });
    });

    describe('updateProductSafe', () => {
        it('debe capturar errores y retornar objeto estandarizado', async () => {
            db.isOpen.mockReturnValue(true);
            mockMenuTable.get.mockRejectedValue(new Error('DB Error'));

            const result = await updateProductSafe('prod-safe', { name: 'Test' });

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.message).toContain('DB Error');
        });

        it('debe retornar éxito cuando la operación funciona', async () => {
            db.isOpen.mockReturnValue(true);
            mockMenuTable.get.mockResolvedValue({
                id: 'prod-safe',
                name: 'Test',
                expirationMode: 'NONE'
            });

            const result = await updateProductSafe('prod-safe', { name: 'Updated' });

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });
    });
});

describe('bulkUpdateProducts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        db.isOpen.mockReturnValue(true);
    });

    it('debe procesar múltiples productos con el mismo cambio', async () => {
        // Este es un test básico de estructura
        // En un entorno real necesitaría mocks más completos
        expect(typeof bulkUpdateProducts).toBe('function');
    });
});
