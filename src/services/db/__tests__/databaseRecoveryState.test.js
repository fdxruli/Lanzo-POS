import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_RECOVERY_CODES,
  DATABASE_RECOVERY_STATUS,
  clearDatabaseRecoveryState,
  createDatabaseRecoveryError,
  getDatabaseRecoveryState,
  reportStructuralDatabaseErrorOnce,
  setDatabaseRecoveryState
} from '../databaseRecoveryState';

afterEach(() => clearDatabaseRecoveryState());

describe('databaseRecoveryState', () => {
  it('preserves inspected native versions when they are available', () => {
    const diagnostic = setDatabaseRecoveryState({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      detectedNativeVersion: 320,
      expectedNativeVersion: 310,
      isRetryable: false
    });

    expect(diagnostic).toMatchObject({
      detectedNativeVersion: 320,
      expectedNativeVersion: 310,
      isRetryable: false
    });
    expect(getDatabaseRecoveryState()).toBe(diagnostic);
  });

  it('does not invent native versions from invalid diagnostic input', () => {
    const diagnostic = setDatabaseRecoveryState({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_NOT_INSPECTABLE',
      detectedNativeVersion: '320',
      expectedNativeVersion: Number.NaN
    });

    expect(diagnostic.detectedNativeVersion).toBeNull();
    expect(diagnostic.expectedNativeVersion).toBeNull();
  });

  it('keeps READY when an unrelated structural reporter only logs a later catalog error', () => {
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY, databaseName: 'LanzoDB_t_active' });
    const error = createDatabaseRecoveryError({
      errorCode: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      databaseName: 'LanzoDB_t_other',
      isRetryable: false,
      requiresMigration: false
    });

    expect(reportStructuralDatabaseErrorOnce(error, 'catalog-read')).toBe(true);
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.READY,
      databaseName: 'LanzoDB_t_active'
    });
  });
});
