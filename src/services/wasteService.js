import { STORES } from './db/dexie';
import { saveDataSafe, processBatchDeductions, saveBatchAndSyncProductSafe } from './db';
import { generateID, roundCurrency } from './utils';
import Logger from './Logger';

/**
 * Registra una merma por caducidad de un lote especifico.
 * Esta funcion:
 * 1. Pone el stock del lote a 0 (sin eliminar el registro historico)
 * 2. Marca isActive: false
 * 3. Registra un waste log con el costo de la perdida
 * 4. Actualiza el inventario valor del producto padre
 * 
 * @param {Object} batch - El lote a mermar
 * @param {Object} product - El producto padre (para contexto)
 * @param {string} notes - Notas adicionales opcionales
 * @returns {Promise<{success: boolean, wasteRecord?: Object, error?: string}>}
 */
export const registerExpirationWaste = async (batch, product, notes = '') => {
  try {
    const batchStock = Number(batch.stock) || 0;
    const batchCost = Number(batch.cost) || 0;
    const totalLoss = roundCurrency(batchStock * batchCost);

    // 1. Registrar el waste log primero (auditoria)
    const wasteRecord = {
      id: generateID('waste'),
      productId: batch.productId,
      productName: product?.name || 'Producto eliminado',
      batchId: batch.id,
      batchSku: batch.sku || 'N/A',
      quantity: batchStock,
      unit: product?.bulkData?.purchase?.unit || 'u',
      costAtTime: batchCost,
      lossAmount: totalLoss,
      reason: 'caducidad',
      notes: `Merma automática por caducidad. Lote: ${batch.sku || batch.id}. ${notes}`,
      expiryDate: batch.expiryDate,
      timestamp: new Date().toISOString()
    };

    const wasteResult = await saveDataSafe(STORES.WASTE, wasteRecord);
    if (!wasteResult.success) {
      throw new Error(`Failed to save waste record: ${wasteResult.message}`);
    }

    // 2. Actualizar el lote: stock a 0, isActive false (sin borrar el registro)
    const updatedBatch = {
      ...batch,
      stock: 0,
      currentStock: 0,
      availableStock: 0,
      activeStockStatus: 0,
      isActive: false,
      status: 'inactive',
      isArchived: true,
      archivedReason: 'Merma por caducidad',
      archivedAt: new Date().toISOString(),
      lastDeductionAt: new Date().toISOString(),
      lastDeductionReason: 'Merma por caducidad',
      updatedAt: new Date().toISOString()
    };

    // 3. Usar el repositorio de productos para actualizar el lote y sincronizar el padre
    const result = await saveBatchAndSyncProductSafe(updatedBatch);
    if (!result.success) {
      throw new Error(result.message || 'Error al sincronizar lote con producto padre');
    }

    Logger.log(`✅ Merma por caducidad registrada: ${batch.sku || batch.id}, Pérdida: $${totalLoss}`);

    return {
      success: true,
      wasteRecord,
      totalLoss,
      batchStock
    };
  } catch (error) {
    Logger.error('❌ Error registrando merma por caducidad:', error);
    return {
      success: false,
      error: error.message || 'Error al registrar merma'
    };
  }
};

/**
 * Registra merma parcial de un lote (util cuando solo parte del stock caduco)
 * 
 * @param {Object} batch - El lote
 * @param {Object} product - Producto padre
 * @param {number} quantityToWriteOff - Cantidad a mermar
 * @param {string} notes - Notas adicionales
 * @returns {Promise<{success: boolean, wasteRecord?: Object, error?: string}>}
 */
export const registerPartialExpirationWaste = async (batch, product, quantityToWriteOff, notes = '') => {
  try {
    const batchStock = Number(batch.stock) || 0;
    const batchCost = Number(batch.cost) || 0;
    
    if (quantityToWriteOff <= 0 || quantityToWriteOff > batchStock) {
      return {
        success: false,
        error: 'Cantidad inválida para merma parcial'
      };
    }

    const totalLoss = roundCurrency(quantityToWriteOff * batchCost);

    // 1. Registrar waste log
    const wasteRecord = {
      id: generateID('waste'),
      productId: batch.productId,
      productName: product?.name || 'Producto eliminado',
      batchId: batch.id,
      batchSku: batch.sku || 'N/A',
      quantity: quantityToWriteOff,
      unit: product?.bulkData?.purchase?.unit || 'u',
      costAtTime: batchCost,
      lossAmount: totalLoss,
      reason: 'caducidad_parcial',
      notes: `Merma parcial por caducidad (${quantityToWriteOff}/${batchStock}). Lote: ${batch.sku || batch.id}. ${notes}`,
      expiryDate: batch.expiryDate,
      timestamp: new Date().toISOString()
    };

    const wasteResult = await saveDataSafe(STORES.WASTE, wasteRecord);
    if (!wasteResult.success) {
      throw new Error(`Failed to save waste record: ${wasteResult.message}`);
    }

    // 2. Usar processBatchDeductions para descontar stock manteniendo integridad
    const deductions = [{
      batchId: batch.id,
      quantity: quantityToWriteOff,
      reason: 'Merma por caducidad'
    }];

    await processBatchDeductions(deductions, { validateStock: true });

    Logger.log(`✅ Merma parcial registrada: ${quantityToWriteOff} de ${batch.sku || batch.id}, Pérdida: $${totalLoss}`);

    return {
      success: true,
      wasteRecord,
      totalLoss,
      quantityWrittenOff: quantityToWriteOff
    };
  } catch (error) {
    Logger.error('❌ Error registrando merma parcial:', error);
    return {
      success: false,
      error: error.message || 'Error al registrar merma parcial'
    };
  }
};