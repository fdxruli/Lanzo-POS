import { Money } from '../utils/moneyMath';

export const CASH_OPENING_POLICY_KEY = 'lanzo_cash_opening_policy';
export const CASH_OPENING_POLICY_EVENT = 'lanzo:cash-opening-policy-changed';

export const CASH_OPENING_POLICY = Object.freeze({
  MANUAL: 'manual',
  AUTOMATIC: 'automatic'
});

export function getCashOpeningPolicy() {
  try {
    const stored = localStorage.getItem(CASH_OPENING_POLICY_KEY);
    return stored === CASH_OPENING_POLICY.AUTOMATIC
      ? CASH_OPENING_POLICY.AUTOMATIC
      : CASH_OPENING_POLICY.MANUAL;
  } catch {
    return CASH_OPENING_POLICY.MANUAL;
  }
}

export function setCashOpeningPolicy(policy) {
  const normalized = policy === CASH_OPENING_POLICY.AUTOMATIC
    ? CASH_OPENING_POLICY.AUTOMATIC
    : CASH_OPENING_POLICY.MANUAL;

  try {
    localStorage.setItem(CASH_OPENING_POLICY_KEY, normalized);
    window.dispatchEvent(new CustomEvent(CASH_OPENING_POLICY_EVENT, {
      detail: { policy: normalized }
    }));
  } catch {
    // La preferencia sigue siendo segura: la apertura manual es el fallback.
  }

  return normalized;
}

export function buildManualOpeningData(input, suggestedAmount = '0') {
  const payload = input && typeof input === 'object'
    ? input
    : { montoInicial: input };
  const responsible = String(payload.responsable || '').trim();
  const initialAmount = Money.init(payload.montoInicial || 0);
  const countedAmount = Money.init(payload.montoContado || 0);
  const suggested = Money.init(suggestedAmount || 0);

  if (!responsible) {
    throw new Error('Identifica al empleado responsable de la apertura.');
  }

  if (initialAmount.lt(0) || countedAmount.lt(0)) {
    throw new Error('Los montos de apertura no pueden ser negativos.');
  }

  if (!initialAmount.eq(countedAmount)) {
    throw new Error('El fondo confirmado debe coincidir con el efectivo contado.');
  }

  return {
    montoInicial: Money.toExactString(initialAmount),
    montoContado: Money.toExactString(countedAmount),
    montoSugerido: Money.toExactString(suggested),
    diferenciaApertura: Money.toExactString(Money.subtract(countedAmount, suggested)),
    responsable: responsible,
    esAutoApertura: false,
    politicaApertura: CASH_OPENING_POLICY.MANUAL,
    origen: payload.origen || 'manual'
  };
}

export function buildAutomaticOpeningData(suggestedAmount = '0', origin = 'policy') {
  const suggested = Money.init(suggestedAmount || 0);

  if (suggested.lt(0)) {
    throw new Error('No se puede abrir una caja con fondo negativo.');
  }

  const normalizedAmount = Money.toExactString(suggested);
  return {
    montoInicial: normalizedAmount,
    montoContado: normalizedAmount,
    montoSugerido: normalizedAmount,
    diferenciaApertura: Money.toExactString(Money.init(0)),
    responsable: 'Sistema (autoapertura configurada)',
    esAutoApertura: true,
    politicaApertura: CASH_OPENING_POLICY.AUTOMATIC,
    origen: origin
  };
}
