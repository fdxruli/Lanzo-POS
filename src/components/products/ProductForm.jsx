import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { normalizeBusinessTypes } from '../../utils/businessType';
import ProductFormV2 from './form-v2/ProductFormV2';
import ProductFormLegacy from './legacy/ProductFormLegacy';
import { PRODUCT_FORM_IMPLEMENTATION, PRODUCT_FORM_IMPLEMENTATIONS } from './productFormImplementation';

/**
 * ProductForm is the stable ProductsPage contract and the single implementation
 * adapter.  Rollback is intentionally a source change in productFormImplementation.
 */
export default function ProductForm(props) {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const businessTypes = useMemo(() => normalizeBusinessTypes(companyProfile?.business_type), [companyProfile?.business_type]);

  if (PRODUCT_FORM_IMPLEMENTATION === PRODUCT_FORM_IMPLEMENTATIONS.LEGACY) {
    return <ProductFormLegacy {...props} businessTypes={businessTypes} />;
  }

  return <ProductFormV2 {...props} businessTypes={businessTypes} />;
}
