import { useState } from 'react';
import {
  ChevronDown,
  Clock3,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  ShoppingBag,
  Truck
} from 'lucide-react';
import PublicSafeImage from './PublicSafeImage';
import { getAvailabilityDetail, getAvailabilityLabel } from '../../../utils/ecommerceAvailability';
import { normalizeBusinessType } from '../../../utils/businessType';
import './PublicResponsive.css';

const BUSINESS_TYPE_LABELS = Object.freeze({
  food_service: 'Restaurante / Cocina',
  farmacia: 'Farmacia',
  'verduleria/fruteria': 'Frutería / Verdulería',
  abarrotes: 'Abarrotes / Tienda',
  apparel: 'Ropa / Boutique',
  hardware: 'Ferretería',
  otro: 'Otro'
});

const getBusinessTypeLabel = (value) => {
  const values = Array.isArray(value) ? value : [value];
  const firstValue = values.find((item) => String(item || '').trim());
  if (!firstValue) return '';

  const normalized = normalizeBusinessType(firstValue, null);
  return BUSINESS_TYPE_LABELS[normalized] || String(firstValue).trim();
};

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

const MXN_CURRENCY_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

const formatCurrency = (value) => MXN_CURRENCY_FORMATTER.format(Number(value) || 0);

function PublicStoreHeader({ portal, hours, availability }) {
  const [coverState, setCoverState] = useState({ src: '', orientation: 'landscape' });
  const availabilityLabel = getAvailabilityLabel(availability);
  const availabilityDetail = availability?.legacy
    ? getTodayHoursLabel(hours)
    : getAvailabilityDetail(availability);
  const hasFulfillment = portal.pickupEnabled === true || portal.deliveryEnabled === true;
  const whatsappDigits = String(portal.whatsappPhone || '').replace(/\D/g, '');
  const businessTypeLabel = getBusinessTypeLabel(portal.businessType);
  const coverSource = String(portal.coverImageUrl || '');
  const coverOrientation = coverState.src === coverSource ? coverState.orientation : 'landscape';

  const handleCoverLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setCoverState({
      src: coverSource,
      orientation: naturalHeight > naturalWidth ? 'portrait' : 'landscape'
    });
  };

  const handleCoverError = () => {
    setCoverState({ src: coverSource, orientation: 'landscape' });
  };

  return (
    <header className="public-store-header">
      <div
        className="public-store-header__cover-wrap"
        data-cover-orientation={coverOrientation}
      >
        <PublicSafeImage
          src={coverSource}
          alt={`Portada de ${portal.name}`}
          fallbackLabel={`Portada de ${portal.name}`}
          className={`public-store-header__cover${coverOrientation === 'portrait' ? ' public-store-header__cover--portrait' : ''}`}
          eager
          onLoad={handleCoverLoad}
          onError={handleCoverError}
        />
        <div className="public-store-header__cover-shade" aria-hidden="true" />
      </div>

      <div className="public-store-header__content">
        <div className="public-store-header__identity-row">
          <PublicSafeImage
            src={portal.logoUrl}
            alt={`Logo de ${portal.name}`}
            fallbackLabel={`Logo de ${portal.name}`}
            className="public-store-header__logo"
            eager
          />

          <div className="public-store-header__identity">
            <p className="public-store-header__eyebrow">
              <span>Tienda online</span>
              {businessTypeLabel ? (
                <span className="public-store-header__business-type">{businessTypeLabel}</span>
              ) : null}
            </p>
            <h1>{portal.name}</h1>
            {portal.headline ? <p className="public-store-header__headline">{portal.headline}</p> : null}
          </div>
        </div>

        <div className="public-store-header__overview">
          <div className="public-store-header__summary" role="group" aria-label="Estado y ubicación del negocio">
            <span
              className="public-store-availability"
              role="status"
              aria-live="polite"
              aria-label={`Disponibilidad para pedidos: ${availabilityLabel}${availabilityDetail ? `. ${availabilityDetail}` : ''}`}
            >
              <Clock3 aria-hidden="true" size={18} />
              <span className="public-store-availability__copy">
                <small>Pedidos</small>
                <strong>{availabilityLabel}</strong>
                {availabilityDetail ? <span>{availabilityDetail}</span> : null}
              </span>
            </span>
            {portal.address ? (
              <span className="public-store-header__address">
                <MapPin aria-hidden="true" size={18} />
                <span>{portal.address}</span>
              </span>
            ) : null}
          </div>

          <div className="public-store-header__options">
            <details className="public-store-header__information">
              <summary>
                <Info aria-hidden="true" size={17} />
                Información
                <ChevronDown aria-hidden="true" size={16} />
              </summary>
              <div className="public-store-header__details" role="group" aria-label="Información del negocio">
                {portal.description ? <p className="public-store-header__description">{portal.description}</p> : null}
                {portal.address ? (
                  <span><MapPin aria-hidden="true" size={18} />Dirección: {portal.address}</span>
                ) : null}
                {whatsappDigits ? (
                  <a
                    href={`https://wa.me/${whatsappDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle aria-hidden="true" size={18} />
                    WhatsApp {portal.whatsappPhone}
                  </a>
                ) : null}
                {portal.contactEmail ? (
                  <a href={`mailto:${portal.contactEmail}`}>
                    <Mail aria-hidden="true" size={18} />
                    {portal.contactEmail}
                  </a>
                ) : null}
                {portal.minOrderTotal > 0 ? (
                  <span><ShoppingBag aria-hidden="true" size={18} />Pedido mínimo {formatCurrency(portal.minOrderTotal)}</span>
                ) : null}
                {portal.pickupEnabled === true ? (
                  <span><ShoppingBag aria-hidden="true" size={18} />Recoger en negocio</span>
                ) : null}
                {portal.deliveryEnabled === true ? (
                  <span><Truck aria-hidden="true" size={18} />Entrega a domicilio</span>
                ) : null}
              </div>
            </details>

            {hasFulfillment ? (
              <div className="public-store-header__badges" role="group" aria-label="Modalidades disponibles">
                {portal.pickupEnabled === true ? (
                  <span className="public-store-badge"><ShoppingBag aria-hidden="true" size={16} />Recoger en negocio</span>
                ) : null}
                {portal.deliveryEnabled === true ? (
                  <span className="public-store-badge"><Truck aria-hidden="true" size={16} />Entrega a domicilio</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export default PublicStoreHeader;
