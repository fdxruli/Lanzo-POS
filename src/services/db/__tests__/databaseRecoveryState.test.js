import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_RECOVERY_STATUS,
  clearDatabaseRecoveryState,
  getDatabaseRecoveryState,
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
});
