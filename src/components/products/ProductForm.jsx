import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { normalizeBusinessTypes } from '../../utils/businessType';
import ProductFormV2 from './form-v2/ProductFormV2';

/** The stable ProductsPage contract and canonical product-form entrypoint. */
export default function ProductForm(props) {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const businessTypes = useMemo(() => normalizeBusinessTypes(companyProfile?.business_type), [companyProfile?.business_type]);

  return <ProductFormV2 {...props} businessTypes={businessTypes} />;
}
