import ProFeatureShowcase from '../plans/ProFeatureShowcase';
import './LanzoNubeCapabilitiesShowcase.css';

const CLOUD_CAPABILITIES = Object.freeze({
  notifications: Object.freeze({
    title: 'Centraliza los avisos importantes de tu negocio',
    description: 'Consulta avisos Cloud de operaciones, inventario, licencia, pedidos online y soporte en categorías con permisos para Staff. Las alertas locales de inventario siguen disponibles en Lanzo Local.'
  }),
  support: Object.freeze({
    title: 'Da seguimiento a tus solicitudes desde Lanzo',
    description: 'Registra solicitudes dentro de la aplicación, consulta las existentes e historial, revisa respuestas y cambios de estado y responde según tus permisos.'
  })
});

const CTA_PROPS = {
  variant: 'card',
  badge: 'PRO',
  ctaLabel: 'Conocer Lanzo Nube',
  ctaTo: '/acerca-de',
  secondaryText: 'Este enlace abre información y no cambia tu plan ni tu licencia.'
};

export function TeamProShowcase() {
  return (
    <ProFeatureShowcase
      {...CTA_PROPS}
      eyebrow="Equipo · Lanzo Nube"
      title="Organiza a tu equipo con Lanzo Nube"
      description="Administra el acceso de tu personal mediante cuentas, roles y permisos adecuados para las responsabilidades de cada integrante."
      benefitsTitle="Accesos organizados para cada responsabilidad"
      benefits={[
        'Crea y administra usuarios Staff.',
        'Asigna perfiles de trabajo y permisos por módulo.',
        'Controla quién puede operar o consultar determinadas herramientas.',
        'Organiza el trabajo en los dispositivos autorizados por tu licencia.'
      ]}
      offerTitle="Conoce las herramientas de equipo de Lanzo Nube"
      offerDescription="La disponibilidad depende de las capacidades contratadas para tu negocio."
      className="settings-nube-showcase"
    />
  );
}

export function CloudCapabilitiesShowcase({ showNotifications, showSupport }) {
  const features = [
    ...(showNotifications ? [CLOUD_CAPABILITIES.notifications] : []),
    ...(showSupport ? [CLOUD_CAPABILITIES.support] : [])
  ];

  if (features.length === 0) return null;

  return (
    <ProFeatureShowcase
      {...CTA_PROPS}
      eyebrow="Capacidades Nube"
      title="Más herramientas para dar seguimiento"
      description="Lanzo Local conserva sus alertas locales y los canales de ayuda disponibles. Lanzo Nube añade un centro organizado para notificaciones Cloud y solicitudes de soporte."
      features={features}
      offerTitle="Conoce las capacidades de Lanzo Nube"
      offerDescription={showSupport
        ? 'Los tiempos de atención dependen de la disponibilidad del servicio de soporte.'
        : 'La disponibilidad depende de las capacidades contratadas para tu negocio.'}
      className="settings-nube-showcase"
    />
  );
}

export function DeviceProShowcase() {
  return (
    <ProFeatureShowcase
      {...CTA_PROPS}
      eyebrow="Dispositivos · Lanzo Nube"
      title="Trabaja con más dispositivos usando Lanzo Nube"
      description="Lanzo Nube permite organizar el trabajo en varios equipos y aprovechar funciones de sincronización y administración según las capacidades contratadas."
      offerTitle="Conoce Lanzo Nube"
      className="settings-nube-showcase settings-device-nube-showcase"
    />
  );
}
