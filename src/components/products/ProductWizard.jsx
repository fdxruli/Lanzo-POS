import React, { useState, useEffect } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { generateID, showMessageModal } from '../../services/utils';
import ScannerModal from '../common/ScannerModal';
import QuickVariantEntry from './QuickVariantEntry';
import './ProductWizard.css';

// Pasos del asistente
const STEPS = [
  { id: 1, title: 'Identidad', icon: '📦' },
  { id: 2, title: 'Precios', icon: '💰' },
  { id: 3, title: 'Inventario', icon: '📊' },
  { id: 4, title: 'Detalles', icon: '✨' }
];

export default function ProductWizard({ onSave, onCancel, categories }) {
  const features = useFeatureConfig();
  const [step, setStep] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // --- ESTADO DEL PRODUCTO ---
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
    variants: [], 
    unit: 'pza',
    // Campos inteligentes nuevos
    isPreparedDish: false, // Para restaurantes
    prepTime: '',          // Para restaurantes
    requiresPrescription: false // Para farmacias
  });

  // Cálculo automático de margen
  const margin = data.cost && data.price 
    ? (((parseFloat(data.price) - parseFloat(data.cost)) / parseFloat(data.cost)) * 100).toFixed(0) 
    : 0;

  const handleNext = () => {
    if (step === 1 && !data.name) return showMessageModal('Escribe un nombre para continuar.');
    if (step === 2 && !data.price) return showMessageModal('El precio de venta es obligatorio.');
    setStep(prev => prev + 1);
  };

  const handleBack = () => setStep(prev => prev - 1);

  const handleFinish = () => {
    // Lógica inteligente para el tipo de venta final
    let finalSaleType = data.unit === 'pza' ? 'unit' : 'bulk';
    let finalTrackStock = data.trackStock;

    // Si es un platillo preparado (Restaurante), no controlamos stock directo al inicio
    // (se controlará después vía receta)
    if (data.isPreparedDish) {
        finalTrackStock = false; 
    }

    const finalProduct = {
      ...data,
      price: parseFloat(data.price) || 0,
      cost: parseFloat(data.cost) || 0,
      stock: parseFloat(data.stock) || 0,
      description: 'Creado con Asistente Inteligente',
      isActive: true,
      saleType: finalSaleType,
      // Guardar unidad preferida
      bulkData: { purchase: { unit: data.unit } }, 
      trackStock: finalTrackStock,
      batchManagement: { enabled: true, selectionStrategy: 'fifo' },
      
      // Campos específicos inyectados
      prepTime: data.prepTime ? parseInt(data.prepTime) : null,
      requiresPrescription: data.requiresPrescription
    };

    // Inyectamos variantes si es ropa
    if (features.hasVariants && data.variants.length > 0) {
        finalProduct.quickVariants = data.variants;
    }

    onSave(finalProduct);
  };

  // --- PASO 1: IDENTIDAD (Adaptable) ---
  const renderStep1 = () => {
    // Placeholder inteligente según rubro
    let placeholder = "Ej: Coca Cola 600ml";
    if (features.hasRecipes) placeholder = "Ej: Hamburguesa Doble, Limonada...";
    if (features.hasVariants) placeholder = "Ej: Camisa Polo, Tenis Nike...";
    if (features.hasLabFields) placeholder = "Ej: Paracetamol 500mg...";
    if (features.hasDailyPricing) placeholder = "Ej: Manzana Roja, Tomate...";

    return (
      <div className="wizard-step fade-in">
        <h3>¿Qué vamos a registrar hoy?</h3>
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

        {/* Solo mostramos escáner si NO es un platillo preparado (Restaurantes) */}
        {(!features.hasRecipes || !data.isPreparedDish) && (
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
      </div>
    );
  };

  // --- PASO 2: DINERO (Standard) ---
  const renderStep2 = () => (
    <div className="wizard-step fade-in">
      <h3>Hablemos de dinero 💰</h3>
      
      <div className="money-grid">
        <div className="form-group">
            <label>Costo {features.hasRecipes ? '(Aprox)' : 'Compra'}</label>
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
            />
        </div>
      </div>
      
      {data.cost && data.price && (
          <div className={`margin-indicator ${margin < 15 ? 'low' : 'good'}`}>
              Estás ganando un <strong>{margin}%</strong> de margen.
          </div>
      )}
    </div>
  );

  // --- PASO 3: INVENTARIO (¡El Cerebro!) ---
  const renderStep3 = () => {
    
    // A) CASO ROPA / ZAPATOS
    if (features.hasVariants) {
        return (
            <div className="wizard-step fade-in">
                <h3>Variantes y Tallas 👕</h3>
                <p className="wizard-subtitle">Agrega las tallas y colores que tienes disponibles.</p>
                <QuickVariantEntry 
                    basePrice={parseFloat(data.price)}
                    baseCost={parseFloat(data.cost)}
                    onVariantsChange={(vars) => setData({...data, variants: vars})}
                />
            </div>
        )
    }

    // B) CASO RESTAURANTE (Pregunta Clave)
    if (features.hasRecipes) {
        return (
            <div className="wizard-step fade-in">
                <h3>Tipo de Producto 🍽️</h3>
                
                <div style={{display:'flex', gap:'15px', marginBottom:'20px'}}>
                    <div 
                        className={`selection-card ${data.isPreparedDish ? 'selected' : ''}`}
                        onClick={() => setData({...data, isPreparedDish: true, trackStock: false, stock: ''})}
                    >
                        <span style={{fontSize:'2rem'}}>🍳</span>
                        <strong>Platillo Preparado</strong>
                        <small>Se cocina al momento. (Stock depende de insumos)</small>
                    </div>

                    <div 
                        className={`selection-card ${!data.isPreparedDish ? 'selected' : ''}`}
                        onClick={() => setData({...data, isPreparedDish: false, trackStock: true})}
                    >
                        <span style={{fontSize:'2rem'}}>🥤</span>
                        <strong>Producto / Bebida</strong>
                        <small>Se vende tal cual se compra. (Stock directo)</small>
                    </div>
                </div>

                {/* Si es producto directo (Coca cola), pedimos stock */}
                {!data.isPreparedDish && (
                    <div className="stock-input-container fade-in">
                        <label>Stock actual:</label>
                        <input 
                            type="number" className="form-input big-stock" placeholder="0"
                            value={data.stock} onChange={e => setData({...data, stock: e.target.value})}
                        />
                    </div>
                )}
            </div>
        );
    }

    // C) CASO GENERAL / ABARROTES / FRUTERÍA
    return (
        <div className="wizard-step fade-in">
            <h3>Inventario Inicial 📦</h3>
            
            {/* Toggle para Venta a Granel (Frutería/Ferretería) */}
            {(features.hasBulk || features.hasDailyPricing) && (
                <div className="stock-toggle">
                    <label className="switch-label">
                        <input 
                            type="checkbox" 
                            checked={data.unit !== 'pza'} 
                            onChange={e => setData({...data, unit: e.target.checked ? 'kg' : 'pza'})}
                        />
                        ¿Se vende por peso (Kilo/Granel)? ⚖️
                    </label>
                </div>
            )}

            <div className="stock-toggle">
                <label className="switch-label">
                    <input 
                        type="checkbox" 
                        checked={data.trackStock} 
                        onChange={e => setData({...data, trackStock: e.target.checked})}
                    />
                    ¿Controlar stock de este producto?
                </label>
            </div>

            {data.trackStock && (
                <div className="stock-input-container">
                    <label>¿Cuántos tienes?</label>
                    <input 
                        type="number" className="form-input big-stock" placeholder="0"
                        value={data.stock} onChange={e => setData({...data, stock: e.target.value})}
                    />
                    <div className="stock-unit-selector">
                        <span>Unidad:</span>
                        <select value={data.unit} onChange={e => setData({...data, unit: e.target.value})}>
                            <option value="pza">Pieza (Unidad)</option>
                            <option value="kg">Kilogramo (kg)</option>
                            <option value="lt">Litro (L)</option>
                            <option value="mt">Metro (m)</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
  };

  // --- PASO 4: DETALLES (Personalizados) ---
  const renderStep4 = () => (
    <div className="wizard-step fade-in">
        <h3>Últimos detalles ✨</h3>
        
        {/* FARMACIA: Checkbox controlado */}
        {features.hasLabFields && (
            <div className="alert-config-box" style={{borderColor: 'var(--error-color)', backgroundColor:'#fff5f5'}}>
                <label className="switch-label">
                    <input 
                        type="checkbox" 
                        checked={data.requiresPrescription} 
                        onChange={e => setData({...data, requiresPrescription: e.target.checked})}
                    />
                    <span style={{color:'var(--error-color)', fontWeight:'bold'}}>⚠️ Requiere Receta Médica</span>
                </label>
                <small style={{display:'block', marginTop:'5px', color:'#666'}}>Para antibióticos o controlados.</small>
            </div>
        )}

        {/* RESTAURANTE: Tiempo de preparación */}
        {features.hasRecipes && data.isPreparedDish && (
             <div className="form-group">
                <label>⏱️ Tiempo de Preparación (minutos)</label>
                <input 
                    type="number" className="form-input" placeholder="Ej: 15"
                    value={data.prepTime} onChange={e => setData({...data, prepTime: e.target.value})}
                />
             </div>
        )}

        {/* GENERAL: Stock Mínimo */}
        {(data.trackStock || (!features.hasRecipes && !features.hasVariants)) && (
            <div className="form-group">
                <label>Avísame cuando queden menos de:</label>
                <input 
                    type="number" className="form-input" 
                    value={data.minStock} onChange={e => setData({...data, minStock: e.target.value})}
                />
            </div>
        )}

        <div className="summary-card">
            <h4>Resumen:</h4>
            <p><strong>{data.name}</strong></p>
            <p>Precio: ${data.price}</p>
            {data.isPreparedDish ? (
                <p style={{color:'var(--secondary-color)'}}>🥘 Platillo de Cocina</p>
            ) : (
                <p>Stock Inicial: {features.hasVariants ? 'Según Variantes' : (data.stock || 0)} {data.unit}</p>
            )}
        </div>
    </div>
  );

  return (
    <div className="product-wizard-container">
      <div className="wizard-header">
        {STEPS.map((s, idx) => (
            <div key={s.id} className={`step-indicator ${step === s.id ? 'active' : ''} ${step > s.id ? 'completed' : ''}`}>
                <div className="step-icon">{step > s.id ? '✓' : s.icon}</div>
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
            <button className="btn btn-secondary" onClick={handleBack}>Atrás</button>
        ) : (
            <button className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
        )}

        {step < 4 ? (
            <button className="btn btn-primary" onClick={handleNext}>Siguiente ➝</button>
        ) : (
            <button className="btn btn-save" onClick={handleFinish}>¡Guardar Producto! 🎉</button>
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