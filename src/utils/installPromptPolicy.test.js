// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  INSTALL_ENGAGEMENT_THRESHOLD_MS,
  flushActiveEngagement,
  getInstallPromptEligibility,
  hasBlockingModal,
  pauseActiveEngagement,
  startActiveEngagement,
} from './installPromptPolicy';

const eligibleState = (overrides = {}) => ({
  appStatus: 'ready',
  isInstallable: true,
  isStandalone: false,
  isIOS: false,
  deferredPrompt: { prompt: () => {} },
  showUpdateModal: false,
  pendingTermsUpdate: null,
  isStorageCritical: false,
  hasBlockingModal: false,
  engagement: { invitationEnabled: true },
  dismissed: false,
  ...overrides,
});

describe('installPromptPolicy', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('accumulates visible engagement and enables the invitation at five minutes', () => {
    const started = startActiveEngagement({ activeTimeMs: 0 }, 1_000);
    const completed = flushActiveEngagement(
      started,
      1_000 + INSTALL_ENGAGEMENT_THRESHOLD_MS
    );

    expect(completed.activeTimeMs).toBe(INSTALL_ENGAGEMENT_THRESHOLD_MS);
    expect(completed.invitationEnabled).toBe(true);
  });

  it('does not accumulate time while paused/hidden', () => {
    const started = startActiveEngagement({ activeTimeMs: 1_000 }, 10_000);
    const paused = pauseActiveEngagement(started, 20_000);

    expect(paused.activeTimeMs).toBe(11_000);
    expect(flushActiveEngagement(paused, 60_000).activeTimeMs).toBe(11_000);
  });

  it('fails closed for install, update, storage, or modal conflicts', () => {
    for (const conflict of [
      { isInstallable: false },
      { isStandalone: true },
      { deferredPrompt: null },
      { showUpdateModal: true },
      { pendingTermsUpdate: { id: 'terms' } },
      { isStorageCritical: true },
      { hasBlockingModal: true },
      { dismissed: true },
      { appStatus: 'setup_required' },
    ]) {
      expect(getInstallPromptEligibility(eligibleState(conflict))).toBe(false);
    }
  });

  it('only treats visible modal candidates as blocking, except for the explicit pending marker', () => {
    document.body.innerHTML = `
      <div class="modal" hidden></div>
      <div class="ui-modal" aria-hidden="true"></div>
      <div role="dialog" style="display: none"></div>
    `;
    expect(hasBlockingModal()).toBe(false);

    document.body.innerHTML = '<div class="modal" style="display: block"></div>';
    expect(hasBlockingModal()).toBe(true);

    document.body.innerHTML = '<div data-lanzo-blocking-modal="true" data-lanzo-notice-pending="true" hidden></div>';
    expect(hasBlockingModal()).toBe(true);
  });
});
