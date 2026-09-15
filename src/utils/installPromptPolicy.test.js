import { describe, expect, it } from 'vitest';
import {
  INSTALL_ENGAGEMENT_THRESHOLD_MS,
  flushActiveEngagement,
  getInstallPromptEligibility,
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
});
