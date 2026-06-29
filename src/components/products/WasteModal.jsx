// src/components/products/WasteModal.jsx
import React, { useCallback, useState } from 'react';
import { saveDataSafe, STORES, updateProductSafe } from '../../services/database';
import { generateID, showConfirmModal, showMessageModal, roundCurrency } from '../../services/utils';
// --- CAMBIO: Usamos el store correcto (Estadísticas) ---
import { useStatsStore } from '../../store/useStatsStore';
import { useProductStore } from '../../store/useProductStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useAppStore } from '../../store/useAppStore';
import { Trash2, AlertCircle, PackageX, ShieldAlert, Gift, Flame, XCircle, AlertTriangle, X, CheckCircle, Leaf, Droplet } from 'lucide-react';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import './WasteModal.css';

const VERDULERIA_REASONS = [
    { id: 'caducado', label: 'Se pudrió / Caducó', icon: AlertCircle },
    { id: 'dañado', label: 'Se aplastó / Dañado', icon: PackageX },
    { id: 'deshidratacion', label: 'Merma natural / Deshidratación', icon: Leaf },
    { id: 'robo', label: 'Robo / Faltante', icon: ShieldAlert },
    { id: 'degustacion', label: 'Degustación / Regalo', icon: Gift },
];

const RESTAURANTE_REASONS = [
    { id: 'caducado', label: 'Se pudrió / Caducó', icon: AlertCircle },
    { id: 'quemado', label: 'Se quemó en cocina', icon: Flame },
    { id: 'error_pedido', label: 'Error / Rechazo de cliente', icon: XCircle },
    { id: 'contaminacion', label: 'Contaminación cruzada', icon: AlertTriangle },
    { id: 'dañado', label: 'Se derramó / Accidente', icon: Droplet },
    { id: 'robo', label: 'Robo / Faltante', icon: ShieldAlert },
    { id: 'degustacion', label: 'Degustación / Regalo', icon: Gift },
];

export default function WasteModal({ show, onClose, product, onConfirm }) {
    const companyProfile = useAppStore(state => state.companyProfile);
    const rubro = companyProfile?.business_type || 'verduleria';
    const activeReasons = rubro === 'restaurante' ? RESTAURANTE_REASONS : VERDULERIA_REASONS;

    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('caducado'); // caducado, dañado, etc.
    const [notes, setNotes] = useState('');
    const menu = useProductStore(state => state.menu);
    // --- CAMBIO: Usamos el hook del store de estadísticas ---
    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);
    const registerWasteRecord = useSalesStore(state => state.registerWasteRecord);

    const handleDismiss = useCallback(() => {
        onClose();
    }, [onClose]);

    const dismissModal = useDismissibleHistoryLayer({
        isOpen: Boolean(show && product),
        onDismiss: handleDismiss,
        layerId: 'waste-modal'
    });

    if (!show || !product) return null;

    const handleSave = async (e) => {
        e.preventDefault();
        const qty = parseFloat(quantity);

        if (!qty || qty <= 0) {
            showMessageModal("Ingresa una cantidad válida.", null, { type: 'warning' });
            return;
        }

        // --- LÓGICA INTELIGENTE DE MERMA ---
        let totalCostLoss = 0;
        let wasteDetails = '';

        // CASO A: Es un Platillo con Receta (Explosión de Insumos)
        if (product.productType === 'sellable' && product.recipe && product.recipe.length > 0) {

            // Confirmación extra porque esto afectará varios productos
            const confirmed = await showConfirmModal(
                `Al mermar este platillo se descontarán sus ingredientes del inventario.\n¿Confirmar merma de ${qty} ${product.name}?`,
                {
                    title: 'Confirmar merma',
                    confirmButtonText: 'Si, registrar merma',
                    cancelButtonText: 'Cancelar'
                }
            );
            if (!confirmed) {
                return;
            }

            const ingredientUpdates = [];

            // 1. Calcular descuentos necesarios
            for (const item of product.recipe) {
                const ingredient = menu.find(p => p.id === item.ingredientId);

                if (ingredient) {
                    const amountNeeded = item.quantity * qty;

                    // Permitir negativo para reflejar la realidad: la comida se tiró.
                    const newStock = (ingredient.stock || 0) - amountNeeded;
                    const itemCost = (ingredient.cost || 0) * amountNeeded;

                    ingredientUpdates.push({
                        id: ingredient.id,
                        stock: newStock
                    });

                    totalCostLoss += itemCost;
                    wasteDetails += `${ingredient.name} (-${amountNeeded.toFixed(3)} ${item.unit}), `;
                }
            }

            // 2. Aplicar descuentos usando updateProductSafe (respeta hooks de Dexie)
            try {
                await Promise.all(ingredientUpdates.map(ing =>
                    updateProductSafe(ing.id, { stock: ing.stock })
                ));
            } catch (error) {
                showMessageModal("Error al descontar ingredientes: " + error.message, null, { type: 'error' });
                return;
            }

        }
        // CASO B: Es un Insumo o Producto Directo (Descuento Simple)
        else {
            if (qty > product.stock) {
                showMessageModal("No puedes mermar más de lo que tienes en stock.", null, { type: 'warning' });
                return;
            }

            const newStock = product.stock - qty;

            const prodResult = await updateProductSafe(product.id, { stock: newStock });
            if (!prodResult.success) {
                showMessageModal(`Error al actualizar stock: ${prodResult.error?.message}`, null, { type: 'error' });
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
            showMessageModal(`Advertencia: Inventario actualizado pero falló el registro de historial.`, null, { type: 'warning' });
        } else {
            await registerWasteRecord(wasteRecord);
        }

        // Actualizar valor financiero global
        await adjustInventoryValue(-totalCostLoss);

        showMessageModal(`✅ Merma registrada.\nSe descontaron los insumos correctamente.\nPérdida: $${totalCostLoss.toFixed(2)}`);

        onConfirm(); // Recargar lista
        dismissModal();
        setQuantity(''); setNotes('');
    };

    return (
        <div className="waste-modal-overlay">
            <div className="waste-modal-content">
                <div className="waste-modal-header">
                    <h2 className="waste-modal-title">
                        <Trash2 size={24} /> Registrar Merma
                    </h2>
                    <button type="button" onClick={dismissModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-color, #333)' }}>
                        <X size={24} />
                    </button>
                </div>
                
                <div className="waste-product-info">
                    <p>Producto: <strong>{product.name}</strong></p>
                    <p>Stock actual: <strong>{product.stock}</strong></p>
                </div>

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
                        <div className="waste-reasons-grid">
                            {activeReasons.map(r => {
                                const Icon = r.icon;
                                return (
                                    <div 
                                        key={r.id} 
                                        className={`waste-reason-card ${reason === r.id ? 'selected' : ''}`}
                                        onClick={() => setReason(r.id)}
                                    >
                                        <Icon size={18} />
                                        <span>{r.label}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div className="form-group" style={{ marginTop: '15px' }}>
                        <label className="form-label">Notas (Opcional)</label>
                        <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows="2" placeholder="Agrega detalles si es necesario..."></textarea>
                    </div>

                    <div className="waste-actions">
                        <button type="button" className="btn btn-cancel" onClick={dismissModal}>Cancelar</button>
                        <button type="submit" className="btn btn-delete">
                            <CheckCircle size={18} /> Confirmar Pérdida
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}