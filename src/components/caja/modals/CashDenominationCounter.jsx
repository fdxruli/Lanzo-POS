import { useEffect, useMemo, useState } from 'react';
import { Money } from '../../../utils/moneyMath';
import './CashDenominationCounter.css';

const DENOMINATION_GROUPS = [
  {
    id: 'bills',
    title: 'Billetes',
    subtotalLabel: 'Subtotal billetes',
    denominations: [
      { id: 'bill-1000', label: 'Billete de $1,000', value: '1000' },
      { id: 'bill-500', label: 'Billete de $500', value: '500' },
      { id: 'bill-200', label: 'Billete de $200', value: '200' },
      { id: 'bill-100', label: 'Billete de $100', value: '100' },
      { id: 'bill-50', label: 'Billete de $50', value: '50' },
      { id: 'bill-20', label: 'Billete de $20', value: '20' }
    ]
  },
  {
    id: 'coins',
    title: 'Monedas',
    subtotalLabel: 'Subtotal monedas',
    denominations: [
      { id: 'coin-20', label: 'Moneda de $20', value: '20' },
      { id: 'coin-10', label: 'Moneda de $10', value: '10' },
      { id: 'coin-5', label: 'Moneda de $5', value: '5' },
      { id: 'coin-2', label: 'Moneda de $2', value: '2' },
      { id: 'coin-1', label: 'Moneda de $1', value: '1' }
    ]
  },
  {
    id: 'centavos',
    title: 'Centavos',
    subtotalLabel: 'Subtotal centavos',
    denominations: [
      { id: 'coin-050', label: 'Moneda de 50 centavos', value: '0.50' },
      { id: 'coin-020', label: 'Moneda de 20 centavos', value: '0.20' },
      { id: 'coin-010', label: 'Moneda de 10 centavos', value: '0.10' },
      { id: 'coin-005', label: 'Moneda de 5 centavos', value: '0.05' }
    ]
  }
];

const formatMoney = (amount) => `$${Money.toNumber(amount).toFixed(2)}`;

const calculateGroupTotal = (group, counts) => group.denominations.reduce(
  (subtotal, denomination) => Money.add(
    subtotal,
    Money.multiply(denomination.value, counts[denomination.id] || '0')
  ),
  Money.init(0)
);

const calculateTotal = (counts) => DENOMINATION_GROUPS.reduce(
  (total, group) => Money.add(total, calculateGroupTotal(group, counts)),
  Money.init(0)
);

