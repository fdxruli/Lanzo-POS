import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, MapPin, PackageCheck, Truck, X } from 'lucide-react';
import PublicOrderConfirmation from './PublicOrderConfirmation';

const STALE_CART_CODES = new Set([
  'ECOMMERCE_PRODUCT_NOT_FOUND',
  'ECOMMERCE_PRODUCT_NOT_AVAILABLE',
  'ECOMMERCE_INVALID_QUANTITY',
  'ECOMMERCE_STOCK_LIMIT_EXCEEDED',
  'ECOMMERCE_MIN_ORDER_NOT_REACHED',
]);

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const getInitialFulfillmentMethod = (portal) => {
  if (portal?.pickupEnabled) return 'pickup';
  if (portal?.deliveryEnabled) return 'delivery';
  return '';
};

const normalizeForm = (form) => {
  const fulfillmentMethod = form.fulfillmentMethod;
  return {
    name: form.name.trim().slice(0, 120),
    phone: form.phone.trim().slice(0, 40),
    address: fulfillmentMethod === 'delivery' ? form.address.trim().slice(0, 500) : '',
    notes: form.notes.trim().slice(0, 1000),
    fulfillmentMethod,
  };
};

function validateCheckout(form, portal, cart) {
  const errors = {};
  const normalized = normalizeForm(form);
  const phoneDigits = normalized.phone.replace(/\D/g, '');

  if (normalized.name.length < 2) errors.name = 'Escribe al menos 2 caracteres.';
  if (phoneDigits.length < 8) errors.phone = 'Escribe un teléfono con al menos 8 dígitos.';

  const methodAvailable = (
    (normalized.fulfillmentMethod === 'pickup' && portal?.pickupEnabled)
    || (normalized.fulfillmentMethod === 'delivery' && portal?.deliveryEnabled)
  );
  if (!methodAvailable) errors.fulfillmentMethod = 'Selecciona una modalidad disponible.';

  if (normalized.fulfillmentMethod === 'delivery' && normalized.address.length < 5) {
    errors.address = 'Escribe una dirección de al menos 5 caracteres.';
  }

  if (!cart?.isReconciled) errors.cart = 'El carrito todavía se está actualizando.';
  if (!Array.isArray(cart?.items) || cart.items.length === 0) errors.cart = 'Agrega productos al carrito.';
  if (!cart?.minimumReached) errors.cart = 'El pedido no alcanza el mínimo requerido.';
  if (cart?.items?.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    errors.cart = 'Revisa las cantidades del carrito.';
  }

  return { errors, normalized };
}

