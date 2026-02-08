import React, { useState } from 'react';
import { 
    initDB, 
    saveData, 
    loadData, 
    deleteData, 
    saveBatchAndSyncProduct, 
    processBatchDeductions, 
    executeSaleTransactionSafe,
    STORES 
} from '../../services/db/index';

const DbMigrationTester = () => {
    const [logs, setLogs] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);

    // Identificadores para los datos de prueba
    const TEST_IDS = {
        CUSTOMER: 'TEST_AUTO_CUSTOMER_001',
        PRODUCT: 'TEST_AUTO_PRODUCT_001',
        BATCH_OLD: 'TEST_AUTO_BATCH_OLD',
        BATCH_NEW: 'TEST_AUTO_BATCH_NEW',
        SALE: 'TEST_AUTO_SALE_001'
    };

    // Helper para agregar logs
    const addLog = (message, type = 'info', detail = null) => {
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), message, type, detail }]);
        setTimeout(() => {
            const el = document.getElementById('log-container');
            if(el) el.scrollTop = el.scrollHeight;
        }, 50);
    };

    const assert = (condition, successMsg, failMsg) => {
        if (condition) {
            addLog(`✅ ${successMsg}`, 'success');
            return true;
        } else {
            addLog(`❌ FALLÓ: ${failMsg}`, 'error');
            throw new Error(failMsg);
        }
    };

    // --- NUEVA FUNCIÓN DE LIMPIEZA ROBUSTA ---
    const cleanEnvironment = async () => {
        addLog("🧹 Limpiando entorno de pruebas anterior...", 'info');
        try {
            await deleteData(STORES.CUSTOMERS, TEST_IDS.CUSTOMER);
            await deleteData(STORES.MENU, TEST_IDS.PRODUCT);
            // Borramos lotes individualmente por si acaso
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_OLD);
            await deleteData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_NEW);
            // Importante: Borrar la venta zombie que causó el error
            await deleteData(STORES.SALES, TEST_IDS.SALE);
            addLog("✨ Entorno limpio y listo.", 'success');
        } catch (e) {
            console.warn("Error en limpieza (ignorable):", e);
        }
    };

    const runTests = async () => {
        setIsRunning(true);
        setLogs([]);
        setProgress(0);
        
        try {
            await initDB();
            
            // 0. LIMPIEZA PREVENTIVA (Idempotencia)
            // Esto arregla el error "La venta ya fue procesada"
            await cleanEnvironment();

            addLog("🚀 INICIANDO PRUEBAS DE MIGRACIÓN DB...", 'info');
            
            // ============================================================
            // 1. CRUD BÁSICO
            // ============================================================
            addLog("--- 1. TEST CRUD BÁSICO ---", 'info');
            
            const testCustomer = {
                id: TEST_IDS.CUSTOMER,
                name: "Cliente de Prueba Automática",
                phone: "5555555555",
                debt: 0
            };

            await saveData(STORES.CUSTOMERS, testCustomer);
            const savedCustomer = await loadData(STORES.CUSTOMERS, TEST_IDS.CUSTOMER);
            assert(savedCustomer?.name === testCustomer.name, "Cliente guardado y leído", "Fallo en CRUD Cliente");

            // ============================================================
            // 2. LÓGICA DE PRODUCTOS Y LOTES (FIFO)
            // ============================================================
            addLog("--- 2. TEST PRODUCTOS Y LOTES (FIFO) ---", 'info');
            setProgress(25);

            // 2.1 Crear Producto Padre
            const testProduct = {
                id: TEST_IDS.PRODUCT,
                name: "Producto Test FIFO",
                price: 0,
                cost: 0,
                stock: 0,
                trackStock: true,
                batchManagement: { enabled: true }
            };
            await saveData(STORES.MENU, testProduct);

            // 2.2 Insertar Lote Antiguo
            const batchOld = {
                id: TEST_IDS.BATCH_OLD,
                productId: TEST_IDS.PRODUCT,
                sku: 'SKU_OLD',
                stock: 10,
                cost: 50,
                price: 100,
                createdAt: new Date('2025-01-01').toISOString(),
                isActive: true
            };
            await saveBatchAndSyncProduct(batchOld);

            // 2.3 Insertar Lote Nuevo
            const batchNew = {
                id: TEST_IDS.BATCH_NEW,
                productId: TEST_IDS.PRODUCT,
                sku: 'SKU_NEW',
                stock: 10,
                cost: 200,
                price: 400,
                createdAt: new Date('2025-02-01').toISOString(),
                isActive: true
            };
            await saveBatchAndSyncProduct(batchNew);

            // 2.4 Verificar Sync Padre
            const syncedProduct = await loadData(STORES.MENU, TEST_IDS.PRODUCT);
            
            assert(syncedProduct.stock === 20, 
                `Stock Padre sincronizado (20)`, 
                `Stock padre incorrecto: ${syncedProduct.stock}`);
            
            assert(syncedProduct.cost === 50, 
                `Costo FIFO respetado ($50)`, 
                `Costo incorrecto: ${syncedProduct.cost}`);

            // ============================================================
            // 3. INTEGRIDAD DE VENTAS
            // ============================================================
            addLog("--- 3. TEST VENTA TRANSACCIONAL ---", 'info');
            setProgress(50);

            const saleData = {
                id: TEST_IDS.SALE,
                total: 500,
                items: [{ id: TEST_IDS.PRODUCT, name: "Producto Test", quantity: 5 }]
            };
            
            const deductions = [{
                batchId: TEST_IDS.BATCH_OLD,
                quantity: 5,
                productId: TEST_IDS.PRODUCT
            }];

            const saleResult = await executeSaleTransactionSafe(saleData, deductions);
            assert(saleResult.success, "Venta ejecutada correctamente", `Error venta: ${saleResult.error?.message}`);

            // Validaciones Post-Venta
            const batchOldAfter = await loadData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_OLD);
            const productAfterSale = await loadData(STORES.MENU, TEST_IDS.PRODUCT);

            assert(batchOldAfter.stock === 5, 
                `Lote descontado (10 -> 5)`, 
                `Stock lote incorrecto: ${batchOldAfter.stock}`);

            assert(productAfterSale.stock === 15, 
                `Padre sincronizado tras venta (20 -> 15)`, 
                `Stock padre incorrecto: ${productAfterSale.stock}`);

            // ============================================================
            // 4. MERMAS Y AJUSTES
            // ============================================================
            addLog("--- 4. TEST MERMAS Y AJUSTES ---", 'info');
            setProgress(75);

            const wasteDeductions = [{
                batchId: TEST_IDS.BATCH_OLD,
                quantity: 2
            }];

            await processBatchDeductions(wasteDeductions);

            const batchOldAfterWaste = await loadData(STORES.PRODUCT_BATCHES, TEST_IDS.BATCH_OLD);
            const productAfterWaste = await loadData(STORES.MENU, TEST_IDS.PRODUCT);

            assert(batchOldAfterWaste.stock === 3, 
                `Lote tras merma (5 -> 3)`, 
                `Stock lote merma incorrecto: ${batchOldAfterWaste.stock}`);

            // ESTE ES EL QUE FALLABA ANTES: Ahora con el fix en products.js debería pasar
            assert(productAfterWaste.stock === 13, 
                `Padre tras merma (15 -> 13)`, 
                `Stock padre merma incorrecto: ${productAfterWaste.stock}`);

            // ============================================================
            // 5. ERRORES Y ZOD
            // ============================================================
            addLog("--- 5. TEST MANEJO DE ERRORES ---", 'info');

            const excessiveDeduction = [{
                batchId: TEST_IDS.BATCH_OLD,
                quantity: 100, 
                productId: TEST_IDS.PRODUCT
            }];

            const errorSale = await executeSaleTransactionSafe(
                { ...saleData, id: 'FAIL_SALE' }, 
                excessiveDeduction
            );

            assert(errorSale.success === false, 
                "Bloqueo venta sin stock OK", 
                "Permitió venta sin stock");

            // ============================================================
            // CLEANUP FINAL
            // ============================================================
            await cleanEnvironment(); // Limpiamos al final también para ser ordenados

            setProgress(100);
            addLog("✨ TODAS LAS PRUEBAS PASARON EXITOSAMENTE", 'success');

        } catch (error) {
            console.error(error);
            addLog(`❌ ERROR FATAL: ${error.message}`, 'error');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'monospace' }}>
            <div style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
                <h2 style={{ margin: 0 }}>🛠️ DB Migration Tester (Dexie v2)</h2>
                <p style={{ color: '#666' }}>Verifica repositorios, consistencia de inventario y transacciones.</p>
            </div>

            <button 
                onClick={runTests} 
                disabled={isRunning}
                style={{
                    padding: '12px 24px',
                    backgroundColor: isRunning ? '#ccc' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    width: '100%'
                }}
            >
                {isRunning ? 'Ejecutando Pruebas...' : '▶ EJECUTAR TEST SUITE'}
            </button>

            <div style={{ width: '100%', height: '8px', backgroundColor: '#e5e7eb', marginTop: '15px', borderRadius: '4px' }}>
                <div style={{ 
                    width: `${progress}%`, 
                    height: '100%', 
                    backgroundColor: progress === 100 ? '#16a34a' : '#3b82f6',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease'
                }} />
            </div>

            <div 
                id="log-container"
                style={{
                    marginTop: '20px',
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: '15px',
                    borderRadius: '8px',
                    height: '400px',
                    overflowY: 'auto',
                    border: '1px solid #333'
                }}
            >
                {logs.length === 0 && <span style={{color: '#666'}}>Listo para iniciar...</span>}
                
                {logs.map(log => (
                    <div key={log.id} style={{ marginBottom: '6px', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#888', minWidth: '80px' }}>
                            {new Date(log.id).toLocaleTimeString().split(' ')[0]}
                        </span>
                        <span style={{ 
                            color: log.type === 'success' ? '#4ade80' : 
                                   log.type === 'error' ? '#f87171' : '#60a5fa' 
                        }}>
                            {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DbMigrationTester;