const CashDenominationCounter = ({
  value,
  onChange,
  expectedAmount = '0',
  inputId,
  manualLabel = 'Efectivo contado',
  required = false,
  disabled = false,
  autoFocus = false,
  resetKey,
  showDifference = true,
  mode: controlledMode,
  onModeChange,
  counts: controlledCounts,
  onCountsChange
}) => {
  const [localMode, setLocalMode] = useState('manual');
  const [localCounts, setLocalCounts] = useState({});
  const mode = controlledMode ?? localMode;
  const counts = controlledCounts ?? localCounts;
  const updateMode = onModeChange || setLocalMode;
  const updateCounts = onCountsChange || setLocalCounts;

  useEffect(() => {
    if (controlledMode === undefined) setLocalMode('manual');
    if (controlledCounts === undefined) setLocalCounts({});
  }, [controlledMode, controlledCounts, resetKey]);

  const total = useMemo(() => calculateTotal(counts), [counts]);
  const expected = useMemo(() => Money.init(expectedAmount || 0), [expectedAmount]);
  const difference = useMemo(() => Money.subtract(total, expected), [total, expected]);

  const handleCountChange = (denominationId, nextValue) => {
    if (nextValue !== '' && !/^\d+$/.test(nextValue)) return;

    const nextCounts = { ...counts, [denominationId]: nextValue };
    updateCounts(nextCounts);
    onChange(Money.toExactString(calculateTotal(nextCounts)));
  };

  const selectMode = (nextMode) => {
    updateMode(nextMode);
    if (nextMode === 'assisted') {
      onChange(Money.toExactString(total));
    }
  };

  return (
    <div className="cash-count">
      <fieldset className="cash-count__mode" disabled={disabled}>
        <legend>Forma de conteo</legend>
        <label className={`cash-count__mode-option${mode === 'manual' ? ' is-active' : ''}`}>
          <input
            type="radio"
            name={`${inputId}-mode`}
            value="manual"
            checked={mode === 'manual'}
            onChange={() => selectMode('manual')}
          />
          <span>Total manual</span>
        </label>
        <label className={`cash-count__mode-option${mode === 'assisted' ? ' is-active' : ''}`}>
          <input
            type="radio"
            name={`${inputId}-mode`}
            value="assisted"
            checked={mode === 'assisted'}
            onChange={() => selectMode('assisted')}
          />
          <span>Conteo por denominaciones</span>
        </label>
      </fieldset>

      {mode === 'manual' ? (
        <div className="cash-count__manual">
          <label htmlFor={inputId}>{manualLabel}</label>
          <div className="cash-count__manual-input">
            <span aria-hidden="true">$</span>
            <input
              id={inputId}
              type="number"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              step="0.01"
              min="0"
              required={required}
              autoFocus={autoFocus}
              disabled={disabled}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
        </div>
      ) : (
        <div className="cash-count__assisted">
          {DENOMINATION_GROUPS.map((group) => {
            const groupTotal = calculateGroupTotal(group, counts);
            const visibleDenominations = group.id === 'centavos'
              ? group.denominations.slice(0, 1)
              : group.denominations;
            const smallerCentavoDenominations = group.id === 'centavos'
              ? group.denominations.slice(1)
              : [];
            const renderDenominations = (denominations) => denominations.map((denomination) => {
              const subtotal = Money.multiply(denomination.value, counts[denomination.id] || '0');
              const countInputId = `${inputId}-${denomination.id}`;
              return (
                <div className="cash-count__denomination" key={denomination.id}>
                  <label htmlFor={countInputId}>{denomination.label}</label>
                  <div className="cash-count__quantity">
                    <input
                      id={countInputId}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={counts[denomination.id] || ''}
                      onChange={(event) => handleCountChange(denomination.id, event.target.value)}
                      aria-label={`Cantidad de piezas: ${denomination.label}`}
                      disabled={disabled}
                    />
                    <span>piezas</span>
                  </div>
                  <small>Subtotal {formatMoney(subtotal)}</small>
                </div>
              );
            });
            return (
              <section className="cash-count__group" key={group.id} aria-labelledby={`${inputId}-${group.id}-title`}>
                <h3 id={`${inputId}-${group.id}-title`}>{group.title}</h3>
                <div className="cash-count__grid">{renderDenominations(visibleDenominations)}</div>
                {smallerCentavoDenominations.length > 0 && (
                  <details className="cash-count__minor-centavos">
                    <summary>Más centavos (20¢, 10¢ y 5¢)</summary>
                    <div className="cash-count__grid">{renderDenominations(smallerCentavoDenominations)}</div>
                  </details>
                )}
                <p className="cash-count__group-total">
                  <span>{group.subtotalLabel}</span>
                  <strong>{formatMoney(groupTotal)}</strong>
                </p>
              </section>
            );
          })}

          <div className={`cash-count__result${showDifference ? '' : ' cash-count__result--single'}`} aria-live="polite" aria-atomic="true">
            <div>
              <span>Total contado</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            {showDifference && (
              <div>
                <span>{difference.gt(0) ? 'Sobrante' : difference.lt(0) ? 'Faltante' : 'Diferencia'}</span>
                <strong>
                  {difference.gt(0) ? '+' : difference.lt(0) ? '−' : ''}
                  {formatMoney(difference.abs())}
                </strong>
              </div>
            )}
          </div>
          <p className="cash-count__hint">Las cantidades se cuentan en piezas enteras. Los centavos se suman sin redondeo.</p>
        </div>
      )}
    </div>
  );
};

export default CashDenominationCounter;
