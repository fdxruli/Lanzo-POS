// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAdminPwaDocument, removeAdminPwaDocument } from '../adminPwaDocument';
import { startAdminInstallPromptCapture, stopAdminInstallPromptCapture } from '../adminInstallPrompt';

describe('administrative PWA document metadata', () => {
  afterEach(() => {
    stopAdminInstallPromptCapture();
    document.head.innerHTML = '';
    delete window.deferredPwaPrompt;
  });

  it('adds exactly one administrative manifest and installable metadata', () => {
    installAdminPwaDocument(document);

    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content).toBe('yes');
    expect(document.querySelector('meta[name="mobile-web-app-capable"]')?.content).toBe('yes');
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/pwa-192x192.png');
  });

  it('is idempotent and removes a stale duplicate manifest', () => {
    document.head.innerHTML = '<link rel="manifest" href="/stale.webmanifest">';
    installAdminPwaDocument(document);
    installAdminPwaDocument(document);

    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-lanzo-admin-pwa]')).toHaveLength(5);
  });

  it('removes only metadata managed by the administrative bootstrap', () => {
    document.head.innerHTML = '<meta name="description" content="public">';
    installAdminPwaDocument(document);
    removeAdminPwaDocument(document);

    expect(document.querySelector('link[rel="manifest"]')).toBeNull();
    expect(document.querySelector('meta[name="description"]')?.content).toBe('public');
  });

  it('does not create the compatibility prompt alias before administrative startup', () => {
    expect(Object.hasOwn(window, 'deferredPwaPrompt')).toBe(false);
  });

  it('captures beforeinstallprompt once and exposes the existing compatibility alias', () => {
    const readyListener = vi.fn();
    const preventDefault = vi.fn();
    window.addEventListener('lanzo-pwa-ready', readyListener);

    const firstCleanup = startAdminInstallPromptCapture(window);
    const secondCleanup = startAdminInstallPromptCapture(window);
    const promptEvent = new Event('beforeinstallprompt');
    promptEvent.preventDefault = preventDefault;
    window.dispatchEvent(promptEvent);

    expect(firstCleanup).toBe(secondCleanup);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.deferredPwaPrompt).toBe(promptEvent);
    expect(readyListener).toHaveBeenCalledOnce();
    window.removeEventListener('lanzo-pwa-ready', readyListener);
  });

  it('clears the deferred event after appinstalled', () => {
    startAdminInstallPromptCapture(window);
    window.deferredPwaPrompt = { prompt: vi.fn() };

    window.dispatchEvent(new Event('appinstalled'));

    expect(window.deferredPwaPrompt).toBeNull();
  });

  it('removes both install listeners when the capture is stopped', () => {
    startAdminInstallPromptCapture(window);
    stopAdminInstallPromptCapture();
    const promptEvent = new Event('beforeinstallprompt');

    window.dispatchEvent(promptEvent);
    window.dispatchEvent(new Event('appinstalled'));

    expect(window.deferredPwaPrompt).toBeNull();
  });
});
