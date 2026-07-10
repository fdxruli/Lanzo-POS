// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationCategory,
  getNotificationPreferences,
  isNotificationHiddenByPreferences,
  muteCategory,
  resetNotificationPreferences
} from '../notificationPreferencesService';

describe('notificationPreferencesService ecommerce', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetNotificationPreferences();
  });

  it('enables ecommerce in ticker and featured defaults without muting it', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.tickerCategories.ecommerce).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.featuredCategories.ecommerce).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories.ecommerce).toBeNull();
    expect(getNotificationPreferences()).toEqual(expect.objectContaining({
      tickerCategories: expect.objectContaining({ ecommerce: true }),
      featuredCategories: expect.objectContaining({ ecommerce: true }),
      mutedCategories: expect.objectContaining({ ecommerce: null })
    }));
  });

  it('classifies ecommerce from type or metadata category', () => {
    expect(getNotificationCategory({ type: 'ecommerce' })).toBe('ecommerce');
    expect(getNotificationCategory({ type: 'system', metadata: { category: 'ecommerce' } })).toBe('ecommerce');
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
});
