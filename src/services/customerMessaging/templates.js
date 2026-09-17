import { formatMoneyValue, normalizeMoney } from './normalizers';

const itemTotal = (item = {}) => {
  if (item.total !== null && item.total !== undefined) return item.total;
  const price = normalizeMoney(item.price);
  const quantity = normalizeMoney(item.quantity ?? 0);
  return price.ok && quantity.ok ? price.amount.times(quantity.amount).toString() : null;
};

const listItems = (items = [], currency) => items
  .map((item) => `• ${item.name || 'Producto'} (x${item.quantity ?? 0}) - ${formatMoneyValue(itemTotal(item), { currency })}`)
  .join('\n');

const discountDetail = (discount) => {
  if (!discount || typeof discount !== 'object') return '';
  const details = [];
  if (String(discount.type || '').toLowerCase() === 'percent' && discount.value !== undefined) details.push(`${discount.value}%`);
  if (String(discount.reason || '').trim()) details.push(String(discount.reason).trim());
  return details.length > 0 ? ` (${details.join(' · ')})` : '';
};

const cashLines = (sale, currency) => {
  if (sale.paymentMethod !== 'cash') return [];
  const received = sale.receivedAmount ?? sale.amountPaid;
  const receivedMoney = normalizeMoney(received);
  const totalMoney = normalizeMoney(sale.total);
  const change = sale.changeAmount ?? (receivedMoney.ok && totalMoney.ok ? receivedMoney.amount.minus(totalMoney.amount).toString() : null);
  return [
    received !== null ? `Efectivo recibido: ${formatMoneyValue(received, { currency })}` : null,
    change !== null ? `Cambio: ${formatMoneyValue(change, { currency })}` : null
  ].filter(Boolean);
};

const saleLines = (payload) => {
  const { sale, currency } = payload;
  const lines = [
    '*--- TICKET DE VENTA ---*',
    `*Negocio:* ${payload.business.name}`,
    `*Fecha:* ${payload.occurredAt}`,
    sale.ecommerceOrderCode ? `*Pedido online:* ${sale.ecommerceOrderCode}` : null,
    sale.posFolio && sale.posFolio !== sale.folio ? `*Folio POS:* ${sale.posFolio}` : null,
    sale.folio ? `*Folio de venta:* ${sale.folio}` : null,
    '',
    '*Productos:*',
    listItems(sale.items, currency),
    '',
    `*TOTAL: ${formatMoneyValue(sale.total, { currency })}*`
  ];
  if (sale.subtotal && sale.discount && sale.discount !== '0') lines.splice(lines.length - 1, 0, `*Subtotal:* ${formatMoneyValue(sale.subtotal, { currency })}`);
  if (sale.discount && sale.discount !== '0') lines.splice(lines.length - 1, 0, `*Descuento${discountDetail(sale.discountDetail)}:* -${formatMoneyValue(sale.discount, { currency })}`);
  if (sale.amountPaid) lines.push(`Abono: ${formatMoneyValue(sale.amountPaid, { currency })}`);
  if (sale.balanceDue) lines.push(`Saldo Pendiente: ${formatMoneyValue(sale.balanceDue, { currency })}`);
  lines.push(...cashLines(sale, currency));
  if (sale.dueDate) lines.push(`Fecha límite: ${sale.dueDate}`);
  return lines.filter((line) => line !== null).join('\n');
};

const paymentLines = (payload, settled = false) => [
  settled ? '*--- CUENTA LIQUIDADA ---*' : '*--- RECIBO DE ABONO ---*',
  `*Negocio:* ${payload.business.name}`,
  `Hola *${payload.customer.name}*,`,
  `*Fecha:* ${payload.occurredAt}`,
  '',
  `Monto abonado: *${formatMoneyValue(payload.payment.amount, { currency: payload.currency })}*`,
  `Deuda anterior: ${formatMoneyValue(payload.payment.previousBalance, { currency: payload.currency })}`,
  `*Saldo restante: ${formatMoneyValue(payload.payment.newBalance, { currency: payload.currency })}*`,
  settled ? '\n¡Tu cuenta quedó liquidada!' : '\n¡Gracias por tu pago!'
].join('\n');

const accountNoteLines = (notes = [], currency) => notes.map((note) => {
  const reference = note.folio || note.reference || note.id || 'Nota';
  const balance = note.currentOwed ?? note.balanceDue ?? note.balance_due ?? note.saldoPendiente;
  return `• ${reference}: ${formatMoneyValue(balance, { currency })}`;
});

/**
 * Text is a temporary renderer over the stable payload. Later image/template
 * phases replace this renderer without changing finance-facing integrations.
 */
export const renderCustomerMessageText = (payload) => {
  switch (payload.eventType) {
    case 'sale_paid':
    case 'sale_credit':
      return `${saleLines(payload)}\n\n¡Gracias por su preferencia!`;
    case 'account_statement':
      {
        const notes = payload.account.noteDetails.length > 0
          ? accountNoteLines(payload.account.noteDetails, payload.currency)
          : [];
        return [
          '*--- ESTADO DE CUENTA ---*',
          `*Negocio:* ${payload.business.name}`,
          `Hola *${payload.customer.name}*,`,
          '',
          `*DEUDA TOTAL: ${formatMoneyValue(payload.account.totalBalance, { currency: payload.currency })}*`,
          notes.length > 0 ? '*Detalle de notas pendientes:*' : null,
          ...notes,
          notes.length === 0 ? 'No hay detalle local de notas pendientes.' : null,
          '\n¡Gracias por su preferencia!'
        ].filter(Boolean).join('\n');
      }
    case 'payment_partial':
      return paymentLines(payload, false);
    case 'account_settled':
      return paymentLines(payload, true);
    case 'layaway_created':
    case 'layaway_payment':
    case 'layaway_settled':
    case 'layaway_delivered':
    case 'layaway_cancelled':
      return [
        `*--- APARTADO ${payload.eventType.replace('layaway_', '').toUpperCase()} ---*`,
        `*Negocio:* ${payload.business.name}`,
        `*Referencia de apartado:* ${payload.layaway.reference}`,
        `*Fecha:* ${payload.occurredAt}`,
        payload.eventType === 'layaway_delivered' ? `*Folio de venta:* ${payload.layaway.saleFolio}` : null,
        payload.layaway.balanceDue !== null ? `Saldo pendiente: ${formatMoneyValue(payload.layaway.balanceDue, { currency: payload.currency })}` : null
      ].filter(Boolean).join('\n');
    case 'debt_reminder':
      return `Hola *${payload.customer.name}*, tienes un saldo pendiente de ${formatMoneyValue(payload.account.totalBalance, { currency: payload.currency })} con ${payload.business.name}.`;
    default:
      return '';
  }
};
