// src/components/products/wizards/GroceryWizard.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useProductLogic } from '../../../hooks/useProductLogic';
import { useFeatureConfig } from '../../../hooks/useFeatureConfig'; // Importamos la config inteligente
import { 
    Barcode, ArrowLeft, Check, ChevronRight, Scale, Box, 
    FileText, Calculator, Users, ChevronDown, ChevronUp, Trash2, Plus 
} from 'lucide-react';
import ScannerModal from '../../common/ScannerModal';
import FarmaciaFields from '../fieldsets/FarmaciaFIelds';
import '../ProductWizard.css';
import { showMessageModal } from '../../../services/utils';

export default function GroceryWizard({ onSave, onCancel, categories, mainRubro }) {
    // 1. Hook de lógica de producto
    const { data, setField, updatePriceLogic } = useProductLogic({ trackStock: true });
    
    // 2. Hook de configuración inteligente (Feature Flags)
    const { hasExpiry, hasWholesale, hasLabFields } = useFeatureConfig();

    const [step, setStep] = useState(1);
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    // Estado para la calculadora de margen inteligente
    const [margin, setMargin] = useState(''); 
    
    // Estado para colapsar/expandir mayoreo
    const [showWholesale, setShowWholesale] = useState(false);

    // Helper para obtener nombre de categoría
    const categoryName = useMemo(() => {
        if (!data.categoryId) return 'General';
        const cat = categories.find(c => c.id == data.categoryId);
        return cat ? cat.name : 'Desconocida';
    }, [data.categoryId, categories]);

    // LÓGICA DE MARGEN INTELIGENTE
    // Recalcula el precio si cambia el costo o el margen
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

    // Si el usuario cambia el precio final manualmente, recalculamos el margen inverso
    const handlePriceChange = (val) => {
        updatePriceLogic('price', val);
        if (data.cost && val) {
            const cost = parseFloat(data.cost);
            const price = parseFloat(val);
            if (cost > 0) {
                const newMargin = ((price - cost) / cost) * 100;
                setMargin(newMargin.toFixed(1));
            }
        }
    };

    // LÓGICA DE MAYOREO (CRUD LOCAL)
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


    // --- RENDERS DE LOS PASOS ---

    // PASO 1: Escaneo y Tipo de Venta
    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-blue-100 text-blue-600">
                    <Barcode size={40} />
                </div>
                <h3>Alta de Productos</h3>
                <p>Escanea el código o selecciona el tipo de venta.</p>
            </div>

            <div className="scan-focus-area" style={{marginBottom: '20px'}}>
                <div className="input-with-button">
                    <input 
                        className="form-input big-input text-center" 
                        placeholder="Escanea Código de Barras Aquí"
                        value={data.barcode}
                        onChange={e => setField('barcode', e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && setStep(2)} // Salto rápido
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

    // PASO 2: Datos Generales
    const renderStep2 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Información Básica</h3>
            <div className="form-group">
                <label>Nombre del Producto *</label>
                <input 
                    className="form-input big-input" 
                    placeholder={mainRubro === 'farmacia' ? "Ej: Paracetamol 500mg" : "Ej: Galletas Marias"}
                    value={data.name} 
                    onChange={e => setField('name', e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && document.getElementById('cat-select')?.focus()}
                    autoFocus
                />
            </div>

            <div className="form-group">
                <label>Categoría / Departamento</label>
                <select 
                    id="cat-select"
                    className="form-input" 
                    value={data.categoryId} 
                    onChange={e => setField('categoryId', e.target.value)}
                >
                    <option value="">General</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            {/* Renderizado Condicional: Campos de Caducidad */}
            {hasExpiry && (
                <div className="form-group animate-fade-in" style={{ marginTop: '15px' }}>
                    <label>Fecha de Caducidad (Opcional)</label>
                    <input 
                        type="date" 
                        className="form-input"
                        value={data.expiryDate || ''}
                        onChange={e => setField('expiryDate', e.target.value)}
                    />
                </div>
            )}

            {/* Renderizado Condicional: Campos Farmacia */}
            {(mainRubro === 'farmacia' || hasLabFields) && (
                <FarmaciaFields 
                    sustancia={data.sustancia} setSustancia={v => setField('sustancia', v)}
                    laboratorio={data.laboratorio} setLaboratorio={v => setField('laboratorio', v)}
                    requiresPrescription={data.requiresPrescription} setRequiresPrescription={v => setField('requiresPrescription', v)}
                    presentation={data.presentation} setPresentation={v => setField('presentation', v)}
                />
            )}
        </div>
    );

    // PASO 3: Inventario y Finanzas (MEJORADO)
    const renderStep3 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Stock y Precio</h3>
            
            {/* Calculadora de Márgenes */}
            <div className="money-row">
                <div className="form-group">
                    <label>Costo Compra</label>
                    <div className="input-with-prefix">
                        <span>$</span>
                        <input 
                            type="number" 
                            className="form-input" 
                            value={data.cost} 
                            onChange={e => handleCostChange(e.target.value)} 
                            placeholder="0.00" 
                        />
                    </div>
                </div>

                <div className="form-group small-group">
                    <label className="text-blue-600 font-bold">% Ganancia</label>
                    <div className="input-with-prefix">
                        <span className="text-blue-500">%</span>
                        <input 
                            type="number" 
                            className="form-input text-blue-700 font-bold" 
                            value={margin} 
                            onChange={e => handleMarginChange(e.target.value)} 
                            placeholder="30" 
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>Precio Final</label>
                    <div className="input-with-prefix">
                        <span>$</span>
                        <input 
                            type="number" 
                            className="form-input big-price-input" 
                            value={data.price} 
                            onChange={e => handlePriceChange(e.target.value)} 
                            placeholder="0.00" 
                        />
                    </div>
                </div>
            </div>

            <div className="stock-wizard-card" style={{marginTop: '15px'}}>
                <div className="form-group">
                    <label>Existencia Inicial ({data.unit})</label>
                    <input 
                        type="number" 
                        className="form-input" 
                        value={data.stock} 
                        onChange={e => setField('stock', e.target.value)} 
                    />
                </div>
                {/* Stock Minimo: Solo si el usuario lo usa frecuentemente o por config, 
                    por simplicidad lo dejamos oculto o agregamos un toggle simple */}
            </div>

            {/* SECCIÓN EXPANDIBLE DE MAYOREO (Solo si hasWholesale es true) */}
            {hasWholesale && (
                <div className="wholesale-section-wizard mt-4 border border-indigo-100 rounded-lg overflow-hidden">
                    <button 
                        className="w-full flex items-center justify-between p-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                        onClick={() => setShowWholesale(!showWholesale)}
                    >
                        <div className="flex items-center gap-2 font-medium">
                            <Users size={18} />
                            <span>Configurar Precios de Mayoreo</span>
                        </div>
                        {showWholesale ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                    </button>

                    {showWholesale && (
                        <div className="p-3 bg-white animate-fade-in">
                            <p className="text-xs text-gray-500 mb-3">
                                Define precios especiales cuando el cliente compre cierta cantidad.
                            </p>
                            
                            {data.wholesaleTiers?.length === 0 && (
                                <div className="text-center py-2 text-sm text-gray-400">
                                    No hay rangos definidos
                                </div>
                            )}

                            <div className="space-y-2">
                                {data.wholesaleTiers?.map((tier, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <span className="text-xs text-gray-500">A partir de:</span>
                                            <input 
                                                type="number" 
                                                className="form-input h-8 text-sm"
                                                placeholder="Cant."
                                                value={tier.min}
                                                onChange={e => updateWholesaleTier(idx, 'min', e.target.value)}
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <span className="text-xs text-gray-500">Precio:</span>
                                            <input 
                                                type="number" 
                                                className="form-input h-8 text-sm"
                                                placeholder="$"
                                                value={tier.price}
                                                onChange={e => updateWholesaleTier(idx, 'price', e.target.value)}
                                            />
                                        </div>
                                        <button 
                                            className="p-1 text-red-400 hover:text-red-600 mt-4"
                                            onClick={() => removeWholesaleTier(idx)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button 
                                className="mt-3 w-full py-2 border border-dashed border-indigo-300 text-indigo-500 rounded text-sm hover:bg-indigo-50 flex items-center justify-center gap-1"
                                onClick={addWholesaleTier}
                            >
                                <Plus size={14}/> Agregar Rango
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    // PASO 4: RESUMEN
    const renderStep4 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-green-100 text-green-600">
                    <FileText size={40} />
                </div>
                <h3>Confirmación</h3>
                <p>Verifica los datos antes de registrar el producto.</p>
            </div>

            <div className="summary-card bg-slate-50 border border-slate-200 rounded-xl p-5 text-left mt-2">
                {/* Cabecera del Resumen */}
                <div className="flex justify-between items-start border-b border-dashed border-slate-300 pb-4 mb-4">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-slate-800 m-0">{data.name || 'Sin Nombre'}</h2>
                        <div className="flex gap-2 mt-2">
                            <span className="badge bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs border border-blue-100">
                                {data.saleType === 'bulk' ? '⚖️ Granel' : '📦 Unidad'}
                            </span>
                            {margin && (
                                <span className="badge bg-green-50 text-green-600 px-2 py-0.5 rounded text-xs border border-green-100">
                                    📈 {margin}% Margen
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-slate-500 block">Precio Público</span>
                        <strong className="text-2xl text-emerald-600">
                            ${parseFloat(data.price || 0).toFixed(2)}
                        </strong>
                    </div>
                </div>

                {/* Grid de Detalles */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <strong className="text-slate-500 block">Código:</strong>
                        <span className="font-mono bg-white px-2 py-0.5 border rounded">
                            {data.barcode || '---'}
                        </span>
                    </div>
                    
                    <div>
                        <strong className="text-slate-500 block">Stock Inicial:</strong>
                        <span className="font-bold">
                            {data.stock || 0} {data.unit}
                        </span>
                    </div>

                    <div>
                        <strong className="text-slate-500 block">Costo:</strong>
                        <span>${parseFloat(data.cost || 0).toFixed(2)}</span>
                    </div>

                    <div>
                         <strong className="text-slate-500 block">Categoría:</strong>
                         <span>{categoryName}</span>
                    </div>
                </div>

                {/* Resumen Mayoreo si aplica */}
                {hasWholesale && data.wholesaleTiers?.length > 0 && (
                     <div className="mt-4 pt-3 border-t border-slate-200">
                        <strong className="text-xs text-slate-500 block mb-1">Precios de Mayoreo:</strong>
                        <div className="flex flex-wrap gap-2">
                            {data.wholesaleTiers.map((t, i) => (
                                <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">
                                    {t.min}+ pzas: <b>${t.price}</b>
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
            {/* Barra de progreso */}
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
                    <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
                        <ArrowLeft size={16}/> Atrás
                    </button>
                ) : (
                    <button className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
                )}

                {step < 4 ? (
                    <button className="btn btn-primary bg-blue-600 hover:bg-blue-700" onClick={() => {
                        // Validaciones
                        if(step === 2 && !data.name) return showMessageModal('El nombre es obligatorio');
                        if(step === 3 && !data.price) return showMessageModal('Define un precio de venta');
                        setStep(step + 1);
                    }}>
                        Siguiente <ChevronRight size={16}/>
                    </button>
                ) : (
                    <button className="btn btn-save pulse bg-green-600" onClick={() => onSave(data)}>
                        ✅ Confirmar y Guardar
                    </button>
                )}
            </div>

            <ScannerModal 
                show={isScannerOpen} 
                onClose={() => setIsScannerOpen(false)} 
                onScanSuccess={code => { setField('barcode', code); setIsScannerOpen(false); }} 
            />
        </div>
    );
}