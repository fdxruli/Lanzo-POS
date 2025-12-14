import React, { useState, useEffect } from 'react';
import { saveData, saveBulkSafe, STORES } from '../../services/database';
import { showMessageModal } from '../../services/utils';
// 1. IMPORTAR STORE PARA OBTENER CATEGORÍAS
import { useProductStore } from '../../store/useProductStore';

export default function DailyPriceModal({ show, onClose, products, onRefresh }) {
    const [editedProducts, setEditedProducts] = useState({});
    const [filter, setFilter] = useState('');

    // 2. NUEVO ESTADO PARA CATEGORÍA
    const [selectedCategory, setSelectedCategory] = useState('all');
    const categories = useProductStore(state => state.categories);

    // 3. FILTRADO MEJORADO
    const relevantProducts = products.filter(p => {
        // Filtro de Texto
        const matchesText = p.name.toLowerCase().includes(filter.toLowerCase());

        // Filtro de Categoría
        const matchesCategory = selectedCategory === 'all' || p.categoryId === selectedCategory;

        return matchesText && matchesCategory && p.isActive !== false;
    });

    const handlePriceChange = (id, field, value) => {
        setEditedProducts(prev => ({
            ...prev,
            [id]: {
                ...prev[id],
                [field]: parseFloat(value) || 0
            }
        }));
    };

    const handleSaveAll = async () => {
        // ... (Lógica de guardado se mantiene igual)
        const updates = [];
        Object.keys(editedProducts).forEach(id => {
            const original = products.find(p => p.id === id);
            if (!original) return;
            const changes = editedProducts[id];
            if (changes.price !== original.price || changes.cost !== original.cost) {
                updates.push({
                    ...original,
                    price: changes.price !== undefined ? changes.price : original.price,
                    cost: changes.cost !== undefined ? changes.cost : original.cost,
                    updatedAt: new Date().toISOString()
                });
            }
        });

        if (updates.length === 0) { onClose(); return; }

        const result = await saveBulkSafe(STORES.MENU, updates);
        if (result.success) {
            await onRefresh();
            showMessageModal(`✅ Precios actualizados para ${updates.length} productos.`);
            setEditedProducts({});
            onClose();
        } else {
            console.error(result.error);
            showMessageModal(`Error al actualizar precios: ${result.error?.message}`);
        }
    };

    if (!show) return null;

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 2300 }}>
            <div className="modal-content" style={{ maxWidth: '700px', height: '80vh', display: 'flex', flexDirection: 'column' }}>
                <h2 className="modal-title">📝 Actualización Rápida de Precios</h2>
                <p style={{ marginBottom: '10px', color: '#666' }}>Ajusta costos y precios según el mercado de hoy.</p>

                {/* 4. UI DE FILTROS ENCABEZADO */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Buscar producto..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={{ flex: 1 }}
                        autoFocus
                    />

                    <select
                        className="form-input"
                        style={{ flex: 1 }}
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                        <option value="all">Todas las Categorías</option>
                        {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    </select>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
                            <tr>
                                <th style={{ padding: '10px', textAlign: 'left' }}>Producto</th>
                                <th style={{ padding: '10px', width: '120px' }}>Costo ($)</th>
                                <th style={{ padding: '10px', width: '120px' }}>Venta ($)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {relevantProducts.map(p => {
                                const edits = editedProducts[p.id] || {};
                                const currentCost = edits.cost !== undefined ? edits.cost : (p.cost || 0);
                                const currentPrice = edits.price !== undefined ? edits.price : (p.price || 0);
                                const margin = currentCost > 0 ? (((currentPrice - currentCost) / currentCost) * 100).toFixed(0) : 0;

                                return (
                                    <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '10px' }}>
                                            <strong>{p.name}</strong>
                                            {/* Mostrar unidad para referencia */}
                                            <span style={{ fontSize: '0.8rem', color: '#666', marginLeft: '5px' }}>
                                                ({p.bulkData?.purchase?.unit || 'Unidad'})
                                            </span>
                                            <br />
                                            <small style={{ color: margin < 15 ? 'red' : 'green' }}>Margen: {margin}%</small>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                            <input
                                                type="number" className="form-input" step="0.50"
                                                value={currentCost}
                                                onChange={(e) => handlePriceChange(p.id, 'cost', e.target.value)}
                                                style={{ padding: '5px', fontSize: '0.9rem' }}
                                            />
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                            <input
                                                type="number" className="form-input" step="0.50"
                                                value={currentPrice}
                                                onChange={(e) => handlePriceChange(p.id, 'price', e.target.value)}
                                                style={{ padding: '5px', fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--primary-color)' }}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="btn btn-cancel" onClick={onClose}>Cancelar</button>
                    <button className="btn btn-save" onClick={handleSaveAll}>
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </div>
    );
}