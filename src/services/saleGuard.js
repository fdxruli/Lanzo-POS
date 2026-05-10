/**
 * saleGuard.js - Middleware que previene cobrar ventas en almacenamiento crítico
 * 
 * Uso en salesService:
 *   import { saleGuard } from './saleGuard';
 *   
 *   export const processSale = async (saleData) => {
 *     const guard = await saleGuard.validate();
 *     if (!guard.allowed) {
 *       showMessage(guard.reason, 'error', { duration: 5000 });
 *       throw new Error(guard.reason);
 *     }
 *     // ... continuar con el cobro
 *   };
 */

import { storageManager } from './storageManager';
import Logger from './Logger';

class SaleGuard {
  /**
   * Valida si es seguro procesar una venta
   * Retorna: { allowed: boolean, reason?: string, severity?: string }
   */
  async validate() {
    const canProcess = await storageManager.canProcessSale();

    if (!canProcess.allowed) {
      Logger.error('❌ VENTA BLOQUEADA:', canProcess.reason);
    } else if (canProcess.reason) {
      Logger.warn('⚠️ Advertencia de almacenamiento:', canProcess.reason);
    }

    return canProcess;
  }

  /**
   * Estima si hay espacio suficiente para una nueva venta
   * Retorna: { hasSufficientSpace: boolean, requiredSpace: number, availableSpace: number }
   */
  async validateSpace(estimatedSizeBytes = 5 * 1024) { // 5KB por defecto por venta
    const quota = await storageManager.estimateQuota(true);

    if (quota.error) {
      Logger.warn('No se pudo verificar espacio - permitiendo por seguridad');
      return { hasSufficientSpace: true };
    }

    const availableSpace = quota.quota - quota.usage;

    return {
      hasSufficientSpace: availableSpace > estimatedSizeBytes,
      requiredSpace: estimatedSizeBytes,
      availableSpace,
      quotaPercent: quota.percentUsed,
    };
  }

  /**
   * Emite alerta UI si se detectan problemas
   * Retorna true si la venta debe procederse (usuario confirmó)
   */
  async promptIfWarning() {
    const quota = await storageManager.estimateQuota(true);
    const { persistenceState } = storageManager.getState();

    const warnings = [];

    if (persistenceState === 'denied' || persistenceState === 'unsupported') {
      warnings.push({
        type: 'critical',
        message: 'Modo Volátil: Tus datos pueden borrarse. Instala la app o sincroniza ahora.',
      });
    }

    if (quota.isWarning) {
      warnings.push({
        type: 'warning',
        message: `Almacenamiento ${quota.percentUsed}% lleno. Considera sincronizar.`,
      });
    }

    if (quota.isCritical) {
      warnings.push({
        type: 'critical',
        message: `CRÍTICO: Almacenamiento ${quota.percentUsed}% lleno. Sincroniza inmediatamente.`,
      });
    }

    // Retorna warnings para que UI maneje la presentación
    return warnings;
  }

  /**
   * Para debugging: imprime estado completo
   */
  async debugState() {
    const managerState = storageManager.getState();
    const canProcess = await storageManager.canProcessSale();
    const space = await this.validateSpace();

    const debug = {
      managerState,
      canProcess,
      space,
      timestamp: new Date().toISOString(),
    };

    Logger.debug('🔍 SaleGuard Debug State:', debug);
    return debug;
  }
}

export const saleGuard = new SaleGuard();

export default saleGuard;
