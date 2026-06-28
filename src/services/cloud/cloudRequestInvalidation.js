import { CLOUD_REQUEST_TAGS } from './cloudRequestConstants';
import { cloudRequestManager } from './cloudRequestManager';
import { cloudRequestTags } from './cloudRequestKeys';

const uniqueTags = (tags = []) => Array.from(new Set(tags.filter(Boolean)));
const licenseTag = (licenseKey) => (licenseKey ? cloudRequestTags.license(licenseKey) : null);

export const invalidateCloudRequestTags = (tags = []) => uniqueTags(tags)
  .reduce((count, tag) => count + cloudRequestManager.invalidateByTag(tag), 0);

export const invalidateCloudCacheForLicense = (licenseKey) => {
  if (!licenseKey) return 0;
  return cloudRequestManager.invalidateByTag(cloudRequestTags.license(licenseKey));
};

export const invalidateCloudCacheAfterSaleMutation = (licenseKey) => invalidateCloudRequestTags([
  licenseTag(licenseKey),
  CLOUD_REQUEST_TAGS.SALES,
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.PRODUCTS,
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCashMutation = (licenseKey) => invalidateCloudRequestTags([
  licenseTag(licenseKey),
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCatalogMutation = (licenseKey) => invalidateCloudRequestTags([
  licenseTag(licenseKey),
  CLOUD_REQUEST_TAGS.PRODUCTS,
  CLOUD_REQUEST_TAGS.SALES,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCustomerMutation = (licenseKey) => invalidateCloudRequestTags([
  licenseTag(licenseKey),
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCreditMutation = (licenseKey) => invalidateCloudRequestTags([
  licenseTag(licenseKey),
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.REPORTS
]);
