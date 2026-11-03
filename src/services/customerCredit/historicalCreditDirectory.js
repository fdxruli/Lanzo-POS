import { db, STORES } from '../db/dexie';
import { useAppStore } from '../../store/useAppStore';
import { Money } from '../../utils/moneyMath';
import { customerCloudRepository } from '../customers/customerCloudRepository';
import { localCustomerToCloudPayload } from '../customers/customerMapper';
import { getCustomerPhoneValidationError, toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { normalizeCustomerServerVersion } from '../db/customerServerVersion';
import { getLicenseKeyFromDetails, isCloudCustomerCreditSyncEnabled, isFin01HistoricalCreditImportEnabled, SYNC_LIMITS } from '../sync/syncConstants';

const directoryFieldsMatch = (cloud, payload) => cloud.id === payload.id
  && String(cloud.name ?? '').trim() === payload.name
  && String(cloud.phone ?? '').trim() === payload.phone
  && (cloud.phone_key ?? cloud.phoneKey ?? toIndexedPhoneKey(cloud.phone)) === payload.phone_key
  && String(cloud.address ?? '').trim() === payload.address
  && Money.toCents(cloud.credit_limit ?? cloud.creditLimit ?? 0) === Money.toCents(payload.credit_limit);

const assertDirectoryContext = (licenseKey, handle) => {
  handle.assertCurrent();
  const details = useAppStore.getState().licenseDetails;
  if (!licenseKey || getLicenseKeyFromDetails(details) !== licenseKey
    || !isCloudCustomerCreditSyncEnabled(details) || !isFin01HistoricalCreditImportEnabled(details)) {
    throw new Error('HISTORICAL_DIRECTORY_CONTEXT_CHANGED');
  }
};
const readCloudCustomer = async (licenseKey, customerId, assertCurrent) => {
  let offset = 0;
  for (;;) {
    assertCurrent();
    const page = await customerCloudRepository.pullCustomerSnapshot({ licenseKey, includeDeleted: true, force: true, offset, limit: SYNC_LIMITS.MAX_PULL_LIMIT });
    assertCurrent();
    if (page?.success === false) throw new Error(page.code || 'HISTORICAL_DIRECTORY_READ_FAILED');
    if (!Array.isArray(page?.customers)) throw new Error('HISTORICAL_DIRECTORY_READ_FAILED');
    const found = page.customers.find((row) => row.id === customerId);
    if (found) return found;
    if (!(page.has_more || page.hasMore)) return null;
    if (!page.customers.length) throw new Error('HISTORICAL_DIRECTORY_READ_FAILED');
    offset += page.customers.length;
  }
};
const assertCompatible = (cloud, request) => {
  if (cloud.deleted_at || cloud.deletedAt
    || normalizeCustomerServerVersion(cloud.server_version ?? cloud.serverVersion) === null
    || ((cloud.license_id || cloud.licenseId) && (cloud.license_id || cloud.licenseId) !== request.tenantId)
    || !directoryFieldsMatch(cloud, request.payload)) throw new Error('HISTORICAL_DIRECTORY_CONFLICT');
};

// A collision or uncertain response cannot become financial permission merely
// because a later financial preview finds the ID. Recheck prepared identities.
export const verifyPreparedHistoricalCreditDirectory = async ({ licenseKey, batch, handle }) => {
  for (const entry of batch.manifest.entries) {
    handle.assertCurrent();
    const request = (await db.table(STORES.SYNC_CACHE).get(`historical-credit:v1:directory:${batch.manifest.source_id}:${entry.customer_id}`))?.value;
    handle.assertCurrent();
    if (!request) continue;
    const assertCurrent = () => assertDirectoryContext(licenseKey, handle);
    assertCurrent();
    if (request.licenseKey !== licenseKey || request.tenantId !== batch.manifest.tenant_id) throw new Error('HISTORICAL_DIRECTORY_CONTEXT_CHANGED');
    const customer = await readCloudCustomer(licenseKey, entry.customer_id, assertCurrent);
    if (customer) assertCompatible(customer, request);
  }
};

// Called only by the explicit FIN-01 preparation action. Never a startup hook.
// Keep the request in the existing tenant cache, independent of financial approval.
export const prepareHistoricalCreditDirectory = async ({ licenseKey, batch, handle }) => {
  const assertCurrent = () => assertDirectoryContext(licenseKey, handle);
  const saveRequest = async (key, value) => {
    assertCurrent();
    await db.table(STORES.SYNC_CACHE).put({ key, value });
    assertCurrent();
  };
  const results = [];
  const missing = batch.preview.results.filter((row) => row.status === 'CONFLICT_CUSTOMER_MISSING');
  for (const row of missing) {
    assertCurrent();
    const approved = batch.manifest.entries.find((entry) => entry.customer_id === row.customer_id);
    const snapshot = (await db.table(STORES.SYNC_CACHE).get(`historical-credit:v1:customer:${row.customer_id}`))?.value;
    const customer = await db.table(STORES.CUSTOMERS).get(row.customer_id);
    assertCurrent();
    if (!approved || !snapshot || snapshot.status !== 'PENDING_AUTHORIZATION'
      || snapshot.sourceId !== batch.manifest.source_id || snapshot.sourceCustomerId !== approved.source_customer_id
      || snapshot.amountCents !== approved.amount_cents || customer?.id !== snapshot.customerId
      || customer.isActive === false || customer.deletedAt || customer.deletedTimestamp) throw new Error('HISTORICAL_DIRECTORY_SOURCE_CONFLICT');
    if (!String(customer.name ?? '').trim() || getCustomerPhoneValidationError(customer.phone)) {
      throw new Error('HISTORICAL_DIRECTORY_FIELDS_REQUIRED');
    }
    const payload = localCustomerToCloudPayload({ ...customer, phoneKey: toIndexedPhoneKey(customer.phone) });
    const key = `historical-credit:v1:directory:${snapshot.sourceId}:${snapshot.customerId}`;
    let request = (await db.table(STORES.SYNC_CACHE).get(key))?.value;
    assertCurrent();
    if (request && (request.licenseKey !== licenseKey || request.tenantId !== batch.manifest.tenant_id
      || request.sourceId !== snapshot.sourceId || !directoryFieldsMatch(request.payload, payload)
      || request.payload.phone_key !== payload.phone_key)) throw new Error('HISTORICAL_DIRECTORY_SOURCE_CONFLICT');
    if (!request) {
      request = { licenseKey, tenantId: batch.manifest.tenant_id, sourceId: snapshot.sourceId,
        payload, idempotencyKey: `fin01-directory:${crypto.randomUUID()}`, state: 'PENDING' };
      await saveRequest(key, request);
    }
    const existing = await readCloudCustomer(licenseKey, customer.id, assertCurrent);
    if (existing) {
      assertCompatible(existing, request);
      await saveRequest(key, { ...request, state: 'VERIFIED_EXISTING', customer: existing });
      results.push({ customer_id: customer.id, status: 'VERIFIED_EXISTING' });
      continue;
    }
    await saveRequest(key, { ...request, state: 'UNCERTAIN' });
    assertCurrent();
    // The installed contract creates with the original ID and zero debt. Its
    // CHECK(server_version >= 1) plus expectedVersion=0 rejects every existing
    // row under lock, including one created between the read and this request.
    // Never retry this path with null or with the conflicting Cloud version.
    const response = await customerCloudRepository.upsertCustomer({ licenseKey, customer: request.payload,
      expectedVersion: 0, idempotencyKey: request.idempotencyKey });
    assertCurrent();
    if (response?.success !== true || !response.customer) throw new Error(response?.code || 'HISTORICAL_DIRECTORY_UNCERTAIN');
    assertCompatible(response.customer, request);
    if (Money.toCents(response.customer.debt ?? 0) !== 0 || Number(response.customer.debt_cents ?? response.customer.debtCents ?? 0) !== 0) {
      throw new Error('HISTORICAL_DIRECTORY_CONFLICT');
    }
    // Do not apply a zero-debt directory ack over the preserved Local source.
    await saveRequest(key, { ...request, state: 'PREPARED', customer: response.customer });
    results.push({ customer_id: customer.id, status: 'PREPARED' });
  }
  return { success: true, results };
};
