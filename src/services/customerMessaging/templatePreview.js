import { buildCustomerMessagePayload } from './payloadBuilder';

const source = (eventType) => ({
  eventType,
  customer: { id: 'preview-customer', name: 'María Cliente' },
  business: { name: 'Lanzo Pruebas' },
  occurredAt: '2026-09-18T16:30:00.000Z',
  currency: 'MXN',
  reference: 'V-1024',
  sale: { id: 'preview-sale', folio: 'V-1024', items: [{ name: 'Producto de ejemplo', quantity: 2, total: '250.00' }], total: '250.00', receivedAmount: '300.00', balanceDue: '50.00', paymentMethod: 'cash', dueDate: '2026-09-30', creditStatus: 'Pendiente' },
  payment: { id: 'preview-payment', reference: 'AB-220', amount: '100.00', previousBalance: '350.00', newBalance: eventType === 'account_settled' ? '0.00' : '250.00', method: 'transfer' },
  account: { totalBalance: '250.00', totalPayments: '100.00', cutoffAt: '2026-09-18', pendingNotes: [{ reference: 'N-10', balanceDue: '250.00' }] },
  layaway: { id: 'preview-layaway', reference: 'APA-100', total: '500.00', initialPayment: '100.00', paymentAmount: '100.00', totalPaid: eventType === 'layaway_settled' ? '500.00' : '200.00', balanceDue: eventType === 'layaway_settled' ? '0.00' : '300.00', deadline: '2026-09-30', status: eventType === 'layaway_cancelled' ? 'Cancelado' : 'Pendiente', saleFolio: 'V-1024' }
});

export const buildCustomerMessageTemplatePreviewPayload = (eventType) => {
  const result = buildCustomerMessagePayload(source(eventType));
  return result.ok ? result.payload : null;
};
