import {
  CalendarClock,
  History,
  Image,
  MessageSquareText,
  Settings2
} from 'lucide-react';
import ProFeatureShowcase from '../plans/ProFeatureShowcase';

const SHOWCASES = Object.freeze({
  'message-config': Object.freeze({
    eyebrow: 'Clientes · Lanzo Nube',
    title: 'Haz que cada mensaje lleve la identidad de tu negocio',
    description: 'Personaliza los mensajes que compartes con tus clientes para ofrecer una comunicación más clara, profesional y consistente.',
    features: Object.freeze([
      Object.freeze({
        title: 'Mensajes para eventos distintos',
        description: 'Prepara formatos para ventas, abonos, estados de cuenta y eventos de apartados compatibles.',
        icon: <MessageSquareText size={19} />
      }),
      Object.freeze({
        title: 'Contenido que puedes ajustar',
        description: 'Edita el título, el cuerpo y el pie de página; agrega variables permitidas para cada evento.',
        icon: <Settings2 size={19} />
      }),
      Object.freeze({
        title: 'Comprobantes visuales',
        description: 'Prepara imágenes con el nombre del negocio y los datos disponibles de la operación.',
        icon: <Image size={19} />
      })
    ]),
    benefitsTitle: 'Una experiencia coherente en cada comprobante',
    benefits: Object.freeze([
      'Personaliza las plantillas para ventas, abonos, apartados y estados de cuenta admitidos.',
      'Usa variables compatibles para incluir información real del evento y del negocio.',
      'Lanzo Local conserva su forma manual y genérica de compartir comprobantes e imágenes.'
    ]),
    offerTitle: 'Conoce las herramientas de comunicación de Lanzo Nube',
    offerDescription: 'Lanzo Nube agrega personalización para los eventos compatibles; no cambia tu plan ni inicia una compra.'
  }),
  reminders: Object.freeze({
    eyebrow: 'Clientes · Lanzo Nube',
    title: 'Organiza el seguimiento de tus cuentas por cobrar',
    description: 'Programa y administra recordatorios de saldo pendiente para dar seguimiento a tus clientes desde las herramientas de Lanzo Nube.',
    features: Object.freeze([
      Object.freeze({
        title: 'Programa el seguimiento',
        description: 'Administra recordatorios relacionados con saldos pendientes de tus clientes.',
        icon: <CalendarClock size={19} />
      }),
      Object.freeze({
        title: 'Configura los horarios',
        description: 'Consulta las opciones de zona horaria, hora local y reglas generales disponibles.',
        icon: <Settings2 size={19} />
      }),
      Object.freeze({
        title: 'Revisa estados e historial',
        description: 'Consulta los estados de recordatorios y el historial cloud del outbox.',
        icon: <History size={19} />
      })
    ]),
    benefitsTitle: 'Seguimiento con control y visibilidad',
    benefits: Object.freeze([
      'Reprograma o cancela recordatorios cuando tu nivel de acceso lo permita.',
      'La sincronización actualiza el historial; por sí sola no confirma que se envió o recibió un mensaje.',
      'La entrega depende de los mecanismos de envío disponibles y de su configuración.'
    ]),
    offerTitle: 'Da seguimiento a tus cuentas con Lanzo Nube',
    offerDescription: 'Puedes programar y administrar recordatorios. No se promete envío automático por WhatsApp, SMS ni correo.'
  })
});

export default function CustomerMessagingProShowcase({ feature }) {
  const content = SHOWCASES[feature];
  if (!content) return null;

  return (
    <ProFeatureShowcase
      {...content}
      variant="card"
      badge="PRO"
      ctaLabel="Conocer Lanzo Nube"
      ctaTo="/acerca-de"
      secondaryText="Este enlace abre información y no cambia tu plan."
      className="customers-messaging-showcase"
    />
  );
}
