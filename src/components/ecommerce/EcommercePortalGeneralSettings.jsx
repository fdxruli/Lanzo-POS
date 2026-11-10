import { ChevronDown, Link2, PackageCheck, PenLine, Truck } from 'lucide-react';
import EcommerceProHint from './EcommerceProHint';
import './EcommercePortalGeneralSettings.css';

const featureValue = (features, camelKey, snakeKey) => (
  features?.[camelKey] ?? features?.[snakeKey]
);

export const resolveEcommerceGeneralSettingsCapabilities = (features = {}) => {
  const customSlugFeature = featureValue(features, 'customSlug', 'ecommerce_custom_slug');
  const configuredDeliveryMode = featureValue(
    features,
    'deliveryPickupSettings',
    'ecommerce_delivery_pickup_settings'
  );

  return {
    customSlugAllowed: customSlugFeature === true,
    deliveryPickupSettings: configuredDeliveryMode || 'basic'
  };
};

export default function EcommercePortalGeneralSettings({
  form,
  onFieldChange,
  plan,
  features,
  showNubeBenefits = false,
  onOpenNubeBenefits
}) {
  const {
    customSlugAllowed,
    deliveryPickupSettings
  } = resolveEcommerceGeneralSettingsCapabilities(features);
  const deliveryModeLabel = deliveryPickupSettings === 'advanced' ? 'Avanzada' : 'Básica';
  const authoritativePlanCode = String(plan?.code || '').trim() || 'unknown';
  const deliverySummary = [
    form.pickupEnabled && 'Recoger',
    form.deliveryEnabled && 'Domicilio'
  ].filter(Boolean).join(' · ') || 'Sin método de entrega';

  return (
    <fieldset
      className="ecom-general-settings ecom-info-extra"
      data-testid="ecommerce-general-settings"
      data-plan-code={authoritativePlanCode}
      aria-label="Información adicional de la tienda"
    >
      <details className="ecom-info-disclosure">
        <summary>
          <span className="ecom-info-disclosure__title"><PenLine size={17} aria-hidden="true" /> Presentación</span>
          <small>{form.headline?.trim() || form.description?.trim() || 'Sin presentación comercial'}</small>
          <ChevronDown size={17} aria-hidden="true" className="ecom-info-disclosure__chevron" />
        </summary>
        <div className="ecom-admin-form-grid ecom-info-disclosure__content">
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Frase corta / headline</span>
            <input
              className="form-input"
              aria-label="Frase corta"
              value={form.headline}
              onChange={onFieldChange('headline')}
              maxLength={160}
              placeholder="Ej. Pide fácil y recibe rápido"
            />
          </label>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Descripción</span>
            <textarea
              className="form-input"
              aria-label="Descripción"
              value={form.description}
              onChange={onFieldChange('description')}
              maxLength={1000}
              rows={4}
              placeholder="Cuenta brevemente qué ofrece tu negocio."
            />
          </label>
        </div>
      </details>

      <details className="ecom-info-disclosure">
        <summary>
          <span className="ecom-info-disclosure__title"><Truck size={17} aria-hidden="true" /> Pedidos y entregas</span>
          <small>{deliverySummary} · Mínimo ${Number(form.minOrderTotal || 0).toLocaleString('es-MX')}</small>
          <ChevronDown size={17} aria-hidden="true" className="ecom-info-disclosure__chevron" />
        </summary>
        <div className="ecom-admin-form-grid ecom-info-disclosure__content">
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Pedido mínimo</span>
            <input
              className="form-input"
              aria-label="Pedido mínimo"
              type="number"
              min="0"
              step="0.01"
              value={form.minOrderTotal}
              onChange={onFieldChange('minOrderTotal')}
            />
          </label>
          <div className="form-group ecom-admin-span-2">
            <div className="ecom-general-settings__delivery-heading">
              <span className="form-label">Métodos de entrega</span>
              <span className="ecom-general-settings__capability">
                Configuración {deliveryModeLabel.toLowerCase()}
              </span>
            </div>
            <small className="ecom-admin-help">
              Debe permanecer habilitado al menos un método. El nivel {deliveryModeLabel.toLowerCase()}
              define capacidades adicionales, no la visibilidad de estos controles.
            </small>
            <div className="ecom-general-settings__delivery-options">
              <label className="ecom-general-settings__delivery-option">
                <input
                  type="checkbox"
                  aria-label="Recoger"
                  checked={Boolean(form.pickupEnabled)}
                  onChange={onFieldChange('pickupEnabled')}
                />
                <PackageCheck size={18} aria-hidden="true" />
                <span>Recoger</span>
              </label>
              <label className="ecom-general-settings__delivery-option">
                <input
                  type="checkbox"
                  aria-label="Domicilio"
                  checked={Boolean(form.deliveryEnabled)}
                  onChange={onFieldChange('deliveryEnabled')}
                />
                <Truck size={18} aria-hidden="true" />
                <span>Domicilio</span>
              </label>
            </div>
          </div>
        </div>
      </details>

      <details className="ecom-info-disclosure">
        <summary>
          <span className="ecom-info-disclosure__title"><Link2 size={17} aria-hidden="true" /> Identidad y enlace</span>
          <small>{form.slug || 'Enlace asignado al crear la tienda'}</small>
          <ChevronDown size={17} aria-hidden="true" className="ecom-info-disclosure__chevron" />
        </summary>
        <div className="ecom-admin-form-grid ecom-info-disclosure__content">
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Enlace / slug</span>
            <div className="ecom-admin-input-icon">
              <Link2 size={16} aria-hidden="true" />
              <input
                className="form-input"
                aria-label="Slug de la tienda"
                value={form.slug}
                onChange={onFieldChange('slug')}
                minLength={3}
                maxLength={64}
                pattern="[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?"
                readOnly={!customSlugAllowed}
                disabled={!customSlugAllowed}
              />
            </div>
            <small className="ecom-admin-help">
              {customSlugAllowed
                ? 'Personaliza con 3–64 caracteres en minúsculas, números o guiones.'
                : 'El enlace actual se conserva.'}
            </small>
          </label>
          {!customSlugAllowed && showNubeBenefits && (
            <EcommerceProHint
              variant="inline"
              className="ecom-general-settings__slug-hint"
              message="Personalizar este enlace está disponible con Lanzo Nube."
              onOpenBenefits={onOpenNubeBenefits}
            />
          )}
        </div>
      </details>
    </fieldset>
  );
}
