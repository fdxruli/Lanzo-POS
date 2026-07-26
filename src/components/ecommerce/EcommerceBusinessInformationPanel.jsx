import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  Info,
  LoaderCircle,
  Lock,
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

function PublicationRequirement({ complete, children }) {
  return (
    <li className={complete ? 'is-complete' : ''}>
      {complete
        ? <CheckCircle2 size={16} aria-hidden="true" />
        : <Info size={16} aria-hidden="true" />}
      <span>{children}</span>
    </li>
  );
}

export default function EcommerceBusinessInformationPanel({
  portal,
  form,
  onFieldChange,
  onSubmit,
  saving,
  reservedLink,
  onCopyLink,
  onShareLink,
  whatsappShareUrl,
  onChangeStatus,
  requirements
}) {
  const canPublish = Object.values(requirements).every(Boolean);

  return (
    <section
      id="ecom-portal-panel-information"
      className="ecom-admin-information-grid"
      role="tabpanel"
      aria-labelledby={portal ? 'ecom-portal-tab-information' : undefined}
    >
      <form className="ui-card ecom-admin-form-card" onSubmit={onSubmit}>
        <div className="ecom-admin-card-heading">
          <div>
            <span className="ecom-admin-eyebrow">Información comercial</span>
            <h3>Datos visibles para tus clientes</h3>
            <p>
              Se mostrarán en la tienda y ayudarán al cliente a recoger su pedido o contactarte.
            </p>
          </div>
          <Save size={22} aria-hidden="true" />
        </div>

        <div className="ecom-admin-form-grid">
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Nombre del negocio *</span>
            <div className="ecom-admin-input-icon">
              {portal ? <Lock size={16} aria-hidden="true" /> : <Globe2 size={16} aria-hidden="true" />}
              <input
                className="form-input"
                value={form.name}
                onChange={onFieldChange('name')}
                maxLength={120}
                readOnly={Boolean(portal)}
                required
              />
            </div>
            <small className="ecom-admin-help">
              {portal
                ? 'El nombre queda protegido después de crear la tienda y ya no puede modificarse desde el portal.'
                : 'Revisa bien el nombre: después de crear la tienda quedará protegido.'}
            </small>
          </label>

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
            <small className="ecom-admin-help">Opcional. Se mostrará como medio adicional de contacto.</small>
          </label>

          <div className="form-group ecom-admin-span-2">
            <span className="form-label">Domicilio o punto de atención *</span>
            <small className="ecom-admin-help">
              Completa cada dato para publicar. Si la calle o colonia no tiene nombre, escribe S/N.
            </small>
          </div>

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

        <div className="ecom-admin-form-actions">
          <span>
            <CheckCircle2 size={16} aria-hidden="true" />
            Puedes guardar un borrador aunque falten los datos obligatorios.
          </span>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? <LoaderCircle className="ecom-admin-spin" size={17} aria-hidden="true" />
              : <Save size={17} aria-hidden="true" />}
            {portal ? 'Guardar información' : 'Crear tienda'}
          </button>
        </div>
      </form>

      {portal ? (
        <section className="ui-card ecom-admin-status-card" aria-label="Publicación y enlace">
          <div className="ecom-admin-card-heading">
            <div>
              <span className="ecom-admin-eyebrow">Publicación</span>
              <h3>Enlace de tu tienda</h3>
              <p>Comparte el enlace cuando la información obligatoria esté completa.</p>
            </div>
          </div>

          <div className="ecom-admin-public-link-panel">
            <div className="ecom-admin-link-box">
              <Globe2 size={22} aria-hidden="true" />
              <div>
                <span>Link reservado</span>
                <strong>{reservedLink}</strong>
                <small>Revisión actual del catálogo: {portal.catalogRevision || 1}.</small>
              </div>
              <div className="ecom-admin-link-actions">
                <a
                  className="btn btn-secondary"
                  href={reservedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} aria-hidden="true" /> Abrir tienda
                </a>
                <button type="button" className="btn btn-secondary" onClick={onCopyLink}>
                  <Copy size={16} aria-hidden="true" /> Copiar link
                </button>
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
              </div>
            </div>
            <div className="ecom-admin-qr-box">
              <PublicStoreQrCode value={reservedLink} />
              <span><QrCode size={14} aria-hidden="true" /> QR de la tienda</span>
            </div>
          </div>

          <div
            id="ecom-publication-requirements"
            className={`ecom-admin-publication-check ${canPublish ? 'is-complete' : ''}`}
          >
            <strong>{canPublish ? 'Información lista para publicar' : 'Completa los datos para publicar'}</strong>
            <ul>
              <PublicationRequirement complete={requirements.whatsapp}>
                WhatsApp válido
              </PublicationRequirement>
              <PublicationRequirement complete={requirements.street && requirements.neighborhood}>
                Calle y colonia / ejido
              </PublicationRequirement>
              <PublicationRequirement complete={requirements.municipality && requirements.state}>
                Municipio y estado
              </PublicationRequirement>
              <PublicationRequirement complete={requirements.postalCode}>
                Código postal de 5 dígitos
              </PublicationRequirement>
            </ul>
          </div>

          <div className="ecom-admin-status-actions">
            <span><Globe2 size={18} aria-hidden="true" /> Slug: <strong>{portal.slug}</strong></span>
            <button
              type="button"
              className={`btn ${portal.status === 'published' ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => onChangeStatus(
                portal.status === 'published' ? 'paused' : 'published'
              )}
              disabled={saving || (portal.status !== 'published' && !canPublish)}
              aria-describedby="ecom-publication-requirements"
            >
              {portal.status === 'published'
                ? <PauseCircle size={17} aria-hidden="true" />
                : <PlayCircle size={17} aria-hidden="true" />}
              {portal.status === 'published' ? 'Pausar portal' : 'Publicar portal'}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
