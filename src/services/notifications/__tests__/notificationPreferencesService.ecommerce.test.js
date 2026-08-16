// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationCategory,
  getNotificationPreferences,
  isNotificationHiddenByPreferences,
  muteCategory,
  resetNotificationPreferences,
  saveNotificationPreferences
} from '../notificationPreferencesService';

describe('notificationPreferencesService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('enables ecommerce and operations in defaults without muting them', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.tickerCategories.ecommerce).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.tickerCategories.operations).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.featuredCategories.ecommerce).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.featuredCategories.operations).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories.ecommerce).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories.operations).toBeNull();
  });

  it('classifies the canonical notification categories', () => {
    expect(getNotificationCategory({ type: 'ecommerce' })).toBe('ecommerce');
    expect(getNotificationCategory({ type: 'system', metadata: { category: 'ecommerce' } })).toBe('ecommerce');
    expect(getNotificationCategory({ type: 'cash' })).toBe('operations');
    expect(getNotificationCategory({ type: 'sync' })).toBe('operations');
    expect(getNotificationCategory({ type: 'inventory' })).toBe('operations');
    expect(getNotificationCategory({ type: 'system', metadata: { category: 'staff' } })).toBe('operations');
    expect(getNotificationCategory({ type: 'license' })).toBe('license');
    expect(getNotificationCategory({ type: 'support' })).toBe('support');
  });

  it('mutes ecommerce only on the ticker, not in the notification center', () => {
    const preferences = muteCategory('ecommerce', 60_000);
    const notification = {
      type: 'ecommerce',
      severity: 'info',
      metadata: { category: 'ecommerce' }
    };

    expect(isNotificationHiddenByPreferences(notification, preferences, { surface: 'ticker' })).toBe(true);
    expect(isNotificationHiddenByPreferences(notification, preferences, { surface: 'center' })).toBe(false);
  });

  it('keeps preferences isolated between tenant actors on the same browser', () => {
    const scopeA = 'license-a|admin:admin-a';
    const scopeB = 'license-b|admin:admin-b';

    saveNotificationPreferences({ compactMode: true }, scopeA);
    saveNotificationPreferences({
      compactMode: false,
      tickerCategories: { ecommerce: false }
    }, scopeB);

    expect(getNotificationPreferences(scopeA).compactMode).toBe(true);
    expect(getNotificationPreferences(scopeA).tickerCategories.ecommerce).toBe(true);
    expect(getNotificationPreferences(scopeB).compactMode).toBe(false);
    expect(getNotificationPreferences(scopeB).tickerCategories.ecommerce).toBe(false);

    resetNotificationPreferences(scopeA);
    expect(getNotificationPreferences(scopeA).compactMode).toBe(false);
    expect(getNotificationPreferences(scopeB).tickerCategories.ecommerce).toBe(false);
  });
});
