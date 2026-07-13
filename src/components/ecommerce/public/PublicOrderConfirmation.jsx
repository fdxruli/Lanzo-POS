import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, MessageCircle, ShoppingBag } from 'lucide-react';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

function PublicOrderConfirmation({
  order,
  whatsapp,
  whatsappEnabled,
  onContinue
}) {
  const [copied, setCopied] = useState('');
  const canOpenWhatsapp = whatsappEnabled === true && Boolean(whatsapp?.url);
  const trackingUrl = useMemo(() => {
    if (!order?.trackingPath) return '';
    try {
      return new URL(order.trackingPath, globalThis.location?.origin || 'https://lanzo.local').toString();
    } catch {
      return '';
    }
  }, [order?.trackingPath]);

  const copyText = async (value, kind) => {
    if (!value || !globalThis.navigator?.clipboard?.writeText) return;
    try {
      await globalThis.navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied('');
    }
  };

  return (
    <section className="public-order-confirmation" aria-labelledby="public-order-confirmation-title">
      <div className="public-order-confirmation__icon" aria-hidden="true">
        <CheckCircle2 size={34} />
      </div>
      <p className="public-store-section-kicker">Pedido registrado</p>
      <h2 id="public-order-confirmation-title">Pedido enviado</h2>
      <p className="public-order-confirmation__lead">Pendiente de confirmación del negocio.</p>

      <dl className="public-order-confirmation__details">
        <div><dt>Código del pedido</dt><dd>{order?.code || 'No disponible'}</dd></div>
        <div><dt>Total confirmado</dt><dd>{formatCurrency(order?.total, order?.currency)}</dd></div>
        <div><dt>Modalidad</dt><dd>{order?.fulfillmentMethod === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'}</dd></div>
        <div><dt>Fecha y hora</dt><dd>{formatDateTime(order?.createdAt)}</dd></div>
        <div><dt>Estado</dt><dd>Pedido recibido</dd></div>
      </dl>

      {trackingUrl ? (
        <div className="public-order-confirmation__actions">
          <a className="ui-button ui-button--primary" href={order.trackingPath}>
            <ExternalLink aria-hidden="true" size={18} />
            Ver seguimiento del pedido
          </a>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => copyText(trackingUrl, 'tracking')}
          >
            <Copy aria-hidden="true" size={18} />
            {copied === 'tracking' ? 'Enlace copiado' : 'Copiar enlace de seguimiento'}
          </button>
        </div>
      ) : null}

      {canOpenWhatsapp ? (
        <a
          className="ui-button ui-button--primary public-checkout-action"
          href={whatsapp.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle aria-hidden="true" size={19} />
          Enviar resumen por WhatsApp
        </a>
      ) : (
        <p className="public-checkout-inline-note">
          El pedido ya fue registrado. Puedes comunicarte directamente con el negocio si necesitas confirmar algún detalle.
        </p>
      )}

      <div className="public-order-confirmation__actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => copyText(order?.code, 'code')}
          disabled={!order?.code}
        >
          <Copy aria-hidden="true" size={18} />
          {copied === 'code' ? 'Código copiado' : 'Copiar código del pedido'}
        </button>
        <button type="button" className="ui-button ui-button--secondary" onClick={onContinue}>
          <ShoppingBag aria-hidden="true" size={18} />
          Seguir comprando
        </button>
      </div>
    </section>
  );
}

export default PublicOrderConfirmation;
