import { describe, expect, it } from 'vitest';
import { reportsCacheService } from '../reportsCacheService';

describe('reportsCacheService cache context keys', () => {
  it('isolates snapshots by license and actor context without storing context in the key text', () => {
    const filters = { scope: 'mine', limit: 50, offset: 0 };
    const actorA = reportsCacheService.buildCacheKey('sales_final_history', filters, {
      licenseKey: 'license-secret-a',
      actorContext: 'staff:actor-a:session-a'
    });
    const actorB = reportsCacheService.buildCacheKey('sales_final_history', filters, {
      licenseKey: 'license-secret-a',
      actorContext: 'staff:actor-b:session-b'
    });
    const licenseB = reportsCacheService.buildCacheKey('sales_final_history', filters, {
      licenseKey: 'license-secret-b',
      actorContext: 'staff:actor-a:session-a'
    });

    expect(actorA).not.toBe(actorB);
    expect(actorA).not.toBe(licenseB);
    expect(actorA).not.toContain('license-secret-a');
    expect(actorA).not.toContain('session-a');
  });
});
