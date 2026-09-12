import { Link2, PackageCheck, Truck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './EcommercePortalGeneralSettings.css';

const featureValue = (features, camelKey, snakeKey) => (
  features?.[camelKey] ?? features?.[snakeKey]
);

export const resolveEcommerceGeneralSettingsCapabilities = (licenseDetails = {}) => {
  const features = licenseDetails?.features || {};
  const planCode = String(
    licenseDetails?.plan_code
      || licenseDetails?.planCode
      || licenseDetails?.plan
      || licenseDetails?.subscription_plan
      || licenseDetails?.product_code
      || ''
  ).trim().toLowerCase();
  const customSlugFeature = featureValue(features, 'customSlug', 'ecommerce_custom_slug');
  const customSlugAllowed = customSlugFeature === true || planCode === 'pro_monthly';
  const configuredDeliveryMode = featureValue(
    features,
    'deliveryPickupSettings',
    'ecommerce_delivery_pickup_settings'
  );

  return {
    customSlugAllowed,
    deliveryPickupSettings: configuredDeliveryMode
      || (customSlugAllowed ? 'advanced' : 'basic')
  };
};

export default function EcommercePortalGeneralSettings({ form, onFieldChange }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const {
    customSlugAllowed,
    deliveryPickupSettings
  } = resolveEcommerceGeneralSettingsCapabilities(licenseDetails);
  const deliveryModeLabel = deliveryPickupSettings === 'advanced' ? 'Avanzada' : 'Básica';

  return (
    <fieldset className="ecom-general-settings" data-testid="ecommerce-general-settings">
      <div className="ecom-general-settings__heading">
        <div>
          <span className="ecom-admin-eyebrow">Configuración de tienda</span>
          <h3>Contenido y operación general</h3>
          <p>
            Estos datos forman parte de la tienda en cualquier plan. Lanzo Nube agrega capacidades
            avanzadas sin sustituir esta configuración.
          </p>
        </div>
      </div>

      <div className="ecom-admin-form-grid">
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
              ? 'Lanzo Nube permite personalizar el enlace. Usa 3–64 caracteres en minúsculas, números o guiones.'
              : 'Tu enlace actual se conserva. Personalizarlo requiere Lanzo Nube.'}
          </small>
        </label>

        <label className="form-group">
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

        <label className="form-group">
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
    </fieldset>
  );
}
