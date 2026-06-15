import { memo, useCallback, useMemo } from 'react';
import {
  Pill,
  SlidersHorizontal,
  Layers,
  Ban,
  CalendarDays,
  AlertTriangle,
  Circle,
  Infinity as InfinityIcon,
  Scale,
} from 'lucide-react';
import LazyImage from '../common/LazyImage';
import { getProductAlerts } from '../../services/utils';
import { getAvailableStock } from '../../services/db/utils';

/**
 * ProductCard - Componente de presentación puro para items del menú POS.
 *
 * ARQUITECTURA:
 * - Memoizado con React.memo para evitar re-renders durante scroll infinito
 * - Layout estructurado en 4 Zonas Semánticas estrictas con Flexbox
 * - Iconografía SVG (lucide-react) con importaciones nombradas para tree-shaking
 * - Fábrica de badges aislada de rubros: evalúa solo los features activos,
 *   ignorando campos residuales de datos sucios en el objeto product
 * - Jerarquía de alertas estrictamente mutuamente excluyente en Zona 4
 *
 * ZONAS:
 * 1. ZONA_IMAGEN  : Contenedor con altura fija, overlay de degradado para legibilidad
 * 2. ZONA_BADGES  : Flex container SVG-based (position absolute sobre imagen)
 * 3. ZONA_CONTENIDO: Título truncado a 2 líneas + precio con unidades
 * 4. ZONA_FOOTER  : Estado de stock — una sola alerta a la vez (prioridad cascada)
 */

// ─────────────────────────────────────────────────────────────────────────────
// FÁBRICA DE BADGES (Zona 2)
// Evalúa exclusivamente las features activas del negocio.
// Nunca lee campos de rubros ajenos aunque el producto los traiga.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diccionario de descriptores de badge.
 * Cada entrada: { key, Icon, className, title, ariaLabel, condition(features, product) }
 */
const BADGE_DEFINITIONS = [
  {
    key: 'rx',
    Icon: Pill,
    className: 'product-badge product-badge--rx',
    label: 'Receta',
    title: 'Requiere Receta Médica',
    ariaLabel: 'Este producto requiere receta médica',
    /**
     * Rubro Farmacia: solo se activa si hasLabFields está habilitado.
     * Ignora completamente el array modifiers aunque el producto lo traiga.
     */
    condition: (features, product) =>
      features?.hasLabFields === true &&
      (product?.requiresPrescription === true ||
        (product?.prescriptionType && product.prescriptionType !== 'otc')),
  },
  {
    key: 'mod',
    Icon: SlidersHorizontal,
    className: 'product-badge product-badge--modifier',
    label: 'Extras',
    title: 'Tiene Extras / Modificadores',
    ariaLabel: 'Este producto tiene opciones de personalización',
    /**
     * Solo se evalúa si hasModifiers está activo.
     * Si el rubro es Farmacia (hasLabFields) los modifiers se ignoran.
     */
    condition: (features, product) =>
      features?.hasModifiers === true &&
      features?.hasLabFields !== true &&
      Array.isArray(product?.modifiers) &&
      product.modifiers.length > 0,
  },
  {
    key: 'var',
    Icon: Layers,
    className: 'product-badge product-badge--variant',
    label: 'Variantes',
    title: 'Tiene Variantes',
    ariaLabel: 'Este producto se vende en variantes',
    /**
     * Solo se evalúa si hasVariants está activo.
     * Si el rubro no maneja caducidad (hasExpiry falso) se ignoran
     * esos campos aunque batchManagement los tenga.
     */
    condition: (features, product, context) =>
      features?.hasVariants === true &&
      product?.batchManagement?.enabled === true &&
      context?.hasAvailableVariants === true,
  },
];

const STOCK_FORMATTER = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 2,
});
const EXPIRY_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const formatStock = (value) => STOCK_FORMATTER.format(Number(value) || 0);

const formatExpiryDate = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;

  return EXPIRY_DATE_FORMATTER
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace('.', '');
};

/**
 * buildBadgeDescriptors — ejecuta la fábrica y devuelve solo los badges
 * cuya condición se cumple para las features activas del negocio.
 * La lógica vive aquí, lejos del JSX.
 *
 * @param {object} features - Config activa del negocio
 * @param {object} product  - Datos del producto (puede tener campos sucios)
 * @param {boolean} suppress - Si true (producto agotado), no muestra ningún badge
 * @returns {Array<{key, Icon, className, title, ariaLabel}>}
 */
