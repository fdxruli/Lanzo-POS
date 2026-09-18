import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      licenseDetails: { plan_code: 'free', features: {} },
      currentDeviceRole: 'admin'
    })
  }
}));

vi.mock('../../tenant/tenantScopedStorage', () => ({
  getTenantStorageItem: vi.fn(() => null),
  setTenantStorageItem: vi.fn()
}));

import {
  CUSTOMER_MESSAGE_OUTBOX_STATUSES,
  buildCustomerMessageOutboxIdempotencyKey,
  canTransitionCustomerMessageOutbox,
  createCustomerMessageOutboxRepository,
  downloadCustomerMessageOutbox,
  payloadContainsTechnicalIds,
  prepareCustomerMessageOutbox,
  shareCustomerMessageOutbox
} from '../outbox';

const defaultTemplate = {
  source: 'default',
  revision: 0,
  template: null
};

const customTemplate = (revision = 7, body = 'Total {{sale.total}}') => ({
  source: 'custom',
  revision,
  template: {
    schemaVersion: 1,
    title: 'Comprobante personalizado',
    body,
    footer: 'Gracias'
  }
});

const payload = ({
  eventType = 'sale_paid',
  phone = '+525512345678',
  saleId = 'sale-tech-123',
  paymentId = null,
  layawayId = null,
  occurredAt = '2026-09-18T20:00:00.000Z'
} = {}) => ({
  eventType,
  customer: { id: 'customer-tech-1', name: 'Cliente Prueba', phone },
  business: { id: 'business-tech-1', name: 'Farmacia Gary Chrome' },
  occurredAt,
  currency: 'MXN',
  reference: 'V-000123',
  sale: {
    id: saleId,
    folio: 'V-000123',
    items: [{ id: 'line-tech-1', productId: 'product-tech-1', name: 'Producto', quantity: 1, price: '100.00' }],
    total: '100.00',
    paymentMethod: eventType === 'sale_credit' ? 'credit' : 'cash',
    balanceDue: eventType === 'sale_credit' ? '100.00' : '0.00'
  },
  payment: {
    id: paymentId,
    reference: paymentId ? 'AB-000123' : null,
    occurredAt,
    method: 'cash',
    previousBalance: '100.00',
    amount: '40.00',
    newBalance: eventType === 'account_settled' ? '0.00' : '60.00'
  },
  account: {
    totalBalance: eventType === 'account_settled' ? '0.00' : '60.00',
    pendingNotes: [{ id: 'note-tech-1', folio: 'V-000099', balanceDue: '60.00' }]
  },
  layaway: {
    id: layawayId,
    reference: layawayId ? 'AP-20260918-200000' : null,
    items: [{ id: 'lay-line-tech', name: 'Producto apartado', quantity: 1, price: '100.00' }],
    total: '100.00',
    initialPayment: '20.00',
    paymentAmount: '20.00',
    totalPaid: '20.00',
    balanceDue: '80.00',
    status: 'active'
  },
  internalContext: {
    source: 'test',
    actorKey: 'actor-tech-1'
  }
});

const createMemoryRepository = ({ nowValue = Date.parse('2026-09-18T20:00:00.000Z'), config = {} } = {}) => {
  let raw = null;
  let clock = nowValue;
  const repository = createCustomerMessageOutboxRepository({
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; },
    now: () => clock,
    config
  });
  return {
    repository,
    advance(ms) { clock += ms; },
    raw: () => raw
  };
};

const prepare = (repository, messagePayload = payload(), options = {}) => prepareCustomerMessageOutbox({
  payload: messagePayload,
  repository,
  resolvedTemplate: options.resolvedTemplate || defaultTemplate,
  licenseDetails: options.licenseDetails || { plan_code: 'free', features: {} },
  actorType: options.actorType || 'admin',
  now: options.now
});

const successfulImage = {
  ok: true,
  file: { name: 'comprobante.png' },
  blob: {},
  filename: 'comprobante.png',
  mimeType: 'image/png'
};

