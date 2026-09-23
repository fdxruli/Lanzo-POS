// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORY_PERMISSION_KEYS,
  canStaffAccessNotificationCategory
} from '../notificationCapabilities';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationCategory,
  isNotificationHiddenByPreferences,
  normalizeNotificationPreferences
} from '../notificationPreferencesService';

const staffSession = (permissions) => ({
  currentDeviceRole: 'staff',
  currentStaffUser: { id: 'staff-phase5', permissions }
});

describe('Phase 5 inventory notification category', () => {
  it.each([
    [{ type: 'inventory' }, 'inventory'],
    [{ type: 'inventory', category: 'operations', metadata: { category: 'operations' } }, 'inventory'],
    [{ type: 'system', metadata: { category: 'inventory' } }, 'inventory'],
    [{ type: 'cash' }, 'operations'],
    [{ type: 'sync' }, 'operations'],
    [{ type: 'staff' }, 'operations'],
    [{ type: 'operation' }, 'operations'],
    [{ type: 'operations' }, 'operations'],
    [{ type: 'ecommerce' }, 'ecommerce'],
    [{ type: 'support' }, 'support'],
    [{ type: 'license' }, 'license'],
    [{ type: 'unknown' }, 'system']
  ])('classifies %#', (notification, expected) => {
    expect(getNotificationCategory(notification)).toBe(expected);
  });

  it('maps inventory to its dedicated Staff permission', () => {
    expect(NOTIFICATION_CATEGORY_PERMISSION_KEYS.inventory)
      .toBe('notifications_inventory');
  });

  it('keeps Admin inventory access independent from Staff permissions', () => {
    expect(canStaffAccessNotificationCategory({}, {
      currentDeviceRole: 'admin',
      currentStaffUser: null
    }, 'inventory')).toBe(true);
  });

  it.each([
    [{ notifications: false, notifications_inventory: true }, false],
    [{ notifications: true, notifications_inventory: true }, true],
    [{ notifications: true, notifications_inventory: false }, false],
    [{ notifications: true, notifications_operations: true }, true],
    [{ notifications: true, notifications_operations: false }, false],
    [{ notifications: true }, true],
    [{}, false]
  ])('applies inventory permission compatibility %#', (permissions, expected) => {
    expect(canStaffAccessNotificationCategory({}, staffSession(permissions), 'inventory'))
      .toBe(expected);
  });

  it('keeps unrelated category authorization unchanged', () => {
    expect(canStaffAccessNotificationCategory({}, staffSession({
      notifications: true,
      notifications_inventory: false,
      notifications_ecommerce: true
    }), 'ecommerce')).toBe(true);
  });
});

describe('Phase 5 inventory notification preferences', () => {
  it('adds inventory defaults without changing operations defaults', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.tickerCategories.inventory).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.featuredCategories.inventory).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories.inventory).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFERENCES.tickerCategories.operations).toBe(true);
  });

  it('inherits legacy Operations preferences when Inventory is absent', () => {
    const mutedUntil = '2099-01-01T00:00:00.000Z';
    const normalized = normalizeNotificationPreferences({
      tickerCategories: { operations: false },
      featuredCategories: { operations: false },
      mutedCategories: { operations: mutedUntil }
    });

    expect(normalized.tickerCategories.inventory).toBe(false);
    expect(normalized.featuredCategories.inventory).toBe(false);
    expect(normalized.mutedCategories.inventory).toBe(mutedUntil);
  });

  it('keeps explicit Inventory preferences independent from Operations', () => {
    const normalized = normalizeNotificationPreferences({
      tickerCategories: { inventory: false, operations: true },
      featuredCategories: { inventory: true, operations: false },
      mutedCategories: {
        inventory: '2099-01-02T00:00:00.000Z',
        operations: null
      }
    });

    expect(normalized.tickerCategories.inventory).toBe(false);
    expect(normalized.tickerCategories.operations).toBe(true);
    expect(normalized.featuredCategories.inventory).toBe(true);
    expect(normalized.featuredCategories.operations).toBe(false);
    expect(normalized.mutedCategories.inventory).toBe('2099-01-02T00:00:00.000Z');
    expect(normalized.mutedCategories.operations).toBeNull();
  });

  it('uses the Inventory ticker preference without suppressing cash/sync', () => {
    const preferences = normalizeNotificationPreferences({
      tickerCategories: { inventory: false, operations: true }
    });

    expect(isNotificationHiddenByPreferences({
      type: 'inventory',
      severity: 'warning'
    }, preferences, { surface: 'ticker' })).toBe(true);

    expect(isNotificationHiddenByPreferences({
      type: 'cash',
      severity: 'warning'
    }, preferences, { surface: 'ticker' })).toBe(false);

    expect(isNotificationHiddenByPreferences({
      type: 'sync',
      severity: 'warning'
    }, preferences, { surface: 'ticker' })).toBe(false);
  });

  it('does not let Operations=false suppress Inventory warning', () => {
    const preferences = normalizeNotificationPreferences({
      tickerCategories: { inventory: true, operations: false }
    });

    expect(isNotificationHiddenByPreferences({
      type: 'inventory',
      severity: 'warning'
    }, preferences, { surface: 'ticker' })).toBe(false);

    expect(isNotificationHiddenByPreferences({
      type: 'cash',
      severity: 'warning'
    }, preferences, { surface: 'ticker' })).toBe(true);
  });

  it('preserves critical safety semantics for Inventory', () => {
    const preferences = normalizeNotificationPreferences({
      tickerCategories: { inventory: false },
      mutedCategories: { inventory: '2099-01-01T00:00:00.000Z' }
    });

    expect(isNotificationHiddenByPreferences({
      type: 'inventory',
      severity: 'critical'
    }, preferences, { surface: 'ticker' })).toBe(false);
  });
});
