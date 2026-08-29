export const ECOMMERCE_DELIVERY_ADDRESS_LIMITS = Object.freeze({
  street: 160,
  exteriorNumber: 40,
  interiorNumber: 40,
  neighborhood: 160,
  municipality: 120,
  state: 80,
  postalCode: 20,
  reference: 500
});

export const ECOMMERCE_DELIVERY_ADDRESS_FIELDS = Object.freeze([
  'street',
  'exteriorNumber',
  'interiorNumber',
  'neighborhood',
  'municipality',
  'state',
  'postalCode',
  'reference'
]);

const isRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const asBoundedText = (value, maxLength) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

export const createEmptyEcommerceDeliveryAddress = () => (
  ECOMMERCE_DELIVERY_ADDRESS_FIELDS.reduce((address, field) => ({
    ...address,
    [field]: ''
  }), {})
);

export const isEcommerceDeliveryAddressRecord = isRecord;

export const normalizeEcommerceDeliveryAddress = (value) => {
  const source = isRecord(value) ? value : {};
  return ECOMMERCE_DELIVERY_ADDRESS_FIELDS.reduce((address, field) => ({
    ...address,
    [field]: asBoundedText(source[field], ECOMMERCE_DELIVERY_ADDRESS_LIMITS[field])
  }), {});
};

export const formatEcommerceDeliveryAddress = (value) => {
  const address = normalizeEcommerceDeliveryAddress(value);
  const streetLine = [
    address.street,
    address.exteriorNumber ? `#${address.exteriorNumber}` : '',
    address.interiorNumber ? `Int. ${address.interiorNumber}` : ''
  ].filter(Boolean).join(' ');

  return [
    streetLine,
    address.neighborhood,
    address.municipality,
    address.state,
    address.postalCode ? `CP ${address.postalCode}` : ''
  ].filter(Boolean).join(', ').slice(0, 500);
};
