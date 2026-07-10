const STATUS_LABELS = Object.freeze({
  new: 'Nuevo',
  seen: 'Visto',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  preparing: 'Preparando',
  ready: 'Listo',
  completed: 'Completado',
  cancelled: 'Cancelado',
  converted_to_sale: 'Convertido a venta'
});

export default function EcommerceOrderStatusBadge({ status = 'new' }) {
  const normalized = STATUS_LABELS[status] ? status : 'new';
  return (
    <span className={`ecommerce-order-status ecommerce-order-status--${normalized}`}>
      {STATUS_LABELS[normalized]}
    </span>
  );
}
