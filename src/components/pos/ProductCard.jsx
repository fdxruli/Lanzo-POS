import React, { memo, useCallback, useMemo } from 'react';
import {
  Pill,
  SlidersHorizontal,
  Layers,
  Ban,
  Clock,
  AlertTriangle,
  Package,
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
    title: 'Tiene Variantes / Lotes',
    ariaLabel: 'Este producto se vende en variantes o lotes',
    /**
     * Solo se evalúa si hasVariants está activo.
     * Si el rubro no maneja caducidad (hasExpiry falso) se ignoran
     * esos campos aunque batchManagement los tenga.
     */
    condition: (features, product) =>
      features?.hasVariants === true &&
      product?.batchManagement?.enabled === true,
  },
];

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
function buildBadgeDescriptors(features, product, suppress) {
  if (suppress) return [];
  return BADGE_DEFINITIONS.filter(({ condition }) => condition(features, product));
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
function resolveFooterState({ isOutOfStock, isNearingExpiry, isLowStock, isTracking, availableStock, unit }) {
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
      Icon: Clock,
      label: `Vence pronto · ${availableStock}${unit}`,
      iconAriaLabel: 'Caducidad próxima',
    };
  }

  // 3. STOCK BAJO
  if (isLowStock) {
    return {
      type: 'low-stock',
      Icon: AlertTriangle,
      label: `Stock bajo · ${availableStock}${unit}`,
      iconAriaLabel: 'Stock bajo',
    };
  }

  // 4. STOCK NORMAL (o sin rastreo)
  return {
    type: 'neutral',
    Icon: Package,
    label: isTracking ? `Stock: ${availableStock}${unit}` : '---',
    iconAriaLabel: 'Stock disponible',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE
// ─────────────────────────────────────────────────────────────────────────────

const ProductCard = memo(function ProductCard({ product, features, onCardClick }) {
  // ── Lógica de negocio visual ──────────────────────────────────────────────
  const alerts = useMemo(() => getProductAlerts(product), [product]);
  const availableStock = useMemo(() => getAvailableStock(product), [product]);

  const { isLowStock, isNearingExpiry, isOutOfStock } = alerts;

  const isTracking = product?.trackStock !== false && (
    product?.trackStock === true || product?.batchManagement?.enabled === true
  );

  const unit = product?.saleType === 'bulk'
    ? ` ${product?.bulkData?.purchase?.unit || 'Granel'}`
    : ' U';

  // ── Fábrica de badges (Zona 2) ────────────────────────────────────────────
  const badgeDescriptors = useMemo(
    () => buildBadgeDescriptors(features, product, isOutOfStock),
    [features, product, isOutOfStock]
  );

  // ── Descriptor del footer (Zona 4) ────────────────────────────────────────
  const footerState = useMemo(
    () => resolveFooterState({ isOutOfStock, isNearingExpiry, isLowStock, isTracking, availableStock, unit }),
    [isOutOfStock, isNearingExpiry, isLowStock, isTracking, availableStock, unit]
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

  // ── Clases dinámicas ─────────────────────────────────────────────────────
  const cardClasses = useMemo(() => [
    'product-card',
    isOutOfStock ? 'product-card--out-of-stock' : '',
  ].filter(Boolean).join(' '), [isOutOfStock]);

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
        {/* Overlay de degradado para legibilidad de badges */}
        <div className="product-card__image-overlay" aria-hidden="true" />

        <LazyImage
          className="product-card__image"
          src={product?.image}
          alt={product?.name || ''}
        />

        {/* ── ZONA 2: BADGES SVG (posición absoluta sobre imagen) ── */}
        {badgeDescriptors.length > 0 && (
          <div className="product-card__badges-container" aria-label="Características del producto">
            {badgeDescriptors.map(({ key, Icon, className, title, ariaLabel }) => (
              <span
                key={key}
                className={className}
                title={title}
                aria-label={ariaLabel}
                role="img"
              >
                <Icon size={11} aria-hidden="true" strokeWidth={2.5} />
              </span>
            ))}
          </div>
        )}

        {/* Overlay de agotado */}
        {isOutOfStock && (
          <div className="product-card__out-of-stock-overlay">
            <span>Agotado</span>
          </div>
        )}
      </div>

      {/* ── ZONA 3: CONTENIDO (título + precio) ── */}
      <div className="product-card__content-zone">
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
  // 1. Si es el mismo producto (ID) y el stock no ha cambiado, no renderices.
  // Evalúa el stock disponible para que se actualice si se vende uno.
  if (prevProps.product?.id !== nextProps.product?.id) return false;
  if (prevProps.product?.stock !== nextProps.product?.stock) return false;

  // 2. Si la función manejadora cambió (no debería por tu useCallback, pero es seguridad)
  if (prevProps.onCardClick !== nextProps.onCardClick) return false;

  // 3. Comparación estricta por valor de las features que impactan la UI de ESTA tarjeta.
  return (
    prevProps.features?.hasLabFields === nextProps.features?.hasLabFields &&
    prevProps.features?.hasModifiers === nextProps.features?.hasModifiers &&
    prevProps.features?.hasVariants === nextProps.features?.hasVariants &&
    prevProps.features?.hasWholesale === nextProps.features?.hasWholesale
  );
});
