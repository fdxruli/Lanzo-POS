/**
 * EJEMPLO DE INTEGRACIÓN: saleGuard en tu salesService.js
 * 
 * INSTRUCCIONES:
 * 1. Abre tu archivo src/services/salesService.js
 * 2. Encuentra la función que crea/guarda ventas (normalmente: createSale, addSale, checkoutSale)
 * 3. Reemplaza el patrón ANTES de guardar en Dexie
 * 4. Adapta los nombres de funciones según tu código actual
 */

import { db, STORES } from './db/dexie';
import { saleGuard } from './saleGuard';
import { showMessage } from '../store/useMessageStore';
import Logger from './Logger';

/**
 * ====== PATRÓN 1: BLOQUEO ESTRICTO (RECOMENDADO) ======
 * 
 * Uso: Si quieres que NADA se guarde si la cuota es crítica
 * Ideal para: POS crítico donde los datos son irreemplazables
 */
export const createSaleWithPersistenceCheck = async (saleData) => {
  // ✅ PASO 1: Validar estado de almacenamiento
  const validation = await saleGuard.validate();

  // ✅ PASO 2: Si está crítico → RECHAZAR
  if (!validation.allowed) {
    const errorMsg = `❌ VENTA RECHAZADA: ${validation.reason}`;
    Logger.error(errorMsg);
    
    showMessage(errorMsg, 'error', {
      duration: 5000,
      persistent: true,
    });
    
    throw new Error(validation.reason);
  }

  // ✅ PASO 3: Si hay advertencia → INFORMAR (pero permitir)
  if (validation.reason) {
    Logger.warn(`⚠️ Venta permitida con advertencia: ${validation.reason}`);
    showMessage(validation.reason, 'warning', { duration: 3000 });
  }

  // ✅ PASO 4: Proceder con la venta normalmente
  try {
    const saleRecord = {
      ...saleData,
      timestamp: Date.now(),
      // ... otros campos que necesites
    };

    // Guardar en Dexie
    await db.table(STORES.SALES).add(saleRecord);

    Logger.info('✅ Venta guardada exitosamente en Dexie', {
      saleId: saleRecord.id,
      storageUsage: (await saleGuard.validateSpace()).quotaPercent,
    });

    return saleRecord;
  } catch (err) {
    Logger.error('Error guardando venta en Dexie:', err);
    showMessage('Error al guardar la venta. Intenta de nuevo.', 'error');
    throw err;
  }
};

/**
 * ====== PATRÓN 2: CON CONFIRMACIÓN DEL USUARIO ======
 * 
 * Uso: Si quieres dar opción al usuario de confirmar en advertencia
 * Ideal para: UX menos invasivo pero controlado
 */
export const createSaleWithUserConfirmation = async (saleData, confirmDialogFn) => {
  // ✅ PASO 1: Obtener advertencias
  const warnings = await saleGuard.promptIfWarning();

  // ✅ PASO 2: Si hay problemas críticos → BLOQUEAR SIEMPRE
  const criticalWarnings = warnings.filter(w => w.type === 'critical');
  if (criticalWarnings.length > 0) {
    const message = criticalWarnings.map(w => w.message).join('\n\n');
    Logger.error('Venta bloqueada por almacenamiento crítico:', message);
    
    showMessage(message, 'error', {
      persistent: true,
      duration: 0, // No desaparece automáticamente
    });
    
    throw new Error('CRITICAL_STORAGE_CONDITION');
  }

  // ✅ PASO 3: Si hay advertencias no-críticas → Pedir confirmación
  const normalWarnings = warnings.filter(w => w.type === 'warning');
  if (normalWarnings.length > 0) {
    const message = normalWarnings.map(w => w.message).join('\n\n');
    
    const userConfirmed = await confirmDialogFn({
      title: '⚠️ Advertencia de Almacenamiento',
      message,
      confirmText: 'Continuar con venta',
      cancelText: 'Cancelar',
      severity: 'warning',
    });

    if (!userConfirmed) {
      Logger.info('Usuario canceló venta por advertencia de almacenamiento');
      throw new Error('USER_CANCELLED');
    }

    Logger.warn('Usuario confirmó venta a pesar de advertencia');
  }

  // ✅ PASO 4: Proceder normalmente
  return createSaleWithPersistenceCheck(saleData);
};

