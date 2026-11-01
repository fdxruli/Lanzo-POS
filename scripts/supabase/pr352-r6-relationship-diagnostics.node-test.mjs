import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRestaurantOrderItemRelationship, restaurantOrderItemSnapshotSql } from './pr352-r6-preparation-station.mjs';

const expected = { licenseId: 'license-a', localOrderId: 'local-order', localLineId: 'local-line' };
const snapshot = () => ({
  parents: [{ id: 'internal-order', licenseId: 'license-a', localOrderId: 'local-order', deletedAt: null }],
  items: [{ id: 'item-a', licenseId: 'license-a', parentId: 'internal-order', localLineId: 'local-line', stationCode: 'kitchen', stationName: 'Cocina', deletedAt: null }],
  joinedItems: [{ id: 'item-a', parentId: 'internal-order', licenseId: 'license-a' }],
  deletedParents: [], deletedItems: [],
});

test('snapshot query collects deleted rows separately, without weakening the active license and internal-key join', () => {
  const sql = restaurantOrderItemSnapshotSql('license-a', 'local-order', 'local-line');
  assert.match(sql, /deleted_parents as \([\s\S]*?local_order_id='local-order' and deleted_at is not null/);
  assert.match(sql, /deleted_items as \([\s\S]*?deleted_at is not null and local_line_id='local-line'/);
  assert.match(sql, /on p\.id=i\.restaurant_order_id and p\.license_id=i\.license_id/);
  assert.doesNotMatch(sql, /\blimit\s+1\b/i);
});

test('missing and deleted parent and item produce distinct diagnostics', () => {
  const deletedParent = snapshot(); deletedParent.parents = []; deletedParent.deletedParents = [{ id: 'internal-order', deletedAt: '2026-01-01' }];
  assert.throws(() => assertRestaurantOrderItemRelationship(deletedParent, expected), /parent must be active.*deleted/);
  const missingParent = snapshot(); missingParent.parents = [];
  assert.throws(() => assertRestaurantOrderItemRelationship(missingParent, expected), /parent missing/);
  const deletedItem = snapshot(); deletedItem.items = []; deletedItem.joinedItems = [];
  deletedItem.deletedItems = [{ id: 'item-a', parentId: 'internal-order', licenseId: 'license-a', localLineId: 'local-line', deletedAt: '2026-01-01' }];
  assert.throws(() => assertRestaurantOrderItemRelationship(deletedItem, expected), /item must be active.*deleted/);
  const missingItem = snapshot(); missingItem.items = []; missingItem.joinedItems = [];
  assert.throws(() => assertRestaurantOrderItemRelationship(missingItem, expected), /item is missing/);
  const wrongLine = snapshot(); wrongLine.items[0].localLineId = 'other-line';
  assert.throws(() => assertRestaurantOrderItemRelationship(wrongLine, expected), /incorrect local line/);
});

test('deleted history from a different parent does not masquerade as the expected deleted item', () => {
  const value = snapshot(); value.items = []; value.joinedItems = [];
  value.deletedItems = [{ id: 'other-item', parentId: 'other-order', licenseId: 'license-a', localLineId: 'local-line', deletedAt: '2026-01-01' }];
  assert.throws(() => assertRestaurantOrderItemRelationship(value, expected), /item is missing/);
});
