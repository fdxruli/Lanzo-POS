import { CLOUD_REQUEST_TAGS } from './cloudRequestConstants';
import { cloudRequestManager } from './cloudRequestManager';
import { cloudRequestTags } from './cloudRequestKeys';

const uniqueTags = (tags = []) => Array.from(new Set(tags.filter(Boolean)));

export const invalidateCloudRequestTags = (tags = []) => uniqueTags(tags)
  .reduce((count, tag) => count + cloudRequestManager.invalidateByTag(tag), 0);

export const invalidateCloudCacheForLicense = (licenseKey) => {
  if (!licenseKey) return 0;
  return cloudRequestManager.invalidateByTag(cloudRequestTags.license(licenseKey));
};

export const invalidateCloudCacheForLicenseTags = (licenseKey, tags = []) => {
  if (licenseKey) {
    return invalidateCloudCacheForLicense(licenseKey);
  }

  return invalidateCloudRequestTags(tags);
};

export const invalidateCloudCacheAfterSaleMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.SALES,
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.PRODUCTS,
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCashMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCatalogMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.PRODUCTS,
  CLOUD_REQUEST_TAGS.SALES,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterRestaurantConfigMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.RESTAURANT,
  CLOUD_REQUEST_TAGS.PRODUCTS,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterRestaurantOrderMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.RESTAURANT,
  CLOUD_REQUEST_TAGS.SALES,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCustomerMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.REPORTS
]);

export const invalidateCloudCacheAfterCreditMutation = (licenseKey) => invalidateCloudCacheForLicenseTags(licenseKey, [
  CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
  CLOUD_REQUEST_TAGS.CUSTOMERS,
  CLOUD_REQUEST_TAGS.CASH,
  CLOUD_REQUEST_TAGS.REPORTS
]);
