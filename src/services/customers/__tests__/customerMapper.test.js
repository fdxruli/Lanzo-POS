import { describe, expect, it } from 'vitest';
import { customerSchema } from '../../../schemas/customerSchema';
import {
  buildPendingCustomer,
  cloudCustomerToLocal,
  localCustomerToLegacyMigrationPayload,
  localCustomerToCloudPayload,
  normalizeCustomerForLocal
} from '../customerMapper';

describe('customer serverVersion mapping', () => {
  it('keeps absent versions absent and normalizes legacy zero during a controlled local save', () => {
    expect(normalizeCustomerForLocal({ id: 'new', name: 'Nuevo', phone: '55' }).serverVersion).toBeNull();

    const historic = {
      id: 'historic', name: 'Histórico', phone: '55', serverVersion: 0,
      debt: 125, debtCents: 12500, creditLimit: 300
    };
    const normalized = normalizeCustomerForLocal(historic, historic);

    expect(normalized).toMatchObject({
      id: 'historic', serverVersion: null, debt: 125, debtCents: 12500,
      creditLimit: 300
    });
  });

  it('keeps a previously known positive version on a pending local edit', () => {
    const existing = {
      id: 'known-version', name: 'Cliente', phone: '55', serverVersion: 7,
      syncStatus: 'synced', debt: 40, debtCents: 4000, creditLimit: 100
    };
    const pending = buildPendingCustomer(
      { ...existing, name: 'Cliente editado', serverVersion: null },
      existing,
      { operationId: 'operation-1' }
    );

    expect(pending).toMatchObject({
      id: 'known-version', serverVersion: 7, syncStatus: 'pending',
      pendingOperationId: 'operation-1', debt: 40, debtCents: 4000,
      creditLimit: 100
    });
  });

  it('keeps the ordinary directory payload free of debt and financial metadata', () => {
    const payload = localCustomerToCloudPayload({
      id: 'directory', name: 'Cliente', debt: 22, debtCents: 2200,
      creditLimit: 100, metadata: { debt: 22, debt_cents: 2200 }
    });

    expect(payload).toMatchObject({ id: 'directory', credit_limit: 100 });
    expect(payload).not.toHaveProperty('debt');
    expect(payload).not.toHaveProperty('debt_cents');
    expect(payload.metadata).not.toHaveProperty('debt');
    expect(payload.metadata).not.toHaveProperty('debt_cents');
  });

  it('keeps the $50 directory step in the form contract while allowing exact legacy credit limits', () => {
    expect(() => localCustomerToCloudPayload({ creditLimit: 'texto' })).toThrow('INVALID_CUSTOMER_CREDIT_LIMIT');
    expect(() => localCustomerToCloudPayload({ creditLimit: '50.001' })).toThrow('INVALID_CUSTOMER_CREDIT_LIMIT');
    expect(localCustomerToCloudPayload({ creditLimit: 50.25 }).credit_limit).toBe(50.25);
  });

  it('serializes $22 exactly once for the isolated legacy migration contract', () => {
    expect(localCustomerToLegacyMigrationPayload({ id: 'peso', debt: 22 })).toMatchObject({ debt: 22, debt_cents: 2200 });
    expect(localCustomerToLegacyMigrationPayload({ id: 'cents', debt: 22, debtCents: 2200 }))
      .toMatchObject({ debt: 22, debt_cents: 2200 });
    expect(localCustomerToLegacyMigrationPayload({ id: 'cents-only', debtCents: 2200 }))
      .toMatchObject({ debt: 22, debt_cents: 2200 });
    expect(localCustomerToLegacyMigrationPayload({ id: 'zero' })).toMatchObject({ debt: 0, debt_cents: 0 });
  });

  it('blocks inconsistent or invalid historical balances instead of silently replacing them with zero', () => {
    expect(() => localCustomerToLegacyMigrationPayload({ id: 'mismatch', debt: 22, debtCents: 22 }))
      .toThrow('INCONSISTENT_LEGACY_CUSTOMER_DEBT');
    expect(() => localCustomerToLegacyMigrationPayload({ id: 'bad-money', debt: '22oops' }))
      .toThrow('INVALID_LEGACY_CUSTOMER_DEBT');
    expect(() => localCustomerToLegacyMigrationPayload({ id: 'bad-cents', debt: 22, debtCents: -1 }))
      .toThrow('INVALID_LEGACY_CUSTOMER_DEBT_CENTS');
    expect(() => localCustomerToLegacyMigrationPayload({ id: 'out-of-range', debtCents: 2147483648 }))
      .toThrow('INVALID_LEGACY_CUSTOMER_DEBT_CENTS');
  });

  it('keeps historical debt out of the normal directory metadata contract', () => {
    const directory = localCustomerToCloudPayload({ id: 'metadata', debt: 125, debtCents: 12500 });
    expect(directory.metadata).toEqual({ source: 'lanzo_pos_frontend', phase: 'fase1_customers_directory' });
  });

  it('preserves a positive Cloud version and rejects an invalid remote version', () => {
    const remote = {
      id: 'cloud-1', name: 'Cloud', phone: '55', debt: 0, debt_cents: 0,
      credit_limit: 50, server_version: 3
    };

    expect(cloudCustomerToLocal(remote).serverVersion).toBe(3);
    expect(() => cloudCustomerToLocal({ ...remote, server_version: 0 }))
      .toThrow('INVALID_CUSTOMER_SERVER_VERSION');
    expect(() => cloudCustomerToLocal({ ...remote, server_version: '3.5' }))
      .toThrow('INVALID_CUSTOMER_SERVER_VERSION');
    expect(() => cloudCustomerToLocal({ ...remote, server_version: '' }))
      .toThrow('INVALID_CUSTOMER_SERVER_VERSION');
  });

  it('validates null and positive versions but does not coerce zero or invalid text', () => {
    const base = { id: 'customer', name: 'Cliente', phone: '', debt: 0 };
    expect(customerSchema.safeParse({ ...base }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, serverVersion: null }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, serverVersion: '4' }).data.serverVersion).toBe(4);
    expect(customerSchema.safeParse({ ...base, serverVersion: 0 }).data.serverVersion).toBeNull();
    expect(customerSchema.safeParse({ ...base, serverVersion: '' }).data.serverVersion).toBeNull();
  });

  it('rejects non-finite and sub-cent credit limits in the storage schema', () => {
    const base = { id: 'customer', name: 'Cliente', phone: '', debt: 0 };
    expect(customerSchema.safeParse({ ...base, creditLimit: 0 }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, creditLimit: Infinity }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, creditLimit: NaN }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, creditLimit: 50.001 }).success).toBe(false);
  });
});
