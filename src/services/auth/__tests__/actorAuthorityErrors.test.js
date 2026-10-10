import { describe, expect, it } from 'vitest';
import { classifyActorAuthorityError } from '../actorAuthorityErrors';

describe('actor authority error classification', () => {
  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'])('recognizes PostgREST P0001 %s and wrapped RPC errors', (code) => {
    const error = new Error('No se pudo consultar restaurante', {
      cause: { code: 'P0001', message: code }
    });
    expect(classifyActorAuthorityError(error, { actorType: 'staff' })).toMatchObject({
      kind: 'device_auth', code, requiresReauthentication: true,
      reason: 'device_auth_reauthentication_required', actorType: 'staff'
    });
  });

  it('distinguishes the valid foreign-tab lock from device authentication', () => {
    expect(classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, {
      actorType: 'admin', reason: 'actor_context_changed_in_other_tab'
    })).toMatchObject({ kind: 'foreign_tab', requiresReauthentication: true });
  });

  it.each(['ACTOR_CONTEXT_STALE', 'ACTOR_SESSION_REQUIRED', 'STAFF_SESSION_INVALID', 'ADMIN_SESSION_EXPIRED'])('requires real authentication for %s', (code) => {
    expect(classifyActorAuthorityError({ code })?.requiresReauthentication).toBe(true);
  });

  it.each(['NETWORK_ERROR', 'RATE_LIMITED', 'INSUFFICIENT_STOCK', 'BUSINESS_ERROR'])('does not turn %s into identity loss', (code) => {
    expect(classifyActorAuthorityError({ code })).toBeNull();
  });

  it('does not request login for a permission denial or discarded response', () => {
    expect(classifyActorAuthorityError({ code: 'ACTOR_PERMISSION_DENIED' })).toMatchObject({
      kind: 'permission_denied', requiresReauthentication: false
    });
    expect(classifyActorAuthorityError({ code: 'CLOUD_REQUEST_RESPONSE_STALE', cause: { code: 'DEVICE_TOKEN_INVALID' } })).toMatchObject({
      kind: 'response_stale', requiresReauthentication: false
    });
  });

  it.each(['DEVICE_NOT_ALLOWED', 'DEVICE_NOT_ACTIVE', 'DEVICE_RELEASED', 'CLONING_DETECTED'])('preserves the hard security block for %s', (code) => {
    expect(classifyActorAuthorityError({ code })).toMatchObject({ requiresReauthentication: false });
  });

  it('distinguishes voluntary logout and failed handoff', () => {
    expect(classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, {
      reason: 'admin_logout'
    })).toMatchObject({ kind: 'logout', requiresReauthentication: false });
    expect(classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, {
      reason: 'actor_handoff_failed'
    })).toMatchObject({ kind: 'bootstrap_failed', requiresReauthentication: true });
  });

  it('recognizes canonical validation reasons without using them as UI messages', () => {
    expect(classifyActorAuthorityError({ valid: false, reason: 'DEVICE_TOKEN_REQUIRED' })).toMatchObject({
      kind: 'device_auth', requiresReauthentication: true
    });
    expect(classifyActorAuthorityError({ code: 'P0001', details: 'DEVICE_TOKEN_INVALID' })).toMatchObject({ kind: 'device_auth' });
    expect(classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, { reason: 'admin_actor_logged_out' })).toMatchObject({
      kind: 'logout', requiresReauthentication: false
    });
  });

  it('never derives a user message from RPC details or security metadata', () => {
    const result = classifyActorAuthorityError({ code: 'P0001', message: 'DEVICE_TOKEN_INVALID token=secret',
      details: { actorKey: 'admin:private', fingerprint: 'private-device' } });
    expect(result.message).toContain('sesión');
    expect(result.message).not.toMatch(/DEVICE_TOKEN|secret|private|fingerprint|actorKey/);
  });

  it('handles cyclic causes without accepting a similarly named business code', () => {
    const error = { code: 'MY_DEVICE_TOKEN_INVALID_INVENTORY' };
    error.cause = error;
    expect(classifyActorAuthorityError(error)).toBeNull();
  });
});
