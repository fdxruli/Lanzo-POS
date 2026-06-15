import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, UserRound } from 'lucide-react';
import { Money } from '../../utils/moneyMath';

export default function CashOpeningForm({
  suggestedAmount = '0',
  onConfirm,
  onCancel,
  submitLabel = 'Abrir caja',
  cancelLabel = 'Cancelar',
  origin = 'manual'
}) {
  const normalizedSuggestion = Money.toExactString(Money.init(suggestedAmount || 0));
  const [montoInicial, setMontoInicial] = useState(normalizedSuggestion);
  const [montoContado, setMontoContado] = useState(normalizedSuggestion);
  const [responsable, setResponsable] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setMontoInicial(normalizedSuggestion);
    setMontoContado(normalizedSuggestion);
    setError('');
  }, [normalizedSuggestion]);

  const amountsMatch = useMemo(() => {
    try {
      return Money.init(montoInicial || 0).eq(Money.init(montoContado || 0));
    } catch {
      return false;
    }
  }, [montoContado, montoInicial]);

  const openingDifference = useMemo(() => {
    try {
      return Money.subtract(montoContado || 0, normalizedSuggestion);
    } catch {
      return Money.init(0);
    }
  }, [montoContado, normalizedSuggestion]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!responsable.trim()) {
      setError('Escribe el nombre del empleado responsable.');
      return;
    }

    if (!amountsMatch) {
      setError('El fondo confirmado debe coincidir con el efectivo contado.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await onConfirm({
        montoInicial,
        montoContado,
        responsable: responsable.trim(),
        origen: origin
      });

      if (success === false) {
        setError('No se pudo abrir la caja. Revisa los datos e intenta de nuevo.');
      }
    } catch (submitError) {
      setError(submitError?.message || 'No se pudo abrir la caja.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="cash-opening-form" onSubmit={handleSubmit}>
      <div className="cash-opening-reference">
        <span>Fondo sugerido por el cierre anterior</span>
        <strong>${Money.toNumber(normalizedSuggestion).toFixed(2)}</strong>
      </div>

      <div className="cash-opening-fields">
        <label>
          <span>Empleado responsable</span>
          <div className="cash-opening-input">
            <UserRound size={18} aria-hidden="true" />
            <input
              type="text"
              value={responsable}
              onChange={(event) => setResponsable(event.target.value)}
              placeholder="Nombre del operador"
              autoComplete="name"
              maxLength={100}
              disabled={isSubmitting}
              required
              autoFocus
            />
          </div>
        </label>

        <label>
          <span>Fondo confirmado</span>
          <div className="cash-opening-input cash-opening-input--money">
            <span>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={montoInicial}
              onChange={(event) => setMontoInicial(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
        </label>

        <label>
          <span>Efectivo contado</span>
          <div className="cash-opening-input cash-opening-input--money">
            <span>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={montoContado}
              onChange={(event) => setMontoContado(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
        </label>
      </div>

      {!amountsMatch && (
        <div className="cash-opening-notice cash-opening-notice--warning">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>Ajusta el fondo confirmado para que coincida con el conteo físico.</p>
        </div>
      )}

      {amountsMatch && !Money.init(openingDifference).eq(0) && (
        <div className="cash-opening-notice">
          <BadgeCheck size={18} aria-hidden="true" />
          <p>
            Se registrará una diferencia de apertura de
            {' '}${Money.toNumber(openingDifference).toFixed(2)} contra el fondo sugerido.
          </p>
        </div>
      )}

      {error && <p className="cash-opening-error" role="alert">{error}</p>}

      <div className="cash-opening-actions">
        {onCancel && (
          <button
            type="button"
            className="btn caja-modal__button caja-modal__button--secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="submit"
          className="btn caja-modal__button caja-modal__button--positive"
          disabled={isSubmitting || !amountsMatch}
        >
          {isSubmitting ? 'Abriendo...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
