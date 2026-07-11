import PropTypes from 'prop-types';
import { AlertTriangle, ShoppingBag } from 'lucide-react';
import './EcommercePosDraftGuards.css';

export default function EcommercePosDraftBanner({ order, warnings = [], onOpenDetail }) {
  if (order?.origin !== 'ecommerce') return null;

  return (
    <section className="ecommerce-pos-draft-banner" aria-label="Pedido online preparado">
      <div className="ecommerce-pos-draft-banner__title">
        <ShoppingBag size={20} aria-hidden="true" />
        <strong>Pedido online {order.ecommerceOrderCode || ''}</strong>
      </div>
      <dl>
        <div><dt>Modalidad</dt><dd>{order.fulfillmentMethod === 'delivery' ? 'Entrega' : 'Recolección'}</dd></div>
        <div><dt>Total esperado</dt><dd>${Number(order.expectedTotal || 0).toFixed(2)} {order.currency || 'MXN'}</dd></div>
        <div><dt>Estado</dt><dd>{order.ecommerceDraftStatus === 'error_releasing' ? 'Liberación pendiente' : 'Preparado para revisión'}</dd></div>
      </dl>
      {warnings.length > 0 && (
        <ul className="ecommerce-pos-draft-banner__warnings">
          {warnings.map((warning) => <li key={warning}><AlertTriangle size={15} aria-hidden="true" />{warning}</li>)}
        </ul>
      )}
      <button type="button" className="ecommerce-pos-draft-banner__link" onClick={onOpenDetail}>
        Volver al detalle del pedido
      </button>
    </section>
  );
}

EcommercePosDraftBanner.propTypes = {
  order: PropTypes.shape({
    origin: PropTypes.string,
    ecommerceOrderCode: PropTypes.string,
    ecommerceDraftStatus: PropTypes.string,
    fulfillmentMethod: PropTypes.string,
    expectedTotal: PropTypes.number,
    currency: PropTypes.string
  }),
  warnings: PropTypes.arrayOf(PropTypes.string),
  onOpenDetail: PropTypes.func
};