function buildBadgeDescriptors(features, product, suppress, context = {}) {
  if (suppress) return [];
  return BADGE_DEFINITIONS.filter(({ condition }) => condition(features, product, context));
}

// ─────────────────────────────────────────────────────────────────────────────
// JERARQUÍA DE ESTADOS DEL FOOTER (Zona 4)
// Evaluación mutuamente excluyente en orden de prioridad absoluta.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveFooterState — devuelve el descriptor de estado del footer
 * siguiendo la jerarquía estricta: agotado → caducidad → stock bajo → normal.
 * Nunca mezcla estados.
 *
 * @param {object} params
 * @returns {{ type: string, Icon: Component, label: string, iconAriaLabel: string }}
 */
function resolveFooterState({
  isOutOfStock,
  isNearingExpiry,
  isLowStock,
  isTracking,
  availableStock,
  unit,
  expiryDate,
}) {
  // 1. AGOTADO — mata cualquier otra evaluación
  if (isOutOfStock) {
    return {
      type: 'out-of-stock',
      Icon: Ban,
      label: 'AGOTADO',
      iconAriaLabel: 'Producto agotado',
    };
  }

  // 2. CADUCIDAD PRÓXIMA — prioridad crítica sobre stock bajo
  if (isNearingExpiry) {
    return {
      type: 'nearing-expiry',
      Icon: CalendarDays,
      label: expiryDate ? `Caduca ${expiryDate}` : 'Caduca pronto',
      iconAriaLabel: 'Caducidad próxima',
    };
  }

  // 3. STOCK BAJO
  if (isLowStock) {
    return {
      type: 'low-stock',
      Icon: AlertTriangle,
      label: `Stock bajo · ${formatStock(availableStock)}${unit}`,
      iconAriaLabel: 'Stock bajo',
    };
  }

  if (!isTracking) {
    return {
      type: 'unlimited',
      Icon: InfinityIcon,
      label: 'Inventario ilimitado',
      iconAriaLabel: 'Producto sin control de inventario',
    };
  }

  return {
    type: 'neutral',
    Icon: Circle,
    label: `${formatStock(availableStock)}${unit} disponibles`,
    iconAriaLabel: 'Stock disponible',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE
// ─────────────────────────────────────────────────────────────────────────────

const ProductCard = memo(function ProductCard({
  product,
  features,
  onCardClick,
  isLoadingVariant,
  hasAvailableVariants
}) {
  // ── Lógica de negocio visual ──────────────────────────────────────────────
  const isRecipeBased = Array.isArray(product?.recipe) && product.recipe.length > 0;

  const alerts = useMemo(() => getProductAlerts(product), [product]);
  const availableStock = useMemo(() => getAvailableStock(product), [product]);

  const isOutOfStock = isRecipeBased ? false : alerts.isOutOfStock;
  const isLowStock = isRecipeBased ? false : alerts.isLowStock;
  const isNearingExpiry = alerts.isNearingExpiry;

  const isTracking = !isRecipeBased && product?.trackStock !== false && (
    product?.trackStock === true || product?.batchManagement?.enabled === true
  );

  const unit = product?.saleType === 'bulk'
    ? ` ${product?.bulkData?.purchase?.unit || 'kg'}`
    : '';
  const expiryDate = useMemo(() => formatExpiryDate(product?.expiryDate), [product?.expiryDate]);

  // ── Fábrica de badges (Zona 2) ────────────────────────────────────────────
  const badgeDescriptors = useMemo(
    () => buildBadgeDescriptors(features, product, isOutOfStock, { hasAvailableVariants }),
    [features, product, isOutOfStock, hasAvailableVariants]
  );
  const productLabels = useMemo(() => {
    const labels = [...badgeDescriptors];
    if (product?.saleType === 'bulk') {
      labels.push({
        key: 'bulk',
        Icon: Scale,
        className: 'product-badge product-badge--bulk',
        label: 'Granel',
        title: 'Producto vendido a granel',
        ariaLabel: 'Producto vendido a granel',
      });
    }
    return labels.slice(0, 2);
  }, [badgeDescriptors, product?.saleType]);

  // ── Descriptor del footer (Zona 4) ────────────────────────────────────────
  const footerState = useMemo(
    () => resolveFooterState({
      isOutOfStock,
      isNearingExpiry,
      isLowStock,
      isTracking,
      availableStock,
      unit,
      expiryDate,
    }),
    [isOutOfStock, isNearingExpiry, isLowStock, isTracking, availableStock, unit, expiryDate]
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (!isOutOfStock) onCardClick?.(product);
  }, [isOutOfStock, onCardClick, product]);

  const handleKeyDown = useCallback((e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isOutOfStock) {
      e.preventDefault();
      onCardClick?.(product);
    }
  }, [isOutOfStock, onCardClick, product]);

  // ── Clases dinámicas ───────────────────────────────────────────────────────────────────
  const cardClasses = useMemo(() => [
    'product-card',
    isOutOfStock ? 'product-card--out-of-stock' : '',
    isLoadingVariant ? 'product-card--loading-variant' : '',
  ].filter(Boolean).join(' '), [isOutOfStock, isLoadingVariant]);

  const footerClasses = useMemo(() => [
    'product-card__footer',
    `product-card__footer--${footerState.type}`,
  ].join(' '), [footerState.type]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={cardClasses}
      onClick={handleClick}
      role="button"
      tabIndex={isOutOfStock ? -1 : 0}
      aria-disabled={isOutOfStock}
      aria-label={`${product?.name || ''} precio ${product?.price || 0}`}
      onKeyDown={handleKeyDown}
    >
      {/* ── ZONA 1: IMAGEN + OVERLAY DE DEGRADADO ── */}
      <div className="product-card__image-zone">
        <LazyImage
          className="product-card__image"
          src={product?.image}
          alt={product?.name || ''}
        />

        {/* Overlay de agotado */}
        {isOutOfStock && (
          <div className="product-card__out-of-stock-overlay">
            <span>Agotado</span>
          </div>
        )}

        {/* Overlay de carga de variantes */}
        {isLoadingVariant && (
          <div className="product-card__loading-overlay" aria-label="Cargando variantes...">
            <div className="product-card__loading-spinner" />
          </div>
        )}
      </div>

      {/* ── ZONA 3: CONTENIDO (título + precio) ── */}
      <div className="product-card__content-zone">
        {productLabels.length > 0 && (
          <div className="product-card__badges-container" aria-label="Características del producto">
            {productLabels.map(({ key, Icon, className, label, title, ariaLabel }) => (
              <span
                key={key}
                className={className}
                title={title}
                aria-label={ariaLabel}
              >
                <Icon size={11} aria-hidden="true" strokeWidth={2.4} />
                {label}
              </span>
            ))}
          </div>
        )}

        <h3 className="product-card__title">
          {product?.name || ''}
        </h3>

        <div className="product-card__price-row">
          <span className="product-card__price">
            ${(Number(product?.price) || 0).toFixed(2)}
          </span>
          {product?.saleType === 'bulk' && (
            <span className="product-card__unit">
              / {product?.bulkData?.purchase?.unit || 'kg'}
            </span>
          )}
        </div>
      </div>

      {/* ── ZONA 4: FOOTER DE ESTADO (una sola alerta, jerarquía estricta) ── */}
      <div className={footerClasses} role="status" aria-live="polite">
        <footerState.Icon
          size={13}
          aria-label={footerState.iconAriaLabel}
          strokeWidth={2.5}
          className="product-card__footer-icon"
        />
        <span className="product-card__footer-label">{footerState.label}</span>
      </div>
    </div>
  );
});

export default memo(ProductCard, (prevProps, nextProps) => {
  return (
    prevProps.product === nextProps.product &&
    prevProps.onCardClick === nextProps.onCardClick &&
    prevProps.isLoadingVariant === nextProps.isLoadingVariant &&
    prevProps.hasAvailableVariants === nextProps.hasAvailableVariants &&
    prevProps.features?.hasLabFields === nextProps.features?.hasLabFields &&
    prevProps.features?.hasModifiers === nextProps.features?.hasModifiers &&
    prevProps.features?.hasVariants === nextProps.features?.hasVariants &&
    prevProps.features?.hasWholesale === nextProps.features?.hasWholesale
  );
});
