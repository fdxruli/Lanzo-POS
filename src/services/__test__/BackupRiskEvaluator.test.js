import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupRiskStore, evaluator, startBackupRiskEvaluator } from '../BackupRiskEvaluator';
import { db, STORES } from '../db/dexie';
import Logger from '../Logger';

// Mock de dexie y localStorage
vi.mock('../db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', CUSTOMERS: 'customers' },
  db: {
    table: vi.fn()
  }
}));

vi.mock('../Logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

describe('BackupRiskEvaluator', () => {
  const hideLocalStorage = () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: undefined
    });

    return () => {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor);
      } else {
        delete window.localStorage;
      }
    };
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useBackupRiskStore.setState({ isCalculating: false, riskLevel: 0, totalMutations: 0, lastBackupCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('no debe lanzar ni registrar error cuando localStorage no existe', async () => {
    mockDbCounts(20, 20, 20);
    const restoreLocalStorage = hideLocalStorage();

    try {
      await expect(evaluator.ping()).resolves.toBeUndefined();
      await expect(evaluator.postpone()).resolves.toBeUndefined();
      await expect(evaluator.markBackupCompleted()).resolves.toBeUndefined();

      expect(Logger.error).not.toHaveBeenCalled();
      expect(db.table).not.toHaveBeenCalled();
    } finally {
      restoreLocalStorage();
    }
  });

  it('startBackupRiskEvaluator no hace nada cuando localStorage no existe', () => {
    const restoreLocalStorage = hideLocalStorage();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    try {
      expect(startBackupRiskEvaluator()).toBe(false);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      restoreLocalStorage();
    }
  });

  it('startBackupRiskEvaluator programa un solo ping inicial', async () => {
    vi.useFakeTimers();
    mockDbCounts(20, 20, 11);

    expect(startBackupRiskEvaluator()).toBe(true);
    expect(startBackupRiskEvaluator()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);

    expect(db.table).toHaveBeenCalledTimes(3);
    expect(useBackupRiskStore.getState().riskLevel).toBe(1);
    expect(startBackupRiskEvaluator()).toBe(false);
  });
});
