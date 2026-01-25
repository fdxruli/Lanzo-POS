// src/components/products/wizards/RestaurantWizard.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useProductLogic } from '../../../hooks/useProductLogic';
import { 
    ChefHat, ArrowLeft, Check, ChevronRight, FileText, 
    Printer, Clock, AlertTriangle, Box, ShieldAlert, Utensils
} from 'lucide-react';
import RestauranteFields from '../fieldsets/RestauranteFields';
import '../ProductWizard.css';
import { showMessageModal } from '../../../services/utils';

export default function RestaurantWizard({ onSave, onCancel, categories }) {
    // Inicializamos lógica de producto con valores seguros
    const { data, setField, updatePriceLogic } = useProductLogic({ 
        unit: 'pza', 
        trackStock: false, // Por defecto asumimos platillo (no stock directo, sino receta)
        productType: 'sellable'
    });
    
    const [step, setStep] = useState(1);

    // Efecto: Ajustar configuración técnica al cambiar el tipo de producto
    useEffect(() => {
        if (data.productType === 'ingredient') {
            setField('trackStock', true); // Insumos SIEMPRE controlan stock
            setField('price', 0);         // Insumos NO tienen precio de venta al público
            setField('printStation', null); 
        } else {
            // Si es platillo, por defecto no trackea stock (usa receta), pero el usuario puede cambiarlo
            // Mantenemos trackStock como estaba o false
        }
    }, [data.productType]);

    // Helper para obtener nombre de categoría
    const categoryName = useMemo(() => {
        if (!data.categoryId) return 'Sin Categoría';
        const cat = categories.find(c => c.id == data.categoryId); 
        return cat ? cat.name : 'Desconocida';
    }, [data.categoryId, categories]);

    // --- VALIDACIONES ROBUSTAS ---
    const validateStep = (currentStep) => {
        // Validación Paso 2: Datos Básicos
        if (currentStep === 2) {
            if (!data.name || data.name.trim().length < 2) { 
                showMessageModal('Por favor, asigna un nombre descriptivo al producto.'); 
                return false; 
            }

            // Reglas para Platillos de Venta
            if (data.productType === 'sellable') {
                const price = parseFloat(data.price) || 0;
                const cost = parseFloat(data.cost) || 0;

                if (price <= 0) {
                    showMessageModal('El Precio de Venta debe ser mayor a $0.00');
                    return false;
                }

                // Hardening: Prevención de Pérdidas
                if (cost > 0 && price < cost) {
                    const confirmLoss = window.confirm(
                        `⚠️ ALERTA DE PÉRDIDA\n\n` +
                        `El precio de venta ($${price}) es MENOR al costo ($${cost}).\n` +
                        `¿Realmente deseas registrar este producto con pérdidas?`
                    );
                    if (!confirmLoss) return false;
                }
            }
        }
        
        // Validación Paso 3 (Solo para Insumos): Stock
        if (currentStep === 3 && data.productType === 'ingredient') {
             // Opcional: Validar que el stock inicial no sea negativo
             if (data.stock < 0) {
                 showMessageModal('El stock inicial no puede ser negativo.');
                 return false;
             }
        }

        return true;
    };

    // --- RENDERIZADO DE PASOS ---

    // PASO 1: TIPO DE PRODUCTO
    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-orange-100 text-orange-600">
                    <ChefHat size={40} />
                </div>
                <h3>Cocina Digital</h3>
                <p>Define la naturaleza del ítem.</p>
            </div>

            <div className="selection-grid">
                <div
                    className={`selection-card ${data.productType === 'sellable' ? 'selected' : ''}`}
                    onClick={() => {
                        setField('productType', 'sellable');
                        setField('trackStock', false); // Reset a comportamiento platillo
                    }}
                >
                    <div className="selection-icon"><Utensils size={24}/></div>
                    <div className="selection-title">Platillo de Menú</div>
                    <div className="selection-desc">Hamburguesas, Tacos, Bebidas para vender.</div>
                </div>
                <div
                    className={`selection-card ${data.productType === 'ingredient' ? 'selected' : ''}`}
                    onClick={() => {
                        setField('productType', 'ingredient');
                        setField('unit', 'kg'); // Default sugerido para insumos
                    }}
                >
                    <div className="selection-icon"><Box size={24}/></div>
                    <div className="selection-title">Insumo / Stock</div>
                    <div className="selection-desc">Carne, Verduras, Desechables (Costo interno).</div>
                </div>
            </div>
        </div>
    );

    // PASO 2: DATOS BÁSICOS (ADAPTABLE)
    const renderStep2 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Detalles del {data.productType === 'sellable' ? 'Platillo' : 'Insumo'}</h3>

            <div className="form-group">
                <label>Nombre {data.productType === 'sellable' ? 'en Comanda' : 'del Insumo'} *</label>
                <input
                    className="form-input big-input"
                    placeholder={data.productType === 'sellable' ? "Ej: Hamburguesa Especial" : "Ej: Carne Molida Premium"}
                    value={data.name}
                    onChange={e => setField('name', e.target.value)}
                    autoFocus
                />
            </div>

            <div className="money-wizard-container">
                {data.productType === 'sellable' ? (
                    // VISTA PARA PLATILLOS (Foco en Precio Venta)
                    <>
                        <div className="form-group highlight-price" style={{ flex: 2 }}>
                            <label>Precio de Venta</label>
                            <div className="input-with-prefix">
                                <span>$</span>
                                <input
                                    type="number"
                                    className="big-price-input"
                                    value={data.price}
                                    onChange={e => updatePriceLogic('price', e.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                        <div className="form-group" style={{ flex: 1, opacity: 0.8 }}>
                            <label>Costo (Opcional)</label>
                            <div className="input-with-prefix">
                                <span>$</span>
                                <input
                                    type="number"
                                    value={data.cost}
                                    onChange={e => updatePriceLogic('cost', e.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    // VISTA PARA INSUMOS (Foco en Costo y Unidad)
                    <>
                        <div className="form-group highlight-price" style={{ flex: 2 }}>
                            <label>Costo de Compra</label>
                            <div className="input-with-prefix">
                                <span>$</span>
                                <input
                                    type="number"
                                    className="big-price-input"
                                    value={data.cost}
                                    onChange={e => updatePriceLogic('cost', e.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Unidad de Medida</label>
                            <select 
                                className="form-input" 
                                value={data.unit} 
                                onChange={e => setField('unit', e.target.value)}
                                style={{ height: '50px' }} // Igualar altura visual
                            >
                                <option value="pza">Pieza (Unidad)</option>
                                <option value="kg">Kilogramo (Kg)</option>
                                <option value="lt">Litro (Lt)</option>
                                <option value="g">Gramo (g)</option>
                                <option value="ml">Mililitro (ml)</option>
                            </select>
                        </div>
                    </>
                )}
            </div>

            {/* Alerta de Pérdida en Tiempo Real */}
            {data.productType === 'sellable' && parseFloat(data.price) > 0 && parseFloat(data.cost) > parseFloat(data.price) && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center gap-2 mt-2 animate-pulse">
                    <ShieldAlert size={18} />
                    <span className="font-bold text-sm">CUIDADO: El precio es menor al costo.</span>
                </div>
            )}

            <div className="form-group mt-4">
                <label>Categoría</label>
                <select className="form-input" value={data.categoryId} onChange={e => setField('categoryId', e.target.value)}>
                    <option value="">Seleccione...</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
        </div>
    );

    // PASO 3: CONFIGURACIÓN ESPECÍFICA (La gran mejora UX)
    const renderStep3 = () => {
        if (data.productType === 'sellable') {
            return (
                <div className="wizard-step animate-fade-in">
                    <h3>Experiencia de Cocina</h3>
                    <p className="text-sm text-gray-500 mb-4">Configura cómo se comporta este platillo en las comandas.</p>

                    <RestauranteFields
                        productType={data.productType}
                        setProductType={(val) => setField('productType', val)}
                        hideTypeSelector={true} // Ya se eligió en Step 1
                        
                        printStation={data.printStation}
                        setPrintStation={(val) => setField('printStation', val)}
                        prepTime={data.prepTime}
                        setPrepTime={(val) => setField('prepTime', val)}
                        modifiers={data.modifiers}
                        setModifiers={(val) => setField('modifiers', val)}
                        onManageRecipe={() => showMessageModal('Podrás configurar la receta detallada (ingredientes) una vez guardado el producto.')}
                    />
                </div>
            );
        } else {
            // Si es INSUMO, mostramos Configuración de Inventario en lugar de Impresoras
            return (
                <div className="wizard-step animate-fade-in">
                    <h3>Control de Inventario</h3>
                    <p className="text-sm text-gray-500 mb-4">Define los niveles de stock para tus alertas de compra.</p>

                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                        <div className="flex items-center gap-2 mb-2 text-blue-700 font-semibold">
                            <Box size={20} />
                            <span>Stock Actual</span>
                        </div>
                        <div className="input-with-prefix bg-white">
                            <input 
                                type="number" 
                                className="form-input text-lg font-bold text-blue-800"
                                value={data.stock} 
                                onChange={e => setField('stock', e.target.value)}
                                placeholder="0" 
                            />
                            <span className="text-gray-500 font-medium px-3">{data.unit}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="form-group">
                            <label>Stock Mínimo (Alerta)</label>
                            <input 
                                type="number" 
                                className="form-input" 
                                value={data.minStock || ''} 
                                onChange={e => setField('minStock', e.target.value)}
                                placeholder="Ej: 5" 
                            />
                        </div>
                        <div className="form-group">
                            <label>Stock Máximo (Ideal)</label>
                            <input 
                                type="number" 
                                className="form-input" 
                                value={data.maxStock || ''} 
                                onChange={e => setField('maxStock', e.target.value)}
                                placeholder="Ej: 50" 
                            />
                        </div>
                    </div>
                </div>
            );
        }
    };

    // PASO 4: RESUMEN FINAL
    const renderStep4 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-green-100 text-green-600">
                    <FileText size={40} />
                </div>
                <h3>¡Todo listo!</h3>
                <p>Confirma los datos antes de crear.</p>
            </div>

            <div className="summary-card bg-white border border-gray-200 rounded-xl p-5 mt-2 text-left shadow-sm">
                <div className="flex justify-between items-start border-b border-dashed border-gray-300 pb-4 mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 m-0">{data.name || 'Sin Nombre'}</h2>
                        <span className={`badge inline-block mt-1 px-2 py-1 rounded text-xs font-bold ${data.productType === 'sellable' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                            {data.productType === 'sellable' ? 'VENTA / MENÚ' : 'INSUMO / STOCK'}
                        </span>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-gray-500 block">
                            {data.productType === 'sellable' ? 'Precio Público' : 'Costo Unitario'}
                        </span>
                        <strong className={`text-2xl ${data.productType === 'sellable' ? 'text-emerald-600' : 'text-gray-700'}`}>
                            ${parseFloat(data.productType === 'sellable' ? data.price : data.cost || 0).toFixed(2)}
                        </strong>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                    <div>
                        <strong>Categoría:</strong> {categoryName}
                    </div>
                    
                    {data.productType === 'sellable' ? (
                        <>
                            <div>
                                <strong><Printer size={14} className="inline mr-1"/>Impresión:</strong> 
                                {data.printStation === 'none' ? ' No' : (data.printStation || 'Cocina')}
                            </div>
                            <div>
                                <strong><Clock size={14} className="inline mr-1"/>Prep:</strong> 
                                {data.prepTime ? `${data.prepTime} min` : 'N/A'}
                            </div>
                            {/* Alerta si no se configuró costo */}
                            {(!data.cost || parseFloat(data.cost) === 0) && (
                                <div className="col-span-2 text-xs text-orange-600 bg-orange-50 p-1 rounded mt-1">
                                    ⚠️ No has definido costo. El margen será 100%.
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div>
                                <strong>Stock Inicial:</strong> {data.stock || 0} {data.unit}
                            </div>
                            <div>
                                <strong>Alerta Mínima:</strong> {data.minStock || 'N/A'}
                            </div>
                        </>
                    )}
                </div>

                {data.modifiers && data.modifiers.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100">
                        <strong className="text-xs text-gray-500 block mb-1">Modificadores Activos:</strong>
                        <div className="flex flex-wrap gap-2">
                            {data.modifiers.map((mod, idx) => (
                                <span key={idx} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200">
                                    {mod.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="product-wizard-container theme-restaurant">
            <div className="wizard-progress-bar">
                {[1, 2, 3, 4].map(s => (
                    <div key={s} className={`progress-dot ${step >= s ? 'active' : ''} bg-orange-500`}>
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
                    <button className="btn btn-cancel" onClick={onCancel}>Cancelar</button>
                )}

                {step < 4 ? (
                    <button className="btn btn-primary bg-orange-600 hover:bg-orange-700" onClick={() => {
                        if (validateStep(step)) setStep(step + 1);
                    }}>
                        Siguiente <ChevronRight size={16} />
                    </button>
                ) : (
                    <button className="btn btn-save pulse bg-green-600" onClick={() => onSave(data)}>
                        ✅ Confirmar y Crear
                    </button>
                )}
            </div>
        </div>
    );
}