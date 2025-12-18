import React, { useState, useMemo } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useAppStore } from '../../store/useAppStore';
import { generateID, showMessageModal } from '../../services/utils';
import ScannerModal from '../common/ScannerModal';

// Fieldsets especializados
import AbarrotesFields from './fieldsets/AbarrotesFields';
import RestauranteFields from './fieldsets/RestauranteFields';
import FarmaciaFields from './fieldsets/FarmaciaFIelds';
import FruteriaFields from './fieldsets/FruteriaFields';

import {
    ChevronRight, ArrowLeft, Check, Package, Barcode,
    Scale, Zap, ShoppingCart, AlertTriangle, Box
} from 'lucide-react';
import './ProductWizard.css';

export default function ProductWizard({ onSave, onCancel, categories }) {
    const features = useFeatureConfig();
    const companyProfile = useAppStore(state => state.companyProfile);
    const [step, setStep] = useState(1);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [wizardStrategy, setWizardStrategy] = useState('standard');

    const mainRubro = useMemo(() => {
        const types = companyProfile?.business_type || [];
        // Normalizamos a minúsculas para evitar errores de matching
        const primary = Array.isArray(types) ? types[0]?.toLowerCase() : 'general';
        return primary;
    }, [companyProfile]);

    const [data, setData] = useState({
        id: generateID('prod'),
        name: '',
        barcode: '',
        categoryId: '',
        cost: '',
        price: '',
        margin: '',
        stock: '',
        minStock: 5,
        maxStock: '',
        trackStock: true,
        unit: 'pza',
        saleType: 'unit',
        location: '',
        supplier: '',
        conversionFactor: { enabled: false, purchaseUnit: '', factor: 1 }
    });

    // --- LÓGICA DE PRECIOS ---
    const updatePriceLogic = (field, value) => {
        let { cost, price, margin } = data;
        if (field === 'cost') cost = value;
        if (field === 'price') price = value;
        
        const nCost = parseFloat(cost) || 0;
        const nPrice = parseFloat(price) || 0;

        if (field === 'margin') {
            margin = value;
            if (nCost > 0) price = (nCost * (1 + (parseFloat(value) / 100))).toFixed(2);
        } else if (nCost > 0 && nPrice > 0) {
            margin = (((nPrice - nCost) / nCost) * 100).toFixed(1);
        }

        setData(prev => ({ ...prev, cost, price, margin }));
    };

    // --- CONFIGURACIÓN DE PERSONALIDAD POR RUBRO ---
    const personality = useMemo(() => {
        const configs = {
            abarrotes: {
                title: "Asistente de Tienda",
                subtitle: "Alta rápida de productos con código de barras.",
                icon: <ShoppingCart className="text-blue-600" />,
                strategies: [
                    { id: 'standard', label: 'Producto con Código', desc: 'Sabritas, Refrescos, Latas', icon: <Barcode /> },
                    { id: 'bulk', label: 'Venta a Granel', desc: 'Semillas, Alimento mascotas', icon: <Scale /> }
                ],
                priorityField: 'barcode'
            },
            food_service: {
                title: "Chef Digital",
                subtitle: "Configura tus platillos y recetas.",
                icon: <Zap className="text-orange-500" />,
                strategies: [
                    { id: 'dish', label: 'Platillo', desc: 'Se prepara al momento', icon: <Package /> },
                    { id: 'standard', label: 'Bebida/Insumo', desc: 'Venta directa', icon: <Box /> }
                ]
            },
            // Fallback genérico para otros rubros
            general: {
                title: "Gestor de Inventario",
                subtitle: "Agrega artículos a tu catálogo.",
                icon: <Package />,
                strategies: [
                    { id: 'standard', label: 'Venta por Unidad', desc: 'Piezas fijas', icon: <Box /> },
                    { id: 'bulk', label: 'Venta Fraccionada', desc: 'Metros, Litros, Kilos', icon: <Scale /> }
                ]
            }
        };

        return configs[mainRubro] || configs.general;
    }, [mainRubro]);

    // --- RENDERS DE PASOS ---

    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle">{personality.icon}</div>
                <h3>{personality.title}</h3>
                <p>{personality.subtitle}</p>
            </div>
            <div className="selection-grid">
                {personality.strategies.map(strat => (
                    <div
                        key={strat.id}
                        className={`selection-card ${wizardStrategy === strat.id ? 'selected' : ''}`}
                        onClick={() => {
                            setWizardStrategy(strat.id);
                            setData(prev => ({ 
                                ...prev, 
                                saleType: strat.id === 'bulk' ? 'bulk' : 'unit',
                                unit: strat.id === 'bulk' ? 'kg' : 'pza'
                            }));
                        }}
                    >
                        <div className="selection-icon">{strat.icon}</div>
                        <div className="selection-title">{strat.label}</div>
                        <div className="selection-desc">{strat.desc}</div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="wizard-step">
            <h3>Identificación</h3>
            
            {/* Si es abarrotes, pedimos el código primero */}
            {mainRubro === 'abarrotes' && wizardStrategy !== 'bulk' && (
                <div className="form-group">
                    <label>Código de Barras</label>
                    <div className="input-with-button">
                        <input 
                            className="form-input" 
                            placeholder="Escanea o escribe el código"
                            value={data.barcode} 
                            onChange={e => setData({...data, barcode: e.target.value})} 
                        />
                        <button className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                    </div>
                </div>
            )}

            <div className="form-group">
                <label>Nombre del Producto *</label>
                <input 
                    className="form-input big-input" 
                    placeholder="Ej: Coca Cola 600ml"
                    value={data.name} 
                    onChange={e => setData({...data, name: e.target.value})} 
                />
            </div>

            {/* Inyectamos el fieldset real para que no se pierda ninguna funcionalidad */}
            {mainRubro === 'abarrotes' && (
                <AbarrotesFields 
                    saleType={data.saleType} setSaleType={v => setData({...data, saleType: v})}
                    unit={data.unit} setUnit={v => setData({...data, unit: v})}
                    location={data.location} setLocation={v => setData({...data, location: v})}
                    showBulk={wizardStrategy === 'bulk'}
                    conversionFactor={data.conversionFactor}
                    setConversionFactor={v => setData({...data, conversionFactor: v})}
                />
            )}

            {mainRubro === 'farmacia' && (
                <FarmaciaFields 
                    sustancia={data.sustancia} setSustancia={v => setData({...data, sustancia: v})}
                    laboratorio={data.laboratorio} setLaboratorio={v => setData({...data, laboratorio: v})}
                    requiresPrescription={data.requiresPrescription} setRequiresPrescription={v => setData({...data, requiresPrescription: v})}
                />
            )}
        </div>
    );

    const renderStep3 = () => (
        <div className="wizard-step">
            <h3>Precios y Ganancia</h3>
            <div className="money-wizard-container">
                <div className="money-row">
                    <div className="form-group">
                        <label>Costo de Compra</label>
                        <div className="input-with-prefix">
                            <span>$</span>
                            <input type="number" value={data.cost} onChange={e => updatePriceLogic('cost', e.target.value)} placeholder="0.00" />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Margen (%)</label>
                        <div className="input-with-prefix">
                            <input type="number" value={data.margin} onChange={e => updatePriceLogic('margin', e.target.value)} placeholder="%" />
                            <span>%</span>
                        </div>
                    </div>
                </div>
                <div className="form-group highlight-price">
                    <label>Precio de Venta Sugerido</label>
                    <div className="input-with-prefix">
                        <span>$</span>
                        <input type="number" className="big-price-input" value={data.price} onChange={e => updatePriceLogic('price', e.target.value)} placeholder="0.00" />
                    </div>
                </div>
            </div>
        </div>
    );

    const renderStep4 = () => (
        <div className="wizard-step">
            <h3>Inventario y Alertas</h3>
            <div className="stock-wizard-card">
                <div className="form-group">
                    <label>Existencia Actual ({data.unit})</label>
                    <input type="number" className="big-stock-input" value={data.stock} onChange={e => setData({...data, stock: e.target.value})} placeholder="0" />
                </div>
                
                <div className="alert-config">
                    <div className="alert-header">
                        <AlertTriangle size={18} className="text-warning" />
                        <span>Aviso de Stock Bajo</span>
                    </div>
                    <div className="form-group">
                        <label>Notificarme cuando queden menos de:</label>
                        <input type="number" className="form-input" value={data.minStock} onChange={e => setData({...data, minStock: e.target.value})} />
                    </div>
                </div>

                <div className="category-mini-picker">
                    <label>Categoría</label>
                    <select className="form-input" value={data.categoryId} onChange={e => setData({...data, categoryId: e.target.value})}>
                        <option value="">Sin Categoría</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            </div>
        </div>
    );

    return (
        <div className="product-wizard-container">
            <div className="wizard-progress-bar">
                {[1, 2, 3, 4].map(s => (
                    <div key={s} className={`progress-dot ${step >= s ? 'active' : ''} ${step > s ? 'completed' : ''}`}>
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
                        <ArrowLeft size={16} /> Atrás
                    </button>
                ) : (
                    <button className="btn btn-cancel" onClick={onCancel}>Cerrar</button>
                )}

                {step < 4 ? (
                    <button 
                        className="btn btn-primary" 
                        onClick={() => step === 2 && !data.name ? showMessageModal('El nombre es obligatorio') : setStep(step + 1)}
                    >
                        Siguiente <ChevronRight size={16} />
                    </button>
                ) : (
                    <button className="btn btn-save pulse" onClick={() => onSave(data)}>
                        ✅ Finalizar Registro
                    </button>
                )}
            </div>

            <ScannerModal 
                show={isScannerOpen} 
                onClose={() => setIsScannerOpen(false)} 
                onScanSuccess={code => { setData({...data, barcode: code}); setIsScannerOpen(false); }} 
            />
        </div>
    );
}