import { describe, expect, it } from 'vitest';
import {
  createProductCatalogSyncError,
  serializeProductCatalogSyncError
} from '../productCatalogSyncDiagnostics';

describe('product catalog diagnostics', () => {
  it('preserves actionable phase and record context without leaking credential values', () => {
    const error = createProductCatalogSyncError('Clave primaria incompatible', {
      code: 'DATA_ERR', phase: 'indexeddb_apply_products', entityType: 'product',
      entityId: 'legacy-42', store: 'menu', index: 3, offset: 200,
      licenseKey: 'LICENSE-SECRET', deviceId: 'DEVICE-SECRET'
    });
    const diagnostic = serializeProductCatalogSyncError(error);

    expect(diagnostic).toMatchObject({
      phase: 'indexeddb_apply_products', code: 'DATA_ERR', entityType: 'product',
      entityId: 'legacy-42', store: 'menu', index: 3, offset: 200,
      licenseScope: expect.stringMatching(/^license:/), deviceScope: expect.stringMatching(/^device:/)
    });
    expect(JSON.stringify(diagnostic)).not.toContain('LICENSE-SECRET');
    expect(JSON.stringify(diagnostic)).not.toContain('DEVICE-SECRET');
  });
});