describe('customer messaging reliable outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'sale_paid',
    'sale_credit',
    'payment_partial',
    'account_settled',
    'layaway_created',
    'account_statement'
  ])('prepares a durable outbox record for %s', async (eventType) => {
    const { repository } = createMemoryRepository();
    const messagePayload = payload({
      eventType,
      paymentId: ['payment_partial', 'account_settled'].includes(eventType) ? 'ledger-tech-1' : null,
      layawayId: eventType === 'layaway_created' ? 'layaway-tech-1' : null
    });

    const result = await prepare(repository, messagePayload);

    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      record: {
        eventType,
        messageType: eventType,
        channel: 'image',
        status: 'preparado',
        attemptCount: 0
      }
    });
    expect(repository.list()).toHaveLength(1);
  });

  it('uses one idempotent record for double click, StrictMode-style repeats, reload and receipt reopen', async () => {
    const { repository } = createMemoryRepository();
    const messagePayload = payload();

    const [first, repeated] = await Promise.all([
      prepare(repository, messagePayload),
      prepare(repository, messagePayload)
    ]);
    const afterReload = await prepare(repository, structuredClone(messagePayload));
    const reopenedReceipt = await prepare(repository, structuredClone(messagePayload));

    expect(first.record.idempotencyKey).toBe(repeated.record.idempotencyKey);
    expect(afterReload.record.idempotencyKey).toBe(first.record.idempotencyKey);
    expect(reopenedReceipt.record.idempotencyKey).toBe(first.record.idempotencyKey);
    expect(repository.list()).toHaveLength(1);
    expect([repeated.duplicate, afterReload.duplicate, reopenedReceipt.duplicate]).toContain(true);
  });

  it('derives the key from technical operation identity without persisting those ids in the renderer snapshot', async () => {
    const { repository } = createMemoryRepository();
    const firstPayload = payload({ saleId: 'sale-tech-A' });
    const secondPayload = payload({ saleId: 'sale-tech-B' });

    expect(buildCustomerMessageOutboxIdempotencyKey(firstPayload))
      .not.toBe(buildCustomerMessageOutboxIdempotencyKey(secondPayload));

    const result = await prepare(repository, firstPayload);
    expect(payloadContainsTechnicalIds(result.record.payloadSnapshot)).toBe(false);
    expect(JSON.stringify(result.record.payloadSnapshot)).not.toContain('sale-tech-A');
    expect(JSON.stringify(result.record.payloadSnapshot)).not.toContain('customer-tech-1');
    expect(JSON.stringify(result.record.payloadSnapshot)).not.toContain('line-tech-1');
  });

  it('never passes technical ids to the renderer', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());
    const render = vi.fn(async () => successfulImage);
    const share = vi.fn(async () => ({ status: 'shared', code: null }));

    const result = await shareCustomerMessageOutbox({
      record: prepared.record,
      repository,
      render,
      share
    });

    expect(result.record.status).toBe('compartido');
    expect(render).toHaveBeenCalledOnce();
    const renderedPayload = render.mock.calls[0][0];
    expect(payloadContainsTechnicalIds(renderedPayload)).toBe(false);
    expect(JSON.stringify(renderedPayload)).not.toContain('tech-');
  });

  it('coalesces concurrent share retries so double click does not create a second attempt', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());
    const render = vi.fn(async () => successfulImage);
    const share = vi.fn(async () => ({ status: 'shared', code: null }));

    const [first, second] = await Promise.all([
      shareCustomerMessageOutbox({ record: prepared.record, repository, render, share }),
      shareCustomerMessageOutbox({ record: prepared.record, repository, render, share })
    ]);

    expect(first.record.idempotencyKey).toBe(second.record.idempotencyKey);
    expect(share).toHaveBeenCalledTimes(1);
    expect(repository.list()).toHaveLength(1);
    expect(repository.get(prepared.record.idempotencyKey)).toMatchObject({
      status: 'compartido',
      shareAttemptCount: 1
    });
  });

  it('records user cancellation honestly and does not call any financial operation on retry', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());
    const financialOperation = vi.fn(() => ({ success: true }));
    const financialResult = financialOperation();
    const render = vi.fn(async () => successfulImage);

    const cancelled = await shareCustomerMessageOutbox({
      record: prepared.record,
      repository,
      render,
      share: vi.fn(async () => ({ status: 'cancelled', code: 'IMAGE_SHARE_CANCELLED' }))
    });
    const retried = await shareCustomerMessageOutbox({
      record: cancelled.record,
      repository,
      render,
      share: vi.fn(async () => ({ status: 'shared', code: null }))
    });

    expect(financialResult).toEqual({ success: true });
    expect(financialOperation).toHaveBeenCalledTimes(1);
    expect(cancelled.record.status).toBe('cancelado_por_usuario');
    expect(retried.record.status).toBe('compartido');
    expect(repository.list()).toHaveLength(1);
  });

  it('keeps a failed Web Share attempt retryable and allows manual download without duplicating the record', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());
    const render = vi.fn(async () => successfulImage);

    const failedShare = await shareCustomerMessageOutbox({
      record: prepared.record,
      repository,
      render,
      share: vi.fn(async () => ({
        status: 'failed',
        code: 'IMAGE_SHARE_FAILED',
        canDownload: true
      }))
    });

    expect(failedShare.record).toMatchObject({
      status: 'reintento_pendiente',
      lastErrorCode: 'IMAGE_SHARE_FAILED',
      attemptCount: 1,
      shareAttemptCount: 1
    });
    expect(failedShare.record.nextRetryAt).toBeTruthy();

    const downloaded = await downloadCustomerMessageOutbox({
      record: failedShare.record,
      repository,
      render,
      download: vi.fn(() => ({ status: 'downloaded', code: null }))
    });

    expect(downloaded.record.status).toBe('descarga_generada');
    expect(repository.list()).toHaveLength(1);
  });

  it('records browser incompatibility as a generated download, never as delivered', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());

    const result = await shareCustomerMessageOutbox({
      record: prepared.record,
      repository,
      render: vi.fn(async () => successfulImage),
      share: vi.fn(async () => ({ status: 'downloaded', code: null }))
    });

    expect(result.record).toMatchObject({
      status: 'descarga_generada',
      lastErrorCode: 'WEB_SHARE_UNAVAILABLE_OR_INCOMPATIBLE'
    });
    expect(JSON.stringify(result.record).toLowerCase()).not.toContain('entregado');
    expect(JSON.stringify(result.record).toLowerCase()).not.toContain('recibido');
  });

  it('classifies render failures without changing the outbox identity', async () => {
    const { repository } = createMemoryRepository();
    const prepared = await prepare(repository, payload());

    const result = await shareCustomerMessageOutbox({
      record: prepared.record,
      repository,
      render: vi.fn(async () => ({ ok: false, code: 'IMAGE_RENDER_FAILED' })),
      share: vi.fn()
    });

    expect(result.ok).toBe(false);
    expect(result.record.idempotencyKey).toBe(prepared.record.idempotencyKey);
    expect(result.record.status).toBe('reintento_pendiente');
    expect(repository.list()).toHaveLength(1);
  });

  it.each([
    [null, 'telefono_vacio', 'CUSTOMER_PHONE_MISSING'],
    ['', 'telefono_vacio', 'CUSTOMER_PHONE_MISSING'],
    ['telefono-invalido', 'telefono_invalido', 'CUSTOMER_PHONE_INVALID'],
    ['+525512345678', 'telefono_valido', null]
  ])('records contact readiness for phone %p', async (phone, status, code) => {
    const { repository } = createMemoryRepository();
    const result = await prepare(repository, payload({ phone }));

    expect(result.record.contactReadiness).toEqual({ status, code });
    expect(result.record.payloadSnapshot.customer).toEqual({ name: 'Cliente Prueba' });
  });

  it('forces generic templates for Staff and Free/Local, while Pro admin keeps the custom revision', async () => {
    const freeRepo = createMemoryRepository().repository;
    const staffRepo = createMemoryRepository().repository;
    const proRepo = createMemoryRepository().repository;
    const template = customTemplate(12);

    const free = await prepare(freeRepo, payload({ saleId: 'sale-free' }), {
      resolvedTemplate: template,
      licenseDetails: { plan_code: 'free', features: {} },
      actorType: 'admin'
    });
    const staff = await prepare(staffRepo, payload({ saleId: 'sale-staff' }), {
      resolvedTemplate: template,
      licenseDetails: { plan_code: 'pro_monthly', features: { customerMessageTemplates: true } },
      actorType: 'staff'
    });
    const pro = await prepare(proRepo, payload({ saleId: 'sale-pro' }), {
      resolvedTemplate: template,
      licenseDetails: { plan_code: 'pro_monthly', features: { customerMessageTemplates: true } },
      actorType: 'admin'
    });

    expect(free.record).toMatchObject({ templateSource: 'default', templateRevision: 0, templateSnapshot: null });
    expect(staff.record).toMatchObject({ templateSource: 'default', templateRevision: 0, templateSnapshot: null });
    expect(pro.record).toMatchObject({ templateSource: 'custom', templateRevision: 12 });
    expect(pro.record.templateSnapshot.body).toBe('Total {{sale.total}}');
  });

  it('keeps the template revision used at preparation even after the repository template is restored or changed', async () => {
    const { repository } = createMemoryRepository();
    const messagePayload = payload();
    const first = await prepare(repository, messagePayload, {
      resolvedTemplate: customTemplate(7, 'Revision siete'),
      licenseDetails: { plan_code: 'pro_monthly', features: { customerMessageTemplates: true } },
      actorType: 'admin'
    });

    const repeatedAfterRestore = await prepare(repository, messagePayload, {
      resolvedTemplate: customTemplate(8, 'Revision ocho'),
      licenseDetails: { plan_code: 'pro_monthly', features: { customerMessageTemplates: true } },
      actorType: 'admin'
    });
    const render = vi.fn(async () => successfulImage);

    await shareCustomerMessageOutbox({
      record: repeatedAfterRestore.record,
      repository,
      render,
      share: vi.fn(async () => ({ status: 'shared', code: null }))
    });

    expect(first.record.templateRevision).toBe(7);
    expect(repeatedAfterRestore).toMatchObject({ duplicate: true });
    expect(repeatedAfterRestore.record.templateRevision).toBe(7);
    expect(render.mock.calls[0][1].template.body).toBe('Revision siete');
  });

  it('isolates records when the tenant-scoped storage namespace changes', async () => {
    const storageByTenant = new Map();
    let tenant = 'tenant-a';
    const repository = createCustomerMessageOutboxRepository({
      getItem: (key) => storageByTenant.get(`${tenant}:${key}`) || null,
      setItem: (key, value) => storageByTenant.set(`${tenant}:${key}`, value),
      now: () => Date.parse('2026-09-18T20:00:00.000Z')
    });

    const tenantA = await prepare(repository, payload({ saleId: 'shared-tech-id' }));
    expect(repository.list()).toHaveLength(1);

    tenant = 'tenant-b';
    expect(repository.list()).toEqual([]);
    const tenantB = await prepare(repository, payload({ saleId: 'shared-tech-id' }));

    expect(tenantB.record.idempotencyKey).toBe(tenantA.record.idempotencyKey);
    expect(repository.list()).toHaveLength(1);

    tenant = 'tenant-a';
    expect(repository.list()).toHaveLength(1);
    expect(repository.get(tenantA.record.idempotencyKey)?.createdAt).toBe(tenantA.record.createdAt);
  });

  it('accepts only controlled outbox states and controlled transitions', () => {
    expect(CUSTOMER_MESSAGE_OUTBOX_STATUSES).toEqual([
      'preparado',
      'compartido',
      'descarga_generada',
      'cancelado_por_usuario',
      'error',
      'reintento_pendiente'
    ]);
    expect(canTransitionCustomerMessageOutbox('preparado', 'compartido')).toBe(true);
    expect(canTransitionCustomerMessageOutbox('cancelado_por_usuario', 'reintento_pendiente')).toBe(true);
    expect(canTransitionCustomerMessageOutbox('preparado', 'entregado')).toBe(false);
    expect(canTransitionCustomerMessageOutbox('received', 'compartido')).toBe(false);
  });

  it('caps automatic retry eligibility while preserving the explicit download action', async () => {
    const { repository } = createMemoryRepository({ config: { maxAttempts: 2 } });
    const prepared = await prepare(repository, payload());
    const render = vi.fn(async () => successfulImage);
    const failedShare = vi.fn(async () => ({ status: 'failed', code: 'IMAGE_SHARE_FAILED', canDownload: true }));

    const first = await shareCustomerMessageOutbox({ record: prepared.record, repository, render, share: failedShare });
    const second = await shareCustomerMessageOutbox({ record: first.record, repository, render, share: failedShare });
    const third = await shareCustomerMessageOutbox({ record: second.record, repository, render, share: failedShare });

    expect(first.record.status).toBe('reintento_pendiente');
    expect(second.record.status).toBe('error');
    expect(third).toMatchObject({ ok: false, code: 'OUTBOX_MAX_ATTEMPTS_REACHED' });
    expect(failedShare).toHaveBeenCalledTimes(2);

    const downloaded = await downloadCustomerMessageOutbox({
      record: third.record,
      repository,
      render,
      download: vi.fn(() => ({ status: 'downloaded', code: null }))
    });
    expect(downloaded.record.status).toBe('descarga_generada');
  });
});
