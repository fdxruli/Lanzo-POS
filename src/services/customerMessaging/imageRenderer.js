import { CUSTOMER_MESSAGE_EVENT_TYPES } from './contracts';
import { formatMoneyValue } from './normalizers';

const WIDTH = 1080;
const PADDING = 72;
const CONTENT_WIDTH = WIDTH - (PADDING * 2);
const EVENT_TITLES = Object.freeze({
  sale_paid: 'Recibo de venta',
  sale_credit: 'Venta a credito',
  account_statement: 'Estado de cuenta',
  payment_partial: 'Comprobante de abono',
  account_settled: 'Cuenta saldada',
  layaway_created: 'Apartado creado',
  layaway_payment: 'Abono de apartado',
  layaway_settled: 'Apartado liquidado',
  layaway_delivered: 'Apartado entregado',
  layaway_cancelled: 'Apartado cancelado',
  debt_reminder: 'Recordatorio de saldo'
});

const cleanText = (value, fallback = '') => Array.from(String(value ?? fallback))
  .map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  })
  .join('')
  .replace(/\s+/g, ' ')
  .trim();

export const sanitizeImageFilename = (value) => {
  const safe = cleanText(value, 'comprobante')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'comprobante'}.png`;
};

const money = (value, currency) => value === null || value === undefined
  ? null
  : formatMoneyValue(value, { currency, fallback: null });

const add = (rows, label, value) => {
  const normalized = cleanText(value);
  if (normalized) rows.push({ label, value: normalized });
};

const itemRows = (items, currency) => (Array.isArray(items) ? items : []).map((item) => {
  const quantity = cleanText(item?.quantity, '0');
  const total = money(item?.total, currency);
  return `${quantity} x ${cleanText(item?.name, 'Producto')}${total ? `  ${total}` : ''}`;
});

export const buildImageReceiptModel = (payload = {}) => {
  if (!payload || !CUSTOMER_MESSAGE_EVENT_TYPES.includes(payload.eventType)) {
    return { ok: false, code: 'MESSAGE_EVENT_UNSUPPORTED' };
  }
  if (!cleanText(payload.customer?.name) || !cleanText(payload.business?.name) || !cleanText(payload.occurredAt)) {
    return { ok: false, code: 'MESSAGE_PAYLOAD_INVALID' };
  }

  const currency = payload.currency || 'MXN';
  const rows = [];
  const sections = [];
  add(rows, 'Cliente', payload.customer.name);
  add(rows, 'Fecha y hora', payload.occurredAt);
  add(rows, 'Folio / referencia', payload.reference || payload.sale?.folio || payload.layaway?.reference);

  if (payload.eventType.startsWith('sale_')) {
    sections.push(...itemRows(payload.sale?.items, currency));
    add(rows, 'Total', money(payload.sale?.total, currency));
    add(rows, 'Importe recibido', money(payload.sale?.receivedAmount ?? payload.sale?.amountPaid, currency));
    add(rows, 'Saldo restante', money(payload.sale?.balanceDue, currency));
    add(rows, 'Metodo de pago', payload.sale?.paymentMethod);
    add(rows, 'Fecha limite', payload.sale?.dueDate);
    add(rows, 'Estado', payload.sale?.creditStatus);
  } else if (payload.eventType === 'payment_partial' || payload.eventType === 'account_settled') {
    add(rows, 'Saldo anterior', money(payload.payment?.previousBalance, currency));
    add(rows, 'Importe del abono', money(payload.payment?.amount, currency));
    add(rows, 'Saldo restante', money(payload.payment?.newBalance, currency));
    add(rows, 'Metodo de pago', payload.payment?.method);
    add(rows, 'Estado', payload.eventType === 'account_settled' ? 'Saldada' : 'Saldo pendiente');
  } else if (payload.eventType === 'account_statement' || payload.eventType === 'debt_reminder') {
    add(rows, 'Saldo total', money(payload.account?.totalBalance, currency));
    add(rows, 'Total de abonos', money(payload.account?.totalPayments, currency));
    add(rows, 'Fecha de corte', payload.account?.cutoffAt);
    const notes = payload.account?.noteDetails || payload.account?.pendingNotes || [];
    sections.push(...notes.map((note) => {
      const ref = cleanText(note?.folio || note?.reference || note?.id, 'Nota');
      const balance = money(note?.saldoPendiente ?? note?.balanceDue ?? note?.currentOwed, currency);
      return `${ref}${balance ? `  Saldo: ${balance}` : ''}`;
    }));
  } else {
    sections.push(...itemRows(payload.layaway?.items, currency));
    add(rows, 'Total', money(payload.layaway?.total, currency));
    add(rows, 'Pago inicial', money(payload.layaway?.initialPayment, currency));
    add(rows, 'Importe del abono', money(payload.layaway?.paymentAmount, currency));
    add(rows, 'Total abonado', money(payload.layaway?.totalPaid, currency));
    add(rows, 'Saldo restante', money(payload.layaway?.balanceDue, currency));
    add(rows, 'Fecha limite', payload.layaway?.deadline);
    add(rows, 'Estado', payload.layaway?.status);
    add(rows, 'Folio de venta', payload.layaway?.saleFolio);
  }

  return {
    ok: true,
    model: {
      eventType: payload.eventType,
      businessName: cleanText(payload.business.name),
      title: EVENT_TITLES[payload.eventType],
      rows,
      sections,
      footer: 'Comprobante informativo generado por Lanzo POS.'
    }
  };
};

const wrapText = (context, text, maxWidth) => {
  const words = cleanText(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const chunks = [];
    let remaining = word;
    while (context.measureText(remaining).width > maxWidth && remaining.length > 1) {
      let split = remaining.length - 1;
      while (split > 1 && context.measureText(remaining.slice(0, split)).width > maxWidth) split -= 1;
      chunks.push(remaining.slice(0, split));
      remaining = remaining.slice(split);
    }
    chunks.push(remaining);
    for (const chunk of chunks) {
      const candidate = line ? `${line} ${chunk}` : chunk;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = chunk;
      } else {
        line = candidate;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
};

const getCanvas = (canvasFactory) => {
  if (typeof canvasFactory === 'function') return canvasFactory(WIDTH, 1);
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  return document.createElement('canvas');
};

const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  if (typeof canvas.toBlob !== 'function') {
    reject(Object.assign(new Error('Canvas PNG export is unavailable.'), { code: 'IMAGE_PNG_EXPORT_UNAVAILABLE' }));
    return;
  }
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(Object.assign(new Error('PNG generation failed.'), { code: 'IMAGE_PNG_EMPTY' })), 'image/png');
});

export const renderCustomerMessageImage = async (payload, { canvasFactory, FileCtor = globalThis.File } = {}) => {
  const eventType = payload?.eventType || null;
  try {
    const built = buildImageReceiptModel(payload);
    if (!built.ok) return { ok: false, code: built.code, error: new Error(built.code), eventType };
    const canvas = getCanvas(canvasFactory);
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) throw Object.assign(new Error('Canvas is unavailable.'), { code: 'IMAGE_CANVAS_UNAVAILABLE' });

    const blocks = [];
    const pushLines = (text, font, color, gap = 0) => {
      context.font = font;
      blocks.push({ lines: wrapText(context, text, CONTENT_WIDTH), font, color, gap });
    };
    pushLines(built.model.businessName, '700 54px sans-serif', '#0f172a', 14);
    pushLines(built.model.title, '700 42px sans-serif', '#0f766e', 34);
    for (const row of built.model.rows) {
      pushLines(row.label.toUpperCase(), '700 22px sans-serif', '#475569', 6);
      pushLines(row.value, '400 34px sans-serif', '#0f172a', 24);
    }
    if (built.model.sections.length) {
      pushLines('DETALLE', '700 22px sans-serif', '#475569', 12);
      built.model.sections.forEach((line) => pushLines(line, '400 30px sans-serif', '#0f172a', 18));
    }
    pushLines(built.model.footer, '400 24px sans-serif', '#475569', 0);

    const lineHeight = (font) => Number(font.match(/(\d+)px/)?.[1] || 30) * 1.35;
    const height = Math.max(720, Math.ceil((PADDING * 2) + blocks.reduce((sum, block) => sum + (block.lines.length * lineHeight(block.font)) + block.gap, 0)));
    canvas.width = WIDTH;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, WIDTH, height);
    let y = PADDING;
    for (const block of blocks) {
      context.font = block.font;
      context.fillStyle = block.color;
      context.textBaseline = 'top';
      for (const line of block.lines) {
        context.fillText(line, PADDING, y, CONTENT_WIDTH);
        y += lineHeight(block.font);
      }
      y += block.gap;
    }

    const blob = await canvasToBlob(canvas);
    const filename = sanitizeImageFilename(`${built.model.title}-${payload.reference || payload.customer?.name}`);
    const file = typeof FileCtor === 'function'
      ? new FileCtor([blob], filename, { type: 'image/png' })
      : Object.assign(blob, { name: filename, lastModified: Date.now() });
    return { ok: true, blob, file, filename, mimeType: 'image/png', eventType };
  } catch (error) {
    return { ok: false, code: error?.code || 'IMAGE_RENDER_FAILED', error, eventType };
  }
};