/**
 * ====== PATRÓN 3: CON SINCRONIZACIÓN AUTOMÁTICA ======
 * 
 * Uso: Si detectas modo volátil, sincronizar inmediatamente
 * Ideal para: Máxima seguridad - no dejar datos locales solos
 */
export const createSaleWithAutoSync = async (saleData, syncFn) => {
  // ✅ PASO 1: Crear venta con validación
  const saleRecord = await createSaleWithPersistenceCheck(saleData);

  // ✅ PASO 2: Verificar si estamos en modo volátil
  const spaceValidation = await saleGuard.validateSpace();
  if (spaceValidation.quotaPercent > 75) {
    Logger.warn('Almacenamiento > 75%, sincronizando automáticamente...');
    
    try {
      await syncFn();
      Logger.info('✅ Sincronización automática completada');
    } catch (syncErr) {
      Logger.error('Error en sincronización automática (venta guardada localmente):', syncErr);
      showMessage('Venta guardada, pero sincronización falló. Sincroniza manualmente después.', 'warning');
    }
  }

  return saleRecord;
};

/**
 * ====== PATRÓN 4: PARA VENTAS EN LOTE ======
 * 
 * Uso: Si procesas múltiples ventas (ej: importación, cierre de caja)
 * Ideal para: Máxima robustez con reintentos
 */
export const createSalesInBatch = async (salesDataArray) => {
  // ✅ Validar una sola vez para toda la tanda
  const validation = await saleGuard.validate();
  if (!validation.allowed) {
    throw new Error(`Batch rechazado: ${validation.reason}`);
  }

  const results = {
    successful: [],
    failed: [],
  };

  for (const saleData of salesDataArray) {
    try {
      // Validar espacio disponible para CADA venta
      const spaceCheck = await saleGuard.validateSpace();
      if (!spaceCheck.hasSufficientSpace) {
        results.failed.push({
          sale: saleData,
          error: 'Espacio insuficiente en almacenamiento',
          availableSpace: spaceCheck.availableSpace,
        });
        continue;
      }

      // Guardar venta
      const saleRecord = {
        ...saleData,
        timestamp: Date.now(),
      };
      await db.table(STORES.SALES).add(saleRecord);
      results.successful.push(saleRecord);

      Logger.debug(`✓ Venta guardada [${results.successful.length}/${salesDataArray.length}]`);
    } catch (err) {
      Logger.error('Error en venta del batch:', err);
      results.failed.push({
        sale: saleData,
        error: err.message,
      });
    }

    // Verificar cuota después de cada venta importante
    if (results.successful.length % 10 === 0) {
      Logger.info(`Batch progress: ${results.successful.length} exitosas, ${results.failed.length} fallidas`);
    }
  }

  // Reporte final
  Logger.info(`Batch completado: ${results.successful.length} exitosas, ${results.failed.length} fallidas`);
  
  if (results.failed.length > 0) {
    showMessage(
      `⚠️ ${results.failed.length} de ${salesDataArray.length} ventas fallaron. Verifica el almacenamiento.`,
      'warning'
    );
  }

  return results;
};

/**
 * ====== CÓMO USAR EN TU CÓDIGO ======
 * 
 * En tu componente PosPage.jsx o similar:
 * 
 * ```jsx
 * import { createSaleWithPersistenceCheck } from '../services/salesService';
 * 
 * const handleCheckout = async () => {
 *   try {
 *     const saleData = {
 *       id: generateID(),
 *       items: cartItems,
 *       total: cartTotal,
 *       customerId: selectedCustomer?.id,
 *       // ... otros campos
 *     };
 *     
 *     // Usar en lugar de tu función anterior
 *     const result = await createSaleWithPersistenceCheck(saleData);
 *     
 *     showMessage('✅ Venta cobrada exitosamente', 'success');
 *     resetCart();
 *   } catch (err) {
 *     // El error ya fue mostrado por showMessage() en la función
 *     Logger.error('Checkout fallido:', err);
 *   }
 * };
 * ```
 */

/**
 * ====== DEBUGGING EN CONSOLA ======
 * 
 * Prueba estos comandos en la consola del navegador:
 * 
 * // Ver estado actual
 * import { saleGuard } from './src/services/saleGuard';
 * await saleGuard.debugState();
 * 
 * // Simular una venta
 * const testSale = { id: 'test-1', items: [], total: 100 };
 * await createSaleWithPersistenceCheck(testSale);
 * 
 * // Ver cuota
 * const space = await saleGuard.validateSpace();
 * console.log(`Available: ${space.availableSpace} bytes`);
 */
