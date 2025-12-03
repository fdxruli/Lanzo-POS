// src/components/products/WasteModal.jsx
import React, { useState } from 'react';
import { saveDataSafe, STORES } from '../../services/database';
import { generateID, showMessageModal, roundCurrency } from '../../services/utils';
// --- CAMBIO: Usamos el store correcto (Estadísticas) ---
import { useStatsStore } from '../../store/useStatsStore';

export default function WasteModal({ show, onClose, product, onConfirm }) {
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('caducado'); // caducado, dañado, etc.
    const [notes, setNotes] = useState('');

    // --- CAMBIO: Usamos el hook del store de estadísticas ---
    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);

    if (!show || !product) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        const qty = parseFloat(quantity);

        if (!qty || qty <= 0) {
            alert("Ingresa una cantidad válida.");
            return;
        }

        if (qty > product.stock) {
            alert("No puedes mermar más de lo que tienes en stock.");
            return;
        }

        // 1. Descontar del inventario directamente (Stock global)
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

        const wasteRecord = {
            id: generateID('waste'),
            productId: product.id,
            productName: product.name,
            quantity: qty,
            unit: product.bulkData?.purchase?.unit || 'u',
            costAtTime: product.cost || 0,
            lossAmount: roundCurrency((product.cost || 0) * qty),
            reason: reason,
            notes: notes,
            timestamp: new Date().toISOString()
        };

        const wasteResult = await saveDataSafe(STORES.WASTE, wasteRecord);

        if (!wasteResult.success) {
            alert(`Advertencia: El stock se descontó pero falló el registro de merma: ${wasteResult.error?.message}`);
            // Aun así continuamos porque el stock es lo crítico
        }

        const lossAmount = (product.cost || 0) * qty;
        await adjustInventoryValue(-lossAmount);
        showMessageModal(`✅ Merma registrada. Stock actualizado.\nPérdida estimada: $${lossAmount.toFixed(2)}`);

        onConfirm();
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