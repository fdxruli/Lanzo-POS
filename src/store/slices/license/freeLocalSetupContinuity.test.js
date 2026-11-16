// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFreeLocalSetupContinuity,
  FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY,
  hasFreeLocalSetupContinuity,
  markFreeLocalSetupContinuity
} from './freeLocalSetupContinuity';

beforeEach(() => localStorage.clear());

describe('Free/Local setup continuity marker', () => {
  it('is bound to the exact license and current browser origin', () => {
    expect(markFreeLocalSetupContinuity('FREE-NEW')).toBe(true);
    expect(hasFreeLocalSetupContinuity('FREE-NEW')).toBe(true);
    expect(hasFreeLocalSetupContinuity('FREE-OTHER')).toBe(false);

    localStorage.setItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY, JSON.stringify({
      version: 1,
      licenseKey: 'FREE-NEW',
      origin: 'https://different-origin.example'
    }));
    expect(hasFreeLocalSetupContinuity('FREE-NEW')).toBe(false);
  });

  it('clears only the matching license marker', () => {
    markFreeLocalSetupContinuity('FREE-NEW');

    expect(clearFreeLocalSetupContinuity('FREE-OTHER')).toBe(false);
    expect(hasFreeLocalSetupContinuity('FREE-NEW')).toBe(true);
    expect(clearFreeLocalSetupContinuity('FREE-NEW')).toBe(true);
    expect(hasFreeLocalSetupContinuity('FREE-NEW')).toBe(false);
  });

  it('fails closed for malformed local state', () => {
    localStorage.setItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY, '{bad-json');

    expect(hasFreeLocalSetupContinuity('FREE-NEW')).toBe(false);
  });
});
