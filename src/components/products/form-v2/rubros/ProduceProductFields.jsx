import ProductExpirationFields from '../components/ProductExpirationFields';

export default function ProduceProductFields({ values, errors, onFieldChange, onExpirationMode }) {
  return <>
    <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} />
  </>;
}
