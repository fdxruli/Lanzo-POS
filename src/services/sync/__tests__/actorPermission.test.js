import { describe, expect, it } from 'vitest';
import { ACTOR_RUNTIME_STATUS } from '../../auth/actorRuntimeController';
import { hasActorAnyPermission, hasActorPermission } from '../actorPermission';

describe('actor permission capability checks', () => {
  it('fails closed while the actor runtime is not granted', () => {
    expect(hasActorPermission({ status: ACTOR_RUNTIME_STATUS.LOCKED, permissions: ['customers'] }, 'customers')).toBe(false);
  });

  it('allows only explicitly granted staff permissions', () => {
    const state = { status: ACTOR_RUNTIME_STATUS.GRANTED, actorType: 'staff', permissions: ['pos', 'cash_register'] };

    expect(hasActorPermission(state, 'pos')).toBe(true);
    expect(hasActorPermission(state, 'customers')).toBe(false);
  });

  it('preserves Admin wildcard authority', () => {
    const admin = {
      status: ACTOR_RUNTIME_STATUS.GRANTED,
      actorType: 'admin',
      permissions: ['*']
    };

    expect(hasActorPermission(admin, 'customers')).toBe(true);
    expect(hasActorAnyPermission(admin, ['products', 'pos', 'inventory'])).toBe(true);
  });

  it('allows a handler capability when any listed permission is granted', () => {
    const state = { status: ACTOR_RUNTIME_STATUS.GRANTED, actorType: 'staff', permissions: ['pos'] };

    expect(hasActorAnyPermission(state, ['products', 'pos', 'inventory'])).toBe(true);
    expect(hasActorAnyPermission(state, ['customers', 'cash_register'])).toBe(false);
    expect(hasActorAnyPermission(state, 'pos')).toBe(true);
  });

  it('does not treat malformed or empty permission names as granted', () => {
    const state = { status: ACTOR_RUNTIME_STATUS.GRANTED, permissions: { customers: true } };

    expect(hasActorPermission(state, '')).toBe(false);
    expect(hasActorPermission(state, null)).toBe(false);
    expect(hasActorPermission(state, 'customers')).toBe(false);
  });
});
