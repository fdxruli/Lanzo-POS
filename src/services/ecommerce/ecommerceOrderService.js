import {
  getEcommerceOrder as getBaseEcommerceOrder
} from './ecommerceOrderServiceBase';
import {
  buildEcommerceOrderDisplayName,
  formatEcommerceOrderConfigurationSummary
} from '../../utils/ecommerceOrderConfigurationDisplay';

export * from './ecommerceOrderServiceBase';

export const decorateEcommerceOrderConfiguration = (order = {}) => {
  const currency = order?.totals?.currency || 'MXN';
  const items = Array.isArray(order?.items)
    ? order.items.map((item = {}) => {
        const summary = formatEcommerceOrderConfigurationSummary(item.options, { currency });
        if (!summary) return item;
        const baseProductName = item.ecommerceBaseProductName || item.productName || 'Producto';
        return {
          ...item,
          ecommerceBaseProductName: baseProductName,
          ecommerceConfigurationSummary: summary,
          productName: buildEcommerceOrderDisplayName(baseProductName, item.options, { currency })
        };
      })
    : [];

  return { ...order, items };
};

export async function getEcommerceOrder(args = {}) {
  const result = await getBaseEcommerceOrder(args);
  if (result?.success === false || !result?.order) return result;
  return {
    ...result,
    order: decorateEcommerceOrderConfiguration(result.order)
  };
}
