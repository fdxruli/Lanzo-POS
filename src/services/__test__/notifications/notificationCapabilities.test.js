import { describe, expect, it } from 'vitest';
import {
  getNotificationCapabilities,
  getSupportChannel,
  getTickerMode,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  isSupportCenterEnabled,
  isSupportEmailEnabled,
  shouldUseLocalTicker,
  shouldUseSummaryTicker
} from '../../notifications/notificationCapabilities';

describe('notificationCapabilities', () => {
  it('usa defaults locales cuando no hay licencia ni features', () => {
    expect(getNotificationCapabilities()).toMatchObject({
      ticker_enabled: true,
      ticker_mode: 'local',
      notification_center: false,
      cloud_notifications: false,
      support_channel: 'email',
      support_email_enabled: true,
      support_center: false,
      support_tickets: false
    });
    expect(shouldUseLocalTicker()).toBe(true);
    expect(shouldUseSummaryTicker()).toBe(false);
  });

  it('infiere Lanzo Nube cuando realtime_license_sync existe sin flags nuevas', () => {
    const licenseDetails = {
      features: {
        realtime_license_sync: true
      }
    };

    expect(isNotificationCenterEnabled(licenseDetails)).toBe(true);
    expect(isCloudNotificationsEnabled(licenseDetails)).toBe(true);
    expect(isSupportCenterEnabled(licenseDetails)).toBe(true);
    expect(getSupportChannel(licenseDetails)).toBe('in_app');
    expect(getTickerMode(licenseDetails)).toBe('summary');
  });

  it('respeta flags explicitas aunque exista realtime_license_sync', () => {
    const licenseDetails = {
      features: {
        realtime_license_sync: true,
        notification_center: false,
        cloud_notifications: false,
        support_channel: 'email',
        support_center: false,
        support_tickets: false,
        ticker_mode: 'local'
      }
    };

    expect(getNotificationCapabilities(licenseDetails)).toMatchObject({
      notification_center: false,
      cloud_notifications: false,
      support_channel: 'email',
      support_center: false,
      support_tickets: false,
      ticker_mode: 'local'
    });
  });

  it('expone helpers directos para email, centro y ticker summary', () => {
    const licenseDetails = {
      features: {
        support_email_enabled: 'true',
        support_center: true,
        ticker_mode: 'summary'
      }
    };

    expect(isSupportEmailEnabled(licenseDetails)).toBe(true);
    expect(isSupportCenterEnabled(licenseDetails)).toBe(true);
    expect(shouldUseSummaryTicker(licenseDetails)).toBe(true);
    expect(shouldUseLocalTicker(licenseDetails)).toBe(false);
  });
});
