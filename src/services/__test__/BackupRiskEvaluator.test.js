import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupRiskStore, evaluator, LEVEL_1_THRESHOLD, LEVEL_2_THRESHOLD, LEVEL_3_THRESHOLD } from '../BackupRiskEvaluator';
import { db, STORES } from '../db/dexie';

// Mock de dexie y localStorage
vi.mock('../db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', CUSTOMERS: 'customers' },
  db: {
    table: vi.fn()
  }
}));

describe('BackupRiskEvaluator', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useBackupRiskStore.setState({ isCalculating: false, riskLevel: 0, totalMutations: 0, lastBackupCount: 0 });
  });

  const mockDbCounts = (sales, menu, customers) => {
    db.table.mockImplementation((store) => {
      if (store === 'sales') return { count: async () => sales };
      if (store === 'menu') return { count: async () => menu };
      if (store === 'customers') return { count: async () => customers };
    });
  };

  it('debe calcular el riesgo L1 cuando pasa el umbral de 50', async () => {
    mockDbCounts(20, 20, 11); // Total: 51
    await evaluator.ping();
    
    const state = useBackupRiskStore.getState();
    expect(state.totalMutations).toBe(51);
    expect(state.riskLevel).toBe(1);
  });

  it('debe escalar al riesgo L3 cuando pasa de 300', async () => {
    mockDbCounts(200, 100, 5); // Total: 305
    await evaluator.ping();
    
    expect(useBackupRiskStore.getState().riskLevel).toBe(3);
  });

  it('no debe disparar alerta si el posponer esta activo', async () => {
    mockDbCounts(200, 100, 5); // Total: 305
    localStorage.setItem('backup_postpone_limit', '350');
    
    await evaluator.ping();
    
    expect(useBackupRiskStore.getState().riskLevel).toBe(0);
  });

  it('debe reanudar la alerta L3 si se rebasa el limite de posponer', async () => {
    mockDbCounts(355, 0, 0); // Total: 355
    localStorage.setItem('backup_postpone_limit', '350');
    
    await evaluator.ping();
    
    expect(useBackupRiskStore.getState().riskLevel).toBe(3);
  });

  it('debe marcar el respaldo como completado correctamente (Async)', async () => {
    mockDbCounts(300, 0, 0);
    await evaluator.ping();
    expect(useBackupRiskStore.getState().riskLevel).toBe(3);

    await evaluator.markBackupCompleted();
    
    expect(localStorage.getItem('last_backup_mutation_count')).toBe('300');
    expect(useBackupRiskStore.getState().riskLevel).toBe(0);
  });
});
