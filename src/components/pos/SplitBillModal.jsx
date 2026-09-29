import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { loadData, STORES } from '../../services/database';
import { Money } from '../../utils/moneyMath';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
import { normalizeStock, STOCK_DECIMALS } from '../../services/db/utils';
import {
  calculateByItemsTicketFinancials,
  RESTAURANT_SPLIT_INTENTS,
  splitRequiresCashSessionCompatibility
} from '../../services/sales/splitOrderContract';
import { normalizeRestaurantSplitPaymentMethod } from '../../services/sales/paymentMethodContract';
import {
  calculateEqualPaymentCents,
  validateCustomPaymentCents
} from '../../services/sales/restaurantSplitPayments';
import {
  buildRestaurantSplitOrderSnapshot,
  clearRestaurantSplitDraft,
  readRestaurantSplitDraft,
  saveRestaurantSplitDraft
} from '../../services/sales/restaurantSplitDraft';
import './SplitBillModal.css';

const MIN_GUESTS = 2;
const MAX_GUESTS = 8;
const MAX_GUEST_NAME_LENGTH = 40;
const WIZARD_STEPS = [
  { id: 'people', title: 'Personas' },
  { id: 'items', title: 'Platos' },
  { id: 'payment', title: 'Cobro' },
  { id: 'review', title: 'Revisar' }
];

const toQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return normalizeStock(parsed);
};

const isUnitItem = (item) => item?.saleType === 'unit' || !item?.saleType;
const getQuantityStep = (item) => (isUnitItem(item) ? 1 : (10 ** -STOCK_DECIMALS));

const makeGuest = (index, guest = {}) => ({
  // T labels stay stable for the existing financial/cloud contract. Guest names
  // are presentation-only and are never used as payment or line identifiers.
  id: guest.id || `T${index + 1}`,
  displayName: typeof guest.displayName === 'string' ? guest.displayName.slice(0, MAX_GUEST_NAME_LENGTH) : ''
});

const makeDefaultGuests = (count = MIN_GUESTS) => (
  Array.from({ length: Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, count)) }, (_, index) => makeGuest(index))
);

const guestName = (guest, index) => guest?.displayName?.trim() || `Comensal ${index + 1}`;
const guestContextName = (guest, index) => `${guestName(guest, index)} · Comensal ${index + 1}`;
const paymentMethodLabel = (value) => ({
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Fiado',
  mixed: 'Pago combinado'
}[normalizeRestaurantSplitPaymentMethod(value)] || 'Método no válido');

const getItemDetails = (item = {}) => {
  const modifiers = item.selectedModifiers
    || item.selected_modifiers
    || item.metadata?.selectedModifiers
    || item.metadata?.selected_modifiers;
  const modifierText = formatSelectedModifiersForDisplay(modifiers || []).join(', ');
  const variant = item.variantName
    || item.variant_name
    || item.selectedVariant?.name
    || item.selected_variant?.name
    || '';
  const note = item.notes
    || item.kitchenNotes
    || item.kitchen_notes
    || item.specifications
    || item.especificaciones
    || '';
  return [variant, modifierText, note ? `Nota: ${note}` : ''].filter(Boolean).join(' · ');
};

/** Initialize every item in the unassigned pool. */
const buildInitialAllocations = (order = [], guestCount = MIN_GUESTS) => (
  (Array.isArray(order) ? order : []).map((item) => ({
    poolQuantity: toQuantity(item?.quantity || 0),
    ticketQuantities: Array(Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, guestCount))).fill(0)
  }))
);

const buildTicketLines = (allocations, guestIdx) => (
  (allocations || []).flatMap((allocation, lineIndex) => {
    const quantity = toQuantity(allocation?.ticketQuantities?.[guestIdx] || 0);
    return quantity <= 0 ? [] : [{ lineIndex, quantity }];
  })
);

const calculateTicketMath = ({ order = [], allocations = [], guests = [], total = 0, saleDiscount = null }) => {
  const ticketCount = guests.length || MIN_GUESTS;
  const financials = calculateByItemsTicketFinancials({
    items: order,
    saleDiscount,
    tickets: guests.map((guest, guestIdx) => ({
      label: guest.id,
      lines: buildTicketLines(allocations, guestIdx)
    })),
    parentTotal: total
  });
  const ticketFinancials = financials.tickets.length === ticketCount
    ? financials.tickets
    : Array(ticketCount).fill(null);
  const baseCents = ticketFinancials.map((ticket) => ticket?.baseCents || 0);
  const adjustments = ticketFinancials.map((ticket) => ticket?.roundingAdjustmentCents || 0);

  return {
    parentCents: financials.parentTotalCents,
    adjustments,
    totalsCents: baseCents.map((base, index) => base + adjustments[index]),
    discountCents: ticketFinancials.map((ticket) => ticket?.discountTotalCents || 0),
    roundingError: financials.valid ? null : 'La diferencia entre productos, descuentos y total supera el redondeo permitido. No se alterarán precios ni descuentos; revisa la cuenta.'
  };
};

const formatMoneyFromCents = (cents) => Money.toNumber(Money.fromCents(cents || 0)).toFixed(2);
const formatQuantity = (value) => {
  const quantity = toQuantity(value);
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toFixed(STOCK_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
};

const initialPaymentsState = (guests, totalsCents = []) => Object.fromEntries(
  guests.map((guest, index) => [guest.id, {
    paymentMethod: 'efectivo',
    amountPaid: formatMoneyFromCents(totalsCents[index] || 0),
    customerId: '',
    initialPaymentMethod: 'efectivo',
    paymentReference: '',
    sendReceipt: false
  }])
);

const calculateAssignmentProgress = (order, allocations) => {
  let totalQuantity = 0;
  let pendingQuantity = 0;
  let pendingLines = 0;

  (Array.isArray(order) ? order : []).forEach((item, index) => {
    const lineTotal = toQuantity(item?.quantity || 0);
    const poolQuantity = toQuantity(allocations[index]?.poolQuantity || 0);
    totalQuantity = toQuantity(totalQuantity + lineTotal);
    pendingQuantity = toQuantity(pendingQuantity + poolQuantity);
    if (poolQuantity > 0) pendingLines += 1;
  });

  return {
    assignedQuantity: toQuantity(totalQuantity - pendingQuantity),
    pendingQuantity,
    pendingLines,
    totalQuantity
  };
};

const toMoneySafe = (value, fallback = '0') => {
  try {
    return Money.init(value ?? fallback);
  } catch {
    return Money.init(fallback);
  }
};

const parsePaymentInputCents = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const candidate = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(candidate)) return null;
  try { return Money.toCents(candidate); } catch { return null; }
};

