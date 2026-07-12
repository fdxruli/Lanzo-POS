import { describe, expect, it } from 'vitest';
import { buildEcommercePublishedStockTickerAlert } from '../tickerAlerts';
import { ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE } from '../ecommerce/ecommercePublishedStockAlertConstants';

describe('buildEcommercePublishedStockTickerAlert', () => {
  it('crea una sola alerta agregada para portal publicado', () => {
    const alert = buildEcommercePublishedStockTickerAlert({
      success: true,
      portalStatus: 'published',
      outOfStockCount: 3,
      products: [
        { publicName: 'Uno' },
        { publicName: 'Dos' },
        { publicName: 'Tres' }
      ]
    });

    expect(alert).toEqual({
      id: 'ecommerce-published-out-of-stock',
      type: 'ecommerce-published-out-of-stock',
      count: 3,
      urgency: 1,
      route: ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE
    });
    expect(JSON.stringify(alert)).not.toContain('Uno');
  });

  it('no alerta para portal pausado o sin stock agotado', () => {
    expect(buildEcommercePublishedStockTickerAlert({
      success: true,
      portalStatus: 'paused',
      outOfStockCount: 2
    })).toBeNull();

    expect(buildEcommercePublishedStockTickerAlert({
      success: true,
      portalStatus: 'published',
      outOfStockCount: 0
    })).toBeNull();
  });
});
