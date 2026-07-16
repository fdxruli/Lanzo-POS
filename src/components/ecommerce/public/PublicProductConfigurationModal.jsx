import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Minus, Plus, RefreshCw, X } from 'lucide-react';
import { getPublicProductConfiguration } from '../../../services/ecommerce/ecommercePublicService';
import {
  buildEcommerceConfiguredCartLine,
  calculateEcommerceConfiguredPrice,
  findEcommerceVariant,
  getEcommerceVariantAxes,
  isEcommerceVariantValueAvailable,
  reconcileEcommerceVariantAttributes,
  validateEcommerceConfiguration
} from '../../../utils/ecommerceConfiguredProduct';
import PublicSafeImage from './PublicSafeImage';
import './PublicProductConfiguration.css';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

const labelAttribute = (value) => {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Variante';
};

const selectionsFromMap = (selectionMap) => Object.entries(selectionMap)
  .map(([groupId, optionIds]) => ({ groupId, optionIds }))
  .filter((selection) => Array.isArray(selection.optionIds) && selection.optionIds.length > 0);

function PublicProductConfigurationModal({
  isOpen,
  slug,
  product,
  catalogRevision,
  offline,
  initialLine,
  maxItemQuantity,
  onClose,
  onAdd
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const firstErrorRef = useRef(null);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedAttributes, setSelectedAttributes] = useState({});
  const [selectionMap, setSelectionMap] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [submitted, setSubmitted] = useState(false);

  const loadConfiguration = useCallback(async () => {
    if (!product?.id || !slug) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus('loading');
    setLoadError(null);

    try {
      const result = await getPublicProductConfiguration(slug, {
        productId: product.id,
        catalogRevision,
        configurationVersion: product.configuration?.version,
        offline
      });
      if (requestIdRef.current !== requestId) return;
      setDetail(result);
      setStatus('ready');
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setLoadError(error);
      setStatus('error');
    }
  }, [catalogRevision, offline, product?.configuration?.version, product?.id, slug]);

  useEffect(() => {
    if (!isOpen) return;
    setSubmitted(false);
    setQuantity(Math.max(1, Math.floor(Number(initialLine?.quantity) || 1)));
    setSelectedAttributes(initialLine?.configurationSnapshot?.variant?.optionValues || {});
    setSelectionMap(
      (initialLine?.selections || []).reduce((result, selection) => ({
        ...result,
        [selection.groupId]: Array.isArray(selection.optionIds) ? selection.optionIds : []
      }), {})
    );
    void loadConfiguration();
    return () => {
      requestIdRef.current += 1;
    };
  }, [initialLine, isOpen, loadConfiguration]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const axes = useMemo(() => getEcommerceVariantAxes(detail), [detail]);
  const selectedVariant = useMemo(
    () => findEcommerceVariant(detail, selectedAttributes),
    [detail, selectedAttributes]
  );
  const selections = useMemo(() => selectionsFromMap(selectionMap), [selectionMap]);
  const validation = useMemo(() => validateEcommerceConfiguration(detail, {
    variantId: selectedVariant?.id || null,
    selections
  }), [detail, selectedVariant?.id, selections]);
  const pricing = useMemo(() => calculateEcommerceConfiguredPrice(detail, {
    variantId: selectedVariant?.id || null,
    selections
  }), [detail, selectedVariant?.id, selections]);
  const lineTotal = Number((pricing.finalUnitPrice * quantity).toFixed(2));
  const displayedImage = selectedVariant?.imageUrl || detail?.product?.imageUrl || product?.imageUrl;

  useEffect(() => {
    if (submitted && !validation.valid) firstErrorRef.current?.focus();
  }, [submitted, validation.valid]);

  if (!isOpen) return null;

  const chooseAttribute = (attribute, value) => {
    setSelectedAttributes((current) => reconcileEcommerceVariantAttributes(
      detail,
      { ...current, [attribute]: value },
      attribute
    ));
    setSubmitted(false);
  };

  const chooseOption = (group, optionId, checked) => {
    setSelectionMap((current) => {
      const selected = Array.isArray(current[group.id]) ? current[group.id] : [];
      if (group.selectionType === 'single') {
        return { ...current, [group.id]: optionId ? [optionId] : [] };
      }
      const next = checked
        ? Array.from(new Set([...selected, optionId]))
        : selected.filter((id) => id !== optionId);
      return { ...current, [group.id]: next.slice(0, group.maxSelect) };
    });
    setSubmitted(false);
  };

  const submit = () => {
    setSubmitted(true);
    if (!detail || !validation.valid || detail.product.isAvailable !== true) return;
    const configuredLine = buildEcommerceConfiguredCartLine(detail, {
      variantId: selectedVariant?.id || null,
      selections,
      quantity,
      maxItemQuantity
    });
    if (!configuredLine.success) return;
    const added = onAdd(configuredLine, {
      replaceLineKey: initialLine?.lineKey || null
    });
    if (added !== false) onClose();
  };

  return (
    <div className="public-product-config-modal">
      <button
        type="button"
        className="public-product-config-modal__backdrop"
        aria-label="Cerrar configuración"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="public-product-config"
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-product-config-title"
      >
        <header className="public-product-config__header">
          <div>
            <p className="public-store-section-kicker">
              {initialLine ? 'Editar producto' : 'Configura tu producto'}
            </p>
            <h2 id="public-product-config-title">{product?.name || 'Producto'}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="public-icon-button"
            onClick={onClose}
            aria-label="Cerrar configuración"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <div className="public-product-config__body">
          {status === 'loading' ? (
            <div className="public-product-config__state" role="status">
              <span className="public-product-config__spinner" aria-hidden="true" />
              <h3>Cargando opciones…</h3>
              <p>Estamos consultando la configuración vigente.</p>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="public-product-config__state" role="alert">
              <AlertCircle aria-hidden="true" size={34} />
              <h3>No se pudo cargar la configuración</h3>
              <p>{loadError?.message || 'Revisa tu conexión e intenta nuevamente.'}</p>
              <button type="button" className="ui-button ui-button--secondary" onClick={loadConfiguration}>
                <RefreshCw aria-hidden="true" size={17} />
                Reintentar
              </button>
            </div>
          ) : null}

          {status === 'ready' && detail ? (
            <>
              {offline ? (
                <div className="public-product-config__notice" role="status">
                  Estás viendo una configuración guardada. El pedido se validará al recuperar la conexión.
                </div>
              ) : null}

              <div className="public-product-config__hero">
                <PublicSafeImage
                  src={displayedImage}
                  alt={detail.product.name}
                  fallbackLabel={`${detail.product.name} sin imagen`}
                  className="public-product-config__image"
                />
                <div>
                  <p>{detail.product.description}</p>
                  <strong>
                    {detail.product.requiresConfiguration ? 'Desde ' : ''}
                    {formatCurrency(detail.product.basePrice, detail.product.currency)}
                  </strong>
                  <span>{detail.product.availability.message || 'Disponibilidad sujeta a validación'}</span>
                </div>
              </div>

              {!detail.product.isAvailable ? (
                <div className="public-product-config__error" role="alert">
                  Este producto no puede configurarse por el momento.
                </div>
              ) : null}

              {axes.map(({ attribute, values }, axisIndex) => (
                <fieldset
                  key={attribute}
                  className="public-product-config__group"
                  aria-describedby={submitted && validation.errors.variant ? 'public-config-variant-error' : undefined}
                  aria-invalid={submitted && Boolean(validation.errors.variant)}
                >
                  <legend>{labelAttribute(attribute)}</legend>
                  <p>Selecciona una opción.</p>
                  <div className="public-product-config__chips">
                    {values.map((value) => {
                      const available = isEcommerceVariantValueAvailable(
                        detail,
                        selectedAttributes,
                        attribute,
                        value
                      );
                      const selected = selectedAttributes[attribute] === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`public-product-config__chip${selected ? ' is-selected' : ''}`}
                          disabled={!available}
                          onClick={() => chooseAttribute(attribute, value)}
                          aria-pressed={selected}
                          autoFocus={axisIndex === 0 && status === 'ready'}
                        >
                          {value}
                          {!available ? <small>No disponible</small> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              {submitted && validation.errors.variant ? (
                <p
                  id="public-config-variant-error"
                  ref={firstErrorRef}
                  className="public-product-config__error"
                  role="alert"
                  tabIndex="-1"
                >
                  {validation.errors.variant}
                </p>
              ) : null}

              {detail.groups.map((group) => {
                const selectedIds = selectionMap[group.id] || [];
                const groupError = submitted ? validation.errors[group.id] : '';
                return (
                  <fieldset
                    key={group.id}
                    className="public-product-config__group"
                    aria-describedby={groupError ? `public-config-group-${group.id}` : undefined}
                    aria-invalid={Boolean(groupError)}
                  >
                    <legend>
                      {group.publicName}
                      {group.required ? <span>Obligatorio</span> : <span>Opcional</span>}
                    </legend>
                    <p>
                      {group.minSelect > 0 ? `Selecciona al menos ${group.minSelect}. ` : ''}
                      {group.maxSelect > 1 ? `Puedes elegir hasta ${group.maxSelect}.` : 'Selecciona una opción.'}
                    </p>

                    <div className="public-product-config__options">
                      {group.selectionType === 'single' && !group.required && group.minSelect === 0 ? (
                        <label className="public-product-config__option">
                          <input
                            type="radio"
                            name={`group-${group.id}`}
                            checked={selectedIds.length === 0}
                            onChange={() => chooseOption(group, '', false)}
                          />
                          <span>Sin opción</span>
                        </label>
                      ) : null}

                      {group.options.map((option) => {
                        const selected = selectedIds.includes(option.id);
                        const atMaximum = group.selectionType === 'multiple'
                          && selectedIds.length >= group.maxSelect
                          && !selected;
                        const inputType = group.selectionType === 'single' ? 'radio' : 'checkbox';
                        return (
                          <label
                            key={option.id}
                            className={`public-product-config__option${!option.isAvailable ? ' is-unavailable' : ''}`}
                          >
                            <input
                              type={inputType}
                              name={`group-${group.id}`}
                              checked={selected}
                              disabled={!option.isAvailable || atMaximum}
                              onChange={(event) => chooseOption(
                                group,
                                option.id,
                                event.target.checked
                              )}
                            />
                            <span>
                              <strong>{option.publicName}</strong>
                              {!option.isAvailable ? <small>No disponible</small> : null}
                            </span>
                            {option.priceDelta > 0 ? (
                              <b>+{formatCurrency(option.priceDelta, detail.product.currency)}</b>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>

                    {groupError ? (
                      <p
                        id={`public-config-group-${group.id}`}
                        className="public-product-config__error"
                        role="alert"
                      >
                        {groupError}
                      </p>
                    ) : null}
                  </fieldset>
                );
              })}

              <section className="public-product-config__pricing" aria-label="Resumen de precio">
                <div><span>Precio base</span><strong>{formatCurrency(pricing.baseUnitPrice, detail.product.currency)}</strong></div>
                {pricing.variantAdjustment !== 0 ? (
                  <div><span>Ajuste de variante</span><strong>{formatCurrency(pricing.variantAdjustment, detail.product.currency)}</strong></div>
                ) : null}
                {pricing.optionsAdjustment > 0 ? (
                  <div><span>Extras</span><strong>{formatCurrency(pricing.optionsAdjustment, detail.product.currency)}</strong></div>
                ) : null}
                <div className="is-total"><span>Precio unitario</span><strong>{formatCurrency(pricing.finalUnitPrice, detail.product.currency)}</strong></div>
              </section>

              <section className="public-product-config__quantity" aria-label="Cantidad">
                <div>
                  <strong>Cantidad</strong>
                  <span>Máximo {Math.max(1, Number(maxItemQuantity) || 99)}</span>
                </div>
                <div className="public-quantity-control">
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                    disabled={quantity <= 1}
                    aria-label={`Disminuir cantidad de ${detail.product.name}`}
                  >
                    <Minus aria-hidden="true" size={17} />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, Number(maxItemQuantity) || 99)}
                    value={quantity}
                    onChange={(event) => {
                      const next = Math.floor(Number(event.target.value));
                      if (Number.isFinite(next)) {
                        setQuantity(Math.max(1, Math.min(Number(maxItemQuantity) || 99, next)));
                      }
                    }}
                    aria-label={`Cantidad de ${detail.product.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => Math.min(Number(maxItemQuantity) || 99, current + 1))}
                    disabled={quantity >= (Number(maxItemQuantity) || 99)}
                    aria-label={`Aumentar cantidad de ${detail.product.name}`}
                  >
                    <Plus aria-hidden="true" size={17} />
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className="public-product-config__footer">
          <div>
            <span>Total</span>
            <strong>{formatCurrency(lineTotal, detail?.product?.currency || product?.currency)}</strong>
          </div>
          <button
            type="button"
            className="ui-button ui-button--primary"
            disabled={status !== 'ready' || detail?.product?.isAvailable !== true}
            onClick={submit}
          >
            {initialLine ? 'Guardar cambios' : 'Añadir al carrito'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default PublicProductConfigurationModal;
