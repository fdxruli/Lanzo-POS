import { useEffect, useMemo, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import ScannerModal from '../../scanner/ScannerModal';
import RecipeBuilderModal from '../RecipeBuilderModal';
import WholesaleManagerModal from '../WholesaleManagerModal';
import { normalizeBusinessTypes } from '../../../utils/businessType';
import { useFeatureConfig } from '../../../hooks/useFeatureConfig';
import { getProductRubroConfig, normalizeProductRubro } from './config/productRubroConfig';
import { useProductFormV2 } from './hooks/useProductFormV2';
import ProductCoreFields from './components/ProductCoreFields';
import ProductInventoryFields from './components/ProductInventoryFields';
import ProductDetailsAccordion from './components/ProductDetailsAccordion';
import ProductFormAccordion from './components/ProductFormAccordion';
import ProductFormSummary from './components/ProductFormSummary';
import ProductFormActions from './components/ProductFormActions';
import GroceryProductFields from './rubros/GroceryProductFields';
import HardwareProductFields from './rubros/HardwareProductFields';
import ProduceProductFields from './rubros/ProduceProductFields';
import ApparelProductFields from './rubros/ApparelProductFields';
import PharmacyProductFields from './rubros/PharmacyProductFields';
import RestaurantProductFields from './rubros/RestaurantProductFields';
import GeneralProductFields from './rubros/GeneralProductFields';
import './ProductFormV2.css';

const RUBRO_FIELDS = { abarrotes: GroceryProductFields, hardware: HardwareProductFields, 'verduleria/fruteria': ProduceProductFields, apparel: ApparelProductFields, farmacia: PharmacyProductFields, food_service: RestaurantProductFields, otro: GeneralProductFields };
const ERROR_ACCORDIONS = { maxStock: 'alerts', location: 'alerts', categoryId: 'details', description: 'details', expiryDate: 'specific', shelfLifeValue: 'specific', manufacturerBatchId: 'specific', quickVariants: 'specific', recipe: 'specific', expirationMode: 'specific', conversionFactor: 'specific', purchaseUnit: 'specific' };

export default function ProductFormV2({ onSave, onCancel, onDirtyChange, productToEdit, categories = [], activeRubroContext, businessTypes, features: suppliedFeatures, onOpenCategoryManager, onOpenBatches }) {
  const rubros = useMemo(() => normalizeBusinessTypes(businessTypes || activeRubroContext || productToEdit?.rubroContext), [activeRubroContext, businessTypes, productToEdit?.rubroContext]);
  const [activeRubro, setActiveRubro] = useState(() => normalizeProductRubro(productToEdit?.rubroContext || activeRubroContext || rubros[0]));
  const storeFeatures = useFeatureConfig(activeRubro);
  const features = suppliedFeatures || storeFeatures;
  const form = useProductFormV2({ activeRubro, capabilities: features, productToEdit, onSave });
  const [openAccordion, setOpenAccordion] = useState('details');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
  const [saveAnotherNotice, setSaveAnotherNotice] = useState('');
  const config = getProductRubroConfig(activeRubro);
  const RubroFields = RUBRO_FIELDS[activeRubro] || GeneralProductFields;
  const isEditing = Boolean(productToEdit?.id);
  const switchRubro = (rubro) => {
    if (isEditing) return;
    const normalized = normalizeProductRubro(rubro);
    setActiveRubro(normalized);
    form.changeRubro(normalized);
  };

  useEffect(() => { onDirtyChange?.(form.isDirty); }, [form.isDirty, onDirtyChange]);
  useEffect(() => {
    const firstError = Object.keys(form.errors.fieldErrors)[0];
    if (!firstError) return;
    setOpenAccordion(ERROR_ACCORDIONS[firstError] || 'details');
    const input = document.getElementById(`product-v2-${firstError === 'name' ? 'name' : firstError === 'price' ? 'price' : firstError === 'cost' ? 'cost' : firstError === 'stock' ? 'stock' : firstError}`);
    input?.focus?.();
  }, [form.errors]);

  const saveAndAddAnother = async () => {
    const result = await form.submit({ resetAfterSave: true });
    if (result !== false) {
      setSaveAnotherNotice(result?.message || 'Producto guardado. Puedes capturar el siguiente.');
      requestAnimationFrame(() => document.getElementById('product-v2-name')?.focus());
    }
  };

  return <form className="product-form-v2" noValidate onSubmit={(event) => { event.preventDefault(); form.submit(); }}>
    <header className="product-form-v2__header"><div><h2><PackagePlus size={23} aria-hidden="true" /> {isEditing ? 'Editar producto' : 'Nuevo producto'}</h2><p>Completa los datos principales; los ajustes avanzados son opcionales.</p></div></header>
    {!isEditing && rubros.length > 1 && <div className="product-form-v2__rubros" aria-label="Rubro del producto">{rubros.map((rubro) => <button type="button" key={rubro} className={activeRubro === rubro ? 'is-active' : ''} onClick={() => switchRubro(rubro)}>{getProductRubroConfig(rubro).label}</button>)}</div>}
    {saveAnotherNotice && <p className="product-form-v2__success" role="status">{saveAnotherNotice}</p>}
    <ProductFormSummary errors={form.errors} />
    <ProductCoreFields values={form.values} errors={form.errors.fieldErrors} onFieldChange={(field, value) => { setSaveAnotherNotice(''); form.setField(field, value); }} onCostChange={form.changeCost} onPriceChange={form.changePrice} onMarginChange={form.changeMargin} onScan={() => setIsScannerOpen(true)} isIngredient={form.values.productType === 'ingredient' || form.values.restaurantType === 'ingredient'} />
    <ProductInventoryFields values={form.values} errors={form.errors.fieldErrors} isEditing={isEditing} onTrackStock={form.setTrackStock} onFieldChange={form.setField} />
    <ProductFormAccordion id="product-v2-details" title="Imagen y organización" description="Fotografía, categoría y descripción." summary={form.values.categoryId ? 'Configurado' : 'Opcional'} isOpen={openAccordion === 'details'} onToggle={() => setOpenAccordion(openAccordion === 'details' ? null : 'details')}><ProductDetailsAccordion values={form.values} categories={categories} onFieldChange={form.setField} onImageChange={form.setImage} onOpenCategoryManager={onOpenCategoryManager} /></ProductFormAccordion>
    {form.values.trackStock && config.supports.alerts && <ProductFormAccordion id="product-v2-alerts" title="Alertas y almacenamiento" description="Existencias máximas, ubicación y proveedor." summary={form.values.location || form.values.maxStock !== '' ? 'Configurado' : 'Opcional'} isOpen={openAccordion === 'alerts'} onToggle={() => setOpenAccordion(openAccordion === 'alerts' ? null : 'alerts')}><div className="product-form-v2__field-grid"><div className="product-form-v2__field"><label htmlFor="product-v2-max-stock">Stock máximo</label><input id="product-v2-max-stock" type="number" min="0" value={form.values.maxStock} onChange={(event) => form.setField('maxStock', event.target.value)} aria-invalid={Boolean(form.errors.fieldErrors.maxStock)} />{form.errors.fieldErrors.maxStock && <small className="product-form-v2__error">{form.errors.fieldErrors.maxStock}</small>}</div><div className="product-form-v2__field"><label htmlFor="product-v2-location">Ubicación</label><input id="product-v2-location" value={form.values.location} onChange={(event) => form.setField('location', event.target.value)} /></div></div></ProductFormAccordion>}
    <ProductFormAccordion id="product-v2-specific" title={config.detailTitle} description={`Configuración específica para ${config.label.toLowerCase()}.`} summary={form.values.hasVariants ? 'Variantes' : form.values.expirationMode !== 'NONE' ? 'Configurado' : 'Opcional'} isOpen={openAccordion === 'specific'} onToggle={() => setOpenAccordion(openAccordion === 'specific' ? null : 'specific')}><RubroFields values={form.values} errors={form.errors.fieldErrors} onFieldChange={form.setField} onSaleMode={form.setSaleMode} onTrackStock={form.setTrackStock} onExpirationMode={form.setExpirationMode} onManageRecipe={() => setIsRecipeModalOpen(true)} isEditing={isEditing} productId={productToEdit?.id} onOpenBatches={() => onOpenBatches?.(productToEdit)} onBatchSummary={form.setBatchSummary} features={features} onOpenWholesale={() => setIsWholesaleModalOpen(true)} /></ProductFormAccordion>
    <ProductFormActions isSaving={form.isSaving} onCancel={onCancel} onSave={() => form.submit()} onSaveAndAddAnother={saveAndAddAnother} />
    <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={(barcode) => { form.setField('barcode', barcode); setIsScannerOpen(false); }} />
    <RecipeBuilderModal show={isRecipeModalOpen} onClose={() => setIsRecipeModalOpen(false)} existingRecipe={form.values.recipe} onSave={(recipe) => form.setField('recipe', recipe)} productName={form.values.name} />
    <WholesaleManagerModal show={isWholesaleModalOpen} onClose={() => setIsWholesaleModalOpen(false)} tiers={form.values.wholesaleTiers} onSave={(wholesaleTiers) => form.setField('wholesaleTiers', wholesaleTiers)} basePrice={Number.parseFloat(form.values.price)} />
  </form>;
}
