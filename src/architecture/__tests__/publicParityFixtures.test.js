import { describe, expect, it } from 'vitest';
import {
  PARITY_CHECKOUT_ERROR_CODES,
  PARITY_FIXTURE_REVISIONS,
  PARITY_FIXTURE_SLUGS,
  PARITY_TRACKING_STATUSES,
  PUBLIC_PARITY_FIXTURE_SUMMARY,
  createCatalogFixture,
  createFreePortalFixture,
  createOrderErrorFixture,
  createProPortalFixture,
  createTrackingFixture,
} from '../../../scripts/fixtures/public-parity-fixtures.mjs';

describe('public parity fixtures', () => {
  it('represents distinct PRO and FREE portal contracts', () => {
    const pro = createProPortalFixture();
    const free = createFreePortalFixture();

    expect(pro).toMatchObject({
      catalogRevision: PARITY_FIXTURE_REVISIONS.A,
      portal: { slug: PARITY_FIXTURE_SLUGS.pro, pickupEnabled: true, deliveryEnabled: true },
      features: { stockVisibility: true },
    });
    expect(free).toMatchObject({
      catalogRevision: PARITY_FIXTURE_REVISIONS.FREE,
      portal: { slug: PARITY_FIXTURE_SLUGS.free, deliveryEnabled: false, stockMode: 'hidden' },
      features: { stockVisibility: false },
    });
  });

  it('provides deterministic pagination and revision reconciliation data', () => {
    const firstPage = createCatalogFixture();
    const secondPage = createCatalogFixture({ offset: 100 });
    const revisedPage = createCatalogFixture({ revision: PARITY_FIXTURE_REVISIONS.B });
    const originalProduct = firstPage.items.find((item) => item.id === 'reconciliar-fixture');
    const revisedProduct = revisedPage.items.find((item) => item.id === 'reconciliar-fixture');

    expect(firstPage.pagination).toEqual({ limit: 100, offset: 0, hasMore: true });
    expect(secondPage.pagination).toEqual({ limit: 100, offset: 100, hasMore: false });
    expect(secondPage.items.map((item) => item.id)).toEqual(['postre-fixture']);
    expect(originalProduct).toMatchObject({ isAvailable: true, price: 55.5 });
    expect(revisedProduct).toMatchObject({ isAvailable: false, price: 59.5 });
  });

  it('covers only checkout errors and tracking states supported by the audit contract', () => {
    expect(PARITY_CHECKOUT_ERROR_CODES).toHaveLength(6);
    expect(PARITY_CHECKOUT_ERROR_CODES.map((code) => createOrderErrorFixture(code).error.code))
      .toEqual(PARITY_CHECKOUT_ERROR_CODES);
    expect(PARITY_TRACKING_STATUSES).toHaveLength(9);
    expect(PARITY_TRACKING_STATUSES.map((status) => createTrackingFixture(status).tracking.status))
      .toEqual(PARITY_TRACKING_STATUSES);
    expect(PUBLIC_PARITY_FIXTURE_SUMMARY).toMatchObject({
      fixtureOnly: true,
      containsProductionData: false,
      catalogPages: 2,
      catalogRevisions: 2,
    });
  });
});
