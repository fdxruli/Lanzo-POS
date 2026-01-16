import React, { useState, useEffect } from 'react';
import { saveBatchAndSyncProductSafe } from '../../../services/database';
import Logger from '../../../services/Logger';

export default function BatchEditModal({ batchData, onClose, onSave }) {
    // Inicializamos el estado
    const [formData, setFormData] = useState({
        stock: '',
        price: '',
        cost: '',
        sku: '',
        // location: '', // Eliminado
        expiryDate: '',
        notes: ''
    });
    
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Cargar datos al montar
    useEffect(() => {
        if (batchData) {
            setFormData({
                stock: batchData.stock,
                price: batchData.price,
                cost: batchData.cost,
                sku: batchData.sku || '',
                expiryDate: batchData.expiryDate ? batchData.expiryDate.split('T')[0] : '',
                notes: batchData.notes || ''
            });
        }
    }, [batchData]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Cálculo de margen en tiempo real
    const calculateMargin = () => {
        const p = parseFloat(formData.price) || 0;
        const c = parseFloat(formData.cost) || 0;
        if (p === 0) return 0;
        return ((p - c) / p) * 100;
    };

    const margin = calculateMargin();
    const isLoss = parseFloat(formData.price) < parseFloat(formData.cost);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const newStock = parseFloat(formData.stock);
        const newPrice = parseFloat(formData.price);
        const newCost = parseFloat(formData.cost);

        // --- VALIDACIONES ---
        if (isNaN(newStock) || newStock < 0) {
            setError('El stock no puede ser negativo.');
            return;
        }

        if (newPrice < newCost) {
            const confirmLoss = window.confirm(
                `⚠️ ALERTA DE PÉRDIDA\n\n` +
                `Estás configurando el Precio ($${newPrice}) MENOR al Costo ($${newCost}).\n` +
                `¿Deseas guardar de todos modos?`
            );
            if (!confirmLoss) return;
        }

        setSaving(true);

        try {
            // --- PREPARACIÓN DEL PAYLOAD ---
            const payload = {
                id: batchData.id,
                productId: batchData.productId,
                isActive: true,
                attributes: batchData.attributes, 
                createdAt: batchData.createdAt,
                
                // Valores editados:
                stock: newStock,
                price: newPrice,
                cost: newCost,
                sku: formData.sku.trim().toUpperCase(),
                // location: formData.location, // Eliminado del payload
                expiryDate: formData.expiryDate || null,
                notes: formData.notes,
                updatedAt: new Date().toISOString()
            };

            // --- GUARDADO ---
            const result = await saveBatchAndSyncProductSafe(payload);

            if (result.success) {
                Logger.info(`Lote/Variante ${payload.sku} actualizada.`);
                onSave();
            } else {
                throw new Error(result.error?.message || 'Error desconocido al guardar');
            }

        } catch (err) {
            Logger.error("Error en BatchEditModal:", err);
            setError(err.message || 'Error al guardar en base de datos.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal" style={{ zIndex: 9999 }}>
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                {/* Cabecera */}
                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0 }}>Editar Variante / Lote</h3>
                    
                    <div style={{ marginTop: '5px', fontSize: '0.95rem', color: 'var(--text-light)' }}>
                        <div style={{ fontWeight: '600', color: 'var(--text-dark)', marginBottom:'4px' }}>
                            {batchData.productName}
                        </div>
                        
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {batchData.talla && (
                                <span className="status-badge neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border-color)' }}>
                                    📏 Talla: <strong>{batchData.talla}</strong>
                                </span>
                            )}
                            {batchData.color && (
                                <span className="status-badge neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border-color)' }}>
                                    🎨 Color: <strong>{batchData.color}</strong>
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {error && (
                    <div style={{ 
                        backgroundColor: 'rgba(255, 59, 92, 0.1)', 
                        color: 'var(--error-color)', 
                        padding: '10px', 
                        borderRadius: 'var(--border-radius-sm)', 
                        marginBottom: '15px', 
                        fontWeight: 'bold' 
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    
                    {/* Fila 1: SKU (Ancho completo ahora que no hay ubicación) */}
                    <div style={{ marginBottom: '15px' }}>
                        <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>SKU (Código)</label>
                        <input 
                            type="text" 
                            name="sku"
                            value={formData.sku} 
                            onChange={handleChange}
                            className="form-input"
                            style={{ fontFamily: 'monospace', width: '100%' }}
                            placeholder="Generado automáticamente"
                        />
                    </div>

                    {/* Grid para Costos, Precios y Stock */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        
                        {/* Fila 2: Costo y Precio */}
                        <div>
                            <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>Costo Unitario ($)</label>
                            <input 
                                type="number" step="0.01" 
                                name="cost"
                                value={formData.cost} 
                                onChange={handleChange}
                                className="form-input"
                            />
                        </div>
                        <div>
                            <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>
                                Precio Venta ($)
                                {margin < 0 ? (
                                    <span style={{color: 'var(--error-color)', fontSize:'0.8em', marginLeft:'5px'}}>Perdida</span>
                                ) : (
                                    <span style={{color: 'var(--success-color)', fontSize:'0.8em', marginLeft:'5px'}}>
                                        Margen: {margin.toFixed(1)}%
                                    </span>
                                )}
                            </label>
                            <input 
                                type="number" step="0.01" 
                                name="price"
                                value={formData.price} 
                                onChange={handleChange}
                                className="form-input"
                                style={{ 
                                    borderColor: isLoss ? 'var(--error-color)' : 'var(--border-color)',
                                    backgroundColor: isLoss ? 'rgba(255, 59, 92, 0.05)' : 'var(--card-background-color)'
                                }}
                            />
                        </div>

                        {/* Fila 3: Stock y Caducidad */}
                        <div>
                            <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>Stock Actual</label>
                            <input 
                                type="number" step="any" 
                                name="stock"
                                value={formData.stock} 
                                onChange={handleChange}
                                className="form-input"
                                style={{ fontWeight: 'bold', fontSize: '1.1em' }}
                            />
                        </div>
                        <div>
                            <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>Caducidad</label>
                            <input 
                                type="date"
                                name="expiryDate"
                                value={formData.expiryDate} 
                                onChange={handleChange}
                                className="form-input"
                            />
                        </div>
                    </div>

                    {/* Fila 4: Notas (Ancho completo) */}
                    <div style={{ marginTop: '15px' }}>
                        <label className="form-label" style={{display:'block', marginBottom:'5px', fontWeight:600}}>Notas / Observaciones</label>
                        <textarea 
                            name="notes"
                            value={formData.notes}
                            onChange={handleChange}
                            className="form-input"
                            rows="2"
                            placeholder="Detalles adicionales..."
                        />
                    </div>

                    {/* Botones Igualados */}
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', // Asegura que ocupen todo el ancho
                        gap: '15px', 
                        marginTop: '25px', 
                        paddingTop: '20px', 
                        borderTop: '1px solid var(--border-color)' 
                    }}>
                        {/* flex: 1 en ambos botones asegura el mismo tamaño */}
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="btn btn-secondary" 
                            style={{ flex: 1, justifyContent: 'center' }}
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit" 
                            disabled={saving} 
                            className="btn btn-primary" 
                            style={{ flex: 1, justifyContent: 'center' }}
                        >
                            {saving ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}