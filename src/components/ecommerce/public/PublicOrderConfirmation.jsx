import { useState } from 'react';
import { CheckCircle2, Copy, MessageCircle, ShoppingBag } from 'lucide-react';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

function PublicOrderConfirmation({
  order,
  whatsapp,
  whatsappEnabled,
  onContinue,
}) {
  const [copied, setCopied] = useState(false);
  const canOpenWhatsapp = whatsappEnabled === true && Boolean(whatsapp?.url);

  const copyCode = async () => {
    if (!order?.code || !globalThis.navigator?.clipboard?.writeText) return;
    try {
      await globalThis.navigator.clipboard.writeText(order.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="public-order-confirmation" aria-labelledby="public-order-confirmation-title">
      <div className="public-order-confirmation__icon" aria-hidden="true">
        <CheckCircle2 size={34} />
      </div>
      <p className="public-store-section-kicker">Pedido registrado</p>
      <h2 id="public-order-confirmation-title">Pedido enviado</h2>
      <p className="public-order-confirmation__lead">
        Pendiente de confirmación del negocio.
      </p>

      <dl className="public-order-confirmation__details">
        <div>
          <dt>Código del pedido</dt>
          <dd>{order?.code || 'No disponible'}</dd>
        </div>
        <div>
          <dt>Total confirmado</dt>
          <dd>{formatCurrency(order?.total, order?.currency)}</dd>
        </div>
        <div>
          <dt>Modalidad</dt>
          <dd>{order?.fulfillmentMethod === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'}</dd>
        </div>
        <div>
          <dt>Fecha y hora</dt>
          <dd>{formatDateTime(order?.createdAt)}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>Pendiente</dd>
        </div>
      </dl>

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
          onClick={copyCode}
          disabled={!order?.code}
        >
          <Copy aria-hidden="true" size={18} />
          {copied ? 'Código copiado' : 'Copiar código del pedido'}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={onContinue}
        >
          <ShoppingBag aria-hidden="true" size={18} />
          Seguir comprando
        </button>
      </div>
    </section>
  );
}

export default PublicOrderConfirmation;
