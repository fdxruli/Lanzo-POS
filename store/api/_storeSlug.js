export const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export const MIN_STORE_SLUG_LENGTH = 3;
export const MAX_STORE_SLUG_LENGTH = 64;

export function isValidStoreSlug(value) {
  return typeof value === 'string'
    && value.length >= MIN_STORE_SLUG_LENGTH
    && value.length <= MAX_STORE_SLUG_LENGTH
    && STORE_SLUG_PATTERN.test(value);
}
