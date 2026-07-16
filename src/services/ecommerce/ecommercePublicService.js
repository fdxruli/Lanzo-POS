import {
  buildEcommerceConfiguredLineKey,
  canonicalizeEcommerceSelections
} from '../../utils/ecommerceConfiguredProduct';
import {
  createEcommercePublicService as createBaseEcommercePublicService
} from './ecommercePublicServiceBase';

export * from './ecommercePublicServiceBase';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');

function restoreConfiguredLineKey(item) {
  const line = asObject(item);
  const nestedLine = asObject(line.configurationLine || line.product?.configurationLine);
  if (asText(line.lineKey) || asText(nestedLine.lineKey)) return item;

  const productId = asText(line.productId || line.product?.id);
  const variantId = asText(line.variantId) || null;
  const selections = canonicalizeEcommerceSelections(line.selections);
  const configurationRevision = asText(
    line.configurationRevision || line.configurationSnapshot?.configurationRevision
  );
  const configured = Boolean(variantId || selections.length || configurationRevision);
  if (!configured || !productId) return item;

  const lineKey = buildEcommerceConfiguredLineKey({ productId, variantId, selections });
  return lineKey ? { ...line, lineKey } : item;
}

function restoreConfiguredOrderPayload(payload = {}) {
  const source = asObject(payload);
  return {
    ...source,
    items: asArray(source.items).map(restoreConfiguredLineKey)
  };
}

export function createEcommercePublicService(client, options) {
  const service = createBaseEcommercePublicService(client, options);
  return {
    ...service,
    createPublicOrder: (slug, payload) => (
      service.createPublicOrder(slug, restoreConfiguredOrderPayload(payload))
    )
  };
}

const defaultService = createEcommercePublicService();

export const createPublicOrder = (slug, payload) => (
  defaultService.createPublicOrder(slug, payload)
);

export const ecommerceCheckoutNormalizationInternals = Object.freeze({
  restoreConfiguredLineKey,
  restoreConfiguredOrderPayload
});
