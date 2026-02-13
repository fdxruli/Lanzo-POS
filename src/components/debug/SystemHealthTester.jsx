import React, { useState } from 'react';
import { processSale } from '../../services/salesService';
import {
    initDB,
    saveData,
    loadData,
    deleteData,
    saveBatchAndSyncProduct,
    STORES
} from '../../services/db/index';

const SalesSystemTester = () => {
    const [logs, setLogs] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);

    const TEST_IDS = {
        CUSTOMER: 'TEST_SYS_CUSTOMER',
        ING_HARINA: 'TEST_SYS_ING_HARINA',
        ING_TOMATE: 'TEST_SYS_ING_TOMATE',
        ING_QUESO: 'TEST_SYS_ING_QUESO',
        PROD_PIZZA: 'TEST_SYS_PROD_PIZZA',
        PROD_MEDICINA: 'TEST_SYS_PROD_MEDICINA',
        PROD_GENERICO: 'TEST_SYS_PROD_GENERICO',
        BATCH_HARINA_OLD: 'TEST_SYS_BATCH_HARINA_OLD',
        BATCH_HARINA_NEW: 'TEST_SYS_BATCH_HARINA_NEW',
        BATCH_TOMATE: 'TEST_SYS_BATCH_TOMATE',
        BATCH_MED: 'TEST_SYS_BATCH_MED'
    };

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), message, type }]);
        const el = document.getElementById('sales-test-log');
        if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 50);
    };

    const assert = (condition, successMsg, failMsg) => {
        if (condition) {
            addLog(`✅ ${successMsg}`, 'success');
            return true;
        } else {
            addLog(`❌ FALLO: ${failMsg}`, 'error');
            throw new Error(failMsg);
        }
    };

    const cleanEnvironment = async () => {
        addLog("🧹 Limpiando datos de prueba anteriores...", 'info');
        try {
            await deleteData(STORES.CUSTOMERS, TEST_IDS.CUSTOMER);
            await deleteData(STORES.MENU, TEST_IDS.ING_HARINA);
            await deleteData(STORES.MENU, TEST_IDS.ING_TOMATE);
            await deleteData(STORES.MENU, TEST_IDS.ING_QUESO);
            await deleteData(STORES.MENU, TEST_IDS.PROD_PIZZA);
            await deleteData(STORES.MENU, TEST_IDS.PROD_MEDICINA);
            await deleteData(STORES.MENU, TEST_IDS.PROD_GENERICO);
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_HARINA_OLD);
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_HARINA_NEW);
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_TOMATE);
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_MED);
        } catch (e) {
            console.warn("Limpieza no crítica:", e);
        }
    };

    const runSystemCheck = async () => {
        setIsRunning(true);
        setLogs([]);
        setProgress(0);

        try {
            await initDB();
            await cleanEnvironment();

            addLog("🚀 INICIANDO TEST COMPLETO DEL SISTEMA DE VENTAS...", 'info');

            // ═══════════════════════════════════════════════════════════
            // 1. CONFIGURACIÓN DE ECOSISTEMA
            // ═══════════════════════════════════════════════════════════
            addLog("--- 1. CONFIGURACIÓN DE DATOS MAESTROS ---", 'info');

            // Ingredientes
            await saveData(STORES.MENU, {
                id: TEST_IDS.ING_HARINA,
                name: "Harina Test",
                trackStock: true,
                price: 0,
                cost: 10,
                stock: 0,
                batchManagement: { enabled: true }
            });
            await saveData(STORES.MENU, {
                id: TEST_IDS.ING_TOMATE,
                name: "Tomate Test",
                trackStock: true,
                price: 0,
                cost: 5,
                stock: 0,
                batchManagement: { enabled: true }
            });
            await saveData(STORES.MENU, {
                id: TEST_IDS.ING_QUESO,
                name: "Queso Test (SERÁ ELIMINADO)",
                trackStock: true,
                price: 0,
                cost: 8,
                stock: 0,
                batchManagement: { enabled: true }
            });

            // Lotes para probar FIFO (Harina con 2 lotes de diferentes precios)
            await saveBatchAndSyncProduct({
                id: TEST_IDS.BATCH_HARINA_OLD,
                productId: TEST_IDS.ING_HARINA,
                stock: 50,
                cost: 10,
                price: 20,
                createdAt: '2025-01-01T00:00:00Z',
                isActive: true
            });
            await saveBatchAndSyncProduct({
                id: TEST_IDS.BATCH_HARINA_NEW,
                productId: TEST_IDS.ING_HARINA,
                stock: 50,
                cost: 15,
                price: 25,
                createdAt: '2025-02-01T00:00:00Z',
                isActive: true
            });

            await saveBatchAndSyncProduct({
                id: TEST_IDS.BATCH_TOMATE,
                productId: TEST_IDS.ING_TOMATE,
                stock: 50,
                cost: 5,
                isActive: true
            });

            // Producto Compuesto (Pizza)
            const pizzaProd = {
                id: TEST_IDS.PROD_PIZZA,
                name: "Pizza Especial Test",
                price: 100,
                cost: 0,
                trackStock: false,
                recipe: [
                    { ingredientId: TEST_IDS.ING_HARINA, quantity: 2 },
                    { ingredientId: TEST_IDS.ING_TOMATE, quantity: 1 }
                ]
            };
            await saveData(STORES.MENU, pizzaProd);

            // Producto Controlado (Farmacia)
            const medProd = {
                id: TEST_IDS.PROD_MEDICINA,
                name: "Antibiótico Controlado",
                price: 200,
                cost: 50,
                trackStock: true,
                requiresPrescription: true,
                stock: 0,
                batchManagement: { enabled: true }
            };
            await saveData(STORES.MENU, medProd);
            await saveBatchAndSyncProduct({
                id: TEST_IDS.BATCH_MED,
                productId: TEST_IDS.PROD_MEDICINA,
                stock: 10,
                cost: 50,
                isActive: true
            });

            // Producto Genérico (Sin lotes, stock directo)
            await saveData(STORES.MENU, {
                id: TEST_IDS.PROD_GENERICO,
                name: "Producto Genérico",
                price: 50,
                cost: 20,
                trackStock: true,
                stock: 100,
                batchManagement: { enabled: false }
            });

            addLog("📦 Datos maestros creados correctamente.", 'success');
            setProgress(20);

            // ═══════════════════════════════════════════════════════════
            // 2. TEST DE VALIDACIONES DE NEGOCIO
            // ═══════════════════════════════════════════════════════════
            addLog("--- 2. TEST VALIDACIONES DE NEGOCIO ---", 'info');

            const allProducts = [
                await loadData(STORES.MENU, TEST_IDS.ING_HARINA),
                await loadData(STORES.MENU, TEST_IDS.ING_TOMATE),
                await loadData(STORES.MENU, TEST_IDS.ING_QUESO),
                await loadData(STORES.MENU, TEST_IDS.PROD_PIZZA),
                await loadData(STORES.MENU, TEST_IDS.PROD_MEDICINA),
                await loadData(STORES.MENU, TEST_IDS.PROD_GENERICO)
            ];

            // 2.1 Bloqueo de antibiótico sin receta
            const resultBlocked = await processSale({
                order: [{ id: TEST_IDS.PROD_MEDICINA, quantity: 1, price: 200 }],
                paymentData: { amountPaid: 200, paymentMethod: 'cash' },
                total: 200,
                allProducts,
                features: { hasLabFields: true },
                companyName: "Test Lab"
            });

            assert(resultBlocked.success === false,
                "Bloqueo de antibiótico s/receta funcionó correctamente",
                "ERROR GRAVE: Se permitió vender controlado sin receta");

            // 2.2 Stock Insuficiente (Pizza: 60 * 1 Tomate = 60 Tomates, solo hay 50)
            const resultStock = await processSale({
                order: [{ id: TEST_IDS.PROD_PIZZA, quantity: 60, price: 100 }],
                paymentData: { amountPaid: 6000, paymentMethod: 'cash' },
                total: 6000,
                allProducts,
                features: { hasRecipes: true }
            });

            assert(resultStock.success === false && resultStock.errorType === 'STOCK_WARNING',
                "Validación de Stock Insuficiente correcta",
                "ERROR: El sistema permitió vender sin stock");

            setProgress(40);

            // ═══════════════════════════════════════════════════════════
            // 3. TEST DE SEGURIDAD DE PRECIOS
            // ═══════════════════════════════════════════════════════════
            addLog("--- 3. TEST SEGURIDAD DE PRECIOS (Anti-Manipulación) ---", 'info');

            const resultPriceTampering = await processSale({
                order: [{
                    id: TEST_IDS.PROD_GENERICO,
                    quantity: 1,
                    price: 1 // ⚠️ Precio manipulado (real es 50)
                }],
                paymentData: { amountPaid: 1, paymentMethod: 'cash' },
                total: 1,
                allProducts,
                features: {}
            });

            assert(resultPriceTampering.success === false,
                "Sistema bloqueó venta con precio manipulado",
                "ERROR CRÍTICO DE SEGURIDAD: Se permitió venta con precio falso");

            setProgress(55);

            // ═══════════════════════════════════════════════════════════
            // 4. ✅ CORREGIDO: TEST FIFO (Lotes en orden correcto)
            // ═══════════════════════════════════════════════════════════
            addLog("--- 4. TEST DEDUCCIÓN FIFO DE LOTES ---", 'info');

            // 🔧 CORRECCIÓN: Eliminado parentId y agregado selectedModifiers
            const fifoSale = await processSale({
                order: [{
                    id: TEST_IDS.PROD_PIZZA,
                    // parentId: TEST_IDS.PROD_PIZZA,  ← ELIMINADO
                    quantity: 10,
                    price: 100,
                    selectedModifiers: []  // ← AGREGADO
                }],
                paymentData: {
                    customerId: 'GENERIC',
                    paymentMethod: 'cash',
                    amountPaid: 1000,
                    saldoPendiente: 0
                },
                total: 1000,
                allProducts,
                features: { hasRecipes: true },
                companyName: "Test"
            });

            assert(fifoSale.success === true,
                "Venta FIFO procesada exitosamente",
                `Fallo en venta FIFO: ${fifoSale.message}`);

            // Verificar que el lote VIEJO se descontó primero
            const batchOldAfter = await loadData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_HARINA_OLD);
            const batchNewAfter = await loadData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_HARINA_NEW);

            assert(batchOldAfter.stock === 30,
                `Lote viejo descontado correctamente FIFO (50 -> 30)`,
                `Error FIFO en lote viejo. Esperado: 30, Actual: ${batchOldAfter.stock}`);

            assert(batchNewAfter.stock === 50,
                `Lote nuevo intacto (no se tocó porque aún hay stock del viejo)`,
                `Error: Se usó el lote nuevo antes que el viejo (stock: ${batchNewAfter.stock})`);

            setProgress(70);

            // ═══════════════════════════════════════════════════════════
            // 5. TEST INGREDIENTE ELIMINADO (FANTASMA)
            // ═══════════════════════════════════════════════════════════
            addLog("--- 5. TEST INGREDIENTE ELIMINADO (FANTASMA) ---", 'info');

            const pizzaConQueso = await loadData(STORES.MENU, TEST_IDS.PROD_PIZZA);
            pizzaConQueso.recipe.push({ ingredientId: TEST_IDS.ING_QUESO, quantity: 1 });
            await saveData(STORES.MENU, pizzaConQueso);

            await deleteData(STORES.MENU, TEST_IDS.ING_QUESO);

            const productsAfterDeletion = [
                await loadData(STORES.MENU, TEST_IDS.ING_HARINA),
                await loadData(STORES.MENU, TEST_IDS.ING_TOMATE),
                await loadData(STORES.MENU, TEST_IDS.PROD_PIZZA),
                await loadData(STORES.MENU, TEST_IDS.PROD_MEDICINA),
                await loadData(STORES.MENU, TEST_IDS.PROD_GENERICO)
            ];

            const resultPhantom = await processSale({
                order: [{ id: TEST_IDS.PROD_PIZZA, quantity: 1, price: 100 }],
                paymentData: { amountPaid: 100, paymentMethod: 'cash' },
                total: 100,
                allProducts: productsAfterDeletion,
                features: { hasRecipes: true }
            });

            assert(resultPhantom.success === false && resultPhantom.errorType === 'STOCK_WARNING',
                "Sistema detectó ingrediente eliminado (fantasma)",
                "ERROR CRÍTICO: Se permitió venta con ingrediente inexistente");

            assert(
                resultPhantom.missingData?.some(m => m.ingredientName?.includes('ERROR CRÍTICO')),
                "Mensaje de error identifica ingrediente fantasma",
                "Fallo: No se identificó el ingrediente eliminado"
            );

            setProgress(85);

            // ═══════════════════════════════════════════════════════════
            // 6. VALIDACIÓN DE SINCRONIZACIÓN DE STOCK PADRE
            // ═══════════════════════════════════════════════════════════
            addLog("--- 6. TEST SINCRONIZACIÓN DE STOCK PADRE ---", 'info');

            const harinaFinal = await loadData(STORES.MENU, TEST_IDS.ING_HARINA);
            const expectedHarinaStock = 30 + 50;

            assert(harinaFinal.stock === expectedHarinaStock,
                `Stock padre sincronizado correctamente (${expectedHarinaStock})`,
                `Error en sincronización. Esperado: ${expectedHarinaStock}, Actual: ${harinaFinal.stock}`);

            setProgress(95);

            // ═══════════════════════════════════════════════════════════
            // 7. LIMPIEZA FINAL
            // ═══════════════════════════════════════════════════════════
            await cleanEnvironment();

            setProgress(100);
            addLog("🎉 TODOS LOS TESTS PASARON EXITOSAMENTE", 'success');

        } catch (error) {
            console.error(error);
            addLog(`❌ EXCEPCIÓN NO CONTROLADA: ${error.message}`, 'error');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'monospace' }}>
            <div style={{ marginBottom: '20px', borderBottom: '2px solid #3b82f6', paddingBottom: '15px' }}>
                <h2 style={{ margin: 0, color: '#1e40af' }}>🧪 Sales Service Integration Test (CORREGIDO)</h2>
                <p style={{ color: '#64748b', marginTop: '5px' }}>
                    Verifica: Seguridad de Precios | FIFO | Ingredientes Eliminados | Sincronización de Stock
                </p>
            </div>

            <button
                onClick={runSystemCheck}
                disabled={isRunning}
                style={{
                    padding: '12px 24px',
                    backgroundColor: isRunning ? '#94a3b8' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    width: '100%',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
            >
                {isRunning ? '⚡ Ejecutando Pruebas...' : '▶ EJECUTAR TEST COMPLETO'}
            </button>

            <div style={{
                width: '100%', height: '10px', backgroundColor: '#e2e8f0',
                marginTop: '20px', borderRadius: '5px', overflow: 'hidden'
            }}>
                <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    backgroundColor: progress === 100 ? '#22c55e' : '#3b82f6',
                    transition: 'width 0.4s ease'
                }} />
            </div>

            <div
                id="sales-test-log"
                style={{
                    marginTop: '20px',
                    backgroundColor: '#0f172a',
                    color: '#e2e8f0',
                    padding: '20px',
                    borderRadius: '12px',
                    height: '450px',
                    overflowY: 'auto',
                    border: '1px solid #334155',
                    fontFamily: '"Consolas", "Monaco", monospace',
                    fontSize: '14px'
                }}
            >
                {logs.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', marginTop: '180px' }}>Listo para iniciar diagnóstico...</div>}

                {logs.map(log => (
                    <div key={log.id} style={{ marginBottom: '8px', display: 'flex', gap: '10px' }}>
                        <span style={{ color: '#64748b', minWidth: '85px', fontSize: '12px', paddingTop: '2px' }}>
                            {new Date(log.id).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span style={{
                            color: log.type === 'success' ? '#4ade80' :
                                log.type === 'error' ? '#f87171' : '#bfdbfe',
                            flex: 1
                        }}>
                            {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SalesSystemTester;