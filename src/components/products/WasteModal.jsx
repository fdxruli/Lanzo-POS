// src/components/products/WasteModal.jsx
import React, { useState } from 'react';
import { saveDataSafe, STORES } from '../../services/database';
import { generateID, showMessageModal, roundCurrency } from '../../services/utils';
// --- CAMBIO: Usamos el store correcto (Estadísticas) ---
import { useStatsStore } from '../../store/useStatsStore';
import { useProductStore } from '../../store/useProductStore';
import { useSalesStore } from '../../store/useSalesStore';

export default function WasteModal({ show, onClose, product, onConfirm }) {
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('caducado'); // caducado, dañado, etc.
    const [notes, setNotes] = useState('');
    const menu = useProductStore(state => state.menu);
    // --- CAMBIO: Usamos el hook del store de estadísticas ---
    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);
    const registerWasteRecord = useSalesStore(state => state.registerWasteRecord);

    if (!show || !product) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        const qty = parseFloat(quantity);

        if (!qty || qty <= 0) {
            alert("Ingresa una cantidad válida.");
            return;
        }

        // --- LÓGICA INTELIGENTE DE MERMA ---
        let totalCostLoss = 0;
        let wasteDetails = '';

        // CASO A: Es un Platillo con Receta (Explosión de Insumos)
        if (product.productType === 'sellable' && product.recipe && product.recipe.length > 0) {

            // Confirmación extra porque esto afectará varios productos
            if (!window.confirm(`Al mermar este platillo se descontarán sus ingredientes del inventario.\n¿Confirmar merma de ${qty} ${product.name}?`)) {
                return;
            }

            const ingredientsToUpdate = [];

            // 1. Calcular descuentos necesarios
            for (const item of product.recipe) {
                const ingredient = menu.find(p => p.id === item.ingredientId);

                if (ingredient) {
                    const amountNeeded = item.quantity * qty;

                    // Validación de Stock del Ingrediente (Opcional: permitir negativo si ya se tiró)
                    // Aquí decidimos permitir que se vaya a negativo para reflejar la realidad: la comida se tiró.

                    const newStock = (ingredient.stock || 0) - amountNeeded;
                    const itemCost = (ingredient.cost || 0) * amountNeeded;

                    ingredientsToUpdate.push({
                        ...ingredient,
                        stock: newStock,
                        updatedAt: new Date().toISOString()
                    });

                    totalCostLoss += itemCost;
                    wasteDetails += `${ingredient.name} (-${amountNeeded.toFixed(3)} ${item.unit}), `;
                }
            }

            // 2. Aplicar descuentos en Base de Datos
            // (Lo hacemos secuencial para asegurar integridad)
            try {
                await Promise.all(ingredientsToUpdate.map(ing => saveDataSafe(STORES.MENU, ing)));
            } catch (error) {
                alert("Error al descontar ingredientes: " + error.message);
                return;
            }

        }
        // CASO B: Es un Insumo o Producto Directo (Descuento Simple)
        else {
            if (qty > product.stock) {
                alert("No puedes mermar más de lo que tienes en stock.");
                return;
            }

            const updatedProduct = {
                ...product,
                stock: product.stock - qty,
                updatedAt: new Date().toISOString()
            };

            const prodResult = await saveDataSafe(STORES.MENU, updatedProduct);
            if (!prodResult.success) {
                alert(`Error al actualizar stock: ${prodResult.error?.message}`);
                return;
            }

            totalCostLoss = (product.cost || 0) * qty;
            wasteDetails = 'Descuento directo de inventario';
        }

        // --- REGISTRO DE LA MERMA (LOG) ---
        const wasteRecord = {
            id: generateID('waste'),
            productId: product.id,
            productName: product.name,
            quantity: qty,
            unit: product.bulkData?.purchase?.unit || (product.productType === 'sellable' ? 'orden' : 'u'),
            costAtTime: totalCostLoss / qty, // Costo unitario promedio de esta merma
            lossAmount: roundCurrency(totalCostLoss),
            reason: reason,
            notes: `${notes} [Detalles: ${wasteDetails}]`,
            timestamp: new Date().toISOString()
        };

        const wasteResult = await saveDataSafe(STORES.WASTE, wasteRecord);

        if (!wasteResult.success) {
            alert(`Advertencia: Inventario actualizado pero falló el registro de historial.`);
        } else {
            await registerWasteRecord(wasteRecord);
        }

        // Actualizar valor financiero global
        await adjustInventoryValue(-totalCostLoss);

        showMessageModal(`✅ Merma registrada.\nSe descontaron los insumos correctamente.\nPérdida: $${totalCostLoss.toFixed(2)}`);

        onConfirm(); // Recargar lista
        onClose();
        setQuantity(''); setNotes('');
    };

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
            <div className="modal-content" style={{ maxWidth: '400px' }}>
                <h2 className="modal-title" style={{ color: 'var(--error-color)' }}>🗑️ Registrar Merma</h2>
                <p>Producto: <strong>{product.name}</strong></p>
                <p style={{ fontSize: '0.9rem' }}>Stock actual: {product.stock}</p>

                <form onSubmit={handleSave}>
                    <div className="form-group">
                        <label className="form-label">Cantidad a desechar ({product.bulkData?.purchase?.unit || 'unidades'})</label>
                        <input
                            type="number" className="form-input" step="0.01" autoFocus
                            value={quantity} onChange={e => setQuantity(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Motivo</label>
                        <select className="form-input" value={reason} onChange={e => setReason(e.target.value)}>
                            <option value="caducado">🤢 Se pudrió / Caducó</option>
                            <option value="dañado">🤕 Se aplastó / Dañado</option>
                            <option value="robo">🕵️ Robo / Faltante</option>
                            <option value="degustacion">😋 Degustación / Regalo</option>
                            <option value="quemado">🔥 Se quemó en cocina</option>
                            <option value="error_pedido">❌ Error en pedido / Cliente lo rechazó</option>
                            <option value="contaminacion">⚠️ Contaminación cruzada</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Notas</label>
                        <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows="2"></textarea>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-delete">Confirmar Pérdida</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
