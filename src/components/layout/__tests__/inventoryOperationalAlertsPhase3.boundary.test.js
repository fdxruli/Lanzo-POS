import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('inventory operational alerts phase 3 boundaries', () => {
  it('keeps one shared runtime mounted independently from the optional ticker', () => {
    const layout = read('src/components/layout/Layout.jsx');

    expect(layout.match(/<LocalInventoryOperationalAlertsRuntime\s*\/>/g) || [])
      .toHaveLength(1);
    expect(layout).toContain('{shouldShowTicker && <Ticker />}');
    expect(layout.indexOf('<LocalInventoryOperationalAlertsRuntime />'))
      .toBeLessThan(layout.indexOf('{shouldShowTicker && <Ticker />}'));
  });

  it('keeps Ticker, Bell and Drawer free from independent Dexie scans or polling intervals', () => {
    const ticker = read('src/components/layout/Ticker.jsx');
    const bell = read('src/components/notifications/NotificationBell.jsx');
    const drawer = read('src/components/notifications/LocalInventoryOperationalAlertsDrawer.jsx');

    [ticker, bell, drawer].forEach((source) => {
      expect(source).not.toMatch(/from ['"][^'"]*db\/dexie['"]/);
      expect(source).not.toContain('queryLocalInventoryOperationalSnapshot');
      expect(source).not.toContain('setInterval(');
    });

    expect(ticker).toContain('useTickerAlerts(useLocalTicker)');
    expect(bell).toContain('useInventoryOperationalAlertsSnapshot()');
  });

  it('does not add proactive inventory modal, toast, sound, vibration or browser notifications', () => {
    const ticker = read('src/components/layout/Ticker.jsx');
    const bell = read('src/components/notifications/NotificationBell.jsx');
    const runtime = read('src/components/inventory/LocalInventoryOperationalAlertsRuntime.jsx');

    [ticker, bell, runtime].forEach((source) => {
      expect(source).not.toMatch(/\btoast\s*\(/);
      expect(source).not.toMatch(/navigator\.vibrate/);
      expect(source).not.toMatch(/new\s+Notification\s*\(/);
      expect(source).not.toMatch(/\.play\s*\(/);
    });
  });

  it('keeps critical ticker emphasis static and leaves reduced-motion handling in place', () => {
    const css = read('src/components/layout/Ticker.css');

    expect(css).not.toContain('urgency-pulse');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.ticker-item.urgency-critical');
  });
});
