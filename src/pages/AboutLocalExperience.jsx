import { BarChart3, Boxes, Check, CheckCircle2, DatabaseBackup, Globe2, MonitorSmartphone, ReceiptText, ShieldCheck, Store, Users, WifiOff } from 'lucide-react';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import { getPlanFeaturesFromLicenseDetails, isFeatureEnabled } from '../services/sync/syncConstants';
import { isEcommercePortalEnabled, isEcommerceOrderInboxEnabled } from '../services/ecommerce/ecommerceOrderCapabilities';
import { normalizeBusinessTypes } from '../utils/businessType';

const WORKFLOWS = [
  { id: 'solo', title: 'Vendo desde un equipo', description: 'Uso Lanzo en una computadora o tablet, principalmente yo.', Icon: Store },
  { id: 'team', title: 'Trabajo con un equipo', description: 'Varias personas venden y necesito ver todo sincronizado.', Icon: Users }
];

// Presentation only: no fallback promises when a cached license omits a limit.
const positiveLimit = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const publishedProductsLabel = (value) => {
  if (value === -1 || value === '-1') return 'Productos publicados sin límite según tu licencia.';
  if (value === 0 || value === '0') return 'Tu licencia no permite publicar productos actualmente.';
  const limit = positiveLimit(value);
  return limit === null
    ? 'Publicación de productos según el límite de tu licencia.'
    : `Hasta ${limit} ${limit === 1 ? 'producto publicado' : 'productos publicados'}.`;
};

