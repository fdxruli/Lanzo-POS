import { describe, expect, it } from 'vitest';
import { customerSchema } from '../../../schemas/customerSchema';
import {
  buildPendingCustomer,
  cloudCustomerToLocal,
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

  it('preserves debtCents as cents in Cloud payloads and derives cents only when absent', () => {
    expect(localCustomerToCloudPayload({ id: 'cents', debt: 22, debtCents: 2200 }).debt_cents).toBe(2200);
    expect(localCustomerToCloudPayload({ id: 'amount', debt: 22 }).debt_cents).toBe(2200);
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
});
