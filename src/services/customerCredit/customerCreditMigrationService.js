import { customerLocalRepository } from '../customers/customerLocalRepository';
import { syncMetaService } from '../sync/syncMetaService';

// Legacy initial-balance writes cannot authorize historical credit. Preserve
// their Local source and leave authorization/import to the separate FIN-01 flow.
export const customerCreditMigrationService = {
  async runInitialMigrationIfNeeded({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'license_missing' };
    const blockedCustomerIds = [];
    for (const customer of await customerLocalRepository.getAllActiveCustomers()) {
      if ((await customerLocalRepository.protectHistoricalCustomer(customer.id)).blocked) {
        blockedCustomerIds.push(customer.id);
      }
    }
    if (blockedCustomerIds.length > 0) {
      await syncMetaService.setMeta('customer_credit_migrated_at', null, { licenseKey });
      return {
        success: false, blocked: true, code: 'HISTORICAL_DEBT_PRESERVATION_REQUIRED',
        blockedCustomerIds, inserted: 0
      };
    }
    return { skipped: true, reason: 'no_pending_local_history', inserted: 0 };
  }
};

export default customerCreditMigrationService;
