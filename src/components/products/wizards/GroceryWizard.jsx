// src/components/products/wizards/GroceryWizard.jsx
import React, { useState, useMemo } from 'react';
import { useProductLogic } from '../../../hooks/useProductLogic';
import { useFeatureConfig } from '../../../hooks/useFeatureConfig';
import { 
    Barcode, ArrowLeft, Check, ChevronRight, Scale, Box, 
    FileText, Users, ChevronDown, ChevronUp, Trash2, Plus, AlertTriangle
} from 'lucide-react';
import ScannerModal from '../../common/ScannerModal';
import FarmaciaFields from '../fieldsets/FarmaciaFIelds';
import '../ProductWizard.css';
import { showMessageModal } from '../../../services/utils';

export default function GroceryWizard({ onSave, onCancel, categories, mainRubro }) {
    const { data, setField, updatePriceLogic } = useProductLogic({ trackStock: true });
    const { hasExpiry, hasWholesale, hasLabFields } = useFeatureConfig();

    const [step, setStep] = useState(1);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [margin, setMargin] = useState(''); 
    const [showWholesale, setShowWholesale] = useState(false);

    // Helpers
    const categoryName = useMemo(() => {
        if (!data.categoryId) return 'General';
        const cat = categories.find(c => c.id == data.categoryId);
        return cat ? cat.name : 'Desconocida';
    }, [data.categoryId, categories]);

    // Lógica de Margen (Recalcula Precio basado en Costo + %)
    const handleCostChange = (val) => {
        updatePriceLogic('cost', val);
        if (val && margin) {
            const cost = parseFloat(val);
            const price = cost * (1 + (parseFloat(margin) / 100));
            updatePriceLogic('price', price.toFixed(2));
        }
    };

    const handleMarginChange = (val) => {
        setMargin(val);
        if (data.cost && val) {
            const cost = parseFloat(data.cost);
            const price = cost * (1 + (parseFloat(val) / 100));
            updatePriceLogic('price', price.toFixed(2));
        }
    };

    const handlePriceChange = (val) => {
        updatePriceLogic('price', val);
        // Si cambia el precio manual, recalculamos el margen inverso
        if (data.cost && val) {
            const cost = parseFloat(data.cost);
            const price = parseFloat(val);
            if (cost > 0) {
                const newMargin = ((price - cost) / cost) * 100;
                setMargin(newMargin.toFixed(1));
            }
        }
    };

    // Validación "Next Step"
    const validateStep = (currentStep) => {
        if (currentStep === 2) {
            if (!data.name) { showMessageModal('El nombre es obligatorio'); return false; }
        }
        if (currentStep === 3) {
            const price = parseFloat(data.price) || 0;
            const cost = parseFloat(data.cost) || 0;

            if (price <= 0) { showMessageModal('Define un precio de venta válido'); return false; }
            
            // Critical Loss Check
            if (cost > 0 && price < cost) {
                if(!window.confirm(`⚠️ ADVERTENCIA DE PÉRDIDA\n\nEl precio ($${price}) es menor al costo ($${cost}).\n¿Seguro que deseas continuar?`)) return false;
            }

            // Wholesale Integrity Check
            if (data.wholesaleTiers?.length > 0 && cost > 0) {
                const badTier = data.wholesaleTiers.find(t => parseFloat(t.price) < cost);
                if (badTier) {
                    if(!window.confirm(`⚠️ ERROR EN MAYOREO\n\nTienes un precio de mayoreo ($${badTier.price}) por debajo del costo ($${cost}).\n¿Deseas permitirlo?`)) return false;
                }
            }
        }
        return true;
    };

    // CRUD Mayoreo Simple
    const addWholesaleTier = () => {
        const currentTiers = data.wholesaleTiers || [];
        setField('wholesaleTiers', [...currentTiers, { min: 0, price: 0 }]);
    };
    
    const updateWholesaleTier = (index, field, value) => {
        const newTiers = [...(data.wholesaleTiers || [])];
        newTiers[index][field] = value;
        setField('wholesaleTiers', newTiers);
    };

    const removeWholesaleTier = (index) => {
        const newTiers = [...(data.wholesaleTiers || [])];
        newTiers.splice(index, 1);
        setField('wholesaleTiers', newTiers);
    };

    // ... (Steps 1, 2 son idénticos al original, solo cambio Step 3 y 4) ...

    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
             <div className="wizard-welcome">
                <div className="main-icon-circle bg-blue-100 text-blue-600">
                    <Barcode size={40} />
                </div>
                <h3>Alta Rápida</h3>
                <p>Comencemos escaneando el producto.</p>
            </div>
            <div className="scan-focus-area" style={{marginBottom: '20px'}}>
                <div className="input-with-button">
                    <input 
                        className="form-input big-input text-center" 
                        placeholder="Escanea o escribe código..."
                        value={data.barcode}
                        onChange={e => setField('barcode', e.target.value.trim())} // Sanitización básica
                        onKeyDown={(e) => e.key === 'Enter' && setStep(2)}
                        autoFocus
                    />
                    <button className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                </div>
            </div>
             <div className="selection-grid mini-grid">
                <div 
                    className={`selection-card ${data.saleType === 'unit' ? 'selected' : ''}`}
                    onClick={() => { setField('saleType', 'unit'); setField('unit', 'pza'); }}
                >
                    <div className="selection-icon"><Box size={20}/></div>
                    <div className="selection-title">Por Pieza</div>
                </div>
                <div 
                    className={`selection-card ${data.saleType === 'bulk' ? 'selected' : ''}`}
                    onClick={() => { setField('saleType', 'bulk'); setField('unit', 'kg'); }}
                >
                    <div className="selection-icon"><Scale size={20}/></div>
                    <div className="selection-title">A Granel (Kg/Lt)</div>
                </div>
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Datos del Producto</h3>
            <div className="form-group">
                <label>Nombre Comercial *</label>
                <input 
                    className="form-input big-input" 
                    placeholder="Ej: Coca Cola 600ml"
                    value={data.name} 
                    onChange={e => setField('name', e.target.value)} 
                    autoFocus
                />
            </div>
            <div className="form-group">
                <label>Categoría</label>
                <select className="form-input" value={data.categoryId} onChange={e => setField('categoryId', e.target.value)}>
                    <option value="">-- General --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
             {hasExpiry && (
                <div className="form-group" style={{marginTop:'10px'}}>
                    <label>Caducidad (Opcional)</label>
                    <input type="date" className="form-input" value={data.expiryDate || ''} onChange={e => setField('expiryDate', e.target.value)} />
                </div>
            )}
             {/* Farmacia Fields se mantendrían igual si rubro=='farmacia' */}
        </div>
    );

    const renderStep3 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Precios e Inventario</h3>
            
            <div className="money-row">
                <div className="form-group">
                    <label>Costo Compra</label>
                    <div className="input-with-prefix">
                        <span>$</span>
                        <input type="number" className="form-input" value={data.cost} onChange={e => handleCostChange(e.target.value)} placeholder="0.00" />
                    </div>
                </div>

                <div className="form-group small-group">
                    <label style={{color: '#2563eb'}}>Margen %</label>
                    <div className="input-with-prefix">
                        <span style={{color:'#2563eb'}}>%</span>
                        <input type="number" className="form-input" style={{color:'#2563eb', fontWeight:'bold'}} value={margin} onChange={e => handleMarginChange(e.target.value)} placeholder="25" />
                    </div>
                </div>

                <div className="form-group">
                    <label>Precio Venta</label>
                    <div className="input-with-prefix">
                        <span>$</span>
                        <input 
                            type="number" 
                            className={`form-input big-price-input ${parseFloat(data.price) < parseFloat(data.cost) ? 'input-error' : ''}`}
                            value={data.price} 
                            onChange={e => handlePriceChange(e.target.value)} 
                            placeholder="0.00" 
                        />
                    </div>
                    {parseFloat(data.price) < parseFloat(data.cost) && (
                        <small style={{color:'red', display:'block'}}>⚠️ Menor al costo</small>
                    )}
                </div>
            </div>

            <div className="stock-wizard-card" style={{marginTop: '15px'}}>
                <div className="form-group">
                    <label>Stock Inicial ({data.unit})</label>
                    <input type="number" className="form-input" value={data.stock} onChange={e => setField('stock', e.target.value)} />
                </div>
            </div>

            {hasWholesale && (
                <div className="wholesale-section-wizard mt-4 border border-indigo-100 rounded-lg overflow-hidden">
                    <button 
                        className="w-full flex items-center justify-between p-3 bg-indigo-50 text-indigo-700"
                        onClick={() => setShowWholesale(!showWholesale)}
                    >
                        <div className="flex items-center gap-2 font-medium">
                            <Users size={18} />
                            <span>Precios de Mayoreo {data.wholesaleTiers?.length > 0 && `(${data.wholesaleTiers.length})`}</span>
                        </div>
                        {showWholesale ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                    </button>

                    {showWholesale && (
                        <div className="p-3 bg-white animate-fade-in">
                            {data.wholesaleTiers?.map((tier, idx) => {
                                const isBelowCost = parseFloat(tier.price) < parseFloat(data.cost);
                                return (
                                    <div key={idx} className="flex items-center gap-2 mb-2">
                                        <div className="flex-1">
                                            <input type="number" className="form-input h-8 text-sm" placeholder="Cant. Min" value={tier.min} onChange={e => updateWholesaleTier(idx, 'min', e.target.value)} />
                                        </div>
                                        <div className="flex-1">
                                            <input 
                                                type="number" 
                                                className={`form-input h-8 text-sm ${isBelowCost ? 'border-red-500 bg-red-50' : ''}`} 
                                                placeholder="$ Precio" 
                                                value={tier.price} 
                                                onChange={e => updateWholesaleTier(idx, 'price', e.target.value)} 
                                            />
                                        </div>
                                        <button className="text-red-400 hover:text-red-600" onClick={() => removeWholesaleTier(idx)}><Trash2 size={16} /></button>
                                    </div>
                                );
                            })}
                            <button className="mt-2 w-full py-2 border border-dashed border-indigo-300 text-indigo-500 rounded text-sm hover:bg-indigo-50" onClick={addWholesaleTier}>
                                + Agregar Rango
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderStep4 = () => (
        <div className="wizard-step animate-fade-in">
             <div className="wizard-welcome">
                <div className="main-icon-circle bg-green-100 text-green-600">
                    <FileText size={40} />
                </div>
                <h3>¡Todo Listo!</h3>
                <p>Revisa antes de guardar.</p>
            </div>
            
            <div className="summary-card bg-slate-50 border border-slate-200 rounded-xl p-5 text-left mt-2">
                 <div className="flex justify-between items-start border-b border-dashed border-slate-300 pb-4 mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 m-0">{data.name}</h2>
                        <span className="text-xs text-slate-500">{data.barcode || 'Sin Código'}</span>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-slate-500 block">Precio Venta</span>
                        <strong className="text-2xl text-emerald-600">${parseFloat(data.price).toFixed(2)}</strong>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong className="text-slate-500">Costo:</strong> ${parseFloat(data.cost || 0).toFixed(2)}</div>
                    <div><strong className="text-slate-500">Margen:</strong> {margin}%</div>
                    <div><strong className="text-slate-500">Stock:</strong> {data.stock} {data.unit}</div>
                    <div><strong className="text-slate-500">Categoría:</strong> {categoryName}</div>
                </div>

                {data.wholesaleTiers?.length > 0 && (
                     <div className="mt-3 pt-3 border-t border-slate-200">
                        <strong className="text-xs text-slate-500 block">Mayoreo:</strong>
                        <div className="flex gap-2 flex-wrap mt-1">
                             {data.wholesaleTiers.map((t,i) => (
                                 <span key={i} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                                     {t.min}+ pzas: ${t.price}
                                 </span>
                             ))}
                        </div>
                     </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="product-wizard-container theme-retail">
            <div className="wizard-progress-bar">
                {[1, 2, 3, 4].map(s => (
                    <div key={s} className={`progress-dot ${step >= s ? 'active' : ''} bg-blue-500`}>
                        {step > s ? <Check size={12} /> : s}
                    </div>
                ))}
            </div>

            <div className="wizard-main-content">
                {step === 1 && renderStep1()}
                {step === 2 && renderStep2()}
                {step === 3 && renderStep3()}
                {step === 4 && renderStep4()}
            </div>

            <div className="wizard-actions">
                {step > 1 ? (
                    <button className="btn btn-secondary" onClick={() => setStep(step - 1)}><ArrowLeft size={16}/> Atrás</button>
                ) : (
                    <button className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
                )}

                {step < 4 ? (
                    <button className="btn btn-primary bg-blue-600 hover:bg-blue-700" onClick={() => {
                        if (validateStep(step)) setStep(step + 1);
                    }}>
                        Siguiente <ChevronRight size={16}/>
                    </button>
                ) : (
                    <button className="btn btn-save pulse bg-green-600" onClick={() => onSave(data)}>✅ Guardar</button>
                )}
            </div>
            
            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={code => { setField('barcode', code); setIsScannerOpen(false); }} />
        </div>
    );
}