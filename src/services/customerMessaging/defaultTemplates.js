import { CUSTOMER_MESSAGE_EVENT_TYPES } from './contracts';

export const CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION = 1;

const template = (title, body, footer = 'Gracias por tu compra.') => Object.freeze({
  schemaVersion: CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION, title, body, footer
});

export const CUSTOMER_MESSAGE_DEFAULT_TEMPLATES = Object.freeze({
  sale_paid: template('Recibo de venta', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\n{{sale.items}}\nTotal: {{sale.total}}\nMétodo de pago: {{sale.paymentMethodLabel}}'),
  sale_credit: template('Venta a crédito', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\n{{sale.items}}\nTotal: {{sale.total}}\nSaldo pendiente: {{sale.balanceDue}}\nMétodo de pago: {{sale.paymentMethodLabel}}'),
  account_statement: template('Estado de cuenta', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nSaldo total: {{account.totalBalance}}\n{{account.pendingNotes}}'),
  payment_partial: template('Comprobante de abono', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nImporte abonado: {{payment.amount}}\nSaldo restante: {{payment.newBalance}}\nMétodo de pago: {{payment.methodLabel}}'),
  account_settled: template('Cuenta saldada', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nImporte abonado: {{payment.amount}}\nSaldo restante: {{payment.newBalance}}\nMétodo de pago: {{payment.methodLabel}}'),
  layaway_created: template('Apartado creado', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nReferencia: {{layaway.reference}}\nTotal: {{layaway.total}}\nPago inicial: {{layaway.initialPayment}}\nSaldo pendiente: {{layaway.balanceDue}}'),
  layaway_payment: template('Abono de apartado', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nReferencia: {{layaway.reference}}\nImporte abonado: {{layaway.paymentAmount}}\nTotal abonado: {{layaway.totalPaid}}\nSaldo pendiente: {{layaway.balanceDue}}'),
  layaway_settled: template('Apartado liquidado', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nReferencia: {{layaway.reference}}\nTotal abonado: {{layaway.totalPaid}}\nSaldo pendiente: {{layaway.balanceDue}}'),
  layaway_delivered: template('Apartado entregado', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nReferencia: {{layaway.reference}}\nFolio de venta: {{layaway.saleFolio}}\nEstado: {{layaway.status}}'),
  layaway_cancelled: template('Apartado cancelado', '{{business.name}}\nCliente: {{customer.name}}\nFecha: {{occurredAt}}\nReferencia: {{layaway.reference}}\nEstado: {{layaway.status}}'),
  debt_reminder: template('Recordatorio de saldo', '{{business.name}}\nCliente: {{customer.name}}\nSaldo pendiente: {{account.totalBalance}}')
});

export const getDefaultCustomerMessageTemplate = (eventType) => CUSTOMER_MESSAGE_DEFAULT_TEMPLATES[eventType] || null;
export const hasDefaultCustomerMessageTemplate = (eventType) => CUSTOMER_MESSAGE_EVENT_TYPES.includes(eventType) && Boolean(getDefaultCustomerMessageTemplate(eventType));
