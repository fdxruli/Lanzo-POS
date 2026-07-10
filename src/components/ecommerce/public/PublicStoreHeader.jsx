import { Clock3, MapPin, PackageCheck, ShoppingBag, Truck } from 'lucide-react';
import PublicSafeImage from './PublicSafeImage';

const formatTime = (value) => {
  if (typeof value !== 'string' || !value) return '';
  return value.slice(0, 5);
};

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getTodayHoursLabel(hours, now = new Date()) {
  const weekly = Array.isArray(hours?.weekly) ? hours.weekly : [];
  const exceptions = Array.isArray(hours?.exceptions) ? hours.exceptions : [];
  const todayDate = formatLocalDate(now);
  const exception = exceptions.find((item) => item?.date === todayDate);
  const schedule = exception || weekly.find((item) => Number(item?.weekday) === now.getDay());

  if (!schedule) return 'Horario no configurado';
  if (schedule.isOpen === false) return 'Cerrado hoy';

  const opensAt = formatTime(schedule.opensAt);
  const closesAt = formatTime(schedule.closesAt);
  if (!opensAt || !closesAt) return 'Horario no configurado';
  return `Abierto hoy de ${opensAt} a ${closesAt}`;
}

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
}).format(Number(value) || 0);

function PublicStoreHeader({ portal, hours }) {
  const hoursLabel = getTodayHoursLabel(hours);
  const hasFulfillment = portal.pickupEnabled || portal.deliveryEnabled;

  return (
    <header className="public-store-header">
      <div className="public-store-header__cover-wrap">
        <PublicSafeImage
          src={portal.coverImageUrl}
          alt={`Portada de ${portal.name}`}
          fallbackLabel={`Portada de ${portal.name}`}
          className="public-store-header__cover"
          eager
        />
        <div className="public-store-header__cover-shade" aria-hidden="true" />
      </div>

      <div className="public-store-header__content">
        <PublicSafeImage
          src={portal.logoUrl}
          alt={`Logo de ${portal.name}`}
          fallbackLabel={`Logo de ${portal.name}`}
          className="public-store-header__logo"
          eager
        />

        <div className="public-store-header__identity">
          <p className="public-store-header__eyebrow">Tienda online</p>
          <h1>{portal.name}</h1>
          {portal.headline ? <p className="public-store-header__headline">{portal.headline}</p> : null}
          {portal.description ? <p className="public-store-header__description">{portal.description}</p> : null}
        </div>

        <div className="public-store-header__details" aria-label="Información del negocio">
          {portal.address ? (
            <span><MapPin aria-hidden="true" size={18} />{portal.address}</span>
          ) : null}
          <span><Clock3 aria-hidden="true" size={18} />{hoursLabel}</span>
          {portal.minOrderTotal > 0 ? (
            <span><ShoppingBag aria-hidden="true" size={18} />Pedido mínimo {formatCurrency(portal.minOrderTotal)}</span>
          ) : null}
          <span>
            <PackageCheck aria-hidden="true" size={18} />
            {portal.orderingEnabled ? 'Catálogo disponible' : 'Pedidos temporalmente pausados'}
          </span>
        </div>

        {hasFulfillment ? (
          <div className="public-store-header__badges" aria-label="Métodos de entrega">
            {portal.pickupEnabled ? (
              <span className="public-store-badge"><ShoppingBag aria-hidden="true" size={16} />Recoger en negocio</span>
            ) : null}
            {portal.deliveryEnabled ? (
              <span className="public-store-badge"><Truck aria-hidden="true" size={16} />Entrega a domicilio</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default PublicStoreHeader;
