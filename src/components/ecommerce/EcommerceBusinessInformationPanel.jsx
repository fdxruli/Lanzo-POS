import {
  ChevronDown,
  Copy,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Mail,
  MapPin,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  QrCode,
  Save,
  Share2
} from 'lucide-react';
import PublicStoreQrCode from './PublicStoreQrCode';
import EcommercePortalGeneralSettings from './EcommercePortalGeneralSettings';

const MEXICO_STATES = Object.freeze([
  'Aguascalientes',
  'Baja California',
  'Baja California Sur',
  'Campeche',
  'Chiapas',
  'Chihuahua',
  'Ciudad de México',
  'Coahuila',
  'Colima',
  'Durango',
  'Estado de México',
  'Guanajuato',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'Michoacán',
  'Morelos',
  'Nayarit',
  'Nuevo León',
  'Oaxaca',
  'Puebla',
  'Querétaro',
  'Quintana Roo',
  'San Luis Potosí',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Tlaxcala',
  'Veracruz',
  'Yucatán',
  'Zacatecas'
]);


const PORTAL_STATUS_LABELS = {
  draft: 'Borrador',
  published: 'Publicado',
  paused: 'Pausado',
  disabled: 'Deshabilitado'
};

export default function EcommerceBusinessInformationPanel({
  portal,
  form,
  plan,
  features,
  onFieldChange,
  onSubmit,
  saving,
  hasUnsavedChanges = false,
  reservedLink,
  onCopyLink,
  onShareLink,
  whatsappShareUrl,
  onChangeStatus,
  requirements,
  showNubeBenefits = false,
  onOpenNubeBenefits
}) {
  const canPublish = Object.values(requirements).every(Boolean);
  const addressComplete = Boolean(
    requirements.street && requirements.neighborhood && requirements.municipality
    && requirements.state && requirements.postalCode
  );
  const addressSummary = [
    form.addressStreet,
    form.addressNeighborhood,
    form.addressMunicipality,
    form.addressState,
    form.addressPostalCode
  ].map((part) => String(part || '').trim()).filter(Boolean).join(' · ');
  const showSave = !portal || hasUnsavedChanges;

  return (
    <section
      id="ecom-portal-panel-information"
      className="ecom-admin-information-grid"
      role="tabpanel"
      aria-labelledby="ecom-portal-tab-information"
    >
      <form
        className="ui-card ecom-admin-form-card ecom-info-editor"
        onSubmit={onSubmit}
        onInvalidCapture={(event) => {
          event.target.closest('details')?.setAttribute('open', '');
        }}
      >
        <div className="ecom-info-editor__heading">
          <h3>Contacto</h3>
          <span>Datos visibles para tus clientes</span>
        </div>
        <div className="ecom-admin-form-grid">
          {!portal && (
            <label className="form-group ecom-admin-span-2">
              <span className="form-label">Nombre del negocio *</span>
              <div className="ecom-admin-input-icon">
                <Globe2 size={16} aria-hidden="true" />
                <input
                  className="form-input"
                  value={form.name}
                  onChange={onFieldChange('name')}
                  maxLength={120}
                  required
                />
              </div>
              <small className="ecom-admin-help">Revisa el nombre: quedará protegido al crear la tienda.</small>
            </label>
          )}
          <label className="form-group">
            <span className="form-label">WhatsApp *</span>
            <div className="ecom-admin-input-icon">
              <MessageCircle size={16} aria-hidden="true" />
              <input
                className="form-input"
                type="tel"
                inputMode="tel"
                value={form.whatsappPhone}
                onChange={onFieldChange('whatsappPhone')}
                placeholder="52 961 000 0000"
                maxLength={40}
              />
            </div>
            <small className="ecom-admin-help">Obligatorio para publicar. Incluye la lada del país.</small>
          </label>
          <label className="form-group">
            <span className="form-label">Correo electrónico</span>
            <div className="ecom-admin-input-icon">
              <Mail size={16} aria-hidden="true" />
              <input
                className="form-input"
                type="email"
                value={form.contactEmail}
                onChange={onFieldChange('contactEmail')}
                placeholder="contacto@negocio.com"
                maxLength={254}
              />
            </div>
          </label>
        </div>

        <details className="ecom-info-disclosure" defaultOpen={!portal || !addressComplete}>
          <summary>
            <span className="ecom-info-disclosure__title"><MapPin size={17} aria-hidden="true" /> Ubicación</span>
            <small>{addressSummary || 'Sin dirección'}{!addressComplete ? ' · Incompleta' : ''}</small>
            <ChevronDown size={17} aria-hidden="true" className="ecom-info-disclosure__chevron" />
          </summary>
          <div className="ecom-admin-form-grid ecom-info-disclosure__content">
            <p className="ecom-info-hint ecom-admin-span-2">
              Completa la dirección para publicar. Si la calle o colonia no tiene nombre, escribe S/N.
            </p>
            <label className="form-group ecom-admin-span-2">
              <span className="form-label">Calle o avenida *</span>
              <div className="ecom-admin-input-icon">
                <MapPin size={16} aria-hidden="true" />
                <input
                  className="form-input"
                  value={form.addressStreet}
                  onChange={onFieldChange('addressStreet')}
                  placeholder="Ej. Av. Central 123 o S/N"
                  maxLength={160}
                />
              </div>
            </label>
            <label className="form-group">
              <span className="form-label">Colonia o ejido *</span>
              <input
                className="form-input"
                value={form.addressNeighborhood}
                onChange={onFieldChange('addressNeighborhood')}
                placeholder="Ej. Centro o S/N"
                maxLength={120}
              />
            </label>
            <label className="form-group">
              <span className="form-label">Municipio o alcaldía *</span>
              <input
                className="form-input"
                value={form.addressMunicipality}
                onChange={onFieldChange('addressMunicipality')}
                placeholder="Ej. Comitán de Domínguez"
                maxLength={120}
              />
            </label>
            <label className="form-group">
              <span className="form-label">Estado *</span>
              <select
                className="form-input"
                value={form.addressState}
                onChange={onFieldChange('addressState')}
              >
                <option value="">Selecciona un estado</option>
                {MEXICO_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span className="form-label">Código postal *</span>
              <input
                className="form-input"
                value={form.addressPostalCode}
                onChange={onFieldChange('addressPostalCode')}
                placeholder="Ej. 30000"
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
              />
            </label>
          </div>
        </details>

        <EcommercePortalGeneralSettings
          form={form}
          onFieldChange={onFieldChange}
          plan={plan}
          features={features}
          showNubeBenefits={showNubeBenefits}
          onOpenNubeBenefits={onOpenNubeBenefits}
        />

        {showSave && (
          <div className="ecom-info-save-bar" role="group" aria-label="Guardar información">
            <span aria-live="polite">{portal ? 'Cambios sin guardar' : 'Puedes crear la tienda como borrador.'}</span>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? <LoaderCircle className="ecom-admin-spin" size={17} aria-hidden="true" />
                : <Save size={17} aria-hidden="true" />}
              {saving ? 'Guardando...' : portal ? 'Guardar cambios' : 'Crear tienda'}
            </button>
          </div>
        )}
      </form>

      {portal && (
        <section className="ui-card ecom-admin-status-card ecom-info-links" aria-label="Publicación y enlace">
          <div className="ecom-info-editor__heading">
            <h3>Enlace y publicación</h3>
            <span className={`ecom-admin-status status-${portal.status}`}>
              {PORTAL_STATUS_LABELS[portal.status] || portal.status}
            </span>
          </div>

          <div className="ecom-info-link-row">
            <span className="ecom-info-link-url" title={reservedLink}>{reservedLink}</span>
            <div className="ecom-info-link-primary">
              <button type="button" className="btn btn-secondary" onClick={onCopyLink}>
                <Copy size={16} aria-hidden="true" /> Copiar link
              </button>
              <a
                className="btn btn-secondary"
                href={reservedLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} aria-hidden="true" /> Abrir tienda
              </a>
            </div>
          </div>

          <details className="ecom-info-disclosure ecom-info-share">
            <summary>
              <span className="ecom-info-disclosure__title"><Share2 size={17} aria-hidden="true" /> Más formas de compartir</span>
              <ChevronDown size={17} aria-hidden="true" className="ecom-info-disclosure__chevron" />
            </summary>
            <div className="ecom-info-share__content">
              <button type="button" className="btn btn-secondary" onClick={onShareLink}>
                <Share2 size={16} aria-hidden="true" /> Compartir
              </button>
              <a
                className="btn btn-secondary"
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </a>
              <div className="ecom-admin-qr-box">
                <PublicStoreQrCode value={reservedLink} />
                <span><QrCode size={14} aria-hidden="true" /> QR de la tienda</span>
              </div>
            </div>
          </details>

          <div className="ecom-info-publication">
            <div className="ecom-info-publication__copy" id="ecom-publication-requirements">
              <strong>{canPublish ? 'Información lista para publicar' : 'Completa los datos para publicar'}</strong>
              <small>{canPublish
                ? 'Publicar y guardar información son acciones independientes.'
                : 'Consulta el estado de la tienda y completa los campos pendientes.'}</small>
              {hasUnsavedChanges && <small>Guarda tus cambios antes de publicar o pausar.</small>}
            </div>
            <button
              type="button"
              className={`btn ${portal.status === 'published' ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => onChangeStatus(portal.status === 'published' ? 'paused' : 'published')}
              disabled={saving || hasUnsavedChanges || (portal.status !== 'published' && !canPublish)}
              aria-describedby="ecom-publication-requirements"
            >
              {portal.status === 'published'
                ? <PauseCircle size={17} aria-hidden="true" />
                : <PlayCircle size={17} aria-hidden="true" />}
              {portal.status === 'published' ? 'Pausar portal' : 'Publicar portal'}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
