// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostDowngradeCashAttentionKey,
  clearPostDowngradeCashAttention,
  markPostDowngradeCashAttentionDisplayed,
  markPostDowngradeCashAttentionRead,
  postponePostDowngradeCashAttention,
  readPostDowngradeCashAttention,
  resetPostDowngradeCashAttentionMemory
} from './postDowngradeCashAttention';

const asTestDigest = async (_algorithm, data) => {
  const input = new TextDecoder().decode(data);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < input.length; index += 1) {
    bytes[index % bytes.length] = (bytes[index % bytes.length] + input.charCodeAt(index)) % 256;
  }
  return bytes.buffer;
};

const createKey = (overrides = {}) => buildPostDowngradeCashAttentionKey({
  scopeKey: 'LANZO-SECRET-123:owner-secret',
  downgradedAt: '2026-09-24T05:53:00.000Z',
  previousPlanCode: 'pro_monthly',
  currentPlanCode: 'free_trial',
  ...overrides
});

beforeEach(() => {
  localStorage.clear();
  resetPostDowngradeCashAttentionMemory();
  vi.stubGlobal('crypto', { subtle: { digest: asTestDigest } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPostDowngradeCashAttentionMemory();
});

describe('post-downgrade cash attention state', () => {
  it('derives opaque keys isolated by business, owner, and downgrade event', async () => {
    const base = await createKey();
    const otherOwner = await createKey({ scopeKey: 'LANZO-SECRET-123:owner-b' });
    const otherEvent = await createKey({ downgradedAt: '2026-10-17T00:00:00.000Z' });

    expect(base).toMatch(/^lanzo_post_downgrade_cash_attention:v1:[a-f0-9]{64}$/);
    expect(base).not.toContain('LANZO-SECRET');
    expect(base).not.toContain('owner-secret');
    expect(otherOwner).not.toBe(base);
    expect(otherEvent).not.toBe(base);
  });

  it('persists read and postpone separately without storing license or financial data', async () => {
    const key = await createKey();
    const now = new Date('2026-10-17T06:00:00.000Z');

    const displayed = markPostDowngradeCashAttentionDisplayed(key, now);
    expect(displayed).toEqual({
      version: 1,
      readAt: now.toISOString(),
      postponedAt: null
    });
    expect(readPostDowngradeCashAttention(key)).toEqual(displayed);

    const postponed = postponePostDowngradeCashAttention(
      key,
      new Date('2026-10-17T06:01:00.000Z')
    );
    expect(postponed).toEqual({
      version: 1,
      readAt: now.toISOString(),
      postponedAt: '2026-10-17T06:01:00.000Z'
    });

    const stored = localStorage.getItem(key);
    expect(stored).not.toContain('LANZO-SECRET');
    expect(stored).not.toContain('cash-');
    expect(stored).not.toContain('count');
  });

  it('lets drawer acknowledgment mark the notice read without resolving the task', async () => {
    const key = await createKey();
    const record = markPostDowngradeCashAttentionRead(key, {
      now: new Date('2026-10-17T06:02:00.000Z'),
      source: 'local-alerts'
    });

    expect(record.readAt).toBe('2026-10-17T06:02:00.000Z');
    expect(record.postponedAt).toBeNull();
    expect(readPostDowngradeCashAttention(key).readAt).not.toBeNull();
  });

  it('clears attention metadata only when the caller confirms resolution', async () => {
    const key = await createKey();
    markPostDowngradeCashAttentionDisplayed(key);
    clearPostDowngradeCashAttention(key);

    expect(localStorage.getItem(key)).toBeNull();
    expect(readPostDowngradeCashAttention(key)).toMatchObject({
      version: 1,
      readAt: null,
      postponedAt: null
    });
  });
});