export default function AboutLocalExperience({ licenseDetails, businessTypes, selectedWorkflow, onSelectWorkflow, contactActions, renderContactAction, canReadReports }) {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  const businessFeatures = useFeatureConfig();
  const deviceLimit = positiveLimit(features.max_devices ?? licenseDetails?.max_devices ?? licenseDetails?.details?.max_devices);
  const deviceLabel = deviceLimit === null ? 'Según licencia' : `${deviceLimit} ${deviceLimit === 1 ? 'dispositivo' : 'dispositivos'}`;
  const categories = [
    { id: 'pos', Icon: ReceiptText, title: 'Punto de venta', description: 'Registra ventas y cobros desde este equipo. Consulta las ventas realizadas y continúa con las operaciones locales compatibles.' },
    { id: 'products', Icon: Boxes, title: 'Productos e inventario', description: `Organiza productos, precios y costos. Consulta existencias${isFeatureEnabled(features, 'local_inventory_alerts') ? ' y utiliza las alertas locales de inventario' : ''}.` },
    { id: 'cash', Icon: ShieldCheck, title: 'Caja y control diario', description: 'Abre tu caja, registra movimientos y realiza cierres y cortes. Consulta el historial guardado en este dispositivo.' },
    { id: 'customers', Icon: Users, title: 'Clientes', description: 'Registra clientes y administra sus datos de contacto desde tu operación local.' },
    { id: 'reports', Icon: BarChart3, title: 'Ventas y reportes', description: canReadReports ? 'Consulta el historial de ventas y los reportes locales para conocer los resultados de tu operación.' : 'Los reportes locales están sujetos a los permisos de tu usuario. Pide al administrador que revise tu acceso.' },
    { id: 'backup', Icon: DatabaseBackup, title: 'Datos y respaldos', description: 'Trabaja con los datos de este dispositivo y realiza respaldos manuales desde las opciones autorizadas. Guarda una copia fuera del equipo para poder recuperarla.' }
  ];

  if (isEcommercePortalEnabled(licenseDetails)) {
    const onlineDetails = [
      publishedProductsLabel(features.ecommerce_max_published_products),
      'Presentación básica de tu tienda.',
      isFeatureEnabled(features, 'ecommerce_business_hours') && 'Horarios comerciales.',
      isFeatureEnabled(features, 'ecommerce_whatsapp_checkout') && 'Pedidos mediante WhatsApp.',
      isEcommerceOrderInboxEnabled(licenseDetails) && 'Gestión de pedidos según los permisos de tu usuario.'
    ].filter(Boolean);
    categories.splice(5, 0, { id: 'online', Icon: Globe2, title: 'Tienda en línea', description: onlineDetails.join(' '), note: 'Requiere conexión a internet.' });
  }

  // Only established Free tools; exclude tiered recipes, modifiers, variants,
  // laboratory fields and preparation stations even if a legacy hook enables them.
  const hasKnownBusinessType = normalizeBusinessTypes(businessTypes, null).some(Boolean);
  const specialized = hasKnownBusinessType ? [
    businessFeatures.hasLots && 'Control por lotes',
    businessFeatures.hasExpiry && 'seguimiento de caducidades',
    businessFeatures.hasBulk && 'venta a granel',
    businessFeatures.hasSKU && 'identificación por SKU',
    businessFeatures.hasMinMax && 'niveles mínimos y máximos de inventario'
  ].filter(Boolean) : [];
  if (specialized.length > 0) {
    categories.push({ id: 'business', Icon: Store, title: 'Para tu tipo de negocio', description: `${specialized.join(', ')}. Las herramientas se muestran según los rubros configurados y tus permisos.` });
  }

  const recommendation = selectedWorkflow === 'solo'
    ? { title: 'Lanzo Local te acompaña', description: 'Puedes seguir con tu plan actual para vender y controlar tu negocio desde este equipo, sin suscripción.' }
    : selectedWorkflow === 'team'
      ? { title: 'Lanzo Nube para trabajar en equipo', description: 'Conecta hasta cinco dispositivos según la licencia contratada, sincroniza tu operación y organiza los accesos de tus colaboradores.' }
      : { title: 'Una opción para cada etapa', description: 'Cuéntanos cómo trabajas hoy para conocer la opción que mejor acompaña tu operación.' };

  return (
    <div className="about-local">
      <section className="about-local__current about-local__panel" id="about-local-plan" aria-labelledby="about-local-plan-title" tabIndex={-1}>
        <div className="about-local__plan-copy">
          <p className="about-local__label"><CheckCircle2 size={18} aria-hidden="true" /> Tu plan actual</p>
          <div className="about-local__plan-heading">
            <h2 id="about-local-plan-title">Lanzo Local</h2>
            <span className="about-local__status"><Check size={16} aria-hidden="true" /> Activo</span>
          </div>
          <p>Tienes un punto de venta para administrar tu negocio desde este dispositivo, sin pagar una suscripción. Sigue vendiendo y controlando tu operación con Lanzo Local.</p>
        </div>
        <dl className="about-local__essentials">
          <div><dt>Gratis</dt><dd>$0 MXN</dd></div>
          <div><dt><MonitorSmartphone size={18} aria-hidden="true" /> Capacidad</dt><dd>{deviceLabel}</dd></div>
          <div><dt><WifiOff size={18} aria-hidden="true" /> Operación local</dt><dd>Sin internet en módulos compatibles</dd></div>
        </dl>
      </section>

      <section className="about-local__capabilities" aria-labelledby="about-local-capabilities-title">
        <header className="about-local__section-heading">
          <h2 id="about-local-capabilities-title">Todo lo que puedes hacer con Lanzo</h2>
          <p>Tu plan gratuito incluye herramientas para vender, organizar productos, administrar clientes y llevar el control de tu negocio. Descubre las capacidades que ya tienes disponibles.</p>
        </header>
        <div className="about-local__category-grid">
          {categories.map(({ id, Icon, title, description, note }) => (
            <article className="about-local__category about-local__panel" key={id}>
              <span className="about-local__icon" aria-hidden="true"><Icon size={21} /></span>
              <div><h3>{title}</h3><p>{description}</p>{note && <p className="about-local__note">{note}</p>}</div>
            </article>
          ))}
        </div>
        <p className="about-local__permissions">Las herramientas respetan los permisos de tu usuario. La continuidad sin internet aplica a los módulos locales compatibles; la tienda en línea y el contacto online necesitan conexión.</p>
      </section>

      <section className="about-local__chooser about-local__panel" aria-labelledby="about-local-pace-title">
        <header className="about-local__section-heading">
          <h2 id="about-local-pace-title">Elige a tu ritmo</h2>
          <h3 id="about-workflow-title">¿Cómo trabajas hoy?</h3>
          <p>Explora las opciones. Tu elección aquí no cambia tu plan.</p>
        </header>
        <div className="about-local__workflows" role="group" aria-labelledby="about-workflow-title">
          {WORKFLOWS.map(({ id, title, description, Icon }) => (
            <button type="button" className="about-local__workflow" key={id} aria-pressed={selectedWorkflow === id} onClick={() => onSelectWorkflow(id)}>
              <Icon size={22} aria-hidden="true" />
              <span><strong>{title}</strong><span>{description}</span></span>
              <span className="about-local__selection" aria-hidden="true">{selectedWorkflow === id && <Check size={15} />}</span>
            </button>
          ))}
        </div>
        <div className="about-local__recommendation" role="status" aria-live="polite" aria-atomic="true">
          <h3>{recommendation.title}</h3><p>{recommendation.description}</p>
        </div>
        {selectedWorkflow === 'solo' && <a className="about-local__keep" href="#about-local-plan">Mantener plan Local <Check size={16} aria-hidden="true" /></a>}
      </section>

      <section className="about-local__cloud about-local__panel" aria-labelledby="about-local-cloud-title">
        <div className="about-local__cloud-copy">
          <p className="about-local__label">Crece con Lanzo Nube</p>
          <h2 id="about-local-cloud-title">Cuando tu negocio crezca, Lanzo también crecerá contigo</h2>
          <p>Añade a tu operación local las herramientas que necesites para colaborar y conectar tu negocio.</p>
          <ul>
            <li><Check size={17} aria-hidden="true" /> Hasta cinco dispositivos según la licencia contratada.</li>
            <li><Check size={17} aria-hidden="true" /> Sincronización cloud, roles y colaboradores.</li>
            <li><Check size={17} aria-hidden="true" /> Catálogo ampliado, análisis e IA según las capacidades y límites contratados.</li>
          </ul>
        </div>
        <div className="about-local__contact">
          <h3>Conoce las condiciones vigentes</h3>
          <p>Consulta precios y disponibilidad con el equipo. Activación asistida por Telegram y transferencia.</p>
          {renderContactAction(contactActions.primary, 'about-redesign__primary-button')}
          {contactActions.secondary?.kind === 'telegram' && renderContactAction(contactActions.secondary, 'about-redesign__secondary-button')}
          <p className="about-local__note">La consulta no produce un cargo ni activa un plan. Revisa el mensaje antes de abrir Telegram.</p>
        </div>
      </section>
    </div>
  );
}
