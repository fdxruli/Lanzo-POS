import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, MapPin, PackageCheck, Truck, X } from 'lucide-react';
import PublicOrderConfirmation from './PublicOrderConfirmation';
import {
  lockPublicDocumentScroll,
  unlockPublicDocumentScroll
} from '../../../utils/publicDocumentScroll';
import {
  createEmptyEcommerceDeliveryAddress,
  formatEcommerceDeliveryAddress,
  normalizeEcommerceDeliveryAddress
} from '../../../utils/ecommerceDeliveryAddress';

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

const createEmptyForm = (portal) => ({
  name: '',
  phone: '',
  fulfillmentMethod: getInitialFulfillmentMethod(portal),
  deliveryAddress: createEmptyEcommerceDeliveryAddress(),
  notes: '',
});

const normalizeForm = (form) => {
  const fulfillmentMethod = form.fulfillmentMethod;
  const deliveryAddress = fulfillmentMethod === 'delivery'
    ? normalizeEcommerceDeliveryAddress(form.deliveryAddress)
    : null;
  return {
    name: form.name.trim().slice(0, 120),
    phone: form.phone.trim().slice(0, 40),
    address: deliveryAddress ? formatEcommerceDeliveryAddress(deliveryAddress) : '',
    notes: form.notes.trim().slice(0, 1000),
    fulfillmentMethod,
    ...(deliveryAddress ? { deliveryAddress } : {})
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

  if (normalized.fulfillmentMethod === 'delivery') {
    const address = normalized.deliveryAddress;
    if (!address.street) errors['deliveryAddress.street'] = 'Escribe la calle, avenida o camino.';
    if (!address.neighborhood) errors['deliveryAddress.neighborhood'] = 'Escribe la colonia, barrio, ejido o localidad.';
    if (address.municipality.length < 2) errors['deliveryAddress.municipality'] = 'Escribe el municipio o ciudad.';
    if (!address.state) errors['deliveryAddress.state'] = 'Escribe el estado.';
    if (!address.postalCode) {
      errors['deliveryAddress.postalCode'] = 'Escribe el código postal.';
    } else if (!/^\d{5}$/.test(address.postalCode)) {
      errors['deliveryAddress.postalCode'] = 'Escribe un código postal de 5 dígitos.';
    }
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
  acceptingOrders = true,
}) {
  const closeButtonRef = useRef(null);
  const submitPromiseRef = useRef(null);
  const [form, setForm] = useState(() => createEmptyForm(portal));
  const [fieldErrors, setFieldErrors] = useState({});
  const isSubmitting = status === 'submitting';
  const isConfirmed = status === 'confirmed';
  const portalSlug = portal?.slug || '';
  const pickupEnabled = portal?.pickupEnabled === true;
  const deliveryEnabled = portal?.deliveryEnabled === true;
  const fulfillmentPortal = useMemo(() => ({
    pickupEnabled,
    deliveryEnabled,
  }), [deliveryEnabled, pickupEnabled]);
  const availableMethods = useMemo(() => [
    pickupEnabled ? 'pickup' : null,
    deliveryEnabled ? 'delivery' : null,
  ].filter(Boolean), [deliveryEnabled, pickupEnabled]);

  useEffect(() => {
    if (!isOpen) return undefined;
    lockPublicDocumentScroll('public-checkout');
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlockPublicDocumentScroll('public-checkout');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  useEffect(() => {
    setForm(createEmptyForm(fulfillmentPortal));
    setFieldErrors({});
  }, [fulfillmentPortal, portalSlug]);

  useEffect(() => {
    if (!isConfirmed) return;
    setForm(createEmptyForm(fulfillmentPortal));
    setFieldErrors({});
  }, [fulfillmentPortal, isConfirmed]);

  useEffect(() => {
    if (!isOpen || isConfirmed) return;
    setForm((current) => {
      const currentAvailable = (
        (current.fulfillmentMethod === 'pickup' && pickupEnabled)
        || (current.fulfillmentMethod === 'delivery' && deliveryEnabled)
      );
      if (currentAvailable) return current;
      return {
        ...current,
        fulfillmentMethod: getInitialFulfillmentMethod(fulfillmentPortal),
        deliveryAddress: createEmptyEcommerceDeliveryAddress(),
      };
    });
  }, [deliveryEnabled, fulfillmentPortal, isConfirmed, isOpen, pickupEnabled]);

  if (!isOpen) return null;

  const updateField = (field, value) => {
    setForm((current) => {
      if (field === 'fulfillmentMethod' && value === 'pickup') {
        return {
          ...current,
          fulfillmentMethod: value,
          deliveryAddress: createEmptyEcommerceDeliveryAddress()
        };
      }
      return { ...current, [field]: value };
    });
    setFieldErrors((current) => {
      const next = { ...current, [field]: undefined, cart: undefined };
      if (field === 'fulfillmentMethod' && value === 'pickup') {
        Object.keys(createEmptyEcommerceDeliveryAddress()).forEach((addressField) => {
          next[`deliveryAddress.${addressField}`] = undefined;
        });
      }
      return next;
    });
  };

  const updateDeliveryAddressField = (field, value) => {
    setForm((current) => ({
      ...current,
      deliveryAddress: {
        ...current.deliveryAddress,
        [field]: value
      }
    }));
    setFieldErrors((current) => ({
      ...current,
      [`deliveryAddress.${field}`]: undefined,
      cart: undefined
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isSubmitting || submitPromiseRef.current) return;
    const validation = validateCheckout(form, portal, cart);
    setFieldErrors(validation.errors);
    if (Object.keys(validation.errors).length > 0) return;
    const submitPromise = Promise.resolve(onSubmit(validation.normalized));
    submitPromiseRef.current = submitPromise;
    try {
      await submitPromise;
    } catch {
      // La página conserva el error seguro y permite reintentar con la misma llave.
    } finally {
      if (submitPromiseRef.current === submitPromise) submitPromiseRef.current = null;
    }
  };

  const handleContinue = () => {
    setForm(createEmptyForm(fulfillmentPortal));
    setFieldErrors({});
    onContinue();
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
              slug={portal?.slug}
              whatsapp={confirmedOrder?.whatsapp}
              whatsappEnabled={features?.whatsappCheckout === true}
              onContinue={handleContinue}
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
                <fieldset className="public-checkout-address-fields" disabled={isSubmitting}>
                  <legend><MapPin aria-hidden="true" size={17} /> Dirección de entrega</legend>
                  <div className="public-checkout-address-grid">
                    <label className="public-checkout-field public-checkout-field--wide">
                      <span>Calle / avenida / camino *</span>
                      <input
                        type="text"
                        name="deliveryAddress.street"
                        autoComplete="address-line1"
                        maxLength={160}
                        placeholder={portal?.addressStreet ? `Ej. ${portal.addressStreet}` : undefined}
                        value={form.deliveryAddress.street}
                        onChange={(event) => updateDeliveryAddressField('street', event.target.value)}
                        aria-invalid={Boolean(fieldErrors['deliveryAddress.street'])}
                        aria-describedby={fieldErrors['deliveryAddress.street'] ? 'public-checkout-delivery-street-error' : undefined}
                      />
                      {fieldErrors['deliveryAddress.street'] ? <small id="public-checkout-delivery-street-error">{fieldErrors['deliveryAddress.street']}</small> : null}
                    </label>

                    <label className="public-checkout-field">
                      <span>Número exterior</span>
                      <input
                        type="text"
                        name="deliveryAddress.exteriorNumber"
                        autoComplete="address-line2"
                        maxLength={40}
                        placeholder="Número o S/N"
                        value={form.deliveryAddress.exteriorNumber}
                        onChange={(event) => updateDeliveryAddressField('exteriorNumber', event.target.value)}
                      />
                    </label>

                    <label className="public-checkout-field">
                      <span>Número interior</span>
                      <input
                        type="text"
                        name="deliveryAddress.interiorNumber"
                        maxLength={40}
                        value={form.deliveryAddress.interiorNumber}
                        onChange={(event) => updateDeliveryAddressField('interiorNumber', event.target.value)}
                      />
                    </label>

                    <label className="public-checkout-field public-checkout-field--wide">
                      <span>Colonia / barrio / ejido / localidad *</span>
                      <input
                        type="text"
                        name="deliveryAddress.neighborhood"
                        autoComplete="address-line2"
                        maxLength={160}
                        placeholder={portal?.addressNeighborhood ? `Ej. ${portal.addressNeighborhood}` : undefined}
                        value={form.deliveryAddress.neighborhood}
                        onChange={(event) => updateDeliveryAddressField('neighborhood', event.target.value)}
                        aria-invalid={Boolean(fieldErrors['deliveryAddress.neighborhood'])}
                        aria-describedby={fieldErrors['deliveryAddress.neighborhood'] ? 'public-checkout-delivery-neighborhood-error' : undefined}
                      />
                      {fieldErrors['deliveryAddress.neighborhood'] ? <small id="public-checkout-delivery-neighborhood-error">{fieldErrors['deliveryAddress.neighborhood']}</small> : null}
                    </label>

                    <label className="public-checkout-field">
                      <span>Municipio / ciudad *</span>
                      <input
                        type="text"
                        name="deliveryAddress.municipality"
                        autoComplete="address-level2"
                        maxLength={120}
                        placeholder={portal?.addressMunicipality ? `Ej. ${portal.addressMunicipality}` : undefined}
                        value={form.deliveryAddress.municipality}
                        onChange={(event) => updateDeliveryAddressField('municipality', event.target.value)}
                        aria-invalid={Boolean(fieldErrors['deliveryAddress.municipality'])}
                        aria-describedby={fieldErrors['deliveryAddress.municipality'] ? 'public-checkout-delivery-municipality-error' : undefined}
                      />
                      {fieldErrors['deliveryAddress.municipality'] ? <small id="public-checkout-delivery-municipality-error">{fieldErrors['deliveryAddress.municipality']}</small> : null}
                    </label>

                    <label className="public-checkout-field">
                      <span>Estado *</span>
                      <input
                        type="text"
                        name="deliveryAddress.state"
                        autoComplete="address-level1"
                        maxLength={80}
                        placeholder={portal?.addressState ? `Ej. ${portal.addressState}` : undefined}
                        value={form.deliveryAddress.state}
                        onChange={(event) => updateDeliveryAddressField('state', event.target.value)}
                        aria-invalid={Boolean(fieldErrors['deliveryAddress.state'])}
                        aria-describedby={fieldErrors['deliveryAddress.state'] ? 'public-checkout-delivery-state-error' : undefined}
                      />
                      {fieldErrors['deliveryAddress.state'] ? <small id="public-checkout-delivery-state-error">{fieldErrors['deliveryAddress.state']}</small> : null}
                    </label>

                    <label className="public-checkout-field">
                      <span>Código postal *</span>
                      <input
                        type="text"
                        name="deliveryAddress.postalCode"
                        autoComplete="postal-code"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder={portal?.addressPostalCode ? `Ej. ${portal.addressPostalCode}` : undefined}
                        value={form.deliveryAddress.postalCode}
                        onChange={(event) => updateDeliveryAddressField('postalCode', event.target.value)}
                        aria-invalid={Boolean(fieldErrors['deliveryAddress.postalCode'])}
                        aria-describedby={fieldErrors['deliveryAddress.postalCode'] ? 'public-checkout-delivery-postal-code-error' : undefined}
                      />
                      {fieldErrors['deliveryAddress.postalCode'] ? <small id="public-checkout-delivery-postal-code-error">{fieldErrors['deliveryAddress.postalCode']}</small> : null}
                    </label>

                    <label className="public-checkout-field public-checkout-field--wide">
                      <span>Referencia para llegar</span>
                      <textarea
                        name="deliveryAddress.reference"
                        maxLength={500}
                        rows={2}
                        value={form.deliveryAddress.reference}
                        onChange={(event) => updateDeliveryAddressField('reference', event.target.value)}
                      />
                    </label>
                  </div>
                </fieldset>
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
                disabled={isSubmitting || acceptingOrders !== true}
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
