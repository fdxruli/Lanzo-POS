import { CUSTOMER_MESSAGE_EVENT_TYPES } from './contracts';

const common = [
  ['business.name', 'Nombre del negocio', 'Nombre visible del negocio', 'text', true, 'Lanzo Pruebas'],
  ['customer.name', 'Nombre del cliente', 'Nombre visible del cliente', 'text', true, 'María Cliente'],
  ['occurredAt', 'Fecha y hora', 'Fecha normalizada del evento', 'date', true, '18/09/2026 10:30'],
  ['reference', 'Folio o referencia', 'Referencia humana, nunca un identificador técnico', 'text', false, 'V-1024'],
  ['currency', 'Moneda', 'Código de moneda del comprobante', 'text', false, 'MXN']
];

const eventKeys = Object.freeze({
  sale_paid: ['sale.items', 'sale.total', 'sale.receivedAmount', 'sale.balanceDue', 'sale.paymentMethodLabel', 'sale.dueDate', 'sale.creditStatus'],
  sale_credit: ['sale.items', 'sale.total', 'sale.receivedAmount', 'sale.balanceDue', 'sale.paymentMethodLabel', 'sale.dueDate', 'sale.creditStatus'],
  payment_partial: ['payment.amount', 'payment.previousBalance', 'payment.newBalance', 'payment.methodLabel', 'payment.reference'],
  account_settled: ['payment.amount', 'payment.previousBalance', 'payment.newBalance', 'payment.methodLabel', 'payment.reference'],
  account_statement: ['account.totalBalance', 'account.totalPayments', 'account.cutoffAt', 'account.pendingNotes'],
  debt_reminder: ['account.totalBalance', 'account.cutoffAt', 'account.pendingNotes'],
  layaway_created: ['layaway.reference', 'layaway.total', 'layaway.initialPayment', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status'],
  layaway_payment: ['layaway.reference', 'layaway.paymentAmount', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status'],
  layaway_settled: ['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status'],
  layaway_delivered: ['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status', 'layaway.saleFolio'],
  layaway_cancelled: ['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.status']
});

const requiredKeys = Object.freeze({
  sale_paid: ['business.name', 'customer.name', 'occurredAt', 'sale.total', 'sale.paymentMethodLabel'],
  sale_credit: ['business.name', 'customer.name', 'occurredAt', 'sale.total', 'sale.balanceDue', 'sale.paymentMethodLabel'],
  payment_partial: ['business.name', 'customer.name', 'occurredAt', 'payment.amount', 'payment.newBalance', 'payment.methodLabel'],
  account_settled: ['business.name', 'customer.name', 'occurredAt', 'payment.amount', 'payment.newBalance', 'payment.methodLabel'],
  account_statement: ['business.name', 'customer.name', 'occurredAt', 'account.totalBalance'],
  debt_reminder: ['business.name', 'customer.name', 'account.totalBalance'],
  layaway_created: ['business.name', 'customer.name', 'occurredAt', 'layaway.reference', 'layaway.total', 'layaway.initialPayment', 'layaway.balanceDue'],
  layaway_payment: ['business.name', 'customer.name', 'occurredAt', 'layaway.reference', 'layaway.paymentAmount', 'layaway.totalPaid', 'layaway.balanceDue'],
  layaway_settled: ['business.name', 'customer.name', 'occurredAt', 'layaway.reference', 'layaway.totalPaid', 'layaway.balanceDue'],
  layaway_delivered: ['business.name', 'customer.name', 'occurredAt', 'layaway.reference', 'layaway.saleFolio'],
  layaway_cancelled: ['business.name', 'customer.name', 'occurredAt', 'layaway.reference', 'layaway.status']
});

const metadata = Object.freeze({
  'sale.items': ['Productos', 'Productos de la venta, en texto seguro', 'list', false, '2 x Producto $200.00'],
  'sale.total': ['Total de la venta', 'Importe normalizado de la venta', 'money', true, '$250.00'],
  'sale.receivedAmount': ['Importe recibido', 'Importe recibido normalizado', 'money', false, '$300.00'],
  'sale.balanceDue': ['Saldo pendiente', 'Saldo pendiente normalizado', 'money', false, '$50.00'],
  'sale.paymentMethodLabel': ['Método de pago', 'Etiqueta de pago en español', 'text', true, 'Efectivo'],
  'sale.dueDate': ['Fecha límite', 'Fecha límite de la venta a crédito', 'date', false, '30/09/2026'],
  'sale.creditStatus': ['Estado de crédito', 'Estado visible del crédito', 'text', false, 'Pendiente'],
  'payment.amount': ['Importe del abono', 'Importe normalizado del pago', 'money', true, '$100.00'],
  'payment.previousBalance': ['Saldo anterior', 'Saldo antes del pago', 'money', false, '$350.00'],
  'payment.newBalance': ['Saldo nuevo', 'Saldo después del pago', 'money', true, '$250.00'],
  'payment.methodLabel': ['Método de pago', 'Etiqueta de pago en español', 'text', true, 'Transferencia'],
  'payment.reference': ['Referencia de pago', 'Referencia humana del pago', 'text', false, 'AB-220'],
  'account.totalBalance': ['Saldo total', 'Saldo total normalizado', 'money', true, '$250.00'],
  'account.totalPayments': ['Total de abonos', 'Total normalizado de abonos', 'money', false, '$100.00'],
  'account.cutoffAt': ['Fecha de corte', 'Fecha de corte normalizada', 'date', false, '18/09/2026'],
  'account.pendingNotes': ['Notas pendientes', 'Detalle seguro de notas pendientes', 'list', false, 'Nota A · $250.00'],
  'layaway.reference': ['Referencia de apartado', 'Referencia humana del apartado', 'text', true, 'APA-100'],
  'layaway.total': ['Total del apartado', 'Importe total normalizado', 'money', false, '$500.00'],
  'layaway.initialPayment': ['Pago inicial', 'Importe inicial normalizado', 'money', false, '$100.00'],
  'layaway.paymentAmount': ['Importe del abono', 'Importe normalizado del abono', 'money', false, '$100.00'],
  'layaway.totalPaid': ['Total abonado', 'Importe total abonado normalizado', 'money', false, '$200.00'],
  'layaway.balanceDue': ['Saldo pendiente', 'Saldo pendiente normalizado', 'money', false, '$300.00'],
  'layaway.deadline': ['Fecha límite', 'Fecha límite del apartado', 'date', false, '30/09/2026'],
  'layaway.status': ['Estado del apartado', 'Estado visible del apartado', 'text', true, 'Pendiente'],
  'layaway.saleFolio': ['Folio de venta', 'Folio humano de la entrega', 'text', false, 'V-1024']
});

export const TEMPLATE_VARIABLE_PATTERN = /{{([A-Za-z]+(?:\.[A-Za-z]+)?)}}/g;

export const getTemplateVariablesForEvent = (eventType) => {
  if (!CUSTOMER_MESSAGE_EVENT_TYPES.includes(eventType)) return [];
  const entries = [...common, ...(eventKeys[eventType] || []).map((key) => [key, ...(metadata[key] || [])])];
  return entries.map(([key, label, description, type, _required, example]) => Object.freeze({
    key: `{{${key}}}`, variable: key, label, description, type, required: (requiredKeys[eventType] || []).includes(key), example, eventTypes: [eventType]
  }));
};

export const getAllowedTemplateVariableKeys = (eventType) => getTemplateVariablesForEvent(eventType)
  .map((variable) => variable.variable);

export const getRequiredTemplateVariableKeys = (eventType) => requiredKeys[eventType] || [];
