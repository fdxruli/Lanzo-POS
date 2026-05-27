import { create } from 'zustand';
import { db, STORES } from './db/dexie';
import Logger from './Logger';

// Umbrales de riesgo basados en volumen
export const LEVEL_1_THRESHOLD = 50;
export const LEVEL_2_THRESHOLD = 100;
export const LEVEL_3_THRESHOLD = 300;
export const POSTPONE_MUTATIONS_AMOUNT = 100;

export const useBackupRiskStore = create((set, get) => ({
  riskLevel: 0, // 0 (Seguro), 1 (Leve), 2 (Banner), 3 (Bloqueante)
  totalMutations: 0,
  lastBackupCount: 0,
  isCalculating: false,

  ping: async () => {
    if (get().isCalculating) return;
    set({ isCalculating: true });

    try {
      // 1. Contar registros reales en base de datos
      const [salesCount, productsCount, customersCount] = await Promise.all([
        db.table(STORES.SALES).count(),
        db.table(STORES.MENU).count(),
        db.table(STORES.CUSTOMERS).count()
      ]);

      const currentTotal = salesCount + productsCount + customersCount;

      // 2. Leer preferencias de localStorage (Manejo de Falacia Volátil)
      const rawLastBackup = localStorage.getItem('last_backup_mutation_count');
      const rawPostponeLimit = localStorage.getItem('backup_postpone_limit');
      
      const lastBackupCount = rawLastBackup ? parseInt(rawLastBackup, 10) : 0;
      const postponeLimit = rawPostponeLimit ? parseInt(rawPostponeLimit, 10) : 0;

      // 3. Evaluar el riesgo (Volumen no respaldado)
      const unbackedMutations = currentTotal - lastBackupCount;
      let newRiskLevel = 0;

      // Si hay posponer activo, verificar si ya cruzamos el límite
      const isPostponed = postponeLimit > currentTotal;

      if (!isPostponed) {
        if (unbackedMutations >= LEVEL_3_THRESHOLD) {
          newRiskLevel = 3;
        } else if (unbackedMutations >= LEVEL_2_THRESHOLD) {
          newRiskLevel = 2;
        } else if (unbackedMutations >= LEVEL_1_THRESHOLD) {
          newRiskLevel = 1;
        }
      }

      set({ 
        totalMutations: currentTotal, 
        lastBackupCount, 
        riskLevel: newRiskLevel,
        isCalculating: false 
      });

    } catch (error) {
      Logger.error('Error calculando riesgo de respaldo:', error);
      set({ isCalculating: false });
    }
  },

  postpone: async () => {
    const { totalMutations } = get();
    // Posponer silencia la alerta hasta cruzar más mutaciones
    const newLimit = totalMutations + POSTPONE_MUTATIONS_AMOUNT;
    localStorage.setItem('backup_postpone_limit', newLimit.toString());
    return get().ping(); // Reevaluar inmediatamente para ocultar la alerta
  },

  markBackupCompleted: async () => {
    const { totalMutations } = get();
    // Reiniciar contadores y borrar posponer
    localStorage.setItem('last_backup_mutation_count', totalMutations.toString());
    localStorage.removeItem('backup_postpone_limit');
    localStorage.setItem('last_backup_date', new Date().toISOString()); // Mantenemos compatibilidad visual si se necesita
    return get().ping();
  }
}));

// Ejecutar ping inicial asíncrono para no bloquear el arranque
setTimeout(() => {
  useBackupRiskStore.getState().ping();
}, 2000);

export const evaluator = {
  ping: () => useBackupRiskStore.getState().ping(),
  postpone: () => useBackupRiskStore.getState().postpone(),
  markBackupCompleted: () => useBackupRiskStore.getState().markBackupCompleted()
};
