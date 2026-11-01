import { describe, expect, it } from 'vitest';
import { isFin01HistoricalCreditImportEnabled } from '../syncConstants';

describe('FIN-01 historical credit capability', () => {
  it('defaults off for existing licenses without the explicit capability', () => {
    expect(isFin01HistoricalCreditImportEnabled({ features: { cloud_pos_sync: true, cloud_cash_sync: true, cloud_customer_credit_sync: true } })).toBe(false);
    expect(isFin01HistoricalCreditImportEnabled({ details: { features: {} } })).toBe(false);
    expect(isFin01HistoricalCreditImportEnabled({})).toBe(false);
  });

  it('requires the exact explicit capability to be true', () => {
    expect(isFin01HistoricalCreditImportEnabled({ features: { fin01_historical_credit_import: true } })).toBe(true);
    expect(isFin01HistoricalCreditImportEnabled({ details: { features: { fin01_historical_credit_import: 'true' } } })).toBe(true);
    expect(isFin01HistoricalCreditImportEnabled({ features: { fin01_historical_credit_import: false } })).toBe(false);
  });
});