function PublicCheckoutDialog({
  isOpen,
  status,
  error,
  portal,
  features,
  cart,
  confirmedOrder,
  onClose,
  onSubmit,
  onRefreshCart,
  onContinue,
}) {
  const closeButtonRef = useRef(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    fulfillmentMethod: getInitialFulfillmentMethod(portal),
    address: '',
    notes: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const isSubmitting = status === 'submitting';
  const isConfirmed = status === 'confirmed';
  const availableMethods = useMemo(() => [
    portal?.pickupEnabled ? 'pickup' : null,
    portal?.deliveryEnabled ? 'delivery' : null,
  ].filter(Boolean), [portal?.deliveryEnabled, portal?.pickupEnabled]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  useEffect(() => {
    if (!isOpen || isConfirmed) return;
    setForm((current) => {
      const currentAvailable = (
        (current.fulfillmentMethod === 'pickup' && portal?.pickupEnabled)
        || (current.fulfillmentMethod === 'delivery' && portal?.deliveryEnabled)
      );
      if (currentAvailable) return current;
      return {
        ...current,
        fulfillmentMethod: getInitialFulfillmentMethod(portal),
        address: '',
      };
    });
  }, [isConfirmed, isOpen, portal]);

  if (!isOpen) return null;

  const updateField = (field, value) => {
    setForm((current) => {
      if (field === 'fulfillmentMethod' && value === 'pickup') {
        return { ...current, fulfillmentMethod: value, address: '' };
      }
      return { ...current, [field]: value };
    });
    setFieldErrors((current) => ({ ...current, [field]: undefined, cart: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const validation = validateCheckout(form, portal, cart);
    setFieldErrors(validation.errors);
    if (Object.keys(validation.errors).length > 0) return;
    try {
      await onSubmit(validation.normalized);
    } catch {
      // La página conserva el error seguro y permite reintentar con la misma llave.
    }
  };

  const showRefresh = STALE_CART_CODES.has(error?.code);

  return (
    <div className="public-checkout-modal">
      <button
        type="button"
        className="public-checkout-modal__backdrop"
        onClick={isSubmitting ? undefined : onClose}
        aria-label="Cerrar checkout"
        disabled={isSubmitting}
      />
      <section
        className="public-checkout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={isConfirmed ? 'public-order-confirmation-title' : 'public-checkout-title'}
      >
        <header className="public-checkout-dialog__header">
          <div>
            <p className="public-store-section-kicker">
              {isConfirmed ? 'Confirmación' : 'Datos del pedido'}
            </p>
            {!isConfirmed ? <h2 id="public-checkout-title">Finalizar pedido</h2> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="public-icon-button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar checkout"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <div className="public-checkout-dialog__body">
          {isConfirmed ? (
            <PublicOrderConfirmation
              order={confirmedOrder?.order}
              whatsapp={confirmedOrder?.whatsapp}
              whatsappEnabled={features?.whatsappCheckout === true}
              onContinue={onContinue}
            />
          ) : (
            <form className="public-checkout-form" onSubmit={submit} noValidate>
              <div className="public-checkout-summary">
                <span>{cart?.totalUnits || 0} unidades</span>
                <strong>{formatCurrency(cart?.subtotal, cart?.currency)}</strong>
              </div>

              {error ? (
                <div className="public-checkout-error" role="alert">
                  <AlertCircle aria-hidden="true" size={20} />
                  <div>
                    <strong>No se pudo confirmar el pedido</strong>
                    <p>{error.message}</p>
                    {showRefresh ? (
                      <button type="button" onClick={onRefreshCart}>
                        Actualizar carrito
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <label className="public-checkout-field">
                <span>Nombre *</span>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  maxLength={120}
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'public-checkout-name-error' : undefined}
                  disabled={isSubmitting}
                />
                {fieldErrors.name ? <small id="public-checkout-name-error">{fieldErrors.name}</small> : null}
              </label>

              <label className="public-checkout-field">
                <span>Teléfono *</span>
                <input
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={40}
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? 'public-checkout-phone-error' : undefined}
                  disabled={isSubmitting}
                />
                {fieldErrors.phone ? <small id="public-checkout-phone-error">{fieldErrors.phone}</small> : null}
              </label>

              <fieldset className="public-checkout-methods" disabled={isSubmitting}>
                <legend>Modalidad *</legend>
                {availableMethods.includes('pickup') ? (
                  <label>
                    <input
                      type="radio"
                      name="fulfillmentMethod"
                      value="pickup"
                      checked={form.fulfillmentMethod === 'pickup'}
                      onChange={(event) => updateField('fulfillmentMethod', event.target.value)}
                    />
                    <PackageCheck aria-hidden="true" size={20} />
                    <span>
                      <strong>Recoger</strong>
                      <small>Recoge tu pedido en el negocio.</small>
                    </span>
                  </label>
                ) : null}
                {availableMethods.includes('delivery') ? (
                  <label>
                    <input
                      type="radio"
                      name="fulfillmentMethod"
                      value="delivery"
                      checked={form.fulfillmentMethod === 'delivery'}
                      onChange={(event) => updateField('fulfillmentMethod', event.target.value)}
                    />
                    <Truck aria-hidden="true" size={20} />
                    <span>
                      <strong>Domicilio</strong>
                      <small>El negocio coordinará la entrega.</small>
                    </span>
                  </label>
                ) : null}
                {fieldErrors.fulfillmentMethod ? <small>{fieldErrors.fulfillmentMethod}</small> : null}
              </fieldset>

              {form.fulfillmentMethod === 'delivery' ? (
                <label className="public-checkout-field">
                  <span><MapPin aria-hidden="true" size={17} /> Dirección *</span>
                  <textarea
                    name="address"
                    autoComplete="street-address"
                    maxLength={500}
                    rows={3}
                    value={form.address}
                    onChange={(event) => updateField('address', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.address)}
                    aria-describedby={fieldErrors.address ? 'public-checkout-address-error' : undefined}
                    disabled={isSubmitting}
                  />
                  {fieldErrors.address ? <small id="public-checkout-address-error">{fieldErrors.address}</small> : null}
                </label>
              ) : null}

              <label className="public-checkout-field">
                <span>Notas</span>
                <textarea
                  name="notes"
                  maxLength={1000}
                  rows={3}
                  value={form.notes}
                  onChange={(event) => updateField('notes', event.target.value)}
                  disabled={isSubmitting}
                />
              </label>

              {fieldErrors.cart ? (
                <p className="public-checkout-field-error" role="alert">{fieldErrors.cart}</p>
              ) : null}

              <p className="public-checkout-privacy">
                Tus datos se usarán únicamente para coordinar este pedido con el negocio.
              </p>

              <button
                type="submit"
                className="ui-button ui-button--primary public-checkout-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="public-checkout-spinner" aria-hidden="true" size={19} />
                    Enviando pedido...
                  </>
                ) : (
                  'Confirmar pedido'
                )}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

export default PublicCheckoutDialog;
