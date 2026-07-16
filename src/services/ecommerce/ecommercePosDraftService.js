import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import {
  mapEcommerceOrderToPosDraft as mapBaseEcommerceOrderToPosDraft,
  prepareEcommerceOrderPosDraft as prepareBaseEcommerceOrderPosDraft
} from './ecommercePosDraftServiceBase';
import {
  buildEcommerceOrderDisplayName,
  formatEcommerceOrderConfigurationSummary
} from '../../utils/ecommerceOrderConfigurationDisplay';
import { reconcileEcommerceConfiguredItems } from './ecommercePosConfiguredItem';

export * from './ecommercePosDraftServiceBase';

const decorateEcommerceDraftItem = (item = {}, currency = 'MXN') => {
  const summary = formatEcommerceOrderConfigurationSummary(item.ecommerceOptions, { currency });
  if (!summary) return item;

  const baseName = item.ecommerceBasePosName || item.name || item.ecommerceSnapshotName || 'Producto';
  const displayName = buildEcommerceOrderDisplayName(baseName, item.ecommerceOptions, { currency });
  if (
    item.name === displayName
    && item.ecommerceBasePosName === baseName
    && item.ecommerceConfigurationSummary === summary
  ) return item;

  return {
    ...item,
    ecommerceBasePosName: baseName,
    ecommerceConfigurationSummary: summary,
    name: displayName
  };
};

export const decorateEcommercePosDraft = (draft = {}, products = []) => {
  const currency = draft.currency || 'MXN';
  const sourceItems = Array.isArray(draft.items) ? draft.items : [];
  const reconciled = reconcileEcommerceConfiguredItems({ items: sourceItems, products });
  let changed = reconciled.changed;
  const items = reconciled.items.map((item) => {
    const decorated = decorateEcommerceDraftItem(item, currency);
    if (decorated !== item) changed = true;
    return decorated;
  });
  return changed ? { ...draft, items } : draft;
};

export function mapEcommerceOrderToPosDraft(args = {}) {
  const result = mapBaseEcommerceOrderToPosDraft(args);
  if (result?.success === false || !result?.draft) return result;
  return {
    ...result,
    draft: decorateEcommercePosDraft(result.draft, args.products || [])
  };
}

const decoratePreparedDraftInStore = (draftId) => {
  if (!draftId) return null;
  const state = useActiveOrders.getState();
  const current = state.activeOrders?.get?.(draftId) || null;
  if (!current) return null;

  const decorated = decorateEcommercePosDraft(current, useProductStore.getState().menu);
  if (decorated !== current) {
    if (typeof state.updateOrder === 'function') {
      state.updateOrder(draftId, { items: decorated.items });
    } else if (typeof state.updateOrderItems === 'function') {
      state.updateOrderItems(draftId, decorated.items);
    }
  }

  return useActiveOrders.getState().activeOrders?.get?.(draftId) || decorated;
};

export async function prepareEcommerceOrderPosDraft(args = {}) {
  const result = await prepareBaseEcommerceOrderPosDraft(args);
  if (result?.success === false || !result?.draftId) return result;
  const order = decoratePreparedDraftInStore(result.draftId);
  return order ? { ...result, order } : result;
}

export const ecommercePosDraftConfigurationDisplayInternals = Object.freeze({
  decorateEcommerceDraftItem,
  decoratePreparedDraftInStore
});
