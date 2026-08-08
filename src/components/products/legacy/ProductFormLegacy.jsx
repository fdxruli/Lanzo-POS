import { useMemo, useState } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { useFeatureConfig } from '../../../hooks/useFeatureConfig';
import { useProductWizard } from '../../../hooks/useProductWizard';
import RestaurantProductForm from '../forms/RestaurantProductForm.jsx';
import PharmacyProductForm from '../forms/PharmacyProductForm';
import RetailProductForm from '../forms/RetailProductForm';
import ProductFormWizard from '../wizard/ProductFormWizard';
import '../ProductForm.css';

const RUBRO_LABELS = {
  food_service: 'Restaurante / Cocina', abarrotes: 'Abarrotes / Tienda', farmacia: 'Farmacia',
  'verduleria/fruteria': 'Frutería', apparel: 'Ropa y Accesorios', hardware: 'Ferretería', otro: 'General'
};

/** Kept intact as the private, technical rollback implementation. */
export default function ProductFormLegacy({ businessTypes, ...props }) {
  const [isExpertMode, setIsExpertMode] = useState(false);
  const globalBusinessTypes = useMemo(() => Array.isArray(businessTypes) && businessTypes.length ? businessTypes : ['otro'], [businessTypes]);
  const initialContext = useMemo(() => {
    const savedContext = props.productToEdit?.rubroContext;
    return savedContext && globalBusinessTypes.includes(savedContext) ? savedContext : (globalBusinessTypes[0] || 'otro');
  }, [props.productToEdit, globalBusinessTypes]);
  const [activeRubroContext, setActiveRubroContext] = useState(initialContext);
  const features = useFeatureConfig(activeRubroContext);
  const wizard = useProductWizard(props.productToEdit, activeRubroContext);
  const ModeIcon = isExpertMode ? SlidersHorizontal : Sparkles;
  const showRubroSelector = !props.productToEdit && globalBusinessTypes.length > 1;

  const form = props.productToEdit || isExpertMode
    ? ({ food_service: RestaurantProductForm, restaurante: RestaurantProductForm, cafeteria: RestaurantProductForm, farmacia: PharmacyProductForm, consultorio: PharmacyProductForm }[activeRubroContext] || RetailProductForm)
    : ProductFormWizard;
  const Form = form;

  return <div className="product-form-container">
    <div className="product-form-header"><h3 className="subtitle product-form-title">{props.productToEdit ? `Editar: ${props.productToEdit.name}` : 'Añadir Nuevo Producto'}</h3>
      {!props.productToEdit && <div className="product-form-mode-toggle" aria-label="Modo de registro de producto"><button type="button" onClick={() => setIsExpertMode(false)} className={`product-form-mode-button ${!isExpertMode ? 'is-active' : ''}`}><Sparkles size={16} aria-hidden="true" />Asistido</button><button type="button" onClick={() => setIsExpertMode(true)} className={`product-form-mode-button ${isExpertMode ? 'is-active' : ''}`}><SlidersHorizontal size={16} aria-hidden="true" />Experto</button></div>}
    </div>
    {!props.productToEdit && <div className={`product-form-mode-note ${isExpertMode ? 'is-expert' : ''}`}><span className="product-form-mode-icon" aria-hidden="true"><ModeIcon size={18} /></span><p className="product-form-mode-copy">{isExpertMode ? 'Modo experto: todos los campos y opciones avanzadas disponibles.' : 'Modo asistido: te guiamos paso a paso para registrar tu producto rápidamente.'}</p></div>}
    {showRubroSelector && <div className="context-selector"><label className="context-selector-label">¿A qué área pertenece este producto?</label><div className="context-selector-options">{globalBusinessTypes.map((rubro) => <button key={rubro} type="button" onClick={() => setActiveRubroContext(rubro)} className={`context-selector-button ${activeRubroContext === rubro ? 'is-active' : ''}`}>{RUBRO_LABELS[rubro] || rubro}</button>)}</div></div>}
    {Form === ProductFormWizard ? <Form wizard={wizard} categories={props.categories} onOpenCategoryManager={props.onOpenCategoryManager} activeRubroContext={activeRubroContext} onSave={props.onSave} onCancel={props.onCancel} productToEdit={props.productToEdit} /> : <Form {...props} activeRubroContext={activeRubroContext} features={features} />}
  </div>;
}
