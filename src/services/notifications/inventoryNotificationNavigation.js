const STOCK_CLASSIFICATIONS = new Set(['low_stock', 'out_of_stock']);
const EXPIRY_CLASSIFICATIONS = new Set(['expired', 'expiring']);

export function getCloudInventoryNotificationNavigationRoute(
  notification,
  { canReadReports = false, canReadProducts = false } = {}
) {
  if (notification?.type !== 'inventory') return null;

  const classification = notification?.metadata?.classification;

  if (canReadReports) {
    if (STOCK_CLASSIFICATIONS.has(classification)) return '/ventas?tab=restock';
    if (EXPIRY_CLASSIFICATIONS.has(classification)) return '/ventas?tab=expiration';
  }

  return canReadProducts ? '/productos' : null;
}

export default getCloudInventoryNotificationNavigationRoute;
