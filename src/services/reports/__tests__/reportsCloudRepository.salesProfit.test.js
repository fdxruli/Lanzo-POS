import { describe, expect, it } from 'vitest';
import { buildSalesProfitFilters } from '../reportsCloudRepository';

describe('reportsCloudRepository sales profit filters', () => {
  it('allows only the parameters supported by pos_get_sales_profit_report', () => {
    const params = buildSalesProfitFilters({
      dateFrom: '2026-09-01T06:00:00.000Z',
      dateTo: '2026-09-08T06:00:00.000Z',
      scope: 'license',
      staffUserId: 'staff-id',
      productId: 'product-id',
      categoryId: 'category-id',
      deviceId: 'must-not-pass',
      cashSessionId: 'must-not-pass',
      customerId: 'must-not-pass',
      status: 'closed',
      paymentMethod: 'cash',
      search: 'must-not-pass'
    });

    expect(params).toEqual({
      p_date_from: '2026-09-01T06:00:00.000Z',
      p_date_to: '2026-09-08T06:00:00.000Z',
      p_scope: 'license',
      p_staff_user_id: 'staff-id',
      p_product_id: 'product-id',
      p_category_id: 'category-id'
    });
    expect(params).not.toHaveProperty('p_device_id');
    expect(params).not.toHaveProperty('p_cash_session_id');
    expect(params).not.toHaveProperty('p_customer_id');
    expect(params).not.toHaveProperty('p_status');
    expect(params).not.toHaveProperty('p_payment_method');
    expect(params).not.toHaveProperty('p_search');
  });
});
