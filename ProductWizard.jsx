import React, { useState, useMemo } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { generateID, showMessageModal } from '../../services/utils';
import ScannerModal from '../common/ScannerModal';
import QuickVariantEntry from './QuickVariantEntry';
import { ChevronRight, ArrowLeft, Check, Package, Shirt, ChefHat, Tag, Scale } from 'lucide-react';
import './ProductWizard.css';

// Pasos dinámicos
const STEPS = [
  { id: 1, title: 'Tipo', icon: <Tag size={20} /> },
  { id: 2, title: 'Datos', icon: <Package size={20} /> },
  { id: 3, title: 'Precio', icon: '$' },
  { id: 4, title: 'Stock', icon: '#' }
];

export default function ProductWizard({ onSave, onCancel, categories }) {
  const features = useFeatureConfig();
  const [step, setStep] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // --- 1. DEFINIR ESTRATEGIA INICIAL (INTELIGENCIA) ---
  // Clasificamos el ítem desde el inicio para adaptar los siguientes pasos
  const [wizardStrategy, setWizardStrategy] = useState('standard'); 
  // Opciones: 'standard', 'dish' (restaurante), 'apparel' (ropa), 'bulk' (peso)

  const [data, setData] = useState({
    id: generateID('prod'),
    name: '',
    barcode: '',
    categoryId: '',
    cost: '',
    price: '',
    stock: '', 
    minStock: 5,
    trackStock: true,
    productType: 'sellable', 
    unit: 'pza',
    
    // Ropa
    variants: [], 
    
    // Restaurante
    isPreparedDish: false, 
    prepTime: '',
    
    // Farmacia
    requiresPrescription: false
  });

  // Cálculo de margen
  const margin = useMemo(() => {
    const c = parseFloat(data.cost);
    const p = parseFloat(data.price);
    if (!c || !p) return 0;
    return (((p - c) / c) * 100).toFixed(0);
  }, [data.cost, data.price]);

  // --- LOGICA DE NAVEGACIÓN ---
  const handleNext = () => {
    // Validaciones por paso
    if (step === 2 && !data.name) return showMessageModal('El nombre es obligatorio.', null, {type:'error'});
    if (step === 3 && !data.price) return showMessageModal('El precio de venta es obligatorio.', null, {type:'error'});
    
    // Salto Inteligente: Si es Ropa o Platillo, el paso 4 es diferente
    setStep(prev => prev + 1);
  };

  const handleBack = () => setStep(prev => prev - 1);

  const handleFinish = () => {
    // Construcción inteligente del objeto final
    let finalSaleType = 'unit';
    if (wizardStrategy === 'bulk') finalSaleType = 'bulk';

    let finalTrackStock = true;
    let finalBatchManagement = { enabled: true, selectionStrategy: 'fifo' };

    // Caso Restaurante (Platillo)
    if (wizardStrategy === 'dish') {
        finalTrackStock = false; // El stock se calcula por receta, no directo
        finalBatchManagement.enabled = false;
    }

    // Caso Ropa
    if (wizardStrategy === 'apparel') {
        finalTrackStock = true; // Se trackea, pero a través de variantes
    }

    const finalProduct = {
      ...data,
      price: parseFloat(data.price) || 0,
      cost: parseFloat(data.cost) || 0,
      stock: parseFloat(data.stock) || 0,
      description: 'Creado con Asistente Inteligente',
      isActive: true,
      saleType: finalSaleType,
      bulkData: { purchase: { unit: data.unit } },
      trackStock: finalTrackStock,
      batchManagement: finalBatchManagement,
      productType: 'sellable', // Siempre vendible desde el wizard
      
      // Limpieza de campos
      prepTime: data.prepTime ? parseInt(data.prepTime) : null,
    };

    // Inyectar variantes si es ropa
    if (wizardStrategy === 'apparel' && data.variants.length > 0) {
        finalProduct.quickVariants = data.variants;
    }

    onSave(finalProduct);
  };

  // ==========================================
  // PASO 1: SELECCIÓN DE ESTRATEGIA (CEREBRO)
  // ==========================================
  const renderStep1 = () => {
    return (
      <div className="wizard-step">
        <h3>¿Qué vas a agregar?</h3>
        <p className="wizard-subtitle">Selecciona el tipo para adaptar el formulario a tus necesidades.</p>

        <div className="selection-grid">
            
            {/* OPCIÓN 1: PRODUCTO ESTÁNDAR (Siempre disponible) */}
            <div 
                className={`selection-card ${wizardStrategy === 'standard' ? 'selected' : ''}`}
                onClick={() => {
                    setWizardStrategy('standard');
                    setData({...data, unit: 'pza', isPreparedDish: false});
                }}
            >
                <div className="selection-emoji">🥤</div>
                <div className="selection-title">Producto Unitario</div>
                <div className="selection-desc">Refrescos, Sabritas, Electrónicos. Se compra y se vende por pieza.</div>
            </div>

            {/* OPCIÓN 2: RESTAURANTE (Solo si tiene features) */}
            {features.hasRecipes && (
                <div 
                    className={`selection-card ${wizardStrategy === 'dish' ? 'selected' : ''}`}
                    onClick={() => {
                        setWizardStrategy('dish');
                        setData({...data, unit: 'pza', isPreparedDish: true, trackStock: false});
                    }}
                >
                    <div className="selection-emoji">🍔</div>
                    <div className="selection-title">Platillo Preparado</div>
                    <div className="selection-desc">Hamburguesa, Taco, Café. Se prepara en cocina. (Sin stock directo).</div>
                </div>
            )}

            {/* OPCIÓN 3: ROPA / CALZADO */}
            {features.hasVariants && (
                <div 
                    className={`selection-card ${wizardStrategy === 'apparel' ? 'selected' : ''}`}
                    onClick={() => {
                        setWizardStrategy('apparel');
                        setData({...data, unit: 'pza'});
                    }}
                >
                    <div className="selection-emoji">👕</div>
                    <div className="selection-title">Ropa / Calzado</div>
                    <div className="selection-desc">Tiene Tallas y Colores. Gestionaremos una matriz de inventario.</div>
                </div>
            )}

            {/* OPCIÓN 4: A GRANEL (Frutería/Ferretería) */}
            {(features.hasBulk || features.hasDailyPricing) && (
                <div 
                    className={`selection-card ${wizardStrategy === 'bulk' ? 'selected' : ''}`}
                    onClick={() => {
                        setWizardStrategy('bulk');
                        setData({...data, unit: 'kg'});
                    }}
                >
                    <div className="selection-emoji">⚖️</div>
                    <div className="selection-title">A Granel / Peso</div>
                    <div className="selection-desc">Frutas, Verduras, Clavos, Cemento. Se vende por Kilo, Litro o Metro.</div>
                </div>
            )}
        </div>
      </div>
    );
  };

  // ==========================================
  // PASO 2: DATOS BÁSICOS
  // ==========================================
  const renderStep2 = () => {
    let placeholder = "Ej: Coca Cola 600ml";
    if (wizardStrategy === 'dish') placeholder = "Ej: Enchiladas Suizas";
    if (wizardStrategy === 'apparel') placeholder = "Ej: Camisa Polo Nike";
    if (wizardStrategy === 'bulk') placeholder = "Ej: Tomate Saladette";

    return (
      <div className="wizard-step">
        <h3>Identidad del Producto</h3>
        
        <div className="form-group">
          <label>Nombre del Producto *</label>
          <input 
            className="form-input big-input" 
            autoFocus
            placeholder={placeholder}
            value={data.name}
            onChange={e => setData({...data, name: e.target.value})}
          />
        </div>

        {/* El escáner solo tiene sentido para productos físicos con código */}
        {wizardStrategy !== 'dish' && (
            <div className="form-group">
                <label>Código de Barras (Opcional)</label>
                <div className="input-with-button">
                    <input 
                        className="form-input" 
                        placeholder="Escanea o escribe..."
                        value={data.barcode}
                        onChange={e => setData({...data, barcode: e.target.value})}
                    />
                    <button className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                </div>
            </div>
        )}

        <div className="form-group">
          <label>Categoría</label>
          <div className="category-pills">
              {categories.map(cat => (
                  <button 
                      key={cat.id}
                      className={`cat-pill ${data.categoryId === cat.id ? 'active' : ''}`}
                      onClick={() => setData({...data, categoryId: cat.id})}
                  >
                      {cat.name}
                  </button>
              ))}
          </div>
        </div>

        {/* Campos Extra Específicos */}
        {wizardStrategy === 'dish' && (
             <div className="form-group" style={{marginTop: '20px'}}>
                <label>⏱️ Tiempo de Preparación (min)</label>
                <input 
                    type="number" className="form-input" placeholder="Ej: 15"
                    value={data.prepTime} onChange={e => setData({...data, prepTime: e.target.value})}
                    style={{textAlign:'center'}}
                />
             </div>
        )}

        {/* Checkbox Farmacia (Siempre visible si tiene feature activada) */}
        {features.hasLabFields && (
            <div className="form-group-checkbox" style={{marginTop:'20px', backgroundColor: '#fff1f2', padding:'10px', borderRadius:'8px', border:'1px solid #fecdd3'}}>
                <input 
                    type="checkbox" 
                    checked={data.requiresPrescription}
                    onChange={e => setData({...data, requiresPrescription: e.target.checked})}
                    id="req-pres"
                />
                <label htmlFor="req-pres" style={{color:'#be123c', fontWeight:'bold'}}>Requiere Receta Médica (Antibiótico)</label>
            </div>
        )}
      </div>
    );
  };

  // ==========================================
  // PASO 3: PRECIOS (Con Feedback)
  // ==========================================
  const renderStep3 = () => (
    <div className="wizard-step">
      <h3>Definir Precios 💰</h3>
      
      <div className="money-grid">
        <div className="form-group">
            <label>Costo {wizardStrategy === 'dish' ? '(Insumos)' : 'Compra'}</label>
            <input 
                type="number" className="form-input" placeholder="0.00"
                value={data.cost} onChange={e => setData({...data, cost: e.target.value})}
            />
        </div>
        <div className="arrow-separator">➡️</div>
        <div className="form-group highlight">
            <label>Precio Venta *</label>
            <input 
                type="number" className="form-input big-price" placeholder="0.00"
                value={data.price} onChange={e => setData({...data, price: e.target.value})}
                autoFocus
            />
        </div>
      </div>
      
      {data.cost && data.price && (
          <div className={`margin-indicator ${margin < 15 ? 'bad' : margin < 30 ? 'warn' : 'good'}`}>
              {margin < 15 ? '⚠️ Margen muy bajo' : margin < 30 ? '⚠️ Margen aceptable' : '✅ Excelente margen'}
              <span>({margin}%)</span>
          </div>
      )}

      {wizardStrategy === 'bulk' && (
          <div style={{textAlign:'center', marginTop:'15px', color:'var(--text-light)', fontSize:'0.9rem'}}>
              El precio es por <strong>1 {data.unit.toUpperCase()}</strong>.
          </div>
      )}
    </div>
  );

  // ==========================================
  // PASO 4: STOCK / VARIANTES (El más diverso)
  // ==========================================
  const renderStep4 = () => {
    
    // A) ROPA: MATRIZ DE TALLAS
    if (wizardStrategy === 'apparel') {
        return (
            <div className="wizard-step">
                <h3>Variantes Disponibles 👕</h3>
                <p style={{textAlign:'center', marginBottom:'10px', color:'#666'}}>
                    Registra qué tallas y colores tienes ahora mismo.
                </p>
                <QuickVariantEntry 
                    basePrice={parseFloat(data.price)}
                    baseCost={parseFloat(data.cost)}
                    onVariantsChange={(vars) => setData({...data, variants: vars})}
                />
            </div>
        );
    }

    // B) PLATILLO: NO HAY STOCK (Explain why)
    if (wizardStrategy === 'dish') {
        return (
            <div className="wizard-step" style={{textAlign:'center'}}>
                <h3>🧑‍🍳 ¡Todo listo!</h3>
                <div style={{fontSize:'4rem', margin:'20px 0'}}>🥘</div>
                <p>
                    Al ser un <strong>Platillo Preparado</strong>, no registras stock directo aquí.
                </p>
                <p style={{color:'var(--text-light)', fontSize:'0.9rem', marginTop:'10px'}}>
                    Después de guardar, podrás configurar la <strong>Receta</strong> para descontar ingredientes (pan, carne, queso) automáticamente al vender.
                </p>
            </div>
        );
    }

    // C) ESTÁNDAR / GRANEL: STOCK SIMPLE
    return (
        <div className="wizard-step">
            <h3>Inventario Inicial 📦</h3>
            
            <div className="stock-input-container">
                <div style={{flex:1}}>
                    <label style={{display:'block', marginBottom:'10px', fontWeight:'bold', color:'var(--text-dark)'}}>
                        ¿{wizardStrategy === 'bulk' ? `Cuántos ${data.unit}s tienes?` : 'Cantidad disponible'}
                    </label>
                    <input 
                        type="number" className="form-input big-stock" placeholder="0"
                        value={data.stock} onChange={e => setData({...data, stock: e.target.value})}
                        autoFocus
                    />
                </div>
            </div>

            <div className="form-group" style={{marginTop:'30px'}}>
                <label>🔔 Avísame cuando queden menos de:</label>
                <input 
                    type="number" className="form-input" 
                    value={data.minStock} onChange={e => setData({...data, minStock: e.target.value})}
                    style={{textAlign:'center', width:'100px', margin:'0 auto', display:'block'}}
                />
            </div>
        </div>
    );
  };

  return (
    <div className="product-wizard-container">
      <div className="wizard-header">
        {STEPS.map((s, idx) => (
            <div key={s.id} className={`step-indicator ${step === s.id ? 'active' : ''} ${step > s.id ? 'completed' : ''}`}>
                <div className="step-icon">{step > s.id ? <Check size={18} /> : s.icon}</div>
                <span className="step-label">{s.title}</span>
                {idx < STEPS.length - 1 && <div className="step-line"></div>}
            </div>
        ))}
      </div>

      <div className="wizard-content">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      <div className="wizard-footer">
        {step > 1 ? (
            <button className="btn btn-secondary" onClick={handleBack}>
                <ArrowLeft size={16} /> Atrás
            </button>
        ) : (
            <button className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
        )}

        {step < 4 ? (
            <button className="btn btn-primary" onClick={handleNext}>
                Siguiente <ChevronRight size={16} />
            </button>
        ) : (
            <button className="btn btn-save" onClick={handleFinish}>
                💾 Guardar Producto
            </button>
        )}
      </div>

      <ScannerModal 
        show={isScannerOpen} 
        onClose={() => setIsScannerOpen(false)} 
        onScanSuccess={(code) => { setData({...data, barcode: code}); setIsScannerOpen(false); }} 
      />
    </div>
  );
}