export default function SplitBillModal({
  show,
  onClose,
  order = [],
  total = 0,
  saleDiscount = null,
  onConfirm,
  isCajaOpen = true,
  orderId = null,
  tableName = ''
}) {
  const [guests, setGuests] = useState(() => makeDefaultGuests());
  const [allocations, setAllocations] = useState([]);
  const [splitIntent, setSplitIntent] = useState(RESTAURANT_SPLIT_INTENTS.BY_ITEMS);
  const [customAmountsCents, setCustomAmountsCents] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState({});
  const [assignmentAmounts, setAssignmentAmounts] = useState({});
  const [currentStep, setCurrentStep] = useState('people');
  const [assignmentPanel, setAssignmentPanel] = useState('pending');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [pendingGuestRemoval, setPendingGuestRemoval] = useState(null);
  const [pendingStrategyChange, setPendingStrategyChange] = useState(null);
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const initializedSessionRef = useRef(null);
  const submissionInFlightRef = useRef(false);
  const latestInputsRef = useRef({ order, total, saleDiscount });
  latestInputsRef.current = { order, total, saleDiscount };

  const safeOrder = useMemo(() => (Array.isArray(order) ? order : []), [order]);
  const orderSnapshot = useMemo(
    () => buildRestaurantSplitOrderSnapshot({ order: safeOrder, total, saleDiscount }),
    [safeOrder, total, saleDiscount]
  );
  const sessionIdentity = `${String(orderId || '')}\u0000${orderSnapshot}`;
  const guestLabels = useMemo(() => guests.map((guest) => guest.id), [guests]);
  const guestIdentity = guestLabels.join('|');
  const customersById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );

  // Start or restore only when the modal opens or the commercial order snapshot
  // changes. React reference changes and derived totals never restart a session.
  useEffect(() => {
    if (!show) {
      initializedSessionRef.current = null;
      setIsSessionReady(false);
      setPendingGuestRemoval(null);
      return;
    }
    if (initializedSessionRef.current === sessionIdentity) return;

    const hadOpenSession = initializedSessionRef.current !== null;
    const current = latestInputsRef.current;
    const currentOrder = Array.isArray(current.order) ? current.order : [];
    const restored = orderId
      ? readRestaurantSplitDraft({ orderId, order: currentOrder, orderSnapshot })
      : { status: 'missing' };
    const nextGuests = restored.status === 'restored'
      ? restored.guests.map((guest, index) => makeGuest(index, guest))
      : makeDefaultGuests();
    const nextAllocations = restored.status === 'restored'
      ? restored.allocations
      : buildInitialAllocations(currentOrder, nextGuests.length);
    const nextSplitIntent = restored.status === 'restored'
      ? restored.splitIntent
      : RESTAURANT_SPLIT_INTENTS.BY_ITEMS;
    const initialMath = calculateTicketMath({
      order: currentOrder,
      allocations: nextAllocations,
      guests: nextGuests,
      total: current.total,
      saleDiscount: current.saleDiscount
    });

    initializedSessionRef.current = sessionIdentity;
    setGuests(nextGuests);
    setAllocations(nextAllocations);
    setSplitIntent(nextSplitIntent);
    setCustomAmountsCents(restored.status === 'restored'
      ? restored.customAmountsCents
      : Array(nextGuests.length).fill(0));
    setPayments(initialPaymentsState(nextGuests, initialMath.totalsCents));
    setAssignmentAmounts({});
    setCurrentStep(restored.status === 'restored' ? restored.step : 'people');
    setAssignmentPanel('pending');
    setIsSubmitting(submissionInFlightRef.current);
    setPendingGuestRemoval(null);
    setPendingStrategyChange(null);
    setAssignmentNotice('');
    setDraftNotice(restored.status === 'restored'
      ? 'Se restauró el borrador local de esta mesa. Revisa la estrategia, los importes y los nombres antes de cobrar.'
      : restored.status === 'stale' || (hadOpenSession && restored.status !== 'restored')
        ? 'La cuenta cambió desde que se guardó el reparto. Se descartó el borrador anterior y los productos volvieron a quedar pendientes.'
        : restored.status === 'invalid'
          ? 'No se pudo validar el reparto guardado. Se descartó por seguridad.'
          : '');
    setIsSessionReady(true);
  }, [show, sessionIdentity, orderId, orderSnapshot]);

  useEffect(() => {
    if (!show) return undefined;
    let active = true;
    const fetchCustomers = async () => {
      try {
        const customerData = await loadData(STORES.CUSTOMERS);
        if (active) setCustomers(customerData || []);
      } catch {
        if (active) setCustomers([]);
      }
    };
    void fetchCustomers();
    return () => { active = false; };
  }, [show]);

  // Persist presentation state only. Payment methods, credit customers,
  // amounts and other financial data always start from the current contract.
  useEffect(() => {
    if (!show || !isSessionReady || !orderId) return;
    const stored = saveRestaurantSplitDraft({
      orderId,
      order: safeOrder,
      orderSnapshot,
      guests,
      allocations,
      step: currentStep,
      splitIntent,
      customAmountsCents
    });
    if (!stored && !draftNotice) {
      setDraftNotice('No se pudo guardar el reparto localmente en este dispositivo. Puedes continuar, pero quizá debas repetir la asignación si cierras esta ventana.');
    }
  }, [show, isSessionReady, orderId, safeOrder, orderSnapshot, guests, allocations, currentStep, splitIntent, customAmountsCents, draftNotice]);

  useEffect(() => {
    if (!show) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (pendingStrategyChange) {
        event.preventDefault();
        setPendingStrategyChange(null);
        return;
      }
      if (pendingGuestRemoval) {
        event.preventDefault();
        setPendingGuestRemoval(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose, pendingGuestRemoval, pendingStrategyChange]);

  const ticketMath = useMemo(
    () => calculateTicketMath({ order: safeOrder, allocations, guests, total, saleDiscount }),
    [safeOrder, allocations, guests, total, saleDiscount]
  );
  const assignmentProgress = useMemo(
    () => calculateAssignmentProgress(safeOrder, allocations),
    [safeOrder, allocations]
  );
  const parentTotalCents = useMemo(() => {
    try { return Money.toCents(total || 0); } catch { return 0; }
  }, [total]);
  const equalPayment = useMemo(
    () => calculateEqualPaymentCents(parentTotalCents, guests.length),
    [parentTotalCents, guests.length]
  );
  const payerAmountsCents = useMemo(() => {
    if (splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS) return ticketMath.totalsCents;
    if (splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT) {
      return equalPayment.valid ? equalPayment.amountsCents : Array(guests.length).fill(0);
    }
    return guests.map((guest, index) => customAmountsCents[index] || 0);
  }, [splitIntent, ticketMath.totalsCents, equalPayment, guests, customAmountsCents]);
  const distributedCents = payerAmountsCents.reduce((sum, amount) => sum + amount, 0);
  const pendingPaymentCents = parentTotalCents - distributedCents;
  const distributionError = useMemo(() => {
    if (splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS) return null;
    if (parentTotalCents <= 0) return 'El total de la cuenta debe ser mayor que cero.';
    if (splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT) {
      return equalPayment.valid ? null : 'El total no se puede dividir en importes positivos para esta cantidad de personas.';
    }
    const validation = validateCustomPaymentCents(parentTotalCents, payerAmountsCents);
    if (validation.valid) return null;
    if (validation.code === 'SPLIT_CUSTOM_EXCEEDS_TOTAL') return 'La suma de los importes supera el total de la cuenta.';
    if (validation.code === 'SPLIT_CUSTOM_INCOMPLETE') return `Faltan $${formatMoneyFromCents(validation.pendingCents)} por distribuir.`;
    if (validation.code === 'SPLIT_CUSTOM_AMOUNT_REQUIRED') return 'Cada persona debe tener un importe mayor que cero.';
    return 'Revisa los montos personalizados antes de continuar.';
  }, [splitIntent, parentTotalCents, equalPayment, payerAmountsCents]);
  const wizardSteps = useMemo(() => WIZARD_STEPS.map((step) => (
    step.id === 'items' && splitIntent !== RESTAURANT_SPLIT_INTENTS.BY_ITEMS
      ? { ...step, title: splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT ? 'Distribución' : 'Montos' }
      : step
  )), [splitIntent]);

  // Reconcile only payment defaults after a payer total changes. Guest names,
  // allocations and the current wizard step remain untouched.
  useEffect(() => {
    if (!show || !isSessionReady) return;
    setPayments((previous) => {
      const next = {};
      guestIdentity.split('|').filter(Boolean).forEach((guestId, index) => {
        const guest = { id: guestId };
        const current = previous[guestId] || {};
        const totalForGuest = formatMoneyFromCents(payerAmountsCents[index] || 0);
        next[guestId] = {
          ...initialPaymentsState([guest], [payerAmountsCents[index] || 0])[guestId],
          ...current,
          amountPaid: normalizeRestaurantSplitPaymentMethod(current.paymentMethod) === 'credit'
            ? (current.amountPaid ?? '0')
            : totalForGuest,
          receivedAmount: normalizeRestaurantSplitPaymentMethod(current.paymentMethod) === 'credit'
            ? (current.receivedAmount ?? current.amountPaid ?? '0')
            : totalForGuest
        };
      });
      return next;
    });
  }, [show, isSessionReady, guestIdentity, payerAmountsCents]);

  const itemAssignmentError = useMemo(() => {
    if (safeOrder.length === 0) return 'No hay productos para dividir.';
    if (allocations.length !== safeOrder.length) return 'La cuenta se está preparando. Vuelve a intentar en un momento.';

    for (let lineIndex = 0; lineIndex < safeOrder.length; lineIndex += 1) {
      const item = safeOrder[lineIndex];
      const allocation = allocations[lineIndex];
      const totalQuantity = toQuantity(item?.quantity || 0);
      const assigned = (allocation?.ticketQuantities || []).reduce((sum, quantity) => sum + toQuantity(quantity), 0);
      if (toQuantity(assigned + toQuantity(allocation?.poolQuantity || 0)) !== totalQuantity) {
        return `No se pudo comprobar la cantidad de “${item?.name || 'un producto'}”. Revisa el reparto.`;
      }
      if (toQuantity(allocation?.poolQuantity || 0) > 0) {
        return `Asigna las ${formatQuantity(allocation.poolQuantity)} unidades pendientes de “${item?.name || 'un producto'}”.`;
      }
    }

    for (let guestIdx = 0; guestIdx < guests.length; guestIdx += 1) {
      if (!buildTicketLines(allocations, guestIdx).length) {
        return `${guestContextName(guests[guestIdx], guestIdx)} necesita al menos un producto.`;
      }
    }

    if (ticketMath.roundingError) return ticketMath.roundingError;
    const totalChildren = ticketMath.totalsCents.reduce((sum, amount) => sum + amount, 0);
    if (totalChildren !== ticketMath.parentCents) return 'Los totales asignados no coinciden con la cuenta original.';
    return null;
  }, [safeOrder, allocations, guests, ticketMath]);
  const assignmentError = splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? itemAssignmentError : null;

  const paymentValidationError = useMemo(() => {
    if (assignmentError) return assignmentError;
    if (distributionError) return distributionError;
    const debtAccumulator = new Map();
    let creditPayerCount = 0;

    for (let guestIdx = 0; guestIdx < guests.length; guestIdx += 1) {
      const guest = guests[guestIdx];
      const displayName = guestContextName(guest, guestIdx);
      const ticketTotal = Money.fromCents(payerAmountsCents[guestIdx] || 0);
      const payment = payments[guest.id];
      if (!payment) return `Falta configurar el cobro de ${displayName}.`;
      const paid = toMoneySafe(payment.amountPaid, '0');
      const paidCents = parsePaymentInputCents(payment.amountPaid ?? '0');
      if (paid.lt(0) || paidCents === null) return `El monto de ${displayName} debe tener máximo dos decimales.`;

      const method = normalizeRestaurantSplitPaymentMethod(payment.paymentMethod);
      if (method === 'cash') {
        if (paidCents < (payerAmountsCents[guestIdx] || 0)) return `El pago en efectivo de ${displayName} debe cubrir su total.`;
        continue;
      }

      if (method === 'card' || method === 'transfer') {
        if (!paid.eq(ticketTotal)) return `El pago mediante ${method === 'card' ? 'tarjeta' : 'transferencia'} de ${displayName} debe coincidir con su total.`;
        continue;
      }

      if (method === 'credit') {
        creditPayerCount += 1;
        if (splitIntent !== RESTAURANT_SPLIT_INTENTS.BY_ITEMS && creditPayerCount > 1) {
          return 'Solo una persona puede dejar saldo a Fiado en una división monetaria. Los demás pueden pagar en efectivo, tarjeta o transferencia.';
        }
        if (!payment.customerId) return `Selecciona el cliente registrado que recibirá el fiado de ${displayName}.`;
        if (paid.gt(ticketTotal)) return `El abono de ${displayName} no puede superar su total.`;
        const initialMethod = normalizeRestaurantSplitPaymentMethod(payment.initialPaymentMethod || 'cash');
        if (!['cash', 'card', 'transfer'].includes(initialMethod)) return `El método del abono inicial de ${displayName} no es válido.`;
        if (initialMethod === 'cash' && paidCents > 0) {
          const receivedCents = parsePaymentInputCents(payment.receivedAmount ?? payment.amountPaid ?? '0');
          if (receivedCents === null || receivedCents < paidCents) {
            return `El efectivo recibido para el abono de ${displayName} no cubre el abono aplicado.`;
          }
        }
        const customer = customersById.get(payment.customerId);
        if (!customer) return `El cliente financiero seleccionado para ${displayName} ya no está disponible.`;
        const balance = Money.subtract(ticketTotal, paid);
        const currentDebt = toMoneySafe(customer.debt, '0');
        const creditLimit = toMoneySafe(customer.creditLimit, '0');
        const pending = debtAccumulator.get(customer.id) || Money.init(0);
        const projected = Money.add(Money.add(currentDebt, pending), balance);
        if (creditLimit.eq(0) || projected.gt(creditLimit)) {
          return `El fiado de ${displayName} supera el límite de crédito de ${customer.name}.`;
        }
        debtAccumulator.set(customer.id, Money.add(pending, balance));
        continue;
      }

      return `Selecciona un método válido para ${displayName}.`;
    }
    return null;
  }, [assignmentError, distributionError, guests, payments, customersById, payerAmountsCents, splitIntent]);

  const willAutoOpenCaja = useMemo(() => (
    !isCajaOpen && splitRequiresCashSessionCompatibility(
      guestIdentity.split('|').filter(Boolean).map((guestId) => ({ paymentData: payments[guestId] }))
    )
  ), [isCajaOpen, payments, guestIdentity]);

  const resizeGuests = useCallback((newCount) => {
    const count = Math.max(MIN_GUESTS, Math.min(MAX_GUESTS, Number(newCount) || MIN_GUESTS));
    setGuests((currentGuests) => {
      if (count > currentGuests.length) {
        return [
          ...currentGuests,
          ...Array.from({ length: count - currentGuests.length }, (_, offset) => makeGuest(currentGuests.length + offset))
        ];
      }
      return currentGuests.slice(0, count);
    });
    setAllocations((currentAllocations) => currentAllocations.map((allocation) => {
      const ticketQuantities = allocation.ticketQuantities || [];
      if (count > ticketQuantities.length) {
        return { ...allocation, ticketQuantities: [...ticketQuantities, ...Array(count - ticketQuantities.length).fill(0)] };
      }
      const returned = ticketQuantities.slice(count).reduce((sum, quantity) => sum + toQuantity(quantity), 0);
      return {
        poolQuantity: toQuantity(allocation.poolQuantity + returned),
        ticketQuantities: ticketQuantities.slice(0, count)
      };
    }));
    setPayments((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => Number(id.slice(1)) <= count)
    ));
    setCustomAmountsCents((current) => count > current.length
      ? [...current, ...Array(count - current.length).fill(0)]
      : current.slice(0, count));
    setPendingGuestRemoval(null);
  }, []);

  const handleGuestCountChange = (requestedCount) => {
    const count = Math.max(MIN_GUESTS, Math.min(MAX_GUESTS, Number(requestedCount) || MIN_GUESTS));
    if (count >= guests.length) {
      resizeGuests(count);
      return;
    }

    const removedGuestIndexes = Array.from({ length: guests.length - count }, (_, index) => count + index);
    const affected = allocations.reduce((summary, allocation) => {
      const returned = removedGuestIndexes.reduce((sum, guestIdx) => sum + toQuantity(allocation?.ticketQuantities?.[guestIdx] || 0), 0);
      if (returned > 0) {
        summary.quantity = toQuantity(summary.quantity + returned);
        summary.lines += 1;
      }
      return summary;
    }, { quantity: 0, lines: 0 });
    const removedPaymentCents = splitIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT
      ? customAmountsCents.slice(count).reduce((sum, amount) => sum + (amount || 0), 0)
      : 0;

    if (affected.quantity > 0 || removedPaymentCents > 0) {
      setPendingGuestRemoval({ count, quantity: affected.quantity, lines: affected.lines, removedPaymentCents });
      return;
    }
    resizeGuests(count);
  };

  const updateGuestName = (guestId, value) => {
    setGuests((previous) => previous.map((guest) => (
      guest.id === guestId
        ? { ...guest, displayName: String(value).slice(0, MAX_GUEST_NAME_LENGTH) }
        : guest
    )));
  };

  const requestStrategyChange = (nextIntent) => {
    if (nextIntent === splitIntent || isSubmitting) return;
    const hasProductAssignments = assignmentProgress.assignedQuantity > 0;
    const hasCustomDistribution = splitIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT
      && customAmountsCents.some((amount) => amount > 0);
    if (hasProductAssignments || hasCustomDistribution) {
      setPendingStrategyChange({ nextIntent, hasProductAssignments, hasCustomDistribution });
      return;
    }
    setSplitIntent(nextIntent);
    setPendingStrategyChange(null);
  };

  const confirmStrategyChange = () => {
    if (!pendingStrategyChange?.nextIntent) return;
    setSplitIntent(pendingStrategyChange.nextIntent);
    setPendingStrategyChange(null);
    setAssignmentNotice('');
  };

  const updatePayment = (guestId, field, value) => {
    setPayments((previous) => {
      const current = previous[guestId] || {};
      const next = { ...current, [field]: value };
      const method = normalizeRestaurantSplitPaymentMethod(current.paymentMethod);
      const initialMethod = normalizeRestaurantSplitPaymentMethod(current.initialPaymentMethod || 'cash');
      if (field === 'amountPaid' && method === 'cash') next.receivedAmount = value;
      if (field === 'amountPaid' && method === 'credit' && initialMethod === 'cash'
        && (current.receivedAmount === undefined || current.receivedAmount === current.amountPaid)) {
        next.receivedAmount = value;
      }
      return { ...previous, [guestId]: next };
    });
  };

  const updateCustomAmount = (guestIndex, value) => {
    const candidate = String(value ?? '').trim().replace(',', '.');
    if (candidate && !/^\d+(?:\.\d{0,2})?$/.test(candidate)) return;
    let cents = 0;
    if (candidate) {
      try { cents = Money.toCents(candidate); } catch { return; }
    }
    setCustomAmountsCents((previous) => guests.map((guest, index) => (
      index === guestIndex ? cents : (previous[index] || 0)
    )));
  };

  const getAssignmentAmount = (item, lineIndex, pending) => {
    const lineKey = String(getCartLineId(item, lineIndex));
    const defaultAmount = isUnitItem(item) ? Math.min(1, pending) : Math.min(1, pending);
    const entered = assignmentAmounts[lineKey];
    if (entered === undefined || entered === '') return formatQuantity(defaultAmount);
    return entered;
  };

  const getNormalizedAssignmentAmount = (item, lineIndex, pending) => {
    const requested = getAssignmentAmount(item, lineIndex, pending);
    if (requested === '' || !Number.isFinite(Number(requested))) return 0;
    return Math.min(pending, toQuantity(requested));
  };

  const moveToGuest = useCallback((lineIndex, guestIdx, delta) => {
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex];
      if (!current || !Number.isInteger(guestIdx) || guestIdx < 0 || guestIdx >= guests.length) return previous;
      const poolQuantity = toQuantity(current.poolQuantity);
      const moveQuantity = Math.min(toQuantity(delta), poolQuantity);
      if (moveQuantity <= 0) return previous;
      const ticketQuantities = [...current.ticketQuantities];
      ticketQuantities[guestIdx] = toQuantity(ticketQuantities[guestIdx] + moveQuantity);
      next[lineIndex] = { ...current, poolQuantity: toQuantity(poolQuantity - moveQuantity), ticketQuantities };
      return next;
    });
  }, [guests.length]);

  const moveAllToGuest = useCallback((lineIndex, guestIdx) => {
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex];
      if (!current || current.poolQuantity <= 0 || guestIdx < 0 || guestIdx >= guests.length) return previous;
      const ticketQuantities = [...current.ticketQuantities];
      ticketQuantities[guestIdx] = toQuantity(ticketQuantities[guestIdx] + current.poolQuantity);
      next[lineIndex] = { ...current, poolQuantity: 0, ticketQuantities };
      return next;
    });
  }, [guests.length]);

  const returnToPending = useCallback((lineIndex, guestIdx, delta) => {
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex];
      if (!current) return previous;
      const ticketQuantity = toQuantity(current.ticketQuantities[guestIdx]);
      const moveQuantity = Math.min(toQuantity(delta), ticketQuantity);
      if (moveQuantity <= 0) return previous;
      const ticketQuantities = [...current.ticketQuantities];
      ticketQuantities[guestIdx] = toQuantity(ticketQuantity - moveQuantity);
      next[lineIndex] = {
        ...current,
        poolQuantity: toQuantity(current.poolQuantity + moveQuantity),
        ticketQuantities
      };
      return next;
    });
  }, []);

  const returnAllToPending = useCallback((lineIndex, guestIdx) => {
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex];
      if (!current) return previous;
      const ticketQuantity = toQuantity(current.ticketQuantities[guestIdx]);
      if (ticketQuantity <= 0) return previous;
      const ticketQuantities = [...current.ticketQuantities];
      ticketQuantities[guestIdx] = 0;
      next[lineIndex] = {
        ...current,
        poolQuantity: toQuantity(current.poolQuantity + ticketQuantity),
        ticketQuantities
      };
      return next;
    });
  }, []);

  const moveBetweenGuests = useCallback((lineIndex, fromGuestIdx, toGuestIdx) => {
    if (!Number.isInteger(toGuestIdx) || toGuestIdx < 0 || toGuestIdx >= guests.length || toGuestIdx === fromGuestIdx) return;
    setAllocations((previous) => {
      const next = [...previous];
      const current = next[lineIndex];
      if (!current) return previous;
      const ticketQuantities = [...current.ticketQuantities];
      const quantity = toQuantity(ticketQuantities[fromGuestIdx]);
      if (quantity <= 0) return previous;
      ticketQuantities[fromGuestIdx] = 0;
      ticketQuantities[toGuestIdx] = toQuantity(ticketQuantities[toGuestIdx] + quantity);
      next[lineIndex] = { ...current, ticketQuantities };
      return next;
    });
    setAssignmentNotice('');
  }, [guests.length]);

  const guestLineItems = (guestIdx) => safeOrder.reduce((items, item, lineIndex) => {
    const quantity = toQuantity(allocations[lineIndex]?.ticketQuantities?.[guestIdx] || 0);
    if (quantity > 0) items.push({ item, quantity, lineIndex });
    return items;
  }, []);

  const goToStep = (step) => {
    const targetIndex = wizardSteps.findIndex((candidate) => candidate.id === step);
    const currentIndex = wizardSteps.findIndex((candidate) => candidate.id === currentStep);
    if (targetIndex < 0) return;
    if (targetIndex <= currentIndex) {
      setCurrentStep(step);
      setAssignmentNotice('');
      return;
    }
    if (targetIndex >= 2 && (assignmentError || distributionError)) {
      setAssignmentNotice(assignmentError || distributionError);
      return;
    }
    if (targetIndex >= 3 && paymentValidationError) {
      setAssignmentNotice(paymentValidationError);
      return;
    }
    setCurrentStep(step);
    setAssignmentNotice('');
  };

  const goForward = () => {
    const currentIndex = wizardSteps.findIndex((candidate) => candidate.id === currentStep);
    if (currentStep === 'people') return goToStep('items');
    if (currentStep === 'items') return goToStep('payment');
    if (currentStep === 'payment') return goToStep('review');
    if (currentIndex < 0) return;
    setCurrentStep(wizardSteps[Math.min(currentIndex + 1, wizardSteps.length - 1)].id);
  };

  // Only the explicit final confirmation may initiate a financial operation.
  const handleConfirmClick = async (event) => {
    event.preventDefault();
    if (currentStep !== 'review' || paymentValidationError || isSubmitting || submissionInFlightRef.current || !isSessionReady) return;
    if (
      initializedSessionRef.current !== sessionIdentity
      || buildRestaurantSplitOrderSnapshot({ order: safeOrder, total, saleDiscount }) !== orderSnapshot
    ) {
      setDraftNotice('La cuenta cambió durante la revisión. El reparto se reinició para proteger el cobro.');
      initializedSessionRef.current = null;
      setIsSessionReady(false);
      return;
    }

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = {
        splitIntent,
        tickets: guests.map((guest, guestIdx) => {
          const payment = payments[guest.id] || {};
          const dueCents = payerAmountsCents[guestIdx] || 0;
          const due = Money.fromCents(dueCents);
          const method = normalizeRestaurantSplitPaymentMethod(payment.paymentMethod);
          const paidInput = toMoneySafe(payment.amountPaid || 0, '0');
          const amountPaid = method === 'card' || method === 'transfer' ? due : paidInput;
          const receivedAmount = method === 'cash'
            ? paidInput
            : (method === 'credit' && normalizeRestaurantSplitPaymentMethod(payment.initialPaymentMethod) === 'cash'
              ? toMoneySafe(payment.receivedAmount ?? payment.amountPaid ?? 0, '0')
              : amountPaid);

          return {
            label: guest.id,
            ...(splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? {} : { amountCents: dueCents }),
            paymentData: {
              paymentMethod: payments[guest.id]?.paymentMethod,
              amountPaid: Money.toExactString(amountPaid),
              receivedAmount: Money.toExactString(receivedAmount),
              initialPaymentMethod: payment.initialPaymentMethod || 'efectivo',
              paymentReference: payment.paymentReference || null,
              customerId: payments[guest.id]?.customerId || null,
              sendReceipt: Boolean(payments[guest.id]?.sendReceipt)
            },
            lines: splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS
              ? buildTicketLines(allocations, guestIdx)
              : []
          };
        })
      };

      const result = await onConfirm(payload);
      if (result?.success === true) {
        clearRestaurantSplitDraft(orderId);
        setIsSessionReady(false);
      }
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!show) return null;

  const currentStepIndex = Math.max(0, wizardSteps.findIndex((step) => step.id === currentStep));
  const isFinalStep = currentStep === 'review';
  const activeError = assignmentNotice || (currentStep === 'items' ? (assignmentError || distributionError) : currentStep === 'payment' || currentStep === 'review' ? paymentValidationError : '');

  return (
    <div className="modal split-bill-overlay" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }} onClick={onClose}>
      <div
        className="modal-content split-bill-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-bill-title"
        aria-describedby="split-bill-description"
      >
        <div className="split-bill-header">
          <div className="split-bill-title-block">
            <span className="split-bill-kicker">División de cuenta</span>
            <h2 id="split-bill-title">{splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? '¿Qué productos pagará cada persona?' : '¿Cómo dividirán esta cuenta?'}</h2>
            <p id="split-bill-description">La estrategia, los nombres y la distribución se guardan en este dispositivo para esta mesa mientras preparas el cobro.</p>
          </div>
          <button type="button" className="split-close-button" onClick={onClose} disabled={isSubmitting} aria-label="Cerrar división de cuenta">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="split-status-strip" aria-label="Resumen de división">
          <div className="split-status-card">
            <span>Total de la cuenta</span>
                <strong>${formatMoneyFromCents(parentTotalCents)}</strong>
          </div>
          {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? (
            <>
              <div className="split-status-card">
                <span>Asignado</span>
                <strong>{formatQuantity(assignmentProgress.assignedQuantity)} / {formatQuantity(assignmentProgress.totalQuantity)}</strong>
              </div>
              <div className={`split-status-card ${assignmentProgress.pendingQuantity > 0 ? 'is-pending' : 'is-ready'}`}>
                <span>Pendiente</span>
                <strong>{formatQuantity(assignmentProgress.pendingQuantity)}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="split-status-card">
                <span>Distribuido</span>
                <strong>${formatMoneyFromCents(distributedCents)}</strong>
              </div>
              <div className={`split-status-card ${pendingPaymentCents !== 0 ? 'is-pending' : 'is-ready'}`}>
                <span>Pendiente</span>
                <strong>${formatMoneyFromCents(pendingPaymentCents)}</strong>
              </div>
            </>
          )}
        </div>

        <nav className="split-wizard-nav" aria-label="Pasos para dividir la cuenta">
          {wizardSteps.map((step, index) => {
            const isCurrent = step.id === currentStep;
            const canVisit = index <= currentStepIndex || (index === 1) || (index === 2 && !assignmentError && !distributionError) || (index === 3 && !paymentValidationError);
            return (
              <button
                key={step.id}
                type="button"
                className={`split-wizard-step ${isCurrent ? 'is-current' : ''} ${index < currentStepIndex ? 'is-complete' : ''}`}
                onClick={() => goToStep(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                disabled={isSubmitting || !canVisit}
              >
                <span className="split-wizard-step-number" aria-hidden="true">{index < currentStepIndex ? <Check size={15} /> : index + 1}</span>
                <span>{step.title}</span>
              </button>
            );
          })}
        </nav>

        {draftNotice && <p className="split-draft-notice" role="status">{draftNotice}</p>}

        <form className="split-bill-form" onSubmit={(event) => event.preventDefault()} noValidate>
          <div className="split-step-content" key={currentStep}>
            {currentStep === 'people' && (
              <section className="split-step-panel" aria-labelledby="split-people-title">
                <div className="split-step-heading">
                  <div>
                    <p className="split-step-eyebrow">Paso 1 de 4</p>
                    <h3 id="split-people-title" tabIndex={-1}>Personas</h3>
                    <p>Indica quiénes pagarán. Los nombres son opcionales y solo sirven para identificar a cada persona en esta cuenta.</p>
                  </div>
                  <label className="split-count-selector" htmlFor="splitGuestCount">
                    <span>¿Cuántas personas?</span>
                    <select id="splitGuestCount" value={guests.length} onChange={(event) => handleGuestCountChange(event.target.value)} disabled={isSubmitting}>
                      {Array.from({ length: MAX_GUESTS - MIN_GUESTS + 1 }, (_, index) => index + MIN_GUESTS).map((count) => (
                        <option key={count} value={count}>{count} personas</option>
                      ))}
                    </select>
                  </label>
                </div>

                <fieldset className="split-strategy-selector" disabled={isSubmitting}>
                  <legend>¿Cómo dividirán la cuenta?</legend>
                  <label className={splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="restaurantSplitIntent"
                      value={RESTAURANT_SPLIT_INTENTS.BY_ITEMS}
                      checked={splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS}
                      onChange={() => requestStrategyChange(RESTAURANT_SPLIT_INTENTS.BY_ITEMS)}
                    />
                    <span><strong>Cada quien paga lo suyo</strong><small>Asigna productos completos a cada persona.</small></span>
                  </label>
                  <label className={splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="restaurantSplitIntent"
                      value={RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT}
                      checked={splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT}
                      onChange={() => requestStrategyChange(RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT)}
                    />
                    <span><strong>Dividir el total en partes iguales</strong><small>Los productos se conservan juntos en una sola venta.</small></span>
                  </label>
                  <label className={splitIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="restaurantSplitIntent"
                      value={RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT}
                      checked={splitIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT}
                      onChange={() => requestStrategyChange(RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT)}
                    />
                    <span><strong>Ingresar montos personalizados</strong><small>Distribuye el importe exacto sin cambiar precios ni cantidades.</small></span>
                  </label>
                </fieldset>

                <div className="split-guest-list split-guest-list--names">
                  {guests.map((guest, index) => (
                    <article className="split-guest-name-card" key={guest.id}>
                      <span className="split-guest-avatar" aria-hidden="true">{index + 1}</span>
                      <div className="split-guest-name-field">
                        <label htmlFor={`splitGuestName-${guest.id}`}>Nombre de Comensal {index + 1} <span>(opcional)</span></label>
                        <input
                          id={`splitGuestName-${guest.id}`}
                          type="text"
                          value={guest.displayName}
                          maxLength={MAX_GUEST_NAME_LENGTH}
                          autoComplete="off"
                          placeholder={`Comensal ${index + 1}`}
                          aria-describedby={`splitGuestHelp-${guest.id}`}
                          disabled={isSubmitting}
                          onChange={(event) => updateGuestName(guest.id, event.target.value)}
                          onBlur={() => updateGuestName(guest.id, guest.displayName.trim())}
                        />
                        <small id={`splitGuestHelp-${guest.id}`}>Este nombre no se guarda como cliente ni cambia la cuenta de crédito.</small>
                      </div>
                    </article>
                  ))}
                </div>

                {pendingStrategyChange && (
                  <div className="split-confirm-removal" role="alertdialog" aria-labelledby="split-change-strategy-title" aria-describedby="split-change-strategy-description">
                    <div>
                      <h4 id="split-change-strategy-title">¿Cambiar la estrategia?</h4>
                      <p id="split-change-strategy-description">
                        {pendingStrategyChange.hasProductAssignments && 'Los productos asignados se conservarán para volver a “Cada quien paga lo suyo”; no se usarán para calcular aportaciones monetarias. '}
                        {pendingStrategyChange.hasCustomDistribution && 'Los importes personalizados actuales dejarán de usarse en esta estrategia. '}
                        Confirma para continuar con la estrategia elegida.
                      </p>
                    </div>
                    <div className="split-confirm-removal-actions">
                      <button type="button" className="split-secondary-button" onClick={() => setPendingStrategyChange(null)}>Conservar estrategia</button>
                      <button type="button" className="split-primary-button" onClick={confirmStrategyChange}>Cambiar estrategia</button>
                    </div>
                  </div>
                )}

                {pendingGuestRemoval && (
                  <div className="split-confirm-removal" role="alertdialog" aria-labelledby="split-remove-guest-title" aria-describedby="split-remove-guest-description">
                    <div>
                      <h4 id="split-remove-guest-title">¿Quitar a las personas seleccionadas?</h4>
                      <p id="split-remove-guest-description">
                        {pendingGuestRemoval.quantity > 0 && `${formatQuantity(pendingGuestRemoval.quantity)} cantidades de ${pendingGuestRemoval.lines} productos volverán a “Platos pendientes”. `}
                        {pendingGuestRemoval.removedPaymentCents > 0 && `También se quitará su monto personalizado de $${formatMoneyFromCents(pendingGuestRemoval.removedPaymentCents)}; los montos de las demás personas se conservarán y el saldo pendiente aumentará.`}
                      </p>
                    </div>
                    <div className="split-confirm-removal-actions">
                      <button type="button" className="split-secondary-button" onClick={() => setPendingGuestRemoval(null)}>Conservar personas</button>
                      <button type="button" className="split-danger-button" onClick={() => resizeGuests(pendingGuestRemoval.count)}>
                        {pendingGuestRemoval.removedPaymentCents > 0 ? 'Quitar y conservar los demás montos' : 'Quitar y devolver cantidades'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {currentStep === 'items' && splitIntent !== RESTAURANT_SPLIT_INTENTS.BY_ITEMS && (
              <section className="split-step-panel" aria-labelledby="split-distribution-title">
                <div className="split-step-heading">
                  <div>
                    <p className="split-step-eyebrow">Paso 2 de 4</p>
                    <h3 id="split-distribution-title" tabIndex={-1}>
                      {splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT ? 'Distribuye el total en partes iguales' : 'Ingresa los montos de cada persona'}
                    </h3>
                    <p>Esta división es monetaria. No se asignan productos a pagadores ni se modifican precios, cantidades o descuentos.</p>
                  </div>
                </div>

                {splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT ? (
                  <div className="split-money-distribution-grid" aria-label="Partes iguales por persona">
                    {guests.map((guest, guestIdx) => (
                      <article className="split-money-share-card" key={guest.id}>
                        <span>{guestContextName(guest, guestIdx)}</span>
                        <strong>${formatMoneyFromCents(payerAmountsCents[guestIdx] || 0)}</strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="split-money-distribution-grid split-money-distribution-grid--custom">
                    {guests.map((guest, guestIdx) => (
                      <label className="split-money-share-card" key={guest.id} htmlFor={`splitCustomAmount-${guest.id}`}>
                        <span>{guestContextName(guest, guestIdx)}</span>
                        <span className="split-money-input-wrap">
                          <span aria-hidden="true">$</span>
                          <input
                            id={`splitCustomAmount-${guest.id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={formatMoneyFromCents(payerAmountsCents[guestIdx] || 0)}
                            onChange={(event) => updateCustomAmount(guestIdx, event.target.value)}
                            disabled={isSubmitting}
                            aria-label={`Monto de ${guestContextName(guest, guestIdx)}`}
                            aria-invalid={Boolean(distributionError)}
                            aria-describedby={distributionError ? 'split-validation-error' : undefined}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="split-money-distribution-summary" aria-live="polite">
                  <div><span>Total original</span><strong>${formatMoneyFromCents(parentTotalCents)}</strong></div>
                  <div><span>Total distribuido</span><strong>${formatMoneyFromCents(distributedCents)}</strong></div>
                  <div className={pendingPaymentCents === 0 ? 'is-ready' : 'is-pending'}>
                    <span>Pendiente por distribuir</span><strong>${formatMoneyFromCents(pendingPaymentCents)}</strong>
                  </div>
                </div>
                {splitIntent === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT && (
                  <p className="split-sharing-note">Si comparten una pizza u otro plato, la cuenta conserva una sola venta con sus artículos y precios originales. El inventario se descuenta una vez.</p>
                )}
              </section>
            )}

            {currentStep === 'items' && splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS && (
              <section className="split-step-panel" aria-labelledby="split-items-title">
                <div className="split-step-heading">
                  <div>
                    <p className="split-step-eyebrow">Paso 2 de 4</p>
                    <h3 id="split-items-title" tabIndex={-1}>Asigna los platos</h3>
                    <p>Asigna cada unidad a quien la pagará. Puedes devolverla al pendiente o moverla directamente a otra persona.</p>
                  </div>
                </div>

                <aside className="split-sharing-note">
                  <strong>¿Van a compartir un solo plato?</strong>
                  <span>Elige “Dividir el total en partes iguales” o “Ingresar montos personalizados”. La cuenta conservará sus productos y precios originales.</span>
                </aside>

                <div className="split-assignment-tabs" role="tablist" aria-label="Vista de asignación">
                  <button type="button" role="tab" aria-selected={assignmentPanel === 'pending'} aria-controls="split-pending-panel" onClick={() => setAssignmentPanel('pending')}>
                    Platos pendientes · {formatQuantity(assignmentProgress.pendingQuantity)}
                  </button>
                  <button type="button" role="tab" aria-selected={assignmentPanel === 'assigned'} aria-controls="split-assigned-panel" onClick={() => setAssignmentPanel('assigned')}>
                    Personas · {guests.length}
                  </button>
                </div>

                <div className="split-allocation-layout">
                  <section
                    id="split-pending-panel"
                    role="tabpanel"
                    tabIndex={0}
                    className={`split-pool-section ${assignmentPanel !== 'pending' ? 'is-mobile-inactive' : ''}`}
                    aria-labelledby="split-pool-title"
                  >
                    <div className="split-section-heading">
                      <div>
                        <h4 id="split-pool-title">Platos pendientes</h4>
                        <p>{assignmentProgress.pendingLines} productos con cantidad disponible</p>
                      </div>
                    </div>
                    <div className="split-pool-list">
                      {safeOrder.map((item, lineIndex) => {
                        const allocation = allocations[lineIndex];
                        if (!allocation) return null;
                        const pending = toQuantity(allocation.poolQuantity);
                        const totalQuantity = toQuantity(item.quantity || 0);
                        const step = getQuantityStep(item);
                        const assignedByGuests = toQuantity((allocation.ticketQuantities || []).reduce((sum, quantity) => sum + toQuantity(quantity), 0));
                        const isCompleted = pending <= 0;
                        const assignmentState = isCompleted ? 'is-complete' : assignedByGuests > 0 ? 'is-partial' : 'is-unassigned';
                        return (
                          <article key={getCartLineId(item, lineIndex)} className={`split-pool-item ${isCompleted ? 'completed' : assignedByGuests > 0 ? 'partial' : 'unassigned'}`}>
                            <div className="split-pool-item-head">
                              <div className="split-pool-item-info">
                                <span className="split-pool-item-name">{item.name}</span>
                                <span className="split-pool-item-price">${Money.toNumber(item.price || 0).toFixed(2)} c/u · {formatQuantity(totalQuantity)} en la cuenta</span>
                                {getItemDetails(item) && <span className="split-pool-item-details">{getItemDetails(item)}</span>}
                              </div>
                              <span className={`split-pool-badge ${isCompleted ? 'is-complete' : ''}`}>
                                {isCompleted
                                  ? <><Check size={14} aria-hidden="true" /> Completamente repartido</>
                                  : assignedByGuests > 0 ? 'Reparto parcial' : `${formatQuantity(pending)} sin asignar`}
                              </span>
                            </div>
                            <div className={`split-assignment-summary ${assignmentState}`} aria-live="polite" aria-atomic="true">
                              <strong className="split-assignment-summary-title">Asignación de este producto:</strong>
                              <div className="split-assignment-people">
                                {guests.map((guest, guestIdx) => {
                                  const guestQuantity = toQuantity(allocation.ticketQuantities?.[guestIdx] || 0);
                                  return (
                                    <span key={guest.id} className={`split-assignment-person ${guestQuantity > 0 ? 'has-quantity' : 'is-zero'}`}>
                                      <span>{guestName(guest, guestIdx)}</span>
                                      <strong>× {formatQuantity(guestQuantity)}</strong>
                                    </span>
                                  );
                                })}
                              </div>
                              <p className={`split-assignment-pending ${pending > 0 ? 'is-pending' : 'is-clear'}`}>
                                Pendiente: {formatQuantity(pending)} de {formatQuantity(totalQuantity)}.
                              </p>
                            </div>
                            {!isCompleted && (
                              <div className="split-pool-item-actions">
                                <p className="split-assignment-hint">
                                  {isUnitItem(item)
                                    ? 'Cada clic añade una unidad a la persona elegida. Puedes pulsar varias veces.'
                                    : 'Cada clic añade la cantidad indicada a la persona elegida. Puedes pulsar varias veces.'}
                                </p>
                                <span className="split-action-label">{isUnitItem(item) ? 'Añadir una unidad' : 'Añadir cantidad'}</span>
                                <div className="split-assign-grid">
                                  {guests.map((guest, guestIdx) => (
                                    <button
                                      key={guest.id}
                                      type="button"
                                      className="split-action-button"
                                      onClick={() => moveToGuest(lineIndex, guestIdx, step)}
                                      disabled={pending < step || isSubmitting}
                                    >
                                      <Plus size={16} aria-hidden="true" />
                                      {isUnitItem(item)
                                        ? `+1 a ${guestName(guest, guestIdx)}`
                                        : `+${formatQuantity(step)} a ${guestName(guest, guestIdx)}`}
                                    </button>
                                  ))}
                                </div>
                                {!isUnitItem(item) && (
                                  <>
                                    <label className="split-custom-quantity-label" htmlFor={`splitAmount-${lineIndex}`}>
                                      O asignar otra cantidad
                                      <input
                                        id={`splitAmount-${lineIndex}`}
                                        className="split-custom-quantity"
                                        type="number"
                                        min={10 ** -STOCK_DECIMALS}
                                        max={pending}
                                        step={10 ** -STOCK_DECIMALS}
                                        value={getAssignmentAmount(item, lineIndex, pending)}
                                        onChange={(event) => setAssignmentAmounts((previous) => ({
                                          ...previous,
                                          [String(getCartLineId(item, lineIndex))]: event.target.value
                                        }))}
                                        disabled={isSubmitting}
                                      />
                                    </label>
                                    <div className="split-assign-grid">
                                      {guests.map((guest, guestIdx) => (
                                        <button
                                          key={guest.id}
                                          type="button"
                                          className="split-action-button"
                                          onClick={() => moveToGuest(lineIndex, guestIdx, getNormalizedAssignmentAmount(item, lineIndex, pending))}
                                          disabled={pending <= 0 || isSubmitting || getNormalizedAssignmentAmount(item, lineIndex, pending) <= 0}
                                          aria-label={`Asignar cantidad de ${item.name} a ${guestContextName(guest, guestIdx)}`}
                                        >
                                          Asignar {formatQuantity(getNormalizedAssignmentAmount(item, lineIndex, pending))} a {guestContextName(guest, guestIdx)}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                                <span className="split-action-label">Asignar todas las restantes</span>
                                <div className="split-assign-grid">
                                  {guests.map((guest, guestIdx) => (
                                    <button
                                      key={guest.id}
                                      type="button"
                                      className="split-action-button split-action-button--all"
                                      onClick={() => moveAllToGuest(lineIndex, guestIdx)}
                                      disabled={pending <= 0 || isSubmitting}
                                      aria-label={`Asignar todas las unidades restantes de ${item.name} a ${guestContextName(guest, guestIdx)}`}
                                    >
                                      Todas las restantes a {guestName(guest, guestIdx)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section
                    id="split-assigned-panel"
                    role="tabpanel"
                    tabIndex={0}
                    className={`split-tickets-section ${assignmentPanel !== 'assigned' ? 'is-mobile-inactive' : ''}`}
                    aria-labelledby="split-assigned-title"
                  >
                    <div className="split-section-heading split-section-heading--plain">
                      <div>
                        <h4 id="split-assigned-title">Asignado a cada persona</h4>
                        <p>Los importes estimados se actualizan en cuanto cambias el reparto.</p>
                      </div>
                    </div>
                    <div className="split-tickets-grid">
                      {guests.map((guest, guestIdx) => {
                        const items = guestLineItems(guestIdx);
                        return (
                          <article key={guest.id} className={`split-ticket-card ${items.length === 0 ? 'is-empty' : ''}`}>
                            <div className="split-ticket-header">
                              <div>
                                <h4>{guestContextName(guest, guestIdx)}</h4>
                                <span>{items.length} {items.length === 1 ? 'producto' : 'productos'}</span>
                              </div>
                              <strong className="split-ticket-total">${formatMoneyFromCents(ticketMath.totalsCents[guestIdx])}</strong>
                            </div>
                            {ticketMath.discountCents[guestIdx] > 0 && (
                              <p className="split-ticket-discount">Descuento: -${formatMoneyFromCents(ticketMath.discountCents[guestIdx])}</p>
                            )}
                            {ticketMath.adjustments[guestIdx] !== 0 && (
                              <p className="split-ticket-adjustment">Ajuste de redondeo: {ticketMath.adjustments[guestIdx] > 0 ? '+' : '-'}${formatMoneyFromCents(Math.abs(ticketMath.adjustments[guestIdx]))}</p>
                            )}
                            <div className="split-ticket-items">
                              {items.length === 0 ? <p className="split-ticket-empty">Todavía no tiene productos.</p> : items.map(({ item, quantity, lineIndex }) => (
                                <div key={getCartLineId(item, lineIndex)} className="split-ticket-item">
                                  <div className="split-ticket-item-copy">
                                    <strong>{item.name}</strong>
                                    {getItemDetails(item) && <small>{getItemDetails(item)}</small>}
                                    <span>× {formatQuantity(quantity)}</span>
                                  </div>
                                  <div className="split-ticket-item-actions">
                                    <button
                                      type="button"
                                      className="split-icon-button"
                                      onClick={() => returnToPending(lineIndex, guestIdx, getQuantityStep(item))}
                                      disabled={isSubmitting}
                                      aria-label={`Regresar una unidad de ${item.name} de ${guestContextName(guest, guestIdx)} a platos pendientes`}
                                      title="Regresar una unidad"
                                    ><Minus size={17} aria-hidden="true" /></button>
                                    <button
                                      type="button"
                                      className="split-icon-button split-icon-button--muted"
                                      onClick={() => returnAllToPending(lineIndex, guestIdx)}
                                      disabled={isSubmitting}
                                      aria-label={`Regresar todo ${item.name} de ${guestContextName(guest, guestIdx)} a platos pendientes`}
                                      title="Regresar todo"
                                    ><RotateCcw size={17} aria-hidden="true" /></button>
                                    {guests.length > 1 && (
                                      <select
                                        className="split-move-select"
                                        defaultValue=""
                                        aria-label={`Mover ${item.name} de ${guestContextName(guest, guestIdx)} a otra persona`}
                                        onChange={(event) => {
                                          if (event.target.value) moveBetweenGuests(lineIndex, guestIdx, Number(event.target.value));
                                          event.target.value = '';
                                        }}
                                        disabled={isSubmitting}
                                      >
                                        <option value="">Mover todo…</option>
                                        {guests.map((targetGuest, targetIdx) => targetIdx !== guestIdx && (
                                          <option key={targetGuest.id} value={targetIdx}>A {guestContextName(targetGuest, targetIdx)}</option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </section>
            )}

            {currentStep === 'payment' && (
              <section className="split-step-panel" aria-labelledby="split-payment-title">
                <div className="split-step-heading">
                  <div>
                    <p className="split-step-eyebrow">Paso 3 de 4</p>
                    <h3 id="split-payment-title" tabIndex={-1}>Configura el cobro</h3>
                    <p>Elige Efectivo, Tarjeta, Transferencia o Fiado para cada persona. Si eliges Fiado, selecciona aparte al cliente financiero registrado.</p>
                  </div>
                </div>
                {splitIntent !== RESTAURANT_SPLIT_INTENTS.BY_ITEMS && (
                  <aside className="split-sharing-note">
                    <strong>Crédito en una sola cuenta</strong>
                    <span>En una división monetaria solo una persona puede dejar saldo a Fiado. Las demás pueden pagar en efectivo, tarjeta o transferencia; cada pago quedará asociado a la misma venta.</span>
                  </aside>
                )}

                <div className="split-payment-grid">
                  {guests.map((guest, guestIdx) => {
                    const payment = payments[guest.id] || {};
                    const items = splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? guestLineItems(guestIdx) : [];
                    const dueCents = payerAmountsCents[guestIdx] || 0;
                    const due = Money.fromCents(dueCents);
                    const method = normalizeRestaurantSplitPaymentMethod(payment.paymentMethod);
                    const initialMethod = normalizeRestaurantSplitPaymentMethod(payment.initialPaymentMethod || 'cash');
                    const paid = toMoneySafe(payment.amountPaid, '0');
                    const received = toMoneySafe(payment.receivedAmount ?? payment.amountPaid ?? '0', '0');
                    const cashChangeRaw = method === 'cash'
                      ? Money.subtract(received, due)
                      : (method === 'credit' && initialMethod === 'cash' ? Money.subtract(received, paid) : Money.init(0));
                    const cashChange = cashChangeRaw.gt(0) ? cashChangeRaw : Money.init(0);
                    return (
                      <article className="split-payment-card" key={guest.id}>
                        <div className="split-payment-card-heading">
                          <div>
                            <h4>{guestContextName(guest, guestIdx)}</h4>
                            {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? (
                              <ul className="split-payment-items">
                                {items.map(({ item, quantity, lineIndex }) => (
                                  <li key={getCartLineId(item, lineIndex)}>
                                    <span>{item.name}{getItemDetails(item) ? ` · ${getItemDetails(item)}` : ''}</span>
                                    <strong>× {formatQuantity(quantity)}</strong>
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="split-review-payment-detail">Aportación monetaria; los productos originales permanecen en una sola venta.</p>}
                          </div>
                          <strong>${formatMoneyFromCents(dueCents)}</strong>
                        </div>
                        {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS && ticketMath.discountCents[guestIdx] > 0 && (
                          <p className="split-ticket-discount">Descuento aplicado: -${formatMoneyFromCents(ticketMath.discountCents[guestIdx])}</p>
                        )}
                        {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS && ticketMath.adjustments[guestIdx] !== 0 && (
                          <p className="split-ticket-adjustment">Ajuste de redondeo: {ticketMath.adjustments[guestIdx] > 0 ? '+' : '-'}${formatMoneyFromCents(Math.abs(ticketMath.adjustments[guestIdx]))}</p>
                        )}
                        <div className="split-ticket-payment">
                          <label htmlFor={`splitPaymentMethod-${guest.id}`}>Método de pago</label>
                          <select
                            id={`splitPaymentMethod-${guest.id}`}
                            value={payment.paymentMethod || 'efectivo'}
                            onChange={(event) => {
                              const method = event.target.value;
                              const defaultAmount = method === 'fiado' ? '0' : formatMoneyFromCents(dueCents);
                              updatePayment(guest.id, 'paymentMethod', method);
                              updatePayment(guest.id, 'amountPaid', defaultAmount);
                              updatePayment(guest.id, 'receivedAmount', defaultAmount);
                              if (method === 'fiado') updatePayment(guest.id, 'initialPaymentMethod', 'efectivo');
                            }}
                            disabled={isSubmitting}
                          >
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="fiado">Fiado</option>
                          </select>

                          {method === 'cash' ? (
                            <>
                              <label htmlFor={`splitPaid-${guest.id}`}>Monto recibido</label>
                              <input
                                id={`splitPaid-${guest.id}`}
                                type="number"
                                min={formatMoneyFromCents(dueCents)}
                                step="0.01"
                                value={payment.amountPaid ?? formatMoneyFromCents(dueCents)}
                                aria-invalid={Boolean(activeError && currentStep === 'payment')}
                                aria-describedby={activeError && currentStep === 'payment' ? 'split-validation-error' : undefined}
                                onChange={(event) => updatePayment(guest.id, 'amountPaid', event.target.value)}
                                disabled={isSubmitting}
                              />
                              <p className="split-review-payment-detail">Aplicado a caja: ${formatMoneyFromCents(dueCents)} · Cambio: ${Money.toNumber(cashChange).toFixed(2)}</p>
                            </>
                          ) : method === 'card' || method === 'transfer' ? (
                            <p className="split-review-payment-detail">Importe del pago: ${formatMoneyFromCents(dueCents)} · Sin cambio.</p>
                          ) : (
                            <>
                              <label htmlFor={`splitPaid-${guest.id}`}>Abono inicial aplicado</label>
                              <input
                                id={`splitPaid-${guest.id}`}
                                type="number"
                                min="0"
                                max={formatMoneyFromCents(dueCents)}
                                step="0.01"
                                value={payment.amountPaid ?? '0'}
                                aria-invalid={Boolean(activeError && currentStep === 'payment')}
                                aria-describedby={activeError && currentStep === 'payment' ? 'split-validation-error' : undefined}
                                onChange={(event) => updatePayment(guest.id, 'amountPaid', event.target.value)}
                                disabled={isSubmitting}
                              />
                              <label htmlFor={`splitInitialMethod-${guest.id}`}>Método del abono inicial</label>
                              <select
                                id={`splitInitialMethod-${guest.id}`}
                                value={payment.initialPaymentMethod || 'efectivo'}
                                onChange={(event) => updatePayment(guest.id, 'initialPaymentMethod', event.target.value)}
                                disabled={isSubmitting}
                              >
                                <option value="efectivo">Efectivo</option>
                                <option value="tarjeta">Tarjeta</option>
                                <option value="transferencia">Transferencia</option>
                              </select>
                              {initialMethod === 'cash' && Number(payment.amountPaid) > 0 && (
                                <>
                                  <label htmlFor={`splitCreditReceived-${guest.id}`}>Efectivo recibido para el abono</label>
                                  <input
                                    id={`splitCreditReceived-${guest.id}`}
                                    type="number"
                                    min={payment.amountPaid || 0}
                                    step="0.01"
                                    value={payment.receivedAmount ?? payment.amountPaid ?? '0'}
                                    onChange={(event) => updatePayment(guest.id, 'receivedAmount', event.target.value)}
                                    disabled={isSubmitting}
                                  />
                                  <p className="split-review-payment-detail">Cambio del abono: ${Money.toNumber(cashChange).toFixed(2)}</p>
                                </>
                              )}
                            </>
                          )}

                          {(method === 'card' || method === 'transfer' || (method === 'credit' && paid.gt(0) && initialMethod !== 'cash')) && (
                            <>
                              <label htmlFor={`splitReference-${guest.id}`}>Referencia o folio <span>(opcional)</span></label>
                              <input
                                id={`splitReference-${guest.id}`}
                                type="text"
                                maxLength={100}
                                value={payment.paymentReference || ''}
                                onChange={(event) => updatePayment(guest.id, 'paymentReference', event.target.value)}
                                disabled={isSubmitting}
                              />
                            </>
                          )}

                          {method === 'credit' && (
                            <>
                              <label htmlFor={`splitCustomer-${guest.id}`}>Cliente financiero registrado</label>
                              <select
                                id={`splitCustomer-${guest.id}`}
                                value={payment.customerId || ''}
                                onChange={(event) => updatePayment(guest.id, 'customerId', event.target.value)}
                                disabled={isSubmitting}
                                aria-invalid={Boolean(activeError && currentStep === 'payment')}
                                aria-describedby={activeError && currentStep === 'payment' ? 'split-validation-error' : undefined}
                              >
                                <option value="">Selecciona cliente</option>
                                {customers.map((customer) => (
                                  <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` (${customer.phone})` : ''}</option>
                                ))}
                              </select>
                            </>
                          )}

                          <label className="split-receipt-toggle" htmlFor={`splitReceipt-${guest.id}`}>
                            <input
                              id={`splitReceipt-${guest.id}`}
                              type="checkbox"
                              checked={Boolean(payment.sendReceipt)}
                              onChange={(event) => updatePayment(guest.id, 'sendReceipt', event.target.checked)}
                              disabled={isSubmitting || (payment.paymentMethod === 'fiado' && !payment.customerId)}
                            />
                            Enviar ticket por WhatsApp
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {currentStep === 'review' && (
              <section className="split-step-panel" aria-labelledby="split-review-title">
                <div className="split-step-heading">
                  <div>
                    <p className="split-step-eyebrow">Paso 4 de 4</p>
                    <h3 id="split-review-title" tabIndex={-1}>Revisa antes de confirmar</h3>
                    <p>Confirma la distribución y los métodos de pago. No se registra una venta hasta que pulses el botón final.</p>
                  </div>
                  {tableName && <span className="split-table-label">{tableName}</span>}
                </div>

                <div className="split-review-list">
                  {guests.map((guest, guestIdx) => {
                    const payment = payments[guest.id] || {};
                    const items = splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? guestLineItems(guestIdx) : [];
                    const dueCents = payerAmountsCents[guestIdx] || 0;
                    const due = Money.fromCents(dueCents);
                    const method = normalizeRestaurantSplitPaymentMethod(payment.paymentMethod);
                    const initialMethod = normalizeRestaurantSplitPaymentMethod(payment.initialPaymentMethod || 'cash');
                    const amountPaid = toMoneySafe(payment.amountPaid, '0');
                    const received = toMoneySafe(payment.receivedAmount ?? payment.amountPaid ?? '0', '0');
                    const changeRaw = method === 'cash'
                      ? Money.subtract(received, due)
                      : (method === 'credit' && initialMethod === 'cash' ? Money.subtract(received, amountPaid) : Money.init(0));
                    const change = changeRaw.gt(0) ? changeRaw : Money.init(0);
                    const balance = method === 'credit' ? Money.subtract(due, amountPaid) : Money.init(0);
                    return (
                      <article className="split-review-card" key={guest.id}>
                        <div className="split-review-card-heading">
                          <div>
                            <h4>{guestContextName(guest, guestIdx)}</h4>
                            <p>{paymentMethodLabel(payment.paymentMethod)}{method === 'credit' && payment.customerId ? ` · ${customersById.get(payment.customerId)?.name || ''}` : ''}</p>
                          </div>
                          <strong>${formatMoneyFromCents(dueCents)}</strong>
                        </div>
                        {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? (
                          <ul className="split-review-items">
                            {items.map(({ item, quantity, lineIndex }) => (
                              <li key={getCartLineId(item, lineIndex)}>
                                <div><span>{item.name}</span>{getItemDetails(item) && <small>{getItemDetails(item)}</small>}</div>
                                <span>× {formatQuantity(quantity)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="split-review-payment-detail">Aportación a la misma venta. Los productos, precios y cantidades de la cuenta permanecen intactos.</p>
                        )}
                        {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS && ticketMath.discountCents[guestIdx] > 0 && <p className="split-ticket-discount">Descuento: -${formatMoneyFromCents(ticketMath.discountCents[guestIdx])}</p>}
                        {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS && ticketMath.adjustments[guestIdx] !== 0 && <p className="split-ticket-adjustment">Ajuste de redondeo: {ticketMath.adjustments[guestIdx] > 0 ? '+' : '-'}${formatMoneyFromCents(Math.abs(ticketMath.adjustments[guestIdx]))}</p>}
                        {method === 'cash' && <p className="split-review-payment-detail">Recibido: ${Money.toNumber(received).toFixed(2)} · Aplicado a caja: ${formatMoneyFromCents(dueCents)} · Cambio: ${Money.toNumber(change).toFixed(2)}</p>}
                        {(method === 'card' || method === 'transfer') && <p className="split-review-payment-detail">Pago {paymentMethodLabel(payment.paymentMethod).toLowerCase()}: ${formatMoneyFromCents(dueCents)} · Sin movimiento de efectivo.{payment.paymentReference ? ` Referencia: ${payment.paymentReference}` : ''}</p>}
                        {method === 'credit' && <p className="split-review-payment-detail">Abono ${Money.toNumber(amountPaid).toFixed(2)} mediante {paymentMethodLabel(payment.initialPaymentMethod || 'efectivo').toLowerCase()} · Saldo pendiente ${Money.toNumber(balance).toFixed(2)}.{payment.paymentReference ? ` Referencia: ${payment.paymentReference}` : ''}</p>}
                        {payment.sendReceipt && <p className="split-review-payment-detail">Se enviará el ticket por WhatsApp.</p>}
                        <div className="split-review-edit-actions">
                          <button type="button" className="split-link-button" onClick={() => goToStep('items')}>{splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? 'Cambiar productos' : 'Cambiar importe'}</button>
                          <button type="button" className="split-link-button" onClick={() => goToStep('payment')}>Editar cobro</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? (
                  <div className="split-review-total">
                    <div><span>Total original</span><strong>${formatMoneyFromCents(ticketMath.parentCents)}</strong></div>
                    <div><span>Total asignado</span><strong>${formatMoneyFromCents(ticketMath.totalsCents.reduce((sum, amount) => sum + amount, 0))}</strong></div>
                    <div><span>Pendiente por asignar</span><strong>{formatQuantity(assignmentProgress.pendingQuantity)}</strong></div>
                  </div>
                ) : (
                  <div className="split-review-total">
                    <div><span>Total original</span><strong>${formatMoneyFromCents(parentTotalCents)}</strong></div>
                    <div><span>Total distribuido</span><strong>${formatMoneyFromCents(distributedCents)}</strong></div>
                    <div><span>Pendiente por distribuir</span><strong>${formatMoneyFromCents(pendingPaymentCents)}</strong></div>
                  </div>
                )}
              </section>
            )}
          </div>

          {!draftNotice && willAutoOpenCaja && (currentStep === 'payment' || currentStep === 'review') && (
            <p className="split-validation-warning">Se verificará la sesión operativa de caja al confirmar. Solo los pagos en efectivo aumentan el efectivo esperado; tarjeta, transferencia y Fiado sin abono en efectivo no crean movimientos de caja.</p>
          )}

          {activeError && (currentStep === 'items' || currentStep === 'payment' || currentStep === 'review') && (
            <p id="split-validation-error" className="split-validation-error" role="alert">{activeError}</p>
          )}

          <div className="split-actions">
            <button type="button" className="split-secondary-button" onClick={currentStepIndex === 0 ? onClose : () => goToStep(wizardSteps[currentStepIndex - 1].id)} disabled={isSubmitting}>
              {currentStepIndex === 0 ? 'Guardar y cerrar' : <><ChevronLeft size={18} aria-hidden="true" /> {wizardSteps[currentStepIndex - 1].title}</>}
            </button>
            {isFinalStep ? (
              <button key="confirm-split" type="button" className="split-primary-button" onClick={handleConfirmClick} disabled={Boolean(paymentValidationError) || isSubmitting || !isSessionReady}>
                {isSubmitting ? 'Procesando…' : 'Confirmar división y cobro'}
              </button>
            ) : (
              <button
                key="advance-split"
                type="button"
                className="split-primary-button"
                onClick={(event) => { event.preventDefault(); goForward(); }}
                disabled={isSubmitting || (currentStep === 'items' && Boolean(assignmentError || distributionError)) || (currentStep === 'payment' && Boolean(paymentValidationError))}
              >
                {currentStep === 'people'
                  ? (splitIntent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS ? 'Asignar platos' : splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT ? 'Distribuir importe' : 'Ingresar montos')
                  : currentStep === 'items' ? 'Configurar cobro' : 'Revisar división'}
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
