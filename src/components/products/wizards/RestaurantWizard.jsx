// src/components/products/wizards/RestaurantWizard.jsx
import React, { useState, useMemo } from 'react';
import { useProductLogic } from '../../../hooks/useProductLogic';
import { ChefHat, ArrowLeft, Check, ChevronRight, FileText, Printer, Clock } from 'lucide-react';
import RestauranteFields from '../fieldsets/RestauranteFields';
import '../ProductWizard.css';
import { showMessageModal } from '../../../services/utils';

export default function RestaurantWizard({ onSave, onCancel, categories }) {
    // Inicializamos lógica de producto
    const { data, setField, updatePriceLogic } = useProductLogic({ unit: 'pza', trackStock: false });
    
    // Ahora tenemos 4 pasos (el 4 es el Resumen)
    const [step, setStep] = useState(1);

    // Helper para obtener nombre de categoría
    const categoryName = useMemo(() => {
        if (!data.categoryId) return 'Sin Categoría';
        const cat = categories.find(c => c.id == data.categoryId); // Doble igual para comparar string/number
        return cat ? cat.name : 'Desconocida';
    }, [data.categoryId, categories]);

    // PASO 1: TIPO DE PRODUCTO
    const renderStep1 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-orange-100 text-orange-600">
                    <ChefHat size={40} />
                </div>
                <h3>Cocina Digital</h3>
                <p>¿Qué vamos a cocinar hoy?</p>
            </div>

            <div className="selection-grid">
                <div
                    className={`selection-card ${data.productType === 'sellable' ? 'selected' : ''}`}
                    onClick={() => setField('productType', 'sellable')}
                >
                    <div className="selection-icon">🍽️</div>
                    <div className="selection-title">Platillo de Menú</div>
                    <div className="selection-desc">Hamburguesas, Tacos, Bebidas preparadas.</div>
                </div>
                <div
                    className={`selection-card ${data.productType === 'ingredient' ? 'selected' : ''}`}
                    onClick={() => setField('productType', 'ingredient')}
                >
                    <div className="selection-icon">🥕</div>
                    <div className="selection-title">Insumo / Ingrediente</div>
                    <div className="selection-desc">Carne cruda, Tomates, Pan (Control de stock).</div>
                </div>
            </div>
        </div>
    );

    // PASO 2: DATOS BÁSICOS
    const renderStep2 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Detalles del {data.productType === 'sellable' ? 'Platillo' : 'Insumo'}</h3>

            <div className="form-group">
                <label>Nombre en Comanda *</label>
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
                    <div className="form-group highlight-price" style={{ width: '100%' }}>
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
                ) : (
                    <div className="form-group">
                        <label>Costo de Compra (Por {data.unit || 'Unidad'})</label>
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
                )}
            </div>

            <div className="form-group">
                <label>Categoría</label>
                <select className="form-input" value={data.categoryId} onChange={e => setField('categoryId', e.target.value)}>
                    <option value="">Seleccione...</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
        </div>
    );

    // PASO 3: CONFIGURACIÓN AVANZADA
    const renderStep3 = () => (
        <div className="wizard-step animate-fade-in">
            <h3>Configuración de Cocina</h3>
            {data.productType === 'sellable' && (
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '15px' }}>
                    Personaliza la impresión y los extras.
                </p>
            )}

            <RestauranteFields
                productType={data.productType}
                setProductType={(val) => setField('productType', val)}
                hideTypeSelector={true} // Ocultamos selector porque ya se eligió en paso 1
                
                printStation={data.printStation}
                setPrintStation={(val) => setField('printStation', val)}
                prepTime={data.prepTime}
                setPrepTime={(val) => setField('prepTime', val)}
                modifiers={data.modifiers}
                setModifiers={(val) => setField('modifiers', val)}
                onManageRecipe={() => showMessageModal('Podrás editar la receta detallada después de guardar.')}
            />
        </div>
    );

    // PASO 4: RESUMEN FINAL (NUEVO)
    const renderStep4 = () => (
        <div className="wizard-step animate-fade-in">
            <div className="wizard-welcome">
                <div className="main-icon-circle bg-green-100 text-green-600">
                    <FileText size={40} />
                </div>
                <h3>¡Todo listo!</h3>
                <p>Revisa la información antes de crear el producto.</p>
            </div>

            <div className="summary-card" style={{ 
                backgroundColor: '#f9fafb', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                marginTop: '10px',
                textAlign: 'left'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px', borderBottom: '1px dashed #ccc', paddingBottom: '15px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#1f2937' }}>{data.name || 'Sin Nombre'}</h2>
                        <span className="badge" style={{ backgroundColor: '#ffedd5', color: '#c2410c', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', marginTop: '5px', display: 'inline-block' }}>
                            {data.productType === 'sellable' ? 'Platillo de Venta' : 'Insumo Interno'}
                        </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontSize: '0.9rem', color: '#6b7280' }}>
                            {data.productType === 'sellable' ? 'Precio' : 'Costo'}
                        </span>
                        <strong style={{ fontSize: '1.5rem', color: '#059669' }}>
                            ${parseFloat(data.productType === 'sellable' ? data.price : data.cost || 0).toFixed(2)}
                        </strong>
                    </div>
                </div>

                <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', fontSize: '0.95rem' }}>
                    <div>
                        <strong style={{ color: '#6b7280' }}>Categoría:</strong>
                        <div style={{ marginTop: '2px' }}>{categoryName}</div>
                    </div>
                    
                    {data.productType === 'sellable' && (
                        <>
                            <div>
                                <strong style={{ color: '#6b7280' }}><Printer size={14} style={{ marginRight: 4 }}/>Impresión:</strong>
                                <div style={{ marginTop: '2px', textTransform: 'capitalize' }}>
                                    {data.printStation === 'none' ? 'No Imprimir' : (data.printStation || 'Cocina')}
                                </div>
                            </div>
                            <div>
                                <strong style={{ color: '#6b7280' }}><Clock size={14} style={{ marginRight: 4 }}/>Tiempo Prep:</strong>
                                <div style={{ marginTop: '2px' }}>
                                    {data.prepTime ? `${data.prepTime} min` : 'No definido'}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {data.modifiers && data.modifiers.length > 0 && (
                    <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                        <strong style={{ color: '#6b7280', display: 'block', marginBottom: '8px' }}>Extras / Modificadores:</strong>
                        <ul style={{ paddingLeft: '20px', margin: 0, color: '#4b5563' }}>
                            {data.modifiers.map((mod, idx) => (
                                <li key={idx}>
                                    {mod.name} <small>({mod.options?.length || 0} opciones)</small>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="product-wizard-container theme-restaurant">
            {/* Barra de progreso actualizada a 4 pasos */}
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

                {/* Si no estamos en el paso final, mostramos "Siguiente" */}
                {step < 4 ? (
                    <button className="btn btn-primary bg-orange-600 hover:bg-orange-700" onClick={() => {
                        // Validación simple del paso 2
                        if (step === 2 && !data.name) return showMessageModal('Por favor, asigna un nombre al producto.');
                        setStep(step + 1);
                    }}>
                        Siguiente <ChevronRight size={16} />
                    </button>
                ) : (
                    // Solo en el paso 4 mostramos Guardar
                    <button className="btn btn-save pulse bg-green-600" onClick={() => onSave(data)}>
                        ✅ Confirmar y Crear
                    </button>
                )}
            </div>
        </div>
    );
}