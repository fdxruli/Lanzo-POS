// src/components/products/wizards/GroceryWizard.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useProductLogic } from '../../../hooks/useProductLogic';
import { useFeatureConfig } from '../../../hooks/useFeatureConfig';
import { 
    Barcode, ArrowLeft, Check, ChevronRight, Scale, Box, 
    FileText, Users, ChevronDown, ChevronUp, Trash2, ShieldAlert, Pill, AlertTriangle
} from 'lucide-react';
import ScannerModal from '../../common/ScannerModal';
import '../ProductWizard.css'; // Asegúrate de que este CSS exista o usa estilos en línea como fallback
import { showMessageModal } from '../../../services/utils';

export default function GroceryWizard({ onSave, onCancel, categories, mainRubro }) {
    // 1. OBTENER CONFIGURACIÓN DEL RUBRO ACTUAL
    // 'hasBulk' nos dice si este negocio permite venta a granel.
    const { 
        hasExpiry, 
        hasWholesale, 
        hasBulk, 
        activeRubros 
    } = useFeatureConfig(mainRubro);

    // LÓGICA INTELIGENTE: Si el negocio NO tiene 'bulk' (ej. Farmacia, Ropa), forzamos modo Unitario.
    const forceUnitMode = !hasBulk;
    const isPharmacy = activeRubros.includes('farmacia');

    // 2. INICIALIZAR LÓGICA CON RESTRICCIONES
    // Si forceUnitMode es true, inicializamos directamente como 'unit'/'pza'.
    const { data, setField, updatePriceLogic } = useProductLogic({ 
        trackStock: true,
        saleType: forceUnitMode ? 'unit' : 'unit', 
        unit: forceUnitMode ? 'pza' : 'pza'
    });

    const [step, setStep] = useState(1);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [margin, setMargin] = useState(''); 
    const [showWholesale, setShowWholesale] = useState(false);

    // Helpers UI
    const categoryName = useMemo(() => {
        if (!data.categoryId) return 'General';
        const cat = categories.find(c => c.id == data.categoryId);
        return cat ? cat.name : 'Desconocida';
    }, [data.categoryId, categories]);

    // --- MANEJO DE PRECIOS AUTOMÁTICO ---
    const handleCostChange = (val) => {
        updatePriceLogic('cost', val);
        // UX: Si ya hay margen definido, actualizar precio en tiempo real
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

    // --- VALIDACIÓN ESTRICTA (HARDENING) ---
    const validateStep = (currentStep) => {
        // PASO 1: Validación básica (usualmente el código de barras es opcional, pero si lo ponen, ok)
        if (currentStep === 1) {
            // Si quieres obligar a tener código, descomenta esto:
            // if (!data.barcode) { showMessageModal('El código es recomendado.'); return true; } 
        }

        // PASO 2: Datos Básicos
        if (currentStep === 2) {
            if (!data.name || data.name.trim().length < 2) { 
                showMessageModal('El nombre es obligatorio y debe ser descriptivo.'); 
                return false; 
            }
        }

        // PASO 3: Financiero (CRÍTICO - PREVENCIÓN DE PÉRDIDAS)
        if (currentStep === 3) {
            const price = parseFloat(data.price) || 0;
            const cost = parseFloat(data.cost) || 0;

            // Regla 1: Precio Cero
            if (price <= 0) { 
                showMessageModal('El precio de venta debe ser mayor a $0.00'); 
                return false; 
            }
            
            // Regla 2: Vender bajo costo
            if (cost > 0 && price < cost) {
                // Confirmación nativa bloqueante y agresiva para evitar clicks accidentales
                const confirmLoss = window.confirm(
                    `🛑 ALERTA DE SEGURIDAD FINANCIERA 🛑\n\n` +
                    `Estás configurando un precio de venta ($${price}) MENOR al costo de compra ($${cost}).\n` +
                    `Esto generará PÉRDIDAS directas en cada venta.\n\n` +
                    `¿Estás absolutamente seguro de proceder con esta configuración?`
                );
                if (!confirmLoss) return false;
            }

            // Regla 3: Integridad de Mayoreo
            if (hasWholesale && data.wholesaleTiers?.length > 0 && cost > 0) {
                const badTier = data.wholesaleTiers.find(t => parseFloat(t.price) < cost);
                if (badTier) {
                    showMessageModal(`❌ Error Crítico en Mayoreo:\n\nTienes un precio de mayoreo ($${badTier.price}) que está por debajo del costo ($${cost}).\n\nPor favor corrige la tabla de mayoreo antes de continuar.`);
                    return false;
                }
            }
        }
        return true;
    };

    // --- CRUD Mayoreo Simple ---
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

    // --- RENDERS DE PASOS ---

    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
             <div className="wizard-welcome">
                {/* UI Adaptativa: Muestra píldora si es farmacia, código de barras si es general */}
                <div className={`main-icon-circle ${isPharmacy ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                    {isPharmacy ? <Pill size={40} /> : <Barcode size={40} />}
                </div>
                <h3>{isPharmacy ? 'Alta de Medicamento' : 'Alta Rápida'}</h3>
                <p>Comencemos escaneando el producto.</p>
            </div>

            <div className="scan-focus-area" style={{marginBottom: '20px'}}>
                <div className="input-with-button">
                    <input 
                        className="form-input big-input text-center" 
                        placeholder="Escanea o escribe código..."
                        value={data.barcode}
                        onChange={e => setField('barcode', e.target.value.trim())} 
                        onKeyDown={(e) => e.key === 'Enter' && setStep(2)}
                        autoFocus
                    />
                    <button className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                </div>
            </div>

            {/* LÓGICA INTELIGENTE: Si forceUnitMode es true, ocultamos la selección y mostramos un badge */}
            {forceUnitMode ? (
                <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center gap-2 text-gray-500 text-sm">
                    <Box size={18} />
                    <span>Modo Estándar: <strong>Venta por Unidad / Pieza</strong></span>
                </div>
            ) : (
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
            )}
        </div>
    );

    const renderStep2 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Datos del Producto</h3>
            <div className="form-group">
                <label>Nombre {isPharmacy ? 'del Medicamento' : 'Comercial'} *</label>
                <input 
                    className="form-input big-input" 
                    placeholder={isPharmacy ? "Ej: Paracetamol 500mg" : "Ej: Coca Cola 600ml"}
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
                    {isPharmacy && <small className="text-blue-500 mt-1 block text-xs">ℹ️ Para medicamentos controlados, recuerda registrar el Lote más adelante.</small>}
                </div>
            )}
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
                        <input type="number" className="form-input" style={{color:'#2563eb', fontWeight:'bold'}} value={margin} onChange={e => handleMarginChange(e.target.value)} placeholder="30" />
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
                    {/* Alerta Visual Inmediata (Feedback Rápido) */}
                    {parseFloat(data.price) > 0 && parseFloat(data.price) < parseFloat(data.cost) && (
                        <div className="flex items-center gap-1 text-red-600 text-xs mt-1 font-bold animate-pulse">
                            <ShieldAlert size={14}/> <span>PRECIO BAJO COSTO</span>
                        </div>
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
                                                className={`form-input h-8 text-sm ${isBelowCost ? 'border-red-500 bg-red-50 text-red-700' : ''}`} 
                                                placeholder="$ Precio" 
                                                value={tier.price} 
                                                onChange={e => updateWholesaleTier(idx, 'price', e.target.value)} 
                                            />
                                        </div>
                                        <button className="text-red-400 hover:text-red-600" onClick={() => removeWholesaleTier(idx)}><Trash2 size={16} /></button>
                                        {isBelowCost && <AlertTriangle size={16} className="text-red-500" title="Precio menor al costo" />}
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
                        <strong className={`text-2xl ${parseFloat(data.price) < parseFloat(data.cost) ? 'text-red-600' : 'text-emerald-600'}`}>
                            ${parseFloat(data.price).toFixed(2)}
                        </strong>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong className="text-slate-500">Costo:</strong> ${parseFloat(data.cost || 0).toFixed(2)}</div>
                    <div><strong className="text-slate-500">Margen:</strong> {margin}%</div>
                    <div><strong className="text-slate-500">Stock:</strong> {data.stock} {data.unit}</div>
                    <div><strong className="text-slate-500">Categoría:</strong> {categoryName}</div>
                </div>

                {/* Advertencia final si hay precios peligrosos permitidos */}
                {parseFloat(data.price) < parseFloat(data.cost) && (
                    <div className="mt-3 p-2 bg-red-100 border border-red-300 rounded text-red-700 text-xs font-bold text-center">
                        ⚠️ ATENCIÓN: Este producto se venderá con PÉRDIDA.
                    </div>
                )}

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
        <div className={`product-wizard-container theme-${mainRubro}`}>